  // ===== DOMAIN: ui toast =====
  // ===== MODULE: 轻提示组件(toast) =====
  // 域：界面层 —— 全局轻提示（反馈分级）。
  //
  // 【内聚性收敛】本组件原寄居于 dom/dom.js（接管引擎），与 overrideVideo/walkVideos 等 DOM 接管逻辑混居。
  // 它实为纯 UI 渲染单元：只读 STYLES，只写一个 #__cxToast 节点，不触碰任何 video 状态，故迁入 ui 域。
  //
  // 【调用契约】全代码库一律通过 Store.emit('ui:toast', msg, level) 触发，从不直接调用 toast()。
  //   订阅侧在 ui/panel.js：Store.onEv('ui:toast', toast)。
  //   因此本次迁移是纯位置移动，零调用点改动——emit/on 的解耦让发布方无需知道渲染实现在哪个模块。
  //
  // 依赖：STYLES（ui/styles.js，构建顺序在前）/ cxState（utils）/ swallow（utils）。

  // P5c 反馈分级：toast(msg, level) —— info(默认黑边) / success(绿边) / warn(黄边) / error(红边)（设计 §6.1）
  function toast(msg, level) {
    try {
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
