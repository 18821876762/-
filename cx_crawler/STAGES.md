# 超星学习通只读爬虫 — 阶段化设计文档（阶段 1–10）

> 定位：**纯只读学习数据快照工具**。仅拉取本人学习数据，绝不提交 / 修改任何平台状态。
> 合规红线（贯穿全文）：不伪造学习记录、不上报播放进度、不绕过登录鉴权、不对目标站造成 DoS 级压力。

---

## 0. 整体架构（5 步流水线）

```
① 构建 Session ──▶ 加载 Cookie → warmup → verify_login(result=1)
        │
② 课程列表 ──────▶ GET backclazzdata(主域+容灾) → 白名单过滤 7 门活跃课
        │
③ 章节树 ────────▶ 真实 chapterId 种子 → GET studentstudycourselist(XHR头)
        │              → 多路正则提取全部 knowledgeId → 存章节树 HTML
        │
④ 任务点 ────────▶ 章节树 HTML 直接解析每章任务点(序号/标题/未完成数/完成态)
        │              → 解析 attachments → 输出任务点 JSON
        │
⑤ 探测 + 汇总 ──▶ 心跳 enc 留空 GET 探测 + 作业只读拉取 + 生成 README.md
```

统一能力：
- 所有请求经 `ApiClient` 封装，`timeout=15`（来自 `config.TIMEOUT`）。
- 原始响应按 `SAVE_ALL_RAW` 开关落盘（默认仅 `01_` 课程列表、`03_` 任务点汇总）。
- 全链路 try-catch，单步失败仅打印日志不中断流程。

---

## 1. 模块职责一览

| 模块 | 职责 |
|---|---|
| `config.py` | API 地址、请求头模板、`TIMEOUT`、`SAVE_ALL_RAW`、`OUTPUT_DIR` 等全局常量（单一配置源） |
| `session.py` | Cookie 加载 + 健康检查、Session 构建、登录态校验、warmup 预热 |
| `api_client.py` | 统一 HTTP 封装（GET/POST/GET-JSON）+ 按开关落盘 |
| `courses.py` | 课程列表拉取、解析 `channelList`、主域/备域容灾 |
| `chapters.py` | 章节树 AJAX 拉取、有效种子引导、多路正则提取 knowledgeId、章节树 HTML 解析任务点（node_detail 已失效） |
| `render.py` | 无头渲染（Playwright+Edge）加载 visitnodedetail，从 window.attachments 与网络响应抽取 jobid/objectid，回填任务点快照（RENDER_JOBS 开关控制） |
| `heartbeat.py` | 心跳接口 enc 留空 GET 探测 + 签名线索分析（只读） |
| `quizzes.py` | 作业/测验题目只读拉取 |
| `dump.py` | 主流程编排：白名单过滤 + 串联上述步骤 + 生成 README |

---

## 2. 阶段详解

### 阶段 1：Cookie 体系建立与登录校验
- **落点**：`session.py`
- **要点**
  1. 浏览器导出关键 Cookie（UID、`_d`、`jrose`、`vc3`、`rose`、`route`、`k8s`）持久化到 `cookies.json`（支持 list / dict / 字符串三种格式，`load_cookies`）。
  2. `build_session` 构建 `requests.Session` 并写入 Cookie，对 7 个关键字段做**健康检查**，缺失即告警。
  3. `verify_login` 调用课程/用户信息接口，**以 `result==1` 作为登录态有效硬判据**，未命中再兜底检测登录页关键词。
  4. `warmup` 访问基础域与课程域，触发服务端写入业务 Cookie（失败不致命）。

### 阶段 2：课程列表获取与域名容灾
- **落点**：`courses.py::fetch_courses`
- **要点**
  1. 主接口 `backclazzdata?view=json&rss=1`（主域 `mooc1-api.chaoxing.com`）。
  2. 解析 `channelList`：从 `content` 取 `cpi`，从 `key` 取 `clazzid`，从 `content.course.data[0]` 取课程名与 `courseid`。
  3. 主域非 200 / JSON 解析失败 / 课程数组为空时，自动将 URL 域名替换为 `mooc1.chaoxing.com` 重试。

### 阶段 3：章节 ID 提取的多次失败与根因分析
- **根因**：目录页初始 HTML 是空壳，章节数据由浏览器执行 JS 后通过 AJAX 动态填充；`requests` 不能执行 JS，故静态 HTML 中永远没有完整章节 ID（正则提取 `knowledgeId`/`chapterId` 全部返回 0）。
- **结论**：必须转向 AJAX 接口（见阶段 4）。

