// @requires: FLAGS, NATIVE_PAUSE, bestEffort, swallow
// @source-group: plugins/addons/auto-next.js
// 自动下一课闭包末段：视频结束事件、播中题目保持和初始化/清理。
// 必须紧接 auto-next-navigation.js；本段关闭 auto-next.js 打开的 IIFE。
  // ---- 核心：视频结束处理 ----
  function continueNavigation(job) {
    if (!jobValid(job)) return;
    if (_isQuizActive()) { later(function () { continueNavigation(job); }, HOLD_POLL_MS); return; }
    probeQuizEntry().then(function (quiz) {
      if (!jobValid(job)) return;
      if (quiz) { doNavigate({ el: quiz.el, url: quiz.url, label: '章节测验' }, job, true); return; }
      return resolveNext($nav.cid(), job).then(function (next) {
        if (jobValid(job)) doNavigate(next, job, false);
      });
    }).catch(function (e) {
      if (!jobValid(job)) return;
      swallow(e); failNavigation(job, '查找下一节出错，可稍后重试');
    });
  }
  function onVideoEnded(v) {
    if (!canRun() || state === NAVIGATING) return;
    if (blockedByVerify()) { setState(LOCKED); toast('检测到验证/解锁页，已停止自动跳课'); return; }
    if (state === LOCKED) setState(IDLE);
    var key = videoIdentity(v);
    if (succeeded(v, key)) return;
    var job = context(); job.video = v; job.key = key;
    activeJob = job; setState(NAVIGATING);
    continueNavigation(job);
  }
  function probeIfEnabled() {
    if (isTopFrame() && bridgeConfigured()) {
      $bridge.probe(context()).then(function (base) { if (canRun()) $log.info('bridge connected: ' + base); }).catch(function () {});
    }
  }
  function onToggleChanged(on) {
    invalidate(on ? 'auto-next enabled/config changed' : 'auto-next disabled');
    $bridge.reset();
    if (on) { startHoldTimer(); probeIfEnabled(); }
  }

  // ---- 面板注册（工具库项）----
  function panelRegister() {
    var addon = {
      id: 'auto-next',
      type: 'toggle',
      label: '章节读完自动下一课',
      note: '视频播完跳下一节/题目（超星专属；移除旧版 force-paused 误判）；播中随堂题自动暂停等待作答(插播题锁定)',
      get: $storage.isOn,
      set: function (v) { $storage.setOn(v); onToggleChanged(v); },
    };
    bestEffort(function () {
      if (!Array.isArray(window.__cxAddonQueue)) window.__cxAddonQueue = [];
      window.__cxAddonQueue.push(addon);
      if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
    }, 'an.panelRegister');
  }

  // ---- 播中随堂题保持：等待作答、提交确认、人工复核、AI 在途全部结算 ----
  var _holdVid = null, holdTimer = null, holdRegistry = null;
  var HOLD_POLL_MS = 1500;
  function startHoldTimer() {
    if (!bootstrapped || holdTimer !== null || !canRun()) return;
    var TR = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry;
    holdRegistry = TR && typeof TR.setInterval === 'function' ? TR : null;
    holdTimer = holdRegistry ? holdRegistry.setInterval(_anHoldTick, HOLD_POLL_MS, 'auto-next-hold') : setInterval(_anHoldTick, HOLD_POLL_MS);
  }
  function stopHoldTimer() {
    if (holdTimer === null) return;
    if (holdRegistry && typeof holdRegistry.clearInterval === 'function') holdRegistry.clearInterval(holdTimer);
    else clearInterval(holdTimer);
    holdTimer = null; holdRegistry = null;
  }
  function _isQuizActive() {
    var qs = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizStats;
    if (!qs) return false;
    return ['remaining', 'unsettled', 'pendingSubmit', 'reviewCount', 'pendingAI'].some(function (key) {
      return typeof qs[key] === 'number' && qs[key] > 0;
    });
  }
  function _findPlayingTaskVideo() {
    var vs = document.getElementsByTagName('video');
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (!v[FLAGS.forcePaused] || v.ended || v.paused || v.readyState < 2) continue;
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.5) continue;
      return v;
    }
    return null;
  }
  function _anHoldTick() {
    if (!canRun()) { stopHoldTimer(); releaseHold(false); return; }
    if (_holdVid) {
      if (_holdVid.ended || !_isQuizActive()) releaseHold(true);
      return;
    }
    if (!_isQuizActive()) return;
    var tv = _findPlayingTaskVideo(); if (!tv) return;
    tv[FLAGS.anHold] = true;
    _holdVid = tv;
    bestEffort(function () { (NATIVE_PAUSE || tv.pause).call(tv); }, 'an.hold.pause');
  }

  // 清理在延迟 bootstrap 之前就登记，卸载不能留下尚未启动的回调。
  var endedHandler = null, bootstrapped = false;
  window.__cxAddonCleanups = window.__cxAddonCleanups || [];
  window.__cxAddonCleanups.push(function () {
    disposed = true;
    invalidate('auto-next uninstall');
    if (cancelUnsubscribe) { cancelUnsubscribe(); cancelUnsubscribe = null; }
    if (changeUnsubscribe) { changeUnsubscribe(); changeUnsubscribe = null; }
    if (endedHandler) document.removeEventListener('ended', endedHandler, true);
    if (_storageHandler) window.removeEventListener('storage', _storageHandler);
    window.__cxAutoNextStarted = false;
  });
  function bootstrap() {
    if (disposed || bootstrapped || !window.__CX_FORCE_PLAY) return;
    bootstrapped = true;
    panelRegister();
    startHoldTimer();
    endedHandler = function (e) { var v = e.target; if (v && v.tagName === 'VIDEO') onVideoEnded(v); };
    document.addEventListener('ended', endedHandler, true);
    $storage.listen(function () { onToggleChanged($storage.isOn()); });
    probeIfEnabled();
  }
  var cs = coreState();
  if (cs && cs.onCancel) cancelUnsubscribe = cs.onCancel('navigation', function () { cancelWork('core state cancelled'); $bridge.reset(); });
  if (cs && cs.onChange) changeUnsubscribe = cs.onChange(function (view) {
    if (view.state === 'RUNNING') {
      if (!bootstrapped) bootstrap();
      else { startHoldTimer(); probeIfEnabled(); }
    }
  });
  later(bootstrap, 300);
})();
