  // ===== DOMAIN: ui/panel-core (panel assembly + event binding) =====
  // Panel assembly: create DOM, inject styles, bind all control events and navigation.
  function ensurePanel() {
    if (_cxPanel) return _cxPanel;
    // 面板落点：同源顶层(window.top)可达则挂在顶层文档，保证全站仅一个面板且跨 iframe 聚合所有视频；
    // 跨域嵌入(顶层不可达)时回退挂本帧文档。用全局 id 守卫避免每个 frame 各建一个面板——
    // 旧行为会导致"面板被建在视频 iframe 内、且只看见那一帧的 1 个视频、必须点进 iframe 才能用 P 键"。
    var pd = (window.top && window.top.document && window.top.document.body) ? window.top.document : document;
    var _cxExisting = null;
    try { _cxExisting = pd.getElementById('__cxPanel'); } catch (e) { swallow(e); }
    if (_cxExisting) { _cxPanel = _cxExisting; return _cxExisting; }   // 已存在(别的 frame 建的)：直接复用，全站唯一
    // 修复 #16：body 尚未就绪时，面板若被立即构建会游离在 DOM 之外（pd.body.appendChild
    // 跳过），_cxPanel 即使被赋值也不可见。改为 deferred：等 DOMContentLoaded / rAF 后再构建，
    // 期间返回 null，调用方均已对 null 做了安全处理（if (_cxPanel) ...）。
    if (!pd.body) {
      try {
        var _cxBuildLater = function () { if (!_cxPanel && pd.body) ensurePanel(); };
        if (pd.readyState === 'loading') {
          // 手动实现 once 语义：老浏览器(Safari<10/IE)静默忽略 {once:true} 选项，显式 removeEventListener 兜底
          var _cxBuildOnce = function () { try { pd.removeEventListener('DOMContentLoaded', _cxBuildOnce); } catch (e) {} _cxBuildLater(); };
          pd.addEventListener('DOMContentLoaded', _cxBuildOnce);
        } else {
          // rAF 在后台标签页会被节流/暂停，极端环境可能缺失；兜底用 setTimeout 保证面板总能构建
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_cxBuildLater);
          else setTimeout(_cxBuildLater, 0);
        }
      } catch (e) { swallow(e); }
      return null;
    }
    var el = pd.createElement('div');
    el.id = '__cxPanel';
    el.style.cssText = STYLES.PANEL_BOX;
    // 应用持久化的面板宽度（CSS 变量单一事实源：正常态与 Ninja 展开态共用，见 STYLES.PANEL_BOX / NINJA_STYLE）
    try { el.style.setProperty('--cx-panel-w', (CONFIG.PANEL_W || 380) + 'px'); } catch (e) { swallow(e); }
    // 空态成文（设计 §6.3）：面板未能挂顶层文档（跨域 iframe 回退）时标题栏给出可见标记
    var _inFrame = !(window.top && window.top.document && window.top.document.body);
    el.innerHTML = buildPanelHTML(_inFrame);
    if (pd.body) pd.body.appendChild(el);
    // —— 移动端适配：窄屏下主控面板自适应宽度、放大点按区、缩小字号（仅注入一次）——
    if (!pd.getElementById('__cxPanelMobileStyle')) {
      try {
        var ms = pd.createElement('style');
        ms.id = '__cxPanelMobileStyle';
        ms.textContent = STYLES.PANEL_MOBILE;
        if (pd.head) pd.head.appendChild(ms);
      } catch (e) { swallow(e); }
    }
    // —— Ninja 模式样式：面板默认缩成窄条，鼠标悬停展开（仅注入一次）——
    if (!pd.getElementById('__cxPanelNinjaStyle')) {
      try {
        var ns = pd.createElement('style');
        ns.id = '__cxPanelNinjaStyle';
        ns.textContent = STYLES.NINJA_DEFAULT + STYLES.NINJA_STYLE;
        if (pd.head) pd.head.appendChild(ns);
      } catch (e) { swallow(e); }
    }
    // —— 动效与精密感样式：呼吸灯/环形仪表/等宽数字/微交互（仅注入一次）——
    if (!pd.getElementById('__cxPanelAnimStyle')) {
      try {
        var as = pd.createElement('style');
        as.id = '__cxPanelAnimStyle';
        as.textContent = STYLES.ANIM;
        if (pd.head) pd.head.appendChild(as);
      } catch (e) { swallow(e); }
    }
    // Ninja 模式：应用/移除 ninja CSS class
    if (CONFIG.NINJA_MODE) el.classList.add('ninja');
    el.title = CONFIG.NINJA_MODE ? 'n 模式：点击面板展开 / 再次点击收起' : '';
    // 位置策略（v4.9 修订）：禁用拖拽，面板始终使用 CSS 默认右上角安全位。
    // 旧版拖拽会把"Ninja 窄态(40px)坐标"套到"退出后 460px 宽态面板"上，
    // 导致 left 不变、右侧大半被屏幕右边缘裁掉、只剩左侧一点可见。
    // 故不再应用/写入 PANEL_POS（其旧值可能已在屏外），面板恒居右上角、完整可见。
    // 如确需移动，应改用"相对视口比例 + 退出 Ninja 时按当前宽度重算落点"的健壮方案再开放。

    el.querySelector('#__cxPanelClose').addEventListener('click', hidePanel);
    // —— 命令面板：输入 / 唤起命令下拉，↑↓/Tab/Enter/Esc ——
    var cmdInp = el.querySelector('#__cxCmd');
    if (cmdInp) {
      cmdInp.addEventListener('input', _cxCmdOnInput);
      cmdInp.addEventListener('keydown', _cxCmdOnKey);
      cmdInp.addEventListener('blur', _cxCmdOnBlur);
      cmdInp.addEventListener('focus', _cxCmdUpdate);
      // 鼠标点击命令项：用 mousedown + preventDefault 抢在 input blur 之前执行，避免点击被吞（修复点击无效）
      var cmdListEl = el.querySelector('#__cxCmdList');
      if (cmdListEl) {
        cmdListEl.addEventListener('mousedown', function (ev) {
          ev.preventDefault();   // 阻止 input 失焦，保证点击生效
          // 星标按钮：收藏/取消收藏
          var favBtn = ev.target && ev.target.closest ? ev.target.closest('[data-fav]') : null;
          if (favBtn) {
            try { _cxFavToggle(favBtn.getAttribute('data-fav')); } catch (e) { swallow(e); }
            return;
          }
          var item = ev.target && ev.target.closest ? ev.target.closest('[data-ci]') : null;
          if (!item) return;
          var idx = +item.getAttribute('data-ci');
          var c = _cxCmdFilter[idx];
          if (!c) return;
          if (c.args) { cmdInp.value = '/' + c.name + ' '; try { cmdInp.focus(); var L = cmdInp.value.length; cmdInp.setSelectionRange(L, L); } catch (ee) { swallow(ee); } _cxCmdRender(_cxCmdFilter, idx); }
          else { cmdInp.value = '/' + c.name; executeRawCmd('/' + c.name); hideCmdList(); cmdInp.value = ''; }
        });
      }
    }
    el.querySelector('#__cxBtnPause').addEventListener('click', function () {
      var v = currentVideo(); if (!v) { Store.emit('ui:toast', '无目标视频'); return; }
      if (v.__cxUserPaused) userResume(v); else userPause(v);
      Store.emit('panel:refresh');
    });
    // 视频列表：事件委托，逐个暂停/恢复（修复"多视频下只能控制单个视频"）
    var vlist = el.querySelector('#__cxVideoList');
    if (vlist) vlist.addEventListener('click', function (ev) {
      try {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-vi]') : null;
        if (!btn) return;
        if (btn.getAttribute('data-dis')) return;          // 已结束 或 单视频模式：开关禁用
        if (CONFIG.SINGLE_VIDEO) return;                   // 双保险：单视频模式下不响应点击
        var idx = +btn.getAttribute('data-vi');
        var vv = (_lastVideoList && _lastVideoList[idx]) || allVideos()[idx];
        if (!vv) return;
        if (vv.__cxUserPaused) userResume(vv); else userPause(vv);
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    // 快切按钮：仅播此轨（暂停所有其他视频，只保留前台）
    var btnOnlyFg = el.querySelector('#__cxBtnOnlyFg');
    if (btnOnlyFg) btnOnlyFg.addEventListener('click', function () {
      try {
        var fg = _lockFg || foregroundVideo();
        if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var vs = allVideos();
        for (var i = 0; i < vs.length; i++) {
          if (vs[i] !== fg) try { userPause(vs[i]); } catch (e2) { swallow(e2); }
          else try { if (vs[i].__cxUserPaused) userResume(vs[i]); } catch (e2) { swallow(e2); }
        }
        Store.emit('ui:toast', '仅播此轨：已暂停其他 ' + (vs.length - 1) + ' 个视频', 'success');
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    // 快切按钮：全部续播（恢复所有视频）
    var btnResumeAll = el.querySelector('#__cxBtnResumeAll');
    if (btnResumeAll) btnResumeAll.addEventListener('click', function () {
      try {
        var vs = allVideos();
        for (var i = 0; i < vs.length; i++) { try { if (vs[i].__cxUserPaused) userResume(vs[i]); } catch (e2) { swallow(e2); } }
        Store.emit('ui:toast', '全部续播：已恢复 ' + vs.length + ' 个视频', 'success');
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    // 锁定前台开关
    var lockFg = el.querySelector('#__cxLockFg');
    if (lockFg) lockFg.addEventListener('change', function () {
      try {
        if (lockFg.checked) {
          _lockFg = foregroundVideo();
          Store.emit('ui:toast', '已锁定前台：滚动不会丢失前台资格');
        } else {
          _lockFg = null;
          Store.emit('ui:toast', '已解锁前台：恢复自动前台检测');
        }
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    var auto = el.querySelector('#__cxAuto');
    if (auto) auto.addEventListener('input', function () { CONFIG.AUTO_STOP_MIN = +auto.value; savePanelCfg(); Store.emit('panel:refresh'); });
    var res = el.querySelector('#__cxResume');
    res.addEventListener('input', function () { CONFIG.RESUME_AFTER_MIN = +res.value; savePanelCfg(); Store.emit('panel:refresh'); });
    var resc = el.querySelector('#__cxRescan');
    resc.addEventListener('input', function () {
      CONFIG.RESCAN_INTERVAL = +resc.value;
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }   // 实时重启轮询，使间隔立即生效
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }
      savePanelCfg(); Store.emit('panel:refresh');
    });
    var endrel = el.querySelector('#__cxEndRel');
    endrel.addEventListener('input', function () { CONFIG.END_RELEASE_SEC = +endrel.value; savePanelCfg(); Store.emit('panel:refresh'); });
    // 面板宽度：实时改 CSS 变量（正常态与 Ninja 展开态同步生效），并持久化
    var pw = el.querySelector('#__cxPanelW');
    if (pw) {
      pw.addEventListener('input', function () {
        CONFIG.PANEL_W = +pw.value;
        clampCfg();
        try { el.style.setProperty('--cx-panel-w', CONFIG.PANEL_W + 'px'); } catch (e) { swallow(e); }
        var pwv = el.querySelector('#__cxPanelWVal'); if (pwv) pwv.textContent = CONFIG.PANEL_W;
        savePanelCfg();
      });
    }
    var rateSel = el.querySelector('#__cxRate');
    if (rateSel) {
      rateSel.value = ('' + (CONFIG.USER_RATE || 1));
      rateSel.addEventListener('change', function () {
        var r = parseFloat(this.value);
        CONFIG.USER_RATE = (isNaN(r) ? 1 : r);
        clampCfg(); CONFIG.USER_RATE = (CONFIG.USER_RATE || 1);
        var rv = el.querySelector('#__cxRateVal'); if (rv) rv.textContent = CONFIG.USER_RATE + 'x';
        var tr = el.querySelector('#__cxTopRate'); if (tr) tr.textContent = '· ' + CONFIG.USER_RATE + 'x';   // 同步状态条速率
        savePanelCfg(); applyUserRateAll();
        Store.emit('panel:refresh');
      });
    }
    // Ninja 模式开关
    var ninja = el.querySelector('#__cxNinja');
    if (ninja) {
      ninja.addEventListener('change', function () {
        CONFIG.NINJA_MODE = !!ninja.checked;
        if (CONFIG.NINJA_MODE) {
          el.classList.add('ninja');
          el.classList.remove('ninja-open');
          Store.emit('ui:toast', 'Ninja 模式已开：面板缩成圆形，悬停或点击展开');
        } else {
          el.classList.remove('ninja', 'ninja-open');
          Store.emit('ui:toast', 'Ninja 模式已关');
        }
        savePanelCfg();
      });
    }
    // 退出 n 模式按钮（仅 Ninja 展开态显示）：一键恢复常驻宽面板，给卡在窄条的用户逃生通道
    var exitNinjaBtn = el.querySelector('#__cxExitNinja');
    if (exitNinjaBtn) exitNinjaBtn.addEventListener('click', function (e) { try { e.stopPropagation(); toggleNinjaMode(); } catch (e2) { swallow(e2); } });
    // Ninja 点击展开/收起：用 mouseup 而非 click——拖拽的 mousedown 调了 preventDefault，
    // 部分浏览器会吞掉后续 click，导致窄条点不开、永久卡死。mouseup 不受其影响，且 ninja-open
    // 为粘性展开态（不依赖 :hover），点开后保持，便于够到“退出 n 模式”复选框。
    var ninjaBar = el.querySelector('.cx-titlebar');
    if (ninjaBar) {
      ninjaBar.addEventListener('mouseup', function (e) {
        if (!el.classList.contains('ninja')) return;
        if (el.classList.contains('cx-dragging')) return;
        if (el._cxDragMoved) { el._cxDragMoved = false; return; }  // 拖拽结束后的误触，跳过
        if (e && e.button !== undefined && e.button !== 0) return;
        el.classList.toggle('ninja-open');
      });
    }
    try {
      pd.addEventListener('mousedown', function (e) {
        if (el.classList.contains('ninja') && el.classList.contains('ninja-open') && !el.contains(e.target)) {
          el.classList.remove('ninja-open');
        }
      });
    } catch (e3) { swallow(e3); }
    var dbg = el.querySelector('#__cxDebug');
    if (dbg) dbg.addEventListener('change', function () { try { DEBUG = !!dbg.checked; Store.emit('ui:toast', DEBUG ? '调试日志已开' : '调试日志已关'); } catch (e) { swallow(e); } savePanelCfg(); });
    var sv = el.querySelector('#__cxSingleVideo');
    if (sv) {
      sv.addEventListener('change', function () {
        CONFIG.SINGLE_VIDEO = !!sv.checked;
        if (CONFIG.SINGLE_VIDEO) {
          // 取消所有逐视频开关（userPaused 状态全部清除）
          try {
            var avs = allVideos();
            for (var ai = 0; ai < avs.length; ai++) { try { if (avs[ai][FLAGS.userPaused]) userResume(avs[ai]); } catch (e2) { swallow(e2); } }
          } catch (e) { swallow(e); }
          Store.emit('ui:toast', '单视频模式已开：仅前台播放，其他视频暂停', 'warn');
        } else {
          Store.emit('ui:toast', '单视频模式已关：恢复逐视频独立控制', 'warn');
        }
        savePanelCfg();
        Store.emit('panel:refresh');
      });
    }
    var lp = el.querySelector('#__cxLoop');
    if (lp) {
      lp.addEventListener('change', function () {
        CONFIG.LOOP_PLAY = !!lp.checked;
        try {
          if (CONFIG.LOOP_PLAY) Store.emit('ui:toast', '循环播放已开（当前视频播完将从头重播）', 'warn');
          else Store.emit('ui:toast', '循环播放已关（恢复默认防重播）', 'warn');
        } catch (e) { swallow(e); }
        savePanelCfg();
        applyLoopAll();        // 立即对当前所有视频施加 loop 状态，使开关即时生效（无需等下一轮重扫）
        Store.emit('panel:refresh');
      });
    }
    // —— 主从式导航：切换下方内容区块（localStorage 记住当前 tab）——
    function switchTab(name) {
      if (!_cxPanel) return;
      try {
        var tabs = _cxPanel.querySelectorAll('.cx-tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].style.display = (tabs[i].id === '__cxTab_' + name) ? 'block' : 'none';
        var btns = _cxPanel.querySelectorAll('.cx-nav-btn');
        for (var j = 0; j < btns.length; j++) {
          var _sel = (btns[j].getAttribute('data-tab') === name);
          btns[j].style.background = _sel ? STYLES.T.primary : STYLES.T.surface;
          btns[j].style.color = _sel ? '#ffffff' : STYLES.T.text2;
          btns[j].style.fontWeight = _sel ? '600' : '400';
          btns[j].style.border = '1px solid ' + (_sel ? STYLES.T.primary : STYLES.T.border);
        }
        try { localStorage.setItem('cx_panel_tab', name); } catch (e2) { swallow(e2); }
        _cxActiveTab = name;
      } catch (e) { swallow(e); }
    }
    try { Store.onEv('ui:switchTab', function (name) { try { switchTab(name); } catch (e) { swallow(e); } }); } catch (e) { swallow(e); }   // 供命令框 /tab 调用
    var navBtns = el.querySelectorAll('.cx-nav-btn');
    for (var ni = 0; ni < navBtns.length; ni++) {
      (function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); }); })(navBtns[ni]);
    }
    el.querySelector('#__cxBtnCopy').addEventListener('click', copyDiagnostics);
    // 黑匣子导出按钮
    var btnExport = el.querySelector('#__cxBtnExport');
    if (btnExport) btnExport.addEventListener('click', function () {
      try {
        var lines = [];
        var now = Date.now();
        lines.push('=== 黑匣子日志 ===');
        lines.push('导出时间: ' + new Date().toLocaleString());
        lines.push('记录条数: ' + _bxBuffer.length + ' / ' + _bxCap + ' 条');
        lines.push('最近1分钟: ' + _bxBuffer.filter(function(e) { return (now - e.ts) <= 60000; }).length + ' 条');
        lines.push('');
        for (var i = 0; i < _bxBuffer.length; i++) {
          var e = _bxBuffer[i];
          var age = Math.round((now - e.ts) / 1000) + 's前';
          var time = new Date(e.ts).toLocaleTimeString();
          lines.push('[' + time + ' | -' + age + '] ' + e.action + (e.detail ? '  ' + e.detail : ''));
        }
        var text = lines.join('\n');
        try {
          navigator.clipboard.writeText(text).then(function () {
            Store.emit('ui:toast', '已复制 ' + _bxBuffer.length + ' 条日志到剪贴板');
          }, function () { alert(text); });
        } catch (e2) {
          // Fallback: 弹窗显示
          var w = window.open('', '_blank', 'width=700,height=500');
          if (w) { w.document.write('<pre>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>'); }
          else alert(text);
        }
      } catch (e) { swallow(e); }
    }, false);
    // 清空黑匣子（Danger 级：破坏性操作，confirm 二次确认，设计 §6.1）
    var btnClearBx = el.querySelector('#__cxBtnClearBx');
    if (btnClearBx) btnClearBx.addEventListener('click', function () {
      try {
        if (!confirm('确认清空黑匣子日志？（' + _bxBuffer.length + ' 条，清空后不可恢复）')) return;
        _bxBuffer.length = 0;
        Store.emit('ui:toast', '黑匣子日志已清空', 'warn');
      } catch (e) { swallow(e); }
    });
    _cxPanel = el;
    syncPanelInputs();
    drainAddonQueue();   // 面板建成后渲染已注册的副脚本开关（含晚于本脚本注册的）
    switchTab(_cxActiveTab || 'control');   // 主从式导航：应用上次选中的区块（默认 主控）
    positionPanel();   // 适配 progress-panel：若其已挂载，则下沉避让避免同角重叠
    return el;
  }
