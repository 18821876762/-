  // ===== DOMAIN: dom module-08-10-15 =====
  // ===== MODULE: 接管引擎(overrideVideo) =====
  // 域：DOM监听与注入层 —— 接管引擎(overrideVideo)。
  function overrideVideo(v, fg) {
    if (!v) return;
    if (cxVideoOptOut(v)) return;   // 元素级 opt-out：data-cx-force-skip 的视频不接管
    if (BRIDGE.skipResume) return;
    // 定向命中统计：即便视频被用户暂停（上方 _ovUserPaused 提前 return）也要计入，否则全部暂停时 matchedAny 恒 false → 误触 fallback 回退全量（复审确认）
    if (TARGET.enabled && !TARGET.matchedAny && videoBelongsToTask(v)) TARGET.matchedAny = true;
    if (_ovUserPaused(v)) return;
    if (_ovSkipNonTask(v)) return;
    if (_ovForegroundGate(v, fg)) return;
    if (_ovNearEnd(v)) return;
    if (cxState(v).released) { v[FLAGS.forcePaused] = true; cxState(v).released = false; }   // F-B1：曾被释放、现重新归属任务点 → 重新接管
    if (_ovEndedLock(v)) return;
    if (_ovRebuild(v)) return;
    _ovEnforce(v);
  }

  // —— overrideVideo 子阶段（P2 拆分，零行为回归）——
  // 每个 _ovX 返回 true 表示「本阶段已接管/应终止，overrideVideo 据此 return」。
  // 子函数与主函数同处一个 IIFE 闭包，直接捕获 BRIDGE/TARGET/CONFIG/safePlay 等，无需提升状态。

  function _ovUserPaused(v) {
    if (!v[FLAGS.userPaused]) return false;
    try { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; } catch (e) { swallow(e); }
    try { if (!v.paused) (v[FLAGS.np] || NATIVE_PAUSE).call(v); } catch (e2) { swallow(e2); }
    return true;
  }

  function _ovSkipNonTask(v) {
    if (!(TARGET.enabled && !videoBelongsToTask(v))) return false;
    dbg('跳过非任务点视频（广告/插播）');
    releaseVideo(v);   // F-B1：撤销全量阶段已施加的接管，交还平台（否则广告/插播被永久强制续播）
    return true;
  }

  function _ovForegroundGate(v, fg) {
    if (!fg || v === fg) return false;   // 无前台 或 本视频就是前台：不干预（跳过）
    if (!CONFIG.SINGLE_VIDEO && cxState(v).userKeep) return false;   // 非单视频模式：用户显式保留的视频不干预
    // 单视频模式：忽略 userKeep，强制暂停所有非前台视频
    if (v[FLAGS.forcePaused]) {
      try { releaseVideo(v); } catch (e) { swallow(e); }
      try { if (!v.paused) (v[FLAGS.np] || NATIVE_PAUSE).call(v); } catch (e2) { swallow(e2); }
    }
    return true;   // 非前台视频：已暂停，允许 overrideVideo 后续阶段检查（nearEnd/ended 等）
  }

  function _ovNearEnd(v) {
    if (!(nearEnd(v) && !CONFIG.LOOP_PLAY)) return false;
    try { if (!v[FLAGS.endedLock]) releaseVideo(v); } catch (e) { swallow(e); }   // 释放接管（保留 ended 锁/重建锁）
    // P0 修复（v4.7.replay）：releaseVideo 将 play 恢复为原生后，视频 ended 时页面可能立即调用 play() 导致重播。
    // 必须安装 ended 事件监听器，在页面 ended handler 之前（捕获阶段）将 play 重新封锁，消除竞赛窗口。
    if (!v[FLAGS.nearEndEndedGuard]) {
      try {
        v[FLAGS.nearEndEndedGuard] = true;
        v.addEventListener('ended', function nearEndEndedGuard() {
          if (CONFIG.LOOP_PLAY) return;   // 循环已开：交给 _ovEnforce 的循环分支处理
          if (v[FLAGS.endedLock]) return; // 已被其他路径锁住（如 _ovEnforce ended 分支）
          try {
            v.play = function () { return Promise.resolve(); };     // 封锁 play
            v.pause = pauseNoop;                                    // 封锁 pause
            v[FLAGS.endedLock] = true;                              // 后续扫描由 _ovEndedLock 维护
            v[FLAGS.forcePaused] = true;                            // 原型级 no-op 同步生效
            cxState(v).endedSrc = (videoSrcOf(v) || '');             // 换源识别用
            try { _markEnded(videoSrcOf(v)); } catch (e1) { swallow(e1); }
            try { _endedPrune(); } catch (e1) { swallow(e1); }
            try { if (isFinite(v.duration)) v.currentTime = v.duration; } catch (e1) { swallow(e1); }
            dbg('nearEnd·ended 锁：平台 ended handler 前封锁 play，阻断重播');
          } catch (e) { swallow(e); }
        }, true);
      } catch (e) { swallow(e); }
    }
    dbg('进度到底（剩 ' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's）：已关闭续播');
    try { if (typeof _bxLog === 'function') _bxLog('ov:NearEnd', 'rem=' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's'); } catch (e) { swallow(e); }
    return true;
  }

  function _ovEndedLock(v) {
    if (!v[FLAGS.endedLock]) return false;
    // 复用同元素跨"下一节"换源：旧 ended 锁会误锁新一课，使新视频停在末尾无法播放。
    // 判定当前 src 与当初被锁死的源不同 → 解除旧锁并重新接管（不 return，落到下方正常续播）。
    try {
      var _cur = videoSrcOf(v) || '';
      if (_cur && cxState(v).endedSrc && _cur !== cxState(v).endedSrc) {
        v[FLAGS.endedLock] = false;
        try { delete v.play; } catch (e0) { swallow(e0); }
        try { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; } catch (e0) { swallow(e0); }
        dbg('复用元素换源(new lesson)：解除旧 ended 锁，重新接管「' + shortSrc(v) + '」');
      }
    } catch (e) { swallow(e); }
    if (v[FLAGS.endedLock]) {   // 仍是同一已结束视频 → 持续维持锁，阻断重播
      try { v.pause = pauseNoop; } catch (e2) { swallow(e2); }
      v[FLAGS.forcePaused] = true;   // 原型级 no-op 也生效（即便实例 own 属性被重置）
      v.play = function () { return Promise.resolve(); };
      try { if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e2) { swallow(e2); }
      dbg('ended 锁持续维持，阻断重播');
      return true;
    }
    return false;
  }

  function _ovRebuild(v) {
    if (!(v.ended && !v[FLAGS.endedLock] && isRebuildFinished(v))) return false;
    if (CONFIG.LOOP_PLAY) {
      dbg('循环播放：允许已结束任务的重建 video 重播');  // 不锁死，交给 _ovEnforce 正常续播 + loop 属性实现重播
      return false;   // 不终止：交给 _ovEnforce 正常续播
    }
    try { v.pause = pauseNoop; v.play = function () { return Promise.resolve(); }; v.loop = false; cxState(v).rebuild = true; } catch (e) { swallow(e); }
    v[FLAGS.forcePaused] = true;
    dbg('跳过已结束任务的重建 video（防整元素重播）');
    return true;
  }

  function _ovEnforce(v) {
    try {
      // MediaSession 劫持提到最前面：所有状态都执行（含 ended），应对锁屏界面续播。
      try {
        if (navigator.mediaSession) {
          // 懒保存注入前原始 pause handler 与 playbackState（仅首次），供 cleanupListeners ④ 还原（审查高优先级#3）。
          if (!_mediaSessionSaved) {
            try { _origMediaSessionPause = (typeof navigator.mediaSession.getActionHandler === 'function') ? navigator.mediaSession.getActionHandler('pause') : null; } catch (e) { _origMediaSessionPause = null; }
            try { _origMediaSessionState = navigator.mediaSession.playbackState; } catch (e) { _origMediaSessionState = null; }
            _mediaSessionSaved = true;
          }
          navigator.mediaSession.setActionHandler('pause', function () {});
          navigator.mediaSession.playbackState = 'playing';   // 视频实则在播，状态标 playing 与"劫持 pause 为 no-op"语义一致，锁屏不误发暂停
        }
      } catch (msE) { swallow(msE); }

      if (!cxState(v).init) {
        v[FLAGS.np] = NATIVE_PAUSE;
        v[FLAGS.forcePaused] = true;
        v.loop = CONFIG.LOOP_PLAY;
        v.addEventListener('pause', function () {
          try { if (!v[FLAGS.anHold] && !BRIDGE.skipResume && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('ratechange', function () {
          try { if (!v[FLAGS.anHold] && !v[FLAGS.userPaused] && v.playbackRate <= 0.01) v.playbackRate = (CONFIG.USER_RATE || 1); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('canplay', function () {
          try { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused] && v.paused && v.readyState >= 2) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('waiting', function () {
          try { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('stalled', function () {
          try { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        cxState(v).init = true;
        try { Store.emit('video:state', { src: shortSrc(v), action: 'takeover' }); } catch (e) { swallow(e); }
        try { if (typeof _bxLog === 'function') _bxLog('ov:Takeover', 'init video ' + (shortSrc(v) || '?')); } catch (e) { swallow(e); }
      }
      v.pause = pauseNoop;
      v.loop = CONFIG.LOOP_PLAY;

      if (v.ended) {
        if (CONFIG.LOOP_PLAY) {
          try { v[FLAGS.endedLock] = false; } catch (e) { swallow(e); }
          try { v.loop = true; } catch (e) { swallow(e); }
          try { v.pause = pauseNoop; } catch (e) { swallow(e); }
          try { v.currentTime = 0; } catch (e) { swallow(e); }
          v[FLAGS.forcePaused] = true;
          if (v.paused) safePlay(v);
          dbg('循环播放：视频播完，从头重播');
          return true;   // 终止 enforce（即 overrideVideo 终止；下方正常续播不再执行）
        }
        v.play = function () { return Promise.resolve(); };  /* !!! 必须先封锁 play，再调原生 pause：否则 pause 事件监听器里的 safePlay 会调用尚未被替换的原生 play，导致已结束视频被打断→重播（swallow-all 循环） */
        try { if (v[FLAGS.np]) v[FLAGS.np](); } catch (e) { swallow(e); }
        try { v[FLAGS.endedLock] = true; } catch (e) { swallow(e); }
        try { cxState(v).endedSrc = (videoSrcOf(v) || ''); } catch (e) { swallow(e); }
        try { cxState(v).userKeep = false; } catch (e) { swallow(e); }
        try { _markEnded(videoSrcOf(v)); } catch (e) { swallow(e); }
        try { var _iss = videoIframeSrcsOf(v); for (var _i = 0; _i < _iss.length; _i++) _markEnded(_iss[_i]); } catch (e) { swallow(e); }
        _endedPrune();
        try { if (isFinite(v.duration)) v.currentTime = v.duration; } catch (e) { swallow(e); }
        if (!v.__seekArmed) {
          v.__seekArmed = true;
          v.addEventListener('seeking', function () {
            try { if (isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e) { swallow(e); }
          }, true);
        }
        dbg('ended：已锁定 currentTime 并覆盖 play 为 no-op，阻断重播');
        return true;   // 终止 enforce
      }

      if (v.paused && !v[FLAGS.anHold] && !cxState(v).released && !v[FLAGS.userPaused] && v.readyState >= 2) { safePlay(v); }
      if (v.playbackRate <= 0.01 && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused]) { v.playbackRate = (CONFIG.USER_RATE || 1); }
      else if (CONFIG.USER_RATE && CONFIG.USER_RATE !== 1 && v[FLAGS.forcePaused] && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused] && v.playbackRate > 0.01 && v.playbackRate !== CONFIG.USER_RATE) { v.playbackRate = CONFIG.USER_RATE; }
    } catch (e) { swallow(e); }
  }

  // 中和平台暴露的全局暂停封装（如 window.ananas.pause）。
  // 'use strict' 下若属性不可写/不可配置，直接赋值会抛 TypeError 被静默吞掉导致中和失效。
  // 故优先用 defineProperty 在实例上创建 own 属性遮蔽——无论 pause 是自有还是原型继承都能遮蔽（吸收评审#2/#D）；
  // 仅当 defineProperty 失败（自有属性 non-configurable）再回退普通赋值，仍失败则 dbg 暴露。
  function neutralizeGlobalPause(win) {
    try {
      var a = siteAnanas(win);
      if (a && typeof a.pause === 'function') {
        var done = false;
        try {
          if (!a.__cxAnanasNativePause) a.__cxAnanasNativePause = a.pause;   // 仅首次保存注入前真原生 pause（重复下钻同一 ananas 不覆盖）
          Object.defineProperty(a, 'pause', { value: function () {}, configurable: true, writable: true });
          done = true;
        } catch (de) {
          try { a.pause = function () {}; done = true; } catch (ae) { swallow(ae); }
        }
        if (done) {
          if (_ananasNeutralized.indexOf(a) === -1) _ananasNeutralized.push(a);   // 记入还原清单（跨 iframe 各 ananas 独立实例）
        } else {
          dbg('window.ananas.pause 无法中和(描述符受限)');
        }
      }
    } catch (e) { dbg('neutralizeGlobalPause 异常', e); }
  }



  // ===== MODULE: 视频枚举(walkVideos · 审查 JS1-3「scanVideos 三合一」) =====
  // 域：DOM监听与注入层 —— 视频枚举原语(walkVideos/scanVideos/allVideos)。
  // scanVideos(强制接管)、allVideos(收集/诊断/面板)、installPlayWatch(iframe 内 play 即时接管)
  // 原本各有独立遍历(Shadow DOM + 同源 iframe)，口径不一致曾导致「视频在播但诊断 0 / 手动暂停被接管」矛盾。
  // 现统一为单一递归原语 walkVideos：onVideo(v, hostSigs) 对每个视频调用；onDoc(doc, frame) 进入每个同源 iframe 文档时调用。
  // 扫描深度上限集中到 CONST（元配置集中层）
  function walkVideos(root, hostSigs, depth, onVideo, onDoc) {
    if (!root || !root.querySelectorAll) return;
    depth = depth || 0;
    if (depth > CONST.MAX_SCAN_DEPTH) return;
    try {
      var _vs = root.getElementsByTagName('video');
      for (var _vi = 0; _vi < _vs.length; _vi++) { try { if (onVideo) onVideo(_vs[_vi], hostSigs); } catch (e) { swallow(e); } }
    } catch (e) { swallow(e); }
    try {
      if (root.host) {
        var _sh = root.querySelectorAll('*');
        for (var _hi = 0; _hi < _sh.length; _hi++) {
          if (_sh[_hi].shadowRoot) { try { walkVideos(_sh[_hi].shadowRoot, hostSigs, depth + 1, onVideo, onDoc); } catch (e) { swallow(e); } }
        }
      } else {
        var _cts = root.querySelectorAll(SELECTORS.VIDEO_BOX + ', ' + siteTaskContainerSel());
        for (var _ci = 0; _ci < _cts.length; _ci++) {
          var _ct = _cts[_ci];
          if (_ct.shadowRoot) { try { walkVideos(_ct.shadowRoot, hostSigs, depth + 1, onVideo, onDoc); } catch (e) { swallow(e); } }
          var _all = _ct.getElementsByTagName('*');
          for (var _ai = 0; _ai < _all.length; _ai++) {
            if (_all[_ai].shadowRoot) { try { walkVideos(_all[_ai].shadowRoot, hostSigs, depth + 1, onVideo, onDoc); } catch (e) { swallow(e); } }
          }
        }
      }
    } catch (e) { swallow(e); }
    try {
      [].forEach.call(root.querySelectorAll('iframe'), function (f) {
        try {
          if (f.contentWindow && f.contentDocument) {
            var _hs = (hostSigs || []).concat(signatureOf(f));   // 宿主 iframe 签名下钻传入（修复复审#2）
            try { if (f.src) _hs.push(f.src); } catch (e2) { swallow(e2); }
            walkVideos(f.contentDocument, _hs, depth + 1, onVideo, onDoc);
            if (!cxState(f).pw) { cxState(f).pw = true; installPlayWatch(f.contentDocument); }   // 仅在首次下钻为 iframe 内视频装 play 即时接管（避免每轮重复挂载）
            try { neutralizeGlobalPause(f.contentWindow); } catch (e3) { swallow(e3); }
            try { if (onDoc) onDoc(f.contentDocument, f); } catch (e3) { swallow(e3); }
          }
          // 修时序：动态创建的播放器 iframe 可能尚未加载完，等 load 后再扫一次
          if (!cxState(f).loaded) {
            cxState(f).loaded = true;
            f.addEventListener('load', function () {
              try { if (f.contentWindow && f.contentDocument) { scanVideos(f.contentDocument, hostSigs, depth + 1); neutralizeGlobalPause(f.contentWindow); } } catch (e) { swallow(e); }
            }, true);
          }
        } catch (e) { swallow(e); }                   // 跨域 iframe 静默跳过（外部无法挂载）
      });
    } catch (e) { swallow(e); }
  }
  // 接管遍历：对每个视频施加强制续播（含宿主 iframe 签名下钻）
  function scanVideos(root) {
    if (!forcePlayEnabled()) return;   // opt-out：全局停用时不接管任何视频
    var fg = foregroundVideo();   // 每轮仅算一次前台，避免 O(n²)；非前台视频在 overrideVideo 内被门控释放
    walkVideos(root, null, 0, function (v, hs) {
      try { if (hs) cxState(v).hostSigs = hs; } catch (e) { swallow(e); }
      overrideVideo(v, fg);
    });
  }
  function allVideos() {
    // 诊断、状态、面板「暂停/恢复」按钮(currentVideo/activeVideo)均依赖本函数；与 scanVideos 统一口径，三者一致修复矛盾
    var out = [], seen = [];
    function dedup(v) { for (var i = 0; i < seen.length; i++) if (seen[i] === v) return false; seen.push(v); return true; }
    walkVideos(document, null, 0, function (v) { if (dedup(v)) out.push(v); });
    try { if (window.top && window.top !== window && window.top.document && window.top.document.body) walkVideos(window.top.document, null, 0, function (v) { if (dedup(v)) out.push(v); }); } catch (e) { swallow(e); }  // 并入顶层同源文档
    return out;
  }
  function activeVideo() {                       // 返回当前正在播放的视频（用于热键切换）
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (!vs[i].paused && !vs[i].ended) return vs[i]; } catch (e) { swallow(e); } }
    return null;
  }
  // 【内聚性收敛】userPause / userResume / autoStopTick / resumeTick 已迁至 biz/session.js（观看会话：用户意图与计时），
  //   toast 已迁至 ui/toast.js（纯 UI 渲染，经 Store.emit('ui:toast') 触发）。本模块只保留 DOM 接管引擎与视频枚举。
  function currentVideo() {                       // 当前目标视频：优先正在播放者；否则优先已用户暂停者；否则首个 video（供面板操作）
    var act = activeVideo(); if (act) return act;
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (vs[i][FLAGS.userPaused]) return vs[i]; } catch (e) { swallow(e); } }
    return vs[0] || null;
  }


  // ===== MODULE: DOM 变动驱动 + 自启动 =====
  // 域：DOM监听与注入层 —— DOM 变动驱动 + 自启动入口。
  // DOM 变动监听：覆盖动态插入的播放器 video。
  // 高频变动(弹幕/进度条批量更新)时，仅把新增 video 节点入队、合并到下一帧批量处理，避免主线程雪崩（吸收评审#2）。
  // 【易误判·诊断#九】对新增节点全子树 querySelectorAll('video') 看似浪费，但已合并到下一帧批量处理、且 video 仅现于视频容器内，
  //   实际开销极小；收窄选择器为低优可选优化，非缺陷，勿以"性能"为由过度重构。
  var _moQueue = [];
  var _moScheduled = false;
  function _moFlush() {
    _moScheduled = false;
    var q = _moQueue; _moQueue = [];
    var _fg = foregroundVideo();
    for (var i = 0; i < q.length; i++) { try { overrideVideo(q[i], _fg); } catch (e) { swallow(e); } }
  }
  // 内存埋点（切屏崩溃观测）：Chrome 专用 performance.memory。仅 DEBUG 时采样，关注 heap 与 _moQueue 长度（泄漏前兆）。
  // 注意：非 Chrome 无 performance.memory，s 显示 n/a；切屏前后各采一次可直接对比后台增长。
  var _memPoll = 0;
  function _memSample(tag) {
    try {
      var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
      var s = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a';
      dbg('[mem] ' + tag + ' heap=' + s + ' moQueue=' + _moQueue.length + ' ended=' + Object.keys(ENDED_SRCS).length);
    } catch (e) { swallow(e); }
  }
  var _mo = null;   // MutationObserver 实例（审查 JS1-2：页面卸载时断开，避免孤立回调滞留）
  try {
    _mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          try { if (n.tagName === 'VIDEO') _moQueue.push(n); } catch (e) { swallow(e); }
          try {
            var vs = n.querySelectorAll ? n.querySelectorAll('video') : [];
            for (var k = 0; k < vs.length; k++) _moQueue.push(vs[k]);
          } catch (e) { swallow(e); }
        }
      }
      if (_moQueue.length > CONST.MO_QUEUE_CAP) { try { _moFlush(); } catch (e) { swallow(e); } }   // 安全阀：极端高频/后台节流窗口兜底排空，防队列无限膨胀（专项#切屏崩溃）
      if (!_moScheduled && _moQueue.length) {
        _moScheduled = true;
        // 专项#切屏崩溃修复：后台标签页 rAF 被浏览器完全暂停、永不触发 flush，而页面在隐藏期仍高频 mutate
        // （心跳/进度刷新）→ _moQueue 无限增长并持引用阻止 GC，30min+ 后渲染进程 OOM 致整页崩溃。
        // 故隐藏时改用 setTimeout：后台仍会（节流）触发并排空队列；可见时保留 rAF 帧合并以省主线程。
        if (document.hidden) setTimeout(_moFlush, 200);
        else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_moFlush);
        else setTimeout(_moFlush, 16);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { swallow(e); }

  // 切回标签页时强制续播
  function visibilityHandler() {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (DEBUG) { try { _memSample('vis:' + document.visibilityState); } catch (e) { swallow(e); } }   // 切屏前后各采一次，直接对比后台增长
    if (document.visibilityState === 'visible') {
      try { scanVideos(document); } catch (e) { swallow(e); }
      try { neutralizeGlobalPause(window); } catch (e) { swallow(e); }   // 切回时一并中和 全局暂停封装，防平台在隐藏期重置（吸收评审#5）
    }
  }
  try {
    document.addEventListener('visibilitychange', visibilityHandler, true);   // 捕获阶段，但绝不 stopPropagation
  } catch (e) { swallow(e); }

  // 【内聚性收敛】卸载还原（_ananasNeutralized / _playWatchDocs / cleanupListeners / pagehide 钩子 / uninstall 导出）
  //   已迁至 dom/lifecycle.js —— 接管引擎负责「加 Hook」，lifecycle 负责「拆 Hook」，职责相反故分离。


