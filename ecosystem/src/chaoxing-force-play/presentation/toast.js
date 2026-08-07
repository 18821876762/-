  // ===== DOMAIN: ui toast =====
  // ===== MODULE: 轻提示组件(toast) =====
  // 域：界面层 —— 全局轻提示（反馈分级）。
  //
  // 【内聚性收敛】本组件原寄居于 takeover/dom/dom.js（接管引擎），与 overrideVideo/walkVideos 等 DOM 接管逻辑混居。
  // 它实为纯 UI 渲染单元：只读 STYLES，只写一个 #__cxToast 节点，不触碰任何 video 状态，故迁入 ui 域。
  //
  // 【调用契约】全代码库一律通过 Store.emit('ui:toast', msg, level) 触发，从不直接调用 toast()。
  //   订阅侧在 presentation/panel.js：Store.onEv('ui:toast', toast)。
  //   因此本次迁移是纯位置移动，零调用点改动——emit/on 的解耦让发布方无需知道渲染实现在哪个模块。
  //
  // 依赖：STYLES（presentation/styles.js，构建顺序在前）/ cxState（utils）/ swallow（utils）。

  // P5c 反馈分级：toast(msg, level) —— info(默认黑边) / success(绿边) / warn(黄边) / error(红边)（设计 §6.1）
  // 悬浮策略（用户诉求：悬浮只在关键时出现 + 工具库可一键关闭所有脚本弹窗）：
  //   1) 静默模式(_quietPopups)开启 → 完全不悬浮（一切提示仍只进「洞察」页提示流）；
  //   2) 否则仅当 level 为关键级(critical/error)才悬浮，info/success/warn 默认只进洞察页，不再一闪而过刷屏。
  var _FLOAT_LEVELS = { critical: 1, error: 1 };
  function toast(msg, level) {
    try {
      if (_quietPopups) return;                         // 工具库「关闭脚本弹窗」开启：彻底不悬浮
      if (!_FLOAT_LEVELS[level]) return;                // 悬浮只在关键时出现：info/success/warn 仅进洞察页
      var t = document.getElementById('__cxToast');
      if (!t) { t = document.createElement('div'); t.id = '__cxToast'; t.style.cssText = STYLES.TOAST; if (document.body) document.body.appendChild(t); }
      if (!t) return;
      var edge = { success: STYLES.T.success, warn: STYLES.T.warning, error: STYLES.T.danger }[level] || 'transparent';
      t.style.borderLeft = '3px solid ' + edge;
      t.textContent = '[CX] ' + msg;
      t.style.display = 'block';
      clearTimeout(cxState(t).timer); cxState(t).timer = setTimeout(function () { if (t) t.style.display = 'none'; }, 1500);
    } catch (e) { swallow(e); }
  }

  // —— 静默弹窗（关闭脚本弹窗）全局开关 ——
  // 由工具库项 quiet-popups.js 经 setQuietPopups 切换；开启后所有悬浮 toast / 红色报警条 / OS 通知都不弹，
  // 仅「洞察」页提示流保留（符合用户诉求：关闭除控制面板外的所有脚本弹窗）。
  var _quietPopups = false;
  try { if (localStorage.getItem('cx_quiet_popups') === '1') _quietPopups = true; } catch (e) {}
  function setQuietPopups(v) {
    try {
      _quietPopups = !!v;
      localStorage.setItem('cx_quiet_popups', _quietPopups ? '1' : '0');
      if (_quietPopups) {
        // 立即收起所有进行中的脚本悬浮层（不仅 #__cxToast，还包括未被事件总线覆盖的硬编码浮层）
        var ids = ['__cxToast', 'cxTgBar', 'cx-ds-status', 'cxKbHint'];
        for (var i = 0; i < ids.length; i++) { var t = document.getElementById(ids[i]); if (t) t.style.display = 'none'; }
      }
    } catch (e) {}
  }
  function isQuietPopups() { return _quietPopups; }
  try {
    window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
    window.__CX_FORCE_PLAY.setQuietPopups = setQuietPopups;
    window.__CX_FORCE_PLAY.isQuietPopups = isQuietPopups;
  } catch (e) {}
