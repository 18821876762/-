// @requires: CONFIG, CX_KEYS, DEFAULT_CONFIG, EventBus, bestEffort, escapeHTML, quizCredentialStore, reconcileIntrusionMode, safeGet, savePanelCfg, swallow
// @source-group: presentation/panel-controls.js
// @continuation-of: presentation/panel-controls.js
// Submission, data, blackbox, and configuration events inside bindPanelControlEvents.
    // 作答后自动提交开关（默认开；关闭→作答但不提交，挂起待用户确认）
    // 注意：不能复用 quizAuto 变量名——L45 已声明 quizAuto=#__cxQuizAuto，var 函数作用域会导致本变量覆盖前者，
    // 进而使 L87 通用答题 change 监听回调读错的 checked。此处单独命名 quizAutoSubmit 避免变量遮蔽。
    var quizAutoSubmit = el.querySelector('#__cxQuizAutoSubmit');
    if (quizAutoSubmit) {
      quizAutoSubmit.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO_SUBMIT) : null; return v === null ? true : v !== '0'; }, true);
      quizAutoSubmit.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_AUTO_SUBMIT, quizAutoSubmit.checked ? '1' : '0'); }, 'ls.quiz_autosubmit');
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_AUTO_SUBMIT = quizAutoSubmit.checked;
        bestEffort(function(){ EventBus.emit('ui:toast', '作答后自动提交 → ' + (quizAutoSubmit.checked ? '开' : '关（待「确认提交」）')); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // 填空题自动作答开关（默认关；开启→题库/AI 命中的填空题自动回填，但不自动提交，挂二次确认；与「自动提交」默认开相反）
    var quizFill = el.querySelector('#__cxQuizFillEnabled');
    if (quizFill) {
      quizFill.checked = safeGet(function () { var v = (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_FILL_ENABLED) : null; return v === '1'; }, false);   // 默认关
      quizFill.addEventListener('change', function () {
        bestEffort(function () { if (typeof localStorage !== 'undefined') localStorage.setItem(CX_KEYS.QUIZ_FILL_ENABLED, quizFill.checked ? '1' : '0'); }, 'ls.quiz_fill');
        if (typeof CONFIG !== 'undefined') CONFIG.QUIZ_FILL_ENABLED = quizFill.checked;
        bestEffort(function(){ EventBus.emit('ui:toast', quizFill.checked ? '填空题自动作答已开启（仅题库/AI 命中，不自动提交）' : '填空题自动作答已关闭（填空题留待人工）'); }, 'emit.toast');
        EventBus.emit('panel:refresh');
      });
    }
    // v4.19.29/30 答题数据治理：UI 接入（此前仅 CLI /evict 可用，面板无入口 → 功能存在但 UI 滞后）
    var cev = el.querySelector('#__cxQuizCacheEvictVideo');
    if (cev) {
      cev.checked = !!safeGet(function () { return CONFIG.QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE; }, true);
      cev.addEventListener('change', function () {
        CONFIG.QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE = !!cev.checked;
        savePanelCfg();
        EventBus.emit('ui:toast', '切换视频出清答题缓存 → ' + (cev.checked ? '开' : '关'));
        EventBus.emit('panel:refresh');
      });
    }
    var ceu = el.querySelector('#__cxQuizCacheEvictUrl');
    if (ceu) {
      ceu.checked = !!safeGet(function () { return CONFIG.QUIZ_CACHE_EVICT_ON_URL_CHANGE; }, true);
      ceu.addEventListener('change', function () {
        CONFIG.QUIZ_CACHE_EVICT_ON_URL_CHANGE = !!ceu.checked;
        savePanelCfg();
        EventBus.emit('ui:toast', '切换课程/章节出清答题缓存 → ' + (ceu.checked ? '开' : '关'));
        EventBus.emit('panel:refresh');
      });
    }
    var cei = el.querySelector('#__cxQuizCacheEvictIdle');
    if (cei) {
      cei.value = '' + (CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN || 0);
      var ceiv = el.querySelector('#__cxQuizCacheEvictIdleVal');
      if (ceiv) ceiv.textContent = '' + (CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN || 0);
      cei.addEventListener('input', function () {
        CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN = parseInt(cei.value, 10) || 0;
        if (ceiv) ceiv.textContent = '' + CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN;
        savePanelCfg();
        EventBus.emit('panel:refresh');
      });
    }
    var dgp = el.querySelector('#__cxDataGovPeriod');
    if (dgp) {
      dgp.value = '' + (CONFIG.DATA_GOV_PERIOD_MIN || 0);
      var dgpv = el.querySelector('#__cxDataGovPeriodVal');
      if (dgpv) dgpv.textContent = '' + (CONFIG.DATA_GOV_PERIOD_MIN || 0);
      dgp.addEventListener('input', function () {
        CONFIG.DATA_GOV_PERIOD_MIN = parseInt(dgp.value, 10) || 0;
        if (dgpv) dgpv.textContent = '' + CONFIG.DATA_GOV_PERIOD_MIN;
        savePanelCfg();
        EventBus.emit('panel:refresh');
      });
    }
    // 确认提交待作答
    var submitAll = el.querySelector('#__cxBtnQuizSubmitAll');
    if (submitAll) submitAll.addEventListener('click', function () {
      bestEffort(function () {
        var n = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizSubmitPending === 'function') ? window.__CX_FORCE_PLAY.quizSubmitPending() : 0;
        if (!n) bestEffort(function(){ EventBus.emit('ui:toast', '没有待确认的作答'); }, 'emit.toast');
      }, 'ctrl.submitAll');
    });
    // 人工复核：采纳当前随机答案入本地题库（逐题调用 quizReviewAccept）
    var btnReviewAccept = el.querySelector('#__cxBtnQuizReviewAccept');
    if (btnReviewAccept) btnReviewAccept.addEventListener('click', function () {
      bestEffort(function () {
        var FP = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) ? window.__CX_FORCE_PLAY : null;
        if (!FP || typeof FP.quizReviewList !== 'function') return;
        var list = FP.quizReviewList();
        if (!list.length) { bestEffort(function(){ EventBus.emit('ui:toast', '没有待人工复核的题'); }, 'emit.toast'); return; }
        var ok = 0;
        for (var i = 0; i < list.length; i++) { if (FP.quizReviewAccept && FP.quizReviewAccept(list[i].fp)) ok++; }
        bestEffort(function(){ EventBus.emit('ui:toast', '已采纳 ' + ok + '/' + list.length + ' 题入本地题库'); }, 'emit.toast');
      }, 'ctrl.reviewAccept');
    });
    // 人工复核：导出待复核题为 JSON（供用户核对/外部维护题库）
    var btnReviewExport = el.querySelector('#__cxBtnQuizReviewExport');
    if (btnReviewExport) btnReviewExport.addEventListener('click', function () {
      bestEffort(function () {
        var FP = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) ? window.__CX_FORCE_PLAY : null;
        var txt = (FP && typeof FP.quizReviewExport === 'function') ? FP.quizReviewExport() : '[]';
        bestEffort(function () {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () {});
        }, 'clip');
        var _revCnt = safeGet(function () { return txt ? JSON.parse(txt).length : 0; }, 0);
        bestEffort(function(){ EventBus.emit('ui:toast', '已导出 ' + _revCnt + ' 条待复核（已尝试复制到剪贴板）'); }, 'emit.toast');
      }, 'ctrl.reviewExport');
    });
    // 黑匣子导出按钮
    var btnExport = el.querySelector('#__cxBtnExport');
    if (btnExport) btnExport.addEventListener('click', function () {
      bestEffort(function () {
        var lines = [];
        var now = Date.now();
        lines.push('=== 黑匣子日志 ===');
        lines.push('导出时间: ' + new Date().toLocaleString());
        lines.push('记录条数: ' + _bxBuffer.length + ' / ' + _bxCap + ' 条');
        lines.push('最近1分钟: ' + _bxBuffer.filter(function(e) { return (now - e.ts) <= 60000; }).length + ' 条');
        lines.push('');
        for (var i = 0; i < _bxBuffer.length; i++) {
          var item = _bxBuffer[i];
          var age = Math.round((now - item.ts) / 1000) + 's前';
          var time = new Date(item.ts).toLocaleTimeString();
          lines.push('[' + time + ' | -' + age + '] ' + item.action + (item.detail ? '  ' + item.detail : ''));
        }
        var text = lines.join('\n');
        try {  // Tier 3: clipboard + fallback（有意义的分支恢复逻辑）
          navigator.clipboard.writeText(text).then(function () {
            EventBus.emit('ui:toast', '已复制 ' + _bxBuffer.length + ' 条日志到剪贴板');
          }, function () { alert(text); });
        } catch (e2) {
          var w = window.open('', '_blank', 'width=700,height=500');
          if (w) { w.document.write('<pre>' + escapeHTML(text) + '</pre>'); }
          else alert(text);
        }
      }, 'ctrl.blackbox.export');
    }, false);
    // 清空黑匣子（Danger 级：破坏性操作，confirm 二次确认，设计 §6.1）
    var btnClearBx = el.querySelector('#__cxBtnClearBx');
    if (btnClearBx) btnClearBx.addEventListener('click', function () {
      bestEffort(function () {
        if (!confirm('确认清空黑匣子日志？（' + _bxBuffer.length + ' 条，清空后不可恢复）')) return;
        _bxBuffer.length = 0;
        EventBus.emit('ui:toast', '黑匣子日志已清空', 'warn');
      }, 'ctrl.bxClear');
    });
    // 配置管理：恢复默认 / 导出 / 导入
    var btnResetCfg = el.querySelector('#__cxBtnResetCfg');
    if (btnResetCfg) btnResetCfg.addEventListener('click', function () {
      bestEffort(function () {
        if (typeof DEFAULT_CONFIG === 'object' && DEFAULT_CONFIG) {
          for (var k in DEFAULT_CONFIG) { if (DEFAULT_CONFIG.hasOwnProperty(k)) CONFIG[k] = DEFAULT_CONFIG[k]; }
        }
        CONFIG.QUIZ_VISION_USE_API_KEY = false;
        try { localStorage.setItem(CX_KEYS.VISION_USE_API_KEY, '0'); } catch (e) {}
        quizCredentialStore.save('');
        savePanelCfg();
        if (typeof reconcileIntrusionMode === 'function') bestEffort(reconcileIntrusionMode, 'ctrl.resetCfg.reconcile');
        EventBus.emit('panel:refresh');
        EventBus.emit('ui:toast', '已恢复默认设置');
      }, 'ctrl.resetCfg');
    });
    var btnExportCfg = el.querySelector('#__cxBtnExportCfg');
    if (btnExportCfg) btnExportCfg.addEventListener('click', function () {
      bestEffort(function () {
        var exportOwner = window.__CX_FORCE_PLAY;
        var exportConfig = function () {
        if (window.__CX_FORCE_PLAY !== exportOwner) return;
        var cfg = {};
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (!key || key.indexOf('cx_') !== 0 || isCredentialConfigKey(key) || quizCredentialStore.contains(key)) continue;
            var value = localStorage.getItem(key);
            if (!hasCredentialConfigValue(value)) cfg[key] = value;
          }
        } catch (e) { swallow(e); }
        var json = JSON.stringify(cfg, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).catch(function () {});
        if (typeof console !== 'undefined') console.log('[网课强制续播] 配置导出:\n' + json);
        EventBus.emit('ui:toast', '配置已导出到控制台并复制（' + Object.keys(cfg).length + ' 项）');
        };
        if (quizCredentialStore.status().loaded) exportConfig();
        else quizCredentialStore.ready.then(exportConfig);
      }, 'ctrl.exportCfg');
    });
    var btnImportCfg = el.querySelector('#__cxBtnImportCfg');
    if (btnImportCfg) btnImportCfg.addEventListener('click', function () {
      bestEffort(function () {
        if (typeof window.prompt !== 'function') { EventBus.emit('ui:toast', '当前环境不支持导入', 'error'); return; }
        var raw = window.prompt('粘贴此前导出的配置 JSON（将以 cx_ 前缀覆盖写入）：', '');
        if (raw === null) return;
        var cfg; try { cfg = JSON.parse(raw); } catch (e) { EventBus.emit('ui:toast', 'JSON 解析失败', 'error'); return; }
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { EventBus.emit('ui:toast', '配置须为 JSON 对象', 'error'); return; }
        var importOwner = window.__CX_FORCE_PLAY;
        var importConfig = function () {
        if (window.__CX_FORCE_PLAY !== importOwner) return;
        if (Object.keys(cfg).some(function (name) { return isCredentialConfigKey(name) || quizCredentialStore.contains(name) || hasCredentialConfigValue(cfg[name]); })) {
          EventBus.emit('ui:toast', '导入被拒绝：配置不能包含凭据，请在专用输入框设置', 'error'); return;
        }
        var n = 0;
        for (var k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k) && k.indexOf('cx_') === 0) { try { localStorage.setItem(k, typeof cfg[k] === 'string' ? cfg[k] : JSON.stringify(cfg[k])); n++; } catch (e) {} } }
        if (typeof loadPanelCfg === 'function') loadPanelCfg();
        if (typeof reconcileIntrusionMode === 'function') bestEffort(reconcileIntrusionMode, 'ctrl.importCfg.reconcile');
        EventBus.emit('panel:refresh');
        EventBus.emit('ui:toast', '已导入 ' + n + ' 项配置');
        };
        if (quizCredentialStore.status().loaded) importConfig();
        else quizCredentialStore.ready.then(importConfig);
      }, 'ctrl.importCfg');
    });
  }
