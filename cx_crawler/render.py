# -*- coding: utf-8 -*-
"""无头渲染提取任务点 jobid/objectid（只读，复用系统 Edge）。

背景：章节树 HTML 不含 jobid/objectid（见 STAGES 阶段6），任务点标识需执行页面 JS 才能拿到。
本模块用 Playwright 加载 visitnodedetail 播放页（只读 GET，不触发视频播放、不上报任何进度），
从 window.attachments[].property.objectid 与网络响应(jobid=/objectid=)抽取任务点标识，
回填给 crawler 的任务点快照，供 force-play 等脚本定向续播。

合规：仅读取页面已渲染的数据，不调用 play、不提交/伪造任何学习进度。
"""
import re

from playwright.sync_api import sync_playwright

NODE_URL = ("https://mooc1.chaoxing.com/mooc-ans/nodedetailcontroller/visitnodedetail"
            "?courseId={cid}&knowledgeId={kid}&clazzid={clid}&cpi={cpi}")

RE_JOBID = re.compile(r'[?&]jobid=([^&]+)', re.I)
RE_OBJID = re.compile(r'[?&]objectid=([^&]+)', re.I)


def _pw_cookies(cookie_dict: dict[str, str]) -> list[dict[str, str]]:
    """把 crawler 的简单 {name: value} cookie 转成 Playwright 需要的结构。"""
    return [{"name": k, "value": v, "domain": ".chaoxing.com", "path": "/"}
            for k, v in cookie_dict.items()]


def render_course_taskpoints(cookie_dict: dict[str, str], courseid: int, clazzid: int, cpi: int, kids: list[int], concurrency: int = 3) -> dict[int, dict]:
    """并发渲染多个 knowledgeId，返回 {kid: {"jobids":[...], "objectids":[...]}}。

    - 复用单个浏览器实例 + 单 context（cookie 注入一次），按 concurrency 分批并发导航。
    - 每个 kid 只读加载 visitnodedetail，等待 JS 渲染后抽取任务点标识，绝不触发播放/上报。
    """
    cookies = _pw_cookies(cookie_dict)
    results = {}
    browser = None
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge", headless=True)
            ctx = browser.new_context()
            ctx.add_cookies(cookies)
            for i in range(0, len(kids), concurrency):
                batch = kids[i:i + concurrency]
                pages = []
                for kid in batch:
                    pg = ctx.new_page()
                    jobids, objectids = set(), set()

                    def on_resp(r, _j=jobids, _o=objectids):
                        u = r.url
                        for m in RE_JOBID.finditer(u):
                            _j.add(m.group(1))
                        for m in RE_OBJID.finditer(u):
                            _o.add(m.group(1))

                    pg.on("response", on_resp)
                    # commit 即返回，随后统一 wait，便于批内并发加载
                    try:
                        pg.goto(NODE_URL.format(cid=courseid, kid=kid, clid=clazzid, cpi=cpi),
                                wait_until="commit", timeout=30000)
                    except Exception as e:
                        print(f"[render] 节点 {kid} 加载失败，跳过: {e}")
                        pg.close()  # v2：修复页面泄漏（审查#9），异常分支也必须回收 page
                        continue
                    pages.append((kid, pg, jobids, objectids))
                for kid, pg, jobids, objectids in pages:
                    try:
                        # 动态等待 window.attachments 渲染完成（替代固定 sleep #6）：
                        #   - 网络快时 JS 一设好 attachments 立即返回，省去盲等；
                        #   - 网络慢时也不会因固定 4s 截断而漏取媒体 id。
                        # 设上限超时兜底——纯目录/无媒体的章节可能永不出现 attachments，
                        # 超时后继续用 evaluate 取当前已渲染部分（evaluate 内部已容错返回 []）。
                        try:
                            pg.wait_for_function(
                                "() => Array.isArray(window.attachments) "
                                "&& window.attachments.length > 0",
                                timeout=8000,
                            )
                        except Exception:
                            pass
                        # 视频资源 id 也可直接从 attachments 取（比正则更干净）
                        att_objs = pg.evaluate("""() => {
                            try {
                                var a = window.attachments;
                                if (!Array.isArray(a)) return [];
                                var out = [];
                                a.forEach(function(x){
                                    var prop = x && x.property;
                                    if (prop && prop.objectid) out.push(String(prop.objectid));
                                });
                                return out;
                            } catch (e) { return []; }
                        }""")
                        for o in att_objs:
                            objectids.add(o)
                        results[kid] = {
                            "jobids": sorted(jobids),
                            "objectids": sorted(objectids),
                        }
                    except Exception as e:
                        results[kid] = {"jobids": [], "objectids": [], "error": str(e)}
                    finally:
                        pg.close()
        finally:
            if browser is not None:
                browser.close()
    return results


def infer_type(res: dict) -> str | None:
    """粗略推断任务点类型，供 force-play 定向：work=作业, job=其它 jobid, video/doc=仅有 objectid。"""
    jobids = res.get("jobids", [])
    if any("work" in j for j in jobids):
        return "work"
    if jobids:
        return "job"
    if res.get("objectids"):
        return "video/doc"
    return None
