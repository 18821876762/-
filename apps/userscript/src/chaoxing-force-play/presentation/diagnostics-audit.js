// @requires: BRIDGE, CONFIG, SAFETY, _loopTicks, _loopTimer, allVideos, bestEffort, detectSite, foregroundVideo, safeGet
// @source-group: presentation/diagnostics.js
// @continuation-of: presentation/diagnostics.js
// Invasion inventory and feature self-test report builders.
  // ===== 安全审计（建议#10）：实时侵入点盘点 =====
  // 仅读取可观测事实（全局符号 / 注入 DOM id / prototype 包装特征 / mediaSession 钩子标志 / localStorage），
  // 不修改任何运行状态。供面板「系统」页透明展示脚本当前的全局侵入面，落实审计透明化诉求。
  var _CX_AUDIT_GLOBALS = ['__CX_FORCE_PLAY', '__cxRegisterAddon', '__cxRegisterCommand', '__cxUI', '__cxAddonQueue'];
  var _CX_AUDIT_DOM_IDS = ['__cxPanel', '__cxPanelNinjaStyle', '__cxPanelAnimStyle', '__cxPanelMobileStyle', '__cxToast'];
  function _cxAuditDomPresent(id) {
    var _present = false;
    bestEffort(function () {
      if (document.getElementById(id)) { _present = true; return; }
      if (window.top && window.top !== window && window.top.document && window.top.document.getElementById(id)) { _present = true; return; }
    }, 'diag.auditDom');
    return _present;
  }
  // v4.19.51：forcePaused 已改 Symbol，两版原型体函数源码均不再含 '__cxForcePaused' 字面量，
  //   字串扫描判据恒为 false 会「撒谎」，故统一改为引用/行为探测（两种模式一致，不再按 POLITE_MODE 分叉）。
  function _cxAuditProtoPause() {
    try {
      var n = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getPauseNeutralized === 'function') ? window.__CX_FORCE_PLAY.getPauseNeutralized() : null;
      return !!n;   // true=中性化在位；false=被还原；null(未装原型)→false
    } catch (e) { return false; }
  }
  function _cxAuditProtoRate() {
    try {
      var n = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getRateNeutralized === 'function') ? window.__CX_FORCE_PLAY.getRateNeutralized() : null;
      return !!n;
    } catch (e) { return false; }
  }
  function _cxAuditMediaSession() {
    return safeGet(function () { return !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._mediaSessionHooked); }, false);
  }
  function _cxAuditUninstallHook() {
    return safeGet(function () { return !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._uninstallHooked); }, false);
  }
  function _cxAuditLsKeys() {
    var ks = [];
    bestEffort(function () { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('cx_') === 0) ks.push(k); } }, 'diag.lsKeys');
    return ks;
  }
  // 返回结构化清单：[{area, item, on, detail}] —— on=true 表示当前已侵入/已接管
  function buildInvasionReport() {
    var rows = [];
    function add(area, item, on, detail) { rows.push({ area: area, item: item, on: !!on, detail: detail || (on ? item : '未启用/已还原') }); }
    var g = [], i;
    for (i = 0; i < _CX_AUDIT_GLOBALS.length; i++) { (function (gi) { if (safeGet(function () { return typeof window[gi]; }, 'undefined') !== 'undefined') g.push(gi); })(_CX_AUDIT_GLOBALS[i]); }
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
    add('安全', '安全停机 SAFETY_STOP_ON_CHALLENGE=' + CONFIG.SAFETY_STOP_ON_CHALLENGE, CONFIG.SAFETY_STOP_ON_CHALLENGE,
      (typeof SAFETY !== 'undefined' && SAFETY.tripped) ? ('⛔ 已停机：' + SAFETY.reason) : '未触发（检测到验证码/风控将自动停机并提示）');
    var _tkActive = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.isTakeoverActive === 'function') ? window.__CX_FORCE_PLAY.isTakeoverActive() : (CONFIG.ENABLED !== false);
    add('接管', '接管开关 ENABLED=' + CONFIG.ENABLED + ((CONFIG.DISABLED_COURSES && CONFIG.DISABLED_COURSES.length) ? ' · 黑名单=' + CONFIG.DISABLED_COURSES.join(',') : ''), _tkActive,
      _tkActive ? '运行中（续播 + 自动答题已启用）' : (CONFIG.ENABLED === false ? '已全局关闭（仅留面板/诊断）' : '当前课程在黑名单：已停用续播/答题'));
    return rows;
  }
  // ── 开发者模式：功能自检矩阵（RQ 验证 / 实现盘点）────────────────
  // 由 /dev 命令触发；报告"各项功能是否实现"的状态矩阵。
  // 探测 window.__CX_FORCE_PLAY 公开 API + 本模块 in-scope 内部审计函数（中性化/钩子/统计），
  // C1 防御：纯只读探测，不修改任何状态；所有访问经 safeGet 包裹，单点失败不影响整体。
  function buildFeatureSelfTest() {
    return safeGet(function () {
      var fp = window.__CX_FORCE_PLAY || {};
      var site = (typeof detectSite === 'function') ? detectSite() : '?';
      var rows = [];
      function mk(group, name, status, detail) { rows.push({ group: group, name: name, status: status, detail: detail || '' }); }
      function has(name) { return typeof fp[name] === 'function'; }
      var ok = 0, partial = 0, na = 0, fail = 0, total = 0;
      function tally(s) { if (s === 'ok') ok++; else if (s === 'partial') partial++; else if (s === 'na') na++; else fail++; total++; }

      // 核心续播引擎
      mk('核心续播', '站点识别 detectSite', has('detectSite') ? 'ok' : 'fail', has('detectSite') ? ('当前站点=' + site) : '未导出公开 API');
      mk('核心续播', '主循环 runSiteTick/restartLoopTimer', (has('runSiteTick') && has('restartLoopTimer')) ? 'ok' : 'fail',
        '循环' + (_loopTimer ? '运行中' : '已停') + ' · 轮次=' + (_loopTicks || 0));
      mk('核心续播', '视频接管 allVideos/foregroundVideo', (typeof allVideos === 'function' && typeof foregroundVideo === 'function') ? 'ok' : 'fail',
        '视频数=' + (typeof allVideos === 'function' ? allVideos().length : '?'));
      // 无视频页(如 DeepSeek 应答端)原型从未被接管属正常，判 na 而非 fail，避免误报
      var _hasVideo = (typeof allVideos === 'function' && allVideos().length > 0);
      mk('核心续播', '原型 pause 中性化', _hasVideo ? (_cxAuditProtoPause() ? 'ok' : 'fail') : 'na', _hasVideo ? (_cxAuditProtoPause() ? '已接管' : '未中性化') : '无视频·不适用');
      mk('核心续播', '原型 rate 中性化', _hasVideo ? (_cxAuditProtoRate() ? 'ok' : 'fail') : 'na', _hasVideo ? (_cxAuditProtoRate() ? '已接管' : '未中性化') : '无视频·不适用');
      mk('核心续播', 'mediaSession 接管', _hasVideo ? (_cxAuditMediaSession() ? 'ok' : 'fail') : 'na', _hasVideo ? (_cxAuditMediaSession() ? '已接管' : '否') : '无视频·不适用');
      mk('核心续播', '卸载钩子 uninstall-hook', _cxAuditUninstallHook() ? 'ok' : 'fail', _cxAuditUninstallHook() ? '已挂' : '否');

      // 播放控制命令
      var cmdApi = (typeof window.__cxRegisterCommand === 'function');
      mk('播放控制', '命令注册契约 __cxRegisterCommand', cmdApi ? 'ok' : 'fail', cmdApi ? '已挂载到 window' : '未挂载');
      if (typeof fp.listCommands === 'function') {
        var cmds = fp.listCommands();
        mk('播放控制', '内置命令集', cmds.length ? 'ok' : 'fail', '共 ' + cmds.length + ' 条：' + cmds.join(' / '));
      } else {
        mk('播放控制', '内置命令集', 'partial', 'commands.js 未暴露 listCommands');
      }

      // 站点答题引擎
      mk('站点答题', '当前站点配置 currentSiteCfg', has('currentSiteCfg') ? 'ok' : 'fail', '站点=' + site);
      mk('站点答题', '弹窗作答 popupQuizTick', has('popupQuizTick') ? 'ok' : 'fail', has('popupQuizTick') ? '已暴露（多平台/超星弹窗）' : '未导出');
      // 非智慧树站本就不导出该 API，判 na 而非 fail；仅当前站点且未导出才 fail
      mk('站点答题', '智慧树作业/考试 zhihuishuExam', site === 'zhihuishu' ? (has('zhihuishuExamEnabled') ? 'ok' : 'fail') : 'na',
        site === 'zhihuishu' ? (has('zhihuishuExamEnabled') ? '当前站点已启用' : '未导出') : '非当前站点(不适用)');
      mk('站点答题', '超星作业/考试 chaoxingTickQuiz', has('chaoxingTickQuiz') ? (site === 'chaoxing' ? 'ok' : 'na') : 'fail',
        has('chaoxingTickQuiz') ? (site === 'chaoxing' ? '已暴露并调度（走通用 quizTick 引擎）' : '已暴露但非当前站点(不适用)') : '未导出 chaoxingTickQuiz');

      // DeepSeek 视觉后端
      var dsOnPage = (site === 'deepseek');
      mk('DeepSeek 后端', '应答端登录态 _dsIsLoggedIn', has('_dsIsLoggedIn') ? (dsOnPage ? 'ok' : 'na') : 'fail',
        has('_dsIsLoggedIn') ? (dsOnPage ? '本页探测器可用' : '非应答端页(不适用)') : '未导出');
      mk('DeepSeek 后端', '跨页可用 dsAvailable', has('dsAvailable') ? (dsOnPage ? 'na' : 'ok') : 'fail',
        has('dsAvailable') ? (dsOnPage ? '应答端本页恒 false(设计如此)' : '课程页可探测') : '未导出');
      mk('DeepSeek 后端', '应答端开关 DS_RESPONDER_ENABLED', (fp.DS_RESPONDER_ENABLED === false ? 'partial' : 'ok'),
        '当前=' + (fp.DS_RESPONDER_ENABLED === false ? '关' : '开'));
      mk('DeepSeek 后端', '视觉识别(CONFIG) quiz-vision', (CONFIG.QUIZ_VISION_ENABLED ? 'ok' : 'partial'),
        'QUIZ_VISION_ENABLED=' + (CONFIG.QUIZ_VISION_ENABLED ? '开' : '关') + ' · OCR=' + (CONFIG.QUIZ_VISION_OCR || ('endpoint:' + (CONFIG.QUIZ_VISION_ENDPOINT || '?'))));
      mk('DeepSeek 后端', '截图还原 quizRecover', has('quizRecover') ? 'ok' : 'fail', has('quizRecover') ? '已暴露' : '未导出');

      // 工具库项
      var addonCnt = (typeof _cxAddons !== 'undefined' && _cxAddons) ? (Array.isArray(_cxAddons) ? _cxAddons.length : Object.keys(_cxAddons).length) : 0;
      mk('工具库项', '已接入工具库项', addonCnt ? 'ok' : 'partial', addonCnt ? ('共 ' + addonCnt + ' 项') : '无（仅核心脚本）');

      // 通信桥
      mk('通信桥', 'BRIDGE 连接', (BRIDGE && BRIDGE.base) ? 'ok' : 'partial', (BRIDGE && BRIDGE.base) ? ('已连 ' + BRIDGE.base) : '离线');
      mk('通信桥', '工具库 toolkit.bridge', (fp.toolkit && fp.toolkit.bridge) ? 'ok' : 'partial', (fp.toolkit && fp.toolkit.bridge) ? '已加载' : '未加载');

      // 诊断/审计
      mk('诊断审计', '侵入点盘点 buildInvasionReport', has('buildInvasionReport') ? 'ok' : 'fail', '已暴露');
      mk('诊断审计', '功能自检 buildFeatureSelfTest', has('buildFeatureSelfTest') ? 'ok' : 'fail', '已暴露（本函数）');

      // 配置持久化
      var lsKeys = _cxAuditLsKeys();
      mk('配置持久化', 'localStorage cx_* 键', lsKeys.length ? 'ok' : 'partial', lsKeys.length ? (lsKeys.length + ' 个键') : '无');

      for (var ri = 0; ri < rows.length; ri++) tally(rows[ri].status);
      return {
        generatedAt: Date.now(),
        site: site,
        summary: { ok: ok, partial: partial, na: na, fail: fail, total: total },
        rows: rows
      };
    }, { summary: { ok: 0, partial: 0, na: 0, fail: 0, total: 0 }, rows: [], site: '?', generatedAt: 0 });
  }

  // 开发者模式统一报告：功能自检矩阵 + 实时诊断信息，二者联动（/dev 命令 + 面板一键复制共用单一事实源）
  // RQ：让"功能是否实现"与"当前运行时真实状态"在一处对照，避免矩阵与诊断信息割裂、各自独立看易误读（如 dsAvailable=false 需结合诊断的跨域说明）。
  function buildDevReport() {
    var selfTest = safeGet(function () { return buildFeatureSelfTest(); }, null);
    var diag = safeGet(function () { return buildDiagnostics(); }, '');
    return { generatedAt: Date.now(), selfTest: selfTest, diagnostics: diag };
  }
  function buildDevReportText() {
    var r = buildDevReport();
    var L = [];
    L.push('=== 开发者自检报告（功能矩阵 + 诊断信息联动）===');
    L.push('生成时间: ' + new Date(r.generatedAt).toLocaleString());
    if (r.selfTest && r.selfTest.summary) {
      var s = r.selfTest.summary;
      L.push('--- 功能自检矩阵(' + r.selfTest.site + ')：已实现 ' + s.ok + ' · 部分 ' + s.partial + ' · 不适用 ' + s.na + ' · 失败 ' + s.fail + ' ---');
      for (var i = 0; i < r.selfTest.rows.length; i++) {
        var row = r.selfTest.rows[i];
        L.push('[' + row.status + '] ' + row.group + ' · ' + row.name + ' — ' + row.detail);
      }
    }
    L.push('');
    L.push('--- 诊断信息（与自检矩阵联动）---');
    L.push(r.diagnostics || '(诊断信息生成失败)');
    return L.join('\n');
  }
  bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildInvasionReport = buildInvasionReport; }, 'diag.export');   // 暴露为公开 API（面板审计/测试可调用）
  bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildFeatureSelfTest = buildFeatureSelfTest; }, 'diag.export');
  bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildDevReport = buildDevReport; }, 'diag.export');
  bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildDevReportText = buildDevReportText; }, 'diag.export');
