  // ===== DOMAIN: ui/diagnostics (diagnostics + blackbox) =====
  function buildDiagnostics() {                    // 一键反馈：汇总共全部状态/开关/标志为文本
    var L = [];
    L.push('=== 学习通·强制续播 诊断信息 ===');
    L.push('版本: ' + SCRIPT_VERSION + ' · 时间: ' + new Date().toLocaleString());
    var vs = allVideos();
    L.push('视频总数: ' + vs.length + ' · moQueue: ' + _moQueue.length + ' · ENDED_SRCS: ' + Object.keys(ENDED_SRCS).length);
    var _rec = recentErrors(3);
    L.push('错误累计: ' + errorCount() + ' · 最近(tag): ' + (_rec.length ? _rec.map(function (r) { return r.tag; }).join(',') : '无'));
    var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    L.push('heap: ' + (m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB / ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a'));
    L.push('桥: ' + (BRIDGE && BRIDGE.base ? ('已连 ' + BRIDGE.base) : '离线') + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter));
    L.push('定向: enabled=' + (TARGET && TARGET.enabled) + ' matchedAny=' + (TARGET && TARGET.matchedAny) + ' 0命中连击=' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS);
    L.push('CONFIG: AUTO_STOP_MIN=' + CONFIG.AUTO_STOP_MIN + ' RESUME_AFTER_MIN=' + CONFIG.RESUME_AFTER_MIN + ' RESCAN_INTERVAL=' + CONFIG.RESCAN_INTERVAL + ' END_RELEASE_SEC=' + CONFIG.END_RELEASE_SEC + ' LOOP_PLAY=' + CONFIG.LOOP_PLAY + ' SINGLE_VIDEO=' + CONFIG.SINGLE_VIDEO + ' NINJA=' + CONFIG.NINJA_MODE + ' PAUSE_HOTKEY=' + CONFIG.PAUSE_HOTKEY + ' DEBUG=' + DEBUG);
    var fg = foregroundVideo();
    L.push('前台(可见·面积最大): ' + (fg ? ('#' + (vs.indexOf(fg) + 1)) : '无(无可见视频→本帧不强制续播)'));
    L.push('=== 视频列表(' + vs.length + ') ===');
    for (var i = 0; i < vs.length; i++) {
      try {
        var v = vs[i];
        var st = v.ended ? 'ended' : (v.paused ? 'paused' : 'playing');
        L.push('#' + (i + 1) + (v === fg ? '★前台' : '') + ' ' + st +
          ' rate=' + v.playbackRate + ' loop=' + v.loop +
          ' ForcePaused=' + !!v.__cxForcePaused + ' UserPaused=' + !!v.__cxUserPaused +
          ' Released=' + !!cxState(v).released + ' EndedLock=' + !!v.__cxEndedLock +
          ' 原生pause=' + !!v.__np + ' nearEnd=' + nearEnd(v) + ' keep=' + !!cxState(v).userKeep +
          ' 进度=' + fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? '/' + fmtTime(v.duration) : '') +
          ' 已看=' + ((cxState(v).watchMs || 0) / 60000).toFixed(1) + 'min' +
          ' isRebuildFinished=' + isRebuildFinished(v) +
          ' src=' + shortSrc(v));
      } catch (e) { swallow(e); }
    }
    return L.join('\n');
  }
  function copyDiagnostics() {
    var txt = buildDiagnostics();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { Store.emit('ui:toast', '已复制诊断信息'); }, function () { fallbackCopy(txt); });
      } else fallbackCopy(txt);
    } catch (e) { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {                     // 非安全上下文/剪贴板 API 不可用时的降级
    try {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px';
      if (document.body) { document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      Store.emit('ui:toast', '已复制诊断信息');
    } catch (e2) { Store.emit('ui:toast', '复制失败，请手动复制'); }
  }
