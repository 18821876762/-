# -*- coding: utf-8 -*-
"""配置：API 地址、请求头模板、开关。所有地址均为只读 GET 用途。"""

from __future__ import annotations

from collections.abc import Callable

import os
import tempfile
import time
import functools
import json
import logging
import uuid
import requests

# API 地址常量
# 注意：这些地址仅用于"拉取你自己的学习数据"，不用于提交/修改任何平台状态。
API = {
    # courses 接口有两个等价子域：mooc1-api.chaoxing.com（主）与
    # mooc1.chaoxing.com（备）。主域名偶发不可用/被拦截时，courses.py 会自动
    # 将 URL 中的 "mooc1-api.chaoxing.com" 替换为 "mooc1.chaoxing.com" 重试。
    "courses": "https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1",
    # 以下两项为「预留」接口，当前代码路径未使用（阶段6 改为解析章节树 HTML，不再调 node_detail；
    # multimedia 的 jobid/objectid 由 render 模块从播放页 JS 渲染提取，不走此 JSON 接口）。
    # 保留以防后续需要，请勿删除。
    "node_detail": "https://mooc1.chaoxing.com/mooc-ans/nodedetailcontroller/visitnodedetail?courseId={cid}&knowledgeId={kid}&clazzid={clazzid}&cpi={cpi}",
    "multimedia": "https://mooc1.chaoxing.com/mooc-ans/multimedia/ans?jobid={jobid}&objectid={oid}&knowledgeid={kid}&courseid={cid}&clazzid={clazzid}",
    "quiz": "https://mooc1.chaoxing.com/mooc2/work/dowork?jobid={jobid}&courseid={cid}&classid={clazzid}",
    "heartbeat": "https://mooc1.chaoxing.com/multimedia/log/a/{userid}/{dtoken}",
    # 课程目录页（mooc2-ans 域）：{ts} 为客户端毫秒时间戳，用 str(int(time.time()*1000)) 生成。
    "studentcourse": "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid={cid}&clazzid={clazzid}&ut=s&t={ts}",
    # 章节树 AJAX 接口（mooc1 域；浏览器实际使用的就是 mooc1.chaoxing.com，
    # 实测控制台 network 抓包两次均走 mooc1，非 mooc1-1）：动态加载完整章节树 HTML 片段。
    # 必需请求头 X-Requested-With: XMLHttpRequest，Referer 为播放页 studentstudy URL。
    # {seed} 为 chapterId 种子参数，需传「有效章节 ID」才返回完整章节树。
    # 参数顺序对齐实测抓包：courseId & chapterId & clazzid & cpi & mooc2 & isMicroCourse。
    "chapter_list": "https://mooc1.chaoxing.com/mooc-ans/mycourse/studentstudycourselist?courseId={cid}&chapterId={seed}&clazzid={clazzid}&cpi={cpi}&mooc2=1&isMicroCourse=false",
    # 播放页 URL 模板：作为 chapter_list 请求的 Referer（实测该 Referer 校验必需）。
    "studentstudy": "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId={seed}&courseId={cid}&clazzid={clazzid}&mooc2=1&cpi={cpi}",
    # 注：浏览器加载章节时通常会先调 studentstudyAjax（完整播放页 HTML，含 JS，
    # 任务点依赖 JS 渲染 iframe 才填充），再调上面的 studentstudycourselist 取章节树片段。
    # 本只读爬虫只取 studentstudycourselist（已是可解析的章节树 HTML），不拉 studentstudyAjax
    # （其返回的是需 JS 渲染的整页，静态解析无额外收益，且会增大请求面）。
}

# 请求头模板（贴近正常浏览器，避免被简单风控）
HEADERS = {
    # 审查 G2：使用贴近真实版本的 UA。Chrome/Edge 大版本约 13x，
    # 原 150 明显失真易触发反爬 UA 校验；此处取 138（2026 年中稳定线）。
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://mooc1.chaoxing.com/",
    "X-Requested-With": "XMLHttpRequest",
}

# 请求超时（秒）：避免服务器卡住或网络抖动时请求无限期挂起导致脚本卡死。
TIMEOUT = 15

# 调试开关：默认 False（发布态更安静）；设 CX_DEBUG=1 环境变量可开启详细日志。
DEBUG = os.environ.get("CX_DEBUG", "0") == "1"

# 原始响应保存开关：
#   True  = 保存所有带 save_raw 的响应（调试用）
#   False = 只保存关键文件（文件名以 "01_" 或 "03_" 开头：课程列表与任务点汇总）
SAVE_ALL_RAW = False

# 无头渲染开关：用 Playwright(复用系统 Edge)渲染 visitnodedetail 播放页，
# 从 window.attachments 与网络响应抽取 jobid/objectid，回填到任务点快照（供 force-play 定向续播）。
# 默认关闭：逐节点渲染较慢（数百节点约数分钟），且 force-play 在浏览器内可自行读取这些数据。
# 需要时设为 True；建议先用小批量验证。
RENDER_JOBS = False
# 并发渲染的浏览器页面数（同一浏览器实例内并发导航，控制总耗时）
RENDER_CONCURRENCY = 3

