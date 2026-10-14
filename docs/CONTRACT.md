# 跨文件契约总表（CONTRACT）

> 适用范围：`apps/userscript/src/chaoxing-force-play/`（构建产物 `dist/chaoxing-force-play.user.js`）。
> 人工条款核对：4.20.3，2026-10-14；自动挂载表仍由脚本维护。
>
> 本文件是**可校验的契约文档**（原 `docs/CONTRACTS.md` 已并入本文件 §7–§9）：
> - 第 1–6 章及 §7.4 的 C7.1 为**行为不变量**（人读、评审依据），由构建门禁 ⑥ `verify_contract_semantics.js` 静态校验"是否真被实现"；
> - 第 7–9 章为**命名空间/工具库契约、预留扩展点与历史缺陷**（人读，防止"调用名 ≠ 挂载名"复发）；
> - 第 11 章为**自动生成的挂载点总表**，由 `apps/userscript/scripts/verify_contract_doc.js` 生成，
>   构建门禁 ⑤ 会逐字比对，源码新增/删除挂载点而未重新生成即构建失败。
>
> 由来：多轮审计中 R1/R4（多帧共享面板 DOM）、R3/R6（改了页面状态却无还原路径）反复复发，
> 根因是"跨文件共享的约定只存在于注释与记忆里"。本表把这些约定固化为可回归的条款。

---

## 1. 面板单一事实源（Single Source of Truth）

脚本会注入到**页面主帧与同源 iframe 的每一帧**，而面板 DOM 只有一份（挂在 `window.top.document`）。
因此"谁能写面板 DOM"必须唯一，否则多帧同时重绘会互相覆盖，并把本帧 `CONFIG` 反向写回共享控件。

| 条款 | 内容 |
|---|---|
| C1.1 | 面板元素 id 恒为 `__cxPanel`；创建者帧在其上写 `_cxPanelOwner = window` 标记所有权。 |
| C1.2 | **任何写面板 DOM 的函数，入口第一句必须是 `if (!_cxPanelOwnerClaim()) return;`**。当前受约束者：`refreshPanelState`（`dashboard.js`）、`renderVideoList`（`dashboard-render.js`）、`syncPanelInputs`（`panel.js`）。 |
| C1.3 | `_cxPanelOwnerClaim()`（`panel-core.js`）语义：`owner` 为空 → 本帧接管并返回 `true`；`owner === window` → 返回 `true`；`owner` 属于他帧 → 返回 `false`。**不得**改成"直接判等"，否则 owner 帧卸载后无人接管，列表永久冻结。 |
| C1.4 | owner 帧卸载（`pagehide`）必须释放所有权：`panel-core.js` 注册 `_ownerReleaseFn`；`lifecycle.js` 的 `cleanupListeners` 必须成对退订该监听并清 `_cxPanelOwner`。 |
| C1.5 | 只读展示（不写共享 DOM）的逻辑不受 owner 约束，但**不得**顺手写入任何 `#__cx*` 控件。 |

回归守护：`_sim/sim-panel-owner.js`。

## 2. 面板控件同步（精简/裁剪模板兼容）

面板模板按站点/场景分支（视频页面板、作业考试助手、DeepSeek 应答端控制台…），**同一个同步函数会遇到缺控件的模板**。

| 条款 | 内容 |
|---|---|
| C2.1 | 读取面板子元素一律 `var n = _cxPanel.querySelector(sel); if (n) …`，**禁止** `querySelector(sel).textContent = …` 链式写法。 |
| C2.2 | 违反 C2.1 的后果不是"报错弹窗"，而是**静默降级**：`bestEffort` 吞掉 TypeError → 同一块内后续控件（如 `#__cxVer`）全部同步不到，表现为"配置显示滞后"。 |
| C2.3 | 新增控件时同步更新 `syncPanelInputs` 与 `refreshPanelLabels` 两处，二者是同一批标签的两个写入口。 |

回归守护：`_sim/sim-panel-owner.js`（场景 4：删除四个数值标签后 `#__cxVer` 仍须被回填）。

## 3. 列表渲染与索引契约

面板视频列表的点击映射依赖"DOM 行序 ↔ `_lastVideoList` 下标"严格一致。

| 条款 | 内容 |
|---|---|
| C3.1 | `renderVideoList` 每一项都必须产出一行，**逐项 `bestEffort` 失败时也要输出 `data-vi` 占位行**（`.cx-video-item-failed`），不得整行丢弃。 |
| C3.2 | 行上的 `data-vi` 恒为该视频在 `_lastVideoList` 中的下标；点击处理（`panel-core-events.js`）以 `_lastVideoList[idx]` 为准。 |
| C3.3 | 状态不可读（跨域/已失效）的占位行**不得**渲染开关按钮——不可读即不可操作，避免误触到别的视频。 |

回归守护：`_sim/sim-video-list-index.js`。

## 4. 卸载还原清单（uninstall 契约）

`window.__CX_FORCE_PLAY.uninstall()`（= `lifecycle.js` 的 `cleanupListeners`）承诺"页面回到注入前状态"。
**凡是脚本改写过的东西，都必须在此列出还原动作**；漏一项就是"卸载后仍被锁死"。

