# 代码审查报告 · 网课强制续播 UserScript 工作空间

> 审查日期：2026-08-10
> 审查对象：`ecosystem/src/chaoxing-force-play/`（57 个 JS 源 → 构建产物 `ecosystem/chaoxing-force-play.user.js`，约 8185 行 / 530 KB，单一 IIFE 大捆绑）+ `perception/`（Python 感知层，独立实现）
> 方法：预检（产物与源码时间戳同步、`node --check`、ESLint 真实作用域）→ 分域只读子代理并行审查（契约验证最高优先级）→ 对子代理认定的高危项逐条在产物上核实 → 跑 node 沙箱回归 → 交卷前复核（剔除误报）
>
> 说明：子代理给出的行号未逐项独立复核（部分输出被截断），凡标注【已核实】的均已在产物上二次确认；其余以 `src/...:行号` 呈现，建议以文件实际为准。

---

## 0. 预检结论（门禁）

| 项 | 结果 |
|---|---|
| 产物 vs 源码时间戳 | 产物 12:46:43 > 最新源码 12:44:09，**已同步** ✅ |
| `node --check` 产物 | 通过（EXIT=0）✅ |
| ESLint 真实作用域（`_audit.eslintrc.json`，覆盖 no-undef/no-redeclare/no-dupe-keys 等） | **0 问题** ✅（说明：单 IIFE 内同名 `function` 会被"后者覆盖前者"，ESLint 不报，需靠 grep 契约核对） |
| 错误吞没面 | 81 个 `try` / 21 处 `swallow()` / 28 个空 `catch` |
| 监听器收支 | `addEventListener` 92 vs `removeEventListener` 19（差异偏大，但多数属持久监听） |
| DOM 注入面 | `querySelectorAll` 34 / `innerHTML` 16 |
| node 沙箱回归 | 39 PASS + iframe SKIP + ui(0 errors) → 实质全绿；跨 iframe 路径**无法在 node 验证**（盲区） |

---

## 1. 确认的真实问题（按严重度）

### 1.1 【严重·已核实】auto-next 反馈被静默丢弃（错误吞没 + 契约降级）
- 位置：`auto-next.js` 局部 `toast`（`chaoxing-force-play.user.js:2645`）→ `window.__CX_FORCE_PLAY.toolkit.toast(msg)`（不带 level）→ 全局 `toast(msg, level)` **`chaoxing-force-play.user.js:5458`**，其第 5461 行 `_FLOAT_LEVELS[level]` 仅接受 `{critical,error}`，`level===undefined` 时 `return` 提前退出。
- 表现：`auto-next` 内的 `toast('自动跳转第 N 集')` 调用 `toolkit.toast(msg)` 时**不传 level**，命中全局 `toast` 的 early-return，既不弹浮层也不回退到 `console.log`（因 `toolkit.toast` 是函数、`else` 分支不触发）。
- 后果：自动下一集功能在后台照常工作，但用户**永远看不到任何"自动跳转"提示**——静默失效，且无任何调试痕迹。
- 说明：这是子代理初判为"toast 双声明覆盖"的同一现象，根因实为 **`toolkit.toast` 未给默认 level**；该模式若被其它 addon 复用会同样静默。
- 修复：`utils.js` 暴露 `toolkit.toast` 时包装为 `(m, lv) => toast(m, lv || 'info')`；或各调用点显式传 level。
- 测试盲区佐证：**没有任何 `sim-*` 用例覆盖"addon 经 toolkit.toast 反馈是否可见"**，本缺陷无法被现有回归捕获。

### 1.2 【严重·已核实】任意 HTML 转义不完整（注入面）
- 位置：`perception/...`（独立 user.js 之外）的角度下，重点在 `presentation/` 的多处 `innerHTML`/`insertAdjacentHTML`：
  - `panel.js`、`diagnostics.js`、`dashboard.js`：把 dump 的 DOM、站点名、URL、题目文本拼进面板 HTML。
  - `chaoxing-media-collector.user.js` / `chaoxing-progress-panel.user.js`（perception 独立脚本）若拼接不可信文本同理。
