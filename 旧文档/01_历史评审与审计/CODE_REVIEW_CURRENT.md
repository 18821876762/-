# 代码审查报告 · 网课强制续播（chaoxing-force-play）

审查范围：`ecosystem/src/chaoxing-force-play/**`（约 58 个源文件）+ 构建产物 `ecosystem/chaoxing-force-play.user.js`
审查方式：直接静态分析——对全部源文件执行 `node --check` 语法校验、针对各风险类别做定向 grep 与关键文件精读（`core.js`/`state.js`/`dom.js`/`lifecycle.js`/`panel*.js`/`commands.js`/`zhihuishu-exam.js`/`vision-deepseek-web.js` 等）。注：并行子代理返回的详细结果在平台侧被压缩丢弃，本报告结论均来自本人直接核验，非他人转述。

---

## 总体结论

代码整体**防御性极强**：全局通过 `safeGet`/`bestEffort`/`swallow` 收口异常；`localStorage` 读写全部 try/catch；`innerHTML` 处对不可信文本基本都走 `escapeHTML`；无 `eval`/`new Function`/字符串 `setTimeout`；卸载清理清单（12 项）非常完整。`node --check` 对全部 57 个文件通过，**未发现致命级缺陷**。

**未发现：致命（crash-on-load / 数据丢失 / 越权或脚本注入致失陷）级别问题。**

**处置汇总（2026-08-15 闭环）**：S1（卸载残留轮询）✅ 已修复；A1（core.js 注释）✅ 已修复；G3（`document.write` 转义）✅ 已修复；G2/A2 ⚠️ 核验为误报；G1/G4/G5 ⚠️ 核验为设计内已缓解/无真实泄漏、不改。修复后完整构建 10 项门禁全绿（`node --check` / ESLint / 契约×5 / 自检×3 / `_sim` 56 仿真），产物 `chaoxing-force-play.user.js` 已重建。

---

## 严重程度分类

### 严重（Serious）

**S1. DeepSeek 应答轮询定时器未纳入 TimerRegistry，卸载后仍运行** ✅ **[已修复 · 2026-08-15]**
- 位置：`takeover/engine/vision-deepseek-web.js` — `poll()` 递归 `setTimeout(poll, 800)`（约 362–397 行）、`_img... = setTimeout(startSend, 8000)`（289 行）、`_dsTrySend` 重试（287 行）等均为裸 `setTimeout`。
- 原因：`uninstall()` 的清理清单 ⑫ 仅覆盖经 `TimerRegistry` 登记的「课程页巡检 + 应答端广播」两个 `setInterval`（147/159 行），而上述裸 `setTimeout` 未被登记，`lifecycle.js:67` 的 `TimerRegistry.clearAll()` 无法取消它们。
- 影响：脚本「卸载/回到注入前状态」语义失真——卸载后 DeepSeek 响应轮询仍在递归运行，回调会访问已拆除的 DOM/状态（多数被 `bestEffort` 兜底不崩，但造成空转、潜在报错与资源占用）。属文档承诺清理项的实际缺口。
- 修复（已落地）：新增模块级 `_dsRegTimer(fn, ms)`，将 responder 侧轮询 `_dsPollReply` 的 `setTimeout(poll, 800/1200)` 与 `_dsTrySend` 的发送校验裸 `setTimeout` 统一改经 `TimerRegistry.setTimeout(..., 'deepseek')` 登记；`quizVisionDeepSeekStop()` 的 `clearAll('deepseek')` 现可真正取消在途轮询。`_imgTimer`（8s 自清除，且 `__started` 幂等守卫已防重触发）与 `_dsRespond` 的 350ms `startSend` 仍走原生 `setTimeout`（短生命周期、自终止、依赖 `clearTimeout(_imgTimer)` 既有逻辑不便改写），不属泄漏源。构建全绿（`node --check`/ESLint/契约/`_sim` 56 全过）。

### 一般（General）

