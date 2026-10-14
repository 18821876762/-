# 幂等性专项审查报告：chaoxing-force-play presentation / plugins 模块

- 审查对象：`ecosystem/src/chaoxing-force-play/presentation/` 12 个模块 + `plugins/registry.js` + 6 个 addon
- 审查方法：逐文件 read 精读，行号均已对照源码核实；跨模块调用点（EventBus 定义、ensurePanel 装配、main-loop 调度、lifecycle 清理、registry 排空）均已通读核实。
- 审查前提（任务给定、已复核）：① 整个 bundle 由 core.js 的 `window.__CX_FORCE_PLAY.started` 守卫整体防重复注入；② ensurePanel（panel-core.js:39 `if (_cxPanel) return _cxPanel` + :49-50 `pd.getElementById('__cxPanel')` 复用）防面板重复创建；③ lifecycle.js:59 `_cleaned` 幂等守卫防卸载流程重复执行。
- 附带确认的底层事实：
  - EventBus 实现（takeover/foundation/state/state.js:18-75）：`onEv` 是纯 append 语义（:45 `on(k,fn){ (subs[k]=subs[k]||[]).push(fn); }`），**不做同 handler 去重**。因此「模块顶层 onEv 只执行一次」是各模块事件订阅幂等的唯一保障，全靠 bundle started 守卫 + 模块级一次性标记（`_feedSubscribed`/`_switchSubscribed` 等）维持。
  - 所有模块顶层副作用（addEventListener / EventBus.onEv / style 注入 / 定时器）都只在 bundle 单次注入时执行一次；本次审查聚焦这些代码**在面板 refresh/重建/重注入假设下自身是否具备幂等性**。

## 结论摘要

| 严重度 | 数量 | 说明 |
|---|---|---|
| 致命 | 0 | 未发现可在正常注入/重建路径下造成功能损坏的重复副作用 |
| 严重 | 0 | 未发现事件/监听/定时器/节点在重复触发下成规模累积的路径 |
| 一般 | 3 | 提示流 flush 重复 append；video-ended-notify 缺 cleanup 成对注册；DS 控制台 ticker 重建后陈旧 |
| 建议 | 5 | 控件绑定守卫不一致；reclampSoon/showFabMenu 定时器与监听句柄管理；addon 守卫与站点隔离顺序两处不一致 |
| 正向-良好实践 | 15+ | 详见下方（含关键防重复机制 15 处） |

总体评价：**幂等性设计整体扎实**。面板装配链（panel-core.js）与 6 个 addon 的 `window.__cxXxxStarted` 守卫覆盖了各自的全部副作用路径；没有发现「同一 DOM 重复 addEventListener 导致事件触发多次」「style/节点无守卫重复 appendChild」「EventBus 订阅累积」「定时器句柄被覆盖丢失」这四类典型问题。发现的 3 个一般问题均为**边界路径**（面板重建/卸载清理/站点切换），不构成常态路径的重复执行。

---

## 一、一般（3 条）

### G1. 面板重建时提示流（洞察页）缓冲被重复 append —— 重复展示

- **文件:行号**：`presentation/panel-toast-feed.js:47-61`（`_onToastForFeed` / `_flushToastFeed`）+ `presentation/panel-core.js:97`（`_flushToastFeed()` 调用点）
- **问题描述**：`_onToastForFeed` 对每条 toast **既 push 进 `_toastFeedBuf` 缓冲，又立即 `_appendToastFeed` 写入 DOM**；而 `_flushToastFeed` 会把缓冲里**所有条目再次 append 一遍**再清空。当面板因 R11 自愈（panel-core.js:36-38 检测节点脱离文档）或跨帧卸载清理而**重建**时，ensurePanel 走完整构建流程并调用 `_flushToastFeed()`，此前已实时写入过 DOM 的 toast 会全部被再次插入 → 提示流出现重复条目。
- **代码依据**：
  ```js
  // panel-toast-feed.js:47-54
  function _onToastForFeed(msg, level) {
    bestEffort(function () {
      _toastFeedBuf.push({ m: String(msg), l: level || 'info' });   // ① 入缓冲
      if (_toastFeedBuf.length > _toastFeedCap) _toastFeedBuf.shift();
      _appendToastFeed(msg, level);                                  // ② 同时实时 append
      _updateTipPin(msg, level);
    }, 'feed.onToast');
  }
  // panel-toast-feed.js:55-61
  function _flushToastFeed() {
    bestEffort(function () {
      for (var i = 0; i < _toastFeedBuf.length; i++) _appendToastFeed(_toastFeedBuf[i].m, _toastFeedBuf[i].l);  // ③ 无条件重放全部缓冲
      ...
      _toastFeedBuf.length = 0;
    }, 'feed.flush');
  }
  ```