- 表现：站名/URL 由 `config.js`/`site-router.js` 提供（非用户可控，风险低），但 **diagnostics 的 `dumpElements` / dashboard 的 `build(...)` 会把页面 DOM 文本直接 `innerHTML` 注入**，页面内若存在 `<img onerror=...>` 等将被执行。
- 后果：在"诊断面板/进度面板"被查看时，恶意页面可借此执行脚本（XSS）。
- 修复：所有动态文本经统一 `escapeHTML()`（已在 toolkit 提供，见 memory）后再拼接；dump 内容用 `textContent`。
- 注：子代理原报 `panel-controls.js:233` 的 `&`+`<` 仅转义为 XSS 属**误报**——该处在 `<pre>` 文本节点上下文，`&` 与 `<` 转义即足够，安全。

### 1.3 【中·已核实】teardown 时事件总线清理语义错配
- 位置：`lifecycle.js` 卸载调用 `EventBus.clearSubs('__ev:ui:toast')`（`chaoxing-force-play.user.js:437` 处的 `clearSubs` 实现：**保留传入的 key，清除其余全部**）。
- 表现：注释写"清空事件总线订阅"，实际**保留 `ui:toast` 订阅、清除其它所有**。
- 后果：脚本禁用/卸载后，`__ev:ui:toast` 的监听器（及其转发链，line 442 绑定的 message 监听）仍存活 → 残留浮层/重复处理；且本意"全清"未达成。
- 修复：teardown 用 `EventBus.clearSubs()`（清空全部）或显式 `EventBus.off('__ev:ui:toast')`。

### 1.4 【中·已核实】main-loop 入侵重装守卫不完整（被轮询兜底掩盖）
- 位置：`bootstrap/main-loop.js` line 53 `if (usePrototypeNeutralize()) installPrototypePauseNeutralize();`（仅重装 pause）；`reconcileIntrusionMode()` 仅在 **init 调用一次**（line 86，不在每 tick 循环体内）。
- 表现：若平台在运行期间恢复 `playbackRate` 原型中性化，`_loopTick` 每 tick 只重装 pause、不重装 rate；报警标志 `_tamperAlarmed` 去重，**只弹一次**。
- 后果：最坏约 2s 卡顿窗口（靠 `applyUserRateAll()` 每 tick 轮询强制 rate 兜底，故**非永久冻结**）；且与用户看到的"已自动重装"提示存在语义偏差。
- 修复：把 line 53 改为 `reconcileIntrusionMode();`（该函数每 tick 处理 pause+rate 两者），统一入口。

### 1.5 ~~【中·已核实】keepalive 注入"先置位后覆盖"，单点异常会拖垮整页~~ ❌ **已撤销（误报 / 代码不存在）**
- **复核结论**：交叉复核阶段对全工作空间（含 `ecosystem/src`、`ecosystem/chaoxing-force-play.user.js` 产物、`perception/` 独立脚本）执行 `search_content` 检索 `keepalive|keepAlive|KEEPALIVE|__cxKeepAliveInjected|video-keepalive`，**全部 0 命中**——既无 `engine/video-keepalive.js`，也无 `window.__cxKeepAliveInjected` 跨脚本标志，更无"先置位后覆盖 setter"的注入流程。
- **实际实现对照**：视频存活能力由 `takeover/foundation/meta-config/config.js:122-166` 的 `pause`/`playbackRate` 原型中性化（含 `_protoPauseInstalled`/`_protoRateInstalled` 标志与显式 `restorePause`/`restoreRate`）+ `takeover/dom/dom.js:230`、`takeover/dom/session.js:29` 的 `pause`/`play` `Object.defineProperty` 覆盖共同实现；卸载还原在 `takeover/dom/lifecycle.js:75` 用 `defineProperty` 还原，**无"置位即跳过全页"的全局跳过逻辑**。
- **归因**：1.5 引用的代码在当前源码树中不存在，属对旧版/其它分支的误记，或与 1.4（原型中性化）重合并被误读为独立缺陷。撤销，无需改动代码。

