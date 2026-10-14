# -*- coding: utf-8 -*-
"""只读 playlist 桥。默认回环监听，仅允许 HTTPS chaoxing.com 浏览器来源。

配置顺序：CLI > 显式 --config > 环境变量 > 同目录 bridge_config.json > 默认值。
学校域名可用 allowed_origins / --allow-origin 明确添加；无 Origin 的本机 CLI 可访问。
配置 token 后只接受 Authorization: Bearer，非回环监听必须配置非空 token。
接口：GET /ping、/playlist/index、/playlist/{8–12 位 courseid}。
"""

import argparse
import hmac
import ipaddress
import json
import os
import re
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from config import OUTPUT_DIR, VERSION, _BRIDGE_DEFAULT_HOST, _BRIDGE_DEFAULT_PORT

_DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_config.json")
_EXTRA_HEADERS = frozenset({"authorization"})


def _parse_origin(value):
    """接受单个 HTTP(S) origin，拒绝路径、凭据、非规范端口和歧义主机名。"""
    if not isinstance(value, str) or not value or re.search(r"[\x00-\x20\x7f\\%]", value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        if parsed.path or parsed.query or parsed.fragment or "?" in value or "#" in value:
            return None
        host, port = parsed.hostname, parsed.port
        if not host or not host.isascii() or host.endswith("."):
            return None
        try:
            ip = ipaddress.ip_address(host)
            authority = f"[{ip.compressed}]" if ip.version == 6 else str(ip)
        except ValueError:
            if len(host) > 253 or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                                      for label in host.split(".")):
                return None
            authority = host
        expected = authority + (f":{port}" if port is not None else "")
        if parsed.netloc.lower() != expected or port == 0:
            return None
        default_port = 443 if parsed.scheme == "https" else 80
        canonical = f"{parsed.scheme}://{authority}"
        if port is not None and port != default_port:
            canonical += f":{port}"
        return canonical, parsed.scheme, host, port
    except ValueError:
        return None


def _origin_allowed(origin, extra_origins):
    parsed = _parse_origin(origin)
    if parsed is None:
        return False
    canonical, scheme, host, port = parsed
    chaoxing = host == "chaoxing.com" or host.endswith(".chaoxing.com")
    return (scheme == "https" and port in (None, 443) and chaoxing) or canonical in extra_origins


