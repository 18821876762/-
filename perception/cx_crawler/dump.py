# -*- coding: utf-8 -*-
"""主流程：登录校验 → 课程（白名单过滤）→ 章节任务点 → 心跳探测 → 作业拉取 → 生成 README。

所有步骤包裹 try-catch，单步失败打印错误并继续，不会整体崩溃。
读取优先、绝不提交/修改任何平台数据。
v2.1：断点续跑（#8）+ 陈旧清理（#4）+ 结构化日志/trace_id（#11）。
"""

import os
import re
import json
import atexit

from config import (OUTPUT_DIR, RENDER_JOBS, RENDER_CONCURRENCY,
                    VERSION, RunLock, atomic_write_text, atomic_write_json,
                    MIN_INTERVAL, FORCE_RERUN, logger, ACTIVE_COURSE_IDS, _to_int,
                    write_tasks_snapshot)
from session import build_session, verify_login, warmup, load_cookies, save_cookies
from api_client import ApiClient, AuthExpiredError
from courses import fetch_courses
from chapters import fetch_chapter_tree
from heartbeat import analyze_heartbeat_params
from quizzes import fetch_quiz

# v2.2：render 改为惰性导入（#1）——顶层不再 import render，避免 playwright 成为硬依赖。
# 仅当 RENDER_JOBS=True 且真正进入渲染分支时才 import，未装 playwright 时不影响默认模式启动。
_render_mod = None


def _import_render():
    global _render_mod
    if _render_mod is None:
        try:
            from render import render_course_taskpoints, infer_type
        except ImportError as e:
            raise RuntimeError(
                "开启 RENDER_JOBS=True 但需要 playwright，请先 pip install playwright "
                "并执行 playwright install msedge（或设 RENDER_JOBS=False）"
            ) from e
        _render_mod = (render_course_taskpoints, infer_type)
    return _render_mod

# 活跃课程白名单已外置到 config.ACTIVE_COURSE_IDS（审查#1）：
# 由 perception/cx_crawler/courses.json（或从 courses.example.json 复制改名）或环境变量 CX_COURSE_IDS 提供，
# 不再写死在源码里。空集合 = 处理全部课程。


