  // ===== DOMAIN: ui/zhihuishu-fab (Zhihuishu 专属微型标志图标) =====
  // ===== MODULE: 智慧树右下角微型网页标志性图标 =====
  // 域：UI 模块 —— 智慧树(知到)专属，与超星学习通的分区悬浮面板(左上/右上)视觉体系刻意区分。
  // 【需求差异】用户要求：智慧树网页右下角有一个「微型的网页标志性图标」，区别于学习通的控制面板。
  //   故此处不复用 __cxPanel，而是独立一个右下角 FAB（Floating Action Button），常驻且轻量：
  //   - 显示智慧树标志性图标（用 SVG 树形/叶子意象，颜色取智慧树品牌蓝绿），提示脚本在本站生效；
  //   - 点击展开一个极简浮层：显示当前强制续播状态 + 本次已自动作答弹窗数 + 一键开关续播；
  //   - 仅 detectSite()==='zhihuishu' 时创建，超星页面完全不渲染此图标（互不干扰）。
  var _zhsFab = null;
  var _zhsFabAnswered = 0;            // 累计本次会话自动作答弹窗数（供图标浮层展示）
  var _zhsFabEnabled = true;          // 续播总开关镜像（与 CONFIG 不强耦合，独立轻量开关）

  // 智慧树品牌意象 SVG（微型、线性）：一片叶子/树芽，蓝绿渐变
  var ZHS_FAB_SVG =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">' +
      '<path d="M12 21c0-5 0-8 0-8" stroke="#10B981" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M12 13c-4 0-6-3-6-6 3 0 6 1 6 4 0-4 3-6 6-5 0 4-2 7-6 7z" fill="#10B981" opacity="0.9"/>' +
      '<circle cx="12" cy="4.5" r="1.6" fill="#3B82F6"/>' +
    '</svg>';

  function _zhsFabStyle() {
    return '.cx-zhs-fab{' +
      'position:fixed;right:14px;bottom:14px;z-index:2147483646;width:38px;height:38px;border-radius:12px;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'background:rgba(255,255,255,.92);border:1px solid #E5E7EB;' +
      'box-shadow:0 6px 18px rgba(16,185,129,.28),0 2px 6px rgba(0,0,0,.08);' +
      '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
      'transition:transform .18s ease,box-shadow .18s ease;user-select:none;' +
    '}' +
    '.cx-zhs-fab:hover{transform:translateY(-2px) scale(1.06);box-shadow:0 10px 24px rgba(16,185,129,.4),0 2px 8px rgba(0,0,0,.1);}' +
    '.cx-zhs-fab .cx-zhs-dot{position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;' +
      'background:#10B981;border:2px solid #fff;box-shadow:0 0 0 2px rgba(16,185,129,.2);animation:cx-zhs-pulse 2.4s infinite ease-out;}' +
    '@keyframes cx-zhs-pulse{0%{transform:scale(.7);opacity:.6;}100%{transform:scale(1.8);opacity:0;}}' +
    '.cx-zhs-pop{position:fixed;right:14px;bottom:60px;z-index:2147483646;width:240px;box-sizing:border-box;' +
      'background:#F9FAFB;color:#1F2937;font:12px/1.5 sans-serif;border:1px solid #E5E7EB;border-radius:12px;' +
      'box-shadow:0 12px 32px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);padding:12px;' +
      'display:none;}' +
    '.cx-zhs-pop.cx-show{display:block;}' +
    '.cx-zhs-pop h4{margin:0 0 8px;font-size:13px;color:#10B981;display:flex;align-items:center;gap:6px;}' +
    '.cx-zhs-pop .cx-row{display:flex;justify-content:space-between;align-items:center;margin:6px 0;}' +
    '.cx-zhs-pop .cx-val{color:#1F2937;font-weight:600;}' +
    '.cx-zhs-pop button{width:100%;margin-top:8px;padding:7px;border:0;border-radius:6px;cursor:pointer;' +
      'background:#10B981;color:#fff;font-size:12px;}' +
    '.cx-zhs-pop button.cx-off{background:#EF4444;}';
  }

  function _zhsEnsureFab() {
    if (detectSite() !== 'zhihuishu') return;      // 隔离：非智慧树不渲染
    if (_zhsFab) return;
    try {
      var pd = document;
      if (!pd.getElementById('__cxZhsStyle')) {
        var st = pd.createElement('style'); st.id = '__cxZhsStyle'; st.textContent = _zhsFabStyle();
        (pd.head || pd.documentElement || pd).appendChild(st);
      }
      var fab = pd.createElement('div');
      fab.className = 'cx-zhs-fab'; fab.id = '__cxZhsFab'; fab.title = '智慧树强制续播 · 自动作答已开启';
      fab.innerHTML = ZHS_FAB_SVG + '<span class="cx-zhs-dot"></span>';
      pd.body.appendChild(fab);

      var pop = pd.createElement('div');
      pop.className = 'cx-zhs-pop'; pop.id = '__cxZhsPop';
      pop.innerHTML =
        '<h4>' + ZHS_FAB_SVG.replace('width="22" height="22"', 'width="16" height="16"') + '智慧树助手</h4>' +
        '<div class="cx-row"><span>强制续播</span><span class="cx-val" id="__cxZhsPlay">开</span></div>' +
        '<div class="cx-row"><span>本次自动作答</span><span class="cx-val" id="__cxZhsAns">0</span></div>' +
        '<button id="__cxZhsToggle">关闭续播</button>';
      pd.body.appendChild(pop);

      fab.addEventListener('click', function () {
        try { pop.classList.toggle('cx-show'); _zhsRefreshFab(); } catch (e) { swallow(e); }
      });
      pop.querySelector('#__cxZhsToggle').addEventListener('click', function () {
        try {
          _zhsFabEnabled = !_zhsFabEnabled;
          // 仅在 auto 模式下启停原型中性化；gentle 下无原型可切，仅记状态
          try { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
            window.__CX_FORCE_PLAY.CONFIG.INTRUSION_MODE = _zhsFabEnabled ? 'auto' : 'gentle';
            if (typeof window.__CX_FORCE_PLAY.reconcileIntrusionMode === 'function') window.__CX_FORCE_PLAY.reconcileIntrusionMode();
          } } catch (e2) { swallow(e2); }
          _zhsRefreshFab();
        } catch (e) { swallow(e); }
      });
      _zhsFab = fab;
      try { Store.onEv('ui:toast', function () {}); } catch (e) {}  // 占位订阅，保持事件总线一致
    } catch (e) { swallow(e); }
  }

  // 刷新图标浮层数值（弹窗计数 / 续播状态）
  function _zhsRefreshFab() {
    if (!_zhsFab) return;
    try {
      var ans = document.getElementById('__cxZhsAns');
      if (ans) ans.textContent = _zhsFabAnswered;
      var pl = document.getElementById('__cxZhsPlay');
      if (pl) pl.textContent = _zhsFabEnabled ? '开' : '关';
      var tg = document.getElementById('__cxZhsToggle');
      if (tg) { tg.textContent = _zhsFabEnabled ? '关闭续播' : '开启续播'; tg.className = _zhsFabEnabled ? '' : 'cx-off'; }
    } catch (e) { swallow(e); }
  }

  // 主循环每轮调用：确保图标存在，并累加自动作答计数
  function zhihuishuFabTick(handledCount) {
    if (detectSite() !== 'zhihuishu') return;
    try { _zhsEnsureFab(); } catch (e) { swallow(e); }
    if (handledCount > 0) {
      _zhsFabAnswered += handledCount;
      try { _zhsRefreshFab(); } catch (e) { swallow(e); }
    }
  }

  // 暴露给主循环与回归测试
  try { window.__CX_FORCE_PLAY.zhihuishuFabTick = zhihuishuFabTick; } catch (e) {}