| 层级 | 还原项 | 位置 |
|---|---|---|
| 定时器/观察者 | 主循环 timer、视频 MO、题目 MO（`quizDisconnect()`） | `cleanupListeners` ①②③ |
| 全局 API | `navigator.mediaSession`（pause handler / playbackState）、`window.ananas.pause` | ④⑤ |
| **实例级** | 每个 `<video>` 的 own 属性：`v.pause`、`v.play`、以及 `FLAGS.*`（`__cxForcePaused`/`__np`/`__cxEndedLock`/`__cxUserPaused`/`__cxAN_hold`/`__cxNearEndEndedGuard`） | **⑤-b** |
| 原型 | `HTMLMediaElement.prototype.pause` 中性化还原（`restorePrototypePause`） | ④ 区 |
| 监听 | `play` 即时接管、`error` 诊断、`pagehide`/`beforeunload` 自身、Ninja 外点击/播放态、owner 释放监听 | ⑥⑦⑧、⑦-b |
| 全局对象 | `__cxRegisterAddon`/`__cxRegisterCommand`/`__cxUI`/`__cxAddonQueue`、各 `__cx*Started` 启动守卫 | ⑨⑨-b |
| DOM | `__cxPanel`/`__cxPanelNinjaStyle`/`__cxPanelAnimStyle`/`__cxPanelMobileStyle`/`__cxToast`（本文档 + top 文档双清） | ⑩ |
| 终态 | EventBus 订阅、`delete window.__CX_FORCE_PLAY` | ⑪ |

| 条款 | 内容 |
|---|---|
| C4.1 | 还原动作一律走 `bestEffort`，**单项失败不得中断后续还原**；不得用一次性 `_cleaned` 之外的提前 `return`。 |
| C4.2 | 新增任何"写页面/写全局/写实例"的接管点，必须同步在本表加一行还原项，并在 `_sim/sim-uninstall*.js` 加断言。 |
| C4.3 | 还原以**行为**为准绳：卸载后 `v.pause()` 必须真暂停、`v.play()` 必须真播放，而不仅仅是"属性看起来没了"。 |

回归守护：`_sim/sim-uninstall.js`、`_sim/sim-uninstall-instance.js`。

## 5. 状态改写的"对偶还原"契约

| 条款 | 内容 |
|---|---|
| C5.1 | 任何 `muteAll` / `pauseAll` / `hideXxx` 式的**批量状态改写**，都必须有被真实调用的还原路径，且还原以标记位（如 `__cxEndedMuted`）为准，只还原自己改过的对象。 |
| C5.2 | 只定义 `restoreAll` 而无调用点 = 缺陷（R6）。工具库项 `video-ended-notify` 的还原触发点为 `document` 级 `play` 捕获监听 → `restoreIfNeeded()`。 |
| C5.3 | 还原必须幂等：重复触发不得抛错，也不得把用户手动设置的静音一并解除（靠标记位区分）。 |

回归守护：`_sim/sim-ended-mute-restore.js`。

## 6. 站点隔离与真值判断约定

| 条款 | 内容 |
|---|---|
| C6.1 | 站点相关能力一律经 `__CX_FORCE_PLAY.detectSite()` 判定，**禁止**直接读 `location.host` 做分支。 |
| C6.2 | 弹窗答题骨架 `popup-quiz.js` 的 `popupQuizTick` / `popupQuizBlock` 必须先过 `_pqSiteGuard()` 白名单（纵深防御，防止骨架在未适配站点误改 DOM）。 |
| C6.3 | 函数型契约成员判断统一用 `typeof x === 'function'`；对象/开关型用真值判断（`if (window.__cxAddonQueue)`）。**禁止** `typeof x !== 'undefined' && x` 这类冗余双判。 |
| C6.4 | 跨文件读取命名空间成员前必须确认其在 `src` 内有挂载点——由构建门禁 ④ `verify_contracts.js` 强制；预留扩展点需登记进该脚本的 `ALLOW`。 |

## 7. 命名空间与共享工具库契约

> 本章由原 `docs/CONTRACTS.md` 并入（两份契约文档已合一，避免"改一份漏一份"）。
> 权威事实以 `scripts/verify_contracts.js` 的扫描结果为准，本章是人可读的解释层。

本脚本是单 IIFE、跨文件靠约定协作（无模块系统）。所有跨文件能力通过唯一全局命名空间
`window.__CX_FORCE_PLAY` 暴露，工具库挂在 `window.__CX_FORCE_PLAY.toolkit`。
**"谁挂载 / 谁消费"必须一致**，否则即 D1–D4 类契约断裂（调用名 ≠ 挂载名）。

### 7.1 全局命名空间根

| 根 | 含义 | 主要消费方 |
|----|------|-----------|
| `window.__CX_FORCE_PLAY` | 唯一公开命名空间 | 所有模块 |
| `window.__CX_FORCE_PLAY.toolkit` | 共享工具库（错误卫士/存储/转义/DOM 辅助） | 所有工具库项、部分 engine |
| 文件内别名 `var ns = window.__CX_FORCE_PLAY` / `_ns` / `TK` | 同命名空间本地别名 | config.js、各工具库项（逐文件识别，不做全局别名） |

**铁律**：新增公开能力必须挂在 `window.__CX_FORCE_PLAY.<prop>` 或 `toolkit.<prop>`；消费方只能引用已挂载的 prop。
已删除的旧名（`__cxBridge`、`bridgeReady`）不得再被引用——多端联动消息 API 目前是**预留扩展点**（见 §8）。

### 7.2 共享工具库 `toolkit`（D1/D2/D3/D12 家族核心契约）

单点挂载于 `takeover/foundation/utils/utils.js` 的对象字面量，运行时优先复用、核心脚本未注入时回退本地最小实现。