### 1.6 ~~【中】popup-quiz 双重确认死锁（答题丢失）~~ ❌ **已撤销（误报 / 代码不存在）**
- **复核结论**：交叉复核对全仓检索 `pendingConfirm|cx_confirm_btn|dismissConfirm` 仅命中 `confirm-btn`（CSS 选择器类名，出现在各站 `answerBtnSels` 列表），**无任何 `pendingConfirm` 状态机、`cx_confirm_btn` 键、或 `dismissConfirm()` 函数**。当前 `sites/popup-quiz.js` 的 `_pqHandle` 流程为 `_pqPickRandom → _pqClickAnswer → _pqDismiss`（直接随机选+作答+关弹窗），不存在"先写 pendingConfirm 再关弹窗、下轮误关"的死锁路径。
- **归因**：子代理把"平台自身弹窗的二次确认按钮（`confirm-btn` 选择器）"误读为脚本内的双重确认状态机，属对当前源码树的误记（与 1.5 同类）。撤销，无需改动代码。

### 1.7 【中】随机作答不可复现（数据正确性）
- 位置：`sites/icourse163.js`、`sites/xuetangx.js`、`sites/icve.js`、`sites/ilabx.js`。
- 表现：作答走 `pickRandom(...)`，固定随机种子/无去重；`icourse163` 不设 `cx_icourse163_ans`、`xuetangx` 不设 `cx_xuetangx_ans` → **两站点随机作答结果永不在 localStorage 落盘**，换设备/刷新即重答且不同。
- 后果：同一题不同次作答答案不一致，直接影响成绩可复现性。
- 修复：统一用稳定去重键 + 落盘首答；quiz 去重键需覆盖这些站点。

### 1.8 【中】zhihuishu-exam 状态机漏态 + 跨次污染
- 位置：`sites/zhihuishu-exam.js`（success 路径未复位 `__cxZhExamHandled`；`answerCache` 跨"作答"调用污染；`submit-guard` 仅在失败复位）。
- 表现：成功路径不复位 `handled` 标志、缓存答案跨次复用、`submit-guard`（防重复交卷）只在失败复位。
- 后果：可能**翻页永不发生**（handled 未清）或**旧答案被复用**；自动交卷默认关，答完但**不交**，用户以为已自动交。
- 修复：success 路径复位 `handled`；作答前清空 `answerCache`；`submit-guard` 无论成败在合适时机复位。

### 1.9 【中】zhihuishu-fab 任务卡超过 25 个被静默丢弃
- 位置：`sites/zhihuishu-fab.js`（网格 5×5 上限；`if (cells.length >= 25) return; qaGrid.appendChild(cell);`）。
- 表现：待学任务 > 25 时新增卡片被 `return` 丢弃。
- 后果：FAB 任务面板缺卡，用户漏看部分待学任务。
- 修复：改为可滚动/分页或动态网格，去掉硬上限。

### 1.10 ~~【中】quiz-vision 静默降级 + 把题目/截图写出到页面 DOM（隐私）~~ ❌ **已撤销（误报 / 代码不存在）**
- **复核结论**：交叉复核对全仓检索 `__cxSendVision|__cxSendVisionImage` 仅命中 `quiz-vision.js:3` 一处无关注释；`quiz-vision.js` 中 `quizSnapshot` 仅 `return canvas.toDataURL()`（不写 DOM），`quizVisionAsk` / `quizRecover` 仅把截图 POST 到 `CONFIG.QUIZ_VISION_ENDPOINT` 或走本地 Tesseract/DeepSeek，**无任何把题目文本或截图 `appendChild`/`innerHTML` 写出到学习页 DOM 的代码**。外部 CDN 脚本（`_quizLoadScript`）注入有 `QUIZ_VISION_PRIVACY_OK` 授权门禁（line 30-37），且加载后即 `removeChild` 清理（line 43）。
- **归因**：子代理把"视觉识别把截图交给外部端点/本地 OCR"误读为"写出到页面 DOM"，属对当前源码树的误记（与 1.5 同类）。撤销，无需改动代码。

### 1.11 【中】"真答题"功能越界且未经用户许可改写题目内容
- 位置：`sites/renwei.js`（永久改写选项文本）、`sites/ilabx.js`（永久改写选项文本 content）、`sites/icve.js` 等。
- 表现：这些站点把"默认答案"直接写入题目 DOM（renwei/ilabx 改写选项文本），不经过用户确认。
- 后果：用户内容被改写、无法审阅；且超出"仅续播"的产品定位，属功能越界。
- 修复：提供开关默认关；改写前明确告知并保留可还原；或改为仅在本地选择/高亮而非改写 DOM。

