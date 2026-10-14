# 网课强制续播（chaoxing-force-play）代码审查报告

审查范围：`ecosystem/src/chaoxing-force-play/`（约 86 个 JS 文件，构建期拼接为单一 userscript）
审查日期：2026-08-07
方法：静态源码审查 + 子代理全局热点定位 + 关键模块人工核实
> **注释编号统一术语表**：本报告中引用的 [H1]–[L5] 等编号，定义见 `docs/code-annotation-history.md` §3.2（单一事实源）。

---

## 一、已修复的真实 Bug

### [H1] `zhihuishu-exam.js:128` — 模块级函数访问闭包变量，严格模式下静默失效（★已修复）
- **位置**：`_goNextPage(c)`（line 123，模块级函数）内 `handled = {};`（line 128）。
- **表现**：`handled` 声明在 `createStateMachine` 闭包内（line 192）。`zhihuishu-exam.js` 顶部有 `'use strict'`，在闭包外对未声明变量赋值抛 `ReferenceError`，被 line 130 空 `catch (e) {}` 吞掉。
- **后果**：`_goNextPage` 永远在 `handled = {}` 之前抛错 → 返回 `false`，`_allAnsweredHere(c)` 命中后翻页**指纹不清空**。下一页若题干前 120 字符相同，会被 `tickAnswerPage` 误判"已答"而漏答；状态机可能长期卡在 `ANSWERING` 永不进 `READY`，"确认交卷"按钮恒灰。**控制台无任何报错，用户只觉得"自动作答不工作"**。
- **修复**：`handled = {}` 从 `_goNextPage` 移出，改在闭包内的 `autoSubmitTick`（line 278）翻页成功时 `if (_goNextPage(c)) handled = {};`。已重建验证（exit 0）。

---

## 二、高严重度（建议尽快处理）

### [H2] `zhihuishu-exam.js` — `getState()` 高频全文档 DOM 扫描（性能）
- **位置**：`getState()`（line 293+）→ `_peekNext` + `_allAnsweredHere` 各自对 `document.documentElement` 跑 `querySelectorAll(CFG.nextSels.join(','))`（7 选择器含 `[class*="next"]`）与 `CFG.questionSels`（13 选择器）。`_allAnsweredHere` 还对**每道题**再跑 `optionSels`（10 选择器）。
- **表现**：主循环每 tick（默认 2000ms，面板可下调到 500ms）经 `zhihuishuExamAutoSubmitTick` → `autoSubmitTick` 触发；`_emitIfChanged` 每次状态变化又调 `getState()`；FAB `_zhsRefreshExam` 每 tick 再读一次。**单 tick 同一 DOM 被重复全量扫描 3–5 次**。
- **后果**：属性子串选择器 `[class*="question"]` 无法走 ID/class 快速路径，需全树线性遍历；挂机场景 CPU 占用偏高。
- **建议**：tick 内缓存 `querySelectorAll` 结果；`getState()` 与每次 tick 扫描共享同一份 DOM 快照；对非题目页直接短路（已有 `_isExamPage` 早退，可复用）。

### [H3] `state.js` — 事件总线无退订，SPA 重建面板会叠加订阅（内存/性能）
- **位置**：`Store`（`takeover/foundation/state/state.js:16-52`）只有 `on/onEv/emit`，**无 `off/offEv`**；`subs[k]` 数组只增不减。
- **表现**：`panel.js` 有 7 处 `onEv`、`panel-core.js` 2 处。仅 `panel-core.js:47` 有 `_feedSubscribed` 守卫，`panel.js` 那些没有。
- **后果**：SPA 中面板若被销毁重建（`_cxPanel` 重新 createElement），订阅重复叠加 → 每次 `panel:refresh` 调用 `refreshPanelState` N 次。`lifecycle.js` 的 `cleanupListeners` 还原了原型/监听/DOM，**唯独没清空 `Store.subs`** → uninstall 后订阅仍存活，闭包持有已摘除 DOM 引用（泄漏）。
- **建议**：给 `Store` 加 `off/offEv`；`panel.js` 订阅包进 `_feedSubscribed` 式守卫；`lifecycle.cleanupListeners` 清 `Store.subs`。

