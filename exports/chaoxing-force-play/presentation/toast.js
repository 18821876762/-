// @requires: CX_KEYS, STYLES, bestEffort, cxState
  // ===== DOMAIN: ui toast =====
  // ===== MODULE: 轻提示组件(toast) =====
  // 域：界面层 —— 全局轻提示（反馈分级）。
  //
  // 【内聚性收敛】本组件原寄居于 takeover/dom/dom.js（接管引擎），与 overrideVideo/walkVideos 等 DOM 接管逻辑混居。
  // 它实为纯 UI 渲染单元：只读 STYLES，只写一个 #__cxToast 节点，不触碰任何 video 状态，故迁入 ui 域。
  //
  // 【调用契约】全代码库一律通过 EventBus.emit('ui:toast', msg, level) 触发，从不直接调用 toast()。
  //   订阅侧在 presentation/panel.js：EventBus.onEv('ui:toast', toast)。
  //   因此本次迁移是纯位置移动，零调用点改动——emit/on 的解耦让发布方无需知道渲染实现在哪个模块。
  //
  // 依赖：STYLES（presentation/styles.js，构建顺序在前）/ cxState（utils）/ swallow（utils）。

  // P5c 反馈分级：toast(msg, level) —— info(默认黑边) / success(绿边) / warn(黄边) / error(红边)（设计 §6.1）
  // 悬浮策略（用户诉求：悬浮只在关键时出现 + 工具库可一键关闭所有脚本弹窗）：
  //   1) 静默模式(_quietPopups)开启 → 完全不悬浮（一切提示仍只进「洞察」页提示流）；
  //   2) 否则仅当 level 为关键级(critical/error)才悬浮，info/success/warn 默认只进洞察页，不再一闪而过刷屏。
  var _FLOAT_LEVELS = { critical: 1, error: 1 };
  var _TOAST_HIDE_MS = 1500;   // 悬浮停留时长（提为具名常量，避免散落的裸数字）
  function toast(msg, level) {
    bestEffort(function () {
      if (_quietPopups) return;                         // 工具库「关闭脚本弹窗」开启：彻底不悬浮
      if (!_FLOAT_LEVELS[level]) return;                // 悬浮只在关键时出现：info/success/warn 仅进洞察页
      var t = document.getElementById('__cxToast');
      if (!t) { t = document.createElement('div'); t.id = '__cxToast'; t.style.cssText = STYLES.TOAST; if (document.body) document.body.appendChild(t); }
      if (!t) return;
      // UI 规范 §Toast：左上角语义色小图标 + 文字，进入/离开 200ms 滑入滑出。
      var iconMap = { success: '✓', warn: '!', error: '✕' };
      var colorMap = { success: STYLES.T.success, warn: STYLES.T.warning, error: STYLES.T.danger }[level] || STYLES.T.text3;
      t.innerHTML = '';
      var ico = document.createElement('span');
      ico.className = '__cxToastIcon';
      ico.textContent = iconMap[level] || 'i';
      ico.style.cssText = 'width:16px;height:16px;flex-shrink:0;font-size:13px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;color:' + colorMap + ';';
      var txt = document.createElement('span');
      txt.style.cssText = 'min-width:0;word-break:break-word;';
      txt.textContent = '[CX] ' + msg;
      t.appendChild(ico); t.appendChild(txt);
      t.classList.remove('leaving');
      t.style.animation = '';   // 清掉上次的 cx-toast-out 内联值，恢复 STYLES.TOAST 的进入动画
      t.style.display = 'flex';
      clearTimeout(cxState(t).timer);
      cxState(t).timer = setTimeout(function () {
        if (!t) return;
        t.classList.add('leaving');
        t.style.animation = 'cx-toast-out .2s var(--cx-ease) forwards';
        setTimeout(function () { if (t) t.style.display = 'none'; }, 200);
      }, _TOAST_HIDE_MS);
    }, 'toast.show');
  }

  // —— 静默弹窗（关闭脚本弹窗）全局开关 ——
  // 由工具库项 quiet-popups.js 经 setQuietPopups 切换；开启后所有悬浮 toast / 红色报警条 / OS 通知都不弹，
  // 仅「洞察」页提示流保留（符合用户诉求：关闭除控制面板外的所有脚本弹窗）。
  var _quietPopups = false;
  bestEffort(function () { if (localStorage.getItem(CX_KEYS.QUIET_POPUPS) === '1') _quietPopups = true; }, 'toast.quietLoad');
  function setQuietPopups(v) {
    bestEffort(function () {
      _quietPopups = !!v;
      localStorage.setItem(CX_KEYS.QUIET_POPUPS, _quietPopups ? '1' : '0');
      if (_quietPopups) {
        // 立即收起所有进行中的脚本悬浮层（不仅 #__cxToast，还包括未被事件总线覆盖的硬编码浮层）
        var ids = ['__cxToast', 'cxTgBar', 'cx-ds-status', 'cxKbHint'];
        for (var i = 0; i < ids.length; i++) { var t = document.getElementById(ids[i]); if (t) t.style.display = 'none'; }
      }
    }, 'toast.setQuiet');
  }
  function isQuietPopups() { return _quietPopups; }
  bestEffort(function () {
    window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
    window.__CX_FORCE_PLAY.setQuietPopups = setQuietPopups;
    window.__CX_FORCE_PLAY.isQuietPopups = isQuietPopups;
  }, 'toast.export');
