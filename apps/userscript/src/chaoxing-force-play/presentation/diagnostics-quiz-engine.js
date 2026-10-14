// @requires: CONFIG, _cxAllFrames, bestEffort
// @source-group: presentation/diagnostics.js
// @continuation-of: presentation/diagnostics.js
// Quiz engine and vision diagnostics inside buildDiagnostics.
    // v4.19.36 全面诊断扩展：答题引擎统计 / 调度器健康 / 混淆字体解码 / 应答端状态 / 视觉截图统计
    bestEffort(function () {
      // 答题引擎：聚合各帧最新 quizStats（按 ts 取新）
      var _st = null, _frS = _cxAllFrames();
      for (var _si = 0; _si < _frS.length; _si++) {
        try {
          var _sw = _frS[_si].__CX_FORCE_PLAY;
          if (_sw && _sw.quizStats && (!_st || (_sw.quizStats.ts || 0) > (_st.ts || 0))) _st = _sw.quizStats;
        } catch (e) {}
      }
      if (_st) {
        L.push('答题引擎: 扫=' + _st.scanned + ' 答=' + _st.answered + ' 剩=' + _st.remaining + ' · 源=' + (_st.answerSource || '?') + ' · 置信=' + Math.round((_st.confidence || 0) * 100) + '% · 分级=' + (_st.levels || '?') + ' · 待确认提交=' + (_st.pendingSubmit || 0) + ' · 待复核=' + (_st.reviewCount || 0) + ' · 严格AI=' + (_st.strictMode ? '开' : '关') + ' · 仅离线=' + (_st.offline ? '是' : '否'));
      }
      // 调度器：TimerRegistry 活跃定时器（owner 分布）+ 答题调度快照
      var _tr = null;
      try { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.stats === 'function') _tr = window.__CX_FORCE_PLAY.TimerRegistry.stats(); } catch (e) {}
      var _sched = null;
      try { if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY._quizSchedStats === 'function') _sched = window.__CX_FORCE_PLAY._quizSchedStats(); } catch (e) {}
      var _line2 = '调度器: ' + (_tr ? ('定时器=' + (_tr.intervals + _tr.timeouts) + '(interval' + _tr.intervals + '/timeout' + _tr.timeouts + ')') : '定时器=n/a');
      if (_tr && _tr.byOwner) {
        var _os = [];
        for (var _ok in _tr.byOwner) { if (_tr.byOwner.hasOwnProperty(_ok)) _os.push(_ok + ':' + _tr.byOwner[_ok]); }
        if (_os.length) _line2 += ' [' + _os.join(' ') + ']';
      }
      if (_sched) {
        _line2 += ' · 待答重扫=' + (_sched.retryTimer ? '运行' : '停止') + ' · MO=' + (_sched.moMounted ? '已挂载' : '未挂载') + ' · 宽限=' + Math.round((_sched.graceUntilMs || 0) / 1000) + 's · 待确认=' + _sched.pendingSubmit + ' · 待复核=' + _sched.reviewCount + ' · 已处理=' + _sched.handledCount;
      }
      L.push(_line2);
      // v4.19.38 MO 活动（跨帧聚合 _moStats）：累计入队/排空/批次/最近活动——验证 MO 是否在工作
      try {
        var _moAgg = null, _frM = _cxAllFrames();
        for (var _mi = 0; _mi < _frM.length; _mi++) {
          try {
            var _mw = _frM[_mi].__CX_FORCE_PLAY;
            if (_mw && typeof _mw._moStats === 'function') {
              var _m4 = _mw._moStats();
              if (!_m4) continue;
              if (!_moAgg) { _moAgg = { queue: 0, scheduled: false, pushes: 0, flushes: 0, batches: 0, lastPushMs: -1, lastFlushMs: -1, lastBatchMs: -1, mounted: false }; }
              _moAgg.queue += _m4.queue || 0;
              _moAgg.pushes += _m4.pushes || 0;
              _moAgg.flushes += _m4.flushes || 0;
              _moAgg.batches += _m4.batches || 0;
              _moAgg.scheduled = _moAgg.scheduled || !!_m4.scheduled;
              _moAgg.mounted = _moAgg.mounted || !!_m4.mounted;
              if (_m4.lastPushMs >= 0 && (_moAgg.lastPushMs < 0 || _m4.lastPushMs < _moAgg.lastPushMs)) _moAgg.lastPushMs = _m4.lastPushMs;
              if (_m4.lastFlushMs >= 0 && (_moAgg.lastFlushMs < 0 || _m4.lastFlushMs < _moAgg.lastFlushMs)) _moAgg.lastFlushMs = _m4.lastFlushMs;
              if (_m4.lastBatchMs >= 0 && (_moAgg.lastBatchMs < 0 || _m4.lastBatchMs < _moAgg.lastBatchMs)) _moAgg.lastBatchMs = _m4.lastBatchMs;
            }
          } catch (e) {}
        }
        if (_moAgg) {
          // v4.19.40：批次为活跃主指标（静态页入队恒 0 属正常，批次持续增长=MO 在工作）
          var _moL = 'MO监控: ' + (_moAgg.mounted ? '已挂载' : '未挂载') + ' · 批次=' + _moAgg.batches + (_moAgg.lastBatchMs >= 0 ? (' · 最近批次=' + Math.round(_moAgg.lastBatchMs / 1000) + 's前') : ' · 尚无回调') + ' · 入队=' + _moAgg.pushes + ' · 排空=' + _moAgg.flushes + ' · 当前队列=' + _moAgg.queue + (_moAgg.scheduled ? ' · 待排空=是' : '');
          if (_moAgg.lastPushMs >= 0) _moL += ' · 最近入队=' + Math.round(_moAgg.lastPushMs / 1000) + 's前';
          if (_moAgg.lastFlushMs >= 0) _moL += ' · 最近排空=' + Math.round(_moAgg.lastFlushMs / 1000) + 's前';
          L.push(_moL);
        }
      } catch (e) {}
      // 混淆字体解码缓存状态（判断题无图/解码失败排查）
      var _dec = null;
      try { var _dn = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY._secretDecodeStats === 'function') ? window.__CX_FORCE_PLAY._secretDecodeStats() : null; if (_dn && _dn.length) _dec = _dn[0]; } catch (e) {}
      if (_dec) L.push('混淆字体解码: 字体=' + _dec.family + ' · 字库=' + _dec.chars + '字符 · 缓存=' + Math.round(_dec.ageMs / 1000) + 's前');
      // 应答端状态（各帧均可用：课程页看通道开关与队列，DeepSeek 页看真实处理中状态）
      try {
        var _rs = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY._dsResponderState === 'function') ? window.__CX_FORCE_PLAY._dsResponderState() : null;
        if (_rs) L.push('应答端: 处理中=' + (_rs.busy ? '是' : '否') + ' · 队列=' + _rs.queue + ' · 通道=' + _rs.channel);
      } catch (e) {}
      L.push('');
    L.push(_sec(9, 'DeepSeek 数据循环'));
    // v4.19.37 数据循环：课程页⇄GM通道⇄应答端闭环统计（跨帧聚合课程侧计数；应答端侧为心跳镜像/本页实时）
      try {
        var _lpAgg = null;
        var _frL = _cxAllFrames();
        for (var _li4 = 0; _li4 < _frL.length; _li4++) {
          try {
            var _lw4 = _frL[_li4].__CX_FORCE_PLAY;
            if (_lw4 && typeof _lw4._dsLoopStats === 'function') {
              var _l4 = _lw4._dsLoopStats();
              if (!_l4) continue;
              if (!_lpAgg) { _lpAgg = _l4; _lpAgg.asksSent = 0; _lpAgg.answersGot = 0; _lpAgg.retries = 0; _lpAgg.roundTrips = 0; }
              _lpAgg.asksSent += _l4.asksSent || 0;
              _lpAgg.answersGot += _l4.answersGot || 0;
              _lpAgg.retries += _l4.retries || 0;
              _lpAgg.roundTrips += _l4.roundTrips || 0;
              // v4.19.43：课程页发题/回包计数（DS_ASK_COUNT/DS_ANSWER_COUNT 同步到顶层帧，跨帧直接聚合可读），补 _dsLoop.asksSent 仅本帧的盲区
              if (_l4.DS_ASK_COUNT) _lpAgg.asksSent += _l4.DS_ASK_COUNT;
              if (_l4.DS_ANSWER_COUNT) _lpAgg.answersGot += _l4.DS_ANSWER_COUNT;
              // 心跳新鲜度取各帧最新（子帧懒通道也可能收到 ds-state）
              if (_l4.heartbeatAgeMs >= 0 && (_lpAgg.heartbeatAgeMs < 0 || _l4.heartbeatAgeMs < _lpAgg.heartbeatAgeMs)) {
                _lpAgg.heartbeatAgeMs = _l4.heartbeatAgeMs; _lpAgg.connected = _l4.connected; _lpAgg.loggedIn = _l4.loggedIn; _lpAgg.hidden = _lpAgg.hidden || _l4.hidden;
              }
              if (_l4.roundTripMs) _lpAgg.roundTripMs = _l4.roundTripMs;
              if (_l4.lastErr) _lpAgg.lastErr = _l4.lastErr;
              if (_l4.rspReceived > 0) { _lpAgg.rspReceived = _l4.rspReceived; _lpAgg.rspSent = _l4.rspSent; _lpAgg.rspWatchdog = _l4.rspWatchdog; _lpAgg.rspDedupe = _l4.rspDedupe; _lpAgg.rspQdrop = _l4.rspQdrop; _lpAgg.rspLastAskAt = _l4.rspLastAskAt; _lpAgg.rspLastAnswerAt = _l4.rspLastAnswerAt; _lpAgg.rspLastErr = _l4.rspLastErr; }
            }
          } catch (e) {}
        }
        if (_lpAgg) {
          var _hbTxt = (_lpAgg.heartbeatAgeMs < 0) ? '无' : (Math.round(_lpAgg.heartbeatAgeMs / 1000) + 's前');
          L.push('DS数据循环: 连=' + (_lpAgg.connected ? '是' : '否') + ' · 登录=' + (_lpAgg.loggedIn === true ? '是' : (_lpAgg.loggedIn === false ? '否' : '?')) + ' · 心跳=' + _hbTxt + ' · 发题=' + _lpAgg.asksSent + ' · 回包=' + _lpAgg.answersGot + (_lpAgg.retries ? (' · 重试=' + _lpAgg.retries) : '') + (_lpAgg.roundTrips ? (' · 往返=' + Math.round(_lpAgg.roundTripMs / 1000) + 's') : '') + ' · GM写[' + (_lpAgg.writes || '无') + ']' + (_lpAgg.hidden ? ' · 后台节流' : ''));
          // 应答端侧（镜像/本页）：收题/回包/看门狗/去重/队列丢弃/最近错误
          var _r2 = [];
          if (_lpAgg.rspReceived !== undefined) {
            _r2.push('收题=' + _lpAgg.rspReceived);
            _r2.push('回包=' + _lpAgg.rspSent);
            if (_lpAgg.rspWatchdog) _r2.push('看门狗=' + _lpAgg.rspWatchdog);
            if (_lpAgg.rspDedupe) _r2.push('去重=' + _lpAgg.rspDedupe);
            if (_lpAgg.rspQdrop) _r2.push('弃队=' + _lpAgg.rspQdrop);
            if (_lpAgg.rspLastAskAt) _r2.push('最近收=' + Math.round((Date.now() - _lpAgg.rspLastAskAt) / 1000) + 's前');
            if (_lpAgg.rspLastAnswerAt) _r2.push('最近回=' + Math.round((Date.now() - _lpAgg.rspLastAnswerAt) / 1000) + 's前');
            if (_lpAgg.rspLastErr) _r2.push('末错=' + _lpAgg.rspLastErr);
            if (_r2.length) L.push('  应答端循环: ' + _r2.join(' · '));
          }
        }
      } catch (e) {}
      L.push('');
    L.push('■ [10] 性能遥测');
    // v4.19.44：运维遥测聚合（续播/定向命中/黑匣子）——把「脚本到底干了什么」直接可见，填补诊断信息稀疏
      bestEffort(function () {
        var _agg = { attempts: 0, success: 0, samples: 0, hits: 0, bx: [] };
        var _fr5 = _cxAllFrames();
        for (var _fi5 = 0; _fi5 < _fr5.length; _fi5++) {
          try {
            var _ms = _fr5[_fi5].__CX_FORCE_PLAY;
            if (!_ms || typeof _ms.cxMetricsSnapshot !== 'function') continue;
            var _s = _ms.cxMetricsSnapshot();
            if (!_s) continue;
            _agg.attempts += _s.safePlayAttempts || 0;
            _agg.success += _s.safePlaySuccesses || 0;
            _agg.samples += _s.targetHitSamples || 0;
            _agg.hits += _s.targetHitHits || 0;
            if (_s.bx && _s.bx.length) _agg.bx = _agg.bx.concat(_s.bx);
          } catch (e) {}
        }
        if (_agg.attempts > 0) {
          var _rate = Math.round(_agg.success / Math.max(1, _agg.attempts) * 100);
          L.push('遥测: 续播 尝试=' + _agg.attempts + ' 成功=' + _agg.success + ' 成功率=' + _rate + '%');
        }
        if (_agg.samples > 0) {
          var _hr = Math.round(_agg.hits / Math.max(1, _agg.samples) * 100);
          L.push('遥测: 定向命中率=' + _hr + '%（命中=' + _agg.hits + '/' + _agg.samples + '）');
        }
        // MO 走势最近增量序列（dashboard 每周期采样批次增量；同帧可读，直接引用模块变量）
        try {
          if (typeof _moHistory !== 'undefined' && _moHistory && _moHistory.length) {
            var _moSum = 0; for (var _mi2 = 0; _mi2 < _moHistory.length; _mi2++) _moSum += _moHistory[_mi2];
            L.push('遥测: MO走势最近增量(' + _moHistory.length + '点): [' + _moHistory.join(',') + '] · 累计批次增量=' + _moSum);
          }
        } catch (e) {}
        // 主循环 tick 抖动（与标称 RESCAN_INTERVAL 的 RMS 偏差；环形 30 实测间隔）
        try {
          if (typeof _loopTickDeltas !== 'undefined' && _loopTickDeltas && _loopTickDeltas.length > 1) {
            var _ld = _loopTickDeltas, _ls2 = 0, _lmn = 1e9, _lmx = 0;
            for (var _li3 = 0; _li3 < _ld.length; _li3++) { var _v = _ld[_li3]; _ls2 += _v; if (_v < _lmn) _lmn = _v; if (_v > _lmx) _lmx = _v; }
            var _lavg = Math.round(_ls2 / _ld.length), _nom2 = (typeof CONFIG !== 'undefined' && CONFIG.RESCAN_INTERVAL) || 0, _jit2 = 0;
            for (var _li4 = 0; _li4 < _ld.length; _li4++) _jit2 += Math.pow(_ld[_li4] - _nom2, 2);
            _jit2 = Math.round(Math.sqrt(_jit2 / _ld.length));
            L.push('遥测: 主循环tick抖动 标称=' + _nom2 + 'ms · 实测 均值=' + _lavg + ' 最小=' + _lmn + ' 最大=' + _lmx + ' 抖动RMS偏差=' + _jit2 + 'ms · 采样=' + _ld.length);
          }
        } catch (e) {}
        // 答题每题耗时（从各帧 quizAiDiag 聚合 startTs→last.ts；跨同源 iframe）
        try {
          var _durs = [], _md = 0, _mseq = 0, _frD3 = _cxAllFrames();
          for (var _di3 = 0; _di3 < _frD3.length; _di3++) {
            try {
              var _dw3 = _frD3[_di3].__CX_FORCE_PLAY;
              if (!_dw3 || !_dw3.quizAiDiag) continue;
              for (var _dk3 in _dw3.quizAiDiag) {
                if (!Object.prototype.hasOwnProperty.call(_dw3.quizAiDiag, _dk3)) continue;
                var _e3 = _dw3.quizAiDiag[_dk3];
                if (_e3 && _e3.startTs && _e3.last && _e3.last.ts) {
                  var _dt = _e3.last.ts - _e3.startTs;
                  if (_dt >= 0) { _durs.push(_dt); if (_dt > _md) { _md = _dt; _mseq = _e3.seq || 0; } }
                }
              }
            } catch (e) {}
          }
          if (_durs.length) {
            var _sum3 = 0; for (var _di4 = 0; _di4 < _durs.length; _di4++) _sum3 += _durs[_di4];
            var _sorted = _durs.slice().sort(function (a, b) { return a - b; });
            var _med = _sorted[Math.floor(_sorted.length / 2)];
            L.push('遥测: 答题每题耗时 已结算=' + _durs.length + ' · 均值=' + Math.round(_sum3 / _durs.length / 1000) + 's · 中位=' + Math.round(_med / 1000) + 's · 最大=' + Math.round(_md / 1000) + 's(题#' + _mseq + ')');
          }
        } catch (e) {}
      }, 'diag.telemetry');
      // v4.19.49：『[11] 用户操作路径』独立成块（修补旧结构——[11] 标题原嵌在 diag.telemetry 回调体内、遥测行
      // 在 [11] 标题之后 push，导致 [10] 性能遥测下挂黑匣子、[11] 标题下挂遥测的归属错乱）。黑匣子在此独立重新聚合。
      L.push('');
      L.push('■ [11] 用户操作路径（黑匣子·最近6条）');
      bestEffort(function () {
        var _bxAgg = [];
        var _frBx = _cxAllFrames();
        for (var _fiBx = 0; _fiBx < _frBx.length; _fiBx++) {
          try {
            var _msBx = _frBx[_fiBx].__CX_FORCE_PLAY;
            if (!_msBx || typeof _msBx.cxMetricsSnapshot !== 'function') continue;
            var _sbx = _msBx.cxMetricsSnapshot();
            if (_sbx && _sbx.bx && _sbx.bx.length) _bxAgg = _bxAgg.concat(_sbx.bx);
          } catch (e) {}
        }
        if (_bxAgg.length) {
          _bxAgg.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
          var _bxN2 = _bxAgg.slice(0, 6);
          for (var _bi2 = 0; _bi2 < _bxN2.length; _bi2++) {
            var _be2 = _bxN2[_bi2];
            L.push('  - ' + new Date(_be2.ts || Date.now()).toLocaleTimeString() + ' · ' + (_be2.action || '?') + (_be2.detail ? (' · ' + String(_be2.detail).slice(0, 80)) : ''));
          }
        } else {
          L.push('  - 无近期操作记录');
        }
      }, 'diag.blackbox');
      // 视觉截图统计：累计题数 + 跳过(仅文本)数（跨帧聚合 quizAiDiag）
      var _tot = 0, _skip = 0, _frD = _cxAllFrames();
      for (var _di2 = 0; _di2 < _frD.length; _di2++) {
        try {
          var _dw2 = _frD[_di2].__CX_FORCE_PLAY;
          if (_dw2 && _dw2.quizAiDiag) {
            for (var _dk3 in _dw2.quizAiDiag) {
              if (!Object.prototype.hasOwnProperty.call(_dw2.quizAiDiag, _dk3)) continue;
              _tot++;
              var _le3 = _dw2.quizAiDiag[_dk3];
              if (_le3 && _le3.last && _le3.last.imgSkipped === true) _skip++;
            }
          }
        } catch (e) {}
      }
      if (_tot > 0) L.push('视觉截图: 累计题=' + _tot + ' · 跳过(仅文本)=' + _skip);
    }, 'diag.quizDeep');
