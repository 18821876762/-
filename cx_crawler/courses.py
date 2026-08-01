# -*- coding: utf-8 -*-
"""课程列表：拉取并解析课程数组，落盘原始与解析结果。"""

from __future__ import annotations

import os

from config import API, OUTPUT_DIR, DEBUG, atomic_write_json, _to_int, logger


def fetch_courses(client: object, prefetched: dict | None = None) -> list[dict]:
    """GET 课程列表接口，按已验证嵌套路径解析，返回 list[dict]。

    改进2：先请求主域名 mooc1-api.chaoxing.com；若该请求非 200 / JSON 解析失败 /
    解析出的课程数组为空，则自动 fallback 到 mooc1.chaoxing.com（同一接口的另一子域）。
    v2.2（#7）：可传入 prefetched（来自 verify_login 的同一接口响应，已确认 result==1），
    直接复用、跳过重复的主域名请求；fallback 仍保留作保险。
    """
    def _parse(r: dict) -> list[dict]:
        data = r.json()
        channel_list = data.get("channelList")
        if channel_list is None:
            channel_list = (data.get("data") or {}).get("channelList")
        if not isinstance(channel_list, list):
            channel_list = []
        return channel_list

    r = None
    channel_list = []
    if prefetched is not None:
        try:
            channel_list = _parse(prefetched)
            r = prefetched
            logger.info("[courses] 复用 verify_login 的课程列表响应，跳过重复请求")
        except Exception as e:
            if DEBUG:
                logger.debug(f"[courses] 复用响应解析失败，改重新请求: {e}")
            channel_list = []
    if r is None or not channel_list:
        try:
            r = client.get(API["courses"], save_raw="01_courses_raw.json")
            channel_list = _parse(r)
        except Exception as e:
            channel_list = []
            if DEBUG:
                logger.debug(f"[courses] 主域名解析失败: {e}")

    # fallback 条件：请求异常、非 200、或课程数组为空
    if r is None or r.status_code != 200 or not channel_list:
        logger.warning("  ⚠ mooc1-api 失败，尝试 fallback 到 mooc1.chaoxing.com...")
        fb_url = API["courses"].replace("mooc1-api.chaoxing.com", "mooc1.chaoxing.com")
        try:
            r = client.get(fb_url, save_raw="01_courses_raw.json")
            channel_list = _parse(r)
            logger.info("  ✓ fallback 成功，使用 mooc1.chaoxing.com")
        except Exception as e:
            if DEBUG:
                logger.debug(f"[courses] fallback 也失败: {e}")
            channel_list = []

    # 已验证嵌套（逐 channel 解析 course 与 clazzid）：
    #   channel.content.course.data[0] = {id, name}
    #   真实 clazzid：channel.key（优先）或 channel.content.id
    #     —— channel.id 常为 0（无效），会导致后续章节抓取取不到 knowledgeId。
    #   cpi（personId）：channel.content.cpi
    courses = []
    for ch in channel_list:
        # 类型守卫（审查）：接口可能把 channel 元素 / content / course 返回成非 dict（如 list），
        # 直接 .get 会抛 AttributeError 并上抛到 dump.py 被吞掉 → 整表静默判空。逐层兜底，单条异常不中断全表。
        if not isinstance(ch, dict):
            if DEBUG:
                logger.debug(f"[courses] 跳过非 dict 的 channel 元素: {type(ch)}")
            continue
        content = ch.get("content")
        if not isinstance(content, dict):
            content = {}
        # 修复：真实 clazzid 优先取 ch.key，其次取 content.id（ch.id 常为 0，无效）
        clazzid = ch.get("key")
        if clazzid is None:
            clazzid = content.get("id")
        cpi = content.get("cpi")
        course_raw = content.get("course")
        if not isinstance(course_raw, dict):
            course_raw = {}
        course = course_raw.get("data", [{}]) or [{}]
        if isinstance(course, list):
            course = course[0] if course else {}
        if not isinstance(course, dict):
            course = {}
        course_name = course.get("name")
        courseid = course.get("id")

        # R2：关键 id 缺失时跳过。clazzid/courseid 为 None 会经 .format(...) 把字符串 "None"
        # 拼进章节 URL（chapters.py 的 NODE_URL），导致章节请求失真、knowledgeId 取不到，整课静默空跑。
        if clazzid is None or courseid is None:
            if DEBUG:
                logger.debug(f"[courses] 跳过缺少关键 id 的课程: name={course_name} "
                      f"clazzid={clazzid} courseid={courseid} cpi={cpi}")
            continue

        # O1：clazzid 类型归一化。ch.key / content.id 偶发返回非数字（list/dict/带杂质字符串），
        # 非 None 会绕过上面的 R2 守卫，经 .format 拼进章节 URL 造成请求失真、单课静默空跑。
        # courseid 在 dump.py 白名单过滤处已做 _to_int，此处一并归一化，保证落盘类型一致。
        clazzid_int = _to_int(clazzid)
        courseid_int = _to_int(courseid)
        if clazzid_int is None or courseid_int is None:
            if DEBUG:
                logger.debug(f"[courses] 跳过 id 非数值的课程: name={course_name} "
                      f"clazzid={clazzid!r} courseid={courseid!r}")
            continue
        clazzid, courseid = clazzid_int, courseid_int

        courses.append({
            "course_name": course_name,
            "courseid": courseid,
            "clazzid": clazzid,
            "cpi": cpi,
            "imageurl": course.get("imageurl"),
        })
        logger.info(f"课程: {course_name} | cid={courseid} | clazzid={clazzid} | cpi={cpi}")

    atomic_write_json(os.path.join(OUTPUT_DIR, "01_courses_parsed.json"), courses)  # v2：原子写
    return courses
