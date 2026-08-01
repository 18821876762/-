# -*- coding: utf-8 -*-
"""心跳接口分析（只读探测）：构造一次 enc 留空的 GET 探测，观察服务器报错以反推签名规则。

⚠️ 合规声明：本模块仅做"读取/观察"用途——
  - 仅发送 GET 探测，绝不 POST 上报任何播放进度；
  - reverse_enc() 只打印候选哈希，不验证、不用于生成可上报的合法 enc。
切勿用本文件产出去伪造学习记录。
"""

import hashlib
import os

from config import API, OUTPUT_DIR, logger

# 常见签名盐（来自前人经验，仅供本模块分析参数规则，不验证、不用于伪造）
_SALT = "d_yHJ!$pdA~5"


def analyze_heartbeat_params(task, client):
    """用 task 的 jobid/objectId/duration 构造一次 GET 探测，enc 留空观察报错。

    兼容两种数据源：
    - 渲染回填：dump.py RENDER_JOBS 写入 jobids/objectids（复数 list，取首个）
    - 静态/quiz 任务：别处写入 jobid/objectId（单数标量）
    """
    jobid = task.get("jobid")
    if not jobid:
        ids = task.get("jobids") or []
        jobid = ids[0] if ids else None
    objectid = task.get("objectId")
    if not objectid:
        ids = task.get("objectids") or []
        objectid = ids[0] if ids else None
    # v2：静态路径下 jobid/objectId 恒为 None，缺参探测无意义，直接跳过（审查#10 心跳跳空）
    if not jobid or not objectid:
        logger.info("[heartbeat] 跳过：任务点缺 jobid/objectId（静态路径未渲染），无法构造有效探测")
        return None
    duration = task.get("duration") or 0

    # userid/dtoken 来源未知，先尝试从 session cookie 取 UID，dtoken 占位
    userid = client.s.cookies.get("UID", "0") if hasattr(client.s, "cookies") else "0"
    dtoken = "0"  # dtoken 需从播放页或 multimedia 接口获取，这里占位；不影响"观察报错"目的

    base = API["heartbeat"].format(userid=userid, dtoken=dtoken)
    params = {
        "jobid": jobid,
        "objectid": objectid,
        "playingTime": 30,
        "duration": duration,
        "isdrag": 0,
        "enc": "",  # 故意留空，反推签名算法
        "clazzId": task.get("clazzid"),
        "courseId": task.get("courseid"),
    }

    r = client.get(base, params=params, save_raw=f"04_heartbeat_{jobid}.json")
    logger.info(f"[heartbeat] 响应前500字:\n{r.text[:500]}")

    # 仅打印候选 enc（不验证、不上报）
    reverse_enc(task)
    return r


def reverse_enc(task):
    """打印两种常见 MD5 签名模式的候选值。仅用于分析参数构造，不验证正确性。

    兼容两种数据源（同 analyze_heartbeat_params）。
    """
    jobid = task.get("jobid")
    if not jobid:
        ids = task.get("jobids") or []
        jobid = ids[0] if ids else None
    objectid = task.get("objectId")
    if not objectid:
        ids = task.get("objectids") or []
        objectid = ids[0] if ids else None
    playing_time = 30
    duration = task.get("duration") or 0

    base_str = f"{jobid}{objectid}{playing_time}{duration}"
    cand_no_salt = hashlib.md5(base_str.encode("utf-8")).hexdigest()
    cand_salt = hashlib.md5((base_str + _SALT).encode("utf-8")).hexdigest()

    logger.info("[reverse_enc][分析] 候选 enc（未验证，仅供研究参数规则，禁止用于上报假进度）:")
    logger.info(f"  无盐模式: {cand_no_salt}")
    logger.info(f"  带盐模式({_SALT}): {cand_salt}")
