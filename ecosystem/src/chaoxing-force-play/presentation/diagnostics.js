  // ===== DOMAIN: presentation/diagnostics (diagnostics + blackbox) =====
  function buildDiagnostics() {                    // 一键反馈：汇总共全部状态/开关/标志为文本
    var L = [];
    L.push('=== 网课强制续播 诊断信息 ===');
    L.push('版本: ' + SCRIPT_VERSION + ' · 时间: ' + new Date().toLocaleString() + ' · 站点: ' + (typeof detectSite === 'function' ? detectSite() : '?'));
    // 运行环境（诊断#八）：用户脚本管理器 / GM 存储授权 / 页面可见性(后台节流影响续播与计时) / 窗口层级 / readyState / 持久化键数
    L.push('环境: ' + (typeof GM_info !== 'undefined' && GM_info.scriptHandler ? GM_info.scriptHandler : 'n/a') +
      ' · GM存储=' + (typeof GM_setValue === 'function' ? '已授权' : '未授权') +
      ' · 可见性=' + (typeof document !== 'undefined' ? document.visibilityState : '?') +
      ' · 窗口=' + (window === window.top ? '顶层' : 'iframe嵌套') +
      ' · ready=' + (typeof document !== 'undefined' ? document.readyState : '?') +
      ' · 持久化键=' + (_cxAuditLsKeys ? _cxAuditLsKeys().length : '?'));
    var vs = allVideos();
    L.push('视频总数: ' + vs.length + ' · moQueue: ' + _moQueue.length + ' · ENDED_SRCS: ' + Object.keys(ENDED_SRCS).length);
    var _rec = recentErrors(3);
    L.push('错误累计: ' + errorCount() + ' · 最近(3): ' + (_rec.length ? _rec.map(function (r) {
      var _t = r.tag || '?'; var _m = ('' + (r.msg || '')).replace(/\s+/g, ' ').slice(0, 48);
      return _t + (_m ? ':' + _m : '');
    }).join(' | ') : '无'));
    // 评审#1：DEBUG 下暴露最近被吞错误的 msg+stack（来自 swallow 写入的 _errBuf 遥测），便于根因诊断
    if (DEBUG && _rec.length) {
      for (var _ri = 0; _ri < _rec.length; _ri++) {
        var _r = _rec[_ri];
        var _line = '  ↳[' + _r.tag + '] ' + (_r.msg || '?');
        if (_r.stack) {
          var _st = String(_r.stack).split('\n');
          if (_st.length > 1) _line += '\n    ' + _st.slice(1, 4).join('\n    ');   // 跳过首行(与 msg 重复)，仅显示调用栈
        }
        L.push(_line);
      }
    }
    var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    L.push('heap: ' + (m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB / ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a'));
    L.push('桥: ' + (BRIDGE && BRIDGE.base ? ('已连 ' + BRIDGE.base) : '离线') + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter) + ' · 桥版本=' + (BRIDGE && BRIDGE.version ? BRIDGE.version : '?'));
    L.push('定向: enabled=' + (TARGET && TARGET.enabled) + ' matchedAny=' + (TARGET && TARGET.matchedAny) + ' 0命中连击=' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS);
    // DeepSeek 应答端（视觉后端）状态——分"课程页(靠跨页广播)"与"应答端(同页DOM探测)"两场景，直接点出跨域不可达根因
    var _f = window.__CX_FORCE_PLAY;
    if (_f && _f.DS_STATUS) {
      var _ds = _f.DS_STATUS;
      var _site = (typeof detectSite === 'function') ? detectSite() : '?';
      if (_site === 'deepseek') {
        // 应答端自身：直接用本页 DOM 探测登录态，不走跨页通道
        var _li = (typeof _f._dsIsLoggedIn === 'function') ? _f._dsIsLoggedIn() : undefined;
        var _liTxt = _li === true ? '已登录' : (_li === false ? '未登录' : '未知(选择器待校准)');
        L.push('DeepSeek[应答端]: 本页探测=' + _liTxt + ' · 广播周期=5s');
      } else {
        // 课程页：依赖跨页 BroadcastChannel（同源隔离→跨域永远收不到）
        var _got = !!_ds.ts;
        var _dsLogin = _ds.loggedIn === true ? '已登录' : (_ds.loggedIn === false ? '未登录' : '未知');
        L.push('DeepSeek[课程页]: 收到跨页广播=' + _got + (_got ? (' connected=' + _ds.connected + ' loggedIn=' + _dsLogin) : ' → 同源BroadcastChannel跨域不可达，课程页收不到DeepSeek已登录'));
      }
      L.push('  应答端开关=' + (_f.DS_RESPONDER_ENABLED === false ? '关' : '开') + ' · dsAvailable=' + (typeof _f.dsAvailable === 'function' ? _f.dsAvailable() : 'n/a') + ' · 本机host=' + ((typeof location !== 'undefined' && location.host) || '?'));
      L.push('  最近请求=' + (_f.DS_LAST_ASK ? (Math.round((Date.now() - _f.DS_LAST_ASK) / 1000) + 's前') : '无') + (_f.DS_LAST_ANSWER ? (' · ' + _f.DS_LAST_ANSWER) : ''));
    }
    // 主循环健康（诊断#七）：确认续播调度仍在跑，避免"看起来没接管"却不知循环已停
    L.push('主循环: ' + (_loopTimer ? '运行中' : '已停') + ' · 已运行轮次=' + (_loopTicks || 0) + ' · 周期=' + CONFIG.RESCAN_INTERVAL + 's' + (_loopLastTick ? (' · 上次tick=' + Math.round((Date.now() - _loopLastTick) / 1000) + 's前') : ' · 上次tick=未运行'));
    // 工具库项（插件）注册清单：列出已接入的工具库项及其开关态，便于确认是否漏装/误关
    if (typeof _cxAddons !== 'undefined' && _cxAddons) {
      var _adIds = Object.keys(_cxAddons);
      if (_adIds.length) {
        var _adTxt = _adIds.map(function (id) {
          var _a = _cxAddons[id];
          var _on = (_a && _a.type === 'toggle') ? ((_a.get && _a.get()) ? '开' : '关') : (_a ? _a.type : '?');
          return id + '(' + _on + ')';
        }).join(', ');
        L.push('工具库项(' + _adIds.length + '): ' + _adTxt);
      } else {
        L.push('工具库项: 无（未接入任何工具库项）');
      }
    }
    // 面板与场景状态
    L.push('面板: ' + (_cxPanel ? (_cxPanel.style.display !== 'none' ? '可见' : '隐藏') : '未创建') + ' · 站点=' + (typeof detectSite === 'function' ? detectSite() : '?'));
    // 脚本弹窗（静默）状态：关闭后一切提示仅进洞察页，不再悬浮
    L.push('脚本弹窗: ' + ((typeof isQuietPopups === 'function' && isQuietPopups()) ? '已关闭(仅洞察页)' : '开启(悬浮提示)'));
    // 看播统计本地汇总（只读估算，不含平台上报）
    if (typeof _watchStats !== 'undefined' && _watchStats) {
      var _wm = 0, _wk = Object.keys(_watchStats);
      for (var _wi = 0; _wi < _wk.length; _wi++) { _wm += (_watchStats[_wk[_wi]].ms || 0); }
      L.push('看播统计: 累计 ' + (_wm / 60000).toFixed(1) + ' 分钟 · 课程源 ' + _wk.length + ' 个');
    }
    // 接管/隔离盘点（诊断#九）：原型中性化 / 跨 iframe 接管 / mediaSession 是否到位，定位"明明该续播却不动"
    L.push('接管: iframe文档=' + (typeof _playWatchDocs !== 'undefined' && _playWatchDocs ? _playWatchDocs.length : 0) +
      ' · 原型pause中性化=' + (_cxAuditProtoPause() ? '是' : '否') +
      ' · 原型rate中性化=' + (_cxAuditProtoRate() ? '是' : '否') +
      ' · mediaSession=' + (_cxAuditMediaSession() ? '已接管' : '否'));
    // 自动暂停/恢复运行时状态（诊断#十）：阈值与"接近阈值/待恢复"计数，便于核对自动暂停是否按预期生效
    var _pendingResume = 0, _nearAutoStop = 0;
    for (var _ji = 0; _ji < vs.length; _ji++) {
      try {
        var _jv = vs[_ji];
        if (cxState(_jv).resumeAt && Date.now() < cxState(_jv).resumeAt) _pendingResume++;
        if (CONFIG.AUTO_STOP_MIN > 0 && (cxState(_jv).watchMs || 0) >= CONFIG.AUTO_STOP_MIN * 60000 * 0.8) _nearAutoStop++;
      } catch (e) { swallow(e); }
    }
    L.push('自动暂停: 阈值=' + CONFIG.AUTO_STOP_MIN + 'min · 接近阈值=' + _nearAutoStop + ' · 自动恢复: 间隔=' + CONFIG.RESUME_AFTER_MIN + 'min · 待恢复=' + _pendingResume);
    // 智慧树作业/考试助手状态（题目区且已启用时）
    if (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.zhihuishuExamEnabled === 'function' && window.__CX_FORCE_PLAY.zhihuishuExamEnabled() && typeof window.__CX_FORCE_PLAY.zhihuishuExamState === 'function') {
      var _zs = window.__CX_FORCE_PLAY.zhihuishuExamState() || {};
      L.push('智慧树作业/考试: DeepSeek=' + (_zs.ds ? '已连' : '未连') + ' · 作答=' + (_zs.answering ? '进行中' : '未启') + ' · 自动交卷=' + (_zs.asub || '关') + ' · 可交卷=' + (_zs.confirmReady ? '是(待确认)' : '否'));
    }
    L.push('CONFIG: AUTO_STOP_MIN=' + CONFIG.AUTO_STOP_MIN + ' RESUME_AFTER_MIN=' + CONFIG.RESUME_AFTER_MIN + ' RESCAN_INTERVAL=' + CONFIG.RESCAN_INTERVAL + ' END_RELEASE_SEC=' + CONFIG.END_RELEASE_SEC + ' LOOP_PLAY=' + CONFIG.LOOP_PLAY + ' SINGLE_VIDEO=' + CONFIG.SINGLE_VIDEO + ' NINJA=' + CONFIG.NINJA_MODE + ' PAUSE_HOTKEY=' + CONFIG.PAUSE_HOTKEY + ' DEBUG=' + DEBUG + ' INTRUSION_MODE=' + CONFIG.INTRUSION_MODE + ' POLITE_MODE=' + CONFIG.POLITE_MODE);
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
  function _cxAuditProtoPause() {   // #1 礼貌模式原型体 toString 已伪装(不含 '__cxForcePaused')，字串扫描恒 false 会撒谎；故礼貌模式改用行为/引用探测判据
    try {
      if (CONFIG.POLITE_MODE) {
        var n = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getPauseNeutralized === 'function') ? window.__CX_FORCE_PLAY.getPauseNeutralized() : null;
        return !!n;   // true=中性化在位；false=被还原；null(未装原型)→false
      }
      return String(HTMLMediaElement.prototype.pause).indexOf('__cxForcePaused') >= 0;
    } catch (e) { return false; }
  }
  function _cxAuditProtoRate() {
    try {
      if (CONFIG.POLITE_MODE) {
        var n = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getRateNeutralized === 'function') ? window.__CX_FORCE_PLAY.getRateNeutralized() : null;
        return !!n;
      }
      var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      return !!(d && d.set && String(d.set).indexOf('__cxForcePaused') >= 0);
    } catch (e) { return false; }
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
    add('全局符号', 'window 导出(namespace+工具库项契约)', g.length > 0, g.length ? g.join(', ') : '无');
    var d = [];
    for (i = 0; i < _CX_AUDIT_DOM_IDS.length; i++) { if (_cxAuditDomPresent(_CX_AUDIT_DOM_IDS[i])) d.push(_CX_AUDIT_DOM_IDS[i]); }
    add('注入 DOM', '面板/style/Toast 节点', d.length > 0, d.length ? d.join(', ') : '无');
    add('prototype.pause', 'HTMLMediaElement.prototype.pause 包装(抗平台还原)', _cxAuditProtoPause());
    add('prototype.playbackRate', 'playbackRate setter 包装', _cxAuditProtoRate());
    add('navigator.mediaSession', 'pause handler 已接管(卸载还原)', _cxAuditMediaSession());
    add('事件监听', 'pagehide/beforeunload 卸载钩子', _cxAuditUninstallHook());
    var ls = _cxAuditLsKeys();
    add('localStorage', 'cx_* 配置键(' + ls.length + ')', ls.length > 0, ls.length ? ls.slice(0, 8).join(', ') + (ls.length > 8 ? ' …' : '') : '无');
    // #1 温和/礼貌模式：当前入侵策略（透明展示，便于用户核对与 #10 审计协同）
    add('策略', 'INTRUSION_MODE=' + CONFIG.INTRUSION_MODE, CONFIG.INTRUSION_MODE !== 'gentle',
      '原型中性化' + (CONFIG.INTRUSION_MODE === 'gentle' ? '已关（仅实例级·最小侵入）' : (CONFIG.INTRUSION_MODE === 'aggressive' ? '始终启用' : '按站点自适应')));
    add('策略', 'POLITE_MODE=' + CONFIG.POLITE_MODE, CONFIG.POLITE_MODE, CONFIG.POLITE_MODE ? 'pause.toString 伪装·抗检测（行为还原检测）' : '关');
    return rows;
  }
  try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildInvasionReport = buildInvasionReport; } catch (e) { swallow(e); }   // 暴露为公开 API（面板审计/测试可调用）
