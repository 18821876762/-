# chaoxing-force-play 幂等性专项审查报告（engine + foundation 域）

- 审查日期：2026-07-23
- 审查范围（全部逐文件精读）：
  - `takeover/engine/quiz.js`、`quiz-vision.js`、`quiz-merge.js`、`bridge.js`、`playback.js`、`foreground.js`、`targeting.js`、`stats.js`、`vision-deepseek-web.js`、`policy.js`
  - `takeover/dom/session.js`
  - `takeover/foundation/state/state.js`、`state/metrics.js`
  - `takeover/foundation/meta-config/config.js`
  - `takeover/foundation/site/site-router.js`
  - `takeover/foundation/storage/storage.js`、`storage/keys.js`
  - `takeover/foundation/utils/utils.js`、`utils/url.js`
  - `takeover/foundation/error-guard/guard.js`
- 为核实调用方与清理契约，另精读了 `takeover/dom/lifecycle.js`、`takeover/dom/dom.js`、`takeover/bootstrap/core.js`、`takeover/bootstrap/main-loop.js`、`takeover/engine/dedup.js`、`sites/chaoxing-exam.js`、`sites/popup-quiz.js`（部分），并全文检索了 addEventListener / setInterval / MutationObserver / defineProperty / EventBus 订阅 / registerSiteTick / GM 监听等注册点。
- 所有行号均以实际读码为准，逐条核实，无臆测。

---

## 一、审查范围与结论摘要

### 总体结论

**未发现致命级幂等性缺陷**。整个脚本是一个由 `core.js` 开头的单一 IIFE 包裹的产物，`window.__CX_FORCE_PLAY.started` 守卫（`core.js:14`）保证**同一 window 内整脚本重复注入时整体跳过**，这从根上挡住了「同一帧内所有模块级副作用（MO 创建、监听器注册、原型 patch、定时器、GM 监听、模块级状态初始化）翻倍」的最大风险源。在此基础上，各模块普遍采用「模块级布尔守卫 + 先 disconnect 再重建 + 具名函数 + TimerRegistry 登记 + cleanup 幂等锁」的组合，工程质量明显高于同类用户脚本。

发现 **2 个严重**、**6 个一般**、**5 个建议**级问题，集中在：
1. **卸载后残留**（在途视觉答题/DeepSeek 问答的原始 `setTimeout` 不受 TimerRegistry 管辖，uninstall 后仍会 settle 并对页面执行真实点选/提交）；
2. **跨帧单例锁名不副实**（vision-deepseek-web 声称用 window.top 共享标志保证全页只初始化一份，但锁实际挂在各帧本地 `window.__CX_FORCE_PLAY` 上，`_dsTopDoc` 是死变量；每个匹配 iframe 仍各自初始化课程侧心跳定时器与无效通道监听）；
3. 其余为 GM 监听器无卸载、每 2s 无条件重装原型 pause、`_quizAIPending` 无上限淘汰、EventBus 顶层 message 监听未列入清理清单、bridge fetch 无请求级去重、attachments 还原的旧快照覆盖风险等。

### 模块逐项结论

| 模块 | 结论 |
|---|---|
| engine/quiz.js | 有一般/严重级发现（卸载后在途定时器、_quizAIPending 无上限）；其余去重/守卫良好 |
| engine/quiz-vision.js | 无幂等性缺陷（全局复用判断、串行队列、once 监听均正确） |
| engine/quiz-merge.js | 纯函数，无状态，无问题 |
| engine/bridge.js | 一般（bridgeFetch 无请求级去重）；探测去重守卫良好 |
| engine/playback.js | 无问题（__cxPlayingArmed 单例监听守卫优秀） |
| engine/foreground.js | 无问题（纯函数 + 短窗缓存） |
| engine/targeting.js | 一般（attachments 还原旧快照覆盖边缘）；其余守卫良好 |
| engine/stats.js | 无问题（环形/上限全部有界） |
| engine/vision-deepseek-web.js | 严重（跨帧锁失效 + 每帧冗余心跳）；一般（GM 监听无卸载、DS 问答原始定时器逃逸 TimerRegistry） |
| engine/policy.js | 纯函数，无状态，无问题 |
| dom/session.js | 无问题（userPause/userResume/autoStop/resumeTick 全幂等，无定时器） |
| foundation/state/state.js | 建议（顶层 message 监听匿名且未列入 cleanup 清单） |
| foundation/state/metrics.js | 无问题（环形缓冲全部有上限） |
| foundation/meta-config/config.js | 一般（主循环每 2s 无条件重装 prototype.pause）；还原原语幂等良好 |
| foundation/site/site-router.js | 无问题（registerSiteTick 覆盖式注册，不累积） |
| foundation/storage/storage.js | 无问题（_ready 单次初始化） |
| foundation/storage/keys.js | 常量表，无问题 |
| foundation/utils/utils.js | 无问题 |
| foundation/utils/url.js | 纯函数，无问题 |
| foundation/error-guard/guard.js | 无问题 |

