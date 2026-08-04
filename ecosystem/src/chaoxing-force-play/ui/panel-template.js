  // ===== DOMAIN: ui/panel-template (panel HTML view) =====
  // Panel HTML template (view layer): returns the floating panel skeleton string, injected by ensurePanel.
  // Depends only on STYLES and the passed _inFrame flag (cross-origin iframe fallback marker).
  function buildPanelHTML(_inFrame) {
    return (
      // 标题栏（状态徽章 + 版本 + 关闭按钮）
      '<div class="cx-titlebar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span id="__cxPanelBadge" class="cx-statusled" title="脚本运行状态" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + STYLES.T.idle + ';flex:0 0 auto;"></span>' +
          '<b class="cx-title" style="font-size:14px;">学习通·主控面板 <span id="__cxVer" style="color:' + STYLES.T.text3 + ';font-weight:normal;font-size:11px;"></span></b>' +
          '<span id="__cxTopRate" style="font-size:11px;color:' + STYLES.T.text3 + ';margin-left:6px;"></span>' +
          (_inFrame ? '<span style="font-size:9px;color:' + STYLES.T.warning + ';">frame 内</span>' : '') +
        '</div>' +
        '<button id="__cxExitNinja" class="cx-exit-ninja" style="display:none;cursor:pointer;">退出 n 模式</button>' +
        '<span class="cx-ninja-glyph cx-playing" aria-hidden="true" style="display:none;">' +   // 折叠态图标：默认 playing（强制播放中→显示播放三角 ▶；全部暂停→由 JS 切到 cx-paused 显示双竖条 ‖）
          '<svg class="cx-glyph cx-glyph-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5 L8.5 18.5 L20.5 12 Z"/></svg>' +   // 质心 x=(8.5+8.5+20.5)/3=12.5，压在 viewBox 中心并微右移补偿左重，视觉真正居中
          '<svg class="cx-glyph cx-glyph-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.8"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.8"/></svg>' +
        '</span>' +
        '<span id="__cxPanelClose" style="cursor:pointer;padding:0 6px;font-size:18px;line-height:1;">×</span>' +
      '</div>' +
      // 命令输入栏：输入 / 唤起命令下拉，支持参数与 ↑↓/Tab/Enter/Esc
      '<div class="cx-cmd-wrap" style="position:relative;margin-bottom:8px;">' +
        '<input id="__cxCmd" type="text" placeholder="输入 / 唤起命令…" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:6px 8px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;font-size:12px;outline:none;">' +
        '<div id="__cxCmdList" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;max-height:200px;overflow-y:auto;background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;z-index:10;"></div>' +
      '</div>' +
      // 顶部导航栏（主从式布局）：点击切换下方内容区块（v5 IA：主控/自动化/洞察/系统）
      '<div class="cx-nav" style="display:flex;gap:4px;margin-bottom:8px;">' +
        '<button class="cx-nav-btn" data-tab="control" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">主控</button>' +
        '<button class="cx-nav-btn" data-tab="automation" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">自动化</button>' +
        '<button class="cx-nav-btn" data-tab="insight" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">洞察</button>' +
        '<button class="cx-nav-btn" data-tab="system" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">系统</button>' +
      '</div>' +
      // 区块：主控（日操播放控制：暂停/恢复 + 视频开关列表）
      '<div id="__cxTab_control" class="cx-tab">' +
        '<button id="__cxBtnPause" style="width:100%;padding:9px;margin-bottom:8px;background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;">暂停 / 恢复</button>' +
        '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:8px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:4px;">视频开关（逐个续播/暂停 · ★=前台）</div>' +
          // 快切按钮栏
          '<div style="display:flex;gap:4px;margin-bottom:6px;">' +
            '<button id="__cxBtnOnlyFg" style="flex:1;padding:4px;font-size:11px;background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:0;border-radius:4px;cursor:pointer;" title="暂停所有其他视频，只保留前台播放">仅播此轨</button>' +
            '<button id="__cxBtnResumeAll" style="flex:1;padding:4px;font-size:11px;background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:0;border-radius:4px;cursor:pointer;" title="恢复所有视频的续播控制">全部续播</button>' +
            '<label style="display:flex;align-items:center;gap:2px;flex:0 0 auto;font-size:11px;color:' + STYLES.T.text2 + ';cursor:pointer;white-space:nowrap;" title="锁定后滚动不会丢失前台资格"><input id="__cxLockFg" type="checkbox" style="margin:0;">锁定</label>' +
          '</div>' +
          '<div id="__cxVideoList" style="max-height:190px;overflow-y:auto;"></div>' +   // 超过 5 个视频时滚动兜住（>5 的折叠/分页方案另做打算）
        '</div>' +
      '</div>' +
      // 区块：自动化（让脚本自己跑：计时器/循环/速率/副脚本开关）
      '<div id="__cxTab_automation" class="cx-tab">' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;">自动停止计时 (分钟): <b id="__cxAutoVal" class="cx-mono">0</b>' +
          '<input id="__cxAuto" type="range" min="0" max="120" step="1" value="0" style="width:100%;"></label>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;">暂停后自动恢复 (分钟): <b id="__cxResumeVal" class="cx-mono">0</b>' +
          '<input id="__cxResume" type="range" min="0" max="60" step="1" value="0" style="width:100%;"></label>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxLoop" type="checkbox" style="vertical-align:middle;margin-right:6px;">循环播放（播完从头重播）</label>' +
        '<div id="__cxRateRow" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">' +
          '<span>播放速率</span>' +
          '<span><b id="__cxRateVal" class="cx-mono">' + (CONFIG.USER_RATE || 1) + 'x</b>' +
          '<select id="__cxRate" style="font-size:12px;margin-left:6px;">' +
            '<option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option>' +
            '<option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="1.75">1.75x</option><option value="2">2x</option>' +
          '</select></span>' +
        '</div>' +
        '<div id="__cxAddonsWrap" style="border-top:1px solid ' + STYLES.T.border + ';margin-top:4px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:6px;">副脚本（已接入主面板）</div>' +
          '<div id="__cxAddons"></div>' +
        '</div>' +
      '</div>' +
      // 区块：洞察（周操看运行状况：仪表盘/视频信息/诊断/内嵌副面板）
      '<div id="__cxTab_insight" class="cx-tab">' +
        // 运维仪表盘：实时资源监控小面板
        '<div id="__cxDashboard" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">' +
          // — 左列：MO 队列（Sparkline 走势图 + 当前深度） —
          '<div style="background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';border-radius:8px;padding:6px;box-shadow:' + STYLES.T.cardShadow + ';">' +
            '<div style="font-size:9px;color:' + STYLES.T.text3 + ';margin-bottom:2px;">MO队列</div>' +
            '<div style="display:flex;align-items:flex-end;gap:2px;">' +
              '<canvas id="__cxMoSpark" width="80" height="20" style="flex:1;height:20px;"></canvas>' +
              '<b id="__cxMoVal" class="cx-mono" style="font-size:13px;color:' + STYLES.T.text + ';min-width:24px;text-align:right;">0</b>' +
            '</div>' +
          '</div>' +
          // — 右列：命中率 / 续播率 环形仪表（精密感：像汽车转速表）—
          '<div style="background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';border-radius:8px;padding:6px;box-shadow:' + STYLES.T.cardShadow + ';display:flex;gap:4px;">' +
            '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">' +
              '<svg width="34" height="34" viewBox="0 0 34 34" style="display:block;">' +
                '<circle cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.border + '" stroke-width="2"/>' +
                '<circle id="__cxHitGauge" cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.idle + '" stroke-width="2" stroke-dasharray="87.96" stroke-dashoffset="87.96" stroke-linecap="round" transform="rotate(-90 17 17)" style="transition:stroke-dashoffset .5s ease-out,stroke .3s ease;"/>' +
                '<text id="__cxHitGaugeTxt" class="cx-gauge-txt" x="17" y="20" text-anchor="middle" fill="' + STYLES.T.text + '" font-size="9">—</text>' +
              '</svg>' +
              '<span style="font-size:9px;color:' + STYLES.T.text3 + ';">命中率</span>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">' +
              '<svg width="34" height="34" viewBox="0 0 34 34" style="display:block;">' +
                '<circle cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.border + '" stroke-width="2"/>' +
                '<circle id="__cxPlayGauge" cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.idle + '" stroke-width="2" stroke-dasharray="87.96" stroke-dashoffset="87.96" stroke-linecap="round" transform="rotate(-90 17 17)" style="transition:stroke-dashoffset .5s ease-out,stroke .3s ease;"/>' +
                '<text id="__cxPlayGaugeTxt" class="cx-gauge-txt" x="17" y="20" text-anchor="middle" fill="' + STYLES.T.text + '" font-size="9">—</text>' +
              '</svg>' +
              '<span style="font-size:9px;color:' + STYLES.T.text3 + ';">续播率</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // 视频信息：当前视频状态/进度/已看
        '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:4px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:4px;">视频信息</div>' +
          '<div id="__cxPanelState" style="font-size:12px;color:' + STYLES.T.text2 + ';margin-bottom:8px;word-break:break-all;white-space:pre-line;"></div>' +
        '</div>' +
        '<div id="__cxPanelInfo" style="font-size:11px;color:' + STYLES.T.text2b + ';margin-bottom:10px;white-space:pre-line;background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';padding:8px;border-radius:8px;box-shadow:' + STYLES.T.cardShadow + ';"></div>' +
        '<div id="__cxSubPanelsWrap" style="border-top:1px solid ' + STYLES.T.border + ';margin-top:8px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:6px;">副面板（内嵌显示，可折叠）</div>' +
          '<div id="__cxSubPanels"></div>' +
        '</div>' +
      '</div>' +
      // 区块：系统（月操维护：低频设置 + 诊断导出 + 帮助）
      '<div id="__cxTab_system" class="cx-tab">' +
        '<label id="__cxPanelWRow" style="display:block;margin-bottom:6px;font-size:12px;">面板宽度 (px): <b id="__cxPanelWVal" class="cx-mono">460</b>' +
          '<input id="__cxPanelW" type="range" min="288" max="760" step="4" value="460" style="width:100%;"></label>' +
        '<label id="__cxRescanRow" style="display:block;margin-bottom:6px;font-size:12px;">轮询间隔 (ms): <b id="__cxRescanVal" class="cx-mono">2000</b>' +
          '<input id="__cxRescan" type="range" min="500" max="5000" step="500" value="2000" style="width:100%;"></label>' +
        '<label id="__cxEndRelRow" style="display:block;margin-bottom:6px;font-size:12px;">进度到底释放 (秒): <b id="__cxEndRelVal" class="cx-mono">15</b>' +
          '<input id="__cxEndRel" type="range" min="0" max="120" step="5" value="15" style="width:100%;"></label>' +
        '<label id="__cxSingleVideoRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxSingleVideo" type="checkbox" style="vertical-align:middle;margin-right:6px;">只播放一个视频（仅前台播放，同开时取消视频开关）</label>' +
        '<label id="__cxNinjaRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxNinja" type="checkbox" style="vertical-align:middle;margin-right:6px;">Ninja 模式（缩成窄条，悬停展开）</label>' +
        '<label id="__cxDebugRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxDebug" type="checkbox" style="vertical-align:middle;margin-right:6px;">调试日志 (DEBUG → 控制台)</label>' +
        '<button id="__cxBtnCopy" style="width:100%;padding:7px;margin-bottom:4px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">复制诊断信息（反馈用）</button>' +
        '<button id="__cxBtnExport" style="width:100%;padding:7px;margin-top:4px;' + STYLES.BTN_GHOST + 'font-size:12px;">导出最近操作日志（黑匣子）</button>' +
        '<button id="__cxBtnClearBx" style="width:100%;padding:7px;margin-top:4px;' + STYLES.BTN_DANGER + 'font-size:12px;">清空黑匣子日志</button>' +
        '<div style="font-size:11px;color:' + STYLES.T.text3 + ';margin-top:6px;">按 <b>P</b> 开关本面板 · <b>Esc</b> 关闭 · 0 = 禁用</div>' +
      '</div>'
    );
  }
