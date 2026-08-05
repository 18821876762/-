  // ===== DOMAIN: ui/panel (floating control panel) =====
  // ===== MODULE: 悬浮控制面板 =====
  // 域：UI/面板模块 —— 悬浮控制面板。
  // —— 悬浮控制面板（开关键 = PAUSE_HOTKEY，默认 p）——
  // 集中控制：暂停/恢复、自动停止计时(AUTO_STOP_MIN)、暂停后自动恢复(RESUME_AFTER_MIN)，并实时显示状态。
  // 仅懒创建一次，随状态刷新；不污染页面输入框，Esc/× 关闭。
  var SCRIPT_VERSION = '4.9';   // 与文件头 @version 保持一致（面板与诊断信息显示用）
  // 【共享契约·扇出最大的单例】_cxPanel 是面板根节点，被 7 个模块直接引用，为全项目耦合度最高的变量：
  //   写入方仅 2 处（必须保持）：本文件的显隐/销毁逻辑、ui/panel-core.js 的 ensurePanel 装配完成赋值；
  //   读取方 5 处（只读，勿写）：ui/addons.js、ui/dashboard.js、ui/commands.js、ui/panel-drag.js、bootstrap/main-loop.js。
  // 读取方一律先判空（面板未创建时为 null）。新增写入点前请三思：任何一处误置 null 都会静默影响其余全部读取方。
  var _cxPanel = null;
  var _lastVideoList = [];       // 面板视频列表渲染时缓存的视频引用快照，供点击委托回调定位目标视频（索引稳定）
  // 主从式导航当前激活区块（localStorage 持久化）：面板顶部分区导航，切换下方内容（主控/自动化/洞察/系统）。
  var _cxActiveTab = 'control';
  // v5 IA 重组：旧 tab 值迁移映射（pause→control, sub→automation, adv→insight, other→system），一次性改写后按新值持久化
  var _cxTabMigrate = { pause: 'control', sub: 'automation', adv: 'insight', other: 'system' };
  try {
    var _savedTab = (localStorage.getItem('cx_panel_tab') || 'control');
    if (_cxTabMigrate[_savedTab]) { _savedTab = _cxTabMigrate[_savedTab]; try { localStorage.setItem('cx_panel_tab', _savedTab); } catch (e2) { swallow(e2); } }
    _cxActiveTab = _savedTab;
  } catch (e) { swallow(e); }

  function syncPanelInputs() {                     // 把 CONFIG / 版本 / DEBUG 当前值回填到面板控件
    if (!_cxPanel) return;
    try {
      var auto = _cxPanel.querySelector('#__cxAuto'); if (auto) { auto.value = CONFIG.AUTO_STOP_MIN; _cxPanel.querySelector('#__cxAutoVal').textContent = CONFIG.AUTO_STOP_MIN; }
      var res = _cxPanel.querySelector('#__cxResume'); if (res) { res.value = CONFIG.RESUME_AFTER_MIN; _cxPanel.querySelector('#__cxResumeVal').textContent = CONFIG.RESUME_AFTER_MIN; }
      var resc = _cxPanel.querySelector('#__cxRescan'); if (resc) { resc.value = CONFIG.RESCAN_INTERVAL; _cxPanel.querySelector('#__cxRescanVal').textContent = CONFIG.RESCAN_INTERVAL; }
      var endrel = _cxPanel.querySelector('#__cxEndRel'); if (endrel) { endrel.value = CONFIG.END_RELEASE_SEC; _cxPanel.querySelector('#__cxEndRelVal').textContent = CONFIG.END_RELEASE_SEC; }
      var rateSel = _cxPanel.querySelector('#__cxRate'); if (rateSel) { rateSel.value = ('' + (CONFIG.USER_RATE || 1)); var rv = _cxPanel.querySelector('#__cxRateVal'); if (rv) rv.textContent = (CONFIG.USER_RATE || 1) + 'x'; }
      var tr = _cxPanel.querySelector('#__cxTopRate'); if (tr) tr.textContent = '· ' + (CONFIG.USER_RATE || 1) + 'x';   // 状态条常驻显示当前速率（设计文档 §4.1）
      var dbg = _cxPanel.querySelector('#__cxDebug'); if (dbg) dbg.checked = !!DEBUG;
      var lp = _cxPanel.querySelector('#__cxLoop'); if (lp) lp.checked = !!CONFIG.LOOP_PLAY;
      var sv = _cxPanel.querySelector('#__cxSingleVideo'); if (sv) sv.checked = !!CONFIG.SINGLE_VIDEO;
      var ninja = _cxPanel.querySelector('#__cxNinja'); if (ninja) ninja.checked = !!CONFIG.NINJA_MODE;
      var pw = _cxPanel.querySelector('#__cxPanelW'); if (pw) { pw.value = CONFIG.PANEL_W; var pwv = _cxPanel.querySelector('#__cxPanelWVal'); if (pwv) pwv.textContent = CONFIG.PANEL_W; }
      var ver = _cxPanel.querySelector('#__cxVer'); if (ver) ver.textContent = 'v' + SCRIPT_VERSION;
    } catch (e) { swallow(e); }
  }
  function refreshPanelLabels() {                   // 拖动滑块时实时刷新旁边的数值文字（syncPanelInputs 仅在面板创建时回填一次，否则显示滞后）
    if (!_cxPanel) return;
    try {
      var map = [['#__cxAutoVal', CONFIG.AUTO_STOP_MIN], ['#__cxResumeVal', CONFIG.RESUME_AFTER_MIN], ['#__cxRescanVal', CONFIG.RESCAN_INTERVAL], ['#__cxEndRelVal', CONFIG.END_RELEASE_SEC], ['#__cxPanelWVal', CONFIG.PANEL_W]];
      for (var i = 0; i < map.length; i++) { var n = _cxPanel.querySelector(map[i][0]); if (n) n.textContent = map[i][1]; }
    } catch (e) { swallow(e); }
  }
  function positionPanel() {                      // 副面板已内嵌主控面板，不再有独立浮动窗需避让；保留空壳以维持 showPanel/ensurePanel 调用一致
  }
  function showPanel() { try { ensurePanel(); if (_cxPanel) { _cxPanel.style.display = 'block'; syncPanelInputs(); positionPanel(); Store.emit('panel:refresh'); } } catch (e) { swallow(e); } }
  function hidePanel() { if (_cxPanel) _cxPanel.style.display = 'none'; }

  // P3：UI 与核心解耦（事件总线，复用 Store.onEv/emit）。核心只 emit，UI 只 onEv 订阅，互不直调。
  // 事件契约：ui:toast / panel:refresh / videos:scanned（UI 订阅刷新面板）；
  // targets:updated / video:state（核心观测信号，本步未订阅刷新以免与 videos:scanned 重复渲染）；cmd:scan（UI 触发重扫）。
  try { Store.onEv('ui:toast', toast); } catch (e) { swallow(e); }
  try { Store.onEv('panel:refresh', refreshPanelState); } catch (e) { swallow(e); }
  // videos:scanned 由主循环高频触发，刷新面板属重 DOM 操作；节流到 ~150ms 一帧（尾沿兜底），
  // 避免主线程被反复全量重绘拖慢。panel:refresh 为用户主动操作（开关面板/改设置），保持即时刷新。
  try { Store.onEv('videos:scanned', throttle(refreshPanelState, 150)); } catch (e) { swallow(e); }
  try { Store.onEv('cmd:scan', function () { try { _loopTick(); } catch (e) { swallow(e); } }); } catch (e) { swallow(e); }
  function togglePanel() { if (_cxPanel && _cxPanel.style.display !== 'none') hidePanel(); else showPanel(); }
  // 一键退出/进入 Ninja 模式：卡在窄条、够不到「系统」勾选框时的逃生通道（键盘 N / 面板内「退出 n 模式」按钮共用）
  function toggleNinjaMode() {
    try {
      ensurePanel();
      if (!_cxPanel) return;
      var nin = _cxPanel.querySelector('#__cxNinja');
      if (nin) { nin.checked = !nin.checked; nin.dispatchEvent(new Event('change')); }
    } catch (e) { swallow(e); }
  }
  // 控制面板开关键：非输入框聚焦时按 PAUSE_HOTKEY 开/关悬浮控制面板（用户暂停开关的可视化控制，含暂停/恢复 + 计时器滑块）
  function keydownHandler(e) {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (e.key === 'Escape') { try { hidePanel(); } catch (e3) { swallow(e3); } return; }   // Esc 关闭面板
    var t = e.target;
    var inEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    // N 键（逃生键）：即使在滑块/复选框/下拉等 input 上聚焦也能退出/进入 Ninja。
    // 但若焦点在「命令输入框」或文本框里输入字母 n，则不能拦截，否则没法正常打字。
    if (e.key && e.key.toLowerCase() === 'n') {
      if (t && (t.id === '__cxCmd' || (t.tagName === 'TEXTAREA'))) return;  // 命令框/文本框内输入 n：放行
      try { toggleNinjaMode(); e.preventDefault(); } catch (e2) { swallow(e2); }
      return;
    }
    if (!CONFIG.PAUSE_HOTKEY) return;
    if (inEditable) return;   // 其余热键（P 开关面板）在输入框内不触发，避免误触
    if (e.key && e.key.toLowerCase() === String(CONFIG.PAUSE_HOTKEY).toLowerCase()) {
      try { togglePanel(); e.preventDefault(); } catch (e2) { swallow(e2); }
    }
  }
  try {
    document.addEventListener('keydown', keydownHandler);
  } catch (e) { swallow(e); }
  // 折叠态图标状态联动（当前状态指示器，非操作按钮）：任意视频在播 → 显示播放三角(▶)；全部暂停 → 显示暂停双竖条(‖)。
  function syncNinjaGlyph() {
    try {
      var p = _cxPanel; if (!p || !p.classList.contains('ninja')) return;
      var g = p.querySelector('.cx-ninja-glyph'); if (!g) return;
      var vs = document.getElementsByTagName('video'); var playing = false;
      for (var i = 0; i < vs.length; i++) { if (vs[i] && !vs[i].paused) { playing = true; break; } }
      g.classList.toggle('cx-playing', playing);
      g.classList.toggle('cx-paused', !playing);
    } catch (e2) { swallow(e2); }
  }
  try {
    document.addEventListener('play', syncNinjaGlyph, true);   // 捕获阶段可监听不冒泡的媒体事件
    document.addEventListener('pause', syncNinjaGlyph, true);
    Store.onEv('panel:refresh', syncNinjaGlyph);   // 扫描刷新时兜底同步
  } catch (e) { swallow(e); }

