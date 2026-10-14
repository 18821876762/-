// @requires: _cxAllFrames, bestEffort
// @source-group: presentation/diagnostics.js
// @continuation-of: presentation/diagnostics.js
// Quiz status aggregation inside buildDiagnostics.
    L.push('');
    L.push(_sec(8, '答题引擎'));
    // 答题检测状态（v4.19.1 新增）：跨同源 iframe 聚合信号灯/检测状态——答题引擎常跑在 doHomeWorkNew
    // 嵌套 iframe 内，顶层壳页直接读不到；按 fp 去重（子帧灯已跨帧合并进顶层时只计一次）。
    bestEffort(function () {
      var _la = { done: 0, fail: 0, busy: 0, idle: 0, blocked: 0, special: 0, missing: 0, mo: false, auto: true, imgSkip: 0, mirrorMs: -1 }, _seenFp = {};
      var _frameOv = [];   // v4.19.49：各帧答题概览（扫/答/重扫/宽限）——信号灯=0 时仍能看到每帧扫描情况，定位「没扫到 vs 扫到没答」
      var _fr2 = _cxAllFrames();
      for (var _li = 0; _li < _fr2.length; _li++) {
        try {
          var _lw = _fr2[_li].__CX_FORCE_PLAY;
          if (!_lw) continue;
          // v4.19.35：统计「截图跳过(仅文本)」题数——判断题等无图输入问题据此定位（截图为空白/视口外/CDN 失败时 imgSkipped=true）
          if (_lw.quizAiDiag) {
            for (var _dk2 in _lw.quizAiDiag) {
              if (!Object.prototype.hasOwnProperty.call(_lw.quizAiDiag, _dk2)) continue;
              var _le2 = _lw.quizAiDiag[_dk2];
              if (_le2 && _le2.last && _le2.last.imgSkipped === true) _la.imgSkip++;
            }
          }
          if (_lw.quizLights) {
            for (var _lj = 0; _lj < _lw.quizLights.length; _lj++) {
              var _lfp = _lw.quizLights[_lj].fp;
              if (_lfp && _seenFp[_lfp]) continue;
              if (_lfp) _seenFp[_lfp] = true;
              var _ls = _lw.quizLights[_lj].state;
              if (_ls === 'done') _la.done++; else if (_ls === 'fail') _la.fail++; else if (_ls === 'busy') _la.busy++; else if (_ls === 'blocked') _la.blocked++; else if (_ls === 'special') _la.special++; else if (_ls === 'missing') _la.missing++; else _la.idle++;
            }
          }
          // v4.19.9：应答端镜像灯（DeepSeek 页 quizLightsRemote）并入统计
          if (_lw.quizLightsRemote && _lw.quizLightsRemote.length) {
            // v4.19.46：记录镜像写入时间（课程页侧 ts），诊断标注「镜像=Ns前」防陈旧残留误导
            var _mirTs = _lw.quizLightsRemoteTs || 0;
            if (_mirTs && (_la.mirrorMs < 0 || (Date.now() - _mirTs) < _la.mirrorMs)) _la.mirrorMs = Date.now() - _mirTs;
            for (var _lr = 0; _lr < _lw.quizLightsRemote.length; _lr++) {
              var _lrp = _lw.quizLightsRemote[_lr].fp;
              if (_lrp && _seenFp[_lrp]) continue;
              if (_lrp) _seenFp[_lrp] = true;
              var _ls2 = _lw.quizLightsRemote[_lr].state;
              if (_ls2 === 'done') _la.done++; else if (_ls2 === 'fail') _la.fail++; else if (_ls2 === 'busy') _la.busy++; else if (_ls2 === 'blocked') _la.blocked++; else if (_ls2 === 'special') _la.special++; else if (_ls2 === 'missing') _la.missing++; else _la.idle++;
            }
          }
          // v4.19.49：MO 判定改用闭包内 `_quizSchedStats().moMounted`（真实 MO 是否存在），
          // 旧判定依赖 window.__CX_FORCE_PLAY.quizObserve 导出——部分帧加载时序/卸载可能导致全部帧
          // 均读不到而显示「MO=未挂载」伪信号（实测真机诊断 MO=未挂载 与调度器行 MO=已挂载 自相矛盾）。
          if (!_la.mo && typeof _lw._quizSchedStats === 'function') {
            try { var _sdF = _lw._quizSchedStats(); if (_sdF && _sdF.moMounted) _la.mo = true; } catch (e) {}
          }
          if (typeof _lw.quizObserve === 'function') _la.mo = true;   // 回退：window 导出判定
          if (typeof _lw.quizAutoStartOn === 'function') { try { _la.auto = !!_lw.quizAutoStartOn(); } catch (e) {} }
          // 各帧答题概览收集（扫/答/重扫/宽限/待确认）——无灯时也输出，定位「题目从未被扫描」vs「扫到但未作答」
          try {
            var _stF = _lw.quizStats ? { s: _lw.quizStats.scanned, a: _lw.quizStats.answered, e: _lw.quizStats.lastEvict } : null;
            var _scF = (typeof _lw._quizSchedStats === 'function') ? _lw._quizSchedStats() : null;
            if (_stF || _scF) _frameOv.push({ stats: _stF, sched: _scF });
          } catch (e2) {}
        } catch (e) {}
      }
      // v4.19.50 兜底：以「本帧调度器 _quizSchedStats」为 MO 权威（与调度器行同源同帧、永不矛盾）——聚合遍历
      // 对部分帧读取失败（加载时序/跨域帧访问抛错被吞）时，本帧值仍保证「MO=未挂载 vs 调度器=已挂载」不一致不可能出现。
      // 各帧答题概览同规则：遍历未收集到时用本帧 sched/stats 兜底，保证诊断行恒输出。
      try {
        var _selfSc = window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY._quizSchedStats === 'function' ? window.__CX_FORCE_PLAY._quizSchedStats() : null;
        if (_selfSc && _selfSc.moMounted) _la.mo = true;
        if (!_frameOv.length && _selfSc) {
          var _stSelf = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizStats) ? { s: window.__CX_FORCE_PLAY.quizStats.scanned, a: window.__CX_FORCE_PLAY.quizStats.answered, e: window.__CX_FORCE_PLAY.quizStats.lastEvict } : null;
          if (_stSelf || _selfSc) _frameOv.push({ stats: _stSelf, sched: _selfSc });
        }
      } catch (e3b) {}
      var _ln = _la.done + _la.fail + _la.busy + _la.idle + _la.blocked + _la.special + _la.missing;
      // v4.19.46：应答端页标注镜像新鲜度——镜像=Ns前 表示课程页最后写入灯的时间（陈旧残留一眼可辨）
      var _mirTxt = (_la.mirrorMs >= 0) ? (' · 镜像=' + Math.round(_la.mirrorMs / 1000) + 's前') : '';
      var _line = '答题: 信号灯=' + _ln + ' (绿' + _la.done + ' 黄' + _la.busy + ' 红' + _la.fail + ' 紫' + _la.blocked + ' 蓝' + _la.special + ' 橙' + _la.missing + ' 黑' + _la.idle + ') · 自动启动=' + (_la.auto ? '开' : '关') + ' · MO=' + (_la.mo ? '已挂载' : '未挂载') + _mirTxt + (_la.imgSkip ? (' · 截图跳过=' + _la.imgSkip) : '');
      // v4.19.29·出清系统：最近一次自动答题缓存出清（原因/时间）直接可见，便于确认「换视频/换课已出清」生效
      try {
        var _ev = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizStats && window.__CX_FORCE_PLAY.quizStats.lastEvict) || null;
        if (_ev) L.push('  答题缓存出清=' + _ev.reason + ' · ' + (Math.round((Date.now() - _ev.ts) / 1000) + 's前') + ' · 清除' + (_ev.cleared || 0) + '项');
      } catch (e) {}
      L.push('');
      L.push('■ 数据治理（桶）');
      // v4.19.30·统一数据治理：一处查看所有数据桶（分类/大小/最近一次出清原因）
      try {
        var _dg = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.dataGovernance);
        if (_dg && typeof _dg.snapshot === 'function') {
          var _snap = _dg.snapshot();
          if (_snap && _snap.length) {
            var _parts = _snap.map(function (b) {
              var _le = b.lastEvict ? ('·' + (Math.round((Date.now() - b.lastEvict.ts) / 1000)) + 's前(' + b.lastEvict.reason + ')') : '';
              return b.id + ':' + (b.size || 0) + _le;
            });
            L.push('数据治理: ' + _snap.length + ' 桶 · ' + _parts.join(' '));
          }
        }
      } catch (e) {}
      // v4.19.2：子帧答题 tick 遥测（随信号灯广播上报：扫描/作答/异常）——答题中断原因直接可见
      var _rt = null;
      try { var _tns = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizRemoteTick) || null; if (_tns) _rt = _tns; } catch (e) {}
      if (_rt) {
        _line += ' · 帧扫=' + (_rt.scanned != null ? _rt.scanned : '?') + ' 答=' + (_rt.answered != null ? _rt.answered : '?');
        if (_rt.ds != null) _line += ' · 帧DS=' + (_rt.ds ? '可用' : '不可用');
        var _sk = _rt.skip;
        if (_sk && (_sk.noOpts || _sk.hold || _sk.popup || _sk.cooldown || _sk.handled || _sk.gate)) {
          _line += ' · 跳过[已答' + (_sk.handled || 0) + ' 冷却' + (_sk.cooldown || 0) + ' 弹窗' + (_sk.popup || 0) + ' 挂起' + (_sk.hold || 0) + ' 无选项' + (_sk.noOpts || 0) + ' 门控' + (_sk.gate || 0) + ']';
        }
        if (_rt.err) _line += ' · 帧错=' + String(_rt.err).slice(0, 90);
      }
      // v4.19.49：各帧答题概览独立一行——信号灯=0/无帧遥测广播时，仍可判断「题目从未被扫描(牌选择器未命中/iframe 未注入)」vs「扫到但挂起未答(重扫/宽限/待确认)」
      if (_frameOv.length) {
        var _fv = _frameOv.map(function (f, idx) {
          var t = '';
          if (f.stats) t = '扫' + (f.stats.s || 0) + '/答' + (f.stats.a || 0);
          else if (f.sched && f.sched.handledCount) t = '已处理' + f.sched.handledCount;
          if (f.sched && f.sched.retryTimer) t += (t ? '·' : '') + '重扫中';
          if (f.sched && f.sched.graceUntilMs > 0) t += (t ? '·' : '') + 'DS宽限' + Math.round((f.sched.graceUntilMs || 0) / 1000) + 's';
          if (f.sched && f.sched.pendingSubmit) t += (t ? '·' : '') + '待确认' + f.sched.pendingSubmit;
          if (f.stats && f.stats.e) t += (t ? '·' : '') + '出清' + f.stats.e.reason;
          return '帧' + (idx + 1) + '(' + (t || '无活动') + ')';
        });
        L.push('  各帧答题: ' + _fv.join(' '));
      }
      if (_la.fail > 0) {
        // 首条失败原因：优先取灯上携带的 msg（跨帧/跨页广播自带，不依赖帧可达性），供诊断直接定位根因
        var _fm = '';
        for (var _li2 = 0; _li2 < _fr2.length && !_fm; _li2++) {
          try {
            var _lw2 = _fr2[_li2].__CX_FORCE_PLAY;
            if (!_lw2) continue;
            var _srcLights = (_lw2.quizLightsRemote && _lw2.quizLightsRemote.length) ? _lw2.quizLightsRemote : (_lw2.quizLights || []);
            for (var _lj2 = 0; _lj2 < _srcLights.length && !_fm; _lj2++) {
              var _l2 = _srcLights[_lj2];
              if (_l2.state === 'fail' && _l2.msg) _fm = String(_l2.msg);
            }
          } catch (e) {}
        }
        if (_fm) _line += ' · 首错=' + _fm.slice(0, 90);
      }
      L.push(_line);
    }, 'diag.quizLights');