- **为什么影响幂等性**：`_flushToastFeed` 无「已渲染/未渲染」区分，对已在面板打开期间实时 append 过的条目再次 append，属于同一条提示的重复 DOM 写入。发生频率与面板重建频率一致（SPA 整段替换 body、跨帧清理、R11 自愈），每次重建将积压提示全部重复一遍。
- **影响面**：仅「洞察」页提示流出现重复条目，视觉噪音；受 `_toastFeedCap=80`（:35 `while (box.childNodes.length > _toastFeedCap) ...`）与缓冲上限双重约束，**有界**，不会无限增长。
- **建议修复方向**：语义上把缓冲改为「未渲染队列」——`_onToastForFeed` 中当 feed 容器存在时只 append 不入缓冲（或入缓冲时标记已渲染），`_flushToastFeed` 只重放「尚未 append 过」的条目；也可在 `_appendToastFeed` 中给缓冲条目加 `rendered` 标记，flush 时跳过已渲染项。

### G2. video-ended-notify.js 未注册 `__cxAddonCleanups` —— 卸载清理不成对

- **文件:行号**：`plugins/addons/video-ended-notify.js:163-168`（`start()` 内匿名 capture 监听器）；全文件无 `__cxAddonCleanups` 注册（已用全文检索核实，`plugins/addons/*.js` 中仅 auto-next.js:436、keyboard-shortcuts.js:112、tamper-guard.js:157、zhihuishu-auto-next.js:52 注册了清理，video-ended-notify 是唯一缺失者）
- **问题描述**：`start()` 注册了 `document.addEventListener('ended', ..., true)`（:163-166）与 `document.addEventListener('play', function(){ restoreIfNeeded() }, true)`（:168），均为匿名函数。其余 4 个 addon 都把自己的监听器/定时器注册进 `window.__cxAddonCleanups`（lifecycle.js:134-140 统一消费并清空），本 addon 没有。
- **代码依据**：
  ```js
  // video-ended-notify.js:163-168 —— 匿名监听器，无可移除引用
  document.addEventListener('ended', function (e) { if (!e.target || e.target.tagName !== 'VIDEO') return; onThisPageEnded(e); }, true);
  try { document.addEventListener('play', function () { bestEffort(restoreIfNeeded, 'ven.restoreOnPlay'); }, true); } catch (e) {}
  // 对比 keyboard-shortcuts.js:112-115 —— 正确成对模式
  window.__cxAddonCleanups.push(function () { try { document.removeEventListener('keydown', onKey, true); } catch (e) {} });
  ```
- **为什么影响幂等性**：审查要点 #2 要求「`__cxAddonCleanups` 是否成对」。此缺口的直接后果不是**注入重复**（`__cxEndedNotifyStarted` 守卫仍在，不会二次注入），而是**清理不成对**：执行 `window.__CX_FORCE_PLAY.uninstall()` 后这两个监听器仍附着在 document 上，且闭包持有 `ns`（`window.__CX_FORCE_PLAY` 对象引用）与 `TK`，卸载后 `isEnabled()/notifyOS()/muteAll()` 仍可能被后续 `ended`/`play` 事件触发（OS 通知/静音副作用残留）；在 bfcache / 热禁用场景下监听器跨页面存活。
- **建议修复方向**：将两个监听器提为命名函数，在 `start()` 内 `window.__cxAddonCleanups = window.__cxAddonCleanups || []; window.__cxAddonCleanups.push(function () { document.removeEventListener('ended', fn, true); document.removeEventListener('play', fn2, true); });`，与其它 addon 对齐（守卫在前的结构无需改动）。

### G3. panel-ds-console.js ticker 闭包捕获旧 el —— 面板重建后控制台不再自动刷新（陈旧而非累积）

