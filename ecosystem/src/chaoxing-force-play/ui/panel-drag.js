  // ===== DOMAIN: ui/panel-drag (panel drag + ninja side) =====
  // Panel dragging (compositor-layer optimization) and Ninja strip side detection.
  // 拖拽移动面板（修复 Ninja 模式无法上下/左右移动）：标题栏空白、卡片间隙、折叠态呼吸灯条均可拖动；
  // 输入框/按钮/开关/链接/关闭钮不触发拖动。落点写入 CONFIG.PANEL_POS 持久化，跨刷新保留。
  // 性能优化（修复移动卡顿）：用 transform:translate3d 仅驱动合成层、不触发重排/重绘；
  //   rAF 合并高频 mousemove；拖拽前缓存宽高（避免每帧强制同步布局）；will-change 提升独立图层。
  function makeDraggable(el) {
    if (!el) return;
    var dragging = false, sx = 0, sy = 0, ax = 0, ay = 0, w = 0, h = 0;
    var pending = false, dx = 0, dy = 0;
    function paint() {                 // 仅写 transform（合成层），不读布局、不重排
      pending = false;
      el.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    }
    function onMove(e) {
      if (!dragging) return;
      el._cxDragMoved = true;   // 标记本次为拖拽（非点击），供 Ninja 点击展开去抖
      var nx = ax + (e.clientX - sx);
      var ny = ay + (e.clientY - sy);
      nx = Math.max(0, Math.min(nx, window.innerWidth - w));   // w/h 已在 mousedown 缓存
      ny = Math.max(0, Math.min(ny, Math.max(0, window.innerHeight - h)));
      dx = nx - ax; dy = ny - ay;
      if (!pending) { pending = true; requestAnimationFrame(paint); }  // 合并到下一帧，避免一帧多次写入
    }
    function onUp() {
      dragging = false;
      el.classList.remove('cx-dragging');
      el.style.willChange = '';          // 释放图层，避免常驻内存占用
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        // 结算为绝对 left/top（与 transform 视觉位置一致，无跳变），覆盖 right 锚定，持久化落点
        var r = el.getBoundingClientRect();
        var fl = Math.round(r.left), ft = Math.round(r.top);
        el.style.transform = '';
        el.style.left = fl + 'px';
        el.style.top = ft + 'px';
        el.style.right = 'auto';
        CONFIG.PANEL_POS = { x: fl, y: ft };
        savePanelCfg();
      } catch (e) { swallow(e); }
    }
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var t = e.target;
      if (!t || !t.closest) return;
      // —— 白名单把手：仅标题栏、或"点中面板但未命中任何实质内容/交互元素"的空白区可拖动 ——
      // 其余（按钮/输入/滑块/复选框/下拉/链接/纯文字标签/卡片内容/刷新区块/诊断文本等）一律不触发，避免误拖。
      var onTitlebar = !!t.closest('.cx-titlebar');
      var onInteractive = !!(t.closest('input,button,select,textarea,a,label,#__cxPanelClose,[data-no-drag]'));
      var onSubstantial = !!(t.closest('.cx-cmd-wrap,.cx-nav,.cx-tab,#__cxPanelInfo,#__cxSubPanelsWrap,#__cxAddonsWrap,.cx-diag'));
      if (!onTitlebar && (onInteractive || onSubstantial)) return;
      dragging = true;
      el.classList.add('cx-dragging');   // Ninja 模式下保持折叠态，避免悬停展开造成宽度突变
      el.style.willChange = 'transform'; // 提升为独立合成层：移动只重排(合成)不重绘内容
      var rect = el.getBoundingClientRect();
      ax = rect.left; ay = rect.top; w = el.offsetWidth; h = el.offsetHeight;  // 缓存一次尺寸
      el.style.left = ax + 'px'; el.style.top = ay + 'px'; el.style.right = 'auto';  // 锚定为绝对定位，transform 在其上叠加
      sx = e.clientX; sy = e.clientY; dx = 0; dy = 0;
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Ninja 已改为圆形悬浮钮（对称，任意位置观感一致），无需左/右贴边判定；位置由 PANEL_POS 自由落点决定