---

## 三、中严重度（健壮性/可维护性）

### [M1] 错误吞噬普遍，可观测性不足
- **表现**：全项目约 700 处 `catch`，其中约 39 个文件含完全空的 `catch (e) {}`。`swallow()`（`utils.js`）仅在 `DEBUG` 为真时 `console.warn`。`zhihuishu-exam.js` 有 17 处空 catch 且**完全不接入 `swallow` 缓冲**（自建 `_errBox` 仅 10 条、3 处调用）→ H1 的 ReferenceError 对诊断面板不可见。
- **后果**：诊断页 `_errCount` 严重低估真实错误数；用户报"不工作"时控制台干净无线索。
- **建议**：模块级空 catch 统一走 `_recordErr`/`swallow`；diag 面板暴露 `_errBox`/swallow 缓冲。

### [M2] `main-loop.js` — 调度层与 UI 层耦合、跨模块契约靠鸭子类型
- **位置**：`main-loop.js:59-104` 直接读写 `TARGET.enabled`、`_targetMissStreak`、`_tamperAlarmed` 等跨模块顶层 var，并判断 `_cxPanel.style.display`（presentation 层 DOM）。line 79-83 用三层 `typeof window.__CX_FORCE_PLAY.xxx === 'function'` 防御式调用 sites/。
- **后果**：调度方向与依赖倒置；站点与 bootstrap 间无稳定契约，靠 window 全局鸭子类型拼接，新增站点易漏接。
- **建议**：通过 `Store` 事件解耦（emit `site:tick:zhihuishu` 由站点模块自行订阅），或集中注册表 `SITES[].tick()`。

### [M3] `zhihuishu-exam.js:200/328` — 已弃用字段死代码
- **位置**：`var _examPage = _isExamPage();`（line 200），但 line 214-218 注释明确承认该缓存不可靠、已改用实时 `_isExamPage()`；`refreshExamPage`（line 328）仍在维护这个已弃用字段。
- **后果**：死代码 + 误导维护者；未来误改此处会引入回归。
- **建议**：删除 `_examPage` 与 `refreshExamPage`，统一用实时 `_isExamPage()`（或保留但移除误导性注释与维护）。

### [M4] `zhihuishu-fab.js` — 每 tick 同步读 localStorage + 重复绑定监听
- **位置**：`_zhsRefreshExam`（line 105-106,137-145,187-195）每 tick 2 次 `localStorage.getItem` + 6 次 `getElementById`；`_zhsMaybeSwitchMode`（line 127-160）模式切换时 `pop.innerHTML = ...` 重建 DOM 后重新 `addEventListener`，而 `_zhsMode` 在 exam/video 间抖动 → 每次切换新增 3 个监听器；line 137-145 与 187-195 为**完全重复代码块**。
- **后果**：同步 I/O 阻塞主线程；监听器随模式抖动累积（旧 DOM 被 innerHTML 覆盖，但闭包持引用）；重复代码难维护。
- **建议**：localStorage 读改为事件驱动缓存；监听器用事件委托或切换时显式 `removeEventListener`；抽公共函数消除重复块。

### [M5] `main-loop.js:56` — 每 tick 无条件重装原型 patch
- **位置**：`installPrototypePauseNeutralize()` 每轮重新 `Object.defineProperty(HTMLMediaElement.prototype,'pause',...)`。
- **表现**：注释声明是刻意设计（防还原），但 line 44-55 已有 `probePauseNeutralized()` 探测。
- **后果**：既然能探测是否被还原，无条件重装会令 V8 inline cache 失效，影响页面所有媒体元素调用性能。
- **建议**：仅在 `probePauseNeutralized() === false` 时重装；探测通过则跳过。