---

## 二、严重（2 条）

### S-1　卸载后在途答题/视觉还原/DeepSeek 问答的原始定时器不受 TimerRegistry 管辖，uninstall 后仍会触发真实作答副作用

- **文件:行号**：`takeover/engine/quiz.js:509-513`（`_quizVisionAnswer` 的 45s 超时 Promise）、`takeover/engine/quiz.js:299`（MO 防抖 800ms）、`takeover/engine/vision-deepseek-web.js:575-577`（`_dsAskOnce` 60s 超时）、`vision-deepseek-web.js:601`（重试延迟 2500ms）
- **问题描述**：`cleanupListeners`（`takeover/dom/lifecycle.js:58-67`）卸载时只清理了 TimerRegistry 登记项与 DS 定时器，但上述四处在途 `setTimeout` 均为**裸定时器**，卸载后照常到期并驱动 Promise 链 settle：
  - quiz.js:513 的 45s race 超时 → `.catch`（quiz.js:548-554）执行 `_quizClick(opts, Math.floor(Math.random()*opts.length))` + `_quizSubmit(...)` —— 卸载后对页面真实点选随机选项并点击提交；
  - 若 race 在卸载后**正常 resolve**（quizRecover 迟到回传），`.then`（quiz.js:514-547）同样会点选+提交；
  - quiz.js:299 的 MO 防抖定时器在 `quizDisconnect`（cleanup 第 63 行先执行）后仍会触发一次 `_quizMOTick` → 因 `window.__CX_FORCE_PLAY` 已被 cleanup:183 删除，回退到裸 `quizTick()`（quiz.js:292），若答题开关开启会当场作答；
  - `_dsAskOnce` 60s 超时与 2500ms 重试为裸定时器，即使 `quizVisionDeepSeekStop` 已 `TimerRegistry.clearAll('deepseek')`（vision-deepseek-web.js:653-658）也拦不住，超时 reject 仍会沿 `quizAskDeepSeek` 重试链传回 quiz.js 的 catch → 点选。
- **代码依据**：
  ```js
  // quiz.js:511-514
  Promise.race([
    quizRecover(qEl),
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error('vision-timeout')); }, _visTo); })
  ]).then(function (res) { ... _quizClick(opts, useIdxs[_k]); _quizSubmit(qEl, sels.submitSels); ... })
    .catch(function (e) { ... _quizClick(opts, Math.floor(Math.random() * opts.length)); _quizSubmit(qEl, sels.submitSels); ... });
  // vision-deepseek-web.js:575 与 601
  var to = setTimeout(function () { ... reject(new Error('deepseek timeout')); }, ... 60000);
  return new Promise(function (res) { setTimeout(res, DS_ASK_RETRY_DELAY); }).then(run);
  ```
- **为什么影响幂等性**：生命周期模块的卸载契约（lifecycle.js 顶部「卸载还原与生命周期」注释）承诺「回到注入前状态」，且 `window.__CX_FORCE_PLAY.uninstall` 是明确暴露的手动还原入口；在这些在途 Promise settle 时执行 DOM 点选/提交属于**卸载后残留副作用**，与契约相悖（pagehide/beforeunload 场景下页面将销毁故无感，但手动 uninstall 场景真实可复现）。
- **建议修复方向**：引入会话级「卸载纪元」令牌：`cleanupListeners` 置 `_cxUninstalled=true`（或自增 epoch），`_quizVisionAnswer` 的 `.then/.catch` 与 `_dsAskOnce` 的 settle 回调首行检查纪元，已卸载则直接 return（不点选、不提交、不重试）；并将这些裸定时器改为经 TimerRegistry 登记（owner 挂 'quiz-vision'/'deepseek'），使 `clearAll` 可直接取消；`_quizMOHandle` 的 800ms 定时器同样登记或保存句柄在 `quizDisconnect` 时 clearTimeout。