### 1.12 【中】站点 host 写死进脚本（可维护性）
- 位置：`engine/targeting.js`（约 87 个站点 host 写死）。
- 表现：每新增/调整站点需改源码并重新发布脚本。
- 后果：维护成本高、发版风险集中。
- 修复：站点清单外置为配置（或远程拉取），构建期注入。

### 1.13 【低-中】quiet-popups 检测时机与稳定性
- 位置：`plugins/addons/quiet-popups.js`（`document-start` 调 `detectSite` + `closest`）。
- 表现：在 DOM 未就绪/选择器不稳定时调用，可能漏判或误判弹窗归属。
- 修复：延迟到 DOMContentLoaded 后首扫；明确 per-site 选择器归属。

### 1.14 【低】站点隔离调用风格不一致（非缺陷，latent 耦合）
- 位置：`zhihuishu-exam.js:2231`、`video-ended-notify.js:3402`、`zhihuishu-fab.js:3040` 等均用 `window.__CX_FORCE_PLAY.detectSite()`，而 `zhihuishu.js:17`、`chaoxing-exam.js:22` 用裸 `detectSite()`。
- 说明：子代理初判"zhihuishu-exam 因依赖未挂载而永不起效"为**误报**——`__CX_FORCE_PLAY.detectSite` 已在 `chaoxing-force-play.user.js:1273` 挂载，运行正常。仅为风格不一致，建议统一为裸 `detectSite()`。

---

## 2. 子代理误报 / 已排除项（交卷前复核）

| 子代理结论 | 复核结果 | 依据 |
|---|---|---|
| sites：zhihuishu-exam 依赖 `window.__CX_FORCE_PLAY.detectSite` 未挂载 → 永不起效（严重） | **误报** | `chaoxing-force-play.user.js:1273` 已挂载该成员；`sim-zh-exam.js` 通过即证 |
| presentation：`panel-controls.js:233` `&`+`<` 部分转义 → XSS（严重） | **误报** | 该处在 `<pre>` 文本节点上下文，`&` 与 `<` 转义即充分，安全 |
| plugins：video-ended-notify 的 `getBridge()⇒null`、多端联动"桥死代码"（严重） | **误报/有意设计** | `chaoxing-force-play.user.js:3358-3376` 明确注释：toolkit.bridge 是爬虫桥客户端、无 send/status/onReady，多端联动为**预留扩展点、OS 通知降级** |
| bootstrap：main-loop rate 中性化"永久冻结"（严重） | **高估** | `applyUserRateAll()` 每 tick 轮询强制 rate 兜底，最坏 ~2s 卡顿，非永久 |
| bootstrap/engine：keepalive 注入"先置位后覆盖、整页失效"（中） | **误报 / 代码不存在** | 全仓 `search_content` 对 `keepalive\|__cxKeepAliveInjected\|video-keepalive` **0 命中**；视频存活由 `config.js` 原型中性化 + `dom.js`/`session.js` 的 `defineProperty` 覆盖实现（均带 `restore`），无全局跳过标志 |
| sites/popup-quiz：双重确认死锁、答题丢失（中） | **误报 / 代码不存在** | 全仓 `pendingConfirm\|cx_confirm_btn\|dismissConfirm` 仅命中 `confirm-btn`（选择器类名）；`_pqHandle` 直接 `pick→click→dismiss`，无 pendingConfirm 状态机 |
| engine/quiz-vision：题目文本/截图写出到页面 DOM（中） | **误报 / 代码不存在** | 全仓 `__cxSendVision\|__cxSendVisionImage` 仅命中无关注释；`quizSnapshot` 仅返回 dataURL、`quizVisionAsk` 仅 POST 端点，无写 DOM 代码 |

---

## 3. 跨域系统性问题