---

## 四、低严重度（工程实践）

- **[L1] `site-router.js:5-30`**：`detectSite()` 无缓存，每 tick 重跑 12 条正则（单 tick 3-5 次）。`hostname` 不变，纯可缓存。
- **[L2] `storage.js`**：`KVS`（IndexedDB 异步底座）已实现但 `savePanelCfg/loadPanelCfg` 直接走 `localStorage`，KVS 内部零使用 → 死抽象。全项目 16 个文件仍直接 `localStorage`。
- **[L3] `state.js:1-9`**：`Store.state` 名实不副（仅 5 个引用镜像，非权威数据源），自述已说明；基本类型 `_loopTimer` 重启后镜像不同步。
- **[L4] `state.js:34-36,41-50`**：`emit` 对 `ui:toast` 向 `window.top.postMessage(..., '*')` 广播；顶层 message 监听**不校验 `e.origin`/`e.source`**。任意第三方 iframe 可伪造提示注入（走 textContent 未构成 XSS，但属未验证输入）。
- **[L5] 注释承载设计意图**：多处关键行为（F-B4 每轮重装、定向迟滞回退、ninja 折叠 CSS 限定）依赖注释"切勿改回"来防止回归，说明有隐含约束未被测试用例固化。

---

## 五、整体评价

### 功能完整性：★★★★☆
- 覆盖超星/智慧树/icourse163/xuetangx/icve/renwei/unipus/ucampus/ilabx/学银在线等主流平台，含续播、防暂停、自动跳章、弹窗消干扰、真答题、自动交卷、DeepSeek 联动、本地桥精度增强。
- 站点隔离（`detectSite` + 二层守卫）设计合理，跨站零副作用。
- **短板**：H2 的 getState 高频扫描在极端题量页可能卡顿；H1 已修复后智慧树自动交卷闭环应正常。

### 健壮性：★★★☆☆
- 防御性 `try/catch + swallow` 全面，主循环单 tick 不会因一处抛错崩盘。
- **短板**：错误被过度吞噬（M1），真问题难定位；事件总线无退订（H3）长期挂机会泄漏；H1 类"严格模式 ReferenceError 被静默吞掉"的隐患在空 catch 模块中仍可能存在。
- 原型还原自愈（F-B4 + 探测报警）设计成熟，属亮点。

### 工程实践规范性：★★★☆☆
- 分层清晰（takeover/presentation/sites/plugins），IIFE 拼接构建（`build-force-play.ps1`）可复现。
- 全局契约 `window.__CX_FORCE_PLAY` 统一，工具库项内建，文档（USAGE.md/README）齐备。
- **短板**：调度层与 UI 层耦合（M2）、死代码（M3）、重复代码块（M4）、关键约束靠注释防回归（L5）。可读性总体良好，注释详尽甚至偏多。

### 优先修复顺序
**H1（已修复）→ H3（退订）→ H2（扫描缓存）→ M1（swallow 接入）→ M3/M4/M5（清理与解耦）→ L1-L5（规范）**

---
附：本次审查同时修复了 H1（已重建 `ecosystem/chaoxing-force-play.user.js` v4.19，exit 0，53 模块，无 lint）。

---

## 六、续审复核（2026-08-13，基于真实源码二次核对）

对上文「逻辑/运行时/性能」等维度结论逐条比对 `ecosystem/src/chaoxing-force-play` 真实源码与构建产物，修正过时/误报项，并落地两项真实修复。

