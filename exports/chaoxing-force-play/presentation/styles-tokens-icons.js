// @provides: cxIcon
// @requires: STYLES, bestEffort
// @source-group: presentation/styles.js
// @continuation-of: presentation/styles.js
// Design tokens, legacy button styles, icons, and UI export.
  // ===== 设计令牌（Design Tokens）：供 JS 内联样式引用 =====
  // 专业工具 UI 规范（2026-08-12）：品牌蓝 #3B82F6 + 语义色 + 8级中性色，见 docs/ui-design-main-panel.md。
  STYLES.T = {
    // —— 色板（浅色主题，与CSS变量对应）——
    bg:        '#FFFFFF',
    surface:   '#FFFFFF',
    surface2:  '#F9FAFB',
    surface3:  '#F3F4F6',
    border:    '#E5E7EB',
    border2:   '#D1D5DB',
    text:      '#111827',
    text2:     '#6B7280',
    text3:     '#9CA3AF',
    primary:   '#3B82F6',
    success:   '#22C55E',
    warning:   '#F59E0B',
    danger:    '#EF4444',
    idle:      '#9CA3AF',
    // —— 派生色（向后兼容）——
    primary2:   '#3B82F6',
    primary2A25:'rgba(59,130,246,0.25)',
    primary2A0: 'rgba(59,130,246,0)',
    primaryTxt: '#3B82F6',
    onPrimary2: '#1D4ED8',
    star:       '#3B82F6',
    track:      '#E5E7EB',
    buffered:   'rgba(156,163,175,0.3)',
    cmdHi:      'rgba(59,130,246,0.08)',
    text2b:     '#6B7280',
    paused:     '#F59E0B',
    ok:         '#22C55E',
    // —— 字阶 ——
    fs9: '10px', fs11: '11px', fs12: '12px', fs13: '13px', fs14: '14px',
    // —— 间距（4 的倍数）——
    sp4: '4px', sp6: '6px', sp8: '8px', sp12: '12px', sp16: '16px',
    // —— 圆角 ——
    r4: '4px', r6: '6px', r8: '8px', r10: '10px',
    // —— 阴影 ——
    shadow:     'var(--cx-shadow-lg,0 12px 32px rgba(0,0,0,0.12),0 4px 8px rgba(0,0,0,0.06))',
    cardShadow: '0 1px 2px rgba(0,0,0,0.04)'
  };
  // Ninja 模式样式（延迟到 T 定义后）
  STYLES.NINJA_STYLE = '';  // 已并入 ANIM
  // —— 按钮样式（向后兼容，供少量内联样式使用）——
  STYLES.BTN_PRIMARY   = 'background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:' + STYLES.T.r8 + ';cursor:pointer;';
  STYLES.BTN_SECONDARY = 'background:' + STYLES.T.surface3 + ';color:' + STYLES.T.text + ';border:0;border-radius:' + STYLES.T.r8 + ';cursor:pointer;';
  STYLES.BTN_GHOST     = 'background:transparent;color:' + STYLES.T.primary + ';border:1px solid ' + STYLES.T.primary + ';border-radius:' + STYLES.T.r8 + ';cursor:pointer;';
  STYLES.BTN_DANGER    = 'background:transparent;color:' + STYLES.T.danger + ';border:1px solid ' + STYLES.T.danger + ';border-radius:' + STYLES.T.r8 + ';cursor:pointer;';
  // ===== 图标系统：统一用 SVG，杜绝 Unicode/Emoji 在不同字体/缩放比下偏移带来的“散装感” =====
  var ICONS = {
    play:       '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause:      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    close:      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    star:       '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    starOutline:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    caretDown:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>',
    caretRight: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M10 17l5-5-5-5v10z"/></svg>',
    info:       '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    warn:       '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
    keyboard:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>',
    dot:        '<svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor"><circle cx="12" cy="12" r="12"/></svg>'
  };
  function cxIcon(name, size) {
    var svg = ICONS[name];
    if (!svg) return '';
    if (size) svg = svg.replace(/width="\d+"/, 'width="' + size + '"').replace(/height="\d+"/, 'height="' + size + '"');
    return '<span class="cx-icon" aria-hidden="true">' + svg + '</span>';
  }
  // 工具库项 UI 接入导出
  bestEffort(function () { window.__cxUI = STYLES; }, 'styles.export');
