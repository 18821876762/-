// @provides: releaseVideo, safePlay
// @requires: CONFIG, CoreState, FLAGS, NATIVE_PAUSE, bestEffort, cxState, markDomDirty, safeGet, videoSrcOf
  // ===== DOMAIN: takeover/engine/playback (playback primitives / takeover helpers) =====
  // 覆盖后的 pause：平台任何暂停指令都被忽略（no-op）
  var pauseNoop = function () { if (!CoreState.canRun()) return NATIVE_PAUSE.apply(this, arguments); };

  // 安全 play：兼容浏览器自动播放策略拒绝（先静音再播，Edge 友好）
  // 安全 play：兼容浏览器自动播放策略拒绝。按原始 muted 状态尝试；被拒则静音重试一次，成功后恢复用户预期音量。
  function safePlay(v) {
    if (!v || !CoreState.canRun() || v[FLAGS.userPaused] || v[FLAGS.anHold] || v[FLAGS.endedLock] || cxState(v).released) return;
    bestEffort(function () {
      var state = cxState(v), src = videoSrcOf(v);
      if (state.playRequest) {
        if (state.playRequest.src === src) return;
        state.playRequest.cancel();
      }
      var token = CoreState.capture('playback'), wasMuted = v.muted, changedMute = false, finished = false;
      var timer = null, unsubscribe = null, registry = window.__CX_FORCE_PLAY.TimerRegistry;
      var request = { src: src, cancel: finish }; state.playRequest = request;
      function allowed() {
        return !finished && state.playRequest === request && CoreState.valid(token) && videoSrcOf(v) === src && v.isConnected !== false &&
          !v[FLAGS.userPaused] && !v[FLAGS.anHold] && !v[FLAGS.endedLock] && !state.released;
      }
      function restore() {
        if (changedMute && v.muted === true) { v.muted = wasMuted; changedMute = false; }
      }
      function finish() {
        if (finished) return; finished = true;
        bestEffort(restore, 'sp.restore');
        v.removeEventListener('playing', played);
        v.__cxPlayingArmed = false;
        if (timer !== null) registry.clearTimeout(timer);
        if (unsubscribe) unsubscribe();
        if (state.playRequest === request) state.playRequest = null;
      }
      function played() { if (allowed()) _safePlaySuccesses++; finish(); }
      function failed(retry) {
        if (!allowed() || !retry) { finish(); return; }
        v.muted = true; changedMute = true;
        attempt(false);
      }
      function attempt(retry) {
        if (!allowed()) { finish(); return; }
        _safePlayAttempts++;
        _bxLog('safePlay', 'src=' + (src || '?').slice(-40) + ' muted=' + v.muted);
        try {
          var promise = v.play();
          if (promise && typeof promise.then === 'function') promise.then(function () { if (allowed()) played(); else finish(); }, function () { failed(retry); });
          else if (!v.paused) played();
        } catch (e) { failed(retry); }
      }
      v.__cxPlayingArmed = true; v.addEventListener('playing', played);
      unsubscribe = CoreState.onCancel('playback', finish);
      timer = registry.setTimeout(finish, 10000, 'playback');
      attempt(true);
    }, 'safePlay');
  }
  // F-B1 修复：定向模式下被"跳过"的视频，若此前已在全量续播阶段被本脚本接管
  // （siteAttachments() / 桥 objectids 晚于首扫到达），必须撤销接管交还平台；否则广告/插播视频会
  // 残留 v.pause=pauseNoop、__cxForcePaused=true，被永久强制续播且用户无法暂停，与"定向跳过"目标直接相悖。
  // 仅撤销"续播接管"，保留 __cxEndedLock / 重建去重（已结束任务不应被释放重播）。
  function releaseVideo(v) {
    if (v && cxState(v).playRequest) cxState(v).playRequest.cancel();
    if (!v || (!v[FLAGS.forcePaused] && !cxState(v).released)) return;   // 未接管或已释放则跳过（幂等）
    bestEffort(function () { v.pause = v[FLAGS.np] || NATIVE_PAUSE; }, 'rel.pause');  // 恢复实例级原生 pause（绕过原型 no-op），用户/平台可正常暂停
    v[FLAGS.forcePaused] = false;                                // 关闭原型 pause 的 no-op 拦截
    cxState(v).released = true;                                       // 标记已释放：续播兜底监听(pause/canplay/waiting/stalled)不再自动续播
    // 状态机优化(加载感知)：释放状态变化 → 触发下一 tick 全量扫描——若该视频随后重新归属任务点（桥/定向
    // 状态变化），可被重新接管；显式置脏抵消「播放稳态扫描降频」的重接管延迟（上限回到主循环节奏 ≤2s）。
    if (typeof markDomDirty === 'function') markDomDirty();
    // 保留 v.__cx=true：避免重复挂载监听；若后续重新归属任务点，由 overrideVideo 再断言路径重新接管（见下）
  }

  // 覆盖单个视频：pause 变 no-op + ended→重播阻断 + ratechange 仅 rate<=0.01 拉回 1x + 状态兜底续播。
  // 关键：所有续播路径都检查 v.__cxAN_hold —— 当 auto-next 因插播题锁定时，无条件避让。
  // 【易误判·诊断#四】本函数刻意不分拆：强顺序状态机，共享 safePlay / v.__np / __cxEndedLock 等闭包状态，
  //   拆子函数需提升大量状态→回归风险高（v3.10 #10/#11 已判不拆）。可读性换正确性不划算，勿以"函数过长"为由拆分。
  // 进度到底判定：距结尾 END_RELEASE_SEC 内（且未真正 ended）即视为"进度到底"。
  // ended 状态不在此处理——交给下方 ended 锁分支防重播，避免在到底处提前释放破坏防重播。
  function nearEnd(v) {
    return safeGet(function () {
      if (v.ended) return false;
      if (isFinite(v.duration) && v.duration > CONFIG.END_RELEASE_SEC && v.currentTime >= v.duration - CONFIG.END_RELEASE_SEC) return true;
      return false;
    }, false);
  }