| 成员 | 用途 | 挂载点 | 关键消费方 |
|------|------|--------|-----------|
| `toolkit.toast` | 轻提示入口，转发 `ui:toast`；渲染由 `presentation/toast.js` 负责，禁止重复定义实现 | utils.js | auto-next、registry、各面板 |
| `toolkit.dbg` / `toolkit.swallow` / `toolkit.safeCall` | 错误卫士原语 | utils.js | 全局 |
| `toolkit.throttle` | 节流（`debounce` 已删除，未使用） | utils.js | main-loop、quiz |
| `toolkit.escapeHTML` / `toolkit.isTextEntry` / `toolkit.isTopFrame` | DOM/文本辅助 | utils.js | 面板、engine |
| `toolkit.lsGet` / `lsSet` / `lsGetJSON` / `lsSetJSON` / `lsRemove` / `lsFlag` / `lsSetFlag` | localStorage 封装 | utils.js | 全局 |
| `toolkit.fetchWithTimeout` | 带超时的 fetch | utils.js | bridge、vision-deepseek-web |
| `toolkit.h` / `setSafeText` / `recentErrors` / `errorCount` | DOM 安全辅助/错误计数 | utils.js | 面板、diagnostics |
| `toolkit.keyRe` / `collectAttachmentIds` | 附件定向 | engine/targeting.js | engine |
| `toolkit.bridge` | 爬虫桥客户端（**仅桥客户端，无 send/status/onReady 消息 API**） | engine/bridge.js | video-ended-notify（预留扩展点） |

> D2 教训：工具库项曾误读 `window.__CX_FORCE_PLAY.toast`（不存在），正确挂载点是 `toolkit.toast`。

> 分层容错包装挂载在 `window.__CX_FORCE_PLAY.Guard`（`safeGet` / `bestEffort` / `safeDOM`），不是原型篡改防护。`guard.js` 先于 `utils.js` 创建工具库执行，外部调用者不得依赖 `toolkit.Guard` 必然存在。

### 7.3 顶层命名空间 API（按能力域）

| 能力域 | 成员 |
|---|---|
| 错误容错（`foundation/error-guard/guard.js`） | `Guard.safeGet` / `Guard.bestEffort` / `Guard.safeDOM`，均通过顶层 `window.__CX_FORCE_PLAY.Guard` 访问 |
| 元信息/配置（`foundation/meta-config/config.js`） | `CONFIG`（注意本地同名 `var CONFIG` 的作用域）、`DEBUG`、`reconcileIntrusionMode`、`getPauseNeutralized`、`getRateNeutralized`；`STYLES` 已迁至 `presentation/styles.js` |
| 站点适配（`foundation/site/site-router.js`） | `detectSite`、`currentSiteCfg`、`SITES`——站点隔离唯一入口（D4：读 `currentSiteCfg` 须加 `ns && ns.currentSiteCfg &&` 防御） |
| 引擎/接管（`engine/*`） | `forcePlayEnabled`；`BRIDGE`/`resolveBridgeBase`/`probeBridgeBase`/`bridgeFetch`/`bridgeInit`/`restoreNativePause`；`quizTick`/`quizObserveDispatch`/`QUIZ_*`/`quizStats`/`quizBank`；`QUIZ_VISION_*`/`quizVisionTick`；`DS_*`/`_dsInitResponder`/`DS_RESPONDER_ENABLED` |
| 作业/考试助手（`sites/zhihuishu-exam.js` 逻辑组，挂载在 `zhihuishu-exam-state.js`） | 顶层命名空间的 `zhihuishuExamEnabled`/`zhihuishuExamTick`/`zhihuishuExamAutoSubmitTick`/`zhihuishuExamSubmitNow`/`zhihuishuExamState`；事件接口为 `zhihuishuExamOnStateChange`/`zhihuishuExamOffStateChange`/`zhihuishuExamLastErrors`，不使用 `__cxZhExam*` 名称；DeepSeek 硬闸门 `dsAvailable()` 锁死作答与交卷 |
| 存储（`foundation/storage/storage.js`） | `savePanelCfg`/`loadPanelCfg`/`clampCfg`/`kvs` |
| 呈现/面板（`presentation/*`） | `buildInvasionReport`；`refreshPanelState`/`updateBadge`/`renderDashboard`/`renderVideoList`；`registerCommand`/`executeRawCmd`；`zhihuishuFabTick`；`ensurePanel`/`bindDSConsole` |
| localStorage 键约定 | `cx_popup_block`、`cx_popup_quiz`、`cx_panel_*`、`cx_ds_*` 等，统一经 `toolkit.lsGet/lsSet` 族读写 |

完整、机器生成的符号级清单见 §11。

### 7.4 私有凭据边界（C7.1）

`takeover/foundation/storage/credentials.js` 是主 IIFE 内部能力，不能按公开插件 API 挂载或消费。

| 条款 | 内容 |
|---|---|
| C7.1 | Key 与完整授权 Origin 只存于闭包及管理器私有记录；公开 CONFIG 仅保留空兼容字段。旧网页 Key 只可一次性读取后删除。导出/导入须过滤凭据类字段、嵌套凭据及含当前 Key 的键和值。只有重新输入非空 Key 才绑定经协议和白名单校验的 Origin；发送时校验与实际 URL 同源，凭据请求禁止重定向。 |

GM 缺失或写入失败时明确提示会话有效期；清理失败必须说明私有旧值仍需删除。网络错误及成功响应不得把 Key 带到日志、共享诊断或界面。静态门禁检查上述关键结构，真实数据流还需 `_sim/sim-private-credentials.js` 等行为回归。

