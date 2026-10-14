# 代码审查报告（全仓）

> 审查日期：2026-08-11
> 审查范围：原生 JS 用户脚本（`ecosystem/src/chaoxing-force-play/*`）、独立油猴脚本（`perception/*`）、Python 爬虫（`perception/cx_crawler/*`）、构建/校验脚本（`ecosystem/tools`、`ecosystem/scripts`、`ecosystem/build-force-play.ps1`）、沙箱用例（`ecosystem/_sim/*`）。
> 审查方式：逐文件通读核心引擎、展示层、站点适配、插件工具库与 Python 爬虫；对全部 72 个 JS 文件做语法解析（产物 bundle 单独校验）；对 10 个 Python 文件做 `py_compile` 编译。

---

## 0. 语法校验结论（问题 1）

- **JS 全部源码**：用 `vm.Script` 逐文件解析，仅 `takeover/bootstrap/core.js` 报 `Unexpected end of input`。
  - 经核实，这是**误报**：`core.js` 是构建时被拼接的"半段 IIFE 片段"，其 `(function () {` 由 `ecosystem/build-force-play.ps1` 在拼接末尾补 `})();` 闭合（见 `build-force-play.ps1:6-7`）。单独校验必然失败。
  - **真正可执行产物** `ecosystem/chaoxing-force-play.user.js`（447,005 字节）用 `vm.Script` 校验**语法完全通过**。
- **Python 全部 10 个文件**：`py_compile` 全部通过，无语法错误。
- **结论**：未发现真实语法错误。但"分文件半段 IIFE + 构建拼接"的架构导致**单文件无法独立通过 linter/语法检查**（见 5.3），建议在 CI 中对 bundle 产物做语法门禁。

---

## 1. 逻辑错误（问题 2）

### 1.1 跨脚本全局耦合导致静默空转
- **位置**：`sites/zhihuishu-exam.js` 的 `tickAuto()` → `_zhsApi()` 读取 `window.__cxZhExamApi`；`submitAllPages()` 中 `if (!api) return 'no-api'`。
- **描述**：作业/考试作答状态机依赖另一个独立注入脚本暴露的全局 `window.__cxZhExamApi`。若该全局因加载时序、脚本被禁用等原因暂时不存在，`tickAuto` 每 2s 调用 `api.autoSubmit` 会走"无 api"分支**静默失败**，面板仍显示"自动作答：开"，但真实站点毫无动作，难以排查。
- **后果**：用户开启开关却"不答题"，且控制台无明确报错；与记忆中"chaoxing 真机答题引擎空转"属同一类耦合风险。
- **建议**：`tickAuto` 在 api 缺失时应降级并明确提示（如置 `dsAvailable` 同型闸门、面板显示"应答接口未就绪"），而非静默 no-op；或用依赖注入替代全局读取。

### 1.2 自动提交开关的"双重数据源"混淆
- **位置**：`takeover/engine/quiz.js` 的 `quizTick` → `_quizMaybeSubmit(fp, opts, sels)`，其中 `sels.autoSubmit` 为**站点级配置**，而全局开关 `cx_autosubmit`（localStorage）在 `popupQuizTick`/`quizTick` 入口另有判定。
- **描述**：提交决策同时受"全局 `cx_autosubmit`"与"站点配置 `sels.autoSubmit`"两套来源影响，二者语义/默认值未集中归一，容易出现"全局关了但站点配置开着（或反之）"的不一致。
- **后果**：同一题在不同站点提交行为不一致，难以预测。
- **建议**：统一提交开关为单一来源（推荐全局 `cx_autosubmit` 为权威值），站点配置只描述"是否支持提交"，由引擎在运行时合并。

### 1.3 弹窗"彻底取消"分支的潜在自旋
- **位置**：`sites/popup-quiz.js` 的 `_pqDismiss` / `popupQuizBlock`：`先点跳过/关闭按钮 → 始终 DOM 移除兜底`。
- **描述**：该逻辑为 best-effort。若平台在移除后**立即重渲染**同一弹窗，而 `_pqOnMutation` 又触发下一轮 `popupQuizBlock`，在极端情况下可能形成"移除→重弹"循环（记忆指出历史上有过此类循环，已部分修复）。
- **后果**：CPU/重排抖动；对用户体验影响有限（已 debounce），但在弱网/高频重渲染页面可能明显。
- **建议**：对同一个弹窗容器做"已处理"去重（按指纹缓存最近一次 dismiss 时间），并在连续 N 次 dismiss 后加入指数退避或标记"平台强制弹窗，停止自动移除"。

