  // ===== DOMAIN: presentation/panel-template (panel HTML view) =====
  // Panel HTML template (view layer): returns the floating panel skeleton string, injected by ensurePanel.
  // Depends only on STYLES and the passed _inFrame flag (cross-origin iframe fallback marker).

  // —— DeepSeek 页特化：应答端控制台（隐藏视频控制，显示登录态/通道/应答开关）——
  // 课程页是「主控面板」，DeepSeek 页是「应答端控制台」：两者角色不同，面板须特化。
  function buildDSConsoleHTML(_inFrame) {
    var CFG = currentSiteCfg();
    var T = (typeof STYLES !== 'undefined' && STYLES.T) ? STYLES.T : {};
    var c = function (k, d) { return (T && T[k]) || d; };
    var title = (CFG && CFG.title) || 'DeepSeek 应答端控制台';
    var ver = (typeof SCRIPT_VERSION !== 'undefined') ? SCRIPT_VERSION : '?';
    var copyLabel = (CFG && CFG.copyDiagnosticsLabel) || '复制联动诊断';
    return '' +
      '<div class="cx-titlebar" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<span id="__cxPanelBadge" class="cx-statusled" title="本页运行状态" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c('idle', '#6b7280') + ';flex:0 0 auto;"></span>' +
        '<b class="cx-title" style="font-size:14px;flex:1;">' + escapeHTML(title) + '</b>' +
        '<span id="__cxPanelVersion" style="font-size:10px;color:' + c('text3', '#7b8494') + ';">v' + escapeHTML('' + ver) + '</span>' +
        '<span id="__cxNinjaHandle" title="收起面板" style="cursor:pointer;padding:0 4px;font-size:16px;line-height:1;color:' + c('text3', '#7b8494') + ';">×</span>' +
      '</div>' +
      '<div id="__cxBody" style="max-height:70vh;overflow:auto;">' +
        // 联动状态
        '<div style="margin:6px 0 10px;">' +
          '<div style="font-size:11px;color:' + c('text2', '#aeb6c2') + ';margin-bottom:6px;">联动状态</div>' +
          '<div id="__cxDsLogin" style="font-size:12px;margin:3px 0;">—</div>' +
          '<div id="__cxDsChannel" style="font-size:12px;margin:3px 0;color:' + c('text2', '#aeb6c2') + ';">—</div>' +
          '<div id="__cxDsResponder" style="font-size:12px;margin:3px 0;color:' + c('text2', '#aeb6c2') + ';">—</div>' +
          '<div id="__cxDsLast" style="font-size:11px;margin:3px 0;color:' + c('text3', '#7b8494') + ';line-height:1.4;">—</div>' +
        '</div>' +
        // 联动控制
        '<div style="margin:6px 0 10px;">' +
          '<div style="font-size:11px;color:' + c('text2', '#aeb6c2') + ';margin-bottom:6px;">联动控制</div>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin:4px 0;">' +
            '<input type="checkbox" id="__cxDsEnable">' +
            '<span>允许本页作为应答端（接收课程页答题请求）</span>' +
          '</label>' +
          '<div style="font-size:11px;color:' + c('text3', '#7b8494') + ';margin-top:4px;line-height:1.4;">关闭后本页停止接收/应答，课程页将回退到随机兜底作答。</div>' +
        '</div>' +
        // 工具库
        '<div style="margin:6px 0 10px;">' +
          '<div style="font-size:11px;color:' + c('text2', '#aeb6c2') + ';margin-bottom:6px;">工具库（已接入主面板）</div>' +
          '<div id="__cxAddons"></div>' +
        '</div>' +
        // 系统
        '<div style="margin:6px 0 2px;">' +
          '<div style="font-size:11px;color:' + c('text2', '#aeb6c2') + ';margin-bottom:6px;">系统</div>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin:4px 0;">' +
            '<input type="checkbox" id="__cxNinja"><span>灵动条（Ninja）</span></label>' +
          '<button id="__cxBtnCopy" style="display:block;width:100%;margin:4px 0;padding:6px 8px;font-size:12px;cursor:pointer;background:' + c('surface', '#2a2f3a') + ';color:' + c('text', '#e6e9ef') + ';border:1px solid ' + c('border', 'rgba(255,255,255,.1)') + ';border-radius:8px;">' + escapeHTML(copyLabel) + '</button>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;margin:4px 0;">' +
            '<input type="checkbox" id="__cxDebug"><span>调试模式</span></label>' +
        '</div>' +
      '</div>';
  }

  function buildPanelHTML(_inFrame) {
    try { if (typeof detectSite === 'function' && detectSite() === 'deepseek') return buildDSConsoleHTML(_inFrame); } catch (e) {}
    return (
      // 标题栏（状态徽章 + 版本 + 关闭按钮）
      '<div class="cx-titlebar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span id="__cxPanelBadge" class="cx-statusled" title="脚本运行状态" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + STYLES.T.idle + ';flex:0 0 auto;"></span>' +
          '<b class="cx-title" style="font-size:14px;">强制续播·主控面板 <span id="__cxVer" style="color:' + STYLES.T.text3 + ';font-weight:normal;font-size:11px;"></span></b>' +
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
      // 区块：主控 = 续播（日操播放控制：暂停/恢复 + 视频开关列表）与 做题（自动答题）两大并列区域，重要性对等
      '<div id="__cxTab_control" class="cx-tab">' +
        // —— 区域一：续播（与「做题」并列，重要性对等）——
        '<div id="__cxZoneContinue" style="border:1px solid ' + STYLES.T.border + ';border-radius:10px;padding:10px;margin-bottom:10px;background:' + STYLES.T.surface + ';box-shadow:' + STYLES.T.cardShadow + ';">' +
          '<div style="font-size:12px;font-weight:600;color:' + STYLES.T.text + ';margin-bottom:8px;display:flex;align-items:center;gap:6px;">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + STYLES.T.primary + ';"></span>续播（自动播放视频）</div>' +
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
          // 播放设置子区：把续播相关的精细控制从「自动化」tab 收拢到「续播」卡，与「做题」卡对称（布局建议 Rec A）
          '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:8px;padding-top:8px;">' +
            '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:6px;">播放设置（速率 / 循环 / 自动停止 / 恢复）</div>' +
            '<label style="display:block;margin-bottom:6px;font-size:12px;">自动停止计时 (分钟): <b id="__cxAutoVal" class="cx-mono">0</b>' +
              '<input id="__cxAuto" type="range" min="0" max="120" step="1" value="0" style="width:100%;"></label>' +
            '<label style="display:block;margin-bottom:6px;font-size:12px;">暂停后自动恢复 (分钟): <b id="__cxResumeVal" class="cx-mono">0</b>' +
              '<input id="__cxResume" type="range" min="0" max="60" step="1" value="0" style="width:100%;"></label>' +
            '<label style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxLoop" type="checkbox" style="vertical-align:middle;margin-right:6px;">循环播放（播完从头重播）</label>' +
            '<div id="__cxRateRow" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;font-size:12px;">' +
              '<span>播放速率</span>' +
              '<span><b id="__cxRateVal" class="cx-mono">' + (CONFIG.USER_RATE || 1) + 'x</b>' +
              '<select id="__cxRate" style="font-size:12px;margin-left:6px;">' +
                '<option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option>' +
                '<option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="1.75">1.75x</option><option value="2">2x</option>' +
              '</select></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // —— 区域二：做题（与「续播」并列，重要性对等）—— 通用真答题引擎核心开关 + 实时进度
        '<div id="__cxZoneQuiz" style="border:1px solid ' + STYLES.T.border + ';border-radius:10px;padding:10px;margin-bottom:8px;background:' + STYLES.T.surface + ';box-shadow:' + STYLES.T.cardShadow + ';">' +
          '<div style="font-size:12px;font-weight:600;color:' + STYLES.T.text + ';margin-bottom:8px;display:flex;align-items:center;gap:6px;">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + STYLES.T.success + ';"></span>做题（自动答题）</div>' +
          // 子块一：通用真答题引擎（chaoxing/renwei/unipus/ucampus/ilabx）
          '<div id="__cxQuizBlock">' +
          '<label id="__cxQuizAutoRow" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;cursor:pointer;"><input id="__cxQuizAuto" type="checkbox" style="margin:0;">自动答题（通用真答题引擎：超星/人卫/Unipus/U校园/实验空间等）</label>' +
          // 实时作答进度（与续播视频开关联动：开 → 实时；关 → 灰显）
          '<div id="__cxQuizStatRow" style="font-size:12px;color:' + STYLES.T.text2 + ';margin-bottom:8px;line-height:1.6;">' +
            '<div style="display:flex;justify-content:space-between;"><span>题目总数</span><b id="__cxQuizTotal" class="cx-mono">—</b></div>' +
            '<div style="display:flex;justify-content:space-between;"><span>已作答</span><b id="__cxQuizDone" class="cx-mono">—</b></div>' +
            '<div style="display:flex;justify-content:space-between;"><span>待作答</span><b id="__cxQuizRemain" class="cx-mono">—</b></div>' +
            '<div style="display:flex;justify-content:space-between;"><span>答案来源</span><b id="__cxQuizSrc" class="cx-mono">—</b></div>' +
          '</div>' +
          '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:4px;padding-top:8px;">' +
            '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:4px;">答案来源（切到真答题需配置题库/接口）</div>' +
            '<select id="__cxQuizSource" style="width:100%;font-size:12px;background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:1px solid ' + STYLES.T.border + ';border-radius:5px;padding:4px;">' +
              '<option value="random">随机（保不卡进度）</option>' +
              '<option value="bank">题库（本地/远程题库）</option>' +
              '<option value="ai">AI（视觉识别+DeepSeek 等）</option>' +
            '</select>' +
            '<div id="__cxQuizSrcHint" style="font-size:10px;color:' + STYLES.T.text3 + ';margin-top:4px;line-height:1.4;">random 仅随机勾选，确保进度不被卡；选 bank/ai 前请确认已配置题库或 DeepSeek 通道，否则回退随机。</div>' +
          '</div>' +   // 关闭 __cxQuizBlock
          // 子块二：上课随堂题弹窗作答（智慧树上课/icourse163/xuetangx/icve）
          '<div id="__cxPopupBlock" style="display:none;">' +
            '<label id="__cxPopupAutoRow" style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;cursor:pointer;"><input id="__cxPopupAuto" type="checkbox" style="margin:0;">弹窗自动作答（上课随堂题：随机选·答题·关弹窗）</label>' +
            '<div id="__cxPopupStatRow" style="font-size:12px;color:' + STYLES.T.text2 + ';margin-bottom:8px;line-height:1.6;">' +
              '<div style="display:flex;justify-content:space-between;"><span>已处理弹窗</span><b id="__cxPopupCount" class="cx-mono">0</b></div>' +
            '</div>' +
            '<div style="font-size:10px;color:' + STYLES.T.text3 + ';margin-top:4px;line-height:1.4;">关闭后随堂题弹窗不再自动处理，需手动关闭（否则可能遮挡播放）。</div>' +
          '</div>' +
          // 智慧树作业/考试作答引导（布局建议 Rec B）：专属作答在独立 FAB「作业/考试助手」，不在本区
          '<div id="__cxZhExamHint" style="display:none;border-top:1px dashed ' + STYLES.T.border + ';margin-top:8px;padding-top:6px;font-size:11px;color:' + STYLES.T.text2 + ';line-height:1.5;">' +
            '<div>作业 / 考试作答：专属「作业/考试助手」面板（自动作答 + 手动交卷），与本区随堂题弹窗作答互不冲突。</div>' +
            '<button id="__cxBtnZhExam" style="margin-top:6px;width:100%;padding:7px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;">打开作业 / 考试助手</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // 区块：自动化（仅保留工具库项开关；续播精细控制已收拢至「续播」卡，见布局建议 Rec A）
      '<div id="__cxTab_automation" class="cx-tab">' +
        '<div id="__cxAddonsWrap" style="margin-top:2px;padding-top:4px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:6px;">工具库（已接入主面板）</div>' +
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
        // 安全审计（建议#10）：实时展示当前对宿主页面的侵入面，落实审计透明化诉求。置于「洞察」栏：运行状况/侵入透明视角更贴切。
        '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:10px;padding-top:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<div style="font-size:12px;color:' + STYLES.T.text + ';">安全审计 · 当前侵入点（实时）</div>' +
            '<button id="__cxBtnAudit" style="padding:3px 8px;font-size:11px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:5px;cursor:pointer;">刷新</button>' +
          '</div>' +
          '<div id="__cxInvasionReport" style="font-size:11px;color:' + STYLES.T.text2 + ';">— 开面板后自动盘点 —</div>' +
          '<div style="font-size:10px;color:' + STYLES.T.text3 + ';margin-top:4px;">绿○=未侵入/已还原 · 黄●=当前已接管 · 卸载时全部还原（/cleardata 清配置）</div>' +
          // 提示流：把各种轻提示/告警集中到「洞察」页，便于回看（替代仅靠悬浮 toast 一闪而过难追溯）
          '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:10px;padding-top:8px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
              '<div style="font-size:12px;color:' + STYLES.T.text + ';">提示流（全部轻提示/告警）</div>' +
              '<button id="__cxBtnClearFeed" style="padding:3px 8px;font-size:11px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:5px;cursor:pointer;">清空</button>' +
            '</div>' +
            '<div id="__cxToastFeed" style="max-height:180px;overflow-y:auto;font-size:11px;line-height:1.5;"><div id="__cxToastFeedEmpty" style="color:' + STYLES.T.text3 + ';font-size:11px;">暂无提示 · 答题/操作会在此汇总</div></div>' +
            '<div style="font-size:10px;color:' + STYLES.T.text3 + ';margin-top:4px;">绿=成功/信息 · 黄=警告 · 红=错误</div>' +
          '</div>' +
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
        // #1 温和/礼貌模式：入侵模式（原型中性化策略）+ 礼貌模式（抗检测）开关
        '<div id="__cxIntrusionRow" style="display:block;margin-bottom:6px;font-size:12px;">入侵模式: ' +
          '<select id="__cxIntrusion" style="margin-left:6px;font-size:12px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text + ';border:1px solid ' + STYLES.T.border + ';border-radius:5px;padding:2px 4px;">' +
            '<option value="auto">auto（按站点自适应）</option>' +
            '<option value="gentle">gentle（仅实例级·最小侵入）</option>' +
            '<option value="aggressive">aggressive（始终改原型·最稳）</option>' +
          '</select>' +
        '</div>' +
        '<label id="__cxPoliteRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxPolite" type="checkbox" style="vertical-align:middle;margin-right:6px;">礼貌模式（pause.toString 伪装·抗检测）</label>' +
        '<button id="__cxBtnCopy" style="width:100%;padding:7px;margin-bottom:4px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">复制诊断信息（反馈用）</button>' +
        '<button id="__cxBtnExport" style="width:100%;padding:7px;margin-top:4px;' + STYLES.BTN_GHOST + 'font-size:12px;">导出最近操作日志（黑匣子）</button>' +
        '<button id="__cxBtnClearBx" style="width:100%;padding:7px;margin-top:4px;' + STYLES.BTN_DANGER + 'font-size:12px;">清空黑匣子日志</button>' +
        '<div style="font-size:11px;color:' + STYLES.T.text3 + ';margin-top:6px;">按 <b>P</b> 开关本面板 · <b>Esc</b> 关闭 · 0 = 禁用</div>' +
      '</div>' +
      // 钉底最近提示（布局建议 Rec C）：常驻面板底部、跨 tab 可见，解决提示流"仅在洞察页"难即时看见的问题
      '<div id="__cxTipPin" style="border-top:1px solid ' + STYLES.T.border + ';margin-top:8px;padding-top:6px;display:flex;gap:6px;align-items:baseline;">' +
        '<span style="flex:0 0 auto;font-size:11px;color:' + STYLES.T.text2 + ';">最近提示</span>' +
        '<span id="__cxTipPinText" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:' + STYLES.T.text3 + ';"></span>' +
      '</div>'
    );
  }
