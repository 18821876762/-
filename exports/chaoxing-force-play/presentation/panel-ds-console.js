// @requires: CX_KEYS, EventBus, bestEffort, cxIcon, escapeHTML, hidePanel, safeGet
  // ===== DOMAIN: presentation/panel-ds-console (DeepSeek 应答端控制台事件绑定 + 状态刷新) =====
  // 仅在 detectSite()==='deepseek' 时由 ensurePanel 调用。课程页是主控面板，DeepSeek 页是应答端控制台。
  // 从 presentation/panel-core.js 抽出（行数红线合规），与 ensurePanel 同处一个 IIFE 闭包，函数声明 hoist，运行时调用安全。
  var _dxDsCleanupDone = false;   // 防止多次注册 pagehide 监听
  var _dsTickerId = null;         // P1：DS 控制台 ticker 的 TimerRegistry 注册 id(owner 'ds-console')，替代原 window.__cxDsTicker 全局泄漏
  // 幂等性修复(审查 G3-ticker)：ticker 现查当前面板节点（面板可能挂在顶层文档；跨域回退本帧）
  function _dsFindPanelNode() {
    return safeGet(function () {
      var _pd = (window.top && window.top.document) ? window.top.document : document;
      return _pd.getElementById('__cxPanel') || document.getElementById('__cxPanel');
    }, null);
  }

  function bindDSConsole(el) {
    if (!el) return;
    bestEffort(function () {
      var nh = el.querySelector('#__cxNinjaHandle');
      if (nh) nh.addEventListener('click', function () { bestEffort(function () { hidePanel(); }, 'ds.ninja'); });
      // 应答端总开关：持久化到 localStorage，写入 window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED 供 responder 闸门读取
      var flagKey = CX_KEYS.DS_RESPONDER;
      var enabled = safeGet(function () { return window.localStorage.getItem(flagKey); }, null) !== '0';
      if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED = enabled;
      var en = el.querySelector('#__cxDsEnable');
      if (en) {
        en.checked = enabled;
        en.addEventListener('change', function () {
          var on = !!en.checked;
          if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED = on;
          bestEffort(function () { window.localStorage.setItem(flagKey, on ? '1' : '0'); }, 'ds.ls.set');
          bestEffort(function () { EventBus.emit('ui:toast', on ? '本页已作为应答端启用' : '本页已停止应答（课程页将随机兜底）'); }, 'ds.toast.switch');
          _dsUpdateConsole(el);
        });
      }
      _dsUpdateConsole(el);
      // P1：DS 控制台 ticker 经 TimerRegistry 登记(owner 'ds-console')，替代原 window.__cxDsTicker 全局泄漏点；
      // 卸载时由 TimerRegistry.clearAll() 统一兜底清理，不再依赖 pagehide 才清。
      if (!_dsTickerId) {
        _dsTickerId = window.__CX_FORCE_PLAY.TimerRegistry.setInterval(function () {
          // 幂等性修复(审查 G3-ticker)：回调内现查面板节点，不捕获首次 el——旧实现闭包捕获首个 el，
          // 面板重建（R11 自愈）后新面板不再 2s 自动刷新（ticker 对着脱离文档的旧节点空转，陈旧而非累积）。
          bestEffort(function () {
            var _cur = _dsFindPanelNode();
            if (_cur) _dsUpdateConsole(_cur);
          }, 'ds.ticker');
        }, 2000, 'ds-console');
      }
      // 清理：离开应答端页面时停止 ticker（兜底，主卸载路径由 TimerRegistry.clearAll() 处理）
      if (!_dxDsCleanupDone) {
        _dxDsCleanupDone = true;
        var _dsCleanup = function () { bestEffort(function () { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.clearAll === 'function') window.__CX_FORCE_PLAY.TimerRegistry.clearAll('ds-console'); }, 'ds.cleanup'); };
        bestEffort(function () { window.addEventListener('pagehide', _dsCleanup); }, 'ds.init.pagehide');
        bestEffort(function () { window.addEventListener('unload', _dsCleanup); }, 'ds.init.unload');
      }
    }, 'ds.bind');
  }
  function _dsUpdateConsole(el) {
    if (!el) return;
    bestEffort(function () {
      var CX = window.__CX_FORCE_PLAY || {};
      var enabled = !(CX.DS_RESPONDER_ENABLED === false);
      var li = safeGet(function () { return CX._dsIsLoggedIn ? CX._dsIsLoggedIn() : undefined; }, undefined);
      var st = safeGet(function () { return CX._dsResponderState ? CX._dsResponderState() : null; }, null);
      var busy = !!(st && st.busy), q = st ? (st.queue || 0) : 0;

      // 整体状态胶囊：一眼可读（运行中/处理中/待登录/已暂停），语义色走令牌随深色模式自适应
      var pillEl = el.querySelector('#__cxDsPill');
      if (pillEl) {
        var pillCls = 'cx-ds-pill', pillTxt = '—';
        if (!enabled) { pillCls += ' warn'; pillTxt = '已暂停'; }
        else if (li === false) { pillCls += ' warn'; pillTxt = '待登录'; }
        else if (busy) { pillTxt = '处理中'; }
        else { pillCls += ' ok'; pillTxt = '运行中'; }
        pillEl.className = pillCls;
        pillEl.textContent = pillTxt;
      }

      // 登录态（胶囊旁副文本）
      var loginEl = el.querySelector('#__cxDsLogin');
      if (loginEl) {
        var ok = (li === true), unknown = (li !== false && !ok);
        var loginColor = ok ? 'var(--cx-success)' : (unknown ? 'var(--cx-warning)' : 'var(--cx-danger)');
        var loginText = ok ? '已登录 · 可用' : (unknown ? '登录状态待识别' : '未登录 · 请先登录 DeepSeek');
        while (loginEl.firstChild) loginEl.removeChild(loginEl.firstChild);
        loginEl.innerHTML = '<span style="color:' + loginColor + '">' + cxIcon('dot', 8) + '</span> ' + escapeHTML(loginText);
      }

      // 应答状态行（busy/queue 来自 v4.19.36 状态机）
      var respEl = el.querySelector('#__cxDsResponder');
      if (respEl) {
        if (!enabled) {
          respEl.textContent = '已暂停 · 课程页将随机兜底';
        } else {
          var base = (li === false) ? '待登录 · 登录后自动应答' : '自动应答课程页题目';
          respEl.textContent = base + (busy ? (' · 处理中' + (q ? '（队列 ' + q + '）' : '')) : (q ? (' · 待处理 ' + q + ' 题') : ' · 空闲'));
        }
      }

      // 数据通道行：面向用户措辞（GM 存储中继/看门狗为实现细节，不再上 UI）
      var chanEl = el.querySelector('#__cxDsChannel');
      if (chanEl) {
        // 通道实现：Tampermonkey GM 存储中继（cx_ds_bridge_v1，跨站/跨标签），BroadcastChannel 仅同源回退；
        // 心跳 5s、无响应守护窗口 25s（v4.19.27 由 12s 放宽）。
        chanEl.textContent = '跨页面实时同步 · 5s 心跳 · 25s 超时守护' + (enabled ? '' : ' · 已暂停');
      }

      // 题目载荷行（v4.19.27 起：解码成功走纯文本，不附截图）
      var modeEl = el.querySelector('#__cxDsMode');
      if (modeEl) {
        if (!CX.DS_LAST_ASK) modeEl.textContent = '—（尚无请求）';
        else modeEl.textContent = (CX._dsLastAskHadImage === true) ? '截图 + 文本 · 视觉识别' : '纯文本 · 题干已解码';
      }

      // 最近交互（对话式呈现 + 置信徽标，置信抽取自 v4.19.32）
      var lastEl = el.querySelector('#__cxDsLast');
      if (lastEl) {
        var last = CX.DS_LAST_ASK || 0;
        var ans = CX.DS_LAST_ANSWER || '';
        if (!last) {
          lastEl.textContent = '尚无请求 · 等待课程页发题';
        } else {
          var ago = Math.round((Date.now() - last) / 1000);
          var html = escapeHTML(String(ago)) + 's 前收到题目';
          if (ans) {
            var ansShown = ans.length > 30 ? (ans.slice(0, 30) + '…') : ans;
            html += ' · 应答 <b>' + escapeHTML(ansShown) + '</b>';
            if (/^[A-D]|^正确$|^错误$|^[AB]$/i.test(ans)) {
              var cc = safeGet(function () { return CX._dsReadConfidence ? CX._dsReadConfidence(ans) : 'high'; }, 'high');
              var cCls = (cc === 'low') ? 'low' : (cc === 'mid' ? 'mid' : 'ok');
              var cTxt = (cc === 'low') ? '低' : (cc === 'mid' ? '中' : '高');
              html += '<span class="cx-ds-conf ' + cCls + '">置信 ' + cTxt + '</span>';
            }
          } else {
            html += ' · 等待应答回传';
          }
          lastEl.innerHTML = html;
        }
      }

      // 数据循环遥测：chips 轻量化（loop 统计自 v4.19.37：收/回/超时守护/去重/丢弃）
      var loopEl = el.querySelector('#__cxDsLoop');
      if (loopEl) {
        var s = safeGet(function () { return CX._dsLoopStats ? CX._dsLoopStats() : null; }, null);
        if (s) {
          loopEl.innerHTML =
            '<span class="cx-ds-chip">收到<b>' + Number(s.rspReceived || 0) + '</b></span>' +
            '<span class="cx-ds-chip ok">已回<b>' + Number(s.rspSent || 0) + '</b></span>' +
            '<span class="cx-ds-chip' + (s.rspWatchdog ? ' err' : '') + '">超时<b>' + Number(s.rspWatchdog || 0) + '</b></span>' +
            '<span class="cx-ds-chip">去重<b>' + Number(s.rspDedupe || 0) + '</b></span>' +
            '<span class="cx-ds-chip' + (s.rspQdrop ? ' err' : '') + '">丢弃<b>' + Number(s.rspQdrop || 0) + '</b></span>';
        } else {
          loopEl.innerHTML = '';
        }
      }

      // 异常条：仅出错时可见（:empty 自动隐藏；超时守护/去重/回传失败）
      var warnEl = el.querySelector('#__cxDsWarn');
      if (warnEl) {
        var s2 = safeGet(function () { return CX._dsLoopStats ? CX._dsLoopStats() : null; }, null);
        var le = s2 ? (s2.rspLastErr || s2.lastErr || '') : '';
        warnEl.innerHTML = le ? (cxIcon('warn', 14) + '<span>' + escapeHTML(le) + '</span>') : '';
      }
    }, 'ds.updateConsole');
  }
