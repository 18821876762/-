// @requires: CONFIG, CX_KEYS, EventBus, bestEffort, detectSite, quizCredentialStore, safeGet
// @source-group: presentation/panel-controls.js
// @continuation-of: presentation/panel-controls.js
// Quiz configuration events inside bindPanelControlEvents.
    // 通用真答题引擎开关（与「续播」并列，重要性对等；中途关闭：写 localStorage.cx_quiz_auto，与 quiz.js 闸门同向）
    var quizAuto = el.querySelector('#__cxQuizAuto');
    if (quizAuto) {
      quizAuto.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO) : null; return v !== '0'; }, true); // 默认开
      // 「做题」区按站点能力拆两块显隐：quiz 引擎站点显示 __cxQuizBlock；弹窗作答站点显示 __cxPopupBlock；
      // 两者都没有（unknown 等）才隐藏整块，避免"点了没反应"误导
      var _qsite = (typeof detectSite === 'function') ? detectSite() : '';
      var _quizSites = { chaoxing: 1, renwei: 1, unipus: 1, ucampus: 1, ilabx: 1 };
      var _popupSites = { zhihuishu: 1, icourse163: 1, xuetangx: 1, icve: 1 };
      var _qb = el.querySelector('#__cxQuizBlock'), _pb = el.querySelector('#__cxPopupBlock'), _zone = el.querySelector('#__cxZoneQuiz'), _zh = el.querySelector('#__cxZhExamHint');
      if (_qb && !_quizSites[_qsite]) _qb.style.display = 'none';
      if (_pb && !_popupSites[_qsite]) _pb.style.display = 'none';
      if (_zh) _zh.style.display = (_qsite === 'zhihuishu') ? 'block' : 'none';   // Rec B：智慧树显示作业/考试助手引导
      if (_zone && (!_qb || _qb.style.display === 'none') && (!_pb || _pb.style.display === 'none')) _zone.style.display = 'none';
      // Rec B 强化：智慧树站点在「做题」卡内直接提供「打开作业/考试助手」按钮，复用 FAB 引擎（主题隔离 + 现场模式）
      var _zhBtn = el.querySelector('#__cxBtnZhExam');
      if (_zhBtn) {
        if (_qsite === 'zhihuishu') {
          _zhBtn.style.display = '';
          if (!_zhBtn.__cxBound) {
            _zhBtn.__cxBound = true;
            _zhBtn.addEventListener('click', function () {
              bestEffort(function () {
                var FP = window.__CX_FORCE_PLAY;
                if (FP && typeof FP.zhihuishuFabTick === 'function') {
                  FP.zhihuishuFabTick(0);   // 确保 FAB 存在并刷新；handledCount=0 不污染计数
                  var pop = (typeof document !== 'undefined') ? document.getElementById('__cxZhsPop') : null;
                  if (!pop && window.top && window.top.document) pop = window.top.document.getElementById('__cxZhsPop');
                  if (pop) bestEffort(function(){ pop.classList.add('cx-show'); }, 'dom.class');   // 直接展开助手浮层
                  EventBus.emit('ui:toast', '已打开作业/考试助手');
                } else EventBus.emit('ui:toast', '作业/考试助手引擎未就绪，请稍候重试');
              }, 'ctrl.zhexam');
            });
          }
        } else {
          _zhBtn.style.display = 'none';
        }
      }
      quizAuto.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_AUTO, quizAuto.checked ? '1' : '0'); }, 'ls.quiz_auto');
        bestEffort(function () { if (window.__CX_FORCE_PLAY.quizSyncGate) window.__CX_FORCE_PLAY.quizSyncGate(); }, 'ctrl.quizAuto.gate');
        bestEffort(function(){ EventBus.emit('ui:toast', quizAuto.checked ? '通用自动答题已开启' : '通用自动答题已关闭（当前页正在作答会停在本页）'); }, 'emit.toast');
        EventBus.emit('panel:refresh');   // 联动刷新「做题」区进度显示
      });
    }
    // 需求·自动答题控制：自动启动开关（检测到题目后是否自动开始作答）+ 手动开始按钮
    var quizAutoStart = el.querySelector('#__cxQuizAutoStart');
    if (quizAutoStart) {
      quizAutoStart.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO_START) : null; return v !== '0'; }, true);   // 默认开（保持原行为）
      quizAutoStart.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_AUTO_START, quizAutoStart.checked ? '1' : '0'); }, 'ls.quiz_auto_start');
        bestEffort(function () { if (window.__CX_FORCE_PLAY.quizSyncGate) window.__CX_FORCE_PLAY.quizSyncGate(); }, 'ctrl.quizAutoStart.gate');
        // 开启自动启动：立即对已检测到的题目强制作答一次（无需等下一轮扫描）
        if (quizAutoStart.checked && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizManualStart === 'function') {
          bestEffort(function () { window.__CX_FORCE_PLAY.quizManualStart(); }, 'ctrl.quizAutoStart.on');
        }
        // 开源版首次预热：用户首次在面板开启自动作答 → 视为确认环境，结束预热
        if (quizAutoStart.checked && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.warmup &&
            typeof window.__CX_FORCE_PLAY.warmup.acknowledge === 'function' &&
            window.__CX_FORCE_PLAY.warmup.active && window.__CX_FORCE_PLAY.warmup.active()) {
          bestEffort(function () { window.__CX_FORCE_PLAY.warmup.acknowledge(); }, 'ctrl.warmup.ack');
        }
        bestEffort(function () { EventBus.emit('ui:toast', quizAutoStart.checked ? '已开启：检测到题目将自动开始答题' : '已关闭：需点「手动开始答题」或重新开启后作答'); }, 'ctrl.quizAutoStart.toast');
        EventBus.emit('panel:refresh');
      });
    }
    var quizManualBtn = el.querySelector('#__cxQuizManualStart');
    if (quizManualBtn) {
      quizManualBtn.addEventListener('click', function () {
        if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizManualStart === 'function') {
          bestEffort(function () { window.__CX_FORCE_PLAY.quizManualStart(); }, 'ctrl.quizManualStart');
          bestEffort(function () { EventBus.emit('ui:toast', '已开始答题（未答题目将逐一作答）'); }, 'ctrl.quizManualStart.toast');
        } else {
          bestEffort(function () { EventBus.emit('ui:toast', '答题引擎未就绪，请稍候重试'); }, 'ctrl.quizManualStart.na');
        }
      });
    }
    // v4.19.22 需求·手动提交按钮（测试提交功能）：对当前页全部题目执行提交（含 iframe 内题目）
    var quizSubmitBtn = el.querySelector('#__cxQuizManualSubmit');
    if (quizSubmitBtn) {
      quizSubmitBtn.addEventListener('click', function () {
        if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizManualSubmit === 'function') {
          bestEffort(function () { window.__CX_FORCE_PLAY.quizManualSubmit(); }, 'ctrl.quizManualSubmit');
        } else {
          bestEffort(function () { EventBus.emit('ui:toast', '答题引擎未就绪，请稍候重试'); }, 'ctrl.quizManualSubmit.na');
        }
      });
    }
    // 弹窗自动作答开关（上课随堂题：icourse163/xuetangx/icve/智慧树上课）—— 与「做题」区弹窗子块联动
    var popupAuto = el.querySelector('#__cxPopupAuto');
    if (popupAuto) {
      popupAuto.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.POPUP_QUIZ) : null; return v !== '0'; }, true); // 默认开
      popupAuto.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.POPUP_QUIZ, popupAuto.checked ? '1' : '0'); }, 'ls.popup_quiz');
        bestEffort(function(){ EventBus.emit('ui:toast', popupAuto.checked ? '弹窗自动作答已开启' : '弹窗自动作答已关闭（随堂题需手动关闭）'); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // 彻底取消弹窗开关（cx_popup_block）：与弹窗自动作答并列，开启后每轮静默关闭随堂题弹窗、不作答
    var popupBlock = el.querySelector('#__cxPopupSilentClose');
    if (popupBlock) {
      popupBlock.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.POPUP_BLOCK) : null; return v === '1'; }, false); // 默认关
      popupBlock.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.POPUP_BLOCK, popupBlock.checked ? '1' : '0'); }, 'ls.popup_block');
        bestEffort(function(){ EventBus.emit('ui:toast', popupBlock.checked ? '已开启彻底取消弹窗（随堂题将静默关闭、不作答）' : '已关闭彻底取消弹窗'); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // 答案来源选择（random/bank/ai）：持久化到 localStorage.cx_quiz_source，quiz 引擎读取
    var quizSrc = el.querySelector('#__cxQuizSource');
    if (quizSrc) {
      quizSrc.value = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_SOURCE) : null; return (v === 'bank' || v === 'ai') ? v : 'random'; }, 'random');
      quizSrc.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_SOURCE, quizSrc.value); }, 'ls.quiz_source');
        var _label = { random: '随机（保不卡进度）', bank: '题库', ai: 'AI 接口(自建)' }[quizSrc.value] || quizSrc.value;
        bestEffort(function(){ EventBus.emit('ui:toast', '自动答题答案来源 → ' + _label); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // 仅离线作答开关（隐私合规：默认仅离线，题目/选项不外发）
    var quizOffline = el.querySelector('#__cxQuizOffline');
    if (quizOffline) {
      quizOffline.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_OFFLINE) : null; return v === null ? true : v !== '0'; }, true);
      quizOffline.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_OFFLINE, quizOffline.checked ? '1' : '0'); }, 'ls.quiz_offline');
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_OFFLINE_ONLY = quizOffline.checked;
        bestEffort(function(){ EventBus.emit('ui:toast', '仅离线作答 → ' + (quizOffline.checked ? '开（题目不外发）' : '关（允许外发需白名单授权）')); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // 外部 CDN 视觉脚本隐私授权（默认关；勾选=允许连外网加载 html2canvas/Tesseract，拒绝静默外连）
    var quizCdn = el.querySelector('#__cxQuizVisionCdn');
    if (quizCdn) {
      quizCdn.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_CDN) : null; return v === '1'; }, false);
      // 以持久化值覆盖运行期默认（默认 false）
      if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_PRIVACY_OK = quizCdn.checked;
      quizCdn.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_CDN, quizCdn.checked ? '1' : '0'); }, 'ls.quiz_cdn');
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_PRIVACY_OK = quizCdn.checked;
        bestEffort(function(){ EventBus.emit('ui:toast', '外部视觉脚本授权 → ' + (quizCdn.checked ? '开（将连外网加载 CDN 资源）' : '关（拒绝外连）')); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // html2canvas 自定义地址（自建/本地可访问）：当所有公共 CDN 均被浏览器按域名拦截时，填入可访问地址兜底。
    // 注：外部 http(s) 地址仍需「允许加载外部视觉脚本」授权（隐私拦截）才放行；本地/自建场景同理。
    var quizH2c = el.querySelector('#__cxQuizVisionH2c');
    if (quizH2c) {
      quizH2c.value = safeGet(function () { return (typeof localStorage !== 'undefined') ? (localStorage.getItem(CX_KEYS.VISION_H2C_URL) || '') : ''; }, '');
      if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_H2C_URL = quizH2c.value || '';
      quizH2c.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.VISION_H2C_URL, quizH2c.value.trim()); }, 'ls.quiz_h2c');
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_H2C_URL = quizH2c.value.trim();
        bestEffort(function () { EventBus.emit('ui:toast', quizH2c.value.trim() ? 'html2canvas 自定义地址已保存（下次截图生效）' : 'html2canvas 改用多镜像 CDN'); }, 'emit.toast');
      });
    }
    // 用 DeepSeek 网页版作答（一键开启「视觉识别→DeepSeek 应答端」路径）：持久化 QUIZ_VISION_* 三项，刷新保持
    var quizDs = el.querySelector('#__cxQuizDeepseek');
    if (quizDs) {
      quizDs.checked = safeGet(function () { var de = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.VISION_OCR) : null; var ve = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.VISION_ENABLED) : null; var pr = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.VISION_PRIVACY) : null; return de === 'deepseek-web' && ve === '1' && pr === '1'; }, false);
      quizDs.addEventListener('change', function () {
        bestEffort(function () {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(CX_KEYS.VISION_ENABLED, quizDs.checked ? '1' : '0');
            localStorage.setItem(CX_KEYS.VISION_OCR, quizDs.checked ? 'deepseek-web' : 'endpoint');
            localStorage.setItem(CX_KEYS.VISION_PRIVACY, quizDs.checked ? '1' : '0');
          }
          if (typeof CONFIG !== 'undefined') {
            CONFIG.QUIZ_VISION_ENABLED = quizDs.checked;
            CONFIG.QUIZ_VISION_OCR = quizDs.checked ? 'deepseek-web' : 'endpoint';
            CONFIG.QUIZ_VISION_PRIVACY_OK = quizDs.checked;
          }
          // 同步勾选「允许加载外部视觉脚本」（DeepSeek 路径需 html2canvas 截图）
          var _cdn = el.querySelector('#__cxQuizVisionCdn');
          if (_cdn) { _cdn.checked = quizDs.checked; bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_CDN, quizDs.checked ? '1' : '0'); }, 'ls.quiz_cdn_sync'); }
          bestEffort(function(){ EventBus.emit('ui:toast', quizDs.checked ? '已开启：用 DeepSeek 网页版作答（视觉识别→应答端）' : '已关闭：DeepSeek 作答'); }, 'emit.toast');
          EventBus.emit('panel:refresh');
        }, 'ctrl.quiz_deepseek');
      });
    }
    // 使用官方 API Key（备用作答通道）：开关 + Key 输入框（仅本机存储，作逆向/官方接口备用鉴权）
    var quizUseApiKey = el.querySelector('#__cxQuizUseApiKey');
    var quizApiKeyWrap = el.querySelector('#__cxQuizApiKeyWrap');
    var quizApiKey = el.querySelector('#__cxQuizApiKey');
    var quizApiEndpoint = el.querySelector('#__cxQuizApiEndpoint');
    if (quizUseApiKey && quizApiKeyWrap && quizApiKey) {
      var _apiKeyOn = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.VISION_USE_API_KEY) === '1' : false; }, false);
      quizUseApiKey.checked = _apiKeyOn;
      quizApiKeyWrap.style.display = _apiKeyOn ? 'block' : 'none';
      quizApiKey.value = '';
      if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_USE_API_KEY = _apiKeyOn;
      var keyStatus = el.querySelector('#__cxQuizApiKeyStatus');
      var refreshKeyStatus = function () {
        var state = quizCredentialStore.status();
        if (keyStatus) keyStatus.textContent = state.clearFailed ? '当前会话已清空；请在脚本管理器删除未能清理的旧凭据' : (!state.hasKey ? '尚未保存 API Key' : (state.authorized ? '已授权接口：' + state.origin : 'API Key 尚未授权接口；请确认地址并重新输入 Key') + (state.persistent ? '；已保存在脚本私有存储' : '；仅当前页面有效，刷新后需重新输入'));
      };
      if (quizApiEndpoint) {
        quizApiEndpoint.value = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENDPOINT) || '';
        quizApiEndpoint.addEventListener('change', function () {
          if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_ENDPOINT = quizApiEndpoint.value.trim();
          bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.VISION_ENDPOINT, quizApiEndpoint.value.trim()); }, 'ls.quiz_endpoint');
          refreshKeyStatus();
        });
      }
      quizCredentialStore.ready.then(refreshKeyStatus);
      quizUseApiKey.addEventListener('change', function () {
        quizApiKeyWrap.style.display = quizUseApiKey.checked ? 'block' : 'none';
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.VISION_USE_API_KEY, quizUseApiKey.checked ? '1' : '0'); }, 'ls.quiz_use_api_key');
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_USE_API_KEY = quizUseApiKey.checked;
        bestEffort(function(){ EventBus.emit('ui:toast', quizUseApiKey.checked ? '已启用官方 API Key 备用通道' : '已关闭官方 API Key（恢复网页版/逆向接口默认）'); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
      var saveCredential = function (value) {
        quizApiKey.value = '';
        var endpoint = quizApiEndpoint ? quizApiEndpoint.value.trim() : ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENDPOINT) || '');
        quizCredentialStore.save(value, endpoint).then(function (state) {
          refreshKeyStatus();
          EventBus.emit('ui:toast', state.clearFailed ? '当前会话已清空；私有存储清理失败，请手动删除旧凭据' : (!state.hasKey ? 'API Key 已清空' : (state.persistent ? 'API Key 已安全保存' : 'API Key 仅当前页面有效，刷新后需重新输入')));
        }).catch(function (error) {
          refreshKeyStatus();
          EventBus.emit('ui:toast', error.message, 'warn');
        });
      };
      quizApiKey.addEventListener('change', function () {
        saveCredential(quizApiKey.value.trim());
      });
      var clearCredential = el.querySelector('#__cxQuizClearApiKey');
      if (clearCredential) clearCredential.addEventListener('click', function () { saveCredential(''); });
    }
