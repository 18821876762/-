// @requires: EventBus, FLAGS, STYLES, TARGET, _cxPanel, _cxPanelOwnerClaim, allVideos, bestEffort, cxIcon, escapeHTML, foregroundVideo, shortSrc, singleVideoActive
// @source-group: presentation/dashboard.js
// @continuation-of: presentation/dashboard.js
// Dashboard metrics, video rows, and quiz lights.
  function renderDashboard() {
    bestEffort(function () {
      // v4.19.39/40：MO 指标以「回调批次」为活跃主指标——瞬态队列采样恒 0（捕获后 16ms/200ms 即排空接管），
      // 且静态渲染的视频不触发 MO 入队（入队恒 0 属正常，视频由主循环 scanVideos 接管）；
      // 批次持续增长才是 MO 在工作的直接证据。瞬时队列仍用于积压警告色（>_MO_WARN_LEN 危险）。
      var _moa = _dashMoAgg();
      var moLen = _moa.queue;    // 瞬时队列（警告色判定）
      var moBatch = _moa.batches; // 累计回调批次（指标主显示）
      // v4.19.41：delta 钳制非负——脚本重载/iframe 重跑/跨帧聚合波动会使聚合批次回落，
      // 未钳制时 delta 为负 → Sparkline y 坐标越界画出 canvas（「越跑越远，超出范围外」）。
      var moDelta = Math.max(0, moBatch - _lastMoBatches);
      _lastMoBatches = moBatch;
      // Sparkline 采样「每周期回调批次增量」（MO 活动速率走势，非单调累计）
      if (_moHistory.length === 0 || _moHistory[_moHistory.length - 1] !== moDelta) {
        _moHistory.push(moDelta);
        if (_moHistory.length > _moHistMax) _moHistory.shift();
      }
      // MO metric（累计回调批次）
      var moVal = _cxPanel.querySelector('#__cxMoVal');
      if (moVal) {
        // v4.19.41：大数字改显「当前周期增量」（走势图最后一点对应值，可读性优先）；
        // 累计批次/入队/排空/最近批次进 tooltip（指标卡 #__cxMetricMo 仍显累计）
        moVal.textContent = '+' + moDelta;
        moVal.title = '本周期 MO 回调增量 ' + moDelta + ' · 累计批次 ' + moBatch + ' · 入队 ' + _moa.pushes + ' · 排空 ' + _moa.flushes + (_moa.lastBatchMs >= 0 ? (' · 最近批次 ' + Math.round(_moa.lastBatchMs / 1000) + 's前') : '');
        moVal.style.color = moLen > _MO_WARN_LEN ? STYLES.T.danger : 'var(--cx-text)';
      }
      var metricMo = _cxPanel.querySelector('#__cxMetricMo');
      if (metricMo) {
        metricMo.textContent = moBatch;
        metricMo.title = '累计回调批次（MO 监测 DOM 变化的次数，持续增长=MO 在工作）';
        metricMo.className = 'cx-metric-val' + (moLen > _MO_WARN_LEN ? ' danger' : '');
      }
      // Sparkline（v4.19.41：越界修复 + 数值标注）
      var cvs = _cxPanel.querySelector('#__cxMoSpark');
      if (cvs) {
        var w = cvs.width, h = cvs.height, ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        var hist = _moHistory;
        if (hist.length > 0) {
          var max = Math.max.apply(null, hist) || 1, n = hist.length;
          // 基线（0 参考线，虚线）
          ctx.strokeStyle = 'rgba(128,128,128,0.45)'; ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(0, h - 2); ctx.lineTo(w, h - 2); ctx.stroke();
          ctx.setLineDash([]);
          if (n > 1) {
            var step = w / Math.max(1, n - 1);
            ctx.strokeStyle = STYLES.T.primary2; ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (var i = 0; i < n; i++) {
              // y 双保险钳制：负值/超界历史点（脚本重载前残留）不画出 canvas
              var v = Math.max(0, hist[i] || 0);
              var x = i * step, y = Math.min(h - 3, Math.max(0, h - (v / max) * (h - 3) - 2));
              (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
            // 填充（钳制到 canvas 内）
            ctx.lineTo((n - 1) * step, h); ctx.lineTo(0, h); ctx.closePath();
            var grd = ctx.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, STYLES.T.primary2A25); grd.addColorStop(1, STYLES.T.primary2A0);
            ctx.fillStyle = grd; ctx.fill();
            // 数值标注：左上=峰值，终点旁=当前增量
            var cur = Math.max(0, hist[n - 1] || 0);
            var curY = Math.min(h - 3, Math.max(0, h - (cur / max) * (h - 3) - 2));
            ctx.fillStyle = STYLES.T.primary2; ctx.font = '9px monospace';
            ctx.fillText('max ' + max, 2, 8);
            ctx.fillText('now +' + cur, Math.max(0, Math.min(w - 46, (n - 1) * step - 34)), Math.max(8, curY - 4));
          }
        }
      }
      // Hit rate metric (replaces ring gauge)
      var targetEnabled = !!(TARGET && TARGET.enabled);
      if (targetEnabled) { _targetHitSamples++; if (TARGET.matchedAny) _targetHitHits++; }
      var hitPct = targetEnabled ? Math.round(_targetHitHits / Math.max(1, _targetHitSamples) * 100) : 0;
      var hitCol = !targetEnabled ? '' : (hitPct >= _RATE_GOOD ? ' success' : (hitPct >= _RATE_FAIR ? ' warning' : ' danger'));
      var metricHit = _cxPanel.querySelector('#__cxMetricHit');
      if (metricHit) {
        metricHit.textContent = targetEnabled ? (hitPct + '%') : '—';
        metricHit.className = 'cx-metric-val' + hitCol;
      }
      // Play rate metric
      var playPct = _safePlayAttempts > 0 ? Math.round(_safePlaySuccesses / _safePlayAttempts * 100) : 0;
      var playCol = _safePlayAttempts > 0 ? (playPct >= _RATE_GOOD ? ' success' : (playPct >= _RATE_FAIR ? ' warning' : ' danger')) : '';
      var metricPlay = _cxPanel.querySelector('#__cxMetricPlay');
      if (metricPlay) {
        metricPlay.textContent = _safePlayAttempts > 0 ? (playPct + '%') : '—';
        metricPlay.className = 'cx-metric-val' + playCol;
      }
    }, 'dash.dashboard');
  }
  function renderVideoList() {
    if (!_cxPanel) return;
    // S3 修复：视频列表渲染加所有者守卫。多 iframe 场景（MOOC 主站+视频 frame 同页），
    // 面板只建一次（top.document），创建者帧的 click 处理器引用该帧的 _lastVideoList/allVideos()。
    // 非创建者帧改写视频列表会致 UI 数据与处理器索引错位→"点错视频"。非所有者只做洞察/系统页刷新。
    if (!_cxPanelOwnerClaim()) return;   // R4+R5：owner 帧才重绘；owner 缺失则本帧抢占，避免索引错位/抢绘
    var wrap = _cxPanel.querySelector('#__cxVideoList');
    if (!wrap) return;
    var vs = allVideos(), fg = foregroundVideo();
    _lastVideoList = vs;
    var html = '';
    if (!vs.length) html = '<div style="font-size:12px;color:var(--cx-text3);text-align:center;padding:16px 0;">未检测到视频</div>';
    for (var i = 0; i < vs.length; i++) {
      (function (idx) {
        var v = vs[idx];
        var itemHtml = '';
        bestEffort(function () {
          var isEnded = v.ended;
          var isSingleDisabled = singleVideoActive();
          var on = !v[FLAGS.userPaused] && !v.paused && !isEnded;
          var star = (v === fg) ? '<span class="cx-video-star">' + cxIcon('star', 13) + '</span>' : '';
          var tag = isEnded ? '已结束' : (v[FLAGS.userPaused] ? '已暂停' : (v[FLAGS.forcePaused] ? '续播中' : '播放中'));
          var disabled = isEnded || isSingleDisabled;
          var dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
          var pctWatched = dur ? Math.min(100, (v.currentTime / dur) * 100) : 0;
          var pctBuffered = 0;
          if (dur && v.buffered && v.buffered.length) {
            bestEffort(function () { for (var bi = 0; bi < v.buffered.length; bi++) { var be = v.buffered.end(bi); if (be > v.currentTime) pctBuffered = Math.max(pctBuffered, Math.min(100, (be / dur) * 100)); } }, 'dash.buffered');
          }
          var tCur = fmtTime(v.currentTime);
          var tDur = dur ? fmtTime(dur) : '--:--';
          var itemCls = 'cx-video-item' + (v === fg ? ' active' : '') + (disabled ? ' disabled' : '');
          var toggleCls = 'cx-video-toggle' + (on ? ' on' : '');
          // UI 规范 §视频列表项：左侧 3px 状态条按 data-state 着色（播放=绿/暂停=橙/异常=红；已结束=默认灰）
          var dataState = isEnded ? '' : (on ? ' data-state="playing"' : ' data-state="paused"');
          itemHtml = '<div class="' + itemCls + '"' + dataState + ' role="listitem" data-vi="' + idx + '"' + (disabled ? ' data-dis="1"' : '') + ' title="' + (isSingleDisabled ? '单视频模式：仅前台播放' : '点击切换续播/暂停') + '">' +
            '<button class="' + toggleCls + '"' + (disabled ? ' disabled' : '') + ' data-vi="' + idx + '"' + (disabled ? ' data-dis="1"' : '') + ' aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + (on ? '暂停' : '恢复') + ' #' + (idx + 1) + ' 视频"></button>' +
            '<div class="cx-video-info">' +
              '<div class="cx-video-name">#' + (idx + 1) + star + ' ' + escapeHTML(shortSrc(v)) + '</div>' +
              '<div class="cx-video-meta">' + tag + ' · ' + tCur + ' / ' + tDur + '</div>' +
              (dur > 0 ? '<div class="cx-video-mini-progress"><div class="cx-video-mini-progress-bar" style="width:' + pctWatched.toFixed(1) + '%;"></div></div>' : '') +
            '</div>' +
          '</div>';
        }, 'dash.renderVideo');
        // R2 修复：读取失败（跨域/已失效）也要保留 data-vi 占位行，避免该视频整行丢失导致列表与 _lastVideoList 视觉错位→误点
        if (itemHtml) {
          html += itemHtml;
        } else {
          bestEffort(function () {
            html += '<div class="cx-video-item cx-video-item-failed" data-state="error" role="listitem" data-vi="' + idx + '" title="无法读取该视频状态（跨域/已失效）">' +
              '<div class="cx-video-info">' +
                '<div class="cx-video-name">#' + (idx + 1) + ' ' + escapeHTML(shortSrc(v) || '(未知视频)') + '</div>' +
                '<div class="cx-video-meta">状态不可读</div>' +
              '</div></div>';
          }, 'dash.renderVideoFallback');
        }
      })(i);
    }
    if (wrap.__cxLastHTML !== html || (html && wrap.childElementCount === 0)) {
      wrap.__cxLastHTML = html;
      wrap.innerHTML = html;
    }
  }

  // 需求·答题信号灯渲染：每道题一个小灯，七态七色（红=完全失败 绿=已完成 黄=作答中/待确认/待复核 紫=暂时受阻 蓝=特殊情况 橙=信息缺失 黑=未进行）。
  // 状态由 quiz.js 的 _quizSyncLights 维护（基于 _quizHandled/_quizAIFailed/_quizAIProblems/_quizVisTimers/_quizAIPending/_quizPendingSubmit/_quizManualHold/_quizDsGraceUntil/_quizInfoMissing），
  // 经 EventBus 'quiz:lights' 事件驱动本渲染；内容指纹（状态串）未变不重建 DOM。
  var _quizLightsFp = '';
  function renderQuizLights() {
    if (!_cxPanel) return;
    bestEffort(function () {
      var box = _cxPanel.querySelector('#__cxQuizLights');
      if (!box) return;
      var lights = (window.__CX_FORCE_PLAY && (window.__CX_FORCE_PLAY.quizLightsRemote || window.__CX_FORCE_PLAY.quizLights)) || null;   // v4.19.9：应答端面板优先显示课程页镜像灯
      // v4.19.46：应答端面板标注镜像新鲜度——灯区 tooltip 显示「镜像 Ns前」，陈旧残留（课程页出清/关闭）一眼可辨
      var _mirTs = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizLightsRemoteTs) || 0;
      var _mirHint = '';
      if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizLightsRemote && _mirTs) {
        var _mirAge = Math.round((Date.now() - _mirTs) / 1000);
        _mirHint = (_mirAge > 60) ? ('（镜像 ' + _mirAge + 's前，可能已陈旧——课程页出清/关闭后残留）') : ('（镜像 ' + _mirAge + 's前）');
      }
      var sig = lights ? lights.map(function (l) { return l.state[0] + (l.kind ? l.kind[0] : ''); }).join('') : '';
      if (sig === _quizLightsFp && box.childNodes.length > 1) return;   // 状态未变且已渲染 → 跳过
      _quizLightsFp = sig;
      while (box.childNodes.length > 1) box.removeChild(box.lastChild);   // 保留标题节点，重建灯
      if (!lights || !lights.length) {
        var _empty = document.createElement('span');
        _empty.style.cssText = 'font-size:11px;color:var(--cx-text3);';
        _empty.textContent = '未检测到题目' + (_mirHint ? ' ' + _mirHint : '');
        box.appendChild(_empty);
        return;
      }
      var _colors = { done: '#10b981', fail: '#ef4444', busy: '#f59e0b', idle: '#374151', blocked: '#a855f7', special: '#3b82f6', missing: '#f97316', fill: '#06b6d4' };
      var _busyLabels = { confirm: '待确认提交', review: '待人工复核', answering: '正在答题' };  // 黄灯按 kind 细分（与状态区/toast 对齐）
      var _labels = { done: '已完成', fail: '完全失败', busy: '正在答题', idle: '未进行', blocked: '暂时受阻', special: '特殊情况', missing: '信息缺失', fill: '填空题待回填' };  // 八态八色标签（红=完全失败，橙=信息缺失，紫=暂时受阻，蓝=特殊情况，青=填空题待回填）
      var _mirTitle = _mirHint || '';   // v4.19.46：镜像新鲜度提示（应答端页灯区 tooltip）
      for (var i = 0; i < lights.length; i++) {
        var l = lights[i];
        var d = document.createElement('div');
        var st = l.state || 'idle';
        d.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + (_colors[st] || _colors.idle) + ';opacity:' + (st === 'idle' ? 0.45 : 1) + ';box-shadow:0 0 2px rgba(0,0,0,0.3);';
        var _label = (st === 'busy' && l.kind && _busyLabels[l.kind]) ? _busyLabels[l.kind] : (_labels[st] || '未进行');
        d.title = '第 ' + l.seq + ' 题：' + _label + (st === 'fail' && l.msg ? '（' + String(l.msg).slice(0, 60) + '）' : '') + (_mirTitle ? '\n' + _mirTitle : '');
        box.appendChild(d);
      }
    }, 'dash.quizLights');
  }
  bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.onEv) EventBus.onEv('quiz:lights', renderQuizLights); }, 'dash.ev.quizLights');
