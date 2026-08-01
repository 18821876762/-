# -*- coding: utf-8 -*-
"""章节/任务点：从章节树 AJAX 接口拉取 HTML 片段，多路正则提取 knowledgeId（阶段5）。

阶段5 要点：
  1) studentstudycourselist 需要「有效的 chapterId 种子」才返回完整树；传 "0" 或
     随机时间戳只会返回 1 个默认章节 / 空数据。因此：
       - 优先用调用方传入的有效 seed；
       - 否则从 mooc2-ans 课程页 (studentcourse) 的 HTML 中抠一个真实 chapterId 作种子；
       - 仍取不到时，用 "0" 拉一次，从返回片段里抠出任意 knowledgeId 当有效种子再重拉；
       - 最终取「章节数最多」的那次响应作为完整章节树。
  2) knowledgeId 在返回 HTML 中以多种形态存在，需用「多路、有序」正则全部覆盖，
     确保不漏掉任何章节节点。

任务点（阶段6 修正）：
  实测发现 visitnodedetail 接口（node_detail）现已返回 HTML 空壳（任务点由页面 JS
  动态渲染到 iframe 的 objectid 上，静态 HTML 中不含 jobid/objectId），故 JSON 解析
  路径已失效。可靠的「任务点快照」直接来自章节树 HTML 本身：每个 id="cur{kid}" 节点
  自带章节序号、标题、未完成任务点数（jobUnfinishCount）、完成态（icon_Completed）。
  因此本模块改为解析章节树 HTML 产出每章任务点状态，不再逐节点调 node_detail。
"""

from __future__ import annotations

import json
import os
import re
import time

from config import API, OUTPUT_DIR, HEADERS, TIMEOUT, DEBUG, atomic_write_text, logger, write_tasks_snapshot


# 阶段5：knowledgeId / chapterId 在 HTML 中的真实存在形态（按顺序覆盖）。
# 顺序只影响「挑选种子」的优先级与可读性；提取用 set 做并集，故顺序本身不丢数据。
# 修复 #8：预编译全部正则（原 ID_PATTERNS 为原始字符串，extract_knowledge_ids 每次调用
# 都对 8 条逐一 re.findall 重新编译，属热路径上的重复开销）。统一预编译并带上 re.I，
# findall 不再重复传 flag。
ID_PATTERNS = [
    # 1) 一级章节容器：class="firstLayer" id="{digit}"（最可能是顶层/根节点）
    re.compile(r'class=["\']?firstLayer["\']?[^>]*\bid=["\']?(\d{6,})', re.I),
    # 2) 当前章节容器：id="cur{digit}"
    re.compile(r'id=["\']?cur(\d{6,})', re.I),
    # 3) 教师接口：getTeacherAjax('cid','clazzid','kid') —— 第 3 个参数为 knowledgeId
    #    （兼容带引号与不带引号两种写法）
    re.compile(r'getTeacherAjax\([^,)]*,\s*[^,)]*,\s*["\']?(\d{6,})', re.I),
    # 4) toOld(courseid, kid, clazzid) —— 第 2 个参数为 knowledgeId（兼容带引号）
    re.compile(r'toOld\s*\(\s*["\']?\d+["\']?\s*,\s*["\']?(\d{6,})', re.I),
    # 5) data 属性：data-knowledgeid / data-chapterid
    re.compile(r'data-(?:knowledge|chapter)id\s*=\s*["\']?(\d{6,})', re.I),
    # 6) URL 参数：?chapterId= / &knowledgeId=
    re.compile(r'(?:chapter|knowledge)Id=(\d{6,})', re.I),
    # 7) JSON 属性："knowledgeId":数字 / "chapterId":数字（兼容带引号）
    re.compile(r'(?:knowledgeId|chapterId)["\']?\s*:\s*["\']?(\d{6,})', re.I),
    # 8) 通用 data-id（章节块），要求较长避免时间戳误伤
    re.compile(r'<[^>]+data-id=["\']?(\d{8,})', re.I),
]


def extract_knowledge_ids(html_fragment: str) -> set[str]:
    """多路正则提取 knowledgeId 并集（阶段5）。"""
    ids = set()
    for p in ID_PATTERNS:
        ids.update(p.findall(html_fragment))
    return ids