**G1. 跨帧 postMessage 发送端 fallback 到 `'*'`** ⚠️ **[已核验：设计内已缓解 · 不改]**
- 位置：`takeover/foundation/state/state.js:39` — `_topOrigin = (window.top && window.top.origin) ? window.top.origin : '*'`。
- 原因：`window.top.origin` 取不到时退化为广播到任意 origin。
- 核验结论：接收端 67 行已严格校验 `e.origin === window.location.origin`，伪造消息必被丢弃；`window.top.origin` 在现代浏览器恒为字符串，`'*'` fallback 实际不可达；且内容仅为无敏感性的提示文本。**保持现状**（`'*'` fallback 仅为极端环境保底，去掉反而可能丢提示）。

**G2. `loginColor` 未转义直接拼入 style 属性** ⚠️ **[已核验：误报 · 非问题]**
- 位置：`presentation/panel-ds-console.js:54` — `loginEl.innerHTML = '<span style="color:' + loginColor + '">' ...`。
- 原因：`loginColor` 拼入 `style="color:..."` 未经 `escapeHTML`（同句 `loginText` 已转义）。
- 影响（核验结论）：`loginColor` 由**硬编码三元固定集合**生成（`ok ? '#10b981' : (unknown ? '#f59e0b' : '#ef4444')`，见 panel-ds-console.js:51），**非 API/页面不可信输入**，无法逃逸属性，不构成 XSS。降级为「非问题」。
- 修复方向：无（保持现状；如需绝对稳妥可对固定值做白名单断言，但非必需）。

**G3. `document.write` 转义不完整** ✅ **[已修复 · 2026-08-15]**
- 位置：`presentation/panel-controls.js:248` — `text.replace(/&/g,'&amp;').replace(/</g,'&lt;')`。
- 原因：仅转义 `&` 与 `<`，未转义 `>`、引号。
- 影响：处于 `<pre>` 文本上下文，`<` 已阻断标签注入，`>`/引号在纯文本中惰性，风险低；但转义不对称，属不良模式。
- 修复（已落地）：改用共享 `escapeHTML`（闭包内同源，`& < > " '` 全覆盖）。

**G4. MutationObserver 监听整页子树，开销大** ⚠️ **[已核验：设计必需 + 已缓解 · 不改]**
- 位置：`takeover/dom/dom.js:508` — `new MutationObserver(...).observe(document.documentElement, { childList: true, subtree: true })`。
- 原因：整页子树变动都会触发回调（仅置脏标志 + 推视频队列）。
- 核验结论：整页监听是「任意位置动态插入视频都能被捕获」这一产品语义的**必需设计**（视频可能出现在导航/列表/iframe 壳任意层级），缩小范围会漏检视频；现有脏标志、队列上限 `MO_QUEUE_CAP`、后台 `setTimeout(200)` 排空（防切后台 OOM）、rAF 帧合并节流，已把回调降为 O(1) 置脏 + 极窄队列。**保持现状**。

**G5. 短生命周期裸 setTimeout 未登记，卸载后可能误触发一次** ⚠️ **[已核验：全量枚举无真实泄漏 · 不改]**
- 位置：`quiz.js:263`（MO 防抖）、`zhihuishu-exam.js:264`（`_syncTimer`）、`toast.js:44/48`、`zhihuishu-exam.js:410`、`auto-next.js:112/122/293/339`、`bridge.js:84/169/240`（abort 超时）、`panel-core.js:61/150/192`、`main-loop.js:115` 等。
- 核验结论：2026-08-15 全量枚举源树 **37 处裸 `setTimeout`**，除已修复的 S1 轮询外，**全部为一次性、短生命周期、带截止/`done` 标志/`AbortController.abort()`/幂等守卫**的定时器（toast 消失、fetch/桥接 5–15s 超时、UI 布局 defer、bootstrap defer、防抖、探针超时等），卸载后至多误触发一次且无循环续排。**无真实泄漏源，不引入改动**（避免为统一而统一、徒增复杂度）。

### 建议（Suggestion）