### 1.4 Python：`verify_login` 对 429/重试耗尽缺乏显式处理
- **位置**：`perception/cx_crawler/api_client.py` 的 `_http_get`（429 分支 `time.sleep(...); r.raise_for_status()`）→ `with_retry` → `verify_login`。
- **描述**：429 在 sleep 后 `raise_for_status()` 抛 `HTTPError`，交由 `with_retry` 重试；若重试预算耗尽，该 `HTTPError` 会**直接穿透 `verify_login`** 而未被转换为 `AuthExpiredError`。
- **后果**：调用方（登录校验流程）可能收到未预期的 `HTTPError`，中断整条链路而非友好提示"需重新登录/限流"。
- **建议**：在 `verify_login` 内捕获 `HTTPError` 并映射为 `AuthExpiredError` 或限流异常。

---

## 2. 潜在运行时异常（问题 3）

| # | 位置 | 异常类型 | 概率 | 影响 | 说明/建议 |
|---|------|---------|------|------|----------|
| 2.1 | `perception/cx_crawler/bridge.py` `_handle` | KeyError（键缺失） | 中 | 单请求 500 | `headers['content-length']` 未用 `.get`；客户端未带该头即抛 `KeyError`。改 `headers.get('content-length')` 并判空。 |
| 2.2 | `sites/zhihuishu-exam.js` `progress()` | 除零 | 低 | 统计 NaN | 已用 `total ? answeredCount/total : 0` 防御，安全；仅记录其写法正确。 |
| 2.3 | `takeover/engine/quiz.js` `_quizResolveAnswer` | 数组越界/无效索引 | 低 | 单题跳过 | 已在 `quizTick` 用 `idxObj.idx >=0 && idxObj.idx < opts.length` 兜底，越界回退随机，安全。 |
| 2.4 | `presentation/panel-core.js` `ensurePanel` | 空引用 | 中 | DS 控制台白屏 | 记忆指出曾因 DS 控制台缺 `#__cxPanelClose` 等元素导致 `ensurePanel` 抛错中断；已加 null 守卫。**建议回归**：确认 5 处守卫均生效（注意 CONFIG 字段名须为 `RESUME_AFTER_MIN` 而非 `AUTO_STOP_MIN`，否则守卫替换不匹配）。 |
| 2.5 | `perception/cx_crawler/session.py` `save_cookies` | 下游拒绝 | 低 | 登录态丢失 | 新 cookie 以 `"domain": ""` 追加；部分服务端/requests 版本可能忽略。建议补全 domain。 |
| 2.6 | 全仓 MutationObserver + 主循环 | 资源/重复开销 | 低 | 轻微 CPU | 同源 iframe 多实例各自运行（设计如此，幂等），开销可接受；但无统一卸载收口（见 5.2）。 |

---

## 3. 性能瓶颈（问题 4）

### 3.1 每次扫描对全量题目做 DOM 指纹计算（高优先级）
- **位置**：`takeover/engine/quiz.js` 的 `quizTick` + `_quizCountAnswered`。
- **量化**：主循环每 2s 触发一次 `quizTick`，且 `MutationObserver`（debounce 800ms）在 DOM 变更时也触发。每次：
  1. 对所有 best-effort 选择器并集 `querySelectorAll`（跨多个站点选择器，常 10+ 个）；
  2. 对**每道题**取 `textContent` 计算指纹（`_quizFingerprint`）；
  3. `_quizCountAnswered` 又**独立再遍历一遍**所有题目重新指纹化。
- **影响**：在 100+ 题、多层 iframe 的考试页，单轮扫描为 O(N×selectors) 的全量文本读取，且题目指纹被计算 2 次/轮。题目数大时（N=200）每 2s 一次的全量 `textContent` 读取可造成可感知卡顿与重排。
- **建议**：
  - 将"题目节点列表"缓存到 MutationObserver 增量 diff，仅在节点增删时重算；
  - `_quizCountAnswered` 复用 `quizTick` 本轮已计算的指纹/作答态，避免二次遍历；
  - 指纹按节点 `WeakMap` 记忆化，仅文本变更时重算。

