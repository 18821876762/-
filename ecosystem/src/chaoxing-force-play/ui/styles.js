  // ===== DOMAIN: ui/styles (design tokens + injected CSS) =====
  // ===== MODULE: 样式/设计令牌 =====
  // 域：UI 层 —— 面板与通知相关的全部 CSS 字符串（设计令牌 + 注入样式），纯数据、无控制流。
  // 【内聚性收敛】原 STYLES 与 CONFIG/CONST/FLAGS/原型 neutralize/业务动作(applyUserRateAll/applyLoopAll)
  //   混居 meta-config/config.js（占该文件过半篇幅）。现样式成为单一事实源独立成模块，
  //   config.js 回归「元配置」职责；样式仅供 ui/* 与 dom.js(toast) 在运行时读取。
  // 导出：window.__cxUI = STYLES，供副脚本 addon 引用令牌保持视觉同构（设计 §5.3）。
  var STYLES = {
    // 宽度走 CSS 变量 --cx-panel-w（默认 380px）：单一事实源，面板正常态与 Ninja 展开态共用同一宽度，
    // 由「系统 → 面板宽度」滑块调节并持久化。旧版固定 288px 与 Ninja 展开宽度恰好相等，导致用户退出
    // Ninja 后看到的仍是同样窄的面板，误以为"没退出 n 模式"。
    PANEL_BOX:     'position:fixed;right:12px;top:12px;z-index:2147483647;box-sizing:border-box;width:var(--cx-panel-w,460px);max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow-y:auto;background:#F9FAFB;color:#1F2937;font:13px/1.5 sans-serif;border:1px solid #E5E7EB;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);padding:12px;user-select:none;',
    TOAST:         'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#FFFFFF;color:#1F2937;padding:6px 12px;border-radius:8px;font:12px/1.4 sans-serif;pointer-events:none;border:1px solid #E5E7EB;box-shadow:0 4px 14px rgba(0,0,0,.10);',
    PANEL_MOBILE:  '@media (max-width:480px){#__cxPanel{left:8px!important;right:8px!important;top:8px!important;width:auto!important;max-width:none!important;max-height:calc(100vh - 16px)!important;overflow-y:auto!important;font-size:12px!important;padding:10px!important;}#__cxPanel button{padding:11px!important;font-size:13px!important;}#__cxPanel .cx-nav-btn{padding:9px!important;}#__cxPanel input[type=range]{height:22px;}#__cxPanel #__cxAddons .cx-course button,#__cxPanel #__cxSubPanels button{padding:8px 12px!important;font-size:13px!important;}}',
    DIAG_BLOCK:    'margin-bottom:10px;font-size:12px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);',
    DIAG_HEAD:     'cursor:pointer;padding:6px 8px;background:#F3F4F6;color:#1F2937;font-weight:600;display:flex;justify-content:space-between;align-items:center;',
    DIAG_CARET:    'font-size:10px;',
    DIAG_BODY:     'padding:8px;max-height:50vh;overflow:auto;',
    DIAG_ROW:      'margin-bottom:6px;font-size:12px;',
    DIAG_BTN:      'width:100%;padding:6px;background:#F3F4F6;color:#1F2937;border:0;border-radius:6px;cursor:pointer;font-size:12px;',
    DIAG_LAB:      'display:block;cursor:pointer;',
    DIAG_CB:       'vertical-align:middle;margin-right:6px;',
    DIAG_NOTE:     'font-size:11px;color:#6b7280;margin-left:20px;',
    NINJA_DEFAULT: '',   // 占位前缀（#__cxPanelNinjaDefault 规则已并入 NINJA_STYLE）；保持旧拼接 STYLES.NINJA_DEFAULT 兼容
    // 动效与精密感样式（仅在 ensurePanel 注入一次）：呼吸灯/环形仪表/等宽数字/微交互（设计：可靠感指南）
    ANIM:          '.cx-statusled{transition:background-color .3s ease,box-shadow .3s ease;animation:cx-led-pulse 3s infinite ease-in-out;}' +
                   '@keyframes cx-led-pulse{0%,100%{opacity:.85;}50%{opacity:.4;}}' +
                   '#__cxPanel button:active{transform:scale(.97);transition:transform .1s ease;}' +
                   '#__cxPanel input[type=range]::-webkit-slider-thumb{transition:transform .15s ease;}' +
                   '#__cxPanel input[type=range]::-webkit-slider-thumb:active{transform:scale(1.2);}' +
                   '#__cxPanel input[type=range]::-moz-range-thumb:active{transform:scale(1.2);}' +
                   '.cx-gauge-txt{font-family:"SF Mono","Roboto Mono",monospace;font-variant-numeric:tabular-nums;letter-spacing:.3px;}' +
                   '.cx-mono{font-family:"SF Mono","Roboto Mono",monospace;font-variant-numeric:tabular-nums;letter-spacing:.5px;}' +
                   '.cx-titlebar{cursor:move;}'
  };

  // ===== P5a 设计令牌（Design Tokens）：单一事实源，面板所有颜色/字号/间距/圆角必须引用此表 =====
  // 语义命名；唯一新色值为 danger（破坏性操作），其余为对现有散值(#2a2e37→border 等)的收敛命名。
  // 副脚本可经 window.__cxUI.T 引用，保证 addon 视觉与原生组件同构（设计 §5.3）。
  STYLES.T = {
    // —— 色板（浅色主题：从视频深色背景隔离，像 macOS 控制中心浮于白页）——
    bg:        '#F9FAFB',             // 面板底色：极浅灰白（视觉隔离带，告别与视频黑底融合）
    surface:   '#FFFFFF',             // 输入框/卡片/嵌套卡底色（白，从面板浅灰底浮起）
    surface2:  '#F3F4F6',             // 内部区块底色（极浅灰，备用）
    border:    '#E5E7EB',             // 统一描边/分隔线（浅灰，清晰而不刺眼）
    text:      '#1F2937',             // 主文字：深炭灰，告别纯黑
    text2:     '#6B7280',             // 次级文字：中性灰（Tab 未选中着色）
    text3:     '#9CA3AF',             // 弱化文字/占位
    primary:   '#3B82F6',             // 主色：雾霾蓝（专业不刺眼，替代原霓虹亮蓝）
    success:   '#10B981',             // 成功：青绿
    warning:   '#F59E0B',             // 收藏/警告
    danger:    '#EF4444',             // 破坏性操作
    idle:      '#9CA3AF',             // 未激活/禁用态（开关 off 轨道/状态灰）
    // —— 派生色（浅色主题下重新映射，保持组件可用）——
    primary2:   '#3B82F6',            // sparkline 描线/进度条已看/桥徽章/命中 tag
    primary2A25:'rgba(59,130,246,0.25)', // sparkline 渐变填充（蓝 25%）
    primary2A0: 'rgba(59,130,246,0)',    // sparkline 渐变填充（蓝 0%）
    primaryTxt: '#2563EB',            // 深蓝字：Ghost 按钮/命令高亮（浅蓝在白底不可见，故加深）
    onPrimary2: '#1E40AF',            // 命令高亮态次级文字（更深蓝）
    star:       '#2563EB',            // 前台星标 ★（深蓝，白底可见）
    track:      '#E5E7EB',            // 进度条轨道底色（浅灰）
    buffered:   'rgba(156,163,175,0.4)', // 进度条缓存段（灰 40%）
    cmdHi:      '#EFF6FF',            // 命令下拉高亮底（极浅蓝）
    text2b:     '#6B7280',            // 面板诊断块次级文字
    surface3:   '#F3F4F6',            // 深面板底（黑匣子导出按钮）
    paused:     '#F59E0B',            // 状态徽章·用户暂停（琥珀，区别于未激活灰 idle=#9CA3AF）
    // —— 字阶（禁止 10px：归并到 9 或 11）——
    fs9: '9px', fs11: '11px', fs12: '12px', fs13: '13px', fs14: '14px',
    // —— 间距（4 的倍数：组件内 4-6，组件间 8，区块间 12）——
    sp4: '4px', sp6: '6px', sp8: '8px', sp12: '12px',
    // —— 圆角三级 ——
    r4: '4px', r6: '6px', r8: '8px',
    // —— 阴影 ——
    shadow:     '0 12px 32px rgba(0,0,0,.12)',     // 面板浮起（浅色，柔和）
    cardShadow: '0 1px 3px rgba(0,0,0,0.05)'        // 内部卡片悬浮感
  };
  // Ninja 模式样式：必须延迟到 STYLES.T 令牌定义之后赋值——若在 `var STYLES` 自初始化期间访问 STYLES.T，
  // 此时 STYLES 自身为 undefined，会抛 TypeError 使整个 IIFE 在加载期崩溃（表现为 P 键/续播全线失效）。
  STYLES.NINJA_STYLE =  // 缩成圆形悬浮钮（仅呼吸灯），悬停/点击展开。圆形对称，任意侧观感一致
    '#__cxPanelNinjaDefault{right:12px;top:12px;}' +
    '#__cxPanel.ninja{' +
      'width:44px!important;max-width:44px!important;min-width:44px!important;' +     // 整体缩小一档：比正圆更紧凑，仍保留"控制中枢"胶囊感
      'height:50px!important;min-height:50px!important;max-height:50px!important;' +
      'padding:0!important;border-radius:14px!important;' +   // 圆角矩形(胶囊)：替代正圆，更"硬件/中枢"
      'background:rgba(255,255,255,.22)!important;' +         // 全息玻璃：半透明白，透出网页纹理
      '-webkit-backdrop-filter:blur(10px)!important;backdrop-filter:blur(10px)!important;' +   // 核心磨砂
      'border:1px solid rgba(255,255,255,.5)!important;' +    // 高光细边
      'box-shadow:0 6px 18px rgba(15,23,42,.22),inset 0 1px 0 rgba(255,255,255,.35)!important;' +  // 悬浮投影 + 顶部内高光，制造体积感
      'overflow:visible!important;' +
      'display:flex!important;align-items:center;justify-content:center;' +
      'cursor:pointer!important;' +   // 折叠态明显可点，避免用户误以为面板"死了"
      'transition:width .28s ease,height .28s ease,padding .28s ease,border-radius .28s ease,max-height .28s ease,box-shadow .2s ease,background .2s ease;' +
    '}' +
    '#__cxPanel.ninja .cx-title,' +
    '#__cxPanel.ninja #__cxPanelClose,' +
    '#__cxPanel.ninja .cx-cmd-wrap,' +
    '#__cxPanel.ninja .cx-nav,' +
    '#__cxPanel.ninja .cx-tab{display:none!important;}' +
    '#__cxPanel.ninja .cx-titlebar{display:flex!important;align-items:center;justify-content:center;width:100%!important;height:100%!important;margin:0!important;}' +
    '#__cxPanel.ninja .cx-titlebar > div{display:flex!important;align-items:center;justify-content:center;gap:0!important;}' +
    '#__cxPanel.ninja .cx-titlebar > div > span:not(#__cxPanelBadge){display:none!important;}' +
    '#__cxPanel.ninja #__cxPanelBadge{' +
      'margin:0!important;' +
      'width:13px!important;height:13px!important;' +       // 呼吸灯放大居中，填充浮球
      'box-shadow:0 0 0 3px rgba(59,130,246,.14);' +         // 柔和蓝晕，避免空荡
      'position:relative;' +
    '}' +
    '#__cxPanel.ninja #__cxPanelBadge::after{' +             // 脉冲光环：悬浮球"活着"的观感
      'content:"";position:absolute;inset:-4px;border-radius:50%;' +
      'border:1.5px solid ' + STYLES.T.primary + ';opacity:.55;' +
      'animation:cx-orb-ring 2s infinite ease-out;pointer-events:none;' +
    '}' +
    // 折叠态(未展开)：隐藏标题/状态点，居中白色图标（发光 + 暗投影，深浅网页都清晰），外圈呼吸光环
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-titlebar > div,' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) #__cxPanelBadge{display:none!important;}' +
    // 折叠态图标：精致双状态 SVG（播放三角 / 暂停双竖条），父级 flex 居中；按 cx-playing/cx-paused 切换显示
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph{' +
      'display:block!important;position:relative;width:18px;height:18px;margin:0!important;' +   // 固定盒居中（父级 flex），图标真正居中
    '}' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph .cx-glyph{' +
      'position:absolute;inset:0;width:100%;height:100%;fill:#fff!important;' +   // 纯白图标，与玻璃胶囊协调
      'filter:drop-shadow(0 0 6px rgba(255,255,255,.6)) drop-shadow(0 1px 2px rgba(0,0,0,.4));' +  // 发光 + 暗投影，保证深浅背景均可见
    '}' +
    // 状态联动（折叠态图标是「当前状态指示器」，非可点击的操作按钮）：有视频在播 → 显示播放三角(▶)；全部暂停 → 显示暂停双竖条(‖)
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph.cx-playing .cx-glyph-pause{display:none!important;}' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph.cx-paused .cx-glyph-play{display:none!important;}' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open)::after{' +
      'content:"";position:absolute;inset:-3px;border-radius:16px;box-sizing:border-box;' +   // 圆角矩形光环，匹配胶囊外形
      'border:1.5px solid rgba(255,255,255,.55);' +
      'animation:cx-orb-ring 2s infinite ease-out;pointer-events:none;' +
    '}' +
    '#__cxPanel:not(.ninja) .cx-ninja-glyph{display:none!important;}' +
    '#__cxPanel.ninja:hover,#__cxPanel.ninja.ninja-open{' +
      // 展开宽度跟随 --cx-panel-w，与正常态一致；否则退出 Ninja 后宽度不变，用户无从分辨是否已退出
      'width:var(--cx-panel-w,460px)!important;max-width:calc(100vw - 24px)!important;min-width:auto!important;' +
      'height:auto!important;min-height:auto!important;max-height:calc(100vh - 24px)!important;' +
      'padding:12px!important;border-radius:12px!important;overflow-y:auto!important;overflow-x:hidden!important;' +
      'display:block!important;' +   // 关键：悬停/展开恢复块级布局。否则 .ninja 折叠态的 display:flex 会把标题栏/命令栏/标签页当成横向 flex 项排布，开关被拉伸变形
      'background:' + STYLES.T.surface + '!important;' +   // 展开态恢复浅色面板底，否则会沿用折叠态蓝渐变导致内容难读
    '}' +
    // 拖拽中保持圆形折叠（防止悬停展开造成尺寸突变）；left/top 由内联显式锚定，自由落点
    '#__cxPanel.ninja.cx-dragging,#__cxPanel.ninja.cx-dragging:hover{width:44px!important;max-width:44px!important;min-width:44px!important;height:50px!important;min-height:50px!important;max-height:50px!important;padding:0!important;border-radius:14px!important;}' +
    // 退出 n 模式按钮：仅在 Ninja 展开态(悬停/粘性)显示，给卡在窄条、够不到「系统」勾选框的用户一条逃生通道
    '#__cxPanel.ninja:hover .cx-exit-ninja,#__cxPanel.ninja.ninja-open .cx-exit-ninja{' +
      'display:inline-block!important;margin-left:6px;padding:2px 8px;font-size:11px;' +
      'background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:4px;cursor:pointer;white-space:nowrap;' +
    '}' +
    '#__cxPanel:not(.ninja) .cx-exit-ninja{display:none!important;}' +
    '#__cxPanel.ninja:hover .cx-title,' +
    '#__cxPanel.ninja.ninja-open .cx-title,' +
    '#__cxPanel.ninja:hover #__cxPanelClose,' +
    '#__cxPanel.ninja.ninja-open #__cxPanelClose,' +
    '#__cxPanel.ninja:hover .cx-cmd-wrap,' +
    '#__cxPanel.ninja.ninja-open .cx-cmd-wrap,' +
    '#__cxPanel.ninja:hover .cx-nav,' +
    '#__cxPanel.ninja.ninja-open .cx-nav,' +
    '#__cxPanel.ninja:hover .cx-tab,' +
    '#__cxPanel.ninja.ninja-open .cx-tab{display:block!important;}' +
    '#__cxPanel.ninja:hover .cx-nav-btn,' +
    '#__cxPanel.ninja.ninja-open .cx-nav-btn{display:inline-block!important;}' +
    '#__cxPanel.ninja:hover .cx-titlebar,' +
    '#__cxPanel.ninja.ninja-open .cx-titlebar{justify-content:space-between!important;margin-bottom:8px!important;height:auto!important;}' +
    '#__cxPanel.ninja:hover .cx-titlebar > div,' +
    '#__cxPanel.ninja.ninja-open .cx-titlebar > div{gap:6px!important;}' +
    '#__cxPanel.ninja:hover #__cxPanelBadge,' +
    '#__cxPanel.ninja.ninja-open #__cxPanelBadge{margin:0;}' +
    '@keyframes cx-orb-ring{0%{transform:scale(.7);opacity:.6;}100%{transform:scale(1.7);opacity:0;}}';
  // —— 按钮四级制样式（P5c 组件化：全面板仅一级操作用 PRIMARY）——
  STYLES.BTN_PRIMARY   = 'background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  STYLES.BTN_SECONDARY = 'background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:0;border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  STYLES.BTN_GHOST     = 'background:' + STYLES.T.surface + ';color:' + STYLES.T.primaryTxt + ';border:1px solid ' + STYLES.T.primary + ';border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  STYLES.BTN_DANGER    = 'background:transparent;color:' + STYLES.T.danger + ';border:1px solid ' + STYLES.T.danger + ';border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  // 副脚本 UI 接入导出（设计 §5.3：addon 引用令牌保持视觉同构）
  try { window.__cxUI = STYLES; } catch (e) { swallow(e); }
