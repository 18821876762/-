# -*- coding: utf-8 -*-
"""会话管理：加载 cookie、构建 requests.Session、校验登录态。"""

import json
import os

import requests

from config import HEADERS, API, DEBUG, TIMEOUT, throttle, atomic_write_json

# 默认凭据路径以脚本目录为基准的绝对路径，避免从其它 cwd 启动（如 `python cx_crawler/dump.py`）时
# 因相对路径找不到 cookies.json / 把 cookie 写到错误位置（吸收评审 P1-2）。
DEFAULT_COOKIES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.json")


def _restrict_file_perms(path):
    """写后收紧文件权限，降低明文 cookie 被其它用户/进程读取的风险（跨平台尽力而为）。

    类 Unix 下 0o600 限制为仅属主可读写；Windows 下 os.chmod 仅有限生效（主要设置只读位），
    属正常情况，忽略异常即可。真正的防护仍建议：勿将 cookies.json 提交 git、共享机器及时删除。
    """
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def load_cookies(path=DEFAULT_COOKIES_PATH):
    """从 cookies.json 读取，支持三种格式，返回 dict{name: value}。

    支持格式：
      1) list[{name, value, domain}]   —— 标准导出格式
      2) dict{name: value}             —— 简单键值
      3) "k=v; k=v"                    —— 字符串
    """
    if not os.path.exists(path):
        raise FileNotFoundError("找不到 cookies.json，请按 README 格式放置你的登录 cookie")
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    cookies = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                # L6：非 dict 项直接跳过并告警，不再中断整文件加载（审查 L6）。
                print(f"[session] ⚠ cookies.json 列表项非 dict，已跳过: {type(item)}")
                continue
            if "name" in item and "value" in item:
                cookies[item["name"]] = item["value"]
            else:
                # L6：缺 name/value 键的项告警后跳过，而非直接拒绝整文件（审查 L6）。
                print(f"[session] ⚠ cookies.json 列表项缺少 name/value 键，已跳过: {list(item.keys())}")
    elif isinstance(raw, dict):
        for k, v in raw.items():
            cookies[k] = v
    elif isinstance(raw, str):
        for pair in raw.split(";"):
            if "=" in pair:
                k, v = pair.strip().split("=", 1)
                cookies[k] = v
    else:
        raise ValueError("cookies.json 格式无法识别，请检查")

    if DEBUG:
        print(f"[session] 已加载 {len(cookies)} 个 cookie")
    return cookies


def build_session():
    """创建 requests.Session，写入 headers + cookies（自动随请求带上，等同带凭据）。"""
    s = requests.Session()
    s.headers.update(HEADERS)
    s.cookies.update(load_cookies())

    # —— 改进1：Cookie 健康检查 ——
    # 打印已加载的 cookie 名，并核对关键 cookie 是否齐全。
    loaded = [c.name for c in s.cookies]
    if DEBUG:
        print(f"[session] 已加载 cookie 名: {loaded}")
    # rose/route/k8s 在访问 mooc1 域后由服务端下发，需监控其是否存在；
    # UID/_d/jrose/vc3 是核心登录与路由校验字段。
    required = ['UID', '_d', 'jrose', 'vc3', 'rose', 'route', 'k8s']
    missing = [name for name in required if name not in loaded]
    if missing:
        for name in missing:
            print(f"  ⚠ WARNING: 缺少关键 cookie '{name}'，可能导致请求被拒或会话失效")
    else:
        print(f"  ✓ 所有关键 cookie 已加载（{', '.join(required)}）")
    return s