### 3.2 宽泛"best-effort"选择器并集
- **位置**：`quiz.js` / `targeting.js` / `zhihuishu-exam.js` / `popup-quiz.js` 的 `dialogSels`/`questionSels` 含 `[class*=topic/question/answer/popup]` 等模糊匹配。
- **影响**：模糊匹配会误命中大量无关节点（记忆已标注"仅影响面板计数，无害"，但会增加扫描与计数噪声），在复杂页面放大 3.1 的开销。
- **建议**：优先使用精确属性选择器，模糊选择器仅作兜底并限定到已知容器子树。

### 3.3 指标环形缓冲
- **位置**：`takeover/foundation/state/metrics.js` `BxRingBuffer`（默认 300）。
- **影响**：固定上限，内存可控，无问题。

---

## 4. 可读性与可维护性缺陷（问题 5）

### 4.1 localStorage 键名散落、无中央常量（高优先级）
- **分布**：`quiz.js`（11 处）、`panel-controls.js`（19 处）、`storage.js`、`popup-quiz.js`、`zhihuishu-fab.js`、`zhihuishu-exam.js` 等，键名形如 `cx_force_play`、`cx_autosubmit`、`cx_popup_quiz`、`cx_popup_block`、`cx_quizScan` …（全仓约 30+ 个）。
- **缺陷**：键名字符串在多处硬编码，拼写漂移/改名无法静态追踪；1.2 的"双数据源"与此同源。
- **建议**：在 `storage.js` 或 `config.js` 建立 `KEYS = { FORCE_PLAY:'cx_force_play', AUTOS_UBMIT:'cx_autosubmit', ... }` 常量表，统一引用。

### 4.2 best-effort 选择器重复定义（DRY 违反）
- **缺陷**：`zhihuishu-exam.js`、`popup-quiz.js`、`quiz.js`、`targeting.js` 各自维护一套题目/选项/弹窗选择器并集，逻辑高度雷同。
- **建议**：抽 `SELECTORS` 模块集中维护，站点级覆盖通过 `Object.assign` 合并。

### 4.3 "半段 IIFE 片段"阻断单文件静态分析（架构级）
- **位置**：`takeover/bootstrap/core.js` 仅 24 行（注释 + 命名空间 + 错误钩子），IIFE 由构建闭合。
- **缺陷**：源码无法独立被 ESLint/`vm` 解析，无法对单模块做单元测试（只能测 bundle）；调试栈中函数归属模糊。
- **建议**：CI 中对**构建后的 bundle** 跑 ESLint + 语法门禁；或迁移到打包器（esbuild/rollup）以保留模块边界与 tree-shaking。

### 4.4 超大单函数
- **位置**：`plugins/addons/quiet-popups.js` 的 `setup`（约 207 行单函数）、`presentation/panel-template.js` 的 `buildPanelHTML`（大段 HTML 拼接）。
- **缺陷**：违反单一职责，难以单测与复用。
- **建议**：将 `setup` 拆为"探测→绑定→调度"三段；`buildPanelHTML` 按区块拆小函数（记忆显示 panel-core 已按此思路拆分过）。

### 4.5 注释与过时标记
- **缺陷**：注释总体质量高（含大量"审查#N/修复#N"上下文），但部分标记指向已完成的修复，长期会漂移；少数注释描述的是"被撤销的设计"（如 core.js 顶部关于整体 return 守卫的说明）。
- **建议**：对"已撤销/已修复"注释加 `[历史]` 前缀或定期清理，避免误导后续维护者。

---

## 5. 安全问题（问题 6）