# 审查 L3：种子兜底不应取「数值最小 id」（chapterId 不保证按数值顺序，最小 id 未必是根/第一节），
# 改为取「文档中首次出现」的 id（最可能是顶层/根节点）。用单一正则按优先级顺序 search，
# 命中 firstLayer > cur > 其余形态，返回文档顺序上的第一个候选。
_SEED_FALLBACK_RE = re.compile(
    r'class=["\']?firstLayer["\']?[^>]*\bid=["\']?(\d{6,})'       # 1) 一级章节容器（根/顶层）
    r'|id=["\']?cur(\d{6,})'                                       # 2) 当前章节容器
    r'|getTeacherAjax\([^,)]*,\s*[^,)]*,\s*["\']?(\d{6,})'         # 3) 教师接口第3参
    r'|toOld\s*\(\s*["\']?\d+["\']?\s*,\s*["\']?(\d{6,})'          # 4) toOld 第2参
    r'|data-(?:knowledge|chapter)id\s*=\s*["\']?(\d{6,})'          # 5) data 属性
    r'|(?:chapter|knowledge)Id=(\d{6,})'                           # 6) URL 参数
    r'|(?:knowledgeId|chapterId)["\']?\s*:\s*["\']?(\d{6,})'        # 7) JSON 属性
    r'|<[^>]+data-id=["\']?(\d{8,})',                              # 8) 通用 data-id
    re.I,
)


def _first_seed_id(html_fragment):
    """返回文档中首次出现的 knowledgeId（按 ID_PATTERNS 优先级，取文档顺序第一个）。

    审查 L3：以「文档顺序首个」替代「数值最小」，更可能命中根/顶层章节，避免误选非根节点。
    """
    m = _SEED_FALLBACK_RE.search(html_fragment)
    if not m:
        return None
    for grp in m.groups():
        if grp:
            return grp
    return None


def extract_seed_chapter_id(html_fragment: str) -> str | None:
    """从章节树片段里挑一个「有效的」chapterId 作种子（阶段5 优先级）。

    优先取一级章节 firstLayer 的 id（最可能是根/顶层），其次 cur，再次取文档中
    「首次出现」的 knowledgeId（审查 L3：不再取数值最小的 id，因 chapterId 不保证
    按数值顺序，最小 id 未必是根/第一节）。返回字符串或 None。
    """
    m = re.search(r'class=["\']?firstLayer["\']?[^>]*\bid=["\']?(\d{6,})', html_fragment, re.I)
    if m:
        return m.group(1)
    m = re.search(r'id=["\']?cur(\d{6,})', html_fragment, re.I)
    if m:
        return m.group(1)
    return _first_seed_id(html_fragment)


def extract_course_unfinish(html_fragment):
    """从章节树顶部的 _studystate 隐藏域提取课程级未完成任务点总数。"""
    m = re.search(r'id=["\']?_studystate["\']?[^>]*value=["\']?[^"\']*unfinishCount:(\d+)', html_fragment, re.I)
    return int(m.group(1)) if m else None


def _extract_seed_from_studentcourse(html_text):
    """从 mooc2-ans 课程页 HTML 里抠一个真实 chapterId 作种子（阶段5 引导）。"""
    # 课程页含链接形如 ...&chapterId=数字 或 knowledgeId=数字
    m = re.search(r'(?:chapter|knowledge)Id=(\d{6,})', html_text, re.I)
    if m:
        return m.group(1)
    m = re.search(r'id=["\']?cur(\d{6,})', html_text, re.I)
    if m:
        return m.group(1)
    return None


def build_chapter_headers(courseid, clazzid, cpi, seed):
    """按实测抓包构造章节树请求头（模块级，供 fetch_chapter_tree 与诊断复用）：
    - Accept: text/html（接口返回 text/html 片段）
    - X-Requested-With: XMLHttpRequest（AJAX 必需）
    - Referer: 播放页 studentstudy?chapterId={seed}...（实测 Referer 校验必需，
      且 Referer 里的 chapterId 需与请求的 seed 一致）
    """
    h = dict(HEADERS)
    h["Accept"] = "text/html, */*; q=0.01"
    h["X-Requested-With"] = "XMLHttpRequest"
    h["Referer"] = API["studentstudy"].format(
        cid=courseid, clazzid=clazzid, cpi=cpi, seed=seed
    )
    return h


