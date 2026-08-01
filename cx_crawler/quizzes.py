# -*- coding: utf-8 -*-
"""作业/测验：拉取题目，尝试多种路径提取题目数组（只读，不自动作答）。"""

import os

from config import API, OUTPUT_DIR, atomic_write_json


def fetch_quiz(client, jobid, courseid, clazzid):
    """GET 作业接口，尝试多种路径提取题目数组；提取不到则打印顶层 keys 并保存原始 JSON。"""
    url = API["quiz"].format(jobid=jobid, cid=courseid, clazzid=clazzid)
    r = client.get(url, save_raw=f"04_quiz_{jobid}.json")

    try:
        data = r.json()
    except Exception as e:
        print(f"[quiz] JSON 解析失败: {e}")
        data = {}

    questions = _extract_questions(data)
    if questions is None:
        keys = list(data.keys()) if isinstance(data, dict) else type(data)
        print(f"[quiz] 未提取到题目，顶层 keys: {keys}")
        atomic_write_json(os.path.join(OUTPUT_DIR, f"04_quiz_{jobid}_raw.json"), data)  # v2：原子写
        return []

    for q in questions[:3]:
        qtype = q.get("type") or q.get("questionType") or q.get("typeName")
        stem = (q.get("title") or q.get("stem") or q.get("content") or q.get("q") or "")[:80]
        print(f"[quiz] 题型={qtype} | 题干前80字: {stem}")

    return questions


def _extract_questions(data):
    """按多种常见路径尝试提取题目数组。"""
    if not isinstance(data, dict):
        return None
    candidates = [
        data.get("questions"),
        (data.get("data") or {}).get("questions"),
        (data.get("data") or {}).get("list"),
        data.get("list"),
        (data.get("data") or {}).get("data", {}).get("questions") if isinstance(data.get("data"), dict) else None,
    ]
    for c in candidates:
        if isinstance(c, list):
            return c
    return None