### S-2　vision-deepseek-web 跨帧单例锁名不副实：`_dsTopDoc` 为死变量，锁挂在各帧本地命名空间，每个匹配 iframe 仍各自启动课程侧心跳定时器与无效通道监听

- **文件:行号**：`takeover/engine/vision-deepseek-web.js:615-630`（自初始化块）、`:616-617`（`_dsTopDoc`）、`:619-620`（`_dsLockOwner/_dsSetLock`）、`:153-169`（`_dsInitCourseSide`）、`:164-166`（4s 心跳）
- **问题描述**：注释明确声称「跨窗口幂等锁：…用 window.top 共享标志确保全页只初始化一份；…避免重复注册监听/心跳」。但实现中：
  - `_dsTopDoc`（616-617）计算后**从未被使用**（全文检索仅此两处出现），共享标志并未落到 top 帧；
  - 锁实际读写 `window.__CX_FORCE_PLAY.dsRoleInited`（`_dsNs()` 返回**本帧**的命名空间，619-620），各 frame 的 `window` 是独立 realm，顶层置位对 iframe 不可见；
  - 因此非顶层、非 deepseek 站的 iframe（chaoxing 播放页常见）在 `_dsNeedChannel=false`（58 行，无 BroadcastChannel 也无 GM 监听、`_postChannel` 是空操作）的前提下，仍因本帧 `dsRoleInited` 为假而执行 `_dsInitCourseSide`（627 行 else 分支）：注册一个永远收不到消息的 `_onChannel` 监听（155-162）、`_postChannel({type:'ds-ping'})`（163，无通道等于空转）、并启动一个**每 4s 空转的 `_dsCourseTimer` 心跳**（164-166）。
- **代码依据**：
  ```js
  // 615-620：注释称用 top 标志，实际锁在本帧命名空间
  var _dsTopDoc = window;
  bestEffort(function () { if (window.top && window.top !== window && window.top.document) _dsTopDoc = window.top; }, 'ds.init.topDoc');
  var _dsNs = function () { return safeGet(function () { return (window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {}); }, {}); };
  var _dsLockOwner = function () { return safeGet(function () { return !!_dsNs().dsRoleInited; }, false); };
  // 153-169：课程侧初始化无条件起 4s 定时器
  _dsCourseTimer = window.__CX_FORCE_PLAY.TimerRegistry.setInterval(function () {
    if (DS_STATUS.connected && Date.now() - DS_STATUS.ts > 12000) { DS_STATUS.connected = false; _dsRenderStatus(); }
  }, 4000, 'deepseek');
  ```
- **为什么影响幂等性**：这正是审查要点 1 的「跨帧/跨标签重复注册」场景——多帧页面产生 N 份冗余心跳定时器与 N 份无效通道监听（每帧一份），与注释宣称的「全页只初始化一份」直接相悖，也违背了 main-loop.js:37-42 已收敛的「顶层帧编排」同款设计意图。同帧内因 `started`+`dsRoleInited` 双层守卫不会双启动（`_dsCourseTimer` 句柄不会被覆盖丢失），故不构成同帧双定时器，但跨帧叠加真实存在。
- **建议修复方向**：锁读取 top 帧命名空间：`safeGet(function(){ return !!(window.top && window.top.__CX_FORCE_PLAY && window.top.__CX_FORCE_PLAY.dsRoleInited); })`，置位同样写到 `window.top.__CX_FORCE_PLAY`（跨域取不到 top 时回退本地，与原注释设计一致）；并把 `_dsInitCourseSide` 的定时器启动也纳入 `_dsNeedChannel` 门控（无通道的帧不启动心跳），或删除 `_dsTopDoc` 死代码并让锁真正跨帧生效。

---

## 三、一般（6 条）

### G-1　GM_addValueChangeListener（vision-deepseek-web.js:79）从未卸载：未捕获 listener id、全树无 GM_removeValueChangeListener

