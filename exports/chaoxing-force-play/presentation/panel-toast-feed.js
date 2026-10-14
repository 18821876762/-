// @requires: EventBus, STYLES, bestEffort, safeGet
  // ===== DOMAIN: presentation/panel-toast-feed (toast feed + tip-pin) =====
  // 提示流（洞察页）：把所有 EventBus.emit('ui:toast') 集中到「洞察」页回看，
  // 既保留悬浮 toast 的即时反馈，又解决其"一闪而过/难追溯/分散"的问题（用户诉求：提示集中到洞察页）。
  // 自 panel-core.js 拆分（治理·单文件红线 >350 合规）；与 ensurePanel 同打包作用域，函数/状态互相可达。

  var _toastFeedBuf = [];     // 面板未构建时缓冲，开面板再 flush
  var _toastFeedCap = 80;
  // v4.19.50 提示流跨会话持久化（localStorage 环形 cap 40）：用户反馈「诊断无法复制提示流中的信息」——
  // 旧实现 _toastFeedLog 纯内存，刷新/换标签即丢且跨标签不共享。现启动时从 localStorage 恢复、写入时
  // 150ms 节流落盘，刷新/其他标签页打开后诊断 [15] 仍能复制历史提示（本地纯摘要文案，无题干/回复明文）。
  var _TOAST_FEED_KEY = 'cx_toast_feed_v1';
  var _TOAST_FEED_PERSIST_CAP = 40;
  // 结构化环形缓冲（{m,l,ts}）：供诊断「提示流」分区导出最近 N 条。独立于 _toastFeedBuf（后者 flush 即清空）
  // 与 DOM 容器（依赖面板打开），保证「复制诊断」任何时刻都能拿到提示史。随帧生命周期 + 跨会话持久化。
  // 初始化即从 localStorage 恢复历史（_loadToastFeedPersist 为函数声明，hoist 可用）。
  var _toastFeedLog = _loadToastFeedPersist();
  function _loadToastFeedPersist() {
    var out = [];
    bestEffort(function () {
      if (typeof localStorage === 'undefined') return;
      var raw = localStorage.getItem(_TOAST_FEED_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // v4.19.50 顺序修复：写盘为「旧在前」（_toastFeedLog 旧→新，slice(0,cap)），读取必须保持同序——
          // 旧实现此处 sort(ts desc) 变成「最新在前」，与 toastFeedRecent 的 slice(-n).reverse()（假定旧在前）冲突，
          // 跨会话恢复后顺序反转且取到最旧 n 条（用户反馈「提示流还是没有同步」）。
          for (var i = 0; i < arr.length && out.length < _TOAST_FEED_PERSIST_CAP; i++) {
            if (arr[i] && arr[i].m != null) out.push({ m: String(arr[i].m), l: arr[i].l || 'info', ts: arr[i].ts || 0 });
          }
        }
      }
    }, 'feed.loadPersist');
    return out;
  }
  var _feedPersistTimer = null;
  function _schedulePersist() {
    bestEffort(function () {
      if (_feedPersistTimer) clearTimeout(_feedPersistTimer);
      _feedPersistTimer = setTimeout(function () {
        _feedPersistTimer = null;
        bestEffort(function () { _persistToastFeed(); }, 'feed.persistDeb');
      }, 150);
    }, 'feed.persistSchedule');
  }
  function _persistToastFeed() {
    if (typeof localStorage === 'undefined') return;
    try {
      var cap = _toastFeedLog.slice(0, _TOAST_FEED_PERSIST_CAP);
      localStorage.setItem(_TOAST_FEED_KEY, JSON.stringify(cap));
    } catch (e) { /* 配额/隐私模式：忽略，仅内存可用 */ }
  }
  function _clearToastFeedPersist() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(_TOAST_FEED_KEY); } catch (e) {}
  }
  var _feedSubscribed = false;
  function _toastFeedColor(level) {
    return safeGet(function () { return ({ success: STYLES.T.success, warn: STYLES.T.warning, error: STYLES.T.danger })[level] || STYLES.T.text2; }, '#aeb6c2');
  }
  function _findFeedBox() {
    return safeGet(function () {
      var b = (typeof document !== 'undefined') ? document.getElementById('__cxToastFeed') : null;
      if (!b && window.top && window.top.document) b = window.top.document.getElementById('__cxToastFeed');
      return b;
    }, null);
  }
  function _appendToastFeed(msg, level) {
    bestEffort(function () {
      var box = _findFeedBox(); if (!box) return;
      var _empty = box.querySelector && box.querySelector('#__cxToastFeedEmpty');
      if (_empty) { bestEffort(function () { box.removeChild(_empty); }, 'feed.removeEmpty'); }   // 首条提示到达→移除空态占位
      var doc = box.ownerDocument;
      var e = doc.createElement('div');
      e.style.cssText = 'padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05);color:' + _toastFeedColor(level) + ';';
      var ts = new Date();
      var hh = ('0' + ts.getHours()).slice(-2), mm = ('0' + ts.getMinutes()).slice(-2), ss = ('0' + ts.getSeconds()).slice(-2);
      var t = doc.createElement('span');
      t.textContent = '[' + hh + ':' + mm + ':' + ss + '] '; t.style.color = STYLES.T.text3; t.style.marginRight = '4px';
      e.appendChild(t);
      e.appendChild(doc.createTextNode(String(msg)));   // 走 textContent，杜绝 XSS 注入面
      box.insertBefore(e, box.firstChild);              // 最新在上
      while (box.childNodes.length > _toastFeedCap) box.removeChild(box.lastChild);
    }, 'feed.append');
  }
  function _updateTipPin(msg, level) {
    bestEffort(function () {
      var t = (typeof document !== 'undefined') ? document.getElementById('__cxTipPinText') : null;
      if (!t && window.top && window.top.document) t = window.top.document.getElementById('__cxTipPinText');
      if (!t) return;
      t.textContent = String(msg);   // textContent 写入，杜绝 XSS 注入
      t.style.color = _toastFeedColor(level);
    }, 'feed.tipPin');
  }
  function _onToastForFeed(msg, level) {
    bestEffort(function () {
      // 幂等性修复(审查 G1-feed)：容器在 → 本条已实时 append 到 DOM，flush 时跳过（标记 rendered），
      // 杜绝面板重建（R11 自愈/跨帧清理）时 _flushToastFeed 把已渲染过的提示全部重复回放。
      var _box = _findFeedBox();
      _toastFeedBuf.push({ m: String(msg), l: level || 'info', rendered: !!_box });
      if (_toastFeedBuf.length > _toastFeedCap) _toastFeedBuf.shift();
      _toastFeedLog.push({ m: String(msg), l: level || 'info', ts: Date.now() });
      if (_toastFeedLog.length > _toastFeedCap) _toastFeedLog.shift();
      _schedulePersist();   // v4.19.50：节流落盘，跨会话/跨标签可复制
      _appendToastFeed(msg, level);
      _updateTipPin(msg, level);   // Rec C：钉底最近提示实时刷新（跨 tab 可见）
    }, 'feed.onToast');
  }
  function _flushToastFeed() {
    bestEffort(function () {
      for (var i = 0; i < _toastFeedBuf.length; i++) {
        if (_toastFeedBuf[i].rendered) continue;   // 幂等性修复(审查 G1-feed)：已实时渲染过的不重复 append
        _appendToastFeed(_toastFeedBuf[i].m, _toastFeedBuf[i].l);
      }
      if (_toastFeedBuf.length) { var _last = _toastFeedBuf[_toastFeedBuf.length - 1]; _updateTipPin(_last.m, _last.l); }   // 开面板后把最后一条缓冲同步到钉底
      _toastFeedBuf.length = 0;
    }, 'feed.flush');
  }
  // 读取最近 N 条提示（最新在前）：供诊断「提示流」分区跨帧聚合（每帧独立副本各自导出）。
  // 挂 window.__CX_FORCE_PLAY 而非闭包直调——诊断在顶层帧聚合各子帧，必须经 window 跨帧可达。
  bestEffort(function () {
    if (window.__CX_FORCE_PLAY) {
      window.__CX_FORCE_PLAY.toastFeedRecent = function (n) {
        var _n = Math.max(1, Math.min(n || 10, _toastFeedCap));
        return _toastFeedLog.slice(-_n).reverse();   // slice 后最新在尾，reverse 使最新在前
      };
      // v4.19.50 调试探针：诊断 [15] 空态时输出——定位「订阅丢失 vs 确实无记录 vs 持久化异常」
      window.__CX_FORCE_PLAY._toastFeedDebug = function () {
        var _persist = '无';
        try { var _r = localStorage.getItem(_TOAST_FEED_KEY); _persist = _r ? ('有(' + _r.length + 'B)') : '无'; } catch (e) { _persist = '读取异常'; }
        return { subscribed: _feedSubscribed, logLen: _toastFeedLog.length, persist: _persist };
      };
      // 公开写入入口（v4.19.49）：供非面板模块（如 DS 应答器）把关键动作记入提示流，使「复制诊断·[15]提示流」
      // 在应答端页也有内容可追溯。仅入结构化日志+回放洞察页容器（可选渲染，找不到容器静默跳过），不触发悬浮 toast。
      window.__CX_FORCE_PLAY.pushToastFeed = function (msg, level) {
        bestEffort(function () {
          if (msg == null) return;
          if (_toastFeedLog.length > _toastFeedCap) _toastFeedLog.shift();
          _toastFeedLog.push({ m: String(msg), l: level || 'info', ts: Date.now() });
          _schedulePersist();   // v4.19.50：跨会话/跨标签可复制
          var _box2 = _findFeedBox();
          if (_box2) _appendToastFeed(String(msg), level || 'info');   // 洞察页容器存在则同步渲染
        }, 'feed.pushExternal');
      };
    }
  }, 'feed.exportRecent');
  // 订阅提前到模块加载即执行（不等 ensurePanel 懒建面板）：旧实现订阅在面板首次构建时才挂，
  // 面板从未打开的会话里提示史从未被记录 → 诊断「提示流」分区恒空。现在无论面板是否打开，
  // toast 一律入 _toastFeedLog，诊断任何时刻可取最近 N 条。_feedSubscribed 与 panel-core.js
  // 的订阅守卫共享（后者保留作兜底，守卫保证全局仅订阅一次）；卸载由 lifecycle 的 clearSubs 全清。
  if (!_feedSubscribed) {
    _feedSubscribed = true;
    bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.onEv) EventBus.onEv('ui:toast', _onToastForFeed); }, 'feed.subscribeEarly');
  }