**A1. `core.js` 不可独立校验是设计使然，需注释明示** ✅ **[已修复 · 2026-08-15]**
- `takeover/bootstrap/core.js` 仅 59 行，IIFE 未闭合；`node --check` 必报 "Unexpected end of input"。但 `build-force-play.ps1:6` 读取该文件作为包裹器并在末尾追加 `})();`，构建产物语法正常。易被后续维护者误判为缺陷。
- 修复（已落地）：`core.js` 顶部新增注释，明确「本文件 IIFE 由构建脚本统一闭合，单文件 `node --check` 报错属正常，请勿误修」。

**A2. Promise 链未收口 rejection** ⚠️ **[已核验：误报 · 非问题]**
- 位置：`vision-deepseek-web.js:582` — `new Promise(...).then(run)`，`run` 未包 try/catch。
- 核验结论：该 retry 链外层 `run()` 已被 `.catch`（约 578 与 589 行 `run().catch(function(err){throw err;})`）收口，异常传播至调用方统一处理，**无未捕获 rejection**。降级为「非问题」。

**A3.（正向，保持）安全实践良好**
- 全仓无 `eval`/`new Function`/字符串 `setTimeout`；`innerHTML` 处对命令名/描述、诊断详情、题目区文本等均 `escapeHTML`；`localStorage` 全 try/catch；`postMessage` 接收端校验 origin；`MutationObserver` 有队列上限 + 后台 `setTimeout` 排空（防切后台 OOM）。新增 `innerHTML` 处请坚持 `escapeHTML`。

**A4.（正向，保持）卸载清理清单完整**
- `lifecycle.js:cleanupListeners` 幂等（`_cleaned` 守卫防 pagehide+beforeunload 双触发），逐项断开两个 MutationObserver、clearAll 定时器、移除 keydown/visibilitychange/play/error/pagehide/beforeunload 监听、还原 `pause`/`playbackRate`/`attachments`/`mediaSession`/`ananas` 等原型 Hook、清理注入 DOM、清空 EventBus 订阅、删除命名空间。属高质量 teardown，建议保持并随新增侵入点同步登记。

---

## 需关注的设计/一致性点

- `build-manifest.txt` 未列入 `core.js`，但 `build-force-play.ps1` 直接读取 `core.js` 作为包裹器——二者一致，非问题（见 A1）。
- `CONFIG` 字段名 `AUTO_STOP_MIN` / `RESUME_AFTER_MIN` 在 `config.js`/`storage.js`/`session.js`/`panel-core.js` 等引用处**一致**，无记忆中提到的「字段名不匹配」类隐患（已核验）。
- 站点专属答题文件（`sites/zhihuishu-exam.js`、`popup-quiz.js`、`quiz.js`）大量使用 `safeGet` 包裹，空/异常分支处理到位，运行时健壮性较好。

---

## 优先级建议

1. ~~**S1**（卸载残留轮询）~~ ✅ 已修复：`_dsPollReply`/`_dsTrySend` 的 responder 侧 `setTimeout` 改经 `TimerRegistry`（owner `deepseek`），`quizVisionDeepSeekStop` 的 `clearAll('deepseek')` 现可取消在途轮询。构建全绿。
2. ~~**G2**（确认 `loginColor` 来源）~~ ✅ 已核验为误报：`loginColor` 来自硬编码三元固定颜色集合，非不可信输入，不构成 XSS。
3. ~~**A1**（core.js 注释）~~ ✅ 已修复：顶部加注「IIFE 由构建脚本闭合，单文件校验报错属正常」。
4. ~~**A2**（Promise 链缺 catch）~~ ✅ 已核验为误报：retry 链外层 `run().catch` 已收口，无未捕获 rejection。
5. ~~**G3**（`document.write` 转义）~~ ✅ 已修复：复用共享 `escapeHTML`（`& < > " '` 全覆盖）。
6. **G1 / G4 / G5** ⚠️ 已逐一核验为「设计内已缓解 / 必需设计」或「全量枚举无真实泄漏」，**明确不改**，随迭代保持关注即可（G1 接收端已校验 origin、G4 整页 observe 为视频检测必需且已有节流/队列上限/后台排空、G5 全部为一次性带截止标志定时器）。**A3** 为正向保持项。