def _load_done_tasks(output_dir):
    """从已有 03_tasks_{cid}.json 读回已完成课程任务点，作为断点续跑依据（审查#8）。

    仅当快照带 __status__=complete 标记且 tasks 非空时才视为「完整断点」（吸收评审 P1-1）；
    无标记/标记缺失的旧文件视为不可信，重新抓取以校验完整性，避免把中途异常产出的非空
    list 当成完整结果而静默漏抓章节。
    """
    done = {}
    try:
        names = os.listdir(output_dir)
    except OSError:
        return done
    for fn in names:
        m = re.match(r"03_tasks_(\d+)\.json$", fn)
        if not m:
            continue
        cid = int(m.group(1))
        try:
            with open(os.path.join(output_dir, fn), "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue
        # 吸收评审 P1-1：仅信任带 __status__=complete 标记的快照
        if isinstance(data, dict) and data.get("__status__") == "complete":
            tasks = data.get("tasks")
            if isinstance(tasks, list) and tasks:
                done[cid] = tasks
            # 标记完整但 tasks 为空 -> 不视为断点，重新抓取
        elif isinstance(data, list) and data:
            # 旧格式（无标记）：不信任，重新抓取
            logger.warning(f"[resume] {fn} 缺少 __status__=complete 标记（旧格式），将重新抓取以校验完整性")
    return done


def _clean_stale(active_ids):
    """清理白名单外课程的章节级输出（02_*/03_*_{cid}），避免改白名单后旧文件误导（审查#4）。

    仅删除带 cid 的章节级文件（02_chapter_list / 02_studentcourse / 02_scripts / 03_tasks），
    不动 01_（全局课程列表）与 04_*（心跳/作业，按 jobid 命名、cid 无关）。
    """
    removed = 0
    try:
        names = os.listdir(OUTPUT_DIR)
    except OSError:
        return removed
    for fn in names:
        m = re.match(r"^(02|03)_.*_(\d+)\.(html|json|txt)$", fn)
        if not m:
            continue
        cid = int(m.group(2))
        if cid in active_ids:
            continue
        try:
            os.remove(os.path.join(OUTPUT_DIR, fn))
            removed += 1
            logger.info(f"[clean] 删除陈旧输出: {fn}")
        except OSError as e:
            logger.warning(f"[clean] 删除失败 {fn}: {e}")
    return removed


# courseid 归一化统一走 config._to_int（审查#4：消除与 courses.py 的重复实现）

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # v2：跨进程运行锁，避免多个实例并发写同一 OUTPUT_DIR 造成损坏/互盖（审查#2）
    lock = RunLock(os.path.join(OUTPUT_DIR, ".runlock"))
    try:
        lock.acquire()
    except RuntimeError as e:
        logger.error(f"[FATAL] {e}")
        return
    atexit.register(lock.release)  # 正常退出或异常均释放锁
    logger.info(f"v{VERSION} 启动（限速间隔={MIN_INTERVAL}s，断点续跑={'关' if FORCE_RERUN else '开'}，输出目录={OUTPUT_DIR}）")

    # 1. 构建会话 + 校验登录
    try:
        s = build_session()
    except Exception as e:
        logger.error(f"[FATAL] 构建 session 失败: {e}")
        return
    try:
        warmup(s)
    except Exception as e:
        logger.warning(f"[WARN] 会话预热失败（不致命）: {e}")
    client = ApiClient(s)
    try:
        verify_resp = verify_login(client)
    except AuthExpiredError as e:
        logger.error(f"[FATAL] 登录态失效：{e}")
        return
    except Exception as e:
        logger.error(f"[ERROR] 登录校验失败: {e}")
        return

    # 登录校验通过后，将 warmup 刷新的 rose/route/k8s 等补充 cookie 持久化，
    # 避免下次运行时因 cookie 过期需手动重新导出。
    try:
        save_cookies(s)
    except Exception as e:
        logger.warning(f"[WARN] 保存 cookies 失败（不致命）: {e}")

    # 2. 课程列表（复用 verify_login 的同一接口响应，避免重复请求，#7）
    try:
        all_courses = fetch_courses(client, prefetched=verify_resp)
    except Exception as e:
        logger.error(f"[ERROR] 获取课程列表失败: {e}")
        all_courses = []

    # 白名单过滤：只处理活跃课程。
    # v2.2：courseid 可能是 str（部分接口以字符串返回数字 id），统一归一化为 int 再比较（#3），
    # 避免字符串 "265306897" 在 int 集合里查不到导致静默空跑。
    courses = [c for c in all_courses
               if _to_int(c.get("courseid")) in ACTIVE_COURSE_IDS]
    # 审查#1：白名单为空（courses.json / CX_COURSE_IDS 均缺失）时处理全部课程，明确提示避免误以为被过滤
    if not ACTIVE_COURSE_IDS:
        logger.warning("[filter] 未配置课程白名单（perception/cx_crawler/courses.json 与 环境变量 CX_COURSE_IDS 均缺失），"
                       "将处理全部课程")
    logger.info(f"[filter] 共扫描 {len(all_courses)} 门课，筛选出 {len(courses)} 门活跃课程")

    if not courses:
        logger.warning("[WARN] 无活跃课程数据，流程结束")
        return

    # 3. 逐门课拉取章节任务点（某门失败不中断整体流程）
    #    阶段5：不再传时间戳/"0" 作种子，改为传 None 由 chapters 自行引导有效 seed。
    #    v2.1：断点续跑——已有 03_tasks_{cid}.json 且非空的课程直接复用，跳过网络抓取（审查#8）。
    all_tasks = []
    done = _load_done_tasks(OUTPUT_DIR) if not FORCE_RERUN else {}
    for ch in courses:
        cid = _to_int(ch.get("courseid"))
        clazzid = ch.get("clazzid")
        cpi = ch.get("cpi", "")
        if cid in done and not FORCE_RERUN:
            logger.info(f"[resume] 课程 {cid} 已有断点（{len(done[cid])} 章），跳过网络抓取")
            all_tasks.extend(done[cid])
            # L1：续跑命中时，若已开启 RENDER_JOBS 且多数任务点仍缺 jobids/objectids，
            # 仍补跑渲染回填——默认无渲染首跑后即使后续开启 RENDER_JOBS 也能拿到
            # type/objectId，不必手删 03_tasks_*.json 或 FORCE_RERUN（审查 L1）。
            if RENDER_JOBS:
                _maybe_render_backfill(cid, clazzid, cpi, done[cid])
            continue
        try:
            tasks = fetch_chapter_tree(client, cid, clazzid, cpi, seed_kid=None)
            all_tasks.extend(tasks)
            if RENDER_JOBS:
                _render_and_backfill(cid, clazzid, cpi, tasks)
        except AuthExpiredError as e:
            logger.error(f"[FATAL] 课程 {cid} 请求被拒（登录态失效）：{e}")
            break
        except Exception as e:
            logger.error(f"[ERROR] 课程 {cid} 获取章节任务点失败: {e}")

    # 4. 心跳接口探测（第一个任务点，只读观察报错）
    if all_tasks:
        try:
            analyze_heartbeat_params(all_tasks[0], client)
        except Exception as e:
            logger.error(f"[ERROR] 心跳探测失败: {e}")

    # 5. 作业拉取（第一个作业类型任务点；否则打印所有 type 取值）
    # L2：type 仅在 RENDER_JOBS=True 渲染后由 infer_type 填充；默认模式恒为 None，
    #     _is_quiz_type(None) 为 False → 永远走 else（作业/类型识别在默认模式下不可用）。
    #     已在此明确提示，并给出启发式候选（含任务点且未完成>0），供开启 RENDER_JOBS 后精确定位。
    quiz_task = next(
        (t for t in all_tasks if _is_quiz_type(t.get("type"))), None
    )
    if quiz_task and quiz_task.get("jobid"):
        try:
            fetch_quiz(client, quiz_task["jobid"],
                       quiz_task.get("courseid"), quiz_task.get("clazzid"))
        except Exception as e:
            logger.error(f"[ERROR] 获取作业失败: {e}")
    else:
        types = sorted({str(t.get("type")) for t in all_tasks if t.get("type")})
        # 启发式候选：默认无渲染模式 type 恒为 None，仅凭 type 无法定位作业；
        # 用「有任务点且未完成计数>0」粗略提示可能存在作业的章节（非精确，仅线索）。
        candidates = [t for t in all_tasks
                      if t.get("hasTaskPoints") and (t.get("unfinishedCount") or 0) > 0]
        msg = (f"[INFO] 无作业类型任务点（type 取值: {types or '[]'}）。"
               f" 注意：作业/类型识别需 RENDER_JOBS=True 渲染后由 infer_type 填充 type/jobid；"
               f" 默认模式下无法精确拉取作业。")
        if candidates:
            msg += (f" 启发式候选（含任务点且未完成>0）共 {len(candidates)} 章，"
                    f" 可设 RENDER_JOBS=True 后重跑以精确识别。")
        logger.info(msg)

    # 6. 生成 output/README.md
    try:
        _write_readme(courses, all_tasks)
    except Exception as e:
        logger.error(f"[ERROR] 生成 README 失败: {e}")

    # 6.5 生成 playlist_{cid}.json：未完成章节清单，供本地桥服务(bridge.py)暴露给
    #     浏览器里的 force-play / auto-next 脚本，实现"跳过已完成章节 + 精确跳到下一未完成章节"。
    #     无需 Playwright：仅用静态 03_tasks 的 knowledgeId/完成态即可；objectids/jobids 为有则带上。
    try:
        _emit_playlists(courses, all_tasks)
    except Exception as e:
        logger.error(f"[ERROR] 生成 playlist 失败: {e}")

    # 7. 陈旧清理：仅当本次确实拉到了课程列表，才以白名单 ACTIVE_COURSE_IDS 为权威，
    #    删除其中不存在的课程之章节级输出（审查#4）。网络异常导致列表为空时不清理，避免误删。
    if all_courses:
        removed = _clean_stale(ACTIVE_COURSE_IDS)
        if removed:
            logger.info(f"[clean] 共清理 {removed} 个陈旧输出文件")

    if not RENDER_JOBS:
        logger.info("[info] 任务点 jobid/objectid 未抓取（RENDER_JOBS=False）。"
                    " 设为 True 可用 Playwright 无头渲染补充，供 force-play 定向续播。")


def _render_and_backfill(courseid, clazzid, cpi, tasks):
    """无头渲染提取 jobid/objectid 并回填到 tasks，重写 03_tasks_{courseid}.json。

    仅读取 visitnodedetail 播放页已渲染的数据（window.attachments / 网络响应），
    不触发视频播放、不提交任何进度。每个任务点可能含多个 jobid/objectid。
    """
    kids = [t["knowledgeId"] for t in tasks if t.get("knowledgeId")]
    if not kids:
        return
    try:
        cookies = load_cookies()
    except Exception as e:
        logger.warning(f"[render] 加载 cookie 失败，跳过渲染: {e}")
        return
    try:
        render_course_taskpoints, infer_type = _import_render()
    except RuntimeError as e:
        logger.error(f"[render] {e}")
        return
    logger.info(f"[render] 无头渲染 {len(kids)} 个节点提取 jobid/objectid（并发={RENDER_CONCURRENCY}）...")
    try:
        res = render_course_taskpoints(cookies, courseid, clazzid, cpi, kids,
                                       concurrency=RENDER_CONCURRENCY)
    except Exception as e:
        logger.error(f"[render] 渲染失败: {e}")
        return
    for t in tasks:
        r = res.get(t.get("knowledgeId"))
        if r:
            t["jobids"] = r.get("jobids", [])
            t["objectids"] = r.get("objectids", [])
            t["type"] = infer_type(r)
    write_tasks_snapshot(courseid, tasks)  # 覆盖断点（带 __status__=complete 标记，吸收评审 P1-1）
    filled = sum(1 for t in tasks if t.get("jobids") or t.get("objectids"))
    logger.info(f"[render] 已回填 {filled}/{len(tasks)} 个节点的 jobid/objectid")


def _maybe_render_backfill(courseid, clazzid, cpi, tasks):
    """L1：续跑命中且已开启 RENDER_JOBS 时，若多数任务点仍缺 jobids/objectids 则补渲染回填。

    已全部回填过的课程跳过，避免无谓重渲染；仅当缺媒体 id 的任务点过半才补跑。
    """
    if not tasks:
        return
    lacking = sum(1 for t in tasks if not (t.get("jobids") or t.get("objectids")))
    if lacking == 0:
        return  # 已回填，无需重复渲染
    if lacking < len(tasks) * 0.5:
        logger.debug(f"[render] 课程 {courseid} 仅 {lacking}/{len(tasks)} 缺媒体 id，跳过补渲染")
        return
    logger.info(f"[render] 续跑命中但 {lacking}/{len(tasks)} 缺 jobids/objectids，补跑渲染回填")
    _render_and_backfill(courseid, clazzid, cpi, tasks)


def _emit_playlists(courses, tasks):
    """按课程导出 playlist_{cid}.json + 汇总 playlist_index.json（原子写）。

    消费方是浏览器用户脚本（经 bridge.py 的 127.0.0.1 HTTP 接口拉取）：
    - force-play：当前章 completed=True 时不续播；objectids 非空时预填白名单。
    - auto-next：按 chapters 顺序找下一个 unfinishedCount>0 的 knowledgeId 精确跳章。
    仅静态字段即可工作；jobids/objectids/type 是 RENDER_JOBS=True 渲染后才有的增强字段。
    """
    import time
    by_course = {}
    for t in tasks:
        by_course.setdefault(_to_int(t.get("courseid")), []).append(t)
    gen_at = time.strftime("%Y-%m-%d %H:%M:%S")
    index = []
    for ch in courses:
        cid = _to_int(ch.get("courseid"))
        cts = by_course.get(cid, [])
        if not cts:
            continue
        cname = ch.get("course_name") or ch.get("name") or ch.get("courseName") or str(cid)
        chapters = []
        for t in cts:
            chapters.append({
                "knowledgeId": str(t.get("knowledgeId") or ""),
                "index": t.get("index"),
                "title": t.get("title") or "",
                "completed": bool(t.get("completed")),
                "unfinishedCount": t.get("unfinishedCount", 0) or 0,
                "hasTaskPoints": bool(t.get("hasTaskPoints")),
                # 渲染增强字段（未渲染时为空/None，脚本侧需容错）
                "jobids": t.get("jobids") or [],
                "objectids": t.get("objectids") or [],
            })
        payload = {
            "version": 1,
            "generatedAt": gen_at,
            "courseid": cid,
            "clazzid": ch.get("clazzid"),
            "cpi": ch.get("cpi", ""),
            "courseName": cname,
            "chapters": chapters,
        }
        atomic_write_json(os.path.join(OUTPUT_DIR, f"playlist_{cid}.json"), payload)
        unfinished = sum(1 for c in chapters if c["unfinishedCount"] > 0 or not c["completed"])
        index.append({"courseid": cid, "courseName": cname,
                      "chapterCount": len(chapters), "unfinished": unfinished})
        logger.info(f"[playlist] 已生成 playlist_{cid}.json（章节 {len(chapters)}，未完成 {unfinished}）")
    atomic_write_json(os.path.join(OUTPUT_DIR, "playlist_index.json"),
                      {"generatedAt": gen_at, "courses": index})


def _is_quiz_type(t):
    s = str(t or "").lower()
    return ("work" in s) or ("quiz" in s) or ("job" in s) or ("test" in s) or ("exam" in s)


def _write_readme(courses, tasks):
    lines = []
    lines.append("# 学习通只读爬取结果\n")
    lines.append("> 本目录由 perception/cx_crawler 生成，仅含你本人学习数据的**只读快照**，未提交/修改任何平台状态。\n")
    lines.append(f"- 活跃课程数: {len(courses)}")
    lines.append(f"- 任务点章节总数: {len(tasks)}")
    completed = sum(1 for t in tasks if t.get("completed"))
    lines.append(f"- 已完成章节: {completed} / 未完成计数合计: "
                 f"{sum(t.get('unfinishedCount', 0) for t in tasks)}\n")

    lines.append("## 课程任务点汇总")
    by_course = {}
    for t in tasks:
        by_course.setdefault(_to_int(t.get("courseid")), []).append(t)
    for ch in courses:
        cid = _to_int(ch.get("courseid"))
        cname = ch.get("course_name") or ch.get("name") or ch.get("courseName") or str(cid)
        cts = by_course.get(cid, [])
        cc = sum(1 for t in cts if t.get("completed"))
        unf = sum(t.get("unfinishedCount", 0) for t in cts)
        lines.append(f"- {cname}（cid={cid}）：章节 {len(cts)} 个，已完成 {cc}，"
                     f"未完成计数 {unf}")
    lines.append("")

    lines.append("## 文件说明")
    lines.append("- `01_courses_raw.json`：课程列表原始响应")
    lines.append("- `01_courses_parsed.json`：解析后的课程数组")
    lines.append("- `02_chapter_list_{courseid}.html`：章节树 AJAX 接口返回的 HTML 片段（任务点来源）")
    lines.append("- `03_tasks_{courseid}.json`：各章任务点快照（序号/标题/未完成数/完成态）；将 config.RENDER_JOBS 设为 True 重跑可补充 jobids/objectids/type（需 Playwright 无头渲染）。注意：作业/类型(job/quiz)识别同样依赖 RENDER_JOBS=True 渲染，默认模式下不可用。")
    lines.append("- `04_heartbeat_*.json`：心跳接口 GET 探测（enc 留空，仅观察报错，有 jobid 时生成）")
    lines.append("- `04_quiz_{jobid}.json`：作业题目原始响应（有作业类型任务点时生成）\n")
    lines.append("## 关键发现")
    lines.append("- 任务点快照取自章节树 HTML（每章自带 `jobUnfinishCount` 与 `icon_Completed`），"
                 "无需逐节点调 `visitnodedetail`（该接口现已返回 HTML 空壳，静态 HTML 不含 jobid/objectId）。")
    lines.append("- 心跳接口 `enc` 签名算法见 `04_heartbeat_*.json` 的报错与 `reverse_enc()` 候选值（仅分析，不验证、不上报）。")
    atomic_write_text(os.path.join(OUTPUT_DIR, "README.md"), "\n".join(lines) + "\n")  # v2：原子写
    logger.info(f"[dump] 已生成 {os.path.join(OUTPUT_DIR, 'README.md')}")


if __name__ == "__main__":
    main()
