// @requires: BRIDGE, CONFIG, CONST, CX_KEYS, ENDED_SRCS, FLAGS, SCRIPT_VERSION, STYLES, TARGET, _cxPanel, _cxPanelOwnerClaim, _targetMissStreak, allVideos, bestEffort, currentVideo, cxIcon, cxState, escapeHTML, safeGet
// @source-group: presentation/dashboard.js
  // ===== DOMAIN: presentation/dashboard (state refresh + badge + dashboard + video list) =====
  var _MO_WARN_LEN = 10;
  var _RATE_GOOD = 80;
  var _RATE_FAIR = 50;
  // v4.19.39：MO 活动跨帧聚合（面板在顶层帧，iframe 内视频的 MO 活动经各帧 _moStats 聚合）。
  // 面板显示「累计批次/入队/排空」而非瞬时队列——瞬态队列采样恒 0（排空即接管），
  // 且静态渲染的视频不触发 MO 入队（入队恒 0 属正常）；v4.19.40 起以「批次」为活跃主指标。
  var _lastMoBatches = 0;   // 上次采样累计批次（Sparkline 取增量=每周期回调批次速率）
  function _dashMoAgg() {
    var agg = { queue: 0, pushes: 0, flushes: 0, batches: 0, lastPushMs: -1, lastFlushMs: -1, lastBatchMs: -1, mounted: false };
    bestEffort(function () {
      var fr = [window];
      try { if (window.frames) { for (var i = 0; i < window.frames.length; i++) { fr.push(window.frames[i]); } } } catch (e) {}
      for (var j = 0; j < fr.length; j++) {
        try {
          var fp = fr[j].__CX_FORCE_PLAY;
          if (fp && typeof fp._moStats === 'function') {
            var s = fp._moStats();
            if (!s) continue;
            agg.queue += s.queue || 0;
            agg.pushes += s.pushes || 0;
            agg.flushes += s.flushes || 0;
            agg.batches += s.batches || 0;
            agg.mounted = agg.mounted || !!s.mounted;
            if (s.lastPushMs >= 0 && (agg.lastPushMs < 0 || s.lastPushMs < agg.lastPushMs)) agg.lastPushMs = s.lastPushMs;
            if (s.lastFlushMs >= 0 && (agg.lastFlushMs < 0 || s.lastFlushMs < agg.lastFlushMs)) agg.lastFlushMs = s.lastFlushMs;
            if (s.lastBatchMs >= 0 && (agg.lastBatchMs < 0 || s.lastBatchMs < agg.lastBatchMs)) agg.lastBatchMs = s.lastBatchMs;
          }
        } catch (e) {}
      }
    }, 'dash.moAgg');
    return agg;
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h > 0 && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h > 0 ? h + ':' + mm : m) + ':' + ss;
  }
  function _hexA(hex, a) {
    try {
      var h = String(hex).replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    } catch (e) { return 'rgba(34,197,94,' + a + ')'; }
  }
  // 性能修复(面板卡顿)：hero 区内容指纹（秒级内容未变时跳过 DOM 写）
  var _heroFp = null;
  function refreshPanelState() {
    if (!_cxPanel) return;
    if (!_cxPanelOwnerClaim()) return;   // R4+R5：仅 owner 帧重绘；owner 缺失则本帧抢占，避免多 iframe 抢绘与配置反向覆盖
    refreshPanelLabels();
    updateBadge();
    renderDashboard();
    renderQuizLights();   // 需求·信号灯：面板刷新时同步一次（初始渲染 + 状态事件之外的兜底）
    bestEffort(function () {
      var st = _cxPanel.querySelector('#__cxPanelState');
      var v = activeVideo();
      var heroCard = _cxPanel.querySelector('#__cxHeroCard');
      var heroStatus = _cxPanel.querySelector('#__cxHeroStatus');
      var heroSrc = _cxPanel.querySelector('#__cxHeroSrc');
      var heroTime = _cxPanel.querySelector('#__cxHeroTime');
      var heroProgress = _cxPanel.querySelector('#__cxHeroProgress');
      var heroPlayBtn = _cxPanel.querySelector('#__cxBtnPause');
      var footerText = _cxPanel.querySelector('#__cxFooterText');

      if (!v) {
        v = currentVideo();
        if (st) { if (!v) st.textContent = '当前无视频'; else st.textContent = '视频已暂停(用户) · 按按钮恢复'; }
        // Hero idle state
        if (heroCard) { heroCard.classList.remove('paused'); heroCard.classList.add('idle'); }
        if (heroStatus) heroStatus.innerHTML = '<span style="color:var(--cx-idle)">' + cxIcon('dot', 8) + '</span> 空闲';
        if (heroSrc) heroSrc.textContent = '等待视频…';
        if (heroTime) heroTime.innerHTML = '0:00<small> / 0:00</small>';
        if (heroProgress) heroProgress.style.width = '0%';
        if (heroPlayBtn) heroPlayBtn.innerHTML = cxIcon('play', 20);
        if (footerText) footerText.textContent = '等待视频…';
      } else {
        var src = (v.currentSrc || v.src || '').split('/').pop() || '(未知)';
        var isUserPaused = !!v[FLAGS.userPaused];
        var isPlaying = !v.paused && !v.ended && !v[FLAGS.anHold];
        var status = v[FLAGS.anHold] ? '插播题锁定' : (isUserPaused ? '已暂停(用户)' : (v.paused ? '暂停' : '播放中'));
        var watchMin = ((cxState(v).watchMs || 0) / 60000).toFixed(1);
        var autoRemain = CONFIG.AUTO_STOP_MIN > 0 ? Math.max(0, CONFIG.AUTO_STOP_MIN - (cxState(v).watchMs || 0) / 60000).toFixed(1) : '关闭';
        var resumeRemain = (isUserPaused && cxState(v).resumeAt) ? Math.max(0, (cxState(v).resumeAt - Date.now()) / 60000).toFixed(1) : '—';
        var prog = fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? ' / ' + fmtTime(v.duration) : '');
        var tCur = fmtTime(v.currentTime);
        var tDur = (isFinite(v.duration) && v.duration > 0) ? fmtTime(v.duration) : '--:--';
        var pct = (isFinite(v.duration) && v.duration > 0) ? Math.min(100, (v.currentTime / v.duration) * 100) : 0;
        // 性能修复(面板卡顿)：hero 区内容指纹——播放中 currentTime 每秒都在变，但 textContent/innerHTML 内容
        // 在秒级内相同（fmtTime 秒粒度）；未变时跳过全部 DOM 写（每 2s 刷新触发布局的主要来源）。
        var _fp = [src, status, prog, watchMin, autoRemain, resumeRemain, tCur, tDur, pct.toFixed(1), isUserPaused, !!v[FLAGS.anHold], (BRIDGE && BRIDGE.base) ? 1 : 0, allVideos().length].join('|');
        if (_fp !== _heroFp) {
          _heroFp = _fp;
          if (st) st.textContent = '视频: ' + src + '\n状态: ' + status + ' · 进度 ' + prog + '\n已看 ' + watchMin + 'min · 自动停剩 ' + autoRemain + 'min · 恢复剩 ' + resumeRemain + 'min';
          if (heroCard) {
            heroCard.classList.remove('idle');
            heroCard.classList.toggle('paused', isUserPaused || !isPlaying);
          }
          if (heroStatus) {
            if (v[FLAGS.anHold]) heroStatus.innerHTML = cxIcon('pause', 12) + ' 插播题锁定';
            else if (isUserPaused) heroStatus.innerHTML = cxIcon('pause', 12) + ' 已暂停';
            else if (v.paused) heroStatus.innerHTML = cxIcon('pause', 12) + ' 暂停中';
            else heroStatus.innerHTML = '<span style="color:var(--cx-success)">' + cxIcon('dot', 8) + '</span> 播放中';
          }
          if (heroSrc) heroSrc.textContent = src.length > 24 ? src.slice(0, 22) + '…' : src;
          if (heroTime) heroTime.innerHTML = tCur + '<small> / ' + tDur + '</small>';
          if (heroProgress) heroProgress.style.width = pct.toFixed(1) + '%';
          if (heroPlayBtn) heroPlayBtn.innerHTML = isUserPaused ? cxIcon('play', 20) : cxIcon('pause', 20);
          if (footerText) {
            var bridge = (BRIDGE && BRIDGE.base) ? '桥已连' : 'DOM兜底';
            footerText.textContent = bridge + ' · ' + allVideos().length + '个视频';
          }
        }
      }
    }, 'dash.hero');
    bestEffort(function () {
      var info = _cxPanel.querySelector('#__cxPanelInfo');
      if (info) {
        var vs = allVideos();
        var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
        var heap = m ? ((m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB') : 'n/a';
        var bridge = (BRIDGE && BRIDGE.base) ? ('已连 ' + escapeHTML(BRIDGE.base) + (BRIDGE.version ? ' v' + BRIDGE.version : '')) : '离线';
        // v4.19.39/40：MO 队列显示升级——瞬态队列恒 0（排空即接管/静态视频不触发入队），
        // 以「回调批次」为活跃主指标（批次持续增长=MO 在工作），入队/排空为捕获新视频证据
        var _moa = _dashMoAgg();
        var diagLines = [
          'v' + SCRIPT_VERSION + ' · 视频 ' + vs.length + ' · MO批次 ' + _moa.batches + (_moa.lastBatchMs >= 0 ? (' · 最近' + Math.round(_moa.lastBatchMs / 1000) + 's前') : ' · 尚无回调') + ' · 入队' + _moa.pushes + '/排空' + _moa.flushes + ' · ended ' + Object.keys(ENDED_SRCS).length,
          'heap ' + heap,
          '桥 ' + bridge + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter),
          '定向 enabled=' + (TARGET && TARGET.enabled) + ' 命中=' + (TARGET && TARGET.matchedAny) + ' 0命中 ' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS,
          '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms · 热键 P'
        ].join('\n');
        while (info.firstChild) info.removeChild(info.firstChild);
        if (!(BRIDGE && BRIDGE.base)) {
          info.appendChild(h('div', { style: 'color:var(--cx-warning);margin-bottom:4px;' }, '桥离线 · DOM 兜底中'));
        }
        info.appendChild(document.createTextNode(diagLines));
      }
    }, 'dash.info');
    renderVideoList();
    _refreshQuizZone();
  }
  function _refreshQuizZone() {
    bestEffort(function () {
      var p = _cxPanel; if (!p) return;
      var total = p.querySelector('#__cxQuizTotal'), done = p.querySelector('#__cxQuizDone'),
          remain = p.querySelector('#__cxQuizRemain'), src = p.querySelector('#__cxQuizSrc'),
          conf = p.querySelector('#__cxQuizConf'), row = p.querySelector('#__cxQuizStatRow');
      if (!total || !done || !remain || !src) return;
      var pc = p.querySelector('#__cxPopupCount');
      if (pc) {
        var pst = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.popupQuizStats) ? window.__CX_FORCE_PLAY.popupQuizStats : null;
        pc.textContent = (pst && typeof pst.popups === 'number') ? ('' + pst.popups) : '0';
      }
      var st = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizStats) ? window.__CX_FORCE_PLAY.quizStats : null;
      var on = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO) : null; }, null) !== '0';
      // 答题进度条 + 信号灯（与视频 Hero 进度条同源视觉）：题目总数/已完成 + 状态灯
      var _qLed = p.querySelector('#__cxQuizLed'), _qBar = p.querySelector('#__cxQuizProgressBar'),
          _qPct = p.querySelector('#__cxQuizPct'), _qNum = p.querySelector('#__cxQuizNum'),
          _qStat = p.querySelector('#__cxQuizStatusText');
      if (_qBar) {
        var _sc = (st && typeof st.scanned === 'number') ? st.scanned : 0,
            _an = (st && typeof st.answered === 'number') ? st.answered : 0,
            _rem = (st && typeof st.remaining === 'number') ? st.remaining : 0,
            _pend = (st && typeof st.pendingSubmit === 'number') ? st.pendingSubmit : 0,
            _rc = (st && typeof st.reviewCount === 'number') ? st.reviewCount : 0;
        var _pct = _sc > 0 ? Math.min(100, Math.round(_an / _sc * 100)) : 0;
        _qBar.style.width = _pct + '%';
        if (_qPct) _qPct.textContent = _pct + '%';
        if (_qNum) _qNum.textContent = '已作答 ' + _an + ' / 总数 ' + _sc;
        if (_qLed && _qStat) {
          var _cls = 'idle', _txt = '未开启自动答题', _title = '未运行';
          if (!on) { _cls = 'paused'; _txt = '自动答题已暂停'; _title = '暂停'; }
          else if (!st || _sc === 0) { _cls = 'idle'; _txt = '等待扫描题目…'; _title = '未运行'; }
          else if (_rem === 0) { _cls = 'done'; _txt = '全部作答完成'; _title = '完成'; }
          else if (_pend > 0) { _cls = 'warn'; _txt = '待确认提交 ' + _pend + ' 题'; _title = '待确认'; }
          else if (_rc > 0) { _cls = 'warn'; _txt = '待人工复核 ' + _rc + ' 题'; _title = '复核'; }
          else { _cls = 'running'; _txt = '作答进行中…'; _title = '运行'; }
          _qLed.className = 'cx-quiz-led ' + _cls; _qLed.title = _title;
          _qStat.textContent = _txt;
        }
      }
      if (!st || !st.scanned && st.scanned !== 0) {
        total.textContent = done.textContent = remain.textContent = '—';
        var _s = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_SOURCE) : null; }, null);
        var _off0 = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_OFFLINE) : null; return v === null ? true : v !== '0'; }, true);
        src.textContent = ((_s === 'bank' || _s === 'ai') ? _s : 'random') + (_off0 ? ' ·离线' : '');
        if (conf) conf.textContent = '—';
        var _ps0 = p.querySelector('#__cxQuizPendingStat'); if (_ps0) _ps0.textContent = '0';
        var _sa0 = p.querySelector('#__cxBtnQuizSubmitAll'); if (_sa0) _sa0.style.display = 'none';
        var _rw0 = p.querySelector('#__cxQuizReviewWrap'); if (_rw0) _rw0.style.display = 'none';
        if (row) row.style.opacity = on ? '1' : '.45';
        return;
      }
      total.textContent = (typeof st.scanned === 'number') ? st.scanned : '—';
      done.textContent = (typeof st.answered === 'number') ? st.answered : '—';
      remain.textContent = (typeof st.remaining === 'number') ? st.remaining : '—';
      var _ss = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_SOURCE) : null; }, null);
      var _srcText = (st.answerSource) ? st.answerSource : ((_ss === 'bank' || _ss === 'ai') ? _ss : 'random');
      var _off = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_OFFLINE) : null; return v === null ? true : v !== '0'; }, true);
      if (_off) _srcText += ' ·离线';
      var _lv = (st && st.levels) ? String(st.levels) : '';
      if (_lv.indexOf('review') >= 0) _srcText += ' ·复核';
      else if (_lv.indexOf('confirm') >= 0) _srcText += ' ·待确认';
      src.textContent = _srcText;
      if (conf) conf.textContent = (typeof st.confidence === 'number') ? (Math.round(st.confidence * 100) + '%') : '—';
      _pend = (st && typeof st.pendingSubmit === 'number') ? st.pendingSubmit : 0;
      var _pendEl = p.querySelector('#__cxQuizPending'); if (_pendEl) _pendEl.textContent = _pend;
      var _pendStat = p.querySelector('#__cxQuizPendingStat'); if (_pendStat) _pendStat.textContent = _pend;
      var _submitAll = p.querySelector('#__cxBtnQuizSubmitAll');
      if (_submitAll) {
        var _as = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO_SUBMIT) : null; return v === null ? true : v !== '0'; }, true);
        _submitAll.style.display = (!_as || _pend > 0) ? 'block' : 'none';
      }
      _rc = (st && typeof st.reviewCount === 'number') ? st.reviewCount : 0;
      var _rw = p.querySelector('#__cxQuizReviewWrap'); if (_rw) _rw.style.display = (_rc > 0) ? 'block' : 'none';
      var _rcEl = p.querySelector('#__cxQuizReviewCount'); if (_rcEl) _rcEl.textContent = _rc;
      if (row) row.style.opacity = on ? '1' : '.45';
    }, 'dash.quizZone');
  }
  function updateBadge() {
    bestEffort(function () {
      var b = _cxPanel.querySelector('#__cxPanelBadge');
      if (!b) return;
      var vs = allVideos();
      var color = STYLES.T.idle, title = '未运行 / 初始化中', cls = 'idle';
      if (BRIDGE && BRIDGE.base) {
        color = STYLES.T.primary2; title = '桥已连接 (' + BRIDGE.base + ')';
      }
      var hasEndLock = false, hasUserPause = false, hasForcePause = false, hasPlaying = false, hasReleased = false;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (v[FLAGS.endedLock]) hasEndLock = true;
        if (v[FLAGS.userPaused]) hasUserPause = true;
        if (v[FLAGS.forcePaused]) hasForcePause = true;
        if (!v.paused && !v.ended) hasPlaying = true;
        if (v.ended && !v[FLAGS.endedLock]) hasReleased = true;
      }
      if (BRIDGE && BRIDGE.skipResume && !hasForcePause && !hasPlaying) {
        color = STYLES.T.warning; title = '桥避让：章节已完成，脚本休眠'; cls = 'paused';
      } else if (hasEndLock) {
        color = STYLES.T.danger; title = '已锁死：防重播'; cls = 'idle';
      } else if (hasUserPause && !hasForcePause && !hasPlaying) {
        color = STYLES.T.paused; title = '用户暂停'; cls = 'paused';
      } else if (!hasForcePause && !hasPlaying && vs.length > 0) {
        color = STYLES.T.warning; title = '已释放：无视频在播放'; cls = 'paused';
      } else if (hasForcePause || hasPlaying) {
        color = STYLES.T.success; title = '续播中'; cls = '';
      }
      b.style.background = color;
      b.style.boxShadow = '0 0 8px ' + _hexA(color, 0.6);
      b.className = 'cx-statusled cx-led' + (cls ? ' ' + cls : '');
      b.title = title;

      // Update ninja dot
      var dot = _cxPanel.querySelector('#__cxNinjaDot');
      if (dot) {
        dot.className = 'cx-ninja-dot' + (cls ? ' ' + cls : '');
      }
    }, 'dash.badge');
  }