# v2.1：断点续跑总开关。False=崩溃后重跑跳过已有断点的课程；True=忽略断点全量重抓（审查#8）
FORCE_RERUN = False

# 输出目录（爬虫生成，已 gitignore）
# v2：绝对化，锁定到脚本所在目录，避免不同 cwd 启动的实例写到不同 ./output 造成数据割裂（审查#3）
OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))

# 本地桥服务（方案 A）：把爬虫产出的 playlist_{cid}.json 通过 127.0.0.1 的只读 HTTP
# 接口暴露给浏览器里的 force-play / auto-next 用户脚本（用户脚本用 fetch 拉取，服务器带 CORS*）。
# 需常驻一个独立进程（python bridge.py）才能被脚本访问；不启动时脚本自动回退到原有行为。
#
# 端口/地址可配置化（优先级由高到低）：
#   1) bridge.py 命令行参数  --host / --port / --config
#   2) 环境变量              CX_BRIDGE_HOST / CX_BRIDGE_PORT
#   3) JSON 配置文件         cx_crawler/bridge_config.json  {"host": "...", "port": 7532}
#   4) 默认值                127.0.0.1 : 7531
# 浏览器侧脚本（force-play / auto-next）通过 ?cxbridge= 或 localStorage.cx_bridge_base 对齐同一端口。
_BRIDGE_DEFAULT_HOST = "127.0.0.1"
_BRIDGE_DEFAULT_PORT = 7531


def _default_or_int(v):
    """把 JSON 配置文件里的 port 解析成 int，失败/缺失回退默认值。"""
    if v is None:
        return _BRIDGE_DEFAULT_PORT
    try:
        return int(v)
    except (ValueError, TypeError):
        return _BRIDGE_DEFAULT_PORT


def _load_bridge_config():
    """解析桥 host/port：环境变量 > bridge_config.json > 默认值。命令行参数由 bridge.py 运行时覆盖。

    修复 R3：原实现先读环境变量、再用 JSON 无条件覆盖，与上方文档宣称的优先级相反——
    用户在环境变量里设的端口会被 bridge_config.json 静默忽略。现改为 JSON 仅在环境变量缺失时生效。
    """
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_config.json")
    json_cfg = {}
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8-sig") as f:
                c = json.load(f)
            if isinstance(c, dict):
                json_cfg = c
        except Exception:
            pass

    json_host = json_cfg.get("host")
    json_port = json_cfg.get("port")

    # 环境变量优先；缺失才回退到 JSON；再缺失才用默认值
    host = os.environ.get("CX_BRIDGE_HOST")
    if not host:
        host = str(json_host) if json_host else _BRIDGE_DEFAULT_HOST

    env_port = os.environ.get("CX_BRIDGE_PORT")
    if env_port is not None:
        try:
            port = int(env_port)
        except ValueError:
            port = _default_or_int(json_port)
    else:
        port = _default_or_int(json_port)
    return host, port


BRIDGE_HOST, BRIDGE_PORT = _load_bridge_config()


# 活跃课程白名单（审查#1 配置外置）：只处理这些 cid。
# 默认空集合 = 处理全部课程（个人工具中通常由用户自建 courses.json 限定常看课程）。
# 配置优先级（与桥配置一致）：
#   1) 环境变量  CX_COURSE_IDS="123,456,789"
#   2) JSON 文件 cx_crawler/courses.json  {"course_ids": [123, 456, 789]}
#   3) 默认      空集合（处理全部课程）
def _to_int(v: object) -> int | None:
    """id 归一化：int / 纯数字 str → int；其余（list/dict/带杂质字符串/None）→ None。
    统一抽自 dump.py / courses.py 的重复实现（审查#4），集中维护。"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _load_active_course_ids():
    """解析活跃课程白名单：环境变量 > courses.json > 空（处理全部）。"""
    # 2) JSON 文件（cx_crawler/courses.json，可从 courses.example.json 复制改名）
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "courses.json")
    json_ids = []
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8-sig") as f:
                c = json.load(f)
            raw = []
            if isinstance(c, dict):
                raw = c.get("course_ids") or c.get("courseIds") or c.get("ids") or []
            elif isinstance(c, list):
                raw = c
            for x in raw:
                try:
                    json_ids.append(int(x))
                except (ValueError, TypeError):
                    pass
        except Exception:
            pass

    # 1) 环境变量优先；缺失才回退到 JSON；再缺失用空集合（处理全部）
    env = os.environ.get("CX_COURSE_IDS")
    if env:
        out = set()
        for tok in env.split(","):
            tok = tok.strip()
            if not tok:
                continue
            try:
                out.add(int(tok))
            except ValueError:
                continue
        return out

    return set(json_ids)


ACTIVE_COURSE_IDS = _load_active_course_ids()

# ======================================================================
# v2 运行时健壮性辅助（原子写 / 限速 / 重试 / 运行锁）—— 不动整体架构
# ======================================================================
VERSION = "2.3"

# 单域最小请求间隔（秒）：限速优先于对抗，避免高频请求触发风控（架构红线 / 审查#5）
MIN_INTERVAL = 1.0
_last_req = [0.0]

def throttle(min_interval=MIN_INTERVAL):
    """请求前调用：保证两次请求间隔 >= min_interval。同进程内共享节流时钟。"""
    now = time.monotonic()
    wait = min_interval - (now - _last_req[0])
    if wait > 0:
        time.sleep(wait)
    _last_req[0] = time.monotonic()


def atomic_write_text(path, content):
    """原子写文本：先写同名 .tmp 再 os.replace，杜绝截断读/并发损坏（审查#1/#7）。"""
    path = os.path.abspath(path)
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d or ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def atomic_write_json(path: str, obj: object) -> None:
    """原子写 JSON（ensure_ascii=False，便于中文）。"""
    atomic_write_text(path, json.dumps(obj, ensure_ascii=False, indent=2))


