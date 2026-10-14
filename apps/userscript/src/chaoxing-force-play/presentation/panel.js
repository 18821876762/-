// @provides: SCRIPT_VERSION, _cxPanel, hidePanel, toggleNinjaMode
// @requires: CONFIG, CX_KEYS, DEBUG, EventBus, FLAGS, STYLES, _cxPanelOwnerClaim, bestEffort, cxIcon, escapeHTML, foregroundVideo, safeGet
  // ===== DOMAIN: presentation/panel (floating control panel) =====
  // ===== MODULE: 悬浮控制面板 =====
  // 域：presentation/面板模块 —— 悬浮控制面板。
  // —— 悬浮控制面板（开关键 = PAUSE_HOTKEY，默认 p）——
  // 集中控制：暂停/恢复、自动停止计时(AUTO_STOP_MIN)、暂停后自动恢复(RESUME_AFTER_MIN)，并实时显示状态。
  // 仅懒创建一次，随状态刷新；不污染页面输入框，Esc/× 关闭。
  var SCRIPT_VERSION = '4.20.3';  // 与文件头 @version 保持一致（面板与诊断信息显示用）
  // 版本导出放在最后加载的域(panel.js 内 SCRIPT_VERSION 赋值之后)：整个包共享一个闭包，SCRIPT_VERSION 经 var 提升
  // 在闭包顶部即可见但赋值发生在本行；若放到先加载的 takeover 域(main-loop)会读到 undefined → 启动日志恒显 v?。
  // 此处赋值后，任意帧/任意 addon(如 auto-next 300ms boot)读 window.__CX_FORCE_PLAY.version 即得 '4.19.25'。
  window.__CX_FORCE_PLAY.version = SCRIPT_VERSION;
  // 【共享契约·扇出最大的单例】_cxPanel 是面板根节点，被 7 个模块直接引用，为全项目耦合度最高的变量：
  //   写入方仅 2 处（必须保持）：本文件的显隐/销毁逻辑、presentation/panel-core.js 的 ensurePanel 装配完成赋值；
  //   读取方 5 处（只读，勿写）：plugins/registry.js、presentation/dashboard.js、presentation/commands.js、presentation/panel-drag.js、takeover/bootstrap/main-loop.js。
  // 读取方一律先判空（面板未创建时为 null）。新增写入点前请三思：任何一处误置 null 都会静默影响其余全部读取方。
  var _cxPanel = null;
  var _lastVideoList = [];       // 面板视频列表渲染时缓存的视频引用快照，供点击委托回调定位目标视频（索引稳定）
  // 主从式导航当前激活区块（localStorage 持久化）：面板顶部分区导航，切换下方内容（主控/自动化/洞察/系统）。
  var _cxActiveTab = 'control';
  // v5 IA 重组：旧 tab 值迁移映射（pause→control, sub→automation, adv→insight, other→system），一次性改写后按新值持久化
  var _cxTabMigrate = { pause: 'control', sub: 'automation', adv: 'insight', other: 'system' };
  bestEffort(function () {
    var _savedTab = safeGet(function () { var _t = localStorage.getItem(CX_KEYS.PANEL_TAB); return _t || 'control'; }, 'control');
    if (_cxTabMigrate[_savedTab]) { _savedTab = _cxTabMigrate[_savedTab]; bestEffort(function () { localStorage.setItem(CX_KEYS.PANEL_TAB, _savedTab); }, 'panel.tab.migrate'); }
    _cxActiveTab = _savedTab;
  }, 'panel.tab');

  function syncPanelInputs() {                     // 把 CONFIG / 版本 / DEBUG 当前值回填到面板控件
    if (!_cxPanel) return;
    if (!_cxPanelOwnerClaim()) return;   // R4+R5：非 owner 帧不得反向覆盖配置；owner 缺失则本帧抢占
    bestEffort(function () {
      var auto = _cxPanel.querySelector('#__cxAuto'); if (auto) { auto.value = CONFIG.AUTO_STOP_MIN; var _awv = _cxPanel.querySelector('#__cxAutoVal'); if (_awv) _awv.textContent = CONFIG.AUTO_STOP_MIN; }   // R1：判空防部分同步跳过
      var res = _cxPanel.querySelector('#__cxResume'); if (res) { res.value = CONFIG.RESUME_AFTER_MIN; var _rwv = _cxPanel.querySelector('#__cxResumeVal'); if (_rwv) _rwv.textContent = CONFIG.RESUME_AFTER_MIN; }   // R1
      var resc = _cxPanel.querySelector('#__cxRescan'); if (resc) { resc.value = CONFIG.RESCAN_INTERVAL; var _scwv = _cxPanel.querySelector('#__cxRescanVal'); if (_scwv) _scwv.textContent = CONFIG.RESCAN_INTERVAL; }   // R1
      var endrel = _cxPanel.querySelector('#__cxEndRel'); if (endrel) { endrel.value = CONFIG.END_RELEASE_SEC; var _erwv = _cxPanel.querySelector('#__cxEndRelVal'); if (_erwv) _erwv.textContent = CONFIG.END_RELEASE_SEC; }   // R1
      var rateSel = _cxPanel.querySelector('#__cxRate'); if (rateSel) { rateSel.value = ('' + (CONFIG.USER_RATE || 1)); }
      var tr = _cxPanel.querySelector('#__cxTopRate'); if (tr) tr.textContent = (CONFIG.USER_RATE || 1) + 'x';
      var dbg = _cxPanel.querySelector('#__cxDebug'); if (dbg) dbg.checked = !!DEBUG;
      var lp = _cxPanel.querySelector('#__cxLoop'); if (lp) lp.checked = !!CONFIG.LOOP_PLAY;
      var sv = _cxPanel.querySelector('#__cxSingleVideo'); if (sv) sv.checked = !!CONFIG.SINGLE_VIDEO;
      var ninja = _cxPanel.querySelector('#__cxNinja'); if (ninja) ninja.checked = !!CONFIG.NINJA_MODE;
      var pw = _cxPanel.querySelector('#__cxPanelW'); if (pw) { pw.value = CONFIG.PANEL_W; var pwv = _cxPanel.querySelector('#__cxPanelWVal'); if (pwv) pwv.textContent = CONFIG.PANEL_W; }
      var ver = _cxPanel.querySelector('#__cxVer'); if (ver) ver.textContent = 'v' + SCRIPT_VERSION;
    }, 'panel.syncInputs');
  }
  function refreshPanelLabels() {                   // 拖动滑块时实时刷新旁边的数值文字（syncPanelInputs 仅在面板创建时回填一次，否则显示滞后）
    if (!_cxPanel) return;
    bestEffort(function () {
      var map = [['#__cxAutoVal', CONFIG.AUTO_STOP_MIN], ['#__cxResumeVal', CONFIG.RESUME_AFTER_MIN], ['#__cxRescanVal', CONFIG.RESCAN_INTERVAL], ['#__cxEndRelVal', CONFIG.END_RELEASE_SEC], ['#__cxPanelWVal', CONFIG.PANEL_W]];
      for (var i = 0; i < map.length; i++) { var n = _cxPanel.querySelector(map[i][0]); if (n) n.textContent = map[i][1]; }
    }, 'panel.refreshLabels');
  }
  function positionPanel() {                      // 副面板已内嵌主控面板，不再有独立浮动窗需避让；保留空壳以维持 showPanel/ensurePanel 调用一致
  }
  // 修复(2026-08-12)：必须用 'flex' 而非 'block'。PANEL_BOX 内联 display:flex 会被 JS 赋值的
  // 'block' 按属性覆盖（内联样式后者胜），导致 #__cxPanel 变块级布局、.cx-body{flex:1} 压缩失效：
  // 面板内容超高时滚动条不出现、内容被外层 overflow:hidden 直接裁剪 → 「非 n 模式无法上下滚动」。
  // n 模式展开态恰好被 .ninja-open{display:flex!important}（!important 压过内联）救回，所以只有正常模式中招。
  function showPanel() { bestEffort(function () { ensurePanel(); if (_cxPanel) { _cxPanel.style.display = 'flex'; syncPanelInputs(); positionPanel(); EventBus.emit('panel:refresh'); } }, 'panel.show'); }
  function hidePanel() { if (_cxPanel) _cxPanel.style.display = 'none'; }

  // A 类冻结防御·解冻自检（2026-08-17）：
  // 症状——完整面板(非 ninja)下联动答题时/后，点 tab/关闭全失效、P 键正常、仅刷新可恢复。
  // 代码侧全量排查确认：脚本自身在非 ninja 模式不创建任何可拦截面板点击的浮层
  // （cx-ds-status / toast / tamper-guard / keyboard-hint 均为 pointer-events:none；命令下拉仅向下展开挡 tab、不挡 header 关闭按钮）。
  // 故「关闭失效+整面板冻结」必为站点侧透明拦截层（平台随堂题/考试 modal 残留 backdrop 等）覆盖面板所致。
  // 本自检用 document.elementFromPoint 探测面板关键点(关闭/当前 tab)顶层元素是否仍属面板自身：
  //   - 否(被外部元素拦截) → 把面板重挂到父节点末尾(同 z-index 下 DOM 后者居顶)抢回点击权 + 输出诊断(含元凶 tag)。
  //   - 仅在真实浏览器(layout 可用)生效；jsdom 无布局(getBoundingClientRect 全 0)直接跳过，不影响 _sim。
  var _defrostLast = 0, _defrostLastTag = '';
  function _cxPanelDefrostCheck() {
    if (!_cxPanel) return;
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return;  // jsdom 无布局 API
    if (_cxPanel.style.display === 'none') return;
    // 性能修复(交互延迟)：时间窗口检查放在 getBoundingClientRect（布局读取）之前——
    // 旧实现先读 rect 再过节流，面板可见期间每次 panel:refresh（每 2s + 每次按键）都白做一次强制布局
    // （真实大页面面板 rect 实测 ~24ms/次）。遮挡检测是极低频事件：窗口 10000ms（面板打开期间每 10s 一次），
    // 遮挡恢复最多延迟 10s（可重开面板/刷新即时恢复），换取交互链零 rect 开销。
    var now = Date.now(); if (now - _defrostLast < 10000) return; _defrostLast = now;
    var r = _cxPanel.getBoundingClientRect();
    if (!r.width || !r.height) return;                  // jsdom 恒 0 → 跳过，避免误判触发重挂
    bestEffort(function () {
      var iw = (typeof window !== 'undefined' && window.innerWidth) || r.right, ih = (typeof window !== 'undefined' && window.innerHeight) || r.bottom;
      // 性能修复(交互延迟)：单点探测（关闭按钮）——tab 点与关闭点同属面板顶部区域，命中判定等价，省一半 hit-test
      var pts = [
        { x: Math.min(r.right - 14, iw - 1), y: Math.min(r.top + 14, ih - 1), label: '关闭按钮' }
      ];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (p.x < 1 || p.y < 1) continue;
        var top = null; try { top = document.elementFromPoint(p.x, p.y); } catch (e) { return; }
        if (top && _cxPanel.contains(top)) { _defrostLastTag = ''; continue; }  // 命中面板自身 → 正常
        var who = top ? (top.tagName + (top.id ? '#' + top.id : '') + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\s+/).join('.') : '')) : 'null';
        if (_cxPanel.parentNode) _cxPanel.parentNode.appendChild(_cxPanel);      // DOM 末尾 → 同 z-index 居顶，抢回点击
        if (who !== _defrostLastTag) {   // 元凶变化才告警，避免重复刷屏
          _defrostLastTag = who;
          if (DEBUG) safeGet(function () { console.warn('[CX] 面板解冻自检：交互点「' + p.label + '」被外部元素拦截(' + who + ')，已重挂面板恢复点击'); }, undefined);
          EventBus.emit('ui:toast', '检测到面板被遮挡，已自动恢复');
        }
        return;
      }
    }, 'panel.defrost');
  }
  // 性能修复(交互延迟)：defrost 延迟调度——getBoundingClientRect 在真实大页面实测单次 ~24ms（面板子树布局），
  // 若在 panel:refresh 同步链内执行会直接拖慢每次按键/切 tab 的响应。改为：panel:refresh 只置待办标记，
  // setTimeout(0) 到事件循环队尾执行（排队中的交互事件先处理）；遮挡检测延迟 ~1 帧，语义无损。
  var _defrostPending = false;
  function _cxPanelDefrostSched() {
    if (_defrostPending) return;
    _defrostPending = true;
    setTimeout(function () { _defrostPending = false; _cxPanelDefrostCheck(); }, 0);
  }
  bestEffort(function () { EventBus.onEv('panel:refresh', _cxPanelDefrostSched); }, 'panel.ev.defrost');

  // P3：UI 与核心解耦（事件总线，复用 EventBus.onEv/emit）。核心只 emit，UI 只 onEv 订阅，互不直调。
  // 事件契约：ui:toast / panel:refresh / videos:scanned（UI 订阅刷新面板）；
  // targets:updated / video:state（核心观测信号，本步未订阅刷新以免与 videos:scanned 重复渲染）；cmd:scan（UI 触发重扫）。
  bestEffort(function () { EventBus.onEv('ui:toast', toast); }, 'panel.ev.toast');
  bestEffort(function () { EventBus.onEv('panel:refresh', refreshPanelState); }, 'panel.ev.refresh');
  // videos:scanned 由主循环高频触发，刷新面板属重 DOM 操作；节流到 ~150ms 一帧（尾沿兜底），
  // 避免主线程被反复全量重绘拖慢。panel:refresh 为用户主动操作（开关面板/改设置），保持即时刷新。
  bestEffort(function () { EventBus.onEv('videos:scanned', throttle(refreshPanelState, 150)); }, 'panel.ev.scanned');
  bestEffort(function () { EventBus.onEv('cmd:scan', function () { bestEffort(function () { _loopTick(); }, 'panel.cmdScan'); }); }, 'panel.ev.cmd');
  // 安全审计（建议#10）：面板「洞察」页实时渲染当前侵入点清单；开面板/手动刷新时重算，扫描节流兜底。
  function renderInvasionReport() {
    if (!_cxPanel) return;
    var box = _cxPanel.querySelector('#__cxInvasionReport');
    if (!box) return;
    bestEffort(function () {
      var rows = buildInvasionReport();
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var col = r.on ? STYLES.T.warning : STYLES.T.idle;
        var mark = cxIcon('dot', 8);
        html += '<div style="display:flex;gap:6px;align-items:baseline;font-size:11px;padding:3px 0;border-bottom:1px dashed ' + STYLES.T.border + ';">' +
          '<span style="color:' + col + ';flex:0 0 auto;">' + mark + '</span>' +
          '<span style="flex:0 0 96px;color:' + STYLES.T.text2 + ';">' + escapeHTML(r.area) + '</span>' +
          '<span style="flex:1;color:' + STYLES.T.text + ';word-break:break-all;">' + escapeHTML(r.detail) + '</span>' +
        '</div>';
      }
      box.innerHTML = html;
    }, 'panel.invasionReport');
  }
  // 性能修复(交互延迟)：panel:refresh 路径的重渲染器（侵入点清单/自检矩阵）加 500ms 节流——
  // 旧实现直接订阅，每次按 P/切 tab 都全量重建（buildInvasionReport 遍历所有帧 + 构建大段 HTML）。
  // 500ms 尾沿节流：单次操作即时渲染，连续交互（连按 P/切 tab）时每个渲染器最多每 500ms 一次。
  bestEffort(function () { EventBus.onEv('panel:refresh', throttle(renderInvasionReport, 500)); }, 'panel.ev.invasion');
  bestEffort(function () { EventBus.onEv('videos:scanned', throttle(renderInvasionReport, 1500)); }, 'panel.ev.invasionScan');

  // 开发者模式：功能自检矩阵渲染（数据源 diagnostics.buildFeatureSelfTest）
  function renderFeatureSelfTest() {
    if (!_cxPanel) return;
    var box = _cxPanel.querySelector('#__cxSelfTestReport');
    if (!box) return;
    bestEffort(function () {
      var rep = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.buildFeatureSelfTest === 'function')
        ? window.__CX_FORCE_PLAY.buildFeatureSelfTest() : null;
      if (!rep) { box.innerHTML = '— 自检不可用 —'; return; }
      var s = rep.summary;
      function dotCls(st) { return st === 'ok' ? 'ok' : (st === 'partial' ? 'warn' : (st === 'na' ? '' : 'err')); }
      function label(st) { return st === 'na' ? '不适用' : (st === 'fail' ? '失败' : (st === 'partial' ? '部分' : '已实现')); }
      var html = '<div style="font-size:10px;color:var(--cx-text2);margin-bottom:6px;">站点=<b>' + escapeHTML(rep.site) + '</b> · ' +
        '<span class="cx-legend-dot ok"></span>已实现 <b>' + s.ok + '</b> · ' +
        '<span class="cx-legend-dot warn"></span>部分 <b>' + s.partial + '</b> · ' +
        '<span class="cx-legend-dot"></span>不适用 <b>' + s.na + '</b> · ' +
        '<span class="cx-legend-dot err"></span>失败 <b>' + s.fail + '</b></div>';
      for (var i = 0; i < rep.rows.length; i++) {
        var r = rep.rows[i];
        // 状态/域/功能同行：最后一项「说明(detail)」单独换行，避免长说明挤压前三项排版
        html += '<div style="padding:4px 0;border-bottom:1px dashed rgba(128,128,128,0.22);">' +
          '<div style="display:flex;gap:6px;align-items:baseline;font-size:11px;">' +
            '<span style="flex:0 0 56px;"><span class="cx-legend-dot ' + dotCls(r.status) + '"></span> ' + label(r.status) + '</span>' +
            '<span style="flex:0 0 62px;color:var(--cx-text2);">' + escapeHTML(r.group) + '</span>' +
            '<span style="flex:1;color:var(--cx-text);">' + escapeHTML(r.name) + '</span>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--cx-text2);padding:2px 0 0 62px;word-break:break-all;line-height:1.5;">' + escapeHTML(r.detail) + '</div>' +
        '</div>';
      }
      box.innerHTML = html;
    }, 'panel.selfTest');
  }
  // 性能修复(交互延迟)：panel:refresh 路径的自检矩阵渲染器同样加 500ms 节流（见上方 invasion 同款说明）
  bestEffort(function () { EventBus.onEv('panel:refresh', throttle(renderFeatureSelfTest, 500)); }, 'panel.ev.selfTest');
  // 性能修复(交互延迟)：功能自检矩阵遍历所有帧 + 构建几十行 HTML——节流窗口 2000→3000ms，
  // 与 renderInvasionReport(1500ms) 错峰，避免面板打开/连续交互时多个重渲染器同时执行。
  bestEffort(function () { EventBus.onEv('videos:scanned', throttle(renderFeatureSelfTest, 3000)); }, 'panel.ev.selfTestScan');
  // 开关键 = PAUSE_HOTKEY（默认 p）。
  // 非 ninja：显示↔隐藏（原行为）。
  // ninja 模式：胶囊常驻，P 在「展开(显示全部内容) ↔ 折叠(仅胶囊)」间切换，
  // 避免旧逻辑只 toggle 折叠胶囊的 display，导致按键永远看不到面板正文(只有「主控」胶囊)。
  function togglePanel() {
    if (!_cxPanel) { showPanel(); return; }
    if (_cxPanel.style.display === 'none') {            // 隐藏 → 显示（ninja 下直接展开）
      showPanel();
      if (CONFIG.NINJA_MODE) _cxPanel.classList.add('ninja-open');
      return;
    }
    if (CONFIG.NINJA_MODE) {                            // ninja：展开↔折叠
      if (_cxPanel.classList.contains('ninja-open')) _cxPanel.classList.remove('ninja-open');
      else _cxPanel.classList.add('ninja-open');
      return;
    }
    hidePanel();                                        // 非 ninja：显示↔隐藏
  }
  // 一键退出/进入 Ninja 模式：卡在窄条、够不到「系统」勾选框时的逃生通道（键盘 N / 面板内「退出 n 模式」按钮共用）
  function toggleNinjaMode() {
    bestEffort(function () {
      ensurePanel();
      if (!_cxPanel) return;
      var nin = _cxPanel.querySelector('#__cxNinja');
      if (nin) { nin.checked = !nin.checked; nin.dispatchEvent(new Event('change')); }
    }, 'panel.toggleNinja');
  }
  // 控制面板开关键：非输入框聚焦时按 PAUSE_HOTKEY 开/关悬浮控制面板（用户暂停开关的可视化控制，含暂停/恢复 + 计时器滑块）
  function keydownHandler(e) {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (e.key === 'Escape') {
      bestEffort(function () {
        if (_cxPanel && _cxPanel.classList.contains('ninja') && _cxPanel.classList.contains('ninja-open')) {
          _cxPanel.classList.remove('ninja-open');
          var _fab = _cxPanel.querySelector('.cx-ninja-fab'); if (_fab) _fab.setAttribute('aria-expanded', 'false');
        } else { hidePanel(); }
      }, 'panel.esc'); return;
    }
    var t = e.target;
    var inEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key && e.key.toLowerCase() === 'n') {
      // 与 P 键对称守卫：页面任意文本输入聚焦时不劫持键入的 'n'（P1-3 修复——原只排除 TEXTAREA，会在页面 input 误触切换 n 模式）。
      // 逃生通道保留：命令框(__cxCmd)与面板自身控件(如宽度滑块 __cxPanelW)聚焦时仍可触发 N 切换 n 模式（sim-ninja 已覆盖）。
      if (t && t.id === '__cxCmd') return;                          // 命令框内不触发
      if (t && t.tagName === 'TEXTAREA') return;                    // 文本域不触发
      if (t && t.tagName === 'INPUT' && !(_cxPanel && _cxPanel.contains(t))) return;  // 页面输入框(非面板控件)不触发
      if (t && t.isContentEditable) return;                         // 可编辑内容不触发
      bestEffort(function () { toggleNinjaMode(); e.preventDefault(); }, 'panel.key.n');
      return;
    }
    if (!CONFIG.PAUSE_HOTKEY) return;
    if (inEditable) return;
    if (e.key && e.key.toLowerCase() === String(CONFIG.PAUSE_HOTKEY).toLowerCase()) {
      bestEffort(function () { togglePanel(); e.preventDefault(); }, 'panel.key.pause');
    }
  }
  bestEffort(function () {
    document.addEventListener('keydown', keydownHandler);
  }, 'panel.keydownInit');
  // 折叠态状态点联动（状态指示器，非操作按钮）：续播中 → 绿；用户暂停 → 橙；空闲 → 灰；接管被还原 → 红闪
  function syncNinjaGlyph() {
    bestEffort(function () {
      var p = _cxPanel; if (!p || !p.classList.contains('ninja')) return;
      var dot = p.querySelector('.cx-ninja-dot'); if (!dot) return;
      var vs = document.getElementsByTagName('video');
      var playing = 0;
      for (var i = 0; i < vs.length; i++) { if (vs[i] && !vs[i].paused && !vs[i].ended) playing++; }
      var fg = foregroundVideo ? foregroundVideo() : null;
      var isUserPaused = !!(fg && fg[FLAGS.userPaused]);
      // 异常态：接管被平台还原（原型被改回）
      var tampered = false;
      try {
        if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getPauseNeutralized === 'function') {
          // P1-2 修复：gentle 模式(或 auto 非超星)本就不包装 pause 原型，getPauseNeutralized()===false 为预期值，
          // 若直接据此闪红会误报「接管被还原」。仅当「本应激进中性化」却探测到原型被还原才判 tampered。
          var _eff = (window.__CX_FORCE_PLAY.CONFIG && window.__CX_FORCE_PLAY.CONFIG.INTRUSION_MODE) || 'auto';
          if (_eff === 'auto') {
            var _ds = (typeof window.__CX_FORCE_PLAY.detectSite === 'function') ? window.__CX_FORCE_PLAY.detectSite() : null;
            _eff = (_ds === 'chaoxing') ? 'aggressive' : 'gentle';
          }
          if (_eff === 'aggressive' && window.__CX_FORCE_PLAY.getPauseNeutralized() === false) tampered = true;
        }
      } catch (e) {}
      // UI 规范 §悬浮球：FAB 状态色由 data-state 驱动（playing=绿/paused=橙/error=红/idle=灰）
      dot.classList.remove('is-warning');
      var st = 'idle';
      if (tampered) { dot.className = 'cx-ninja-dot is-warning'; st = 'error'; }
      else if (playing > 0) { dot.className = 'cx-ninja-dot'; st = 'playing'; }
      else if (isUserPaused || vs.length > 0) { dot.className = 'cx-ninja-dot paused'; st = 'paused'; }
      else { dot.className = 'cx-ninja-dot idle'; }
      p.setAttribute('data-state', st);
      // 角标：续播中视频数（待处理提示）
      var badge = p.querySelector('.cx-ninja-badge');
      if (badge) {
        badge.textContent = playing > 99 ? '99+' : ('' + playing);
        badge.setAttribute('data-count', playing > 0 ? String(playing) : '0');
      }
    }, 'panel.ninjaGlyph');
  }
  bestEffort(function () {
    document.addEventListener('play', syncNinjaGlyph, true);
    document.addEventListener('pause', syncNinjaGlyph, true);
    EventBus.onEv('panel:refresh', syncNinjaGlyph);
  }, 'panel.ninjaEvents');

