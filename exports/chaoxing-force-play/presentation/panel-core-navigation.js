// @requires: CONFIG, CX_KEYS, DEBUG, EventBus, FLAGS, _cxPanel, allVideos, bestEffort, copyDiagnostics, detectSite, savePanelCfg, userResume
// @source-group: presentation/panel-core.js
// @continuation-of: presentation/panel-core.js
// Configuration, navigation, and final assembly inside ensurePanel.
    // ninja 纯 hover 展开（CSS :hover，不触发 titlebar mouseup）时，鼠标进入面板刷新一次动态内容，
    // 否则用户悬停胶囊看到的是上次填充的快照或模板静态占位，洞察/系统页显得"空/不更新"。
    // mouseenter 不冒泡，只在真正进入面板根元素时触发一次，无需节流。
    el.addEventListener('mouseenter', function () {
      if (!el.classList.contains('ninja')) return;   // 非 ninja 不处理（常驻面板由主循环节流刷新）
      bestEffort(function () { EventBus.emit('panel:refresh'); }, 'panel.mouseEnter');
    });
    var dbg = el.querySelector('#__cxDebug');
    if (dbg) dbg.addEventListener('change', function () { bestEffort(function () { DEBUG = !!dbg.checked; EventBus.emit('ui:toast', DEBUG ? '调试日志已开' : '调试日志已关'); }, 'panel.debugToggle'); savePanelCfg(); });
    var sv = el.querySelector('#__cxSingleVideo');
    if (sv) {
      sv.addEventListener('change', function () {
        CONFIG.SINGLE_VIDEO = !!sv.checked;
        if (CONFIG.SINGLE_VIDEO) {
          // 取消所有逐视频开关（userPaused 状态全部清除）
          bestEffort(function () {
            var avs = allVideos();
            for (var ai = 0; ai < avs.length; ai++) { bestEffort(function (v) { if (v[FLAGS.userPaused]) userResume(v); }.bind(null, avs[ai]), 'panel.svResume'); }
          }, 'panel.singleVideo');
          EventBus.emit('ui:toast', '单视频模式已开：仅前台播放，其他视频暂停', 'warn');
        } else {
          EventBus.emit('ui:toast', '单视频模式已关：恢复逐视频独立控制', 'warn');
        }
        savePanelCfg();
        EventBus.emit('panel:refresh');
      });
    }
    var lp = el.querySelector('#__cxLoop');
    if (lp) {
      lp.addEventListener('change', function () {
        CONFIG.LOOP_PLAY = !!lp.checked;
        bestEffort(function () {
          if (CONFIG.LOOP_PLAY) EventBus.emit('ui:toast', '循环播放已开（当前视频播完将从头重播）', 'warn');
          else EventBus.emit('ui:toast', '循环播放已关（恢复默认防重播）', 'warn');
        }, 'panel.loopToast');
        savePanelCfg();
        applyLoopAll();        // 立即对当前所有视频施加 loop 状态，使开关即时生效（无需等下一轮重扫）
        EventBus.emit('panel:refresh');
      });
    }
    // #1 温和/礼貌模式 + 黑匣子：控制区事件绑定抽到 presentation/panel-controls.js（行数红线合规）
    bindPanelControlEvents(el);
    // —— 主从式导航：切换下方内容区块（localStorage 记住当前 tab）——
    function switchTab(name) {
      if (!_cxPanel) return;
      bestEffort(function () {
        // 守卫：无效 tab 名（如残留 localStorage cx_panel_tab、/tab 传入非法值）会把所有 .cx-tab 设成 display:none → 整面板空白。
        // 先扫描确认有匹配项，无匹配则回退 control，避免"切 tab 后全空白"。
        var tabs = _cxPanel.querySelectorAll('.cx-tab');
        var matched = false;
        for (var i = 0; i < tabs.length; i++) { if (tabs[i].id === '__cxTab_' + name) { matched = true; break; } }
        if (!matched) { if (name !== 'control') { switchTab('control'); } return; }
        for (var k = 0; k < tabs.length; k++) {
          var _cur = (tabs[k].id === '__cxTab_' + name);
          tabs[k].style.display = _cur ? 'block' : 'none';
          // 标记当前活跃 tab，供 ninja 折叠态 CSS 例外放行（!important 压过内联 display 的修复）
          if (_cur) tabs[k].classList.add('cx-tab--cur'); else tabs[k].classList.remove('cx-tab--cur');
        }
        var btns = _cxPanel.querySelectorAll('.cx-seg-btn');
        for (var j = 0; j < btns.length; j++) {
          var _sel = (btns[j].getAttribute('data-tab') === name);
          btns[j].classList.toggle('active', _sel);
        }
        bestEffort(function () { localStorage.setItem(CX_KEYS.PANEL_TAB, name); }, 'panel.tabLocalStorage');
        _cxActiveTab = name;
      }, 'panel.switchTab');
    }
    // P2 修复（内存核查·事件总线重注册）：原实现每次走完整构建都 EventBus.onEv('ui:switchTab', ...)，无 off 守卫。
    // 当面板节点被 SPA 整段替换 body / 其他帧卸载清理而脱离文档时，R11 自愈把 _cxPanel 置空并重建 → 旧处理器闭包仍持有
    // 已脱离文档的旧 el（无法 GC）+ 监听器线性累积。与 _feedSubscribed 守卫对齐：仅注册一次；且 handler 内改用模块级当前
    // _cxPanel（而非重建时捕获的局部 el），保证跨重建后仍操作"活的"面板节点、不泄漏旧 DOM 闭包。
    if (!_switchSubscribed) {
      _switchSubscribed = true;
      bestEffort(function () {
        EventBus.onEv('ui:switchTab', function (name) {
          bestEffort(function () {
            switchTab(name);
            bestEffort(function () { if (_cxPanel && _cxPanel.classList.contains('ninja') && !_cxPanel.classList.contains('ninja-open')) { _cxPanel.classList.add('ninja-open'); reclampSoon(); setNinjaAria(); } }, 'panel.tabNinjaOpen');
            bestEffort(function () { EventBus.emit('panel:refresh'); }, 'panel.tabRefresh');
          }, 'panel.switchTabHandler');
        });
      }, 'panel.switchTabEvents');
    }
    // 供命令框 /tab 调用
    var navBtns = el.querySelectorAll('.cx-nav-btn');
    for (var ni = 0; ni < navBtns.length; ni++) {
      // 切 tab 时同步刷新动态内容：洞察/系统/自动化页靠 panel:refresh 填充，否则切过去是"面板打开那一刻"的快照，甚至从未填充→空白
      (function (b) { b.addEventListener('click', function () {
        switchTab(b.getAttribute('data-tab'));
        // ninja 模式：切到非默认 tab 后，鼠标移开面板会被 CSS `:not(:hover):not(.ninja-open)` 把 .cx-tab 重新 display:none!important 隐藏，
        // 导致"点开又空回去"。这里粘性展开 ninja-open，让用户能留在展开态看内容（移出面板由 document mouseup 关闭）。
        bestEffort(function () { if (el.classList.contains('ninja') && !el.classList.contains('ninja-open')) { el.classList.add('ninja-open'); reclampSoon(); setNinjaAria(); } }, 'panel.navNinjaOpen');
        bestEffort(function () { EventBus.emit('panel:refresh'); }, 'panel.navRefresh');
      }); })(navBtns[ni]);
    }
    // 防御：复制诊断按钮缺失不应中断 ensurePanel（否则 _cxPanel/switchTab/panel:refresh 全不执行 → 整面板空白）
    var btnCopy = el.querySelector('#__cxBtnCopy');
    if (btnCopy) btnCopy.addEventListener('click', copyDiagnostics);
    // 安全审计（建议#10）：刷新「洞察」页侵入点清单
    var btnAudit = el.querySelector('#__cxBtnAudit');
    if (btnAudit) btnAudit.addEventListener('click', function () { bestEffort(function () { EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '已刷新侵入点清单'); }, 'panel.audit'); });
    // 开发者模式：刷新功能自检矩阵（同时刷新诊断信息，二者联动）
    var btnSelfTest = el.querySelector('#__cxBtnSelfTest');
    if (btnSelfTest) btnSelfTest.addEventListener('click', function () { bestEffort(function () { EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '已刷新功能自检矩阵 + 诊断信息（联动）'); }, 'panel.selfTest'); });
    _cxPanel = el;
    syncPanelInputs();
    drainAddonQueue();   // 面板建成后渲染已注册的工具库项开关（含晚于本脚本注册的）
    switchTab(_cxActiveTab || 'control');   // 主从式导航：应用上次选中的区块（默认 主控）
    if (typeof detectSite === 'function' && detectSite() === 'deepseek') bindDSConsole(el);   // DS 页特化：绑定应答端控制台逻辑
    positionPanel();   // 适配 progress-panel：若其已挂载，则下沉避让避免同角重叠
    bestEffort(function () { EventBus.emit('panel:refresh'); }, 'panel.bootRefresh');
    return el;
  }