视觉任务须在调用时取得原请求上下文，等待 GM 后与发送前复核许可，将 AbortSignal 贯穿请求与流式 reader。Key 保存私有不代表 RPC 信封私有；浏览器 `postMessage` / BroadcastChannel 的 `auth` 可被同源页面观察，边界见 [REVERSE_API.md](REVERSE_API.md)及 [SECURITY.md](../SECURITY.md)。

---

## 8. 预留扩展点（当前未实现，禁止当作已挂载 API 消费）

- **多端联动消息 API**：`toolkit.bridge` 目前仅暴露爬虫桥客户端（`probeBridgeBase`/`bridgeInit`/…），
  **没有 `send`/`status`/`onReady`**。因此 `video-ended-notify.js` 的 `getBridge()` 恒返回 `null`，
  整段桥消息逻辑是预留扩展点（注释已显式标注）；未来 `toolkit.bridge` 提供消息 API 后自动启用。
- 已删除旧名 `__cxBridge`、`bridgeReady` 不得再被引用（校验脚本的 `ALLOW` 仅作兜底，新增引用应直接报错）。

---

## 9. 历史契约缺陷（已修复，防止复发）

| 编号 | 缺陷 | 根因 | 修复 |
|------|------|------|------|
| D1 | 顶层重复定义 `toast` | 重构改了一端未同步另一端 | 删顶层重复定义，保留 `toolkit.toast` 单点 |
| D2 | 工具库项误读 `__CX_FORCE_PLAY.toast` | 调用名 ≠ 挂载名 | 改用 `toolkit.toast`，并加契约校验门禁 |
| D3 | 引用已删除 `__cxBridge/bridgeReady` | 旧桥名未清理 | 改为 `toolkit.bridge` 探测 + 预留扩展点注释 |
| D4 | tamper-guard 直接读未防御的 `currentSiteCfg` | 过度信任命名空间已注入 | 加 `ns && ns.currentSiteCfg &&` 防御 |
| D12 | 死代码 `debounce` 未接任何调用 | 重构漂移 | 删 `debounce` 及其导出 |
| R10 | 任一帧卸载都删顶层文档的共享面板 | 把"共享 DOM"当成"本帧私有 DOM"清理 | 仅顶层帧自身卸载时清共享 DOM；子帧只释放 owner（`lifecycle.js` `cleanup.dom`） |
| R11 | `ensurePanel` 返回已脱离文档的缓存节点 | 缓存只判非空、不判在册 | 缓存节点 `isConnected===false` 即丢弃重建（`panel-core.js`） |

---

## 10. 契约 ↔ 门禁 ↔ 回归用例映射

| 契约章节 | 门禁/用例 |
|---|---|
| 1 面板 owner、2 控件同步 | `_sim/sim-panel-owner.js`（单窗口伪造 owner）、`_sim/sim-multiframe.js`（真·双窗口同源 iframe） |
| 3 列表索引 | `_sim/sim-video-list-index.js` |
| 4 卸载还原 | `_sim/sim-uninstall.js`、`_sim/sim-uninstall-instance.js`、`_sim/sim-multiframe.js`（子帧卸载不得误伤存活帧） |
| 5 状态对偶还原 | `_sim/sim-ended-mute-restore.js` |
| 6.4 挂载↔读点一致 | 构建门禁 ④ `scripts/verify_contracts.js` |
| 7.4 私有凭据（C7.1） | 静态语义门禁及变异自检；`_sim/sim-private-credentials.js`，视觉/Reverse API 取消场景 |
| 11 挂载总表不漂移 | 构建门禁 ⑤ `scripts/verify_contract_doc.js` |
| **1–6 章及 C7.1 条款是否真被实现** | 构建门禁 ⑥ `scripts/verify_contract_semantics.js`（静态语义断言）+ `scripts/selftest_contract_semantics.js`（变异自检，防规则空转） |

运行方式：`powershell -ExecutionPolicy Bypass -File scripts/build.ps1`（在项目根目录执行，构建即跑全部门禁）；
单独重生成挂载总表：`npm run contract:doc`（在 `apps/userscript/` 下）。

---

## 11. 命名空间挂载点总表（自动生成）

<!-- AUTO:MOUNTS:BEGIN -->

> 本区块由 `apps/userscript/scripts/verify_contract_doc.js` 自动生成，请勿手改；
> 新增/删除挂载点后运行 `npm run contract:doc` 重新生成，构建门禁 ⑤ 会校验一致性。