- **文件:行号**：`takeover/engine/vision-deepseek-web.js:49-50`（`_GM` 定义）、`:79`（注册）
- **问题描述**：`_GM.on(DS_BRIDGE_KEY, ...)` 的返回值（listener id）被丢弃，仓库内没有任何 `GM_removeValueChangeListener` 调用；lifecycle.js 的清理清单（⑫ 只提 DS 定时器）也未覆盖它。GM 监听是脚本级（跨标签页、跨页面生命周期）的，页面软卸载/手动 uninstall 后该监听仍存活，并持续把 GM 存储变更经闭包 `_emitChannel` 派发给 `_chanListeners`（卸载后虽无人收，但监听与闭包长驻）。
- **代码依据**：
  ```js
  if (_GM && _dsNeedChannel) {
    bestEffort(function () { _GM.on(DS_BRIDGE_KEY, function (name, oldV, newV, remote) { ... }); }, 'ds.init.gm');
  }
  ```
- **为什么影响幂等性**：卸载契约（lifecycle.js 还原清单 ①~⑫）漏掉一个全局级监听；脚本被 Tampermonkey 热禁用后监听残留，重新启用时若旧沙箱未回收会形成重复监听（双份 GM 变更处理）。
- **建议修复方向**：`_GM.on` 返回值存入模块变量，`quizVisionDeepSeekStop`/cleanup 中调用 `GM_removeValueChangeListener(id)`（`_GM` 增补 `off`），并把该监听列入 lifecycle.js 还原清单。

### G-2　主循环每 2s 无条件重装 prototype.pause（main-loop.js:76 + config.js:107-130），覆盖第三方 patch 并产生闭包垃圾

- **文件:行号**：`takeover/bootstrap/main-loop.js:76`、`takeover/foundation/meta-config/config.js:107-130`（`installPrototypePauseNeutralize`）
- **问题描述**：`_loopTick` 每轮（默认 2s）无条件调用 `installPrototypePauseNeutralize()`；该函数每次执行都新建 `protoPauseNeutral`/`protoPauseLiteral` 两个闭包并**直接赋值** `HTMLMediaElement.prototype.pause = protoPause`（config.js:126）。赋值是替换式、不叠加（不会出现「回调翻倍」），但：① 每 2s 无条件覆盖 prototype.pause——若其他用户脚本/平台在同一 2s 窗口内安装了自己的 patch，会被静默顶掉；② 每 2s 产生新闭包赋值（GC 抖动）；③ 与上方 `probePauseNeutralized`（main-loop.js:64-75）的探测结果**未联动**——探测到「在位」时本可跳过重装。
- **代码依据**：
  ```js
  // main-loop.js:76
  bestEffort(function () { if (usePrototypeNeutralize()) installPrototypePauseNeutralize(); }, 'loop.tick.protoNeut');
  // config.js:125-126
  var protoPause = CONFIG.POLITE_MODE ? protoPauseNeutral : protoPauseLiteral;
  try { HTMLMediaElement.prototype.pause = protoPause; _protoPauseInstalled = true; ... }
  ```
- **为什么影响幂等性**：重复安装本身安全（赋值幂等、不抛错），但「每 2s 覆盖他人 patch」是对宿主全局的重复侵入，且同轮已有探测结果却不用，属无效重复劳动；`_installedProtoPause` 引用被更新为最新闭包，probe 仍自洽，故不构成逻辑错乱。
- **建议修复方向**：改为「探测到被还原（`probePauseNeutralized() === false`）才重装」；或给 `installPrototypePauseNeutralize` 加 `_protoPauseInstalled && 原型引用仍为本函数` 的短路。

### G-3　`_quizAIPending` 无上限淘汰：消失题目的条目永久残留（quiz.js:60/679-683）

- **文件:行号**：`takeover/engine/quiz.js:60`（声明）、`:679`（置位）、`:682-683`（仅超时路径删除）
- **问题描述**：`_quizAIPending[fp]` 仅在「后续同一题再次被扫到且超时」时删除（683 行），若题目在 pending 期间从 DOM 消失（翻页/提交后），条目无人清理；同文件其他队列（`_quizHandled` 上限 4000、`_quizReviewItems` 500、`_quizPendingSubmit` TTL+1000、`_quizAIFailed` 200）均有淘汰，唯独此 map 无任何 cap/TTL 淘汰。长会话、大量 AI 超时题时该 map 随会话单调增长。
- **代码依据**：
  ```js
  var _quizAIPending = {};     // AI 异步题解进行中：fp→发起时间戳（超时则随机兜底）
  ...
  if (!_quizAIPending[fp]) _quizAIPending[fp] = Date.now();
  else {
    var _wait = ... QUIZ_AI_WAIT ... ;
    if (Date.now() - _quizAIPending[fp] > _wait) { delete _quizAIPending[fp]; ... }
  }
  ```