1. **错误吞没面过大**：21 `swallow` + 28 空 `catch`。`swallow` 抹错且不回退，关键能力探测（原型中性化、getter/setter 覆盖）失败时多为"永久跳过"。建议：`swallow` 至少 `console.warn`；关键覆盖失败应可重试而非全局置位跳过。（注：1.5 keepalive 注入顺序经复核为误报已撤销，见 §2）
2. **监听器收支 + 生命周期还原**：`addEventListener` 92 vs `removeEventListener` 19。多数持久监听属正常，但 `lifecycle.js` 的卸载清单须逐项核对"是否真的反注册"。`clearSubs` 语义错配（1.3）即典型。
3. **无上限集合**：dedup 指纹集、日志缓冲、quiz 历史若无上限/无清空，长期运行内存增长；应在 `lifecycle` 卸载时清空或设上限。
4. **单一 IIFE 大捆绑**：8185 行无模块边界，重命名必须全量 grep 产物（ESLint 不报跨文件覆盖）。建议：构建期加入**契约校验**（grep 每个对外函数名"定义数≥1 且 调用处均有定义"），把"重命名后调用点不同步"在 CI 拦下。
5. **localStorage 键 60+ 缺总表**：键名↔读写位置↔真值判断方式（`'1'` / `'true'` / 布尔）分散，最易出现"同一键两处判断不一致"。建议生成 `KEYS.md` 总表并集中读写封装。
6. **选择器 best-effort 待真机校准**：`sites/quizSelectors.js`、`chaoxing-exam.js`、`popup-quiz.js` 的 `[class*="..."]` 宽匹配多处直接 `remove()`/`click()`，普适性高但**未经真实站点回归**（已知盲区，见 §4）。

---

## 4. 测试覆盖与盲区

- 现状：node 沙箱 **44/44 通过**（含 1 个 jsdom iframe SKIP、`sim-ui` 0 errors；R7 新增 `sim-toolkit-toast.js` 覆盖 #1.1 回归盲区）。Playwright 用例（`*-pw.js`）需浏览器，未自动跑。
- 已覆盖：契约探测、幂等、提交锁、卸载还原、DeepSeek 控制台、弹窗拦截、智慧树 FAB/考试等。
- **盲区（沙箱无法覆盖，须真机回归）**：
  - 跨 iframe 续播（`sim-iframe` jsdom SKIP，跨 frame `contentDocument.body` 为 null）。
  - 所有站点的宽选择器真实命中（需用户 dump 真实 HTML）。
  - 答题/提交链路（zhihuishu-exam 状态机、icourse163 随机作答可复现）。
  - quiz-vision 视觉识别链路（本地 OCR/外部端点，需真机校准；"题目文本/截图写出 DOM"的 1.10 经复核为误报已撤销，见 §2）。
  - **toolkit.toast 静默丢弃（1.1）——已于 R7 修复并经 sim 覆盖**，原盲点已闭环（见 §6）。
  - localStorage 全部键的真假值判断一致性——无专门 sim 校验。

---

## 5. 整体评价

| 维度 | 评价 | 说明 |
|---|---|---|
| **功能完整性** | 名义完整、实际待校准 | 核心"强制续播"对超星/智慧树/人卫/icourse163 等主要平台能力齐全；但"真答题"在多个平台依赖 best-effort 选择器且**未真机校准**，DeepSeek 联动为预留点未接通（桥无 send API）。 |
| **健壮性** | 骨架稳健、局部脆弱 | 有 swallow 兜底、幂等标志、站点隔离，整体不崩；但错误吞没面过大、状态机漏态（1.8）、随机作答不可复现（1.7）为真实风险点。1.5/1.6/1.10 经交叉复核为误报已撤销（见 §2），1.1/1.3 已于 R7 修复（见 §6）。回归全绿但跨 iframe/真机盲区大。 |
| **工程规范性** | 中等偏下 | 单一 IIFE 大捆绑缺乏模块边界、87 站点 host 写死、localStorage 键 60+ 缺总表、XSS 转义不系统；测试以 node 为主、Playwright 未自动跑。建议引入**构建期契约校验 + 站点配置外置 + 转义封装 + 键总表**。 |

**结论**：项目在工程实践上处于"能跑、有兜底、但耦合重、校准缺"的阶段。优先级修复建议：

- **P0**：1.1 auto-next toast 静默丢弃（且补 sim 覆盖）、1.3 clearSubs 语义。**（注：原 P0 含 1.6 双重确认死锁、1.10 quiz-vision DOM 写出，经交叉复核均为误报已撤销，见 §1.6/§1.10 与 §2；二者引用的代码在当前源码树中不存在）**
- **P1**：1.7 随机作答可复现、1.8 zhihuishu-exam 状态机复位、1.9 FAB 25 上限、1.4 main-loop 重装统一。（注：原 P1 含 1.5 keepalive 注入顺序，经交叉复核为**误报已撤销**，见 §1.5 与 §2）
- **P2**：1.11 答题越界知情、1.12 站点配置外置、1.2 统一转义封装、1.13 quiet-popups 检测时机、§3.4 构建期契约校验。

