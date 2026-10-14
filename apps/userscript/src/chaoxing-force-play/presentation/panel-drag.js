





  // ===== DOMAIN: presentation/panel-drag (panel drag + ninja side) =====
  // Panel dragging (compositor-layer optimization) and Ninja strip side detection.
  // 拖拽移动面板（修复 Ninja 模式无法上下/左右移动）：标题栏空白、卡片间隙、折叠态呼吸灯条均可拖动；
  // 输入框/按钮/开关/链接/关闭钮不触发拖动。落点写入 CONFIG.PANEL_POS 持久化，跨刷新保留。
  // 性能优化（修复移动卡顿）：用 transform:translate3d 仅驱动合成层、不触发重排/重绘；
  //   rAF 合并高频 mousemove；拖拽前缓存宽高（避免每帧强制同步布局）；will-change 提升独立图层。
  // D6 修复：makeDraggable 为死代码——面板拖拽在 panel-core.js 中已明确「禁用」（Ninja 旧坐标套宽态面板会裁到屏外），
  // 全仓无任何调用点。拖拽功能当前由 panel-core.js 的 CSS 默认右上角安全位 + Ninja sticky 展开实现，
  // 故移除该未接入的 makeDraggable 函数，避免误导与死代码累积。

  // Ninja 已改为圆形悬浮钮（对称，任意位置观感一致），无需左/右贴边判定；位置由 PANEL_POS 自由落点决定