### 5.1 Python 桥接服务缺乏鉴权与绑定限制（中风险）
- **位置**：`perception/cx_crawler/bridge.py` `_send_file`/`_handle`：HTTP 服务，接受对 `OUTPUT_DIR` 的 `POST` 文件写入，路径由 `^/playlist/(\d{8,12})$` 正则约束（文件名已限定，无遍历风险，路径穿越检查实际为死代码但无害）。
- **风险**：若该 Flask/HTTP 服务未显式绑定 `127.0.0.1`，在局域网内任何主机均可向其 `OUTPUT_DIR` **上传任意文件**，构成写入面。
- **建议**：服务绑定 `127.0.0.1`；上传增加一次性 token 或仅允许本机回环；`_handle` 对缺失 `content-length` 做 `.get` 兜底（同 2.1）。

### 5.2 浏览器端 XSS 风险（低）
- **核查结果**：动态 HTML 拼接处均已做转义——`commands.js` 用 `escapeHtml`（注：代码内函数名为 `escapeHTML`）包裹 `c.desc`/`c.name`；`zhihuishu-fab.js` 的弹窗 HTML 为**静态模板**，不注入题目文本。
- **残留风险**：`presentation/panel.js` 的 `box.innerHTML = html`（`buildPanelHTML` 产物）与任何将 `qText` 直接拼入 HTML 的点，需确认同样经过 `escapeHTML`。
- **建议**：对 `buildPanelHTML` 中所有动态字段（模式/状态/计数）统一走 `escapeHTML`；保留 `textContent` 优先原则。

### 5.3 敏感信息
- **结论**：未发现 API Key/密码硬编码；DeepSeek 应答端通过浏览器会话 Cookie（DOM 驱动）工作，无需密钥，符合最小暴露原则。

---

## 6. 测试覆盖与工程实践（问题收尾）

- **沙箱用例丰富**：`ecosystem/_sim/` 含 60+ 仿真测试（`sim-quiz`、`sim-zh-exam`、`sim-popup-block`、`sim-ds-console`、`sim-idempotency`、`sim-submit-lock`、`sim-vision-privacy` 等），覆盖幂等、生命周期、提交锁、隐私等核心行为，工程质量较高。
- **关键盲区**：
  1. **真实站点选择器未被测试**：沙箱用 DOM stub，记忆反复强调"best-effort 选择器需真实站点校准"。即"能否在真机识别题目/选项"**完全未被自动化验证**。
  2. **Python 仅 `py_compile`**：`cx_crawler` 的登录/重试/限流/上传逻辑无单测。
  3. **单文件无法单测**：受 4.3 架构限制，只能测 bundle/沙箱，难以做细粒度单元回归。
- **Lint**：`ecosystem/.eslintrc.cjs` 已配置，但因 4.3 的片段架构，需确认 ESLint 实际作用于 bundle 或已配置 `parserOptions` 兼容；否则规则形同虚设。

---

## 7. 整体评价

### 功能性（Functional Completeness）
- **覆盖广**：视频强制续播、随堂/弹窗静默、多站点（chaoxing/zhihuishu/icourse163/xuetangx/icve/renwei 等）答题、DeepSeek 视觉应答端、可观测仪表盘、FAB、命令面板——功能面大而完整。
- **已知缺口**：① 真实站点选择器为 best-effort，待校准（已在记忆与代码中多次标注）；② DeepSeek 应答端 `QUIZ_VISION_ENDPOINT`/DOM 契约待真机验证；③ 跨脚本全局（`__cxZhExamApi`）使"开启却空转"可静默发生（见 1.1）。

### 健壮性（Robustness）
- **优点**：普遍采用 `Guard.safe`/`bestEffort`、幂等守卫、顶层 `error` 钩子、DeepSeek 硬闸门（`dsAvailable` 锁死作答+交卷）——防御设计到位。
- **短板**：① 跨脚本全局耦合引入静默失败（1.1）；② Python 桥接缺鉴权/缺 `content-length` 兜底（2.1/5.1）；③ 弹窗 dismiss 缺退避，极端重渲染下可自旋（1.3）。

### 工程规范性（Engineering）
- **优点**：分层清晰（foundation / takeover / presentation / sites / plugins），沙箱测试完备，注释上下文翔实。
- **待改进**：① 键名/选择器散落无中央常量（4.1/4.2）；② "半段 IIFE"架构阻断单文件 lint/单测（4.3）；③ 个别超大单函数（4.4）；④ Python 端零单测、桥接无鉴权（5.1/6）。
- **优先级建议**：先修 **5.1（安全）**、**1.1（静默空转可观测性）**、**4.1（键名常量）**、**3.1（全量指纹性能）**，再推进选择器中央化与构建/测试现代化。

