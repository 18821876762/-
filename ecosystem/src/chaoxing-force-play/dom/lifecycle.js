  // ===== DOMAIN: dom lifecycle =====
  // ===== MODULE: 卸载还原与生命周期(cleanupListeners) =====
  // 域：DOM监听与注入层 —— 页面卸载时的侵入性还原（uninstall 语义的唯一实现处）。
  //
  // 【内聚性收敛】本块原寄居于 dom/dom.js 尾部，与 overrideVideo/walkVideos（施加接管）混居。
  // 但二者职责恰好相反：接管引擎负责「加 Hook」，本模块负责「拆 Hook」，且本模块的还原清单横跨
  // config.js / targeting.js / panel.js / main-loop.js / core.js 五个模块的侵入点——它本质是
  // 「全脚本生命周期终结者」，而非 DOM 接管的一部分。独立成模块后，新增侵入点时应改的位置一目了然。
  //
  // 【跨模块引用说明】下列符号定义在其他模块，均为顶层 var/function，同处一个 IIFE 闭包，
  //   函数声明 hoist + 运行时才执行，故不受模块拼接顺序影响：
  //     NATIVE_PAUSE / NATIVE_RATE_DESC   ← meta-config/config.js
  //     _attachHooked / siteAttachmentsKey ← biz/targeting.js（钩子标志）/ site/site-router.js
  //     keydownHandler                     ← ui/panel.js
  //     playWatchHandler / _loopTimer      ← bootstrap/main-loop.js
  //     globalErrorHandler                 ← bootstrap/core.js
  //     _mo / visibilityHandler            ← dom/dom.js（MO 实例与可见性处理器）
  //
  // 【还原清单归属】_ananasNeutralized 由 dom.js 的 neutralizeGlobalPause 写入；
  //   _playWatchDocs 由 main-loop.js 的 installPlayWatch 写入。二者的「读取/清空」都只发生在本模块，
  //   故声明随读取方集中于此（写入方在运行时才执行，此时变量早已初始化完毕）。

  // 还原清单：记录被中和的 window.ananas 全局暂停封装实例（跨 iframe 各 frame 独立），供 cleanupListeners 还原。
  // 写入方是 dom.js 的 neutralizeGlobalPause；必须在其首次执行前完成初始化——本模块在构建顺序上位于
  // dom.js 之后，但 var 声明在 IIFE 顶层求值阶段即完成，早于任何函数调用，故安全。
  var _ananasNeutralized = [];

  // 还原清单：记录装过 play 即时接管监听的 document（顶层 + 各同源 iframe），供 cleanupListeners 摘除。
  // 写入方是 main-loop.js 的 installPlayWatch，读取方是下方 cleanupListeners，二者均在运行时执行。
  var _playWatchDocs = [];

  // 幂等守卫：pagehide 与 beforeunload 在多数浏览器会先后各触发一次，若无守卫则整个还原流程被执行两遍
  // （重复 defineProperty / setActionHandler）。还原是一次性终态操作，二次执行无意义。
  var _cleaned = false;

  // 监听器清理 + 侵入性还原（审查 JS1-2 / 侵入性治理）：页面卸载时断开 MutationObserver、清除轮询定时器、
  // 移除全局监听器，并撤销脚本对宿主页面的侵入性 Hook，避免页面软卸载/bfcache 后残留死 Hook，使页面回到注入前状态。
  // 还原清单（八项，新增侵入点必须同步登记，否则 uninstall 语义即失真）：
  //   ① HTMLMediaElement.prototype.pause      ② prototype.playbackRate 描述符
  //   ③ window.attachments setter             ④ navigator.mediaSession 暂停处理
  //   ⑤ window.ananas.pause 中和              ⑥ play 即时接管监听（顶层 + iframe 文档）
  //   ⑦ window error 诊断监听                 ⑧ pagehide/beforeunload 钩子自身
  // 注：@grant none 脚本无法感知 Tampermonkey 的"热禁用"事件，最干净的还原仍需刷新页面；此处还原在
  // pagehide/beforeunload 触发，另暴露 window.__CX_FORCE_PLAY.uninstall 供手动/副脚本触发干净还原。
  function cleanupListeners() {
    if (_cleaned) return;   // 幂等：pagehide + beforeunload 双触发时只还原一次
    _cleaned = true;
    try { if (_mo && _mo.disconnect) _mo.disconnect(); } catch (e) { swallow(e); }
    try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }
    try { document.removeEventListener('keydown', keydownHandler); } catch (e) { swallow(e); }
    try { document.removeEventListener('visibilitychange', visibilityHandler, true); } catch (e) { swallow(e); }
    // ① 还原 HTMLMediaElement.prototype.pause（仅当被本脚本 noop 包装时才写回原生实现）
    try {
      if (typeof HTMLMediaElement !== 'undefined' && NATIVE_PAUSE && HTMLMediaElement.prototype.pause !== NATIVE_PAUSE) {
        HTMLMediaElement.prototype.pause = NATIVE_PAUSE;
      }
    } catch (e) { swallow(e); }
    // ② 还原 HTMLMediaElement.prototype.playbackRate setter（还原为注入前的原始属性描述符）
    try {
      if (typeof HTMLMediaElement !== 'undefined' && NATIVE_RATE_DESC) {
        Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', NATIVE_RATE_DESC);
      }
    } catch (e) { swallow(e); }
    // ③ 还原 window.attachments setter（脚本自建钩子，configurable:true 可删除，回到注入前"未定义"状态）
    try {
      if (_attachHooked && typeof siteAttachmentsKey === 'function') { delete window[siteAttachmentsKey()]; _attachHooked = false; }
    } catch (e) { swallow(e); }
    // ④ 还原 navigator.mediaSession 暂停处理（清除 no-op 劫持）
    try {
      if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function') {
        navigator.mediaSession.setActionHandler('pause', null);
      }
    } catch (e) { swallow(e); }
    // ⑤ 还原 window.ananas.pause 中和（逐个 frame 的 ananas 全局暂停封装还原为注入前真原生，清除全局死 Hook）
    try {
      for (var _ai = 0; _ai < _ananasNeutralized.length; _ai++) {
        var _a = _ananasNeutralized[_ai];
        if (_a && _a.__cxAnanasNativePause) { try { _a.pause = _a.__cxAnanasNativePause; } catch (e) { swallow(e); } }
      }
      _ananasNeutralized.length = 0;
    } catch (e) { swallow(e); }
    // ⑥ 摘除 play 即时接管监听（顶层文档 + 所有已下钻的同源 iframe 文档）
    //    若遗漏此项，卸载后该捕获监听仍会在用户暂停时把视频压回暂停，即「已卸载却仍在干预播放」。
    try {
      for (var _pi = 0; _pi < _playWatchDocs.length; _pi++) {
        var _d = _playWatchDocs[_pi];
        try { if (_d && _d.removeEventListener) _d.removeEventListener('play', playWatchHandler, true); } catch (e) { swallow(e); }
      }
      _playWatchDocs.length = 0;
    } catch (e) { swallow(e); }
    // ⑦ 摘除全局错误监听（core.js 注册的诊断钩子）
    try { window.removeEventListener('error', globalErrorHandler); } catch (e) { swallow(e); }
    // ⑧ 摘除卸载钩子自身：手动 uninstall() 后页面继续存活时，不留残余监听（页面真卸载时本项无副作用）
    try { window.removeEventListener('pagehide', cleanupListeners); } catch (e) { swallow(e); }
    try { window.removeEventListener('beforeunload', cleanupListeners); } catch (e) { swallow(e); }
  }
  try { window.addEventListener('pagehide', cleanupListeners); } catch (e) { swallow(e); }
  try { window.addEventListener('beforeunload', cleanupListeners); } catch (e) { swallow(e); }
  try { window.__CX_FORCE_PLAY.uninstall = cleanupListeners; } catch (e) { swallow(e); }   // 暴露手动卸载还原钩子（应对热禁用）