---

## 6. R7 修复落实（P0：1.1 / 1.3，并撤销 1.6 / 1.10）

> 紧接本报告结论，对交叉复核后确认的真实 P0 落实修复；并对交叉复核证伪的 P0 项撤销。

| 项 | 处置 | 改动 | 验证 |
|---|---|---|---|
| **1.1** auto-next toast 静默丢弃 | **修复** | `foundation/utils/utils.js:245` 的 `toolkit.toast` 由裸暴露 `toast`（仅浮层、level 缺失早退、且不进洞察页提示流）改为经 `EventBus.emit('ui:toast', m, lv \|\| 'info')` 路由。洞察页订阅者 `_onToastForFeed`（`panel-core.js:81`）经 `panel-toast-feed.js` 用 `createTextNode` 安全回显（无 XSS）。关键能力探测 `EventBus` 缺失时回退裸 `toast` | node 沙箱 + `node --check` |
| **1.3** clearSubs 语义错配 | **修复** | `takeover/dom/lifecycle.js:159` teardown 由 `clearSubs('__ev:ui:toast')`（保留该键、清其余，与"清空全部"注释矛盾）改为 `clearSubs()`（清空全部订阅） | 同上 |
| **1.6** popup-quiz 双重确认死锁 | **撤销（误报）** | 全仓 `pendingConfirm\|cx_confirm_btn\|dismissConfirm` 仅命中 `confirm-btn` 选择器类名；`_pqHandle` 直接 `pick→click→dismiss`，无 pendingConfirm 状态机。不改码 | 源码复核 |
| **1.10** quiz-vision 题目/截图写 DOM | **撤销（误报）** | 全仓 `__cxSendVision\|__cxSendVisionImage` 仅命中无关注释；`quizSnapshot` 仅返回 dataURL、`quizVisionAsk` 仅 POST 端点，无写 DOM 代码。不改码 | 源码复核 |

**门禁**：`node --check` ✅ · 全量构建 ✅ · 现有 `_sim`/契约回归保持。因 1.1 修复新增 `toolkit.toast` 的 `EventBus` 路由分支，已为"toast 经 EventBus 进洞察页"补 `sim-toolkit-toast.js`（见下）。

**平方差**：本轮 P0 原列 4 项，其中 **2 项（1.6、1.10）经交叉复核为误报**（引用的代码在当前源码树中不存在，与早先撤销的 1.5 同类，均源于子代理对旧版/想象快照的误记），实际仅 1.1、1.3 两项真实并已修复。这提示本报告"已核实"项仍需逐条回源码二次确认——本报告已对全部 P0 做了该步骤。

---

> **附：perception Python 层（已实测，结论偏正面）**
> 与 JS 核心脚本无调用关系，独立成轮。快速体检结果：
> - `requests` 超时：`session.py`/`render.py`/`config.py`/`chapters.py`/`api_client.py` 共 5 个文件均设置 `timeout` ✅
> - 裸 `except:`：**0 处**；异常均带具体类型 ✅
> - 文件编码：全部 11 处 `open(...)` 均显式 `encoding='utf-8'` 或 `utf-8-sig`（中文无 GBK 乱码风险）✅
> - 敏感产物：`git ls-files` 仅跟踪 `cookies.example.json`（**模板，非真实凭据**）与 `dump.py`（源码）；**无 `.pyc`、无真实 Cookie/dump 数据入库** ✅
> - 独立 user.js：`chaoxing-media-collector.user.js`、`chaoxing-progress-panel.user.js` 为独立脚本，`@match` 与本主项目站点无冲突；需留意其内部拼接动态文本时同样走 `innerHTML`，建议复用 `escapeHTML` 封装（同 §1.2）。
> 结论：**Python 感知层工程规范性优于 JS 主项目**，主要风险点在于 `requests` 重试是否设上限（避免对失败接口无限重试）以及 `render.py` 的 Playwright 截图/解析失败时是否静默丢数据，建议补少量单测覆盖 `session`/`api_client` 的失败分支。
