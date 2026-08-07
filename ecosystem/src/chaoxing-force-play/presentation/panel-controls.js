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
