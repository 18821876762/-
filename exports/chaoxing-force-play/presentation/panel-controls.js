// @requires: CONFIG, EventBus, bestEffort, detectSite, reconcileIntrusionMode, safeGet, savePanelCfg, topHref, urlParam
// @source-group: presentation/panel-controls.js
  // ===== DOMAIN: presentation/panel-controls (control + 礼貌/温和模式 + 黑匣子 事件绑定) =====
  // 从 ensurePanel 抽出的「控制区」事件绑定：入侵模式/礼貌模式开关、黑匣子导出/清空。
  // 抽到独立域模块以合规单文件行数红线（ARCHITECTURE_GOVERNANCE §2/§5）；
  // 仍在同一 IIFE 闭包内，引用 detectSite / reconcileIntrusionMode / _bxBuffer 等均为闭包内符号。
  function bindPanelControlEvents(el) {
    if (!el) return;
    // #1 温和/礼貌模式：入侵模式选择（原型中性化策略）
    var intr = el.querySelector('#__cxIntrusion');
    if (intr) {
      intr.value = CONFIG.INTRUSION_MODE || 'auto';  // Tier 0: input.value= 从不抛错
      intr.addEventListener('change', function () {
        // #2 开放问题落地：超星站点误选 gentle 会静默漏拦却无提示，此处弹确认 + 风险提示
        if (intr.value === 'gentle') {
          if (safeGet(function () { return (typeof detectSite === 'function' && detectSite() === 'chaoxing' && typeof window.confirm === 'function') ? window.confirm('当前为超星学习通站点，温和模式依赖页面原生暂停按钮，可能偶发漏拦（视频未自动续播）。\n\n确定要切换到「温和」吗？取消将保持当前模式。') : true; }, true)) {
            // confirm ok or not applicable → proceed with gentle
          } else {
            intr.value = CONFIG.INTRUSION_MODE || 'auto';  // Tier 0: input.value= 从不抛错
            bestEffort(function(){ EventBus.emit('ui:toast', '已取消切换，保持「' + (CONFIG.INTRUSION_MODE || 'auto') + '」', 'warn'); }, 'emit.toast');
            EventBus.emit('panel:refresh');
            return;
          }
        }
        CONFIG.INTRUSION_MODE = intr.value;
        savePanelCfg();
        if (typeof reconcileIntrusionMode === 'function') bestEffort(reconcileIntrusionMode, 'ctrl.reconcile');
        bestEffort(function(){ EventBus.emit('ui:toast', '入侵模式 → ' + intr.value + (intr.value === 'gentle' ? '（超星可能偶发漏拦）' : '')); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // #1 礼貌模式开关（抗检测：pause.toString 伪装）
    var polite = el.querySelector('#__cxPolite');
    if (polite) {
      polite.checked = !!CONFIG.POLITE_MODE;  // Tier 0: checkbox.checked= 从不抛错
      polite.addEventListener('change', function () {
        CONFIG.POLITE_MODE = !!polite.checked;
        savePanelCfg();
        bestEffort(function(){ EventBus.emit('ui:toast', CONFIG.POLITE_MODE ? '礼貌模式已开（抗检测）' : '礼貌模式已关'); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // 接管总开关 + 当前课程禁用（关闭续播 / 自动答题）
    var tkEn = el.querySelector('#__cxTakeoverEnabled');
    if (tkEn) {
      tkEn.checked = (CONFIG.ENABLED !== false);
      if (!tkEn.__cxBound) {
        tkEn.__cxBound = true;
        tkEn.addEventListener('change', function () {
          if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.setTakeoverEnabled === 'function') {
            window.__CX_FORCE_PLAY.setTakeoverEnabled(!!tkEn.checked);
          } else { CONFIG.ENABLED = !!tkEn.checked; if (typeof savePanelCfg === 'function') savePanelCfg(); }
          bestEffort(function(){ EventBus.emit('ui:toast', tkEn.checked ? '已启用接管（续播 / 自动答题）' : '已关闭全局接管（仅留面板/诊断）'); }, 'emit.toast');
          EventBus.emit('panel:refresh');
        });
      }
    }
    var tkCourse = el.querySelector('#__cxBtnCourseTakeover');
    if (tkCourse) {
      if (!tkCourse.__cxBound) {
        tkCourse.__cxBound = true;
        tkCourse.addEventListener('click', function () {
          if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.toggleCourseTakeover === 'function') {
            var added = window.__CX_FORCE_PLAY.toggleCourseTakeover();
            bestEffort(function(){ EventBus.emit('ui:toast', added ? '本门课程已停用续播（已加入黑名单）' : '本门课程已恢复续播'); }, 'emit.toast');
          }
          EventBus.emit('panel:refresh');
        });
      }
      // 每次刷新同步按钮文案与课程号
      var _cid = (typeof urlParam === 'function') ? urlParam(topHref(), ['courseId']) : '';
      var _cidSpan = el.querySelector('#__cxCourseId');
      if (_cidSpan) _cidSpan.textContent = _cid ? ('ID:' + _cid) : '非课程页';
      var _inList = !!(_cid && (CONFIG.DISABLED_COURSES || []).indexOf(_cid) !== -1);
      tkCourse.textContent = _cid ? (_inList ? '本门课：已停用' : '本门课：启用中') : '本门课：非课程页';
    }
    // 本门课：单视频（避免并发续播触发风控）
    var tkSV = el.querySelector('#__cxBtnCourseSingle');
    if (tkSV) {
      if (!tkSV.__cxBound) {
        tkSV.__cxBound = true;
        tkSV.addEventListener('click', function () {
          if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.toggleCourseSingleVideo === 'function') {
            var added = window.__CX_FORCE_PLAY.toggleCourseSingleVideo();
            bestEffort(function(){ EventBus.emit('ui:toast', added ? '本门课程已设为单视频（仅前台播放）' : '本门课程已恢复并发续播'); }, 'emit.toast');
          }
          EventBus.emit('panel:refresh');
        });
      }
      var _svCid = (typeof urlParam === 'function') ? urlParam(topHref(), ['courseId']) : '';
      var _svIn = !!(_svCid && (CONFIG.SINGLE_VIDEO_COURSES || []).indexOf(_svCid) !== -1);
      tkSV.textContent = _svCid ? (_svIn ? '本门课：单视频(开)' : '本门课：单视频(关)') : '本门课：非课程页';
    }