| 符号（`window.__CX_FORCE_PLAY.<符号>` / `toolkit.<符号>`） | 挂载文件 | 跨文件消费方 |
|---|---|---|
| `CAT` | takeover/foundation/storage/data-governance.js | —（仅挂载侧使用） |
| `CONFIG` | takeover/foundation/meta-config/prototype-controls.js | plugins/addons/auto-next.js<br>plugins/addons/tamper-guard.js<br>presentation/panel.js<br>…(+1) |
| `CoreState` | takeover/foundation/state/runtime.js | plugins/addons/auto-next.js<br>plugins/addons/video-ended-notify.js<br>takeover/engine/quiz-vision-endpoint.js<br>…(+1) |
| `DEEPSEEK` | takeover/engine/vision-deepseek-bootstrap.js | takeover/engine/vision-deepseek-compose.js<br>takeover/engine/vision-deepseek-messages.js |
| `DS_ANSWER_COUNT` | takeover/engine/vision-deepseek-request.js<br>takeover/engine/vision-deepseek-responder.js | —（仅挂载侧使用） |
| `DS_ASK_COUNT` | takeover/engine/vision-deepseek-request.js<br>takeover/engine/vision-deepseek-responder.js | —（仅挂载侧使用） |
| `DS_LAST_ANSWER` | takeover/engine/vision-deepseek-request.js<br>takeover/engine/vision-deepseek-responder.js | presentation/diagnostics.js |
| `DS_LAST_ASK` | takeover/engine/vision-deepseek-request.js<br>takeover/engine/vision-deepseek-responder.js | presentation/diagnostics.js |
| `DS_RESPONDER_ENABLED` | presentation/panel-ds-console.js | presentation/diagnostics.js<br>takeover/engine/vision-deepseek-responder.js |
| `DS_STATUS` | takeover/engine/vision-deepseek-bootstrap.js | presentation/diagnostics.js |
| `FLAGS` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `Guard` | takeover/foundation/error-guard/guard.js | —（仅挂载侧使用） |
| `KEYS` | takeover/foundation/storage/keys.js | plugins/addons/auto-next.js<br>plugins/addons/quiet-popups.js<br>plugins/addons/zhihuishu-auto-next.js |
| `POPUP_BASE` | sites/popup-quiz.js | sites/zhihuishu.js |
| `QUIZ_SRC_WEIGHT` | takeover/engine/quiz-merge.js | —（仅挂载侧使用） |
| `REVERSE_API` | takeover/engine/reverse-api.js | —（仅挂载侧使用） |
| `SAFETY` | takeover/engine/safety.js | plugins/addons/auto-next.js |
| `TimerRegistry` | takeover/bootstrap/core.js | plugins/addons/auto-next-lifecycle.js<br>plugins/addons/tamper-guard.js<br>presentation/diagnostics-quiz-engine.js<br>…(+15) |
| `__dsAskTryCount` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `__dsEnsureChannel` | takeover/engine/vision-deepseek-bootstrap.js | takeover/engine/quiz-tick.js |
| `__emitDsChannel` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `__lastDsAskReqId` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `__resetDsAskTryCount` | takeover/engine/vision-deepseek-bootstrap.js | takeover/engine/quiz-exports.js |
| `__setDsAskRetry` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `__setDsLastReplyBefore` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsConfToNum` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsEvictAll` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsIsLoggedIn` | takeover/engine/vision-deepseek-bootstrap.js | presentation/diagnostics.js |
| `_dsLastAskHadImage` | takeover/engine/vision-deepseek-responder.js | —（仅挂载侧使用） |
| `_dsLatestReply` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsLatestReplyTextOnly` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsLoopStats` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsParseAnswer` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsReadConfidence` | takeover/engine/vision-deepseek-bootstrap.js | takeover/engine/quiz-vision-recover.js |
| `_dsRenderStatus` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `_dsResponderState` | takeover/engine/vision-deepseek-bootstrap.js | presentation/diagnostics-quiz-engine.js |
| `_getCoordinator` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `_mediaSessionHooked` | takeover/bootstrap/main-loop.js<br>takeover/dom/dom.js<br>takeover/dom/lifecycle.js | presentation/diagnostics-audit.js |
| `_moStats` | takeover/dom/dom.js | —（仅挂载侧使用） |
| `_origDsAvailable` | takeover/engine/vision-deepseek-bootstrap.js | takeover/dom/lifecycle.js |
| `_origDsIsLoggedIn` | takeover/engine/vision-deepseek-bootstrap.js | takeover/dom/lifecycle.js |
| `_pauseNeutralized` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `_quizAnswerParse` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `_quizDecodeSecretText` | takeover/engine/quiz-vision-recover.js | —（仅挂载侧使用） |
| `_quizEnsureVisible` | takeover/engine/quiz-vision-recover.js | —（仅挂载侧使用） |
| `_quizSchedStats` | takeover/engine/quiz-exports.js | presentation/diagnostics-quiz-engine.js<br>presentation/diagnostics-quiz-status.js |
| `_quizVisConfAction` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `_rateNeutralized` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `_resetProbeGuard` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `_reverseApiStarted` | takeover/engine/reverse-api.js | —（仅挂载侧使用） |
| `_secretDecodeStats` | takeover/engine/quiz-vision-recover.js | presentation/diagnostics-quiz-engine.js |
| `_toastFeedDebug` | presentation/panel-toast-feed.js | presentation/diagnostics-panel.js |
| `_uninstallHooked` | takeover/dom/lifecycle.js | presentation/diagnostics-audit.js |
| `acknowledge` | takeover/bootstrap/warmup.js | —（仅挂载侧使用） |
| `active` | takeover/bootstrap/warmup.js | —（仅挂载侧使用） |
| `aiProblems` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `answerSource` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `answered` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `applyLoopAll` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `applyTakeoverNow` | takeover/bootstrap/main-loop-scheduler.js | —（仅挂载侧使用） |
| `bridge` | takeover/engine/bridge.js | plugins/addons/video-ended-notify.js<br>presentation/diagnostics-audit.js |
| `bridgeEnabledByConfig` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `bridgeInit` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `buildDevReport` | presentation/diagnostics-audit.js | —（仅挂载侧使用） |
| `buildDevReportText` | presentation/diagnostics-audit.js | —（仅挂载侧使用） |
| `buildFeatureSelfTest` | presentation/diagnostics-audit.js | presentation/panel.js |
| `buildInvasionReport` | presentation/diagnostics-audit.js | —（仅挂载侧使用） |
| `chaoxingTickQuiz` | sites/chaoxing-exam.js | —（仅挂载侧使用） |
| `cleared` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `collectAttachmentIds` | takeover/engine/targeting.js | —（仅挂载侧使用） |
| `confidence` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `currentSiteCfg` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `cxMetricsSnapshot` | takeover/foundation/state/metrics.js | —（仅挂载侧使用） |
| `dataGovernance` | takeover/foundation/storage/data-governance.js | presentation/commands.js<br>presentation/diagnostics-quiz-status.js<br>takeover/bootstrap/main-loop-tick.js<br>…(+1) |
| `dbg` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `decisionFor` | takeover/engine/quiz-merge.js | —（仅挂载侧使用） |
| `detectSite` | takeover/foundation/meta-config/prototype-controls.js<br>takeover/foundation/site/site-router.js | plugins/addons/auto-next.js<br>plugins/addons/keyboard-shortcuts.js<br>plugins/addons/tamper-guard.js<br>…(+4) |
| `done` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `doneAll` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `dsAvailable` | takeover/engine/vision-deepseek-bootstrap.js | presentation/diagnostics.js |
| `errorCount` | takeover/foundation/state/metrics.js<br>takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `escapeHTML` | takeover/foundation/utils/utils.js | takeover/engine/foreground.js |
| `evict` | takeover/foundation/storage/data-governance.js | —（仅挂载侧使用） |
| `evictAll` | takeover/foundation/storage/data-governance.js | —（仅挂载侧使用） |
| `fetchWithTimeout` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `fillCount` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `getPauseNeutralized` | takeover/foundation/meta-config/prototype-controls.js | plugins/addons/tamper-guard.js<br>presentation/diagnostics-audit.js<br>presentation/panel.js |
| `getRateNeutralized` | takeover/foundation/meta-config/prototype-controls.js | plugins/addons/tamper-guard.js<br>presentation/diagnostics-audit.js |
| `h` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `icourse163TickQuestions` | sites/icourse163.js | —（仅挂载侧使用） |
| `icveTickQuestions` | sites/icve.js | —（仅挂载侧使用） |
| `ilabxTickQuiz` | sites/ilabx.js | —（仅挂载侧使用） |
| `installPlaybackRateNeutralize` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `installPrototypePauseNeutralize` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `isChaoxingHost` | takeover/foundation/utils/url.js | —（仅挂载侧使用） |
| `isEffectiveTopFrame` | takeover/bootstrap/main-loop-scheduler.js | —（仅挂载侧使用） |
| `isQuietPopups` | presentation/toast.js | plugins/addons/keyboard-shortcuts.js<br>plugins/addons/quiet-popups.js<br>plugins/addons/tamper-guard.js<br>…(+1) |
| `isTakeoverActive` | takeover/bootstrap/main-loop-scheduler.js | presentation/diagnostics-audit.js |
| `isTextEntry` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `isTopFrame` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `keyRe` | takeover/engine/targeting.js | —（仅挂载侧使用） |
| `kvs` | takeover/foundation/storage/storage.js | —（仅挂载侧使用） |
| `lastAnswerTs` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `lastEvict` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `length` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `levels` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `listCommands` | presentation/commands-palette.js | —（仅挂载侧使用） |
| `listDisabledCourses` | takeover/bootstrap/main-loop-scheduler.js | —（仅挂载侧使用） |
| `lsFlag` | takeover/foundation/utils/utils.js | plugins/addons/quiet-popups.js |
| `lsGet` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `lsGetJSON` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `lsRemove` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `lsSet` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `lsSetFlag` | takeover/foundation/utils/utils.js | plugins/addons/quiet-popups.js |
| `lsSetJSON` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `maxSeq` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `mergeAnswers` | takeover/engine/quiz-merge.js | —（仅挂载侧使用） |
| `offline` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `pendingAI` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `pendingSubmit` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `popupQuizBlock` | sites/popup-quiz.js | —（仅挂载侧使用） |
| `popupQuizStats` | sites/popup-quiz.js | presentation/dashboard.js |
| `popupQuizTick` | sites/popup-quiz.js | —（仅挂载侧使用） |
| `popups` | sites/popup-quiz.js | —（仅挂载侧使用） |
| `probeBridgeBase` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `probePauseNeutralized` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `probeRateNeutralized` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `probeState` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `pushToastFeed` | presentation/panel-toast-feed.js | takeover/engine/vision-deepseek-responder.js |
| `quizAIProblems` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `quizAiDiag` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `quizAskDeepSeek` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `quizAutoStartOn` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `quizBank` | takeover/engine/quiz-answer-sources.js<br>takeover/engine/quiz-review.js | presentation/diagnostics-panel.js<br>sites/zhihuishu-exam.js<br>takeover/engine/quiz.js |
| `quizCacheEvict` | takeover/engine/quiz-exports.js | takeover/bootstrap/main-loop-tick.js |
| `quizDisconnect` | takeover/engine/quiz-exports.js | takeover/dom/lifecycle.js |
| `quizHardReset` | takeover/engine/quiz-exports.js | takeover/bootstrap/main-loop.js |
| `quizLights` | takeover/engine/quiz-exports.js | presentation/dashboard-render.js |
| `quizLightsRemote` | takeover/engine/vision-deepseek-bootstrap.js<br>takeover/engine/vision-deepseek-responder.js<br>takeover/engine/vision-deepseek-web.js | presentation/dashboard-render.js |
| `quizLightsRemoteTs` | takeover/engine/vision-deepseek-bootstrap.js<br>takeover/engine/vision-deepseek-responder.js<br>takeover/engine/vision-deepseek-web.js | presentation/dashboard-render.js |
| `quizManualStart` | takeover/engine/quiz-exports.js | presentation/panel-controls-quiz.js |
| `quizManualSubmit` | takeover/engine/quiz-exports.js | presentation/panel-controls-quiz.js |
| `quizMerge` | takeover/engine/quiz-merge.js | —（仅挂载侧使用） |
| `quizObserve` | takeover/engine/quiz-exports.js | presentation/diagnostics-quiz-status.js |
| `quizObserveDispatch` | takeover/bootstrap/main-loop-scheduler.js | takeover/engine/quiz-submit-observer.js<br>takeover/engine/quiz-tick-finalize.js |
| `quizPageSubmitted` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `quizRecover` | takeover/engine/quiz-vision-recover.js | —（仅挂载侧使用） |
| `quizRemoteTick` | takeover/engine/quiz-lights.js | presentation/diagnostics-quiz-status.js |
| `quizReviewAccept` | takeover/engine/quiz-review.js | —（仅挂载侧使用） |
| `quizReviewExport` | takeover/engine/quiz-review.js | —（仅挂载侧使用） |
| `quizReviewList` | takeover/engine/quiz-review.js | —（仅挂载侧使用） |
| `quizScanOnce` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `quizSnapshot` | takeover/engine/quiz-vision-recover.js | —（仅挂载侧使用） |
| `quizStats` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-fill-submit.js<br>takeover/engine/quiz-tick-finalize.js<br>takeover/engine/quiz.js | plugins/addons/auto-next-lifecycle.js<br>presentation/dashboard.js<br>presentation/diagnostics-quiz-status.js<br>…(+1) |
| `quizSubmitPending` | takeover/engine/quiz-exports.js | presentation/panel-controls-data.js |
| `quizSyncGate` | takeover/engine/quiz-exports.js | presentation/panel-controls-quiz.js |
| `quizTick` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `quizVisionDeepSeekStop` | takeover/engine/vision-deepseek-bootstrap.js | takeover/dom/lifecycle.js |
| `reason` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `recentErrors` | takeover/foundation/state/metrics.js<br>takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `reconcileIntrusionMode` | takeover/foundation/meta-config/prototype-controls.js | presentation/zhihuishu-fab.js |
| `registerBucket` | takeover/foundation/storage/data-governance.js | —（仅挂载侧使用） |
| `registerPopupQuizEnded` | sites/popup-quiz.js | —（仅挂载侧使用） |
| `registerPopupQuizSite` | sites/popup-quiz.js | —（仅挂载侧使用） |
| `registerSiteTick` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `remaining` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `renweiTickQuiz` | sites/renwei.js | —（仅挂载侧使用） |
| `restartLoopTimer` | takeover/bootstrap/main-loop-scheduler.js | presentation/commands.js<br>presentation/panel-core-events.js |
| `restorePrototypeNeutralization` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `restorePrototypePause` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `restorePrototypeRate` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `reverseApiHandle` | takeover/engine/reverse-api.js | —（仅挂载侧使用） |
| `reverseApiStatus` | takeover/engine/reverse-api.js | —（仅挂载侧使用） |
| `reverseApiStop` | takeover/engine/reverse-api.js | takeover/dom/lifecycle.js |
| `reviewCount` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `routeBySite` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `runSiteTick` | takeover/foundation/site/site-router.js | takeover/bootstrap/main-loop-scheduler.js<br>takeover/engine/quiz-exports.js |
| `safeCall` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `safetyDetect` | takeover/engine/safety.js | —（仅挂载侧使用） |
| `safetyResume` | takeover/engine/safety.js | —（仅挂载侧使用） |
| `safetyScan` | takeover/engine/safety.js | —（仅挂载侧使用） |
| `safetyTrip` | takeover/engine/safety.js | —（仅挂载侧使用） |
| `scanned` | takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `seqConsistent` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `setQuietPopups` | presentation/toast.js | plugins/addons/quiet-popups.js |
| `setQuizAskDeepSeekOverride` | takeover/engine/vision-deepseek-bootstrap.js | —（仅挂载侧使用） |
| `setQuizRecoverOverride` | takeover/engine/quiz-vision-recover.js | —（仅挂载侧使用） |
| `setQuizSnapshotOverride` | takeover/engine/quiz-vision-recover.js | —（仅挂载侧使用） |
| `setSafeText` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `setTakeoverEnabled` | takeover/bootstrap/main-loop-scheduler.js | presentation/panel-controls.js |
| `settled` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `singleVideoActive` | takeover/bootstrap/main-loop-scheduler.js | presentation/diagnostics-panel.js |
| `siteAnanas` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `siteAttachments` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `siteAttachmentsKey` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `siteTaskContainerSel` | takeover/foundation/site/site-router.js | —（仅挂载侧使用） |
| `snapshot` | takeover/foundation/storage/data-governance.js | —（仅挂载侧使用） |
| `source` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `started` | takeover/bootstrap/core.js | —（仅挂载侧使用） |
| `stopLoopTimer` | takeover/bootstrap/main-loop-scheduler.js | —（仅挂载侧使用） |
| `strictMode` | takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `swallow` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `throttle` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `toast` | takeover/foundation/utils/utils.js | —（仅挂载侧使用） |
| `toastFeedRecent` | presentation/panel-toast-feed.js | presentation/diagnostics-panel.js |
| `toggleCourseSingleVideo` | takeover/bootstrap/main-loop-scheduler.js | presentation/commands.js<br>presentation/panel-controls.js |
| `toggleCourseTakeover` | takeover/bootstrap/main-loop-scheduler.js | presentation/panel-controls.js |
| `toolkit` | takeover/engine/bridge.js<br>takeover/foundation/utils/utils.js | plugins/addons/auto-next.js<br>plugins/addons/keyboard-shortcuts.js<br>plugins/addons/video-ended-notify.js<br>…(+2) |
| `ts` | sites/popup-quiz.js<br>takeover/engine/quiz-exports.js<br>takeover/engine/quiz-tick-finalize.js | —（仅挂载侧使用） |
| `ucampusTickQuiz` | sites/ucampus.js | —（仅挂载侧使用） |
| `uninstall` | takeover/dom/lifecycle.js | takeover/bootstrap/main-loop.js |
| `unipusTickQuiz` | sites/unipus.js | —（仅挂载侧使用） |
| `unregister` | takeover/foundation/storage/data-governance.js | —（仅挂载侧使用） |
| `unsettled` | takeover/engine/quiz-exports.js | —（仅挂载侧使用） |
| `usePrototypeNeutralize` | takeover/foundation/meta-config/prototype-controls.js | —（仅挂载侧使用） |
| `validateBridgePlaylist` | takeover/engine/bridge.js | —（仅挂载侧使用） |
| `variant` | takeover/bootstrap/warmup.js | —（仅挂载侧使用） |
| `version` | presentation/panel.js | presentation/diagnostics.js<br>sites/zhihuishu-exam-state.js<br>takeover/engine/reverse-api.js |
| `videoDriftStableKeys` | takeover/bootstrap/main-loop-scheduler.js | —（仅挂载侧使用） |
| `warmup` | takeover/bootstrap/warmup.js | presentation/panel-controls-quiz.js<br>sites/popup-quiz.js |
| `watchStats` | takeover/engine/stats.js | —（仅挂载侧使用） |
| `xuetangxTickQuestions` | sites/xuetangx.js | —（仅挂载侧使用） |
| `zhihuishuExamAutoSubmitTick` | sites/zhihuishu-exam-state.js | sites/zhihuishu.js |
| `zhihuishuExamEnabled` | sites/zhihuishu-exam-state.js | presentation/diagnostics-panel.js<br>sites/zhihuishu.js |
| `zhihuishuExamLastErrors` | sites/zhihuishu-exam-state.js | —（仅挂载侧使用） |
| `zhihuishuExamOffStateChange` | sites/zhihuishu-exam-state.js | —（仅挂载侧使用） |
| `zhihuishuExamOnStateChange` | sites/zhihuishu-exam-state.js | —（仅挂载侧使用） |
| `zhihuishuExamState` | sites/zhihuishu-exam-state.js | presentation/diagnostics-panel.js<br>presentation/zhihuishu-fab.js |
| `zhihuishuExamSubmitNow` | sites/zhihuishu-exam-state.js | presentation/zhihuishu-fab.js |
| `zhihuishuExamTick` | sites/zhihuishu-exam-state.js | sites/zhihuishu.js |
| `zhihuishuFabTick` | presentation/zhihuishu-fab.js | presentation/panel-controls-quiz.js |
| `zhihuishuTickQuestions` | sites/zhihuishu.js | —（仅挂载侧使用） |
| `zhsAllowEndedReplay` | plugins/addons/zhihuishu-auto-next.js | takeover/dom/dom.js |

合计：**233** 个挂载符号。

<!-- AUTO:MOUNTS:END -->

---

## 12. 拼接式 IIFE 内的裸全局跨模块契约（自动生成 + 显式注解）

> 本工程所有源文件拼接进同一个 IIFE（`core.js` 开启、构建末尾闭合），跨文件依赖历史上靠
> **隐式裸全局**（如 `CONFIG` / `EventBus` / `bestEffort` / `safeGet` / `detectSite` …），
> 无模块系统、无 import/export，重构极易「改名一处、崩一片」却无报错（即早期架构审查问题 #2）。
>
> 显式化方案（构建门禁 ⑧ `apps/userscript/scripts/verify_cross_module.js`）：
> 1. **推断**：作用域感知扫描每个模块的声明（`@provides`）与使用（`@requires`）裸全局；
> 2. **声明式校验**：源码通过 `// @provides:` / `// @requires:` 注解把关键契约**显式化**，
>    门禁校验「注解的符号确有声明 / 确有提供方 / 不重复提供」；
> 3. **文档漂移守护**：[`CROSS_MODULE_CONTRACT.md`](./CROSS_MODULE_CONTRACT.md) 由脚本
>    `--emit-doc` 自动生成，`--check-doc` 校验其与源码一致（契约变更须重新生成并提交）；
> 4. **变异自检**：`--selftest` 构造故意违约源码，断言门禁能检出（防规则空转假绿灯）。
>
> 维护命令（开发期，不入构建）：
> - 重建依赖映射表：`node apps/userscript/scripts/verify_cross_module.js --emit-doc`
> - 重新播种显式注解：`node apps/userscript/scripts/verify_cross_module.js --seed`
>   （仅针对被 ≥3 个模块引用的「骨干」全局；每个符号只在规范提供方标注一次，
>    重复提供歧义仍保留在映射表「共享全局 → 声明模块」中供人工审查，不掩埋）
>
> 完整符号级清单见 [`CROSS_MODULE_CONTRACT.md`](./CROSS_MODULE_CONTRACT.md)。
