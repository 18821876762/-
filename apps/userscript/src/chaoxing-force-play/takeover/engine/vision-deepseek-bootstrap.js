// @requires: CONFIG, DS_STATUS, _dsLastReplyBefore, _dsLoop, _dsParseAnswer, bestEffort, detectSite, dsAvailable, safeGet
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：角色初始化、公共入口与停止清理；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 自初始化：按所在域名决定角色（DeepSeek 页承载 responder+广播；其余页监听状态）
  // 跨窗口幂等锁：超星播放器常在 iframe 内，顶层窗口与播放器 iframe 都会跑本脚本；若各自初始化 DS 角色，
  // 会重复注册监听/心跳 → 状态/提示出现两份。幂等性修复(审查 S-2)：锁真正挂到「同源顶层命名空间」——
  // 顶层可达且已初始化时全页只初始化一份；跨域 iframe 取不到顶层命名空间时回退本帧（保留同帧守卫），避免抛错。
  bestEffort(function () {
    var _dsLockNs = function () {
      return safeGet(function () {
        // 顶层命名空间已存在（顶层 bundle 已跑过）→ 锁挂顶层，跨帧共享；否则回退本帧（顶层未就绪/跨域不可达）
        if (window.top && window.top !== window && window.top.document && window.top.__CX_FORCE_PLAY) return window.top.__CX_FORCE_PLAY;
        return (window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {});
      }, {});
    };
    var _dsLockOwner = function () { return safeGet(function () { return !!_dsLockNs().dsRoleInited; }, false); };
    var _dsSetLock = function () { bestEffort(function () { _dsLockNs().dsRoleInited = true; }, 'ds.init.setLock'); };
    if (!_dsLockOwner()) {
      _dsSetLock();
      if (typeof location !== 'undefined' && location.host && (location.host === DEEPSEEK.host || location.host.endsWith('.' + DEEPSEEK.host))) {
        _dsBroadcastState();
        _dsInitResponder();
      } else {
        _dsInitCourseSide();
      }
    }
  }, 'ds.init');

  bestEffort(function () {
    // 沙箱独立性修复：保存注入前的全局值（含「不存在」）到命名空间，供 lifecycle.cleanupListeners ⑪ 还原——
    // 旧实现无条件覆盖 window.dsAvailable/_dsIsLoggedIn 且卸载后不清理（页面沙箱泄漏面）。
    window.__CX_FORCE_PLAY._origDsAvailable = (typeof window !== 'undefined') ? window.dsAvailable : undefined;
    window.__CX_FORCE_PLAY._origDsIsLoggedIn = (typeof window !== 'undefined') ? window._dsIsLoggedIn : undefined;
    window.dsAvailable = dsAvailable;
    window._dsIsLoggedIn = _dsIsLoggedIn;
    window.__CX_FORCE_PLAY.dsAvailable = dsAvailable;
    window.__CX_FORCE_PLAY._dsIsLoggedIn = _dsIsLoggedIn;
    window.__CX_FORCE_PLAY._dsRenderStatus = _dsRenderStatus;
    window.__CX_FORCE_PLAY.quizAskDeepSeek = quizAskDeepSeek;
    window.__CX_FORCE_PLAY.setQuizAskDeepSeekOverride = function (fn) { _quizAskDeepSeekOverride = fn; };   // TEST SEAM
    window.__CX_FORCE_PLAY.DS_STATUS = DS_STATUS;
    window.__CX_FORCE_PLAY.DEEPSEEK = DEEPSEEK;
    window.__CX_FORCE_PLAY._dsLatestReply = _dsLatestReply;
    window.__CX_FORCE_PLAY._dsLatestReplyTextOnly = _dsLatestReplyTextOnly;
    window.__CX_FORCE_PLAY.__setDsLastReplyBefore = function (t) { _dsLastReplyBefore = t; };
    if (typeof CONFIG !== 'undefined' && CONFIG.DS_ASK_RETRY_DELAY != null) DS_ASK_RETRY_DELAY = CONFIG.DS_ASK_RETRY_DELAY;
    if (typeof CONFIG !== 'undefined' && CONFIG.DS_ASK_MAX_RETRY != null) DS_ASK_MAX_RETRY = CONFIG.DS_ASK_MAX_RETRY;
    window.__CX_FORCE_PLAY.__setDsAskRetry = function (delay, max) { if (delay != null) DS_ASK_RETRY_DELAY = delay; if (max != null) DS_ASK_MAX_RETRY = max; };
    // v4.19.9：DeepSeek 页安装信号灯镜像监听（课程页灯快照 → 本页面板做题区）
    if (typeof detectSite === 'function' && detectSite() === 'deepseek') _dsInstallLightsMirror();
    window.__CX_FORCE_PLAY.__dsAskTryCount = function () { return _dsAskTryCount; };
    window.__CX_FORCE_PLAY.__resetDsAskTryCount = function () { _dsAskTryCount = 0; };
    window.__CX_FORCE_PLAY._dsParseAnswer = _dsParseAnswer;   // 测试钩子（sim-ds-parse 回归）
    // v4.19.36 诊断：应答端状态快照（处理中/队列/当前 req/通道）——「截屏题目不稳定」排查用
    window.__CX_FORCE_PLAY._dsResponderState = function () {
      return { busy: _dsResponding, queue: _dsAskQueue.length, currentReqId: _dsCurrentReqId, channel: _dsNeedChannel ? 'on' : 'off' };
    };
    // v4.19.37 诊断·数据循环：课程页侧收发/往返时延 + 应答端侧（本页自身或经心跳镜像 DS_STATUS.loop）
    // + 心跳新鲜度 + GM 键写入流量。闭环任意一侧粘贴诊断都能看到整条循环断在哪一环。
    window.__CX_FORCE_PLAY._dsLoopStats = function () {
      var _hb = (DS_STATUS && DS_STATUS.ts) ? Math.max(0, Date.now() - DS_STATUS.ts) : -1;
      var _rsp = (DS_STATUS && DS_STATUS.loop) ? DS_STATUS.loop : null;   // 应答端侧：本页(应答端自身)或心跳镜像(课程页)
      var _w = [];
      for (var _wk in _dsLoop.writes) { if (Object.prototype.hasOwnProperty.call(_dsLoop.writes, _wk)) _w.push(_wk + '=' + _dsLoop.writes[_wk]); }
      return {
        site: (typeof detectSite === 'function') ? detectSite() : '?',
        connected: !!(DS_STATUS && DS_STATUS.connected), loggedIn: (DS_STATUS && DS_STATUS.loggedIn != null) ? DS_STATUS.loggedIn : null, hidden: !!(DS_STATUS && DS_STATUS.hidden),
        heartbeatAgeMs: _hb, channel: _dsNeedChannel ? 'on' : 'off',
        asksSent: _dsLoop.asksSent, answersGot: _dsLoop.answersGot, retries: _dsLoop.retries,
        roundTrips: _dsLoop.roundTrips, roundTripMs: _dsLoop.roundTripMs,
        lastAskAt: _dsLoop.lastAskAt, lastAnswerAt: _dsLoop.lastAnswerAt, lastErr: _dsLoop.lastErr || '',
        writes: _w.join(' '),
        // 应答端侧快照（镜像或本页）
        rspReceived: _rsp ? _rsp.received : _dsLoop.received, rspSent: _rsp ? _rsp.sent : _dsLoop.sent,
        rspWatchdog: _rsp ? _rsp.watchdog : _dsLoop.watchdog, rspDedupe: _rsp ? _rsp.dedupe : _dsLoop.dedupe,
        rspQdrop: _rsp ? _rsp.qdrop : _dsLoop.qdrop,
        rspLastAskAt: _rsp ? (_rsp.lastAskAt || 0) : _dsLoop.lastAskAt,
        rspLastAnswerAt: _rsp ? (_rsp.lastAnswerAt || 0) : _dsLoop.lastAnswerAt,
        rspLastErr: _rsp ? (_rsp.lastErr || '') : _dsLoop.lastErr
      };
    };
    window.__CX_FORCE_PLAY._dsReadConfidence = _dsReadConfidence;   // v4.19.32·置信度抽取（sim-ds-parse/作答分级用）
    window.__CX_FORCE_PLAY._dsConfToNum = _dsConfToNum;
    window.__CX_FORCE_PLAY.__emitDsChannel = function (m) { _emitChannel(m || {}); };
    window.__CX_FORCE_PLAY.__dsEnsureChannel = _dsEnsureChannel;   // 修复·子帧按需建通道（quiz.js 答题门控调用）
    window.__CX_FORCE_PLAY.__lastDsAskReqId = function () { return _lastDsAskReqId; };
    window.__CX_FORCE_PLAY._dsEvictAll = _dsEvictAll;   // v4.19.50：应答端完全出清（视频播放通知/命令/诊断可调）
    // P1：DS 两定时器已登记 TimerRegistry(owner 'deepseek')，uninstall 时由 TimerRegistry.clearAll() 统一兜底；
    // 此处保留显式停止钩子(审查 §2.1)，改调 clearAll('deepseek') 幂等清理本 owner 下所有定时器。
    window.__CX_FORCE_PLAY.quizVisionDeepSeekStop = function () {
      bestEffort(function () {
        if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.clearAll === 'function') window.__CX_FORCE_PLAY.TimerRegistry.clearAll('deepseek');
        // 幂等性修复(审查 G-1)：卸载 GM 值变更监听——GM 监听是脚本级长驻资源，不移除则热禁用/手动 uninstall 后
        // 仍持续响应其他标签页的通道变更（_emitChannel 已有卸载守卫，但监听与闭包本身应一并释放）。
        if (_dsGmListenerId != null && typeof GM_removeValueChangeListener === 'function') {
          try { GM_removeValueChangeListener(_dsGmListenerId); } catch (e) {}
          _dsGmListenerId = null;
        }
        // v4.19.28：答题请求键监听一并移除（独立键，避免卸载后残留跨标签页监听）
        if (_dsGmAskListenerId != null && typeof GM_removeValueChangeListener === 'function') {
          try { GM_removeValueChangeListener(_dsGmAskListenerId); } catch (e) {}
          _dsGmAskListenerId = null;
        }
        // v4.19.9：信号灯镜像监听一并移除 + 清空远程灯槽（卸载后应答端面板不再展示课程页灯）
        if (_dsLightsGmListenerId != null && typeof GM_removeValueChangeListener === 'function') {
          try { GM_removeValueChangeListener(_dsLightsGmListenerId); } catch (e) {}
          _dsLightsGmListenerId = null;
        }
        // v4.19.50：视频播放出清 GM 监听一并移除
        if (_dsEvictGmId != null && typeof GM_removeValueChangeListener === 'function') {
          try { GM_removeValueChangeListener(_dsEvictGmId); } catch (e) {}
          _dsEvictGmId = null;
        }
        if (window.__CX_FORCE_PLAY) { window.__CX_FORCE_PLAY.quizLightsRemote = null; window.__CX_FORCE_PLAY.quizLightsRemoteTs = 0; }
        // 线程审计：关闭 BroadcastChannel——旧实现只清定时器/GM 监听，通道对象本身不 close（手动 uninstall 后
        // 资源残留）；BroadcastChannel.close() 释放底层端口（onmessage 已由 _emitChannel 卸载守卫拦截，双保险）。
        if (_bc && typeof _bc.close === 'function') { try { _bc.close(); } catch (e) {} _bc = null; }
        _dsCourseTimer = null; _dsBroadcastTimer = null;
        // v4.19.34：应答端看门狗/在途状态一并清理——卸载后不再有定时器续接队列，重启（重新注入）时状态干净
        if (_dsWatchdogTimer) { try { clearTimeout(_dsWatchdogTimer); } catch (e) {} _dsWatchdogTimer = null; }
        _dsResponding = false;
        _dsAskQueue.length = 0;
        _dsCurrentReqId = '';
      }, 'ds.stop');
    };
  }, 'ds.exports');
