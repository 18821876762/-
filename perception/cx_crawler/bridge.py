# -*- coding: utf-8 -*-
"""本地只读桥服务：把 output/playlist_*.json 通过 127.0.0.1 HTTP 暴露给浏览器用户脚本。

用途（方案 A）：
    force-play / auto-next 用户脚本跑在学习通页面里，无法读本地磁盘；
    本服务把爬虫产出的未完成章节清单（playlist_{cid}.json）以 CORS-friendly
    的方式提供给它们，实现"跳过已完成章节 + 精确跳到下一未完成章节"。

安全边界：
    - 仅监听 127.0.0.1（不对局域网/公网暴露）；
    - 只读 GET：白名单路由 + 文件名正则校验，杜绝路径穿越；
    - 只提供 playlist_*.json（不暴露 cookies.json 等敏感文件）。

用法：
    python bridge.py                          # 默认 127.0.0.1:7531，前台常驻，Ctrl+C 退出
    python bridge.py --port 7532              # 自定义端口
    python bridge.py --host 0.0.0.0 --port 8080   # 自定义监听地址(仅本机建议保持 127.0.0.1)
    python bridge.py --config bridge_config.json   # 从 JSON 读 host/port
端口/地址优先级：命令行 --host/--port/--config  > 环境变量 CX_BRIDGE_HOST/PORT
                  > 同目录 bridge_config.json  > 默认 127.0.0.1:7531
浏览器侧 force-play / auto-next 需在同一端口（?cxbridge= 或 localStorage.cx_bridge_base）对齐。
接口：
    GET /ping                       -> {"ok": true, "version": ...}
    GET /playlist/index             -> playlist_index.json 内容
    GET /playlist/{courseid}        -> playlist_{courseid}.json 内容
"""

import os
import re
import sys
import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler, ThreadingHTTPServer

from config import OUTPUT_DIR, BRIDGE_HOST, BRIDGE_PORT, VERSION


class _Handler(BaseHTTPRequestHandler):
    server_version = "CxBridge/1.0"

    # 静音默认的逐请求 stderr 日志，避免刷屏；出错仍会走 send_error。
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 用户脚本从 chaoxing.com 页面 fetch 本服务，必须放开 CORS。
        # 只读、仅本机监听，Allow-Origin * 风险可接受。
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, filename):
        """只发送 OUTPUT_DIR 下的指定 playlist 文件；不存在返回 404。"""
        path = os.path.join(OUTPUT_DIR, filename)
        # 双保险：拼接后仍必须位于 OUTPUT_DIR 内（filename 已经过白名单校验）
        if os.path.abspath(path) != os.path.join(os.path.abspath(OUTPUT_DIR), filename):
            self._send_json({"error": "bad path"}, 400)
            return
        if not os.path.isfile(path):
            self._send_json({"error": f"{filename} not found，请先运行 python dump.py"}, 404)
            return
        try:
            # utf-8-sig 同时兼容带/不带 BOM 的文件（dump.py 产出的不带 BOM，但容错更稳）
            with open(path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
        except Exception as e:
            self._send_json({"error": f"read failed: {e}"}, 500)
            return
        self._send_json(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/ping":
            self._send_json({"ok": True, "version": VERSION, "service": "cx-bridge"})
            return
        if path == "/playlist/index":
            self._send_file("playlist_index.json")
            return
        m = re.match(r"^/playlist/(\d{8,12})$", path)
        if m:
            self._send_file(f"playlist_{m.group(1)}.json")
            return
        self._send_json({"error": "not found"}, 404)

    # 预检请求兜底（GM fetch 一般不触发，但浏览器原生 fetch 可能带自定义头时会）
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()


def _resolve_args():
    """解析命令行参数：--host/--port 覆盖 config 中的默认值；--config 可指定额外 JSON。"""
    p = argparse.ArgumentParser(
        description="本地只读桥服务（把爬虫 playlist 暴露给浏览器用户脚本）")
    p.add_argument("--host", default=BRIDGE_HOST,
                   help=f"监听地址（默认 {BRIDGE_HOST}）")
    p.add_argument("--port", type=int, default=BRIDGE_PORT,
                   help=f"监听端口（默认 {BRIDGE_PORT}；亦可用 CX_BRIDGE_PORT 或 bridge_config.json）")
    p.add_argument("--config", default=None,
                   help="桥配置 JSON 路径，含 host/port（优先级高于环境变量与 bridge_config.json）")
    args = p.parse_args()

    host = args.host
    port = args.port
    if args.config and os.path.isfile(args.config):
        try:
            with open(args.config, "r", encoding="utf-8-sig") as f:
                c = json.load(f)
            if isinstance(c, dict):
                if c.get("host"):
                    host = str(c["host"])
                if c.get("port") is not None:
                    try:
                        port = int(c["port"])
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            print(f"[bridge] 读取 --config 失败，忽略: {e}", file=sys.stderr)
    return host, port


def main():
    host, port = _resolve_args()
    addr = (host, port)
    httpd = ThreadingHTTPServer(addr, _Handler)  # L7：并发请求（浏览器拉取多个课程 playlist 不再被串行阻塞）
    print(f"[bridge] 只读桥服务已启动: http://{host}:{port}")
    print(f"[bridge] 数据目录: {OUTPUT_DIR}")
    print("[bridge] 接口: /ping  /playlist/index  /playlist/{courseid}")
    print("[bridge] Ctrl+C 退出")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[bridge] 已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