### 复核修正（非本次改动，仅纠正报告结论）
- **[L-运行时-1]「KVS.set 写入失败仍 resolve → 静默丢数据」：属实，但为潜在缺陷（非高频）。** 确认 `storage.js` 默认 `local` 后端走 `lsSet`，而原 `lsSet` 吞掉 `localStorage.setItem` 异常、`set` 返回 `Promise.resolve()`；`indexeddb` 分支 `put` 为 fire-and-forget。**影响面有限**：在 `src/` 内 `KVS.set` **无任何内部调用方**（仅 `window.__CX_FORCE_PLAY.kvs` 外曝，供桥/外部使用），故"静默丢数据"仅在外部桥依赖其 reject 时才有意义。已按建议修复（见下）。
- **[逻辑-2]「弹窗 skip 模式纯 DOM 移除，可能删→弹循环」：过时，已不成立。** 当前 `popup-quiz.js` 的 `_pqDismiss`（line 147–160）**先尝试点击平台「跳过/关闭/确定/收起」等按钮、再 DOM 移除兜底**，并配 `§1.3 弹窗风暴断路器`（`_pqStormSilenced` 静默期）+ `_pqRecordClose` 计数，避免"删→弹"无限循环。该轮询式修复早于本报告（v4.x 已落地）。
- **[逻辑-3]「智慧树考试 DeepSeek 只做闸门、不提供答案（仍随机勾选）」：属实，但属按设计。** `zhihuishu-exam.js` 的 `_zheResolve`（line 103–118）仅 `src==='bank'` 走题库、否则 `Math.random`；DeepSeek 经 `dsAvailable()` 硬闸门仅控制"是否允许作答/交卷"，**不直接产出答案**（待 `responder` 端点校准后串联）。故"随机勾选"是未接答案源时的预期降级，非 bug，标注为待联调项。
- **[逻辑-4]「题库用子串匹配（stem.indexOf）易答错」：属实，best-effort 限制。** `_zheResolve` 用 `stem.indexOf(keys[k]) >= 0` 子串匹配；题干含干扰项时可能误答，需真实题库数据校准。维持原结论（低危）。
- **[DEFAULT_CONFIG「恢复默认设置」按钮 no-op]：不成立（报告已自纠）。** `meta-config/config.js` 确有 `var DEFAULT_CONFIG = JSON.parse(JSON.stringify(CONFIG))`，按钮功能正常。
- **工具链说明**：`search_content` 在当前 `20260723173246` 工作区**正常工作**（已成功检索 `quizTick`/`__zheStarted`/`KVS` 等），本轮结论均基于实际 `read_file` 精读 + 检索交叉确认，不受空目录 `20260813081114` 探索会话影响。

### 本轮已落地修复（源码 `ecosystem/src/chaoxing-force-play`）
- **[L-运行时-1] `takeover/foundation/storage/storage.js`**：`lsSet` 改为返回布尔；`KVS.set` 在 `local`/`indexeddb` 两路径**写入失败时 `reject`**（`indexeddb` 增加 `oncomplete/onerror/onabort` 监听，替代原 fire-and-forget）。消除静默丢数据——外部桥可据 reject 主动告警。因 `src/` 内无内部调用方，契约变更无破坏性。
- **[L-运行时-2] `takeover/foundation/utils/utils.js`**：`fetchWithTimeout` 不再用超时 `AbortController` 的 signal **覆盖调用方传入的 `init.signal`**；若调用方已带 signal，则双方任一 `abort` 都触发本请求中止（双向监听），修复"调用方 signal 被静默丢弃"的低危问题。

### 验证
全量 `build-force-play.ps1` 重跑通过——`node --check` / `eslint` / 契约(`_verify`,`_doc`,`_semantics` + SELFTEST) / `metadata`(+SELFTEST) / `_sim (via run-sim.js) PASSED`，产物 `chaoxing-force-play.user.js` 已重建。两处改动 `read_lints` 均为 0 诊断。

### 复核后优先修复顺序（更新）
① 跨模块契约显式化（问题 2，解耦长期演进）｜② `zhihuishu-exam` 宽选择器/题库子串匹配校准（需真实站点 HTML/题库）｜③ `swallow` 接入可观测告警（M1）｜④ 事件总线退订（H3）｜⑤ KVS.set/fetchWithTimeout（已修，校验通过）。