- **文件:行号**：`presentation/panel-ds-console.js:31-33` + 调用点 `presentation/panel-core.js:584`
- **问题描述**：`bindDSConsole(el)` 里 `_dsTickerId` 模块级守卫保证只创建**一个** 2s ticker（防重复定时器，幂等正确），但 ticker 回调 `function () { _dsUpdateConsole(el); }` 闭包捕获了**首次调用时的 el**。若 deepseek 应答端页面因 R11 自愈（面板节点脱离文档）而重建面板，ensurePanel 再次执行到 `bindDSConsole(newEl)`（panel-core.js:584），此时 `_dsTickerId` 已非空 → 不再为新面板起 ticker；旧 el 已脱离文档，`_dsUpdateConsole(oldEl)` 对不可见节点空转。新面板仅在建成的当下被 `_dsUpdateConsole(el)`（:28）刷一次，之后登录态/通道状态等不再 2s 自动更新。
- **代码依据**：
  ```js
  // panel-ds-console.js:31-33
  if (!_dsTickerId) {
    _dsTickerId = window.__CX_FORCE_PLAY.TimerRegistry.setInterval(function () { bestEffort(function () { _dsUpdateConsole(el); }, 'ds.ticker'); }, 2000, 'ds-console');
  }
  ```
- **为什么影响幂等性**：这是「旧句柄被覆盖丢失」的镜像问题——守卫阻止了重复定时器，代价是定时器永远指向首个 el。属于重建路径下的**陈旧**缺陷（状态停止刷新），不产生重复副作用，故定级一般而非严重。
- **建议修复方向**：ticker 回调内不捕获 el，改为每次执行时 `document.getElementById('__cxPanel')`（或 `window.top.document`）现查节点再 `_dsUpdateConsole`；或在重建检测到 `_dsTickerId` 存在时先 `TimerRegistry.clearInterval(_dsTickerId)` 再重新注册到新 el（与 tamper-guard.js:122-126 的 clear-then-set 模式对齐）。

---

## 二、建议（5 条）

### S1. panel-controls.js 仅 `_zhBtn` 有重复绑定守卫，其余 20+ 控件绑定无守卫

- **文件:行号**：`presentation/panel-controls.js:61-75`（`_zhBtn.__cxBound` 守卫）vs 同文件其余全部绑定（:12/:35/:80/:90/:100/:110/:121/:134/:147/:157/:183/:192/:200/:213/:226/:255/:264/:276/:287 等，均裸 `addEventListener`）
- **问题描述**：`bindPanelControlEvents(el)` 内 20 余处 `addEventListener` 全部无一次性标记，唯独智慧树「打开作业/考试助手」按钮有 `if (!_zhBtn.__cxBound)` 守卫。**当前调用链是安全的**：ensurePanel 每次构建全新节点（`el.innerHTML = buildPanelHTML(...)` 后 querySelector），且 `if (_cxPanel) return` 使同一节点只会走一次绑定流程，因此不会实际重复。但该守卫的不对称暴露了契约脆弱性——若未来 ensurePanel 改为复用节点、或 bindPanelControlEvents 被重复调用，其余控件将整批叠加监听（同一 handler 多份 → 每次 change/click 触发多次）。
- **为什么影响幂等性**：属于审查要点 #1「对同一 DOM 元素重复 addEventListener」的**潜在**路径；当前不可达，故定级建议。
- **建议修复方向**：函数入口加一次 el 级守卫（如 `if (el.__cxControlsBound) return; el.__cxControlsBound = true;`），或在注释中强制约定「本函数只能绑定新建节点，禁止对复用节点调用」。

### S2. panel-core.js `reclampSoon()` 定时器无句柄管理

- **文件:行号**：`presentation/panel-core.js:153`（`function reclampSoon() { setTimeout(function () { clampNinjaPos(); }, 320); }`），调用点 :358 / :377 / :553 / :567
- **问题描述**：每次 ninja 展开（点击展开、切 tab 展开、ui:switchTab 展开）都新起一个 320ms 一次性定时器，无 clearTimeout。快速连续切换会堆积多个一次性定时器，各自执行一次 `clampNinjaPos()`（无状态叠加，纯位置收敛，故影响可忽略）。
- **为什么影响幂等性**：不属于泄漏级问题（一次性、自终结），但定时器句柄无管理是典型的幂等性脆弱点；若未来回调被改为有副作用的逻辑即升级为真实问题。
- **建议修复方向**：模块级 `var _reclampTimer = null;`，调度前 `clearTimeout(_reclampTimer)` 再赋值。

