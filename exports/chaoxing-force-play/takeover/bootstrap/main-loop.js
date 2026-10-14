// @provides: isEffectiveTopFrame, singleVideoActive
// @requires: CONFIG, CoreState, EventBus, FLAGS, NATIVE_PAUSE, allVideos, bestEffort, dbg, foregroundVideo, markDomDirty, reconcileIntrusionMode, refreshTargets, releaseVideo, scanVideos, topHref, urlParam, videoDriftStableKeys
// @source-group: takeover/bootstrap/main-loop.js
  // ===== DOMAIN: bootstrap/main-loop (startup + main loop scheduler) =====
  // 即时接管：任何 video 一开始 play 即立刻 override，无需等 2s 轮询（吸收 chaoxing-media-collector 的 play 捕获思路）。
  // 缩短动态插入播放器的接管空窗，使手动暂停开关对"新插入、尚未轮询到"的视频也可靠生效；overrideVideo 自身幂等且
  // 在 __cxUserPaused 时交还原生 pause 提前返回，故对暂停态/已接管视频无副作用。
  // 即时接管 play 事件（修复复审：同源 iframe 内视频的 play 事件不冒泡到顶层 document，需在 iframe 文档内也装一份）
  // 【架构·生命周期】handler 必须是具名函数、且安装过的 document 需登记到 _playWatchDocs（takeover/dom/lifecycle.js 声明）：
  //   否则 cleanupListeners / window.__CX_FORCE_PLAY.uninstall() 无法 removeEventListener，卸载后该捕获监听
  //   仍然存活并继续在用户暂停时把视频压回暂停，与 uninstall「回到注入前状态」的语义承诺相违背。
  //   切勿改回内联匿名函数。
  function playWatchHandler(e) {
    // edu 站也接管：学校超星 edu.cn 定制播放器 detectSite() 回落 'edu'，SITES.edu 为安全基线（空键、不钩 window.attachments/ananas），
    // 仅全量扫描 + 原型级 pause 中性化、无私有全局副作用。原「完全惰性」误伤真实超星视频（#1 回归要求：edu.cn 视为 chaoxing）。
    bestEffort(function () {
      if (e && e.target && e.target.tagName === 'VIDEO') {
        // 接管关闭：完全交还平台原生播放/暂停行为，不做任何拦截
        if (!takeoverActive()) return;
        var _pv = e.target;
        if (_pv[FLAGS.userPaused]) { bestEffort(function () { (_pv[FLAGS.np] || NATIVE_PAUSE).call(_pv); }, 'loop.playWatch.nativePause'); return; }
        // v4.19.50：视频「播放事件」即触发答题完全出清（等同刷新页面，双端：课程页各帧 quizHardReset + DS 应答端 _dsEvictAll）。
        // 换节/换视频 → 上一题时段立即从零开始；同视频暂停恢复/循环 key 不变 → 不重复。事件驱动，比轮询比对稳定键更即时。
        if (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_EVICT_ON_VIDEO_PLAY) _evictOnVideoPlay(_pv);
        overrideVideo(_pv, foregroundVideo());
      }
    }, 'loop.playWatch');
  }
  // v4.19.50 播放出清守卫：本次播放视频的稳定键(videoDriftStableKeys，跨 blob 重建存活)与上次不同 → 写 GM 通知键
  // cx_quiz_evict_v1（脚本级共享 → 同页各帧 + 跨标签页的 DS 应答端都收到并各自硬重置）。同步更新轮询路径的
  // _evictLastVideoKey，避免事件触发后下一轮轮询又清一次（幂等收敛）。GM 键写入轻量（小 JSON，非大值）。
  var _evictPlayVideoKey = '';
  function _evictOnVideoPlay(v) {
    bestEffort(function () {
      var _k = '';
      try {
        if (typeof videoDriftStableKeys === 'function') { _k = (videoDriftStableKeys(v) || []).join('|'); }
        if (!_k) { _k = String(v.currentSrc || v.src || v.id || ''); }
      } catch (e) {}
      if (!_k) return;
      if (_k === _evictPlayVideoKey) return;   // 同视频（暂停恢复/清晰度重建/循环）不重复出清
      _evictPlayVideoKey = _k;
      dbg('视频播放触发答题完全出清（key 变化）');
      try { if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizHardReset === 'function') window.__CX_FORCE_PLAY.quizHardReset('video-play'); } catch (e) {}   // 本帧立即清
      if (_evictLastVideoKey !== _k) _evictLastVideoKey = _k;   // 同步轮询路径防双清
      if (typeof GM_setValue === 'function') { GM_setValue('cx_quiz_evict_v1', JSON.stringify({ ts: Date.now(), by: 'video-play', key: _k })); }   // 全局通知（同页帧 + DS 应答端）
    }, 'loop.evictOnPlay');
  }
  function installPlayWatch(doc) {
    if (!doc || !doc.addEventListener) return;
    bestEffort(function () {
      doc.addEventListener('play', playWatchHandler, true);
      if (_playWatchDocs.indexOf(doc) === -1) _playWatchDocs.push(doc);
    }, 'loop.installPlayWatch');
  }
  bestEffort(function () { installPlayWatch(document); }, 'loop.installPlayWatch.doc');
  bestEffort(function () { hookAttachments(); }, 'loop.hookAttach');
  bestEffort(function () { bridgeInit(); }, 'loop.bridgeInit');
  bestEffort(function () { refreshTargets(); }, 'loop.refreshTargets');
  // edu 站（detectSite()==='edu'，学校超星 edu.cn 定制播放器）也走接管：SITES.edu 为安全基线（空 attachmentsKey/ananasKey，不钩私有全局），
  // 仅全量扫描 + 原型级 pause 中性化、无副作用。原「完全惰性」会使真实超星视频完全失效（#1 回归要求：edu.cn 视为 chaoxing）。
  bestEffort(function () { scanVideos(document); neutralizeGlobalPause(window); }, 'loop.scanInit');

  // 【架构·顶层帧编排】主循环(_loopTick)与面板/DeepSeek 状态编排只在承载面板的「顶层帧」运行一次；
  // iframe 仅保留轻量视频+题目扫描(上面的 installPlayWatch/scanVideos 初扫/neutralizeGlobalPause/quizObserve 均为每帧独立、事件/MO 驱动)，
  // 不再各自起 2s 主循环 → 多帧页面(顶+多个 iframe)的每帧开销从 ×N 收敛为 ×1，直接消除「内存翻倍/加载变慢」的放大器。
  // 视频在 iframe 内仍被 play 事件接管(overrideVideo)与初扫覆盖，题目仍由每帧 MutationObserver 触发；
  // autoStop/resume/rate 等对「iframe 内课程视频」的周期性维护改为事件驱动(play 时 overrideVideo 设速率+拦截暂停)，
  // 不再走 2s 轮询——属顶层帧编排的预期取舍，真实站点实测兜底(见对话记录)。
  var _isTopFrame = (typeof window !== 'undefined') && (window.self === window.top);

  // v4.19.18 修复·有效顶层帧：LMS 将超星嵌在跨域 iframe 时，所有同源帧都不满足 window.self===window.top，
  // 旧版「仅顶层帧起主循环」门控(_isTopFrame)导致主循环在「任何帧」都不启动 → 视频失去周期接管/漂移守卫/全局暂停中和 → 续播失效（诊断表现：主循环=已停·轮次=0）。
  // 改为「有效顶层帧」：沿 window.parent 向上探测，若上方不存在任一「运行本脚本的同源帧」，则本帧即有效顶层，应启动主循环。
  // 语义：①真正顶层(window.self===window.top)→有效顶层；②上方有运行本脚本的同源帧(如视频 iframe 的父=超星壳)→由其统一编排，本帧不自起；
  // ③上方无运行脚本的帧(LMS 跨域嵌入：父不可达/无 __CX_FORCE_PLAY)→本帧为有效顶层，自起主循环并经 walkVideos 同源递归接管嵌套视频。
  // 与「顶层帧编排」节流目标一致：正常页面(超星即顶层)仍只起一份主循环，无 ×N 回归；仅 LMS 嵌入盲区被补齐。
  function isEffectiveTopFrame() {
    try {
      if (typeof window === 'undefined') return true;
      if (window.self === window.top) return true;            // ①真正顶层
      var p = window.parent;
      while (p && p !== window.self) {
        var _above = false;
        try { if (p.__CX_FORCE_PLAY) _above = true; } catch (e) { /* 跨域父帧不可达，视为无脚本 */ }
        if (_above) return false;                             // ②上方有运行本脚本的同源帧 → 由其编排，本帧不自起
        if (p === window.top) break;
        try { p = p.parent; } catch (e) { break; }            // 跨域，无法继续上探
      }
      return true;                                            // ③上方无运行本脚本的同源帧 → 本帧为有效顶层
    } catch (e) { return true; }
  }

  var _tamperAlarmed = false;   // #1 原型还原报警去抖（跨轮保持）
  // v4.19.29·出清系统：跟踪「上一个前台视频稳定键」与「上一个课程 URL」，用于检测答题时段边界（下一视频开始/换课）
  var _evictLastVideoKey = null;
  var _evictLastUrl = null;
  var _evictPeriodTs = 0;   // v4.19.30·统一数据治理周期巡检计时（DATA_GOV_PERIOD_MIN，默认禁用）
  // ——————————————————————————————————————————————————————————
  // 接管开关（全局 ENABLED + 课程黑名单 DISABLED_COURSES）
  // ——————————————————————————————————————————————————————————
  var _takeoverWasActive = true; // 启动时假定激活；首轮按配置校正
  function _currentCourseId() {
    try { return (typeof urlParam === 'function') ? urlParam(topHref(), ['courseId']) : ''; } catch (e) { return ''; }
  }
  function _courseInDisabledList() {
    var cid = _currentCourseId();
    if (!cid) return false;
    return (CONFIG.DISABLED_COURSES || []).indexOf(cid) !== -1;
  }
  function _courseInSingleVideoList() {
    var cid = _currentCourseId();
    if (!cid) return false;
    return (CONFIG.SINGLE_VIDEO_COURSES || []).indexOf(cid) !== -1;
  }
  // 单视频模式：全局 SINGLE_VIDEO=true 或 当前课程在 SINGLE_VIDEO_COURSES 名单 —— 避免并发续播触发风控
  function singleVideoActive() {
    try { return CONFIG.SINGLE_VIDEO === true || _courseInSingleVideoList(); } catch (e) { return false; }
  }
  function takeoverActive() {
    return CoreState.canRun();
  }
  function _takeoverDisableReason() {
    if (CONFIG.ENABLED === false) return '已关闭全局接管（续播 / 答题已停用，仅留面板与诊断）';
    var cid = _currentCourseId();
    if (cid && (CONFIG.DISABLED_COURSES || []).indexOf(cid) !== -1) return '本门课程已停用续播（courseId=' + cid + '）';
    return '已恢复接管（续播 / 自动答题）';
  }
  function _releaseTakeover() {
    bestEffort(restoreGlobalPause, 'loop.disable.restoreGlobal');
    bestEffort(function () {
      if (_mediaSessionSaved && navigator.mediaSession) {
        navigator.mediaSession.setActionHandler('pause', _origMediaSessionPause || null);
        if (_origMediaSessionState !== null) navigator.mediaSession.playbackState = _origMediaSessionState;
        _mediaSessionSaved = false;
        if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._mediaSessionHooked = false;
      }
    }, 'loop.disable.restoreMedia');
    bestEffort(function () {
      if (typeof allVideos !== 'function') return;
      var vs = allVideos(true);
      for (var i = 0; i < vs.length; i++) { if (typeof releaseVideo === 'function') releaseVideo(vs[i]); }
    }, 'loop.disable.release');
    bestEffort(function () {
      if (typeof restorePrototypeNeutralization === 'function') restorePrototypeNeutralization();
    }, 'loop.disable.restoreProto');
  }
  function _onTakeoverInactive() {
    if (!_takeoverWasActive) return;
    _takeoverWasActive = false;
    _releaseTakeover();
    bestEffort(function () {
      if (typeof EventBus !== 'undefined' && EventBus && EventBus.emit) EventBus.emit('ui:toast', _takeoverDisableReason(), 'info');
    }, 'loop.disable.toast');
  }
  function _onTakeoverActive() {
    if (_takeoverWasActive) return;
    _takeoverWasActive = true;
    bestEffort(function () { if (typeof reconcileIntrusionMode === 'function') reconcileIntrusionMode(); }, 'loop.reengage');
    bestEffort(function () { if (typeof markDomDirty === 'function') markDomDirty(); }, 'loop.markDirty');
    bestEffort(function () {
      if (typeof EventBus !== 'undefined' && EventBus && EventBus.emit) EventBus.emit('ui:toast', _takeoverDisableReason(), 'info');
    }, 'loop.enable.toast');
  }
  function applyTakeoverNow() {
    if (!takeoverActive()) _onTakeoverInactive(); else _onTakeoverActive();
  }
  CoreState.onChange(function (view) {
    if (view.state === 'RUNNING') {
      _onTakeoverActive();
      if (isEffectiveTopFrame()) restartLoopTimer();
    } else {
      stopLoopTimer();
      _onTakeoverInactive();
    }
  });