- **为什么影响幂等性**：模块级状态重复初始化/无界累积的典型缺口——同文件已有四个「A2/A3/A4 内存护栏」范本（96 行注释），此处漏掉一个队列。
- **建议修复方向**：仿 `_quizPrunePending`（135-143）为 `_quizAIPending` 增加 TTL+CAP 淘汰（如 20s 超时 + 1000 上限），或并入既有 prune 轮。

### G-4　EventBus 顶层帧 'message' 监听为匿名函数且未列入 cleanup 清单（state.js:62-73）

- **文件:行号**：`takeover/foundation/state/state.js:62-73`
- **问题描述**：顶层帧注册 `window.addEventListener('message', function (e) {...})`，匿名、无句柄；lifecycle.js 清理清单未包含它，uninstall 后该监听仍挂在顶层 window 上（订阅已 `clearSubs` 清空，回调内 `emit` 变为空操作，故无行为危害，但监听器本身残留，且任何同源 `__cxFeedToast` postMessage 都会唤醒它做一次无谓遍历）。
- **为什么影响幂等性**：卸载后残留一个全局监听器，与「回到注入前状态」契约不完全吻合；若未来有人在清理前再次 emit，会复活订阅。
- **建议修复方向**：提取具名函数 `_onTopFeedMessage` 并存入模块变量，lifecycle cleanup 中 `window.removeEventListener('message', _onTopFeedMessage)`。

### G-5　bridgeFetch 无请求级去重：bridgeInit 重复调用会在 reachable 路径重复拉取 /playlist（bridge.js:171-200/230-234）

- **文件:行号**：`takeover/engine/bridge.js:230-234`（reachable 直接 `bridgeFetch`）、`:171-200`（`bridgeFetch` 本体）
- **问题描述**：探测侧去重做得很好（`_bridgeProbeInFlight`/`_bridgeProbedBases`/`_bridgeAllDead` 冷却，63-96），但 `bridgeFetch` 本身无去重：`bridgeInit` 每被调用一次（模块加载一次 + `window.__CX_FORCE_PLAY.toolkit.bridge.bridgeInit` 可被面板/工具链反复调用），在 `_st.reachable[base]` 命中时都会重新发一次 `fetch(base + '/playlist/' + cid)`（含新 AbortController/定时器），并对命中章节重复执行 `restoreNativePause(document)` 与 `refreshTargets()`。并发调用时（top + iframe 各自 bridgeInit）会并发两条 playlist 请求。
- **为什么影响幂等性**：重复 fetch 本身不叠加监听/定时器（每次自带 clear），但属「重复调用产生重复副作用」——重复网络请求与重复全树遍历（`restoreNativePause` 对每个 video 赋属性 + 递归 iframe，O(N) 每趟）。
- **建议修复方向**：为 `(cid,kid)` 加最近请求去重（如 `_bridgeLastFetchKey + 时间窗`，或复用 `_bridgeProbeInFlight` 风格的 in-flight 标志），fetch 返回前忽略重复调用。

### G-6　attachments 还原用注入前旧快照，可能覆盖平台会话内的新值（lifecycle.js:76-83 + targeting.js:54-71）

- **文件:行号**：`takeover/dom/lifecycle.js:76-83`、`takeover/engine/targeting.js:58-69`
- **问题描述**：`hookAttachments` 安装时快照 `_attachStore = { value: siteAttachments() }`（targeting.js:59），并 defineProperty 自有属性（configurable）。若会话期间**平台侧重新 defineProperty 覆盖了我们的属性**（平台自己的钩子/框架替换 window.attachments），`_attachHooked` 仍为 true；cleanup 时 `delete window[_ak]`（把**平台的新属性**删掉）再以 `_attachStore.value`（过期的注入前快照）defineProperty 写回 → 平台新值丢失。
- **为什么影响幂等性**：还原路径不幂等——「还原后的状态」可能不是「平台当时的状态」，而是脚本的过期快照；重复 uninstall（被 `_cleaned` 挡住，故无二次执行问题）之外的时序竞态。
- **建议修复方向**：cleanup 还原前校验 `window[_ak]` 当前是否仍是本脚本安装的 getter（存函数引用比对），不是则不动（把属性原样交还平台）；快照仅在确有自有属性时才写回。