### S3. panel-core.js `showFabMenu()` 文档级 close 监听自清理滞后

- **文件:行号**：`presentation/panel-core.js:194-195`
- **问题描述**：每次打开 ninja 右键菜单，在 document 上挂 `mousedown`/`keydown` 两个 close 监听（capture，setTimeout 0 延迟挂载）；旧菜单被下一次打开时的 `old.remove()`（:173）移除时，其 close 监听**不会**被同步移除，只有等到下一次全局 mousedown/keydown 触发时才自清理（`m.remove(); document.removeEventListener(...)` 对已移除节点是幂等 no-op，随后自我反注册）。连续多次打开菜单会暂留若干一次性监听直到下一次全局点击。
- **为什么影响幂等性**：监听数量随「打开次数 - 触发次数」暂留，虽会自愈，但属监听器句柄管理不闭环。
- **建议修复方向**：把 close 函数提为具名引用，打开新菜单前先 `document.removeEventListener` 旧引用（与菜单节点同生命周期管理）。

### S4. auto-next.js 幂等守卫前置站点隔离 —— 站点切换后无法再激活

- **文件:行号**：`plugins/addons/auto-next.js:23-24`（守卫）→ :27（站点隔离 return）→ :451（`setTimeout(bootstrap, 300)`）
- **问题描述**：`window.__cxAutoNextStarted = true` 设置在站点隔离检查**之前**。非 chaoxing 页面同样置位 → 若同一 window 内发生 SPA 式整站切换（chaoxing 页面替换页面内容），bootstrap 被永久跳过，addon 永不启动。
- **为什么影响幂等性**：对幂等性而言这是**正确的**（守卫覆盖全部副作用路径、setTimeout 在守卫内），但守卫语义过宽，牺牲了站点切换后的可恢复性——属于「幂等正确但语义可优化」。
- **建议修复方向**：把守卫拆成两层：`__cxAutoNextInjected`（已注入，防二次加载）与站点激活检查（每次 bootstrap 内判断），或文档化「本 addon 单次注入不可复活」。

### S5. keyboard-shortcuts.js 守卫后置站点隔离 —— 与其它 addon 风格不一致

- **文件:行号**：`plugins/addons/keyboard-shortcuts.js:10`（站点隔离 return 在前）→ :87-88（`__cxKbStarted` 守卫在后）
- **问题描述**：与 auto-next（守卫前置）相反，本 addon 守卫在站点隔离之后。当前单次注入语义下无重复风险（模块只运行一次），但若未来 addon 文件被独立重复加载（脱离 bundle 场景），非站点页不置位守卫会让第二次加载在站点切换后重复执行全部副作用（keydown 监听、MUTE_START 轮询、队列 push）。
- **为什么影响幂等性**：跨文件守卫位置不一致是维护性风险，属于「约定不统一」。
- **建议修复方向**：统一为「守卫前置 + 站点隔离在后」（tamper-guard.js:133-137、quiet-popups.js:11-12、zhihuishu-auto-next.js:12-16 已是该模式）。

---

## 三、正向-良好实践（重点防重复机制核实记录）

以下逐条为**核实通过**的幂等性设计，均有源码依据：