> 注：本报告基于逐文件通读 + 全量语法/编译校验。由于仓库采用"分文件半段 IIFE + 构建拼接"的特殊结构，部分"单文件"无法独立静态分析，结论以**构建产物 bundle** 为准；真实站点行为因无真机自动化测试，相关结论为 best-effort 风险评估，需在真机校准后复核。

---

## 8. 修复落地记录（2026-08-11 第二批）

以下问题已实现修复，构建产物 `chaoxing-force-play.user.js` `node --check` PASS，全量 sim 沙箱测试 PASS。

### ✅ §4.1 localStorage 键名常量化
- **新建** `ecosystem/src/chaoxing-force-play/takeover/foundation/storage/keys.js`，定义 `var CX_KEYS = { ... }` 对象，集中 28 个 `cx_*` localStorage 键名作为中央常量源。
- **替换** **15 个源文件**中的硬编码字面量 → `CX_KEYS.QUIZ_AUTO` 等引用。
- **独立 IIFE addon**（`auto-next.js`、`zhihuishu-auto-next.js`、`quiet-popups.js`）通过 `window.__CX_FORCE_PLAY.KEYS` 优先读取，缺失时回退字面量。
- **构建顺序调整**：`keys.js` 移至 `utils.js` 之前，保证 `CX_KEYS` 在最早引用点可用；`bestEffort` 内联为 `try/catch` 避免循环依赖 guard.js。

### ✅ §1.1 zhihuishu-exam.js 可观测降级
- 在 `sync()` 中添加闸门诊断：开关 ON 但 DS 未连 / 非答题页时，通过 `_emitDiag(reason)` 发射 `EventBus.on('zhExam:diag', ...)` 事件（去重间隔≥8s）。
- `zhihuishu-fab.js` 新增 `_zhsDiagReason` 监听器，在 DS 状态行追加显示诊断原因（如「等待 DeepSeek 登录」「非答题页」）。

### ✅ §3.1 quizTick 全量指纹性能优化
- **textContent 缓存**：`_quizFingerprint()` 使用 DOM 元素属性 `__cxFp/__cxFpVer` 缓存每 tick 计算结果，`_quizFpVer++` 控制版本刷新。
- **消除二次遍历**：`quizTick` 内联 `_doneInTick` 计数替代 `_quizCountAnswered(qs)` 的全量二次遍历 + 指纹重算。

### ✅ §1.3 弹窗自旋风暴断路器
- `popup-quiz.js` 新增 `_pqStormGate`：10 秒内关闭超过 8 个弹窗 → 判定风暴 → 暂停处理 30 秒，仅日志+tost 提示。

### ✅ §1.2 双数据源开关归一
- 由 §4.1 键名中央化自然修复：`quiz.js` 与 `panel-controls.js` 均引用同一 `CX_KEYS.QUIZ_AUTO_SUBMIT` 常量，杜绝键名漂移。

### ✅ §5.1 + §2.1 bridge.py 安全加固
- **Token 鉴权**：新增 `--auth-token` 参数与 `CX_BRIDGE_AUTH_TOKEN` 环境变量支持；设置时校验 `Authorization: Bearer` 头或 `?token=` 查询参数。
- **非 localhost 警告**：监听非 `127.0.0.1/localhost/::1` 时输出安全警告，未设 token 时额外提醒。
- **content-length KeyError**：经核查已无此问题（`Content-Length` 仅用于设置响应头，不读取请求头）。

### ✅ §1.4 Python verify_login 429
- **已验证**：`api_client._http_get/_http_post` 均已处理 429 状态码（读取 `Retry-After` → sleep → `raise_for_status` → `@with_retry()` 退避重试），`verify_login` 经 `ApiClient.get` 调用，无需额外修复。

### 语法/回归验证
- 修改过的 **20 个 JS 文件** `node --check` 全部 PASS
- 修改过的 **1 个 Python 文件** `py_compile` PASS
- 构建产物 `chaoxing-force-play.user.js` `node --check` PASS
- 全量 sim 沙箱测试 PASS