def verify_login(client):
    """登录态校验（阶段1）：调用课程/用户信息接口，确认返回 result==1。

    说明：backclazzdata 接口在已登录时顶层返回 {"result":1, "channelList":[...]}，
    未登录时返回 {"result":0, ...} 或直接回落到登录页 HTML。
    因此以 result==1 作为「登录有效」的硬判据；未命中时再兜底检测登录页关键词。

    v2.3（审查 L4/L5）：改用 ApiClient.get 发起请求，使其与后续请求一致地享有
    限速（throttle）+ 指数退避重试（with_retry）+ DEBUG 日志——避免弱网下一次
    5xx / 网络抖动就直接判「登录校验失败」中断整轮。不再单独调用 throttle()，
    因为 ApiClient.get 内部已限速，重复调用会多等一个限速间隔。
    """
    # ApiClient.get 已内置 throttle() 与 TIMEOUT、且失败时按 5xx 退避重试；
    # 同时落盘 01_courses_raw.json（此前仅在 prefetched 失效走 fallback 才保存）。
    r = client.get(API["courses"], save_raw="01_courses_raw.json")
    text = r.text
    print(f"[verify_login] status={r.status_code}, snippet={text[:300]!r}")

    # 1) 主判据：JSON 解析后确认 result == 1（阶段1 硬性要求）
    try:
        data = r.json()
    except Exception:
        data = {}
    result = data.get("result")
    # 审查 S1：接口可能以字符串 "1" 返回 result，严格 `== 1` 会让字符串 "1" 误判未登录直接 abort。
    # 同时兼容 int 1 与 str "1"。
    if result == 1 or result == "1":
        print("[verify_login] ✓ 登录态有效 (result=1)")
        return r
    # 兼容 result 嵌套在 data 下的返回结构
    if isinstance(data.get("data"), dict) and data["data"].get("result") in (1, "1"):
        print("[verify_login] ✓ 登录态有效 (data.result=1)")
        return r

    # 2) 兜底：检测是否回落到登录页（命中任一即视为失效）
    low = text.lower()
    is_login_fail = (
        (str(result) == "0" and any(kw in text for kw in ("未登录", "请登录", "login")))
        or ("未登录" in text)
        or ("请先登录" in text)
        or (r.status_code == 200 and any(
            kw in low for kw in ("请登录", "请先登录", "login", "重新登录", "未登录")
        ))
    )
    if is_login_fail:
        raise RuntimeError("Cookie 已过期或无效：服务器返回了登录页面")
    raise RuntimeError("Cookie 已过期或无效：登录态校验未通过（result!=1 且无法确认有效登录）")


def save_cookies(s, path=DEFAULT_COOKIES_PATH):
    """将当前 session 的 cookie 持久化回 cookies.json，保留原始格式与字段。

    warmup() 后服务端会下发 rose/route/k8s 等补充 cookie，仅存于内存中，未持久化
    则下次运行时需手动重新导出。本函数在登录校验通过后将刷新后的 cookie 落盘，
    使后续运行可直接复用有效凭据，无需重复手动登录。

    策略：读取原始 JSON 保留格式（list/dict/str），仅更新 value 并追加新增 cookie。
    """
    fresh = {c.name: c.value for c in s.cookies}
    if not fresh:
        if DEBUG:
            print("[session] ⚠ save_cookies: session 无 cookie，跳过持久化")
        return

    # 读取原始文件
    try:
        with open(path, "r", encoding="utf-8") as f:
            original = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        # 文件不存在或损坏 → 新建简单 dict 格式
        atomic_write_json(path, fresh)
        _restrict_file_perms(path)  # 修复#26：写后收紧权限，降低明文泄露风险
        print(f"[session] cookies 已新建并持久化至 {path}（共 {len(fresh)} 个）")
        return

    # 按原始格式合并更新
    if isinstance(original, list):
        updated = False
        for item in original:
            if isinstance(item, dict) and item.get("name") in fresh:
                item["value"] = fresh[item["name"]]
                updated = True
        # 追加 session 中新增的 cookie（原始文件中不存在的）
        known = {item.get("name") for item in original if isinstance(item, dict)}
        for name, value in fresh.items():
            if name not in known:
                original.append({"name": name, "value": value, "domain": "", "path": "/"})
                updated = True
    elif isinstance(original, dict):
        # 简单 dict 格式：直接合并更新
        updated = False
        for k, v in fresh.items():
            if original.get(k) != v:
                original[k] = v
                updated = True
    else:
        # 字符串或其他不可识别格式 → 安全起见覆盖为标准 dict
        original = fresh
        updated = True

    if updated:
        atomic_write_json(path, original)
        _restrict_file_perms(path)  # 修复#26：写后收紧权限，降低明文泄露风险
        print(f"[session] cookies 已持久化至 {path}（共 {len(fresh)} 个）")
    elif DEBUG:
        print("[session] cookies 无变化，跳过写入")


def warmup(s):
    """预热会话：先访问几个入口 URL，让服务器下发/刷新路由与会话 cookie。

    i.chaoxing.com 只下发 spaceFid；mooc1.chaoxing.com 可能下发额外的路由 cookie。
    预热失败不致命（单个 URL 异常仅打印提示），目的是尽量拿到完整凭据。
    """
    urls = [
        "https://i.chaoxing.com/base",
        "https://mooc1.chaoxing.com/mycourse",
    ]
    for u in urls:
        try:
            throttle()  # v2：限速（审查#5）
            r = s.get(u, timeout=TIMEOUT)
            if DEBUG:
                print(f"[warmup] {u} -> {r.status_code}")
        except Exception as e:
            if DEBUG:
                print(f"[warmup] 预热失败 {u}: {e}")