1. **面板装配三重守卫**（panel-core.js）：`if (_cxPanel) return _cxPanel`（:39）+ `pd.getElementById('__cxPanel')` 复用（:49-50）+ R11 自愈仅在节点脱离文档时置空重建（:36-38）。重建用**全新节点**（:69-80 innerHTML），旧节点监听随节点销毁 → 不存在同一节点重复绑定路径。**这是面板层无重复监听的根因**。
2. **style 注入全部 getElementById 守卫**（panel-core.js:104-129）：`__cxPanelMobileStyle` / `__cxPanelNinjaStyle` / `__cxPanelAnimStyle` 三个 style 均先查后插，重建不重复 appendChild。
3. **三个模块级一次性订阅标记**（panel-core.js:12-15 `_panelOutsideClickBound`、:93-96 `_feedSubscribed`、:547-558 `_switchSubscribed`），注释明确「必须置于模块作用域（不能放 ensurePanel 函数体内），否则每次调用被重新 =false 导致守卫失效」——对 EventBus 无去重语义（state.js:29）的补强正确。
4. **toast 单例 + 定时器替换**（toast.js:25-26 先 getElementById 后创建、:43-44 `clearTimeout(cxState(t).timer)` 后置新定时器）：同 id 重复 showToast 不堆积、不叠加动画，悬浮隐藏定时器始终只有一个。
5. **命令注册覆盖语义**（commands.js:34）：同名 `registerCommand` 直接覆盖（desc/exec/group 更新后 return），不会累积重复命令；`initBuiltinCommands` 有 `if (_cxCommands.length) return` 幂等守卫（:62）；命令列表/补全不会翻倍。
6. **命令面板全局 mousedown 单次绑定**（commands.js:301-313）：`_cxCmdOutsideBound` 标记防重复。
7. **addon 注册中心按 id 去重**（registry.js:16 `_cxAddons = {}`、:104 `if (a && a.id && !_cxAddons[a.id]) _cxAddons[a.id] = a;`）：即使 `__cxAddonQueue` 被同一 addon 多次 push，也只会注册一次；`drainAddonQueue` 排空后 `q.length = 0`（:106），ensurePanel 再次排空不重放。
8. **6 个 addon 的幂等守卫全部覆盖 setTimeout bootstrap 路径**：auto-next.js:23-24 → :451、zhihuishu-auto-next.js:12-13 → :58 的 `setTimeout(bootstrap, 300)` 均在守卫**之后**调度；副作用（队列 push、监听器、cleanup 注册）全部在守卫内，bootstrap 至多执行一次。keyboard-shortcuts/quiet-popups/tamper-guard/video-ended-notify 无延迟启动，直接顺序执行，同样全部在守卫内。
9. **tamper-guard 定时器 clear-then-set**（tamper-guard.js:122-126 `_startGuard` 内 `if (_tgTimer) { clearInterval; _tgTimer=null; }` 再 set）：即使 init 路径重复也只有一个 guardTick 定时器；`cxTgBar` 创建有 getElementById 守卫（:24-31）；告警有 3s 节流（:100-104）+ 连续 2 轮确认（:88-89）防抖动刷屏。
10. **keyboard-shortcuts 提示气泡单例 + 定时器替换**（keyboard-shortcuts.js:73-82）：`_ht` 单例、`clearTimeout(_ht._t)` 后置；MUTE_START 轮询自终结（:94-98 命中即 clearInterval + 15s 兜底）。
11. **video-ended-notify 一次性监听自清理**（:98-130）：`whenPlaying` / `freezeVideoAndWait` 均 `addEventListener(..., { once: true })` + 显式 `removeEventListener` + 超时兜底，无监听残留（注：全局 ended/play 监听缺 cleanup 见 G2）。
12. **zhihuishu-fab 创建守卫**（zhihuishu-fab.js:287 `if (_zhsFab) { _zhsMaybeSwitchMode(); return; }`）：重复创建被模块闭包变量阻断（非 getElementById 检查，但效果等价且更省开销）；style 注入有 `getElementById('__cxZhsStyle')` 守卫（:290）；`_zhsBindPop` 在 `pop.innerHTML` 重建后绑定**全新节点**（:278-281），旧监听随节点销毁，模式切换（video↔exam）不累积监听；`zhihuishuFabTick` 只做 ensure+refresh+计数，**不绑定任何监听**（:314-319），每轮一次（sites/zhihuishu.js:30-35 registerSiteTick 覆盖式注册，site-router.js:133 `SITE_TICKS[site] = fn` 无累积）。
13. **panel.js 事件订阅全部模块级一次性**（:101/:106/:107/:110/:111/:133/:134/:168/:169/:268-272）：`panel:refresh`/`videos:scanned`/`ui:toast`/`cmd:scan`/`zhExam:diag` 均只在 bundle 注入时订阅一次，无 offEv 也不累积；keydownHandler 命名函数（:198）供 lifecycle.js:68 显式 removeEventListener。
14. **dashboard 渲染幂等**（dashboard.js:345-348）：`renderVideoList` 用 `wrap.__cxLastHTML !== html` 缓存跳过重复 innerHTML 写入（既是性能优化也是幂等保护）；其余均为对既有节点的赋值/classList 操作，重复调用无害。
15. **卸载清理闭环**（lifecycle.js）：`_cleaned` 守卫（:59）防 pagehide+beforeunload 双触发重复还原；`__cxAddonCleanups` 消费后清空（:134-140）；`EventBus.clearSubs()` 终态清空全部订阅（:168）；启动守卫标志统一删除（:142-146）——为 addon 清理提供了成对出口（G2 的 video-ended-notify 除外）。
16. **panel.js 解冻自检节流**（:79 400ms 节流 + :92 元凶变化才告警）：重复 appendChild 重挂（:91）是幂等 DOM 移动，无节点堆积，告警 toast 有去重。

