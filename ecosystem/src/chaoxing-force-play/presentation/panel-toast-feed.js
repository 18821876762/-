  // ===== DOMAIN: presentation/panel-toast-feed (toast feed + tip-pin) =====
  // 提示流（洞察页）：把所有 Store.emit('ui:toast') 集中到「洞察」页回看，
  // 既保留悬浮 toast 的即时反馈，又解决其"一闪而过/难追溯/分散"的问题（用户诉求：提示集中到洞察页）。
  // 自 panel-core.js 拆分（治理·单文件红线 >350 合规）；与 ensurePanel 同打包作用域，函数/状态互相可达。

  var _toastFeedBuf = [];     // 面板未构建时缓冲，开面板再 flush
  var _toastFeedCap = 80;
  var _feedSubscribed = false;
  function _toastFeedColor(level) {
    try { return ({ success: STYLES.T.success, warn: STYLES.T.warning, error: STYLES.T.danger })[level] || STYLES.T.text2; } catch (e) { return '#aeb6c2'; }
  }
  function _findFeedBox() {
    try {
      var b = (typeof document !== 'undefined') ? document.getElementById('__cxToastFeed') : null;
      if (!b && window.top && window.top.document) b = window.top.document.getElementById('__cxToastFeed');
      return b;
    } catch (e) { return null; }
  }
  function _appendToastFeed(msg, level) {
    try {
      var box = _findFeedBox(); if (!box) return;
      var _empty = box.querySelector && box.querySelector('#__cxToastFeedEmpty');
      if (_empty) { try { box.removeChild(_empty); } catch (e3) {} }   // 首条提示到达→移除空态占位
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
    } catch (e2) { swallow(e2); }
  }
  function _updateTipPin(msg, level) {
    try {
      var t = (typeof document !== 'undefined') ? document.getElementById('__cxTipPinText') : null;
      if (!t && window.top && window.top.document) t = window.top.document.getElementById('__cxTipPinText');
      if (!t) return;
      t.textContent = String(msg);   // textContent 写入，杜绝 XSS 注入
      t.style.color = _toastFeedColor(level);
    } catch (e) { swallow(e); }
  }
  function _onToastForFeed(msg, level) {
    try {
      _toastFeedBuf.push({ m: String(msg), l: level || 'info' });
      if (_toastFeedBuf.length > _toastFeedCap) _toastFeedBuf.shift();
      _appendToastFeed(msg, level);
      _updateTipPin(msg, level);   // Rec C：钉底最近提示实时刷新（跨 tab 可见）
    } catch (e) { swallow(e); }
  }
  function _flushToastFeed() {
    try {
      for (var i = 0; i < _toastFeedBuf.length; i++) _appendToastFeed(_toastFeedBuf[i].m, _toastFeedBuf[i].l);
      if (_toastFeedBuf.length) { var _last = _toastFeedBuf[_toastFeedBuf.length - 1]; _updateTipPin(_last.m, _last.l); }   // 开面板后把最后一条缓冲同步到钉底
      _toastFeedBuf.length = 0;
    } catch (e) { swallow(e); }
  }