# 阶段6 修正：任务点直接来自章节树 HTML 的 id="cur{kid}" 节点。
_NODE_RE = re.compile(r'(?=<div[^>]*\bid=["\']?cur\d{6,})', re.I)


def parse_chapter_tasks(html_fragment: str, courseid: int, clazzid: int, cpi: int) -> list[dict]:
    """从章节树 HTML 解析每章任务点快照（阶段6 修正）。

    每个 id="cur{kid}" 叶子章节节点自带：
      - 序号 <em class="posCatalog_sbar">1.1</em>
      - 标题 title="..."
      - 未完成数 <input ... class="jobUnfinishCount" value="N"/>
      - 完成态 <span class="icon_Completed">已完成</span>
    返回 list[dict]，字段为静态 HTML 可稳定获取者；jobid/objectId/type 需 JS 渲染，
    此处置 None（合规只读，不伪造、不渲染）。
    """
    tasks = []
    chunks = _NODE_RE.split(html_fragment)
    for ch in chunks:
        m = re.search(r'\bid=["\']?cur(\d{6,})', ch, re.I)
        if not m:
            continue
        kid = m.group(1)

        idx = re.search(r'posCatalog_sbar[^>]*>([^<]*)<', ch)
        index = idx.group(1).strip() if idx else ""

        ttl = re.search(r'posCatalog_name[^>]*title=["\']([^"\']*)["\']', ch, re.I)
        title = ttl.group(1).strip() if ttl else ""
        if not title:
            ttl2 = re.search(r'posCatalog_name[^>]*>.*?>([^<]+)', ch, re.S)
            title = ttl2.group(1).strip() if ttl2 else ""

        # jobUnfinishCount 输入的顺序不固定（可能 value 在前或 class 在前），
        # 先抠出整个 <input ... jobUnfinishCount ...> 标签，再从中取 value（顺序无关）。
        inp = re.search(r'<input[^>]*jobUnfinishCount[^>]*>', ch, re.I)
        unfinished = 0
        if inp:
            vf = re.search(r'value=["\']?(\d+)', inp.group(0), re.I)
            if vf:
                unfinished = int(vf.group(1))

        has_tp = ('jobUnfinishCount' in ch) or ('icon_Completed' in ch) or ('catalog_points_yi' in ch)

        # 修复 M2：完成态仅以显式 icon_Completed 标记为准，杜绝「任务点未渲染出未完成数
        # (unfinished 默认 0) → 误判为已完成」的假完成。
        #   - 显式含 icon_Completed：completed = True
        #   - 无 icon_Completed 但确有未完成数字段(jobUnfinishCount 标签存在)：completed = False
        #   - 无 icon_Completed 且未完成数字段缺失：completed = None（未知，不臆测）
        if 'icon_Completed' in ch:
            completed = True
        elif inp is not None:
            completed = False
        else:
            completed = None

        if not (title or has_tp):
            continue

        tasks.append({
            "knowledgeId": kid,
            "index": index,
            "title": title,
            "unfinishedCount": unfinished,
            "completed": completed,
            "hasTaskPoints": bool(has_tp),
            # 以下字段需 JS 渲染 iframe 才能获取，静态 HTML 不可得，置 None（合规只读）
            "jobid": None,
            "objectId": None,
            "type": None,
            # 透传课程上下文，供后续心跳探测/作业拉取使用
            "courseid": courseid,
            "clazzid": clazzid,
            "cpi": cpi,
        })
    return tasks


