  // ===== DOMAIN: presentation/panel-controls (control + 礼貌/温和模式 + 黑匣子 事件绑定) =====
  // 从 ensurePanel 抽出的「控制区」事件绑定：入侵模式/礼貌模式开关、黑匣子导出/清空。
  // 抽到独立域模块以合规单文件行数红线（ARCHITECTURE_GOVERNANCE §2/§5）；
  // 仍在同一 IIFE 闭包内，引用 detectSite / reconcileIntrusionMode / _bxBuffer 等均为闭包内符号。
  function bindPanelControlEvents(el) {
    if (!el) return;
    // #1 温和/礼貌模式：入侵模式选择（原型中性化策略）
    var intr = el.querySelector('#__cxIntrusion');
    if (intr) {
      try { intr.value = CONFIG.INTRUSION_MODE || 'auto'; } catch (e) { swallow(e); }
      intr.addEventListener('change', function () {
        // #2 开放问题落地：超星站点误选 gentle 会静默漏拦却无提示，此处弹确认 + 风险提示
        if (intr.value === 'gentle') {
          try {
            if (typeof detectSite === 'function' && detectSite() === 'chaoxing' && typeof window.confirm === 'function') {
              var ok = window.confirm('当前为超星学习通站点，温和模式依赖页面原生暂停按钮，可能偶发漏拦（视频未自动续播）。\n\n确定要切换到「温和」吗？取消将保持当前模式。');
              if (!ok) {
                try { intr.value = CONFIG.INTRUSION_MODE || 'auto'; } catch (e2) { swallow(e2); }
                try { Store.emit('ui:toast', '已取消切换，保持「' + (CONFIG.INTRUSION_MODE || 'auto') + '」', 'warn'); } catch (e2) { swallow(e2); }
                Store.emit('panel:refresh');
                return;
              }
            }
          } catch (e) { swallow(e); }
        }
        CONFIG.INTRUSION_MODE = intr.value;
        savePanelCfg();
        try { if (typeof reconcileIntrusionMode === 'function') reconcileIntrusionMode(); } catch (e) { swallow(e); }
        try { Store.emit('ui:toast', '入侵模式 → ' + intr.value + (intr.value === 'gentle' ? '（超星可能偶发漏拦）' : '')); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');
      });
    }
    // #1 礼貌模式开关（抗检测：pause.toString 伪装）
    var polite = el.querySelector('#__cxPolite');
    if (polite) {
      try { polite.checked = !!CONFIG.POLITE_MODE; } catch (e) { swallow(e); }
      polite.addEventListener('change', function () {
        CONFIG.POLITE_MODE = !!polite.checked;
        savePanelCfg();
        try { Store.emit('ui:toast', CONFIG.POLITE_MODE ? '礼貌模式已开（抗检测）' : '礼貌模式已关'); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');
      });
    }
    // 通用真答题引擎开关（与「续播」并列，重要性对等；中途关闭：写 localStorage.cx_quiz_auto，与 quiz.js 闸门同向）
    var quizAuto = el.querySelector('#__cxQuizAuto');
    if (quizAuto) {
      try {
        var _qa = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_auto') : null;
        quizAuto.checked = (_qa !== '0');   // 默认开
      } catch (e) { quizAuto.checked = true; }
      // 「做题」区按站点能力拆两块显隐：quiz 引擎站点显示 __cxQuizBlock；弹窗作答站点显示 __cxPopupBlock；
      // 两者都没有（unknown 等）才隐藏整块，避免"点了没反应"误导
      try {
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
                try {
                  var FP = window.__CX_FORCE_PLAY;
                  if (FP && typeof FP.zhihuishuFabTick === 'function') {
                    FP.zhihuishuFabTick(0);   // 确保 FAB 存在并刷新；handledCount=0 不污染"本次自动作答"计数（幂等）
                    var pop = (typeof document !== 'undefined') ? document.getElementById('__cxZhsPop') : null;
                    if (!pop && window.top && window.top.document) pop = window.top.document.getElementById('__cxZhsPop');
                    if (pop) pop.classList.add('cx-show');   // 直接展开助手浮层（加 class 幂等）
                    Store.emit('ui:toast', '已打开作业/考试助手');
                  } else Store.emit('ui:toast', '作业/考试助手引擎未就绪，请稍候重试');
                } catch (e) { swallow(e); }
              });
            }
          } else {
            _zhBtn.style.display = 'none';
          }
        }
      } catch (e) {}
      quizAuto.addEventListener('change', function () {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_quiz_auto', quizAuto.checked ? '1' : '0'); } catch (e) { swallow(e); }
        try { Store.emit('ui:toast', quizAuto.checked ? '通用自动答题已开启' : '通用自动答题已关闭（当前页正在作答会停在本页）'); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');   // 联动刷新「做题」区进度显示
      });
    }
    // 弹窗自动作答开关（上课随堂题：icourse163/xuetangx/icve/智慧树上课）—— 与「做题」区弹窗子块联动
    var popupAuto = el.querySelector('#__cxPopupAuto');
    if (popupAuto) {
      try {
        var _pa = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_popup_quiz') : null;
        popupAuto.checked = (_pa !== '0');   // 默认开
      } catch (e) { popupAuto.checked = true; }
      popupAuto.addEventListener('change', function () {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_popup_quiz', popupAuto.checked ? '1' : '0'); } catch (e) { swallow(e); }
        try { Store.emit('ui:toast', popupAuto.checked ? '弹窗自动作答已开启' : '弹窗自动作答已关闭（随堂题需手动关闭）'); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');
      });
    }
    // 答案来源选择（random/bank/ai）：持久化到 localStorage.cx_quiz_source，quiz 引擎读取
    var quizSrc = el.querySelector('#__cxQuizSource');
    if (quizSrc) {
      try {
        var _qs = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_source') : null;
        quizSrc.value = (_qs === 'bank' || _qs === 'ai') ? _qs : 'random';
      } catch (e) { quizSrc.value = 'random'; }
      quizSrc.addEventListener('change', function () {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_quiz_source', quizSrc.value); } catch (e) { swallow(e); }
        var _label = { random: '随机（保不卡进度）', bank: '题库', ai: 'AI 视觉识别' }[quizSrc.value] || quizSrc.value;
        try { Store.emit('ui:toast', '自动答题答案来源 → ' + _label); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');
      });
    }
    // 仅离线作答开关（隐私合规：默认仅离线，题目/选项不外发）
    var quizOffline = el.querySelector('#__cxQuizOffline');
    if (quizOffline) {
      try { var _ov = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_offline') : null; quizOffline.checked = (_ov === null ? true : _ov !== '0'); } catch (e) { quizOffline.checked = true; }
      quizOffline.addEventListener('change', function () {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_quiz_offline', quizOffline.checked ? '1' : '0'); } catch (e) { swallow(e); }
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_OFFLINE_ONLY = quizOffline.checked;
        try { Store.emit('ui:toast', '仅离线作答 → ' + (quizOffline.checked ? '开（题目不外发）' : '关（允许外发需白名单授权）')); } catch (e) {}
        Store.emit('panel:refresh');
      });
    }
    // 外部 CDN 视觉脚本隐私授权（默认关；勾选=允许连外网加载 html2canvas/Tesseract，拒绝静默外连）
    var quizCdn = el.querySelector('#__cxQuizVisionCdn');
    if (quizCdn) {
      try { var _cv = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_cdn') : null; quizCdn.checked = (_cv === '1'); } catch (e) { quizCdn.checked = false; }
      // 以持久化值覆盖运行期默认（默认 false）
      if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_PRIVACY_OK = quizCdn.checked;
      quizCdn.addEventListener('change', function () {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_quiz_cdn', quizCdn.checked ? '1' : '0'); } catch (e) { swallow(e); }
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_VISION_PRIVACY_OK = quizCdn.checked;
        try { Store.emit('ui:toast', '外部视觉脚本授权 → ' + (quizCdn.checked ? '开（将连外网加载 CDN 资源）' : '关（拒绝外连）')); } catch (e) {}
        Store.emit('panel:refresh');
      });
    }
    // 用 DeepSeek 网页版作答（一键开启「视觉识别→DeepSeek 应答端」路径）：持久化 QUIZ_VISION_* 三项，刷新保持
    var quizDs = el.querySelector('#__cxQuizDeepseek');
    if (quizDs) {
      try {
        var _de = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_vision_ocr') : null;
        var _ve = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_vision_enabled') : null;
        var _pr = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_vision_privacy') : null;
        quizDs.checked = (_de === 'deepseek-web' && _ve === '1' && _pr === '1');
      } catch (e) { quizDs.checked = false; }
      quizDs.addEventListener('change', function () {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('cx_quiz_vision_enabled', quizDs.checked ? '1' : '0');
            localStorage.setItem('cx_quiz_vision_ocr', quizDs.checked ? 'deepseek-web' : 'endpoint');
            localStorage.setItem('cx_quiz_vision_privacy', quizDs.checked ? '1' : '0');
          }
          if (typeof CONFIG !== 'undefined') {
            CONFIG.QUIZ_VISION_ENABLED = quizDs.checked;
            CONFIG.QUIZ_VISION_OCR = quizDs.checked ? 'deepseek-web' : 'endpoint';
            CONFIG.QUIZ_VISION_PRIVACY_OK = quizDs.checked;
          }
          // 同步勾选「允许加载外部视觉脚本」（DeepSeek 路径需 html2canvas 截图）
          var _cdn = el.querySelector('#__cxQuizVisionCdn');
          if (_cdn) { _cdn.checked = quizDs.checked; try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_quiz_cdn', quizDs.checked ? '1' : '0'); } catch (e) { swallow(e); } }
          try { Store.emit('ui:toast', quizDs.checked ? '已开启：用 DeepSeek 网页版作答（视觉识别→应答端）' : '已关闭：DeepSeek 作答'); } catch (e) {}
          Store.emit('panel:refresh');
        } catch (e) { swallow(e); }
      });
    }
    // 作答后自动提交开关（默认开；关闭→作答但不提交，挂起待用户确认）
    // 注意：不能复用 quizAuto 变量名——L45 已声明 quizAuto=#__cxQuizAuto，var 函数作用域会导致本变量覆盖前者，
    // 进而使 L87 通用答题 change 监听回调读错的 checked。此处单独命名 quizAutoSubmit 避免变量遮蔽。
    var quizAutoSubmit = el.querySelector('#__cxQuizAutoSubmit');
    if (quizAutoSubmit) {
      try { var _av = (typeof localStorage !== 'undefined') ? localStorage.getItem('cx_quiz_autosubmit') : null; quizAutoSubmit.checked = (_av === null ? true : _av !== '0'); } catch (e) { quizAutoSubmit.checked = true; }
      quizAutoSubmit.addEventListener('change', function () {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('cx_quiz_autosubmit', quizAutoSubmit.checked ? '1' : '0'); } catch (e) { swallow(e); }
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_AUTO_SUBMIT = quizAutoSubmit.checked;
        try { Store.emit('ui:toast', '作答后自动提交 → ' + (quizAutoSubmit.checked ? '开' : '关（待「确认提交」）')); } catch (e) {}
        Store.emit('panel:refresh');
      });
    }
    // 确认提交待作答
    var submitAll = el.querySelector('#__cxBtnQuizSubmitAll');
    if (submitAll) submitAll.addEventListener('click', function () {
      try {
        var n = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizSubmitPending === 'function') ? window.__CX_FORCE_PLAY.quizSubmitPending() : 0;
        if (!n) try { Store.emit('ui:toast', '没有待确认的作答'); } catch (e) {}
      } catch (e) { swallow(e); }
    });
    // 人工复核：采纳当前随机答案入本地题库（逐题调用 quizReviewAccept）
    var btnReviewAccept = el.querySelector('#__cxBtnQuizReviewAccept');
    if (btnReviewAccept) btnReviewAccept.addEventListener('click', function () {
      try {
        var api = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) ? window.__CX_FORCE_PLAY : null;
        if (!api || typeof api.quizReviewList !== 'function') return;
        var list = api.quizReviewList();
        if (!list.length) { try { Store.emit('ui:toast', '没有待人工复核的题'); } catch (e2) {} return; }
        var ok = 0;
        for (var i = 0; i < list.length; i++) { if (api.quizReviewAccept && api.quizReviewAccept(list[i].fp)) ok++; }
        try { Store.emit('ui:toast', '已采纳 ' + ok + '/' + list.length + ' 题入本地题库'); } catch (e3) {}
      } catch (e) { swallow(e); }
    });
    // 人工复核：导出待复核题为 JSON（供用户核对/外部维护题库）
    var btnReviewExport = el.querySelector('#__cxBtnQuizReviewExport');
    if (btnReviewExport) btnReviewExport.addEventListener('click', function () {
      try {
        var api = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) ? window.__CX_FORCE_PLAY : null;
        var txt = (api && typeof api.quizReviewExport === 'function') ? api.quizReviewExport() : '[]';
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () {});
        } catch (e2) {}
        try { Store.emit('ui:toast', '已导出 ' + (txt ? JSON.parse(txt).length : 0) + ' 条待复核（已尝试复制到剪贴板）'); } catch (e3) {}
      } catch (e) { swallow(e); }
    });
    // 黑匣子导出按钮
    var btnExport = el.querySelector('#__cxBtnExport');
    if (btnExport) btnExport.addEventListener('click', function () {
      try {
        var lines = [];
        var now = Date.now();
        lines.push('=== 黑匣子日志 ===');
        lines.push('导出时间: ' + new Date().toLocaleString());
        lines.push('记录条数: ' + _bxBuffer.length + ' / ' + _bxCap + ' 条');
        lines.push('最近1分钟: ' + _bxBuffer.filter(function(e) { return (now - e.ts) <= 60000; }).length + ' 条');
        lines.push('');
        for (var i = 0; i < _bxBuffer.length; i++) {
          var e = _bxBuffer[i];
          var age = Math.round((now - e.ts) / 1000) + 's前';
          var time = new Date(e.ts).toLocaleTimeString();
          lines.push('[' + time + ' | -' + age + '] ' + e.action + (e.detail ? '  ' + e.detail : ''));
        }
        var text = lines.join('\n');
        try {
          navigator.clipboard.writeText(text).then(function () {
            Store.emit('ui:toast', '已复制 ' + _bxBuffer.length + ' 条日志到剪贴板');
          }, function () { alert(text); });
        } catch (e2) {
          // Fallback: 弹窗显示
          var w = window.open('', '_blank', 'width=700,height=500');
          if (w) { w.document.write('<pre>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>'); }
          else alert(text);
        }
      } catch (e) { swallow(e); }
    }, false);
    // 清空黑匣子（Danger 级：破坏性操作，confirm 二次确认，设计 §6.1）
    var btnClearBx = el.querySelector('#__cxBtnClearBx');
    if (btnClearBx) btnClearBx.addEventListener('click', function () {
      try {
        if (!confirm('确认清空黑匣子日志？（' + _bxBuffer.length + ' 条，清空后不可恢复）')) return;
        _bxBuffer.length = 0;
        Store.emit('ui:toast', '黑匣子日志已清空', 'warn');
      } catch (e) { swallow(e); }
    });
  }