### 阶段 4：AJAX 接口定位与 studentstudycourselist
- **落点**：`config.py::API["chapter_list"]` + `chapters.py::fetch_chapter_tree`
- **要点**
  1. 章节数据来自播放页加载时的 AJAX：`studentstudycourselist`。
  2. 参数：`courseId`、`clazzid`、`cpi`、`chapterId`（种子）、`mooc2=1&isMicroCourse=false`。
  3. 返回 `Content-Type: text/html` 的 HTML 片段（非 JSON），含完整章节树 DOM。
  4. 必须带 `X-Requested-With: XMLHttpRequest` 与播放页 `Referer`，否则可能被拒或返回空。

### 阶段 5：种子 chapterId 问题与多路正则提取
- **落点**：`chapters.py`
- **要点**
  1. **种子反模式**：传 `"0"` 或随机时间戳仅返回 1 个默认章节 / 空数据（实测：`studentcourse` 引导出的叶子种子也只返 1 章）。
  2. **稳健种子引导（取章节数最多的响应，不再提前 break）**：
     - 调用方传入的有效 seed（非 `0`/空）优先；
     - 否则 GET `mooc2-ans` 课程页 `studentcourse`，从 HTML 抠真实 `chapterId`；
     - **始终**把 `"0"` 作为兜底候选（实测带正确 Referer 时 `seed=0` 可返回完整树，数百个 id）；
     - 逐个尝试所有候选种子（含从返回片段抠出的派生种子），保留 `knowledgeId` 最多的那次响应作完整章节树。
  3. **多路有序正则**（`ID_PATTERNS`）覆盖全部形态：
     - `class="firstLayer" id="{digit}"`（一级章节）
     - `id="cur{digit}"`（当前节点）
     - `getTeacherAjax('cid','clazzid','kid')` 第 3 参数（兼容带/不带引号）
     - `toOld(courseid, kid, clazzid)` 第 2 参数（兼容带引号）
     - `data-knowledgeid` / `data-chapterid` / URL 参数 / JSON 属性 / `data-id`
  4. 提取用 set 并集，不丢数据；`extract_seed_chapter_id` 优先选 `firstLayer` 顶层 id 作种子。

### 阶段 6：任务点提取（章节树 HTML 解析，node_detail 已失效）
- **落点**：`chapters.py::parse_chapter_tasks` + 章节树 HTML
- **背景（实测修正）**：`visitnodedetail`（`API["node_detail"]`）现返回 **HTML 空壳**，任务点由页面 JS 动态渲染进各卡片 iframe 的 `objectid`，静态 HTML 中**不含** `jobid`/`objectId`，原 JSON 三路解析（`result_json`→`data.attachments`→`attachments`）因此必然得到空结果。
- **修正方案**：任务点快照直接来自**章节树 HTML 本身**（`studentstudycourselist` 返回的片段），每个 `id="cur{kid}"` 叶子节点自带可靠字段：
  - 章节序号 `<em class="posCatalog_sbar">1.1</em>`
  - 标题 `title="..."`
  - 未完成任务点数 `<input value="N" class="jobUnfinishCount"/>`（顺序无关提取）
  - 完成态 `<span class="icon_Completed">已完成</span>`
  - 顶部 `_studystate` 隐藏域还有课程级 `unfinishCount` 总数。
- **说明**：`jobid`/`objectId`/`type` 需 JS 渲染才能获取，合规只读前提下静态抓取置 `None`；逐任务点明细由阶段 6B 的无头渲染补齐。

