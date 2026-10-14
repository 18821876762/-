// @provides: _cxPanelOwnerClaim
// @requires: CONFIG, EventBus, FLAGS, STYLES, _cxPanel, bestEffort, copyDiagnostics, foregroundVideo, lsGet, lsSet, safeGet, toggleNinjaMode, userPause, userResume
// @source-group: presentation/panel-core.js
  // ===== DOMAIN: presentation/panel-core (panel assembly + control/command events + navigation) =====
  // Panel assembly: create DOM, inject styles, bind video/control/command events and main-sub navigation.
  // DeepSeek 应答端控制台绑定(bindDSConsole/_dsUpdateConsole)已抽到 presentation/panel-ds-console.js（行数红线合规）。

  // 提示流（洞察页 toast 反馈子系统）已拆分至 presentation/panel-toast-feed.js（治理·单文件红线 >350 合规）。
  // ensurePanel 仍通过同打包作用域调用 _onToastForFeed / _flushToastFeed / _findFeedBox，行为不变。

  // D9 修复：Ninja 面板外点击收起用的全局 mousedown 监听——改为模块级命名函数 + 单次绑定标记，
  // 避免每次 ensurePanel 都重复 addEventListener（旧实现会在跨 iframe/重构建时泄漏全局监听），
  // 并在 uninstall 时由 lifecycle.js 的 cleanupListeners 显式 removeEventListener。
  var _panelOutsideClickBound = false;
  // P2 修复（内存核查·事件总线重注册）：面板重建时一次性守卫，避免 ui:switchTab 监听器累积 + 旧 el 闭包泄漏。
  // 必须置于模块作用域（不能放 ensurePanel 函数体内），否则每次调用被重新 =false 导致守卫失效。
  var _switchSubscribed = false;
  function panelNinjaOutsideClick(e) {
    if (_cxPanel && _cxPanel.classList.contains('ninja') && _cxPanel.classList.contains('ninja-open') && !_cxPanel.contains(e.target)) {
      _cxPanel.classList.remove('ninja-open');
    }
  }

  // R5 修复：面板 owner 帧存活判定 + 抢占（避免 owner 帧卸载后列表永久冻结）。
  // owner 为空→本帧接管；owner 为本帧→可写；owner 为他人帧→跳过（单一事实源=owner 帧）。
  function _cxPanelOwnerClaim() {
    if (!_cxPanel) return false;
    if (!_cxPanel._cxPanelOwner) { _cxPanel._cxPanelOwner = window; return true; }
    return _cxPanel._cxPanelOwner === window;
  }
  var _ownerReleaseFn = null;   // R5：owner 帧卸载时释放 _cxPanelOwner，供存活帧重新接管

  function ensurePanel() {
    // R11 修复（真·多帧沙箱 sim-multiframe 发现）：缓存的面板节点可能已被移出文档
    // （另一帧卸载清理、站点 SPA 整段替换 body、用户在别的帧点了卸载）。此时旧实现直接
    // 返回这个"脱离态"节点，一切读写都打在看不见的孤儿 DOM 上 → 面板永久消失且按 P 无效。
    // 自愈：发现缓存节点已不在任何文档内就丢弃缓存，走下面的重建流程。
    if (_cxPanel && !safeGet(function () { return _cxPanel.isConnected !== false; }, true)) {
      _cxPanel = null;
    }
    if (_cxPanel) return _cxPanel;
    // 面板落点：同源顶层(window.top)可达则挂在顶层文档，保证全站仅一个面板且跨 iframe 聚合所有视频；
    // 跨域嵌入(顶层不可达)时回退挂本帧文档。用全局 id 守卫避免每个 frame 各建一个面板——
    // 旧行为会导致"面板被建在视频 iframe 内、且只看见那一帧的 1 个视频、必须点进 iframe 才能用 P 键"。
    // 跨域 iframe 下直接访问 window.top.document 会抛 SecurityError（cross-origin frame）。
    // 必须 safeGet 包裹，跨域时回退本帧 document，否则 ensurePanel 在视频 iframe 内直接崩溃、
    // 面板永远建不出来（表现：iframe 嵌套窗口里"无法打开控制面板"，且被 bestEffort 静默吞掉无报错）。
    var pd = safeGet(function () {
      return (window.top && window.top.document && window.top.document.body) ? window.top.document : document;
    }, document);
    var _cxExisting = pd.getElementById('__cxPanel');   // getElementById 从不抛异常
    if (_cxExisting) { _cxPanel = _cxExisting; _cxExisting._cxPanelOwner = _cxExisting._cxPanelOwner || window; return _cxExisting; }   // 已存在(别的 frame 建的)：复用并记录首次创建者帧，防止多 iframe 竞争写同 DOM（事件与视频列表数据按创建者帧一致）
    // 修复 #16：body 尚未就绪时，面板若被立即构建会游离在 DOM 之外（pd.body.appendChild
    // 跳过），_cxPanel 即使被赋值也不可见。改为 deferred：等 DOMContentLoaded / rAF 后再构建，
    // 期间返回 null，调用方均已对 null 做了安全处理（if (_cxPanel) ...）。
    if (!pd.body) {
      bestEffort(function () {
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
      }, 'panel.deferredBuild');
      return null;
    }
    var el = pd.createElement('div');
    el.id = '__cxPanel';
    el.style.cssText = STYLES.PANEL_BOX;
    // 应用持久化的面板宽度（CSS 变量单一事实源：正常态与 Ninja 展开态共用，见 STYLES.PANEL_BOX / NINJA_STYLE）
    bestEffort(function () { el.style.setProperty('--cx-panel-w', (CONFIG.PANEL_W || 340) + 'px'); }, 'panel.setWidth');
    // 空态成文（设计 §6.3）：面板未能挂顶层文档（跨域 iframe 回退）时标题栏给出可见标记
    // 同上：跨域访问 window.top.document 会抛错，必须 safeGet 包裹；跨域即视为 inFrame（与回退本帧一致）。
    var _inFrame = !safeGet(function () {
      return !!(window.top && window.top.document && window.top.document.body);
    }, false);
    el.innerHTML = buildPanelHTML(_inFrame);
    if (pd.body) pd.body.appendChild(el);
    el._cxPanelOwner = window;   // S3: 记录面板创建者帧，供 dashboard.js renderVideoList 所有者守卫使用
    // R5 修复：创建者帧卸载时释放 owner，避免存活帧因旧 owner 失效而永久冻结列表
    bestEffort(function () {
      // 仅创建并绑定一次（审查 §3.5）：ensurePanel 可能多次调用，避免 pagehide 监听叠加
      if (_ownerReleaseFn) return;
      _ownerReleaseFn = function () {
        try { if (_cxPanel && _cxPanel._cxPanelOwner === window) _cxPanel._cxPanelOwner = null; } catch (e) {}
      };
      if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', _ownerReleaseFn, false);
      else if (typeof window.attachEvent === 'function') window.attachEvent('onpagehide', _ownerReleaseFn);
    }, 'panel.ownerRelease');
    // 提示流（洞察页）：订阅已在 panel-toast-feed.js 模块加载时提前完成（面板未打开也记录提示史，
    // 供诊断「提示流」分区取数）；此处守卫保留作兜底，_feedSubscribed 共享保证全局仅订阅一次。
    if (!_feedSubscribed) {
      _feedSubscribed = true;
      bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.onEv) EventBus.onEv('ui:toast', _onToastForFeed); }, 'panel.feedSubscribe');
    }
    _flushToastFeed();
    var btnClearFeed = el.querySelector('#__cxBtnClearFeed');
    if (btnClearFeed) btnClearFeed.addEventListener('click', function () {
      _toastFeedBuf.length = 0;
      _toastFeedLog.length = 0;   // 结构化提示史一并清空（诊断「提示流」分区与 UI 口径一致）
      _clearToastFeedPersist();   // v4.19.50：持久化副本一并清除（跨会话不再回放已清历史）
      var b = _findFeedBox(); if (b) { while (b.firstChild) b.removeChild(b.firstChild); }
    });
    // —— 移动端适配：窄屏下主控面板自适应宽度、放大点按区、缩小字号（仅注入一次）——
    if (!pd.getElementById('__cxPanelMobileStyle')) {
      bestEffort(function () {
        var ms = pd.createElement('style');
        ms.id = '__cxPanelMobileStyle';
        ms.textContent = STYLES.PANEL_MOBILE;
        if (pd.head) pd.head.appendChild(ms);
      }, 'panel.mobileStyle');
    }
    // —— Ninja 模式样式：面板默认缩成窄条，鼠标悬停展开（仅注入一次）——
    if (!pd.getElementById('__cxPanelNinjaStyle')) {
      bestEffort(function () {
        var ns = pd.createElement('style');
        ns.id = '__cxPanelNinjaStyle';
        ns.textContent = STYLES.NINJA_DEFAULT + STYLES.NINJA_STYLE;
        if (pd.head) pd.head.appendChild(ns);
      }, 'panel.ninjaStyle');
    }
    // —— 动效与精密感样式：呼吸灯/环形仪表/等宽数字/微交互（仅注入一次）——
    if (!pd.getElementById('__cxPanelAnimStyle')) {
      bestEffort(function () {
        var as = pd.createElement('style');
        as.id = '__cxPanelAnimStyle';
        as.textContent = STYLES.ANIM;
        if (pd.head) pd.head.appendChild(as);
      }, 'panel.animStyle');
    }
    // Ninja 模式：应用/移除 ninja CSS class
    if (CONFIG.NINJA_MODE) el.classList.add('ninja');
    el.title = CONFIG.NINJA_MODE ? 'n 模式：点击面板展开 / 再次点击收起' : '';
    // 悬浮球位置记忆（仅 Ninja 模式生效）：拖拽落点写 localStorage，重启恢复；切换 Ninja 时按当前宽度重算落点防裁切。
    if (CONFIG.NINJA_MODE) { restoreNinjaPos(); clampNinjaPos(); }
    // —— Ninja 悬浮球辅助能力（位置记忆 / 状态 aria / 右键快捷菜单）——
    function setNinjaAria() {
      var fab = el.querySelector('.cx-ninja-fab');
      if (!fab) return;
      bestEffort(function () { fab.setAttribute('aria-expanded', el.classList.contains('ninja-open') ? 'true' : 'false'); }, 'panel.ninjaAria');
    }
    function clampNinjaPos() {
      bestEffort(function () {
        if (!el.style.left && !el.style.top) return;   // 未拖拽过：保持 CSS 默认安全位
        var w = el.offsetWidth || 40, h = el.offsetHeight || 40;
        var vw = (window.innerWidth || 0), vh = (window.innerHeight || 0);
        if (!vw || !vh) return;
        var left = parseFloat(el.style.left) || 0, top = parseFloat(el.style.top) || 0;
        left = Math.max(0, Math.min(left, vw - w)); top = Math.max(0, Math.min(top, vh - h));
        el.style.left = left + 'px'; el.style.top = top + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      }, 'panel.clampNinjaPos');
    }
      // 线程审计：reclampSoon 句柄管理——连续展开（点击/切 tab/切 n 模式）不再堆积一次性定时器（旧实现无句柄，
    // 快速连续切换会叠多个 320ms 定时器各自执行一次 clampNinjaPos）。
    var _reclampTimer = null;
    function reclampSoon() {
      if (_reclampTimer) { clearTimeout(_reclampTimer); }
      _reclampTimer = setTimeout(function () { _reclampTimer = null; clampNinjaPos(); }, 320);   // 展开过渡(0.28s)后再按最终宽度重算落点
    }
    function restoreNinjaPos() {
      bestEffort(function () {
        var raw = lsGet('cx_ninja_pos'); if (!raw) return;
        var pos = (function () { try { return JSON.parse(raw); } catch (e) { return null; } })();
        if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
          el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px';
          el.style.right = 'auto'; el.style.bottom = 'auto';
        }
      }, 'panel.restoreNinjaPos');
    }
    function saveNinjaPos() {
      bestEffort(function () {
        var left = parseFloat(el.style.left), top = parseFloat(el.style.top);
        if (isNaN(left) || isNaN(top)) { lsSet('cx_ninja_pos', ''); return; }
        lsSet('cx_ninja_pos', JSON.stringify({ left: left, top: top }));
      }, 'panel.saveNinjaPos');
    }
    function showFabMenu(x, y) {
      bestEffort(function () {
        var old = document.getElementById('__cxNinjaMenu'); if (old) old.remove();
        var m = document.createElement('div'); m.id = '__cxNinjaMenu'; m.setAttribute('role', 'menu');
        m.style.cssText = 'position:fixed;z-index:2147483647;min-width:168px;background:var(--cx-surface,#FFFFFF);color:var(--cx-text,#111827);border:1px solid var(--cx-border,#E5E7EB);border-radius:8px;box-shadow:var(--cx-shadow-md,0 4px 12px rgba(0,0,0,0.08),0 2px 4px rgba(0,0,0,0.04));padding:4px;font:13px/1.4 system-ui,sans-serif;';
        function add(label, fn) {
          var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
          b.textContent = label;
          b.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:6px;font:inherit;';
          b.addEventListener('mouseenter', function () { b.style.background = 'var(--cx-surface3,#f2f2f5)'; });
          b.addEventListener('mouseleave', function () { b.style.background = 'transparent'; });
          b.addEventListener('click', function () { bestEffort(fn, 'fabMenu'); m.remove(); });
          m.appendChild(b);
        }
        add('暂停/恢复续播', function () { var fg = (typeof foregroundVideo === 'function') ? foregroundVideo() : null; if (!fg) { EventBus.emit('ui:toast', '没有可控制的视频'); return; } if (fg[FLAGS.userPaused]) userResume(fg); else userPause(fg); EventBus.emit('panel:refresh'); });
        add('退出 Ninja 模式', function () { toggleNinjaMode(); });
        add('静音前台视频', function () { var fg = (typeof foregroundVideo === 'function') ? foregroundVideo() : null; if (fg) { fg.muted = !fg.muted; EventBus.emit('ui:toast', fg.muted ? '已静音前台视频' : '已取消静音'); } });
        add('复制诊断信息', function () { if (typeof copyDiagnostics === 'function') copyDiagnostics(); });
        document.body.appendChild(m);
        var r = m.getBoundingClientRect();
        var mx = Math.max(8, Math.min(x, (window.innerWidth || x) - r.width - 8));
        var my = Math.max(8, Math.min(y, (window.innerHeight || y) - r.height - 8));
        m.style.left = mx + 'px'; m.style.top = my + 'px';
        var close = function (ev) { if (!ev) return; if (ev.type === 'keydown' && ev.key !== 'Escape') return; if (ev.target && m.contains(ev.target)) return; m.remove(); document.removeEventListener('mousedown', close, true); document.removeEventListener('keydown', close, true); };
        setTimeout(function () { document.addEventListener('mousedown', close, true); document.addEventListener('keydown', close, true); }, 0);
      }, 'panel.fabMenu');
    }