---

## 四、建议（5 条）

### A-1　quiz.js `_quizMOHandle` 的 800ms 原始 setTimeout 无句柄保存（quiz.js:296-300）
断开 MO 后（`quizDisconnect`，313-315）若防抖定时器已排程，仍会触发一次 `_quizMOTick`→quizTick（卸载后单发、受 `_quizHandled` 去重保护，故无害，但属 S-1 同类的裸定时器残留）；建议句柄保存并在 disconnect 时 clearTimeout。**无累积风险，仅收尾一致性。**

### A-2　quiz-vision.js `_quizLoadByMirror` 对「全部 CDN 失败」无会话内记忆（quiz-vision.js:113-134）
每题视觉作答都会重试 7 个 CDN 源（7 次脚本注入 + 网络往返，成功前反复打网）；失败结果未缓存，N 题 = N×7 次尝试。建议把「已全失败」记入模块标志，会话内后续题直接走随机兜底（严格模式走 strictFail），或加失败冷却。**属性能/网络层面，非监听/定时器累积。**

### A-3　main-loop.js:116 visibilitychange 监听为匿名函数，未登记 _playWatchDocs 式清理清单
`document.addEventListener('visibilitychange', function () { restartLoopTimer(); }, true)`（main-loop.js:116）——cleanup（lifecycle.js:69）移除的是 `visibilityHandler`（dom.js 的），这个主循环降频监听不在清理清单内，uninstall 后仍会在每次切前后台触发 `restartLoopTimer`（TimerRegistry 已被 clearAll，会重建一个孤儿 `_loopTick` 定时器！）。**注意：此条实际影响大于普通建议——uninstall 后 visibilitychange 会复活主循环定时器（clearAll 之后又 setInterval），建议提升为一般级处理。**（此处按实际危害标注：A-3 实际应为「一般」，见下注。）

> 更正标注：A-3 按实际危害应为**一般（G-7）**：uninstall 后每次切换可见性都会通过 `restartLoopTimer` 重新 setInterval 主循环（每 2s 的 `_loopTick` 继续执行扫描/接管），卸载还原不彻底。修复：把该监听改为具名函数并在 cleanup 中移除（与 `visibilityHandler` 同款）。

### A-4　`quizTick` 中 `_quizStrictFail` 的 toast/统计在卸载后仍可能执行一次（quiz.js:72-91）
属 S-1 的同一根因分支（strictFail 里 `EventBus.emit` 在 subs 清空后为空操作，无实际危害），仅建议随 S-1 的卸载纪元一并短路。

### A-5　KVS/存储层 `loadPanelCfg`、`loadWatchStats` 为模块加载期调用（config.js:90-91）
若未来重构允许整脚本热重载（绕过 `started` 守卫），二次调用会以 localStorage 覆盖内存中未持久化的最新统计/配置；当前因 `started` 守卫无此路径，仅提示保持该调用只出现在单次加载期。

---

## 五、正向-良好实践（核实通过，作为「无问题」结论依据）

