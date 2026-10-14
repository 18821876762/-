// @requires: CONFIG, SCRIPT_VERSION, cxIcon
// @source-group: presentation/panel-template.js
// @continuation-of: presentation/panel-template.js
// Monitoring and settings tab expressions inside buildPanelHTML.
      // ----- Tab: 监控 (insight) -----
      '<div id="__cxTab_insight" class="cx-tab" style="display:none;">' +
        // Metric 卡片（替代环形仪表）
        '<div class="cx-metrics">' +
          '<div class="cx-metric">' +
            '<div class="cx-metric-val" id="__cxMetricMo">0</div>' +
            '<div class="cx-metric-label">MO批次</div>' +
          '</div>' +
          '<div class="cx-metric">' +
            '<div class="cx-metric-val success" id="__cxMetricHit">—</div>' +
            '<div class="cx-metric-label">命中率</div>' +
          '</div>' +
          '<div class="cx-metric">' +
            '<div class="cx-metric-val success" id="__cxMetricPlay">—</div>' +
            '<div class="cx-metric-label">续播率</div>' +
          '</div>' +
        '</div>' +
        // Sparkline 迷你走势图
        '<div style="background:var(--cx-surface2);border-radius:10px;padding:10px;margin-bottom:12px;">' +
          '<div style="font-size:10px;color:var(--cx-text3);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">MO 批次走势（每周期 DOM 变更回调数）</div>' +
          '<div class="cx-sparkwrap">' +
            '<canvas id="__cxMoSpark" width="280" height="24"></canvas>' +
            '<b id="__cxMoVal" class="cx-mono" style="font-size:14px;color:var(--cx-text);min-width:28px;text-align:right;">0</b>' +
          '</div>' +
        '</div>' +
        // 视频状态
        '<div class="cx-section-title">视频状态</div>' +
        '<div id="__cxPanelState" style="font-size:12px;color:var(--cx-text2);margin-bottom:8px;word-break:break-all;white-space:pre-line;line-height:1.6;"></div>' +
        // 诊断信息
        '<div id="__cxPanelInfo" style="font-size:11px;color:var(--cx-text2);margin-bottom:12px;white-space:pre-line;background:var(--cx-surface2);padding:10px;border-radius:10px;line-height:1.6;"></div>' +
        // 副面板
        '<div id="__cxSubPanelsWrap">' +
          '<div class="cx-section-title">副面板</div>' +
          '<div id="__cxSubPanels"></div>' +
        '</div>' +
        // 安全审计
        '<div style="margin-top:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div style="font-size:13px;font-weight:600;">安全审计 · 侵入点</div>' +
            '<button id="__cxBtnAudit" class="cx-quick-btn" style="flex:none;padding:5px 10px;">刷新</button>' +
          '</div>' +
          '<div id="__cxInvasionReport" style="font-size:11px;color:var(--cx-text2);">— 开面板后自动盘点 —</div>' +
          '<div style="font-size:10px;color:var(--cx-text3);margin-top:4px;"><span class="cx-legend-dot ok"></span>未侵入 · <span class="cx-legend-dot warn"></span>已接管</div>' +
        '</div>' +
        // 功能自检矩阵（开发者模式 /dev）
        '<div style="margin-top:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div style="font-size:13px;font-weight:600;">功能自检矩阵 <span style="font-size:10px;font-weight:400;color:var(--cx-accent,#58a6ff);">· 联动诊断信息</span></div>' +
            '<button id="__cxBtnSelfTest" class="cx-quick-btn" style="flex:none;padding:5px 10px;">刷新</button>' +
          '</div>' +
          '<div id="__cxSelfTestReport" style="font-size:11px;color:var(--cx-text2);max-height:320px;overflow-y:auto;">— 开面板后自动盘点 —</div>' +
        '</div>' +
        // 提示流
        '<div style="margin-top:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div style="font-size:13px;font-weight:600;">提示流</div>' +
            '<button id="__cxBtnClearFeed" class="cx-quick-btn" style="flex:none;padding:5px 10px;">清空</button>' +
          '</div>' +
          '<div id="__cxToastFeed" style="max-height:180px;overflow-y:auto;font-size:11px;line-height:1.6;background:var(--cx-surface2);border-radius:8px;padding:8px;"><div id="__cxToastFeedEmpty" style="color:var(--cx-text3);">暂无提示</div></div>' +
          '<div style="font-size:10px;color:var(--cx-text3);margin-top:4px;"><span class="cx-legend-dot ok"></span>成功 · <span class="cx-legend-dot warn"></span>警告 · <span class="cx-legend-dot err"></span>错误</div>' +
        '</div>' +
      '</div>' +
      // ----- Tab: 设置 (system) -----
      '<div id="__cxTab_system" class="cx-tab" style="display:none;">' +
        '<div class="cx-setting-section">' +
          '<label class="cx-setting-row">' +
            '<span class="cx-setting-label">面板宽度 <span id="__cxPanelWVal" class="cx-mono">' + (typeof CONFIG !== 'undefined' && CONFIG.PANEL_W != null ? CONFIG.PANEL_W : 340) + '</span>px</span>' +
            '<input id="__cxPanelW" type="range" min="288" max="760" step="4" value="' + (typeof CONFIG !== 'undefined' && CONFIG.PANEL_W != null ? CONFIG.PANEL_W : 340) + '" style="width:120px;">' +
          '</label>' +
          '<label class="cx-setting-row">' +
            '<span class="cx-setting-label">轮询间隔 <span id="__cxRescanVal" class="cx-mono">2000</span>ms</span>' +
            '<input id="__cxRescan" type="range" min="500" max="5000" step="500" value="2000" style="width:120px;">' +
          '</label>' +
          '<label class="cx-setting-row">' +
            '<span class="cx-setting-label">进度到底释放 <span id="__cxEndRelVal" class="cx-mono">15</span>秒</span>' +
            '<input id="__cxEndRel" type="range" min="0" max="120" step="5" value="15" style="width:120px;">' +
          '</label>' +
        '</div>' +
        '<div class="cx-setting-section">' +
          '<label class="cx-setting-row" style="border:none;">' +
            '<span class="cx-setting-label"><input id="__cxSingleVideo" type="checkbox" style="margin-right:8px;vertical-align:middle;">只播放一个视频（仅前台）</span>' +
          '</label>' +
          '<label class="cx-setting-row" style="border:none;">' +
            '<span class="cx-setting-label"><input id="__cxNinja" type="checkbox" style="margin-right:8px;vertical-align:middle;">Ninja 模式（圆形悬浮球）</span>' +
          '</label>' +
          '<label class="cx-setting-row" style="border:none;">' +
            '<span class="cx-setting-label"><input id="__cxDebug" type="checkbox" style="margin-right:8px;vertical-align:middle;">调试日志</span>' +
          '</label>' +
          '<div class="cx-setting-row" style="border:none;">' +
            '<span class="cx-setting-label">入侵模式</span>' +
            '<select id="__cxIntrusion">' +
              '<option value="auto">auto（按站点自适应）</option>' +
              '<option value="gentle">gentle（最小侵入）</option>' +
              '<option value="aggressive">aggressive（始终改原型）</option>' +
            '</select>' +
          '</div>' +
          '<label class="cx-setting-row" style="border:none;">' +
            '<span class="cx-setting-label"><input id="__cxPolite" type="checkbox" style="margin-right:8px;vertical-align:middle;">礼貌模式（抗检测）</span>' +
          '</label>' +
          '<div class="cx-setting-row" style="border:none;padding:6px 0;">' +
            '<span class="cx-setting-label"><input id="__cxTakeoverEnabled" type="checkbox" style="margin-right:8px;vertical-align:middle;">启用接管（续播 / 自动答题）</span>' +
          '</div>' +
          '<div class="cx-setting-row" style="border:none;padding:4px 0 2px;display:flex;gap:8px;align-items:center;">' +
            '<button id="__cxBtnCourseTakeover" class="cx-btn cx-btn-sm" style="flex:1;min-width:0;" title="将当前课程加入/移出接管黑名单">本门课：—</button>' +
            '<span id="__cxCourseId" style="font-size:11px;color:var(--cx-text3);white-space:nowrap;">无</span>' +
          '</div>' +
          '<div class="cx-setting-row" style="border:none;padding:2px 0 6px;display:flex;gap:8px;align-items:center;">' +
            '<button id="__cxBtnCourseSingle" class="cx-btn cx-btn-sm" style="flex:1;min-width:0;" title="将当前课程加入/移出单视频名单（部分课程并发续播会触发风控，仅这些课程单视频）">本门课：单视频—</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">' +
          '<button id="__cxBtnCopy" class="cx-btn cx-btn-secondary" style="width:100%;">复制诊断信息（反馈用）</button>' +
          '<button id="__cxBtnExport" class="cx-btn cx-btn-ghost" style="width:100%;">导出最近操作日志</button>' +
          '<button id="__cxBtnClearBx" class="cx-btn cx-btn-danger" style="width:100%;">清空黑匣子日志</button>' +
        '</div>' +
        '<div class="cx-section-title">配置管理</div>' +
        '<div class="cx-setting-section">' +
          '<div class="cx-quick-row">' +
            '<button id="__cxBtnResetCfg" class="cx-quick-btn">恢复默认</button>' +
            '<button id="__cxBtnExportCfg" class="cx-quick-btn">导出配置</button>' +
            '<button id="__cxBtnImportCfg" class="cx-quick-btn">导入配置</button>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--cx-text3);margin-top:4px;">导出/导入以 cx_ 前缀键在 localStorage 间迁移配置</div>' +
        '</div>' +
        '<div class="cx-tip" style="margin-top:12px;">' +
          '<span>' + cxIcon('keyboard', 14) + '</span><span style="flex:1;">按 <b>P</b> 开关面板 · <b>Esc</b> 关闭 · <b>N</b> 切换 Ninja</span>' +
        '</div>' +
      '</div>' +
      '</div>' +
      // ===== 底部状态栏 =====
      '<div class="cx-footer">' +
        '<span id="__cxFooterStatus"><span class="cx-footer-dot"></span><span id="__cxFooterText">初始化…</span></span>' +
        '<span id="__cxFooterVer">v' + ((typeof SCRIPT_VERSION !== 'undefined') ? SCRIPT_VERSION : '?') + '</span>' +
      '</div>'
    );
  }
