// ==UserScript==
// @name         网课强制续播 · 抓包伴侣（cx-capture）
// @namespace    https://github.com/cx-force-play/chaoxing-force-play
// @version      1.0.0
// @description  钩子 fetch / XMLHttpRequest / sendBeacon / WebSocket，把请求-响应上报到本地收集端 capture-server.js。用于定位学习通「播放逻辑检测 / 服务端校验」究竟上报了什么。独立工具，不参与 chaoxing-force-play 构建。
// @match        *://*/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==
/*
 * 用法：
 *   1) 启动收集端：  npm run capture            （默认 http://127.0.0.1:9531）
 *   2) 安装本脚本并打开学习通章节页，正常刷课一小段
 *   3) 分析：        npm run capture:analyze
 * 说明：
 *   - 必须 @run-at document-start，否则会漏掉页面早期的进度上报/校验请求。
 *   - 走 GM_xmlhttpRequest 上报，天然绕过 CORS；无 GM 时回退为 text/plain 简单请求（免预检）。
 *   - 所有钩子均 try/catch 包裹，抓包失败不会影响页面正常播放。
 */
(function () {
  'use strict';

  var CFG = {
    server: 'http://127.0.0.1:9531',
    // 排除静态资源（按需删改正则）
    exclude: /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|mp4|m4a|webm|webp|map)(\?|$)/i,
    include: null,          // 非空正则时，只抓匹配的 URL
    maxBody: 20000,         // 单个请求/响应体截断字符数
    flushMs: 400,           // 批量上报间隔
    flushAt: 20,            // 攒够条数立即上报
    captureWS: true,        // 是否抓 WebSocket 帧
    captureHeaders: true    // 是否记录请求头（含 Cookie/Authorization，仅供本机分析）
  };

  var _fetch = window.fetch;
  var _XHR = window.XMLHttpRequest;
  var _sbRaw = null;
  try { _sbRaw = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null; } catch (e) { /* ignore */ }

  function loc() { try { return String(location.href).slice(0, 500); } catch (e) { return ''; } }

  function shouldCapture(url) {
    if (!url) return false;
    var u = String(url);
    if (u.indexOf(CFG.server) === 0) return false;         // 不抓上报自身
    if (CFG.include && !CFG.include.test(u)) return false;
    if (CFG.exclude && CFG.exclude.test(u)) return false;
    return true;
  }

  // ---------- 上报通道 ----------
  var buf = [];
  var timer = null;

  function send(ev) {
    try { buf.push(ev); } catch (e) { return; }
    if (buf.length >= CFG.flushAt) { flush(false); return; }
    if (!timer) timer = setTimeout(function () { timer = null; flush(false); }, CFG.flushMs);
  }

  function post(items) {
    var data;
    try { data = JSON.stringify(items); } catch (e) { return; }
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        GM_xmlhttpRequest({
          method: 'POST', url: CFG.server + '/ingest', data: data,
          headers: { 'Content-Type': 'application/json' }, timeout: 5000,
          onload: function () {}, onerror: function () {}, ontimeout: function () {}
        });
        return;
      } catch (e) { /* 落到 fetch 回退 */ }
    }
    try {
      if (_fetch) _fetch(CFG.server + '/ingest', {
        method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: data
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  function flush(isLast) {
    if (!buf.length) return;
    var items = buf;
    buf = [];
    if (timer) { clearTimeout(timer); timer = null; }
    // 页面卸载时用 sendBeacon 兜底（GM_xhr 可能来不及发出）
    if (isLast && _sbRaw) {
      try { if (_sbRaw.call(navigator, CFG.server + '/ingest', JSON.stringify(items))) return; } catch (e) { /* ignore */ }
    }
    post(items);
  }

  try { window.addEventListener('beforeunload', function () { flush(true); }, false); } catch (e) { /* ignore */ }
  try { window.addEventListener('pagehide', function () { flush(true); }, false); } catch (e) { /* ignore */ }

  // ---------- fetch ----------
  if (_fetch) {
    window.fetch = function () {
      var args = arguments;
      var input = args[0];
      var init = args[1] || {};
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var method = String((init.method || (input && input.method) || 'GET')).toUpperCase();
      if (!shouldCapture(url)) return _fetch.apply(this, args);

      var reqBody = null;
      try { reqBody = (init.body != null) ? String(init.body).slice(0, CFG.maxBody) : null; } catch (e) { /* ignore */ }
      var t0 = Date.now();

      return _fetch.apply(this, args).then(function (res) {
        var status = (res && res.status) || 0;
        var ms = Date.now() - t0;
        try {
          var clone = res.clone();
          clone.text().then(function (txt) {
            send({ kind: 'fetch', url: url, method: method, status: status, ms: ms,
                   reqBody: reqBody, resBody: (txt || '').slice(0, CFG.maxBody), frame: loc() });
          }).catch(function () {
            send({ kind: 'fetch', url: url, method: method, status: status, ms: ms, reqBody: reqBody, frame: loc() });
          });
        } catch (e) {
          send({ kind: 'fetch', url: url, method: method, status: status, ms: ms, reqBody: reqBody, frame: loc() });
        }
        return res;
      }, function (err) {
        send({ kind: 'fetch', url: url, method: method, status: 0, ms: Date.now() - t0,
               reqBody: reqBody, error: String((err && err.message) || err), frame: loc() });
        throw err;
      });
    };
  }

  // ---------- XMLHttpRequest ----------
  if (_XHR && _XHR.prototype) {
    var _open = _XHR.prototype.open;
    var _send = _XHR.prototype.send;
    var _setH = _XHR.prototype.setRequestHeader;

    _XHR.prototype.open = function (method, url) {
      try { this.__cx = { method: String(method || 'GET').toUpperCase(), url: String(url || ''), headers: {}, t0: 0 }; }
      catch (e) { /* ignore */ }
      return _open.apply(this, arguments);
    };

    _XHR.prototype.setRequestHeader = function (k, v) {
      try { if (this.__cx && CFG.captureHeaders) this.__cx.headers[k] = String(v); } catch (e) { /* ignore */ }
      return _setH.apply(this, arguments);
    };

    _XHR.prototype.send = function (body) {
      var cx = null;
      try { cx = this.__cx; } catch (e) { /* ignore */ }
      if (cx && shouldCapture(cx.url)) {
        cx.t0 = Date.now();
        cx.reqBody = (body != null) ? String(body).slice(0, CFG.maxBody) : null;
        var self = this;
        var emit = function (status, extra) {
          var txt = '';
          try { txt = (typeof self.responseText === 'string') ? self.responseText.slice(0, CFG.maxBody) : ''; } catch (e) { /* ignore */ }
          var ev = { kind: 'xhr', url: cx.url, method: cx.method, status: status,
                     ms: Date.now() - cx.t0, reqBody: cx.reqBody, resBody: txt, frame: loc() };
          if (CFG.captureHeaders) ev.headers = cx.headers;
          if (extra) for (var k in extra) ev[k] = extra[k];
          send(ev);
        };
        this.addEventListener('load', function () { emit(self.status, null); }, false);
        this.addEventListener('error', function () { emit(0, { error: 'network' }); }, false);
        this.addEventListener('timeout', function () { emit(0, { error: 'timeout' }); }, false);
        this.addEventListener('abort', function () { emit(0, { error: 'abort' }); }, false);
      }
      return _send.apply(this, arguments);
    };
  }

  // ---------- navigator.sendBeacon（常见于进度/心跳打点） ----------
  if (_sbRaw) {
    try {
      navigator.sendBeacon = function (url, data) {
        try {
          if (shouldCapture(String(url))) {
            send({ kind: 'beacon', url: String(url), method: 'POST',
                   reqBody: data != null ? String(data).slice(0, CFG.maxBody) : null, frame: loc() });
          }
        } catch (e) { /* ignore */ }
        return _sbRaw.call(navigator, url, data);
      };
    } catch (e) { /* ignore */ }
  }

  // ---------- WebSocket ----------
  if (CFG.captureWS && window.WebSocket) {
    var _WS = window.WebSocket;
    function CXWS() {
      var args = arguments;
      var url = String(args[0] || '');
      var ws = (args.length > 1) ? new _WS(args[0], args[1]) : new _WS(args[0]);
      if (shouldCapture(url)) {
        var t0 = Date.now();
        send({ kind: 'ws-open', url: url, frame: loc() });
        var _wsSend = ws.send;
        ws.send = function (d) {
          try { send({ kind: 'ws-send', url: url, data: String(d).slice(0, CFG.maxBody), ms: Date.now() - t0, frame: loc() }); }
          catch (e) { /* ignore */ }
          return _wsSend.apply(ws, arguments);
        };
        try {
          ws.addEventListener('message', function (ev) {
            try { send({ kind: 'ws-recv', url: url, data: String(ev.data).slice(0, CFG.maxBody), ms: Date.now() - t0, frame: loc() }); }
            catch (e) { /* ignore */ }
          }, false);
          ws.addEventListener('close', function (ev) {
            try { send({ kind: 'ws-close', url: url, code: ev.code, reason: String(ev.reason || ''), ms: Date.now() - t0, frame: loc() }); }
            catch (e) { /* ignore */ }
          }, false);
          ws.addEventListener('error', function () {
            try { send({ kind: 'ws-error', url: url, ms: Date.now() - t0, frame: loc() }); } catch (e) { /* ignore */ }
          }, false);
        } catch (e) { /* ignore */ }
      }
      return ws;
    }
    CXWS.prototype = _WS.prototype;
    try {
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
        try { CXWS[k] = _WS[k]; } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    window.WebSocket = CXWS;
  }

  console.log('[cx-capture] 已挂载 → ' + CFG.server + '（页面: ' + loc() + '）');
})();
