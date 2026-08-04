  // ===== DOMAIN: ui/dashboard (state refresh + badge + dashboard + video list) =====
  function fmtTime(sec) {                          // 秒 → m:ss / h:mm:ss
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h > 0 && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h > 0 ? h + ':' + mm : m) + ':' + ss;
  }
  // 环形仪表：把百分比映射到 dashoffset（r=14 → 周长≈87.96），并同步中心文字
  function _gauge(ring, txt, pct, color, label) {
    if (!ring) return;
    var C = 87.96;
    var p = Math.max(0, Math.min(100, pct));
    ring.style.strokeDashoffset = (C * (1 - p / 100)).toFixed(2);
    ring.style.stroke = color;
    if (txt) txt.textContent = label;
  }
  // 十六进制色 → rgba（用于呼吸灯辉光，与状态色一致）
  function _hexA(hex, a) {
    try {
      var h = String(hex).replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    } catch (e) { return 'rgba(16,185,129,' + a + ')'; }
  }
  function refreshPanelState() {
    if (!_cxPanel) return;
    refreshPanelLabels();   // 拖动滑块即时刷新数值文字（修复：拖动时显示不变）
    updateBadge();          // 状态徽章：标题栏 LED 指示灯
    renderDashboard();      // 运维仪表盘实时刷新
    var st = _cxPanel.querySelector('#__cxPanelState');
    var v = activeVideo();
    if (!v) {
      // 没有正在播放的：尝试展示已用户暂停的目标
      v = currentVideo();
      if (st) { if (!v) st.textContent = '当前无视频'; else st.textContent = '视频已暂停(用户) · 按按钮恢复'; }
    } else if (st) {
      var src = (v.currentSrc || v.src || '').split('/').pop() || '(未知)';
      var status = v.__cxAN_hold ? '插播题锁定(auto-next)' : (v.__cxUserPaused ? '已暂停(用户)' : (v.paused ? '暂停' : '播放中'));
      var watchMin = ((cxState(v).watchMs || 0) / 60000).toFixed(1);
      var autoRemain = CONFIG.AUTO_STOP_MIN > 0 ? Math.max(0, CONFIG.AUTO_STOP_MIN - (cxState(v).watchMs || 0) / 60000).toFixed(1) : '关闭';
      var resumeRemain = (v.__cxUserPaused && cxState(v).resumeAt) ? Math.max(0, (cxState(v).resumeAt - Date.now()) / 60000).toFixed(1) : '—';
      var prog = fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? ' / ' + fmtTime(v.duration) : '');
      st.textContent = '视频: ' + src + '\n状态: ' + status + ' · 进度 ' + prog + '\n已看 ' + watchMin + 'min · 自动停剩 ' + autoRemain + 'min · 恢复剩 ' + resumeRemain + 'min';
    }
    var btn = _cxPanel.querySelector('#__cxBtnPause');
    if (btn) btn.textContent = (v && v.__cxUserPaused) ? '▶ 恢复续播' : '⏸ 暂停续播';
    // 全局诊断信息（含 heap / 桥 / 定向 / 轮询，供反馈；替代原单独 heap 行）
    try {
      var info = _cxPanel.querySelector('#__cxPanelInfo');
      if (info) {
        var vs = allVideos();
        var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
        var heap = m ? ((m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB') : 'n/a';
        var bridge = (BRIDGE && BRIDGE.base) ? ('已连 ' + escapeHTML(BRIDGE.base) + (BRIDGE.version ? ' v' + BRIDGE.version : '')) : '离线';
        // 空态成文（设计 §6.3）：桥离线时诊断块首行黄色警示（innerHTML 以着色单行，内容均为内部生成无注入面）
        var warnLine = (BRIDGE && BRIDGE.base) ? '' : '<div style="color:' + STYLES.T.warning + ';">桥离线 · DOM 兜底中</div>';
        info.innerHTML = warnLine +
          'v' + SCRIPT_VERSION + ' · 视频 ' + vs.length + ' · moQueue ' + _moQueue.length + ' · ended ' + Object.keys(ENDED_SRCS).length + '\n' +
          'heap ' + heap + '\n' +
          '桥 ' + bridge + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter) + '\n' +
          '定向 enabled=' + (TARGET && TARGET.enabled) + ' 命中=' + (TARGET && TARGET.matchedAny) + ' 0命中 ' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS + '\n' +
          '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms · 热键 P';
      }
    } catch (e) { swallow(e); }
    renderVideoList();                  // 实时刷新逐视频控制列表
  }
  // —— 状态徽章（Badge）：标题栏 LED 指示灯，一眼看清脚本当前状态 ——
  function updateBadge() {
    try {
      var b = _cxPanel.querySelector('#__cxPanelBadge');
      if (!b) return;
      var vs = allVideos();
      // 优先级：桥连接 > 锁定态 > 用户暂停 > 已释放 > 正常续播
      var color = STYLES.T.idle, title = '未运行 / 初始化中';
      if (BRIDGE && BRIDGE.base) {
        color = STYLES.T.primary2; title = '桥已连接 (' + BRIDGE.base + ')';
      }
      // 扫描所有视频，找最优先的状态
      var hasEndLock = false, hasUserPause = false, hasForcePause = false, hasPlaying = false, hasReleased = false;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (v[FLAGS.endedLock]) hasEndLock = true;
        if (v[FLAGS.userPaused]) hasUserPause = true;
        if (v[FLAGS.forcePaused]) hasForcePause = true;
        if (!v.paused && !v.ended) hasPlaying = true;
        // nearEnd 已释放：forcePaused=false 但已在近尾 — 用 ended + nearEnd 判断
        if (v.ended && !v[FLAGS.endedLock]) hasReleased = true;
      }
      // 优先级覆盖（从高到低）
      if (BRIDGE && BRIDGE.skipResume && !hasForcePause && !hasPlaying) {
        color = STYLES.T.warning; title = '桥避让：章节已完成，脚本休眠';
      } else if (hasEndLock) {
        color = STYLES.T.danger; title = '已锁死：防重播，视频播完被锁定';
      } else if (hasUserPause && !hasForcePause && !hasPlaying) {
        color = STYLES.T.paused; title = '用户暂停：手动暂停中';
      } else if (!hasForcePause && !hasPlaying && vs.length > 0) {
        color = STYLES.T.warning; title = '已释放：无视频在播放（可能是近尾释放/非任务点/定向过滤）';
      } else if (hasForcePause || hasPlaying) {
        color = STYLES.T.success; title = '续播中：脚本正在工作';
      }
      b.style.background = color;
      b.style.boxShadow = '0 0 8px ' + _hexA(color, 0.6);   // 呼吸灯辉光，随状态色变化
      b.title = title;
    } catch (e) { swallow(e); }
  }
  // —— 运维仪表盘：MO Sparkline + 命中率 LED + 续播成功率 ——
  function renderDashboard() {
    try {
      // 采集 MO 队列历史
      var moLen = (typeof _moQueue !== 'undefined' ? _moQueue : []).length || 0;
      if (_moHistory.length === 0 || _moHistory[_moHistory.length - 1] !== moLen) {
        _moHistory.push(moLen);
        if (_moHistory.length > _moHistMax) _moHistory.shift();
      }
      // 更新 MO 队列数值
      var moVal = _cxPanel.querySelector('#__cxMoVal');
      if (moVal) { moVal.textContent = moLen; moVal.style.color = moLen > 10 ? STYLES.T.danger : STYLES.T.text; }
      // Sparkline 画布（迷你走势图）
      var cvs = _cxPanel.querySelector('#__cxMoSpark');
      if (cvs) {
        var w = cvs.width, h = cvs.height, ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        var hist = _moHistory;
        if (hist.length > 0) {
          var max = Math.max.apply(null, hist) || 1, n = hist.length;
          if (n > 1) {
            var step = w / Math.max(1, n - 1);
            ctx.strokeStyle = STYLES.T.primary2; ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (var i = 0; i < n; i++) {
              var x = i * step, y = h - (hist[i] / max) * (h - 2) - 1;
              (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
            // 填充渐变区域
            ctx.lineTo((n-1)*step, h); ctx.lineTo(0, h); ctx.closePath();
            var grd = ctx.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, STYLES.T.primary2A25); grd.addColorStop(1, STYLES.T.primary2A0);
            ctx.fillStyle = grd; ctx.fill();
          }
        }
      }
      // 命中率环形仪表（累计命中率，像精密仪器读数，实时但不跳动）
      var targetEnabled = !!(TARGET && TARGET.enabled);
      if (targetEnabled) { _targetHitSamples++; if (TARGET.matchedAny) _targetHitHits++; }
      var hitPct = targetEnabled ? Math.round(_targetHitHits / Math.max(1, _targetHitSamples) * 100) : 0;
      var hitCol = !targetEnabled ? STYLES.T.idle : (hitPct >= 80 ? STYLES.T.success : (hitPct >= 50 ? STYLES.T.warning : STYLES.T.danger));
      _gauge(_cxPanel.querySelector('#__cxHitGauge'), _cxPanel.querySelector('#__cxHitGaugeTxt'), hitPct, hitCol, targetEnabled ? (hitPct + '%') : '—');
      // 续播成功率环形仪表
      var playPct = _safePlayAttempts > 0 ? Math.round(_safePlaySuccesses / _safePlayAttempts * 100) : 0;
      var playCol = _safePlayAttempts > 0 ? (playPct >= 80 ? STYLES.T.success : (playPct >= 50 ? STYLES.T.warning : STYLES.T.danger)) : STYLES.T.idle;
      _gauge(_cxPanel.querySelector('#__cxPlayGauge'), _cxPanel.querySelector('#__cxPlayGaugeTxt'), playPct, playCol, _safePlayAttempts > 0 ? (playPct + '%') : '—');
    } catch (e) { swallow(e); }
  }
  function renderVideoList() {          // 逐视频暂停/恢复：修复"多视频下只能控制单个视频"的缺陷
    if (!_cxPanel) return;
    var wrap = _cxPanel.querySelector('#__cxVideoList');
    if (!wrap) return;
    var vs = allVideos(), fg = foregroundVideo();
    _lastVideoList = vs;
    var html = '';
    if (!vs.length) html = '<div style="font-size:12px;color:' + STYLES.T.text3 + ';text-align:center;padding:12px 0;">未检测到视频</div>';
    for (var i = 0; i < vs.length; i++) {
      try {
        var v = vs[i];
        var isEnded = v.ended;
        var isSingleDisabled = CONFIG.SINGLE_VIDEO;   // 单视频模式：所有逐视频开关禁用
        var on = !v.__cxUserPaused && !v.paused && !isEnded;   // 开关 ON = 当前处于续播/播放态（蓝）；OFF = 暂停（灰）
        var star = (v === fg) ? '★' : '';
        var tag = isEnded ? '[结束]' : (v.__cxUserPaused ? '[暂停]' : (v.__cxForcePaused ? '[续播]' : ''));
        var trackBg = (isEnded || isSingleDisabled) ? STYLES.T.border : (on ? STYLES.T.primary2 : STYLES.T.idle);
        var knobLeft = (isEnded || isSingleDisabled) ? '2px' : (on ? '16px' : '2px');
        var cur = (isEnded || isSingleDisabled) ? 'default' : 'pointer';
        // —— 进度条数据 ——
        var dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
        var pctWatched = dur ? Math.min(100, (v.currentTime / dur) * 100) : 0;
        // buffered 范围：取包含 currentTime 的最大缓冲点
        var pctBuffered = 0;
        if (dur && v.buffered && v.buffered.length) {
          try { for (var bi = 0; bi < v.buffered.length; bi++) { var be = v.buffered.end(bi); if (be > v.currentTime) pctBuffered = Math.max(pctBuffered, Math.min(100, (be / dur) * 100)); } } catch (e) {}
        }
        var hasLoop = CONFIG.LOOP_PLAY && !v.ended;
        html += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;">' +
          '<span data-vi="' + i + '"' + (isEnded || isSingleDisabled ? ' data-dis="1"' : '') + ' title="' + (isSingleDisabled ? '单视频模式：仅前台播放（关闭「只播放一个视频」恢复独立控制）' : '点击切换续播/暂停') + '" style="display:inline-block;width:32px;height:18px;border-radius:9px;position:relative;flex:0 0 auto;cursor:' + cur + ';background:' + trackBg + ';">' +
            '<span style="position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);left:' + knobLeft + ';"></span>' +
          '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (star ? 'color:' + STYLES.T.star + ';' : '') + (isEnded ? 'color:' + STYLES.T.text3 + ';' : '') + '">#' + (i + 1) + star + ' ' + tag + ' ' + escapeHTML(shortSrc(v)) + '</span>' +
        '</div>' +
        // —— 进度条（已看+缓存+循环标记）——
        (dur > 0 ? '<div style="position:relative;height:4px;background:' + STYLES.T.track + ';border-radius:2px;margin-left:40px;margin-bottom:4px;' + (isEnded ? 'opacity:.3;' : '') + '">' +
          // 已看部分（蓝色）
          '<div style="position:absolute;left:0;top:0;height:100%;background:' + STYLES.T.primary2 + ';border-radius:2px;width:' + pctWatched.toFixed(1) + '%;"></div>' +
          // 缓存部分（浅灰，在已看之后）
          (pctBuffered > pctWatched ? '<div style="position:absolute;left:' + pctWatched.toFixed(1) + '%;top:0;height:100%;background:' + STYLES.T.buffered + ';border-radius:2px;width:' + (pctBuffered - pctWatched).toFixed(1) + '%;"></div>' : '') +
          // 循环标记（末尾小箭头）
          (hasLoop ? '<span style="position:absolute;right:-8px;top:-3px;font-size:8px;color:' + STYLES.T.warning + ';">↻</span>' : '') +
        '</div>' : '') +
        // 进度文字
        (dur > 0 ? '<div style="font-size:9px;color:' + STYLES.T.text3 + ';margin-left:40px;margin-bottom:4px;display:flex;justify-content:space-between;">' +
          '<span>' + fmtTime(v.currentTime) + '</span>' +
          (v.ended ? '<span style="color:' + STYLES.T.text3 + ';">已结束</span>' : '<span>' + fmtTime(dur) + '</span>') +
        '</div>' : '');
      } catch (e) { swallow(e); }
    }
    wrap.innerHTML = html;
  }
