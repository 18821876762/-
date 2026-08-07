  // ===== DOMAIN: presentation/panel-ds-console (DeepSeek 应答端控制台事件绑定 + 状态刷新) =====
  // 仅在 detectSite()==='deepseek' 时由 ensurePanel 调用。课程页是主控面板，DeepSeek 页是应答端控制台。
  // 从 presentation/panel-core.js 抽出（行数红线合规），与 ensurePanel 同处一个 IIFE 闭包，函数声明 hoist，运行时调用安全。

  function bindDSConsole(el) {
    if (!el) return;
    try {
      var nh = el.querySelector('#__cxNinjaHandle');
      if (nh) nh.addEventListener('click', function () { try { hidePanel(); } catch (e) { swallow(e); } });
      // 应答端总开关：持久化到 localStorage，写入 window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED 供 responder 闸门读取
      var flagKey = 'cx_ds_responder_enabled';
      var enabled = true;
      try { enabled = window.localStorage.getItem(flagKey) !== '0'; } catch (e) {}
      if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED = enabled;
      var en = el.querySelector('#__cxDsEnable');
      if (en) {
        en.checked = enabled;
        en.addEventListener('change', function () {
          var on = !!en.checked;
          if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED = on;
          try { window.localStorage.setItem(flagKey, on ? '1' : '0'); } catch (e) {}
          try { Store.emit('ui:toast', on ? '本页已作为应答端启用' : '本页已停止应答（课程页将随机兜底）'); } catch (e) { swallow(e); }
          _dsUpdateConsole(el);
        });
      }
      // 注：#__cxNinja / #__cxDebug / #__cxBtnCopy 已由通用绑定区(ensurePanel 主体)统一绑定，此处不再重复，避免双监听
      // 联动状态实时刷新（每 2s）
      _dsUpdateConsole(el);
      if (!window.__cxDsTicker) {
        window.__cxDsTicker = setInterval(function () { try { _dsUpdateConsole(el); } catch (e) { swallow(e); } }, 2000);
      }
    } catch (e) { swallow(e); }
  }
  function _dsUpdateConsole(el) {
    if (!el) return;
    try {
      var loginEl = el.querySelector('#__cxDsLogin');
      if (loginEl) {
        var ok = false, unknown = false;
        try { var r = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._dsIsLoggedIn && window.__CX_FORCE_PLAY._dsIsLoggedIn(); if (r === true) ok = true; else if (r === false) ok = false; else unknown = true; } catch (e) { unknown = true; }
        // 审查整改 #2：登录态改用 DOM 构建（span+style），不再走 innerHTML 拼接
        var loginColor = ok ? '#10b981' : (unknown ? '#f59e0b' : '#ef4444');
        var loginText = ok ? '● 已登录（可用）' : (unknown ? '● 登录态未知（页面元素未识别）' : '● 未登录（不可用，请先登录 DeepSeek）');
        while (loginEl.firstChild) loginEl.removeChild(loginEl.firstChild);
        loginEl.appendChild(h('span', { style: 'color:' + loginColor + ';' }, loginText));
      }
      var chanEl = el.querySelector('#__cxDsChannel');
      if (chanEl) {
        var enabled = !(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED === false);
        chanEl.textContent = '通道：BroadcastChannel 主动广播中' + (enabled ? '' : '（应答已暂停）');
      }
      var respEl = el.querySelector('#__cxDsResponder');
      if (respEl) respEl.textContent = '应答端：待校准（网页版 DOM 选择器需在真实站点校准后自动作答生效）';
      var lastEl = el.querySelector('#__cxDsLast');
      if (lastEl) {
        var last = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DS_LAST_ASK) || 0;
        var ans = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DS_LAST_ANSWER) || '';
        if (last) {
          var ago = Math.round((Date.now() - last) / 1000);
          lastEl.textContent = '最近请求：' + ago + 's前' + (ans ? (' · 最近应答：' + (ans.length > 36 ? ans.slice(0, 36) + '…' : ans)) : ' · 暂无应答回传');
        } else {
          lastEl.textContent = '最近请求：无';
        }
      }
    } catch (e) { swallow(e); }
  }