# 断点快照完成标记（吸收评审 P1-1）：仅带此标记的 03_tasks_{courseid}.json 才被 _load_done_tasks
# 视为「完整断点」。避免把中途异常产出的非空 list 当成完整结果而静默漏抓章节。
TASKS_SNAPSHOT_STATUS_KEY = "__status__"
TASKS_SNAPSHOT_STATUS_DONE = "complete"


def write_tasks_snapshot(courseid: int, tasks: list, output_dir: str = OUTPUT_DIR) -> None:
    """原子写 03_tasks_{courseid}.json，并附 __status__=complete 完成标记（吸收评审 P1-1）。

    chapters.fetch_chapter_tree 与 dump._render_and_backfill 两处写入点统一走本函数，
    保证标记不被任一方覆盖丢失。resume 时只有带标记且 tasks 非空的快照才被信任。
    """
    payload = {
        TASKS_SNAPSHOT_STATUS_KEY: TASKS_SNAPSHOT_STATUS_DONE,
        "courseid": courseid,
        "count": len(tasks) if isinstance(tasks, list) else 0,
        "tasks": tasks if isinstance(tasks, list) else [],
    }
    atomic_write_json(os.path.join(output_dir, f"03_tasks_{courseid}.json"), payload)


def with_retry(max_attempts: int = 3, base_delay: float = 1.0, exceptions: tuple = (requests.RequestException, json.JSONDecodeError, OSError)) -> Callable:
    """指数退避重试装饰器：1s→2s→4s，仅最终失败才上抛。

    v2.1：被装饰函数内部应通过 raise 表达失败（含 5xx 的 raise_for_status），
    才能触发本重试（见 api_client._http_get/_http_post）。

    修复#12/M1：默认仅对瞬态错误重试（网络请求异常 / JSON 解析失败 / IO 错误）。
    编程错误（TypeError、KeyError、AttributeError 等）默认不重试，直接快速失败，
    避免把 Bug 放大为 3 次慢失败。调用方可显式传 exceptions= 覆盖。
    """
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **k):
            delay = base_delay
            for i in range(max_attempts):
                try:
                    return fn(*a, **k)
                except exceptions:
                    if i == max_attempts - 1:
                        raise
                    time.sleep(delay)
                    delay *= 2
        return wrapper
    return deco


class RunLock:
    """跨进程运行锁：基于 O_EXCL 占位文件；已有实例运行时 acquire 抛 RuntimeError（审查#2）。"""
    def __init__(self, lock_path):
        self.lock_path = lock_path
        self._fd = None

    def acquire(self):
        try:
            self._fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise RuntimeError(
                f"已有 cx_crawler 实例在运行（锁文件 {self.lock_path} 已存在）。"
                f"若确认无其它实例，请删除该锁文件后重试。"
            )
        try:
            os.write(self._fd, str(os.getpid()).encode())
        except OSError:
            pass

    def release(self):
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
        # 审查 G4：锁文件可能已被用户/其它进程手动删除，os.remove 会抛 FileNotFoundError；
        # 属正常情况，不应在 atexit 中打印无关回溯，显式吞掉（FileNotFoundError 是 OSError 子类）。
        try:
            os.remove(self.lock_path)
        except FileNotFoundError:
            pass
        except OSError:
            pass

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *exc):
        self.release()


# ======================================================================
# v2.1：结构化日志 + 运行级 trace_id（审查#11）
# ======================================================================
# 每次进程启动生成唯一 trace_id，贯穿全链路日志，便于把一次运行的全部输出串联。
TRACE_ID = uuid.uuid4().hex[:12]


def get_logger():
    lg = logging.getLogger("cx_crawler")
    if not lg.handlers:
        _h = logging.StreamHandler()
        _h.setFormatter(logging.Formatter(
            f"%(asctime)s [{TRACE_ID}] %(levelname)s %(message)s",
            datefmt="%H:%M:%S"))
        lg.addHandler(_h)
        lg.setLevel(logging.DEBUG if DEBUG else logging.INFO)
        lg.propagate = False
    return lg


logger = get_logger()