---

## 四、无问题模块（明确结论）

| 模块 | 结论 | 依据 |
|---|---|---|
| presentation/panel-template.js | 无问题 | 纯 HTML 字符串构建函数（buildPanelHTML/buildDSConsoleHTML），零副作用、零状态，天然幂等 |
| presentation/styles.js | 无问题 | 纯数据对象 + `window.__cxUI = STYLES` 覆盖式导出（:344），无 DOM 注入、无监听 |
| presentation/panel-drag.js | 无问题 | 仅注释与空壳（14 行死代码），无任何副作用 |
| presentation/diagnostics.js | 无问题 | 全部为只读构建函数（buildDiagnostics/buildInvasionReport/buildFeatureSelfTest/buildDevReport）；模块级副作用仅为 4 个覆盖式导出（:406-409）；`_cxAllFrames` 纯遍历 |
| presentation/dashboard.js | 无问题 | 全部为渲染函数（对既有节点赋值/classList/innerHTML 缓存），无监听、无定时器、无订阅 |
| plugins/registry.js | 无问题 | 注册中心按 id 去重（:104）；`drainAddonQueue` 排空语义正确（:106）；两次调用（:112/:582）不会重放 |
| plugins/addons/quiet-popups.js | 无问题 | 守卫在首行（:11-12），无定时器/监听器，唯一副作用（队列 push + register）在守卫内 |
| plugins/addons/zhihuishu-auto-next.js | 无问题 | 守卫在首行（:12-13），setTimeout（:58）在守卫内，storage 监听器与 cleanup 成对（:51-53） |

---

## 五、审查要点逐项对照表（任务要求 6 项）

1. **面板重复渲染/重建**：✔ 无问题。重复 addEventListener → 不存在（ensurePanel 每构建绑定全新节点，见正向 #1/#3）；重复 appendChild 注入 style → 有 getElementById 守卫（#2）；重复 EventBus 订阅 → 全部模块级一次性 + 三个模块级标记（#3）；重复定时器 → DS ticker 有 `_dsTickerId` 守卫（唯一缺陷为重建后陈旧，见 G3），主循环经 TimerRegistry clear-then-set（main-loop.js:101-104）。
2. **工具库 addon 幂等**：✔ 基本无问题。6 个 addon 守卫均覆盖全部副作用路径、setTimeout 均在守卫内（正向 #8）；`__cxAddonQueue` push 每次注入一次、注册中心按 id 去重（#7）；`__cxAddonCleanups` 5/6 成对（唯一缺失见 G2）；addon 内部 setInterval/监听器无重复（#9/#10/#11）。
3. **命令注册**：✔ 无问题。同名注册为覆盖非累积（commands.js:34）；命令列表/补全不会翻倍。
4. **toast 系统**：✔ 无问题。单例节点 + clearTimeout 替换定时器（toast.js:25-26,43-44）；同 id 重复 showToast 不堆积。feed 侧重复 append 见 G1（属面板重建路径）。
5. **zhihuishu-fab.js**：✔ 无问题（幂等性角度）。`_zhsEnsureFab` 以闭包变量 `_zhsFab` 防重复创建（非 getElementById 检查，但等效且无重复创建路径）；tick 不绑定监听、仅 ensure+refresh+计数；监听全部绑定在每次 innerHTML 重建后的新节点上，不累积。附带指出：创建守卫依赖闭包变量而非 DOM 状态，FAB 节点被外部移除后无法自愈重建（健壮性问题，非幂等性问题）。
6. **诊断/仪表**：✔ 无问题。dashboard/diagnostics 均为纯渲染/只读构建，无监听累积、无订阅。
