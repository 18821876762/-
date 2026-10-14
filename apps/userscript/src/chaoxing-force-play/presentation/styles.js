// @provides: STYLES
// @source-group: presentation/styles.js
  // ===== DOMAIN: presentation/styles (design tokens + injected CSS) =====
  // ===== MODULE: 样式/设计令牌 =====
  // 域：UI 层 —— 面板与通知相关的全部 CSS 字符串（设计令牌 + 注入样式），纯数据、无控制流。
  // 导出：window.__cxUI = STYLES，供工具库项 addon 引用令牌保持视觉同构。
  var STYLES = {
    // 宽度走 CSS 变量 --cx-panel-w（默认 340px，专业工具 UI 规范）：单一事实源
    // 关键：外层用 overflow:hidden 负责「圆角裁剪」——阻止内部滚动条/内容直角矩形溢出 12px 圆角。
    // 实际滚动交由内层 .cx-body（flex:1;overflow-y:auto）承担，形成「外层裁剪 + 内层滚动」双层结构（见 §面板滚动条方案）。
    // 注：优先 overflow:hidden 而非 overflow:clip，因 clip 在 Safari<16 不支持，hidden 即可达成圆角裁剪且全兼容。
    // 专业工具 UI 规范：面板默认 340px（勿加宽，工具面板宜窄）、圆角 12px、双层柔光阴影。
    PANEL_BOX:     'position:fixed;right:12px;top:12px;z-index:2147483647;box-sizing:border-box;width:var(--cx-panel-w,340px);max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:hidden;display:flex;flex-direction:column;background:var(--cx-bg,#FFFFFF);color:var(--cx-text,#111827);font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;border:1px solid var(--cx-border,#E5E7EB);border-radius:12px;box-shadow:var(--cx-shadow-lg,0 12px 32px rgba(0,0,0,0.12),0 4px 8px rgba(0,0,0,0.06));padding:0;user-select:none;-webkit-font-smoothing:antialiased;',
    // 顶部居中 Toast（规范 §Toast）：320px 固定宽、图标+文字、进入 200ms 滑入淡入 / 离开滑出淡出。
    TOAST:         'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:8px;max-width:340px;background:var(--cx-surface,#FFFFFF);color:var(--cx-text,#111827);padding:10px 14px;border-radius:8px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;pointer-events:none;border:1px solid var(--cx-border,#E5E7EB);box-shadow:var(--cx-shadow-lg,0 12px 32px rgba(0,0,0,0.12),0 4px 8px rgba(0,0,0,0.06));animation:cx-toast-in .2s var(--cx-ease-out,cubic-bezier(0,0,0.2,1));',
    PANEL_MOBILE:  '@media (max-width:480px){#__cxPanel{left:8px!important;right:8px!important;top:8px!important;width:auto!important;max-width:none!important;max-height:calc(100vh - 16px)!important;overflow:hidden!important;font-size:14px!important;padding:0!important;border-radius:12px!important;}#__cxPanel button{padding:10px 12px!important;font-size:14px!important;min-height:44px!important;}#__cxPanel .cx-seg-btn{padding:8px!important;min-height:36px!important;font-size:13px!important;}#__cxPanel input[type=range]{height:24px;}#__cxPanel .cx-video-toggle{--cx-toggle-w:42px!important;}#__cxPanel .cx-video-toggle::after{width:18px!important;height:18px!important;margin-top:-9px!important;}#__cxPanel .cx-video-toggle.on::after{transform:translateX(18px)!important;}}',
    DIAG_BLOCK:    'margin-bottom:10px;font-size:12px;background:var(--cx-surface2,#F9FAFB);border:1px solid var(--cx-border,#E5E7EB);border-radius:8px;overflow:hidden;box-shadow:none;',
    DIAG_HEAD:     'cursor:pointer;padding:8px 10px;background:var(--cx-surface3,#F3F4F6);color:var(--cx-text,#111827);font-weight:600;display:flex;justify-content:space-between;align-items:center;',
    DIAG_CARET:    'font-size:10px;',
    DIAG_BODY:     'padding:10px;max-height:50vh;overflow:auto;',
    DIAG_ROW:      'margin-bottom:6px;font-size:12px;',
    DIAG_BTN:      'width:100%;padding:8px;background:var(--cx-surface3,#F3F4F6);color:var(--cx-text,#111827);border:0;border-radius:6px;cursor:pointer;font-size:12px;transition:background .15s;',
    DIAG_LAB:      'display:block;cursor:pointer;',
    DIAG_CB:       'vertical-align:middle;margin-right:8px;',
    DIAG_NOTE:     'font-size:11px;color:var(--cx-text2,#6E6E73);margin-left:22px;',
    NINJA_DEFAULT: '',
    // ===== 组件样式：通过 class 注入，而非大量内联样式 =====
    ANIM:          '' +
      // --- 明暗主题 CSS 变量 ---
      // 专业工具 UI 规范色板（浅色）：品牌蓝 #3B82F6 + 语义色 + 8级中性色；数字统一 tabular-nums。
      '#__cxPanel{--cx-bg:#FFFFFF;--cx-surface:#FFFFFF;--cx-surface2:#F9FAFB;--cx-surface3:#F3F4F6;--cx-border:#E5E7EB;--cx-border2:#D1D5DB;--cx-text:#111827;--cx-text2:#6B7280;--cx-text3:#9CA3AF;--cx-brand:#3B82F6;--cx-brand-press:#2563EB;--cx-brand-bg:rgba(59,130,246,0.08);--cx-success:#22C55E;--cx-warning:#F59E0B;--cx-danger:#EF4444;--cx-paused:#F59E0B;--cx-idle:#9CA3AF;--cx-track:#E5E7EB;--cx-buffered:rgba(156,163,175,0.3);--cx-shadow-sm:0 1px 2px rgba(0,0,0,0.05);--cx-shadow-md:0 4px 12px rgba(0,0,0,0.08),0 2px 4px rgba(0,0,0,0.04);--cx-shadow-lg:0 12px 32px rgba(0,0,0,0.12),0 4px 8px rgba(0,0,0,0.06);--cx-hero-gradient:linear-gradient(135deg,#3B82F6 0%,#2563EB 100%);--cx-hero-paused:linear-gradient(135deg,#F59E0B 0%,#D97706 100%);--cx-hero-idle:linear-gradient(135deg,#F3F4F6 0%,#F9FAFB 100%);--cx-toggle-w:36px;--cx-toggle-h:20px;--cx-toggle-knob:16px;--cx-toggle-gap:2px;--cx-toggle-travel:16px;--cx-bg-subtle:#F9FAFB;--cx-bg-muted:#F3F4F6;--cx-border-s:#D1D5DB;--cx-fg:#111827;--cx-fg-subtle:#6B7280;--cx-fg-muted:#9CA3AF;--cx-radius-sm:4px;--cx-radius:6px;--cx-radius-md:8px;--cx-radius-lg:12px;--cx-ease:cubic-bezier(0.25,0.1,0.25,1);--cx-ease-out:cubic-bezier(0,0,0.2,1);font-variant-numeric:tabular-nums;}' +

      // 手动深色类（用户显式切换，置于 media 之后保证最高优先级）。
      '#__cxPanel.cx-dark{--cx-bg:#0F1117;--cx-surface:#161922;--cx-surface2:#1E2130;--cx-surface3:#2A2D3A;--cx-border:#2A2D3A;--cx-border2:#3A3D4A;--cx-text:#F3F4F6;--cx-text2:#9CA3AF;--cx-text3:#6B7280;--cx-brand:#60A5FA;--cx-brand-press:#93C5FD;--cx-brand-bg:rgba(96,165,250,0.12);--cx-success:#4ADE80;--cx-warning:#FBBF24;--cx-danger:#F87171;--cx-paused:#FBBF24;--cx-idle:#3A3D4A;--cx-track:#2A2D3A;--cx-buffered:rgba(107,114,128,0.4);--cx-shadow-sm:0 1px 2px rgba(0,0,0,0.3);--cx-shadow-md:0 4px 12px rgba(0,0,0,0.4),0 2px 4px rgba(0,0,0,0.3);--cx-shadow-lg:0 12px 32px rgba(0,0,0,0.5),0 4px 8px rgba(0,0,0,0.3);--cx-hero-gradient:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);--cx-hero-paused:linear-gradient(135deg,#D97706 0%,#B45309 100%);--cx-hero-idle:linear-gradient(135deg,#1E2130 0%,#161922 100%);--cx-bg-subtle:#161922;--cx-bg-muted:#1E2130;--cx-border-s:#3A3D4A;--cx-fg:#F3F4F6;--cx-fg-subtle:#9CA3AF;--cx-fg-muted:#6B7280;}' +
      // 系统深色跟随（仅当面板未被手动 .cx-dark 覆盖时生效）。
      '@media (prefers-color-scheme: dark){#__cxPanel:not(.cx-dark){--cx-bg:#0F1117;--cx-surface:#161922;--cx-surface2:#1E2130;--cx-surface3:#2A2D3A;--cx-border:#2A2D3A;--cx-border2:#3A3D4A;--cx-text:#F3F4F6;--cx-text2:#9CA3AF;--cx-text3:#6B7280;--cx-brand:#60A5FA;--cx-brand-press:#93C5FD;--cx-brand-bg:rgba(96,165,250,0.12);--cx-success:#4ADE80;--cx-warning:#FBBF24;--cx-danger:#F87171;--cx-paused:#FBBF24;--cx-idle:#3A3D4A;--cx-track:#2A2D3A;--cx-buffered:rgba(107,114,128,0.4);--cx-hero-gradient:linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%);--cx-hero-paused:linear-gradient(135deg,#D97706 0%,#B45309 100%);--cx-hero-idle:linear-gradient(135deg,#1E2130 0%,#161922 100%);--cx-bg-subtle:#161922;--cx-bg-muted:#1E2130;--cx-border-s:#3A3D4A;--cx-fg:#F3F4F6;--cx-fg-subtle:#9CA3AF;--cx-fg-muted:#6B7280;}}' +
      // 规范 §Toast 进出动画（保留 left:50% 的 translateX(-50%)）
      '@keyframes cx-toast-in{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '@keyframes cx-toast-out{from{opacity:1;transform:translate(-50%,0)}to{opacity:0;transform:translate(-50%,-12px)}}' +
      // --- 标题栏 ---
      // 层级须高于命令下拉 #__cxCmdList(z-index:10)：下拉展开覆盖 tab 导航时，关闭/切 tab 仍可被点击（修复整面板冻结、点 tab 无反应）。
      '#__cxPanel .cx-header{position:relative;z-index:30;padding:12px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--cx-border);}'+
      '#__cxPanel .cx-led{width:8px;height:8px;border-radius:50%;background:var(--cx-success);flex-shrink:0;box-shadow:0 0 8px var(--cx-success);transition:background-color .3s,box-shadow .3s;}'+
      '#__cxPanel .cx-led.paused{background:var(--cx-paused);box-shadow:0 0 8px var(--cx-paused);}'+
      '#__cxPanel .cx-led.idle{background:var(--cx-idle);box-shadow:none;}'+
      '#__cxPanel .cx-title-text{font-size:14px;font-weight:600;flex:1;letter-spacing:-0.2px;}'+
      '#__cxPanel .cx-rate-badge{font-size:11px;background:var(--cx-brand-bg);color:var(--cx-brand);padding:3px 8px;border-radius:999px;font-weight:600;font-variant-numeric:tabular-nums;}'+
      '#__cxPanel .cx-icon-btn{width:28px;height:28px;border-radius:6px;border:none;background:transparent;color:var(--cx-text3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .15s;font-family:inherit;padding:0;}'+
      '#__cxPanel .cx-icon-btn:hover{background:var(--cx-surface3);color:var(--cx-text);}'+
    '#__cxPanel .cx-video-star{color:var(--cx-warning);}'+
    '.cx-icon{display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;vertical-align:middle;line-height:1;flex-shrink:0;user-select:none;}'+
    '.cx-icon svg{width:100%;height:100%;display:block;}'+
    '#__cxPanel .cx-hero-play .cx-icon svg{display:block;margin:auto;}'+
    '.cx-legend-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:3px;vertical-align:middle;}'+
    '.cx-legend-dot.ok{background:var(--cx-success);}'+
    '.cx-legend-dot.warn{background:var(--cx-warning);}'+
    '.cx-legend-dot.err{background:var(--cx-danger);}'+
      // --- 命令栏 ---
      '#__cxPanel .cx-cmd-wrap{margin:12px 16px;position:relative;}'+
      // 规范 Input：32px 高、focus 品牌色发光环
      '#__cxPanel .cx-cmd-input{width:100%;box-sizing:border-box;height:32px;padding:0 12px 0 32px;background:var(--cx-surface2);color:var(--cx-text);border:1px solid var(--cx-border);border-radius:6px;font-size:13px;outline:none;font-family:inherit;transition:all .12s var(--cx-ease);}'+
      '#__cxPanel .cx-cmd-input:focus{background:var(--cx-surface);border-color:var(--cx-brand);box-shadow:0 0 0 3px var(--cx-brand-bg);}'+
      '#__cxPanel .cx-cmd-k{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--cx-text3);font-family:"SF Mono","Roboto Mono",monospace;background:var(--cx-surface3);padding:2px 5px;border-radius:4px;pointer-events:none;}'+
      '#__cxPanel #__cxCmdList{background:var(--cx-surface);border:1px solid var(--cx-border);border-radius:8px;box-shadow:var(--cx-shadow-md);}'+
      // --- Tab 标签（规范 §Tab：底部 2px 指示条 + 文字色变化，去容器灰底）---
      // 层级须高于命令下拉 #__cxCmdList(z-index:10)：下拉向下展开盖住 tab 导航时，tab 命中目标仍为 .cx-seg-btn 而非下拉项（修复点其他 tab 无反应）。
      '#__cxPanel .cx-seg{position:relative;z-index:30;display:flex;margin:0 16px 12px;gap:0;border-bottom:1px solid var(--cx-border);padding:0;background:transparent;}'+
      '#__cxPanel .cx-seg-btn{flex:1;padding:9px 4px;border:none;background:transparent;color:var(--cx-text2);font-size:12px;font-weight:500;cursor:pointer;transition:color .12s var(--cx-ease);font-family:inherit;position:relative;border-radius:0;}'+
      '#__cxPanel .cx-seg-btn:hover{color:var(--cx-text);}'+
      '#__cxPanel .cx-seg-btn.active{color:var(--cx-brand);font-weight:600;}'+
      '#__cxPanel .cx-seg-btn.active::after{content:"";position:absolute;bottom:-1px;left:24%;right:24%;height:2px;background:var(--cx-brand);border-radius:1px;animation:cx-tab-in .2s var(--cx-ease);}'+
      '@keyframes cx-tab-in{from{transform:scaleX(0)}to{transform:scaleX(1)}}'+
      // --- 主体区 ---
      '#__cxPanel .cx-body{padding:0 16px 16px;flex:1 1 auto;min-height:0;overflow-y:auto;}'+
      // --- Hero 主操作卡 ---
      '#__cxPanel .cx-hero{background:var(--cx-hero-gradient);border-radius:12px;padding:14px;color:#fff;margin-bottom:12px;position:relative;overflow:hidden;transition:background .3s;}'+
      '#__cxPanel .cx-hero.paused{background:var(--cx-hero-paused);}'+
      '#__cxPanel .cx-hero.idle{background:var(--cx-hero-idle);color:var(--cx-text);}'+
      '#__cxPanel .cx-hero-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;}'+
      '#__cxPanel .cx-hero-status{font-size:10px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;}'+
      '#__cxPanel .cx-hero-src{font-size:12px;opacity:0.75;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'+
      '#__cxPanel .cx-hero-main{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}'+
      '#__cxPanel .cx-hero-time{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;line-height:1;}'+
      '#__cxPanel .cx-hero-time small{font-size:13px;font-weight:400;opacity:0.7;}'+
      '#__cxPanel .cx-hero-play{width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.2);border:2px solid rgba(255,255,255,0.5);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;padding:0;}'+
      '#__cxPanel .cx-hero.idle .cx-hero-play{background:var(--cx-surface);border-color:var(--cx-border2);color:var(--cx-text);}'+
      '#__cxPanel .cx-hero-play:hover{transform:scale(1.08);background:rgba(255,255,255,0.3);}'+
      '#__cxPanel .cx-hero-progress{height:4px;background:rgba(255,255,255,0.25);border-radius:999px;overflow:hidden;}'+
      '#__cxPanel .cx-hero-progress-bar{height:100%;background:rgba(255,255,255,0.9);border-radius:999px;width:0%;transition:width .3s;}'+
      '#__cxPanel .cx-hero.idle .cx-hero-progress{background:var(--cx-border);}'+
      '#__cxPanel .cx-hero.idle .cx-hero-progress-bar{background:var(--cx-text3);}'+
      // --- 区块标题 ---
      '#__cxPanel .cx-section-title{font-size:11px;color:var(--cx-text2);font-weight:600;margin:14px 0 6px;}'+
      '#__cxPanel .cx-section-title:first-child{margin-top:0;}'+
      // --- 视频列表 ---
      '#__cxPanel .cx-video-list{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow-y:auto;}'+
      // 规范 §视频列表项：无卡片化，hover 才显 muted 背景；左侧 3px 状态条按 data-state 着色。
      '#__cxPanel .cx-video-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:transparent;border:none;border-radius:6px;transition:background .12s var(--cx-ease);cursor:pointer;overflow:hidden;}'+
      '#__cxPanel .cx-video-item:hover{background:var(--cx-surface3);}'+
      '#__cxPanel .cx-video-item.active{background:var(--cx-brand-bg);}'+
      '#__cxPanel .cx-video-item.disabled{opacity:0.5;cursor:default;}'+
      '#__cxPanel .cx-video-item::before{content:"";width:3px;height:20px;border-radius:2px;flex-shrink:0;background:var(--cx-border2);transition:background .2s var(--cx-ease);}'+
      '#__cxPanel .cx-video-item[data-state="playing"]::before{background:var(--cx-success);}'+
      '#__cxPanel .cx-video-item[data-state="paused"]::before{background:var(--cx-warning);}'+
      '#__cxPanel .cx-video-item[data-state="error"]::before{background:var(--cx-danger);}'+
      // 规范 Toggle：36×20、knob 16、2px 间隙、开启品牌蓝、按压拉伸 + 焦点环
      '#__cxPanel .cx-video-toggle{width:var(--cx-toggle-w);height:var(--cx-toggle-h);border-radius:999px;background:var(--cx-border2);position:relative;flex-shrink:0;cursor:pointer;transition:background .12s var(--cx-ease);border:none;padding:0;outline:none;}'+
      '#__cxPanel .cx-video-toggle:focus-visible{box-shadow:0 0 0 2px var(--cx-bg),0 0 0 4px var(--cx-brand);}'+
      '#__cxPanel .cx-video-toggle.on{background:var(--cx-brand);}'+
      '#__cxPanel .cx-video-toggle:disabled{cursor:default;opacity:0.45;}'+
      '#__cxPanel .cx-video-toggle::after{content:"";position:absolute;left:var(--cx-toggle-gap);top:50%;width:var(--cx-toggle-knob);height:var(--cx-toggle-knob);margin-top:-8px;background:#fff;border-radius:50%;transition:transform .2s var(--cx-ease),width .12s var(--cx-ease);box-shadow:0 1px 3px rgba(0,0,0,0.15),0 1px 1px rgba(0,0,0,0.06);}'+
      '#__cxPanel .cx-video-toggle.on::after{transform:translateX(var(--cx-toggle-travel));}'+
      '#__cxPanel .cx-video-toggle:active::after{width:20px;}'+
      '#__cxPanel .cx-video-toggle.on:active::after{width:20px;transform:translateX(calc(var(--cx-toggle-travel) - 4px));}'+
      '#__cxPanel .cx-video-info{flex:1;min-width:0;}'+
      '#__cxPanel .cx-video-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--cx-text);line-height:1.4;}'+
      '#__cxPanel .cx-video-meta{font-size:11px;color:var(--cx-text3);font-variant-numeric:tabular-nums;line-height:1.4;}'+
      '#__cxPanel .cx-video-star{color:var(--cx-brand);font-size:12px;margin-left:2px;}'+
      '#__cxPanel .cx-video-mini-progress{height:2px;background:var(--cx-track);border-radius:999px;margin-top:3px;overflow:hidden;}'+
      '#__cxPanel .cx-video-mini-progress-bar{height:100%;background:var(--cx-brand);border-radius:999px;width:0%;}'+
      // --- 快捷按钮行 ---
      '#__cxPanel .cx-quick-row{display:flex;gap:6px;margin-top:10px;align-items:center;}'+
      // 规范 Button（小号）：28px 高、radius 6px
      '#__cxPanel .cx-quick-btn{flex:1;height:28px;padding:0 10px;background:var(--cx-surface);border:1px solid var(--cx-border);border-radius:6px;font-size:12px;color:var(--cx-text2);cursor:pointer;transition:all .12s var(--cx-ease);font-family:inherit;font-weight:500;display:inline-flex;align-items:center;justify-content:center;gap:6px;}'+
      '#__cxPanel .cx-quick-btn:hover{background:var(--cx-brand-bg);border-color:var(--cx-brand);color:var(--cx-brand);}'+
      '#__cxPanel .cx-quick-label{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--cx-text2);cursor:pointer;white-space:nowrap;padding:0 2px;user-select:none;flex-shrink:0;}'+
      // --- 设置行 ---
      '#__cxPanel .cx-setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--cx-border);gap:12px;}'+
      '#__cxPanel .cx-setting-row:last-child{border-bottom:none;}'+
      '#__cxPanel .cx-setting-label{font-size:13px;flex:1;}'+
      '#__cxPanel .cx-setting-hint{font-size:11px;color:var(--cx-text3);margin-top:2px;}'+
      '#__cxPanel .cx-setting-section{background:var(--cx-surface);border:1px solid var(--cx-border);border-radius:8px;padding:4px 14px;margin-bottom:8px;overflow:hidden;}'+
      // --- Metric 卡片 ---
      '#__cxPanel .cx-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}'+
      '#__cxPanel .cx-metric{background:var(--cx-surface);border:1px solid var(--cx-border);border-radius:8px;padding:10px 8px;text-align:center;}'+
      '#__cxPanel .cx-metric-val{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-0.3px;color:var(--cx-brand);line-height:1.2;}'+
      '#__cxPanel .cx-metric-val.success{color:var(--cx-success);}'+
      '#__cxPanel .cx-metric-val.warning{color:var(--cx-warning);}'+
      '#__cxPanel .cx-metric-val.danger{color:var(--cx-danger);}'+
      '#__cxPanel .cx-metric-label{font-size:10px;color:var(--cx-text3);margin-top:2px;}'+
      // --- 提示条 ---
      '#__cxPanel .cx-tip{background:var(--cx-warning-subtle,rgba(245,158,11,0.10));border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--cx-warning);display:flex;align-items:center;gap:8px;margin-top:8px;}'+
      '#__cxPanel .cx-tip.info{background:var(--cx-brand-bg);border-color:rgba(59,130,246,0.2);color:var(--cx-brand);}'+
      '#__cxPanel .cx-tip.success{background:var(--cx-success-subtle,rgba(34,197,94,0.10));border-color:rgba(34,197,94,0.2);color:var(--cx-success);}'+
      // --- 底部 ---
      '#__cxPanel .cx-footer{padding:8px 16px;border-top:1px solid var(--cx-border);display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--cx-text3);background:var(--cx-surface2);}'+
      '#__cxPanel .cx-footer-dot{width:6px;height:6px;border-radius:50%;background:var(--cx-success);display:inline-block;margin-right:4px;}'+
      // --- 通用滑块 ---
      '#__cxPanel input[type=range]{-webkit-appearance:none;width:120px;max-width:120px;height:4px;background:var(--cx-track);border-radius:999px;outline:none;flex-shrink:0;}'+
      '#__cxPanel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--cx-brand);cursor:pointer;box-shadow:0 1px 4px rgba(59,130,246,0.3);transition:transform .15s;}'+
      '#__cxPanel input[type=range]::-webkit-slider-thumb:active{transform:scale(1.2);}'+
      '#__cxPanel input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:var(--cx-brand);cursor:pointer;border:none;box-shadow:0 1px 4px rgba(59,130,246,0.3);}'+
      '#__cxPanel input[type=range]::-moz-range-thumb:active{transform:scale(1.2);}'+
      // --- 通用按钮 ---
      // 规范 Button：32px 高（小号 28px）、Primary/Secondary/Ghost/Danger 四层、hover 加深、active 微缩
      '#__cxPanel .cx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:1px solid transparent;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;line-height:1;user-select:none;white-space:nowrap;transition:all .12s var(--cx-ease);outline:none;}'+
      '#__cxPanel .cx-btn:focus-visible{box-shadow:0 0 0 2px var(--cx-bg),0 0 0 4px var(--cx-brand);}'+
      '#__cxPanel .cx-btn-primary{background:var(--cx-brand);color:#fff;box-shadow:var(--cx-shadow-sm);}'+
      '#__cxPanel .cx-btn-primary:hover{background:var(--cx-brand-press);}'+
      '#__cxPanel .cx-btn-primary:active{transform:scale(0.98);}'+
      '#__cxPanel .cx-btn-secondary{background:var(--cx-surface);color:var(--cx-text);border-color:var(--cx-border);}'+
      '#__cxPanel .cx-btn-secondary:hover{background:var(--cx-surface2);border-color:var(--cx-border2);}'+
      '#__cxPanel .cx-btn-ghost{background:transparent;color:var(--cx-text2);}'+
      '#__cxPanel .cx-btn-ghost:hover{background:var(--cx-surface3);color:var(--cx-text);}'+
      '#__cxPanel .cx-btn-danger{background:var(--cx-danger);color:#fff;}'+
      '#__cxPanel .cx-btn-danger:hover{background:#DC2626;}'+
      '#__cxPanel button:active{transform:scale(.98);transition:transform .08s ease;}'+
      '#__cxPanel .cx-btn:disabled{opacity:0.45;cursor:not-allowed;pointer-events:none;}'+
      // --- 复选框（规范：16×16、4px 圆角、勾选 200ms scale 弹出）---
      '#__cxPanel input[type=checkbox]{-webkit-appearance:none;appearance:none;width:16px;height:16px;border:1.5px solid var(--cx-border2);border-radius:4px;background:var(--cx-bg);cursor:pointer;vertical-align:middle;flex-shrink:0;transition:background .12s var(--cx-ease),border-color .12s var(--cx-ease);position:relative;margin:0;padding:0;}'+
      '#__cxPanel input[type=checkbox]:hover{border-color:var(--cx-brand);}'+
      '#__cxPanel input[type=checkbox]:checked{background-color:var(--cx-brand);border-color:var(--cx-brand);background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSI0IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik01IDEzbDQgNEwxOSA3Ii8+PC9zdmc+");background-size:10px 10px;background-repeat:no-repeat;background-position:center;animation:cx-check-pop .2s var(--cx-ease);}'+
      '@keyframes cx-check-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}'+
      '#__cxPanel input[type=checkbox]:disabled{opacity:0.4;cursor:not-allowed;}'+
      '#__cxPanel label{cursor:pointer;display:flex;align-items:center;gap:6px;}'+
      '#__cxPanel label > input[type=checkbox]{margin:0!important;}'+
      '#__cxPanel .cx-quick-label input[type=checkbox]{width:16px;height:16px;}'+
      // --- 自定义滚动条（圆角容器配套）---
      // 外层 #__cxPanel 已 overflow:hidden 裁剪圆角，由各内部滚动区单独滚动。统一处理：
      // 透明 track（仅显 thumb）+ 圆角 thumb(min-height 24px) + 悬停才显形 + 上下留白避免超出圆角；
      // Firefox 走标准 scrollbar-width/scrollbar-color；overscroll-behavior:contain 阻止滚动链冒泡到页面。
      '#__cxPanel .cx-body,#__cxPanel .cx-video-list,#__cxPanel #__cxCmdList,#__cxPanel .cx-diag-body,#__cxPanel #__cxToastFeed{scrollbar-width:thin;scrollbar-color:transparent transparent;overscroll-behavior:contain;transition:scrollbar-color .2s;}'+
      '#__cxPanel:hover .cx-body,#__cxPanel:hover .cx-video-list,#__cxPanel:hover #__cxCmdList,#__cxPanel:hover .cx-diag-body,#__cxPanel:hover #__cxToastFeed{scrollbar-color:var(--cx-border2) transparent;}'+
      '#__cxPanel .cx-body::-webkit-scrollbar,#__cxPanel .cx-video-list::-webkit-scrollbar,#__cxPanel #__cxCmdList::-webkit-scrollbar,#__cxPanel .cx-diag-body::-webkit-scrollbar,#__cxPanel #__cxToastFeed::-webkit-scrollbar{width:6px;height:6px;}'+
      '#__cxPanel .cx-body::-webkit-scrollbar-track,#__cxPanel .cx-video-list::-webkit-scrollbar-track,#__cxPanel #__cxCmdList::-webkit-scrollbar-track,#__cxPanel .cx-diag-body::-webkit-scrollbar-track,#__cxPanel #__cxToastFeed::-webkit-scrollbar-track{background:transparent;margin:4px;}'+
      '#__cxPanel .cx-body::-webkit-scrollbar-thumb,#__cxPanel .cx-video-list::-webkit-scrollbar-thumb,#__cxPanel #__cxCmdList::-webkit-scrollbar-thumb,#__cxPanel .cx-diag-body::-webkit-scrollbar-thumb,#__cxPanel #__cxToastFeed::-webkit-scrollbar-thumb{background:transparent;border-radius:999px;min-height:24px;transition:background .2s;}'+
      '#__cxPanel:hover .cx-body::-webkit-scrollbar-thumb,#__cxPanel:hover .cx-video-list::-webkit-scrollbar-thumb,#__cxPanel:hover #__cxCmdList::-webkit-scrollbar-thumb,#__cxPanel:hover .cx-diag-body::-webkit-scrollbar-thumb,#__cxPanel:hover #__cxToastFeed::-webkit-scrollbar-thumb{background:var(--cx-border2);}'+
      '#__cxPanel .cx-body::-webkit-scrollbar-thumb:hover,#__cxPanel .cx-video-list::-webkit-scrollbar-thumb:hover,#__cxPanel #__cxCmdList::-webkit-scrollbar-thumb:hover,#__cxPanel .cx-diag-body::-webkit-scrollbar-thumb:hover,#__cxPanel #__cxToastFeed::-webkit-scrollbar-thumb:hover{background:var(--cx-text3);}'+
      // --- Select ---
      '#__cxPanel select{padding:6px 24px 6px 10px;background:var(--cx-surface2);color:var(--cx-text);border:1px solid var(--cx-border);border-radius:6px;font-size:12px;font-family:inherit;cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath fill=\'%236B7280\' d=\'M0 0l5 6 5-6z\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;}'+
      '#__cxPanel select:hover{border-color:var(--cx-border2);}'+
      // --- 等宽数字 ---
      '#__cxPanel .cx-mono{font-family:"SF Mono","Roboto Mono",monospace;font-variant-numeric:tabular-nums;letter-spacing:.3px;}'+
      '#__cxPanel .cx-titlebar{cursor:move;}'+
      // --- 做题区 ---
      '#__cxPanel .cx-quiz-stat{font-size:12px;color:var(--cx-text2);line-height:1.8;}'+
      '#__cxPanel .cx-quiz-stat-row{display:flex;justify-content:space-between;}'+
      '#__cxPanel .cx-quiz-stat b{color:var(--cx-text);font-weight:600;}'+
      // --- 答题进度条 + 信号灯（与视频 Hero 进度条同源视觉语言）---
      '#__cxPanel .cx-quiz-progress{margin:2px 0 6px;}'+
      '#__cxPanel .cx-quiz-progress-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}'+
      '#__cxPanel .cx-quiz-led{width:9px;height:9px;border-radius:50%;flex-shrink:0;background:var(--cx-idle);box-shadow:none;transition:background-color .3s,box-shadow .3s;}'+
      '#__cxPanel .cx-quiz-led.running{background:var(--cx-success);box-shadow:0 0 8px var(--cx-success);animation:cx-led-pulse 1.4s ease-in-out infinite;}'+
      '#__cxPanel .cx-quiz-led.warn{background:var(--cx-warning);box-shadow:0 0 8px var(--cx-warning);}'+
      '#__cxPanel .cx-quiz-led.done{background:var(--cx-brand);box-shadow:0 0 8px var(--cx-brand);}'+
      '#__cxPanel .cx-quiz-led.paused{background:var(--cx-paused);box-shadow:0 0 8px var(--cx-paused);}'+
      '#__cxPanel .cx-quiz-led.error{background:var(--cx-danger);box-shadow:0 0 8px var(--cx-danger);}'+
      '#__cxPanel .cx-quiz-status{font-size:12px;color:var(--cx-text2);flex:1;}'+
      '#__cxPanel .cx-quiz-pct{font-size:12px;font-weight:600;color:var(--cx-text);font-variant-numeric:tabular-nums;}'+
      '#__cxPanel .cx-quiz-progress-track{height:6px;background:var(--cx-border);border-radius:999px;overflow:hidden;}'+
      '#__cxPanel .cx-quiz-progress-bar{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,var(--cx-brand),var(--cx-success));transition:width .35s var(--cx-ease);}'+
      '#__cxPanel .cx-quiz-progress-num{font-size:11px;color:var(--cx-text3);margin-top:5px;}'+
      // --- Sparkline 容器 ---
      '#__cxPanel .cx-sparkwrap{display:flex;align-items:flex-end;gap:4px;}'+
      '#__cxPanel #__cxMoSpark{flex:1;height:24px;}' +
      // --- DeepSeek 应答端控制台（对齐现代 AI 产品观感：状态卡 + 行式键值 + 对话式最近交互 + 遥测 chips + 异常条）---
      // 全部走 var(--cx-*) 令牌：深色模式（.cx-dark / prefers-color-scheme）自动随动，不再硬编码色值。
      '#__cxPanel .cx-ds-card{background:var(--cx-surface2);border:1px solid var(--cx-border);border-radius:10px;padding:12px 14px;margin:8px 0 12px;}' +
      '#__cxPanel .cx-ds-hero{display:flex;align-items:center;gap:10px;margin-bottom:4px;}' +
      '#__cxPanel .cx-ds-pill{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--cx-brand-bg);color:var(--cx-brand);white-space:nowrap;}' +
      '#__cxPanel .cx-ds-pill.ok{background:var(--cx-success-subtle,rgba(34,197,94,0.10));color:var(--cx-success);}' +
      '#__cxPanel .cx-ds-pill.warn{background:rgba(245,158,11,0.10);color:var(--cx-warning);}' +
      '#__cxPanel .cx-ds-sub{font-size:12px;color:var(--cx-text2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '#__cxPanel .cx-ds-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-bottom:1px dashed var(--cx-border);font-size:12px;}' +
      '#__cxPanel .cx-ds-row:last-child{border-bottom:none;}' +
      '#__cxPanel .cx-ds-k{color:var(--cx-text2);flex-shrink:0;}' +
      '#__cxPanel .cx-ds-v{color:var(--cx-text);text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;}' +
      '#__cxPanel .cx-ds-exchange{background:var(--cx-surface);border:1px solid var(--cx-border);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--cx-text);line-height:1.6;}' +
      '#__cxPanel .cx-ds-ex-label{font-size:10px;color:var(--cx-text3);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;margin-bottom:4px;}' +
      '#__cxPanel .cx-ds-exchange b{font-weight:600;color:var(--cx-text);}' +
      '#__cxPanel .cx-ds-conf{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:600;vertical-align:1px;}' +
      '#__cxPanel .cx-ds-conf.ok{background:rgba(16,185,129,0.12);color:var(--cx-success);}' +
      '#__cxPanel .cx-ds-conf.mid{background:rgba(245,158,11,0.12);color:var(--cx-warning);}' +
      '#__cxPanel .cx-ds-conf.low{background:rgba(239,68,68,0.12);color:var(--cx-danger);}' +
      '#__cxPanel .cx-ds-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}' +
      '#__cxPanel .cx-ds-chips:empty{display:none;}' +
      '#__cxPanel .cx-ds-chip{background:var(--cx-surface);border:1px solid var(--cx-border);border-radius:999px;padding:3px 10px;font-size:11px;color:var(--cx-text2);font-variant-numeric:tabular-nums;}' +
      '#__cxPanel .cx-ds-chip b{color:var(--cx-text);font-weight:600;margin-left:4px;}' +
      '#__cxPanel .cx-ds-chip.ok b{color:var(--cx-success);}' +
      '#__cxPanel .cx-ds-chip.err{border-color:rgba(239,68,68,0.3);}' +
      '#__cxPanel .cx-ds-chip.err b{color:var(--cx-danger);}' +
      '#__cxPanel .cx-ds-alert{display:flex;align-items:flex-start;gap:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--cx-danger);margin-bottom:12px;line-height:1.5;}' +
      '#__cxPanel .cx-ds-alert:empty{display:none;}' +
      // --- Ninja FAB (工具风 40px) ---
      // 专业工具 UI 规范 §悬浮球：40×40 圆形、品牌色填充+白色图标 18px、柔和双层投影、hover 放大 1.08、
      // 无呼吸动效；状态色由 data-state 驱动（playing=绿 / paused=橙 / error=红 / idle=灰）。
      '#__cxPanel.ninja{' +
        'width:40px!important;max-width:40px!important;min-width:40px!important;' +
        'height:40px!important;min-height:40px!important;max-height:40px!important;' +
        'padding:0!important;border-radius:50%!important;' +
        'background:var(--cx-brand)!important;' +
        'border:none!important;' +
        'box-shadow:var(--cx-shadow-md)!important;' +
        'overflow:hidden!important;' +
        'display:flex!important;align-items:center;justify-content:center;' +
        'cursor:pointer!important;' +
        'transition:width .28s ease,height .28s ease,padding .28s ease,border-radius .28s ease,background .2s ease!important;' +
      '}' +
      '#__cxPanel.ninja:not(.ninja-open)[data-state="playing"]{background:var(--cx-success)!important;}' +
      '#__cxPanel.ninja:not(.ninja-open)[data-state="paused"]{background:var(--cx-warning)!important;}' +
      '#__cxPanel.ninja:not(.ninja-open)[data-state="error"]{background:var(--cx-danger)!important;}' +
      '#__cxPanel.ninja:not(.ninja-open)[data-state="idle"]{background:var(--cx-border2)!important;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-header,' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-cmd-wrap,' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-seg,' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-body,' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-footer{display:none!important;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-titlebar{display:none!important;}' +
      '#__cxPanel.ninja .cx-ninja-fab{display:none;}' +
      '#__cxPanel:not(.ninja) .cx-ninja-fab{display:none!important;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-fab{display:flex!important;align-items:center;justify-content:center;width:100%;height:100%;position:absolute;inset:0;cursor:pointer;color:#fff;touch-action:none;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-fab:hover{transform:scale(1.08);}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-fab:active{transform:scale(0.96);}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-fab:focus-visible{box-shadow:0 0 0 2px var(--cx-bg),0 0 0 4px var(--cx-brand);border-radius:50%;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-dot{width:auto;height:auto;border-radius:0;background:transparent;box-shadow:none;display:flex;align-items:center;justify-content:center;color:#fff;animation:none;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-dot.paused,' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-dot.idle,' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-dot.is-warning{background:transparent;box-shadow:none;animation:none;color:#fff;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-icon{display:block;width:18px;height:18px;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-badge{position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;padding:0 4px;font-size:10px;line-height:16px;text-align:center;border-radius:999px;background:var(--cx-danger);color:#fff;opacity:0;transition:opacity .2s;pointer-events:none;font-family:inherit;white-space:nowrap;box-sizing:border-box;}' +
      '#__cxPanel.ninja:not(.ninja-open) .cx-ninja-badge:not([data-count="0"]){opacity:1;}' +
      // 展开态：仅取消 .ninja 的圆形约束，完整还原为「正常面板」布局——抵消 .ninja 泄漏的
      // align-items:center/justify-content:center，使内部内容(图表/文字/分段导航)与普通面板完全一致铺开，
      // 不改变宽度/字号（避免旧版「改宽度」导致图表文字过大）。n 模式除缩小悬浮球外不影响任何内容。
      '#__cxPanel.ninja.ninja-open{' +
        'width:var(--cx-panel-w,340px)!important;max-width:calc(100vw - 24px)!important;min-width:auto!important;' +
        'height:auto!important;min-height:auto!important;max-height:calc(100vh - 24px)!important;' +
        'padding:0!important;border-radius:12px!important;overflow:hidden!important;overflow-x:hidden!important;' +
        'display:flex!important;flex-direction:column!important;' +
        'align-items:stretch!important;justify-content:flex-start!important;' +
      '}' +
      '#__cxPanel.ninja.cx-dragging,#__cxPanel.ninja.cx-dragging:hover{width:40px!important;max-width:40px!important;min-width:40px!important;height:40px!important;min-height:40px!important;max-height:40px!important;padding:0!important;border-radius:50%!important;will-change:transform;}' +
      // 展开态复用各区块原生 flex 布局：标题栏/分段导航横向排布、底部两端对齐、主体区 flex 收缩并内部滚动。
      // 不再强制 display:block，避免 ninja 模式展开后排版错乱（分段导航竖排、底部堆叠等）。
      '@keyframes cx-led-pulse{0%,100%{opacity:.85;}50%{opacity:.4;}}' +
      '@media (max-width:480px){' +
        '#__cxPanel.ninja{width:44px!important;min-width:44px!important;max-width:44px!important;height:44px!important;min-height:44px!important;max-height:44px!important;right:12px!important;bottom:calc(12px + env(safe-area-inset-bottom,0px))!important;top:auto!important;left:auto!important;}' +
        '#__cxPanel.ninja.ninja-open{left:8px!important;right:8px!important;top:auto!important;bottom:calc(8px + env(safe-area-inset-bottom,0px))!important;width:auto!important;max-width:none!important;min-width:auto!important;max-height:70vh!important;border-radius:16px 16px 0 0;}' +
      '}' +
      '@media (prefers-reduced-motion: reduce){#__cxPanel .cx-ninja-dot,#__cxPanel .cx-hero-progress-bar,#__cxPanel .cx-video-toggle::after,#__cxPanel .cx-metric-val{animation:none!important;transition:none!important;}}'
  };

