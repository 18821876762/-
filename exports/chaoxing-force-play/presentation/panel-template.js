// @requires: SCRIPT_VERSION, STYLES, currentSiteCfg, cxIcon, detectSite, escapeHTML
// @source-group: presentation/panel-template.js
  // ===== DOMAIN: presentation/panel-template (panel HTML view) =====
  // Panel HTML template (view layer): returns the floating panel skeleton string, injected by ensurePanel.
  // Depends only on STYLES and the passed _inFrame flag (cross-origin iframe fallback marker).

  // —— DeepSeek 页特化：应答端控制台 ——
  function buildDSConsoleHTML(_inFrame) {
    var CFG = currentSiteCfg();
    var T = (typeof STYLES !== 'undefined' && STYLES.T) ? STYLES.T : {};
    var c = function (k, d) { return (T && T[k]) || d; };
    var title = (CFG && CFG.title) || 'DeepSeek 应答端控制台';
    var ver = (typeof SCRIPT_VERSION !== 'undefined') ? SCRIPT_VERSION : '?';
    var copyLabel = (CFG && CFG.copyDiagnosticsLabel) || '复制联动诊断';
    return '' +
      '<div class="cx-header cx-titlebar">' +
        '<span id="__cxPanelBadge" class="cx-statusled cx-led" title="本页运行状态"></span>' +
        '<b class="cx-title-text">' + escapeHTML(title) + '</b>' +
        '<span id="__cxPanelVersion" style="font-size:' + c('fs11','11px') + ';color:' + c('text3','#9CA3AF') + ';">v' + escapeHTML('' + ver) + '</span>' +
        '<button id="__cxNinjaHandle" class="cx-icon-btn" title="收起面板">' + cxIcon('close', 16) + '</button>' +
      '</div>' +
      '<div class="cx-body" id="__cxBody" style="max-height:70vh;overflow:auto;">' +
        // —— 状态卡：整体状态胶囊 + 登录态 + 行式键值（对齐现代 AI 产品观感；样式走令牌随深色模式自适应）——
        '<div class="cx-ds-card">' +
          '<div class="cx-ds-hero">' +
            '<span id="__cxDsPill" class="cx-ds-pill" title="应答端整体状态">—</span>' +
            '<span id="__cxDsLogin" class="cx-ds-sub">—</span>' +
          '</div>' +
          '<div class="cx-ds-row"><span class="cx-ds-k">应答状态</span><span id="__cxDsResponder" class="cx-ds-v">—</span></div>' +
          '<div class="cx-ds-row"><span class="cx-ds-k">数据通道</span><span id="__cxDsChannel" class="cx-ds-v">—</span></div>' +
          '<div class="cx-ds-row"><span class="cx-ds-k">题目载荷</span><span id="__cxDsMode" class="cx-ds-v">—</span></div>' +
        '</div>' +
        // —— 最近交互：对话式呈现（贴近平台 AI 助手的问答观感）——
        '<div class="cx-ds-exchange">' +
          '<div class="cx-ds-ex-label">最近交互</div>' +
          '<div id="__cxDsLast">—</div>' +
        '</div>' +
        // —— 数据循环遥测：chips 轻量化（无数据时 :empty 自动隐藏）——
        '<div id="__cxDsLoop" class="cx-ds-chips"></div>' +
        // —— 异常条：仅出错时可见（:empty 自动隐藏）——
        '<div id="__cxDsWarn" class="cx-ds-alert"></div>' +
        '<div class="cx-setting-section">' +
          '<div class="cx-section-title" style="margin:8px 0 8px;">联动控制</div>' +
          '<label class="cx-setting-row" style="border:none;padding:8px 0;">' +
            '<span class="cx-setting-label"><input type="checkbox" id="__cxDsEnable" style="margin-right:8px;vertical-align:middle;">允许本页作为应答端（接收课程页答题请求）</span>' +
          '</label>' +
          '<div style="font-size:11px;color:' + c('text3','#9CA3AF') + ';margin:-4px 0 8px;line-height:1.5;">关闭后本页停止接收/应答，课程页将回退到随机兜底作答。</div>' +
        '</div>' +
        '<div>' +
          '<div class="cx-section-title">工具库（已接入主面板）</div>' +
          '<div id="__cxAddons"></div>' +
        '</div>' +
        '<div class="cx-setting-section" style="margin-top:12px;">' +
          '<div class="cx-section-title" style="margin:8px 0 8px;">系统</div>' +
          '<label class="cx-setting-row" style="border:none;padding:8px 0;">' +
            '<span class="cx-setting-label"><input type="checkbox" id="__cxNinja" style="margin-right:8px;vertical-align:middle;">灵动条（Ninja）</span>' +
          '</label>' +
          '<button id="__cxBtnCopy" class="cx-btn cx-btn-secondary" style="display:block;width:100%;margin:4px 0;">' + escapeHTML(copyLabel) + '</button>' +
          '<label class="cx-setting-row" style="border:none;padding:8px 0;">' +
            '<span class="cx-setting-label"><input type="checkbox" id="__cxDebug" style="margin-right:8px;vertical-align:middle;">调试模式</span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="cx-footer">' +
        '<span>v' + escapeHTML('' + ver) + '</span>' +
      '</div>';
  }

  function buildPanelHTML(_inFrame) {
    try { if (typeof detectSite === 'function' && detectSite() === 'deepseek') return buildDSConsoleHTML(_inFrame); } catch (e) {}
    return (
      // ===== Ninja 折叠态 FAB（圆形呼吸灯） =====
      '<div class="cx-ninja-fab" tabindex="0" role="button" aria-label="网课强制续播控制球" aria-expanded="false" title="网课强制续播 · 点击展开 / 长按拖动可移动">' +
        '<div class="cx-ninja-dot" id="__cxNinjaDot">' +
          '<svg class="cx-ninja-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
        '</div>' +
        '<span class="cx-ninja-badge" data-count="0" aria-hidden="true">0</span>' +
      '</div>' +
      // ===== 标题栏 =====
      '<div class="cx-header cx-titlebar">' +
        '<span id="__cxPanelBadge" class="cx-statusled cx-led" title="脚本运行状态"></span>' +
        '<b class="cx-title-text">强制续播·主控面板 <span id="__cxVer" style="font-weight:400;font-size:11px;color:var(--cx-text3);"></span></b>' +
        '<span id="__cxTopRate" class="cx-rate-badge"></span>' +
        (_inFrame ? '<span style="font-size:10px;color:var(--cx-warning);">frame</span>' : '') +
        '<button id="__cxExitNinja" class="cx-exit-ninja" style="display:none;cursor:pointer;">退出 n</button>' +
        '<button id="__cxPanelClose" class="cx-icon-btn" title="关闭">' + cxIcon('close', 18) + '</button>' +
      '</div>' +
      // ===== 命令栏 =====
      '<div class="cx-cmd-wrap">' +
        '<span class="cx-cmd-k">/</span>' +
        '<input id="__cxCmd" class="cx-cmd-input" type="text" placeholder="输入命令或搜索…" autocomplete="off" spellcheck="false">' +
        '<div id="__cxCmdList" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;max-height:200px;overflow-y:auto;z-index:10;pointer-events:none;"></div>' +
      '</div>' +
      // ===== 分段导航（Segmented Control） =====
      '<div class="cx-seg cx-nav">' +
        '<button class="cx-seg-btn cx-nav-btn active" data-tab="control">播放</button>' +
        '<button class="cx-seg-btn cx-nav-btn" data-tab="automation">答题</button>' +
        '<button class="cx-seg-btn cx-nav-btn" data-tab="insight">监控</button>' +
        '<button class="cx-seg-btn cx-nav-btn" data-tab="system">设置</button>' +
      '</div>' +
      // ===== 主体内容 =====
      '<div class="cx-body">' +
      // ----- Tab: 播放 (control) -----
      '<div id="__cxTab_control" class="cx-tab">' +
        // Hero 主操作卡
        '<div id="__cxHeroCard" class="cx-hero idle">' +
          '<div class="cx-hero-top">' +
            '<div id="__cxHeroStatus" class="cx-hero-status">' + '<span style="color:var(--cx-idle)">' + cxIcon('dot', 8) + '</span> 空闲</div>' +
            '<div id="__cxHeroSrc" class="cx-hero-src">等待视频…</div>' +
          '</div>' +
          '<div class="cx-hero-main">' +
            '<div id="__cxHeroTime" class="cx-hero-time">0:00<small> / 0:00</small></div>' +
            '<button id="__cxBtnPause" class="cx-hero-play" title="暂停/恢复续播">' + cxIcon('pause', 20) + '</button>' +
          '</div>' +
          '<div class="cx-hero-progress">' +
            '<div id="__cxHeroProgress" class="cx-hero-progress-bar"></div>' +
          '</div>' +
        '</div>' +
        // 视频列表
        '<div class="cx-section-title">视频列表</div>' +
        '<div id="__cxVideoList" class="cx-video-list" role="list"></div>' +
        // 快捷操作
        '<div class="cx-quick-row">' +
          '<button id="__cxBtnOnlyFg" class="cx-quick-btn" title="暂停所有其他视频，只保留前台播放">仅播此轨</button>' +
          '<button id="__cxBtnResumeAll" class="cx-quick-btn" title="恢复所有视频的续播控制">全部续播</button>' +
          '<label class="cx-quick-label" title="锁定后滚动不会丢失前台资格"><input id="__cxLockFg" type="checkbox">锁定</label>' +
        '</div>' +
        // 播放设置（折叠在视频列表下方）
        '<div class="cx-section-title">播放设置</div>' +
        '<div class="cx-setting-section">' +
          '<label class="cx-setting-row">' +
            '<span class="cx-setting-label">自动停止 <span id="__cxAutoVal" class="cx-mono">0</span> 分钟</span>' +
            '<input id="__cxAuto" type="range" min="0" max="120" step="1" value="0" style="width:120px;">' +
          '</label>' +
          '<label class="cx-setting-row">' +
            '<span class="cx-setting-label">暂停后恢复 <span id="__cxResumeVal" class="cx-mono">0</span> 分钟</span>' +
            '<input id="__cxResume" type="range" min="0" max="60" step="1" value="0" style="width:120px;">' +
          '</label>' +
          '<label class="cx-setting-row">' +
            '<span class="cx-setting-label"><input id="__cxLoop" type="checkbox" style="margin-right:8px;vertical-align:middle;">循环播放</span>' +
          '</label>' +
          '<div class="cx-setting-row">' +
            '<span class="cx-setting-label">播放速率</span>' +
            '<select id="__cxRate">' +
              '<option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option>' +
              '<option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="1.75">1.75x</option><option value="2">2x</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
      '</div>' +
