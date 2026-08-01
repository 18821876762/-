# -*- coding: utf-8 -*-
"""API 客户端：统一封装 GET / GET-JSON / POST，可选保存原始响应到 output/。"""

import os
import uuid

from config import (DEBUG, OUTPUT_DIR, SAVE_ALL_RAW, TIMEOUT, throttle,
                    atomic_write_text, with_retry, logger)


class AuthExpiredError(Exception):
    """登录态失效，需要重新登录（fid、UID、_d 等关键 cookie 缺失或过期）。"""
    pass


# 关键原始文件前缀：即使 SAVE_ALL_RAW=False 也始终保存（课程列表 01_、任务点汇总 03_）。
_KEY_RAW_PREFIXES = ("01_", "03_")


def _should_save(save_raw):
    """根据 SAVE_ALL_RAW 开关与文件名前缀，判断本次响应是否落盘。

    - save_raw 为 None            -> 不保存
    - SAVE_ALL_RAW 为 True       -> 保存
    - SAVE_ALL_RAW 为 False      -> 仅当文件名以 "01_" / "03_" 开头时保存
    """
    if not save_raw:
        return False
    if SAVE_ALL_RAW:
        return True
    return os.path.basename(save_raw).startswith(_KEY_RAW_PREFIXES)


# v2.2：网络请求包指数退避重试（#6）。
# 关键修复：
#   - throttle() 移到这里（#5）：每次「实际请求」都受限速约束，含重试，避免重试突发打向服务器。
#   - 5xx 主动 raise_for_status（#4）：requests 默认对 4xx/5xx 不抛，导致重试只在网络层生效；
#     仅对 status>=500 抛（4xx 视为客户端错误，不重试），让退避真正覆盖服务端瞬时错误。
@with_retry()
def _http_get(session, url, params=None, headers=None):
    throttle()
    r = session.get(url, params=params, headers=headers, timeout=TIMEOUT)
    if r.status_code >= 500:
        r.raise_for_status()
    return r

@with_retry()
def _http_post(session, url, data=None, headers=None):
    throttle()
    r = session.post(url, data=data, headers=headers, timeout=TIMEOUT)
    if r.status_code >= 500:
        r.raise_for_status()
    return r


class ApiClient:
    def __init__(self, session):
        self.s = session
        os.makedirs(OUTPUT_DIR, exist_ok=True)

    def get(self, url, params=None, save_raw=None, headers=None):
        """发 GET。save_raw 指定文件名时，按 SAVE_ALL_RAW 开关决定是否落盘。"""
        rid = uuid.uuid4().hex[:8]
        r = _http_get(self.s, url, params=params, headers=headers)
        logger.debug(f"[{rid}] GET {r.url} -> {r.status_code} ({len(r.content)} bytes)")
        if r.status_code in (401, 403):
            raise AuthExpiredError(
                f"HTTP {r.status_code}：登录态可能已失效（cookie 过期或被风控拦截）。"
                f" 请重新从浏览器导出 cookies.json，或改密/踢设备后重试。"
            )
        if _should_save(save_raw):
            p = os.path.join(OUTPUT_DIR, save_raw)
            atomic_write_text(p, r.text)  # v2：原子写（审查#1）
            logger.debug(f"[{rid}] 原始响应已保存: {p}")
        return r

    def post(self, url, data=None, save_raw=None, headers=None):
        """发 POST 并保存响应（仅供读取类 POST 使用，绝不用于提交答案/上报进度）。"""
        rid = uuid.uuid4().hex[:8]
        r = _http_post(self.s, url, data=data, headers=headers)
        body = str(data)[:200] if data else ""
        logger.debug(f"[{rid}] POST {r.url} -> {r.status_code} (body摘要: {body})")
        if r.status_code in (401, 403):
            raise AuthExpiredError(
                f"HTTP {r.status_code}：登录态可能已失效（cookie 过期或被风控拦截）。"
                f" 请重新从浏览器导出 cookies.json，或改密/踢设备后重试。"
            )
        if _should_save(save_raw):
            atomic_write_text(os.path.join(OUTPUT_DIR, save_raw), r.text)  # v2：原子写（审查#1）
        return r
