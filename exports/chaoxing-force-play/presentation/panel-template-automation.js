// @requires: cxIcon
// @source-group: presentation/panel-template.js
// @continuation-of: presentation/panel-template.js
// Automation tab expression inside buildPanelHTML.
      // ----- Tab: 答题 (automation) -----
      '<div id="__cxTab_automation" class="cx-tab" style="display:none;">' +
        // 自动答题区
        '<div id="__cxZoneQuiz">' +
          '<div id="__cxQuizBlock">' +
            '<div class="cx-section-title">自动答题</div>' +
            '<div class="cx-setting-section">' +
              '<label class="cx-setting-row" style="border:none;padding:8px 0;">' +
                '<span class="cx-setting-label"><input id="__cxQuizAuto" type="checkbox" style="margin-right:8px;vertical-align:middle;">自动答题（通用引擎：超星/人卫/Unipus等）</span>' +
              '</label>' +
              '<div class="cx-setting-row" style="border:none;padding:2px 0 4px;">' +
                '<label style="display:flex;align-items:center;font-size:12px;flex:1;">' +
                  '<input id="__cxQuizAutoStart" type="checkbox" style="margin-right:6px;vertical-align:middle;">检测到题目后自动开始' +
                '</label>' +
              '</div>' +
              // v4.19.22 排版修复：两个 100% 宽按钮原为 flex 行的 flex 项互相挤压 → 独立按钮行并排（flex:1 + gap）
              '<div style="display:flex;gap:6px;margin:2px 0 6px;">' +
                '<button id="__cxQuizManualStart" class="cx-btn" style="flex:1;padding:0 4px;">▶ 开始答题</button>' +
                '<button id="__cxQuizManualSubmit" class="cx-btn" style="flex:1;padding:0 4px;">⏺ 提交</button>' +
              '</div>' +
              '<div id="__cxQuizLights" style="display:flex;align-items:center;gap:5px;margin:2px 0 8px;flex-wrap:wrap;min-height:16px;" title="答题信号灯：红=完全失败 · 绿=已完成 · 黄=作答中/待确认/待复核 · 紫=暂时受阻 · 蓝=特殊情况 · 橙=信息缺失 · 黑=未进行">' +
                '<span style="font-size:11px;color:var(--cx-text3);margin-right:2px;">信号灯</span>' +
              '</div>' +
              '<div class="cx-quiz-progress">' +
                '<div class="cx-quiz-progress-head">' +
                  '<span id="__cxQuizLed" class="cx-quiz-led idle" title="答题状态"></span>' +
                  '<span id="__cxQuizStatusText" class="cx-quiz-status">未开启自动答题</span>' +
                  '<span id="__cxQuizPct" class="cx-quiz-pct cx-mono">0%</span>' +
                '</div>' +
                '<div class="cx-quiz-progress-track"><div id="__cxQuizProgressBar" class="cx-quiz-progress-bar"></div></div>' +
                '<div id="__cxQuizNum" class="cx-quiz-progress-num">已作答 0 / 总数 0</div>' +
              '</div>' +
              '<div id="__cxQuizStatRow" class="cx-quiz-stat" style="padding:4px 0 8px;">' +
                '<div class="cx-quiz-stat-row"><span>题目总数</span><b id="__cxQuizTotal" class="cx-mono">—</b></div>' +
                '<div class="cx-quiz-stat-row"><span>已作答</span><b id="__cxQuizDone" class="cx-mono">—</b></div>' +
                '<div class="cx-quiz-stat-row"><span>待作答</span><b id="__cxQuizRemain" class="cx-mono">—</b></div>' +
                '<div class="cx-quiz-stat-row"><span>待确认提交</span><b id="__cxQuizPendingStat" class="cx-mono">0</b></div>' +
                '<div class="cx-quiz-stat-row"><span>答案来源</span><b id="__cxQuizSrc" class="cx-mono">—</b></div>' +
                '<div class="cx-quiz-stat-row"><span>平均置信度</span><b id="__cxQuizConf" class="cx-mono">—</b></div>' +
              '</div>' +
              '<div class="cx-setting-row" style="border:none;padding:4px 0;">' +
                '<span class="cx-setting-label">答案来源</span>' +
                '<select id="__cxQuizSource">' +
                  '<option value="random">随机（保不卡进度）</option>' +
                  '<option value="bank">题库（本地/远程题库）</option>' +
                  '<option value="ai">AI（视觉识别+DeepSeek）</option>' +
                '</select>' +
              '</div>' +
              '<div id="__cxQuizSrcHint" style="font-size:11px;color:var(--cx-text3);margin:4px 0 8px;line-height:1.5;">random 仅随机勾选；选 bank/ai 前请确认已配置题库或 DeepSeek 通道。</div>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '<span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizVisionCdn" type="checkbox" style="margin-right:6px;vertical-align:middle;">允许加载外部视觉脚本 (CDN)</span>' +
              '</label>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;flex-direction:column;align-items:stretch;">' +
                '<span class="cx-setting-label" style="font-size:12px;display:block;">html2canvas 自定义地址（可选）</span>' +
                '<input id="__cxQuizVisionH2c" type="text" placeholder="留空=多镜像 CDN；公共 CDN 全被拦截时填本地/自建地址" style="width:100%;box-sizing:border-box;margin-top:4px;font-size:11px;">' +
              '</label>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '<span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizDeepseek" type="checkbox" style="margin-right:6px;vertical-align:middle;">用 DeepSeek 网页版作答</span>' +
              '</label>' +
              '<div style="font-size:11px;color:var(--cx-text3);margin:2px 0 6px;line-height:1.5;">视觉识别需截图题目（html2canvas 同步渲染，大题目每张约 1~3s 阻塞主线程）。答题页卡顿时：<b>关闭本开关走题库/随机</b>，或设 localStorage <code>cx_quiz_vision_scale=1</code> 加速截图（默认 1.5）。</div>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '<span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizUseApiKey" type="checkbox" style="margin-right:6px;vertical-align:middle;">使用官方 API Key（备用作答通道）</span>' +
              '</label>' +
              '<div id="__cxQuizApiKeyWrap" style="display:none;margin:2px 0 8px;padding-left:22px;">' +
                '<span style="font-size:11px;color:var(--cx-text3);line-height:1.4;">确认 API 地址后输入 Key，保存时只授权该接口来源（协议、主机、端口）。更换来源需重新输入 Key；凭据不参与配置导出。</span>' +
                '<input id="__cxQuizApiEndpoint" type="url" autocomplete="off" aria-label="API 接口地址" placeholder="已登记的 HTTPS API 地址；本地回环可用 HTTP" style="width:100%;box-sizing:border-box;margin-top:5px;font-size:11px;">' +
                '<input id="__cxQuizApiKey" type="password" autocomplete="off" placeholder="输入新的 API Key（保存后清空）" style="width:100%;box-sizing:border-box;margin-top:5px;font-size:11px;">' +
                '<div id="__cxQuizApiKeyStatus" style="font-size:11px;color:var(--cx-text3);margin-top:4px;" role="status"></div>' +
                '<button id="__cxQuizClearApiKey" type="button" class="cx-btn" style="margin-top:4px;">清除 API Key</button>' +
              '</div>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '<span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizOffline" type="checkbox" style="margin-right:6px;vertical-align:middle;">仅离线作答（题目不外发）</span>' +
              '</label>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '<span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizAutoSubmit" type="checkbox" style="margin-right:6px;vertical-align:middle;">作答后自动提交</span>' +
              '</label>' +
              '<label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '<span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizFillEnabled" type="checkbox" style="margin-right:6px;vertical-align:middle;">填空题自动作答（仅题库/AI 命中·不自动提交）</span>' +
              '</label>' +
              '<button id="__cxBtnQuizSubmitAll" style="display:none;width:100%;padding:9px;margin-top:6px;" class="cx-btn cx-btn-primary">确认提交待作答 (<b id="__cxQuizPending">0</b>)</button>' +
              '<div id="__cxQuizReviewWrap" style="display:none;border-top:1px solid var(--cx-border);margin-top:8px;padding-top:8px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--cx-warning);margin-bottom:6px;"><span>' + cxIcon('warn', 14) + ' 待人工复核</span><b id="__cxQuizReviewCount" class="cx-mono">0</b></div>' +
                '<div style="font-size:11px;color:var(--cx-text3);margin-bottom:8px;line-height:1.5;">低置信题已随机勾选保进度；核对后将正确答案入本地题库。</div>' +
                '<div style="display:flex;gap:6px;">' +
                  '<button id="__cxBtnQuizReviewAccept" style="flex:1;padding:8px;" class="cx-btn cx-btn-primary">采纳答案入题库</button>' +
                  '<button id="__cxBtnQuizReviewExport" style="flex:1;padding:8px;" class="cx-btn cx-btn-secondary">导出待复核</button>' +
                '</div>' +
              '</div>' +
              '<div class="cx-setting-block" style="border-top:1px solid var(--cx-border);margin-top:10px;padding-top:8px;">' +
                '  <div class="cx-section-title" style="font-size:13px;font-weight:600;margin:0 0 6px;">答题数据治理</div>' +
                '  <label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '    <span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizCacheEvictVideo" type="checkbox" style="margin-right:6px;vertical-align:middle;">切换视频时出清答题缓存</span>' +
                '  </label>' +
                '  <label class="cx-setting-row" style="border:none;padding:6px 0;">' +
                '    <span class="cx-setting-label" style="font-size:12px;"><input id="__cxQuizCacheEvictUrl" type="checkbox" style="margin-right:6px;vertical-align:middle;">切换课程/章节时出清答题缓存</span>' +
                '  </label>' +
                '  <label class="cx-setting-row" style="border:none;padding:6px 0;display:flex;align-items:center;gap:8px;">' +
                '    <span class="cx-setting-label" style="font-size:12px;flex:1;">答题空闲 <span id="__cxQuizCacheEvictIdleVal" class="cx-mono">0</span> 分钟出清</span>' +
                '    <input id="__cxQuizCacheEvictIdle" type="range" min="0" max="60" step="1" value="0" style="width:120px;">' +
                '  </label>' +
                '  <label class="cx-setting-row" style="border:none;padding:6px 0;display:flex;align-items:center;gap:8px;">' +
                '    <span class="cx-setting-label" style="font-size:12px;flex:1;">数据治理周期 <span id="__cxDataGovPeriodVal" class="cx-mono">0</span> 分钟</span>' +
                '    <input id="__cxDataGovPeriod" type="range" min="0" max="60" step="1" value="0" style="width:120px;">' +
                '  </label>' +
                '  <div style="font-size:11px;color:var(--cx-text3);line-height:1.5;margin-top:2px;">出清=清空已作答去重/在途题解/失败登记等；周期巡检清理本地统计防 localStorage 膨胀。0=禁用（仅事件触发）。</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="__cxPopupBlock" style="display:none;">' +
            '<div class="cx-setting-section">' +
              '<label class="cx-setting-row" style="border:none;padding:8px 0;">' +
                '<span class="cx-setting-label"><input id="__cxPopupAuto" type="checkbox" style="margin-right:8px;vertical-align:middle;">弹窗自动作答（随堂题）</span>' +
              '</label>' +
              '<label class="cx-setting-row" style="border:none;padding:8px 0;">' +
                '<span class="cx-setting-label"><input id="__cxPopupSilentClose" type="checkbox" style="margin-right:8px;vertical-align:middle;">彻底取消弹窗（静默关闭）</span>' +
              '</label>' +
              '<div class="cx-quiz-stat" style="padding:4px 0 8px;">' +
                '<div class="cx-quiz-stat-row"><span>已处理弹窗</span><b id="__cxPopupCount" class="cx-mono">0</b></div>' +
              '</div>' +
              '<div style="font-size:11px;color:var(--cx-text3);line-height:1.5;">「彻底取消弹窗」开启后，每轮静默关闭随堂题弹窗、不作答。</div>' +
            '</div>' +
          '</div>' +
          '<div id="__cxZhExamHint" style="display:none;margin-top:8px;">' +
            '<div class="cx-tip info" style="margin-top:0;">' +
              '<span>' + cxIcon('info', 14) + '</span><span style="flex:1;">作业/考试作答：专属助手面板，与本区互不冲突。</span>' +
            '</div>' +
            '<button id="__cxBtnZhExam" style="width:100%;margin-top:8px;padding:9px;" class="cx-btn cx-btn-secondary">打开作业/考试助手</button>' +
          '</div>' +
        '</div>' +
        // 工具库
        '<div class="cx-section-title">工具库</div>' +
        '<div id="__cxAddons"></div>' +
      '</div>' +