### 阶段 6B：无头渲染补充 jobid/objectid（Playwright + 系统 Edge）
- **落点**：`render.py` + `config.RENDER_JOBS` / `config.RENDER_CONCURRENCY` + `dump.py::_render_and_backfill`
- **动机**：阶段 6 的章节树 HTML 解析只能拿到"哪章有任务点、未完成几个"，但 force-play 等脚本要**定向续播**，需要每个任务点的 `jobid`/`objectid`。这些标识只在页面 JS 执行后出现在 `window.attachments[].property.objectid` 与网络响应（`api/work?jobid=`、`richvideo/allsubtitle?objectid=`）中，`requests` 静态抓取拿不到。
- **实现要点**
  1. 复用系统已装 **Microsoft Edge**（`channel="msedge"`），免下载 Chromium；Playwright 仅 `pip install playwright` 即可。
  2. 单浏览器实例 + 单 context（cookie 注入一次），按 `RENDER_CONCURRENCY`（默认 3）**分批并发导航** visitnodedetail，避免逐节点串行过慢（数百节点约数分钟）。
  3. 每个节点**只读加载**（不触发视频播放、不上报进度），`wait_until="commit"` 后等 4s 让 JS 渲染，再抽取：
     - 视频 `objectid`：直接读 `window.attachments[].property.objectid`（比正则干净）；
     - 作业 `jobid`：从 `api/work?jobid=work-xxx` 等响应 URL 正则捕获；
     - `infer_type()` 粗略分类 `work` / `job` / `video/doc`。
  4. 回填到 `03_tasks_{courseid}.json` 的 `jobids` / `objectids` / `type` 字段（每节点可能多个）。
- **默认关闭**：`RENDER_JOBS=False`（渲染慢且 force-play 在浏览器内可自行读这些数据）。开启后重跑 `dump.py` 即补齐。

### 阶段 7：超时配置统一收口与工程规范
- **落点**：`config.py` + `api_client.py` + `session.py`
- **要点**
  1. `TIMEOUT = 15` 唯一定义在 `config.py`，各模块 `from config import TIMEOUT`，无散落本地定义（`warmup` 不再 `ImportError`）。
  2. `SAVE_ALL_RAW` 开关收口：调试模式（`True`）全量落盘；正常运行（`False`）仅保留 `01_`/`03_` 关键文件，避免无用产物。

### 阶段 8：活跃课程白名单过滤
- **落点**：`dump.py::ACTIVE_COURSE_IDS`
- **要点**
  1. 21 门课中仅 7 门活跃；白名单集合只处理这 7 门，避免对已结课课无效请求。
  2. 过滤在 `fetch_courses()` 之后：`[c for c in all_courses if c.get("courseid") in ACTIVE_COURSE_IDS]`，无特化逻辑。
  3. 主循环 per-course try-catch，单门失败不中断整体。

### 阶段 9：心跳接口与作业模块的只读探测架构
- **落点**：`heartbeat.py` + `quizzes.py` + `dump.py`
- **要点**
  1. 纯只读定位：绝不 POST 上报进度。
  2. 心跳 `multimedia/log/a/{userid}/{dtoken}`：`enc` 留空 GET 探测，观察报错；`reverse_enc()` 仅打印 MD5 候选值（无盐/带盐），不验证、不上报。
  3. 作业 `quiz` 接口：GET 拉题、多路径提取题目数组，不自动作答。
  4. 所有模块错误 try-catch 捕获打印，不中断流程。
  5. 最终生成 `output/README.md`，记录文件说明与关键发现（含心跳 enc 签名线索）。

### 阶段 10：整体架构总结与最终工作流
- 见本文档「0. 整体架构」与「1. 模块职责一览」。
- **扩展路径**：新增课程 = 往 `ACTIVE_COURSE_IDS` 加 `cid` + 确保能引导出真实 `chapterId` 种子（阶段 5 三级引导已自动处理）。

---

## 3. 运行方式

```bash
cd cx_crawler
# 1. 浏览器导出超星 Cookie 到 cookies.json（参考 cookies.example.json 的三种格式）
python dump.py        # 主流程：①~⑤ 全链路只读快照
```

产物位于 `./output`：
- `01_courses_raw.json` / `01_courses_parsed.json`
- `02_chapter_list_{courseid}.html` / `02_studentcourse_{courseid}.html`
- `03_tasks_{courseid}.json`
- `04_heartbeat_*.json`（有 jobid 时）/ `04_quiz_{jobid}.json`（有作业任务点时）

> 注：`02_node_{kid}.json` 不再生成——阶段 6 已改为直接解析章节树 HTML 提取任务点，
> 不再逐节点调 `node_detail`（该接口现返回 HTML 空壳）。`config.API["node_detail"]` /
> `multimedia` 仅作预留保留。
- `04_heartbeat_{jobid}.json` / `04_quiz_{jobid}.json`
- `README.md`（汇总）

---

## 4. 合规与边界

- ✅ 仅读取本人学习数据；尊重站点 ToS 与限速。
- ✅ 心跳 / 作业均只读，不伪造、不上报。
- ❌ 不实现进度上报、自动作答、绕过付费/登录鉴权（受合规限制，此类诉求不实现）。