1. **全脚本注入守卫**（core.js:13-15）：`window.__CX_FORCE_PLAY.started` 置位即整体 return，同帧重复注入不产生任何模块级副作用翻倍；globalErrorHandler 置于守卫之后注册（core.js:50-56 注释明确说明此举消除「重装叠加 error 监听」）。
2. **TimerRegistry 集中登记**（core.js:21-47）+ lifecycle 统一 `clearAll`（lifecycle.js:67）：主循环/DS 心跳等长生命周期定时器全部可追溯清理。
3. **cleanup 幂等锁**（lifecycle.js:58-60 `_cleaned`）+ `{once:true}` 双钩子（185-186）+ 自摘除（125-126）：pagehide/beforeunload 双触发只还原一次。
4. **quizObserve 先 disconnect 再重建**（quiz.js:301-311）：重复调用不会造成 MO 回调翻倍；`quizDisconnect` 幂等（313-315）。
5. **safePlay 单例 'playing' 监听守卫**（playback.js:21-30 `__cxPlayingArmed`）：同一视频最多一个待触发监听器，防自动播放被拒时监听器无上限累积。
6. **neutralizeGlobalPause 幂等**（dom.js:301-323）：以 no-op 引用比对（310 行）避免覆盖已存真原生、`_ananasNeutralized.indexOf` 去重（317 行）；重复下钻安全。
7. **playbackRate 中性化恒用加载期 NATIVE_RATE_DESC**（config.js:141-167）：重复安装不会把 setter 双重包装。
8. **_ovEnforce 每视频监听只装一次**（dom.js:212-239 `cxState(v).init` 守卫）；nearEnd ended 守卫（63-82）与 seeking 守卫（270-277）均有布尔守卫。
9. **installPlayWatch 具名 handler + _playWatchDocs 登记**（main-loop.js:11-28；dom.js:378 以 `cxState(f).pw` 限每 iframe 一次）：addEventListener 对同函数+同 capture 自动去重，可清理。
10. **userPause/userResume/autoStopTick/resumeTick 为纯状态机**（session.js）：无定时器、无监听器；`defineProperty(v,'play')` 每次覆盖同一定义（幂等），`userResume` 的 `delete v.play` 恢复原型；`resumeAt` 清除后不重复恢复。
11. **bridge 探测三守卫**（bridge.js:63-96）：in-flight / 已探测集 / 全死冷却，注释与实现一致。
12. **EventBus 完整退订 API**（state.js:47-60 off/offEv/clearSubs）+ cleanup 清空订阅（lifecycle.js:168）。
13. **模块状态全部有界**：`_bxBuffer` 200、`_errBuf` 50、`_moQueue` 1024、`ENDED_SRCS` 2000、`_pqHandled` 2000、`_quizHandled` 4000、`_quizReviewItems` 500、`_quizPendingSubmit` TTL+1000、`_quizAIFailed` 200（唯一例外见 G-3）。
14. **refreshTargets 幂等重建**（targeting.js:94-145）：每轮从零重建白名单、keyRe 用 Map 缓存且仅任务切换时 clear；`_attachHooked`+自有属性检查双守卫（54-71）。
15. **quiz-merge/policy/url/guard/stats/foreground/keys 为纯函数或无状态**，重复调用零副作用。

---

## 六、状态机专项核查（审查要点 4，逐项回答）

- **quiz.js `_quizAIPending` 提交锁**：不是定时器而是 fp→时间戳 map；同帧内由 `_quizHandled` 占坑保证同一题不会并发发起两次 AI 请求；超时路径 683 行删除后随机兜底并置 handled。**无双定时器问题**；仅见 G-3 无上限残留。
- **session.js autoStop/resume**：不创建任何定时器，由主循环 tick 驱动；`watchMs` 阈值交叉后 `userPaused=true` 使后续 tick 跳过，`resumeAt` 在 `userResume` 中清零——**重复 start/stop 均幂等**。
- **vision-deepseek-web `_dsCourseTimer`/`_dsBroadcastTimer`**：同帧内受 `started`+`dsRoleInited` 双层守卫，重复 start 不会发生（旧句柄不会被覆盖丢失）；`quizVisionDeepSeekStop`（653-658）重复调用幂等（clearAll 幂等 + 句柄置 null）。**跨帧重复 start 存在**——见 S-2。**重复 stop 不抛错**。

---

## 七、优先级修复建议汇总

| 优先级 | 条目 | 一句话 |
|---|---|---|
| P0 | S-1 | 引入卸载纪元，在途答题/DS 问答 settle 后不再点选提交；相关裸定时器入 TimerRegistry |
| P0 | S-2 | 跨帧锁真正落到 top 命名空间（或按 _dsNeedChannel 门控课程侧心跳） |
| P1 | G-7/A-3 | visibilitychange 匿名监听未清理，uninstall 后会复活主循环定时器 |
| P1 | G-1 | GM 监听器 id 捕获 + 卸载时 remove |
| P1 | G-2 | 探测到被还原才重装 prototype.pause |
| P2 | G-3/G-4/G-5/G-6 | _quizAIPending 加淘汰、message 监听具名化并入清理清单、bridgeFetch 请求级去重、attachments 还原先校验归属 |
