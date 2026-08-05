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

  // ===== 安全审计（建议#10）：实时侵入点盘点 =====
  // 仅读取可观测事实（全局符号 / 注入 DOM id / prototype 包装特征 / mediaSession 钩子标志 / localStorage），
  // 不修改任何运行状态。供面板「系统」页透明展示脚本当前的全局侵入面，落实审计透明化诉求。
  var _CX_AUDIT_GLOBALS = ['__CX_FORCE_PLAY', '__cxRegisterAddon', '__cxRegisterCommand', '__cxUI', '__cxAddonQueue'];
  var _CX_AUDIT_DOM_IDS = ['__cxPanel', '__cxPanelNinjaStyle', '__cxPanelAnimStyle', '__cxPanelMobileStyle', '__cxToast'];
  function _cxAuditDomPresent(id) {
    try {
      if (document.getElementById(id)) return true;
      if (window.top && window.top !== window && window.top.document && window.top.document.getElementById(id)) return true;
    } catch (e) { swallow(e); }
    return false;
  }
  function _cxAuditProtoPause() {   // 包装函数体内引用了 __cxForcePaused 标记（属性名不被压缩，可稳定探测）
    try { return String(HTMLMediaElement.prototype.pause).indexOf('__cxForcePaused') >= 0; } catch (e) { return false; }
  }
  function _cxAuditProtoRate() {
    try { var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate'); return !!(d && d.set && String(d.set).indexOf('__cxForcePaused') >= 0); } catch (e) { return false; }
  }
  function _cxAuditMediaSession() {
    try { return !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._mediaSessionHooked); } catch (e) { return false; }
  }
  function _cxAuditUninstallHook() {
    try { return !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._uninstallHooked); } catch (e) { return false; }
  }
  function _cxAuditLsKeys() {
    var ks = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('cx_') === 0) ks.push(k); } } catch (e) { swallow(e); }
    return ks;
  }
  // 返回结构化清单：[{area, item, on, detail}] —— on=true 表示当前已侵入/已接管
  function buildInvasionReport() {
    var rows = [];
    function add(area, item, on, detail) { rows.push({ area: area, item: item, on: !!on, detail: detail || (on ? item : '未启用/已还原') }); }
    var g = [], i;
    for (i = 0; i < _CX_AUDIT_GLOBALS.length; i++) { try { if (typeof window[_CX_AUDIT_GLOBALS[i]] !== 'undefined') g.push(_CX_AUDIT_GLOBALS[i]); } catch (e) { swallow(e); } }
    add('全局符号', 'window 导出(namespace+副脚本契约)', g.length > 0, g.length ? g.join(', ') : '无');
    var d = [];
    for (i = 0; i < _CX_AUDIT_DOM_IDS.length; i++) { if (_cxAuditDomPresent(_CX_AUDIT_DOM_IDS[i])) d.push(_CX_AUDIT_DOM_IDS[i]); }
    add('注入 DOM', '面板/style/Toast 节点', d.length > 0, d.length ? d.join(', ') : '无');
    add('prototype.pause', 'HTMLMediaElement.prototype.pause 包装(抗平台还原)', _cxAuditProtoPause());
    add('prototype.playbackRate', 'playbackRate setter 包装', _cxAuditProtoRate());
    add('navigator.mediaSession', 'pause handler 已接管(卸载还原)', _cxAuditMediaSession());
    add('事件监听', 'pagehide/beforeunload 卸载钩子', _cxAuditUninstallHook());
    var ls = _cxAuditLsKeys();
    add('localStorage', 'cx_* 配置键(' + ls.length + ')', ls.length > 0, ls.length ? ls.slice(0, 8).join(', ') + (ls.length > 8 ? ' …' : '') : '无');
    return rows;
  }
  try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildInvasionReport = buildInvasionReport; } catch (e) { swallow(e); }   // 暴露为公开 API（面板审计/测试可调用）
