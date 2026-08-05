  // ===== DOMAIN: ui/panel-controls (control + 礼貌/温和模式 + 黑匣子 事件绑定) =====
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