def fetch_chapter_tree(client, courseid, clazzid, cpi, seed_kid=None):
    """返回任务点数组 list[dict]，保存章节树 HTML / 汇总 JSON。

    阶段5 种子策略见模块 docstring：逐个尝试所有候选种子，取「knowledgeId 最多」的
    响应作为完整章节树（修复旧逻辑在引导种子只返 1 章时提前返回的问题）。
    任务点来自章节树 HTML 解析（阶段6 修正），不再逐节点调 node_detail。
    """
    best_html, best_ids = "", set()

    def _get_chapter_list(seed):
        url = API["chapter_list"].format(
            cid=courseid, clazzid=clazzid, cpi=cpi, seed=seed
        )
        # v2.2：复用 ApiClient.get（#6）——获得与全局一致的限速、重试、DEBUG 日志与
        # 统一落盘开关（SAVE_ALL_RAW 控制），不再手写直连请求而绕过封装。
        # 章节树用自定义 XHR 头，故通过 headers 参数注入。
        return client.get(url, headers=build_chapter_headers(courseid, clazzid, cpi, seed))

    def _try_seed(seed, save_as):
        nonlocal best_html, best_ids
        r = _get_chapter_list(seed)
        html = r.text
        ids = extract_knowledge_ids(html)
        # 修复审查#2：仅当本响应成为「章节数最多」的最优响应时才落盘 canonical 文件，
        # 保证磁盘上的 02_chapter_list_{courseid}.html 永远等于最终用于解析的 best_html，
        # 避免后一次 id 较少的种子覆盖磁盘文件、导致与解析出的任务点对不上（误导排错）。
        if len(ids) > len(best_ids):
            best_ids, best_html = ids, html
            atomic_write_text(os.path.join(OUTPUT_DIR, save_as), html)  # v2：原子写（审查#1）
        return ids

    # 步骤1：优先使用调用方传入的有效种子（非 0/空）
    initial_seed = None
    if seed_kid and str(seed_kid) not in ("0", "", "null"):
        initial_seed = str(seed_kid)
    else:
        # 步骤2：从 mooc2-ans 课程页引导出真实 chapterId 作种子
        try:
            sc_url = API["studentcourse"].format(
                cid=courseid, clazzid=clazzid, ts=int(time.time() * 1000)
            )
            sc_r = client.get(sc_url, save_raw=f"02_studentcourse_{courseid}.html")
            sc_seed = _extract_seed_from_studentcourse(sc_r.text)
            if sc_seed:
                initial_seed = sc_seed
                logger.info(f"[chapters] 阶段5：从课程页引导到种子 chapterId={sc_seed}")
        except Exception as e:
            if DEBUG:
                logger.debug(f"[chapters] 课程页引导种子失败: {e}")

    # 步骤3：逐个尝试所有候选种子，取 knowledgeId 最多的响应（不再提前 break）。
    # 实测 seed="0" 在带正确 Referer 时可返回完整树（数百个 id），故始终作为兜底候选。
    seeds_to_try = []
    if initial_seed:
        seeds_to_try.append(initial_seed)
    seeds_to_try.append("0")

    # 说明（#11）：迭代用 list(seeds_to_try) 快照，故循环体内的 append 不会让本轮回环；
    # 新派生的种子靠「内联 _try_seed(derived)」立即尝试，而非依赖循环迭代。功能正确、不会死循环。
    for seed in list(seeds_to_try):
        _try_seed(seed, f"02_chapter_list_{courseid}.html")
        derived = extract_seed_chapter_id(best_html)
        if derived and derived not in seeds_to_try:
            seeds_to_try.append(derived)
            _try_seed(derived, f"02_chapter_list_{courseid}.html")

    logger.info(f"[chapters] 阶段5：章节树提取到 knowledgeId={len(best_ids)}个")

    if not best_ids:
        logger.debug(f"[chapters][调试] 章节树为空，HTML 片段前 200 字:\n{best_html[:200]}")

    # 阶段6 修正：任务点直接来自章节树 HTML 解析（不再依赖 node_detail JSON）
    tasks = parse_chapter_tasks(best_html, courseid, clazzid, cpi)

    course_unfinish = extract_course_unfinish(best_html)
    if course_unfinish is not None:
        logger.info(f"[chapters] 课程级未完成任务点总数: {course_unfinish}")

    write_tasks_snapshot(courseid, tasks)  # 带 __status__=complete 完成标记（吸收评审 P1-1）；原子写

    total = len(tasks)
    completed = sum(1 for t in tasks if t.get("completed"))
    unfinished_sum = sum(t.get("unfinishedCount", 0) for t in tasks)
    logger.info(f"[chapters] 任务点章节 {total} 个，已完成 {completed} 个，"
          f"未完成计数合计 {unfinished_sum}")
    return tasks