def _is_loopback(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _normalize_token(token):
    if token is None:
        return None
    if not isinstance(token, str):
        raise ValueError("auth_token 必须为不含控制字符的字符串")
    if not token.strip():
        return None
    if re.search(r"[\x00-\x1f\x7f]", token):
        raise ValueError("auth_token 必须为不含控制字符的字符串")
    return token.strip()


def _validate_listener(host, token):
    if not isinstance(host, str) or not host or host != host.strip():
        raise ValueError("host 必须为非空监听地址")
    token = _normalize_token(token)
    if not _is_loopback(host) and token is None:
        raise ValueError("非回环监听必须设置非空 auth_token；默认请使用 127.0.0.1")
    return token


def _port_in_use(host, port):
    """预检重复启动，避免 Windows SO_REUSEADDR 允许静默双绑。"""
    try:
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex((host, port)) == 0
    except OSError:
        return False


class _Handler(BaseHTTPRequestHandler):
    server_version = "CxBridge/1.1"
    auth_token = None
    allowed_origins = frozenset()

    def log_message(self, fmt, *args):
        # Request URLs and Authorization values must not enter logs.
        pass

    def _allowed_request_origin(self):
        origins = self.headers.get_all("Origin", [])
        if not origins:
            return True, None
        if len(origins) == 1 and _origin_allowed(origins[0], self.allowed_origins):
            return True, origins[0]
        return False, None

    def _cors_headers(self):
        allowed, origin = self._allowed_request_origin()
        self.send_header("Vary", "Origin")
        if allowed and origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Cache-Control", "no-store")

    def _check_auth(self):
        if self.auth_token is None:
            return True
        headers = self.headers.get_all("Authorization", [])
        if len(headers) != 1:
            return False
        expected = f"Bearer {self.auth_token}".encode("utf-8")
        return hmac.compare_digest(headers[0].encode("utf-8"), expected)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, filename):
        root = os.path.realpath(OUTPUT_DIR)
        path = os.path.realpath(os.path.join(root, filename))
        try:
            contained = os.path.commonpath([root, path]) == root
        except ValueError:
            contained = False
        if not contained:
            self._send_json({"error": "bad path"}, 400)
            return
        if not os.path.isfile(path):
            self._send_json({"error": f"{filename} not found，请先运行 python dump.py"}, 404)
            return
        try:
            with open(path, "r", encoding="utf-8-sig") as file:
                data = json.load(file)
        except (OSError, ValueError):
            self._send_json({"error": "read failed"}, 500)
            return
        self._send_json(data)

    def _path(self):
        return self.path.split("?", 1)[0].rstrip("/") or "/"

    def _route_allowed(self):
        return self._path() in ("/ping", "/playlist/index") or bool(re.fullmatch(r"/playlist/[0-9]{8,12}", self._path()))

    def do_GET(self):
        if not self._allowed_request_origin()[0]:
            self._send_json({"error": "origin forbidden"}, 403)
            return
        if not self._check_auth():
            self._send_json({"error": "unauthorized"}, 401)
            return
        path = self._path()
        if path == "/ping":
            self._send_json({"ok": True, "version": VERSION, "service": "cx-bridge"})
        elif path == "/playlist/index":
            self._send_file("playlist_index.json")
        elif re.fullmatch(r"/playlist/[0-9]{8,12}", path):
            self._send_file(f"playlist_{path.rsplit('/', 1)[1]}.json")
        else:
            self._send_json({"error": "not found"}, 404)

    def do_OPTIONS(self):
        allowed, origin = self._allowed_request_origin()
        if not allowed or origin is None:
            self._send_json({"error": "origin forbidden"}, 403)
            return
        methods = self.headers.get_all("Access-Control-Request-Method", [])
        if methods != ["GET"]:
            self._send_json({"error": "method forbidden"}, 405)
            return
        headers = self.headers.get_all("Access-Control-Request-Headers", [])
        requested = {item.strip().lower() for item in headers[0].split(",")} if headers else set()
        if len(headers) > 1 or not requested.issubset(_EXTRA_HEADERS):
            self._send_json({"error": "headers forbidden"}, 403)
            return
        if not self._route_allowed():
            self._send_json({"error": "not found"}, 404)
            return
        # Preflight has no bearer token. The subsequent GET always verifies it.
        self.send_response(204)
        self._cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET")
        if requested:
            self.send_header("Access-Control-Allow-Headers", "Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()


def _make_server(host, port, auth_token=None, allowed_origins=()):
    token = _validate_listener(host, auth_token)
    normalized = set()
    for origin in allowed_origins:
        parsed = _parse_origin(origin)
        if parsed is None:
            raise ValueError("allowed_origins 必须只包含明确的 HTTP(S) origin")
        normalized.add(parsed[0])
    handler = type("ConfiguredHandler", (_Handler,), {"auth_token": token, "allowed_origins": frozenset(normalized)})
    server_class = ThreadingHTTPServer
    if ":" in host:
        server_class = type("IPv6HTTPServer", (ThreadingHTTPServer,), {"address_family": socket.AF_INET6})
    return server_class((host, port), handler)


def _read_config(path, required=False):
    if not required and not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8-sig") as file:
            data = json.load(file)
        if not isinstance(data, dict):
            raise ValueError
        return data
    except (OSError, ValueError):
        raise ValueError("桥配置无法读取或不是 JSON 对象") from None


def _resolve_args(argv=None):
    parser = argparse.ArgumentParser(description="本地只读 playlist 桥（默认仅允许 HTTPS chaoxing.com 来源）")
    parser.add_argument("--host", help="监听地址；CLI 优先于 --config 和环境变量")
    parser.add_argument("--port", type=int, help="监听端口，默认 7531")
    parser.add_argument("--auth-token", help="仅通过 Authorization: Bearer 校验；建议使用 CX_BRIDGE_AUTH_TOKEN 避免命令行暴露")
    parser.add_argument("--allow-origin", action="append", help="额外允许的明确 HTTP(S) origin；可重复，覆盖较低层的额外列表")
    parser.add_argument("--config", help="显式配置 JSON，优先于环境变量和默认配置")
    args = parser.parse_args(argv)
    try:
        values = {"host": _BRIDGE_DEFAULT_HOST, "port": _BRIDGE_DEFAULT_PORT, "auth_token": None, "allowed_origins": []}
        values.update(_read_config(_DEFAULT_CONFIG))
        for key, env_name in (("host", "CX_BRIDGE_HOST"), ("port", "CX_BRIDGE_PORT"), ("auth_token", "CX_BRIDGE_AUTH_TOKEN")):
            if env_name in os.environ:
                values[key] = os.environ[env_name]
        if "CX_BRIDGE_ALLOW_ORIGINS" in os.environ:
            raw = os.environ["CX_BRIDGE_ALLOW_ORIGINS"]
            values["allowed_origins"] = raw.split(",") if raw else []
        if args.config:
            values.update(_read_config(args.config, required=True))
        for key in ("host", "port", "auth_token"):
            if getattr(args, key) is not None:
                values[key] = getattr(args, key)
        if args.allow_origin is not None:
            values["allowed_origins"] = args.allow_origin
        port = values["port"]
        if isinstance(port, bool) or not re.fullmatch(r"[0-9]+", str(port)) or not 0 <= int(port) <= 65535:
            raise ValueError("port 必须为 0–65535 的整数")
        token = _validate_listener(values["host"], values["auth_token"])
        origins = values["allowed_origins"]
        if not isinstance(origins, list):
            raise ValueError("allowed_origins 必须为 origin 数组")
        parsed = [_parse_origin(origin) for origin in origins]
        if any(origin is None for origin in parsed):
            raise ValueError("allowed_origins 必须只包含明确的 HTTP(S) origin")
        return values["host"], int(port), token, tuple(origin[0] for origin in parsed)
    except ValueError as error:
        parser.error(str(error))


def main():
    host, port, auth_token, allowed_origins = _resolve_args()
    if _port_in_use(host, port):
        print(f"[bridge] 端口 {host}:{port} 已被占用，停止重复启动。", file=sys.stderr)
        sys.exit(1)
    httpd = _make_server(host, port, auth_token, allowed_origins)
    if auth_token:
        print("[bridge] Token 鉴权已启用（仅 Authorization: Bearer 请求头）")
    print(f"[bridge] 只读桥服务已启动: {host}:{httpd.server_address[1]}")
    print("[bridge] 来源限制已启用；接口: /ping /playlist/index /playlist/{courseid}；Ctrl+C 退出")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] 已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
