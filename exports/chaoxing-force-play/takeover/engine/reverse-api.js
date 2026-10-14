// @requires: CONFIG, _quizHandled, _quizPendingSubmit, _quizVisionCheckContext, bestEffort, detectSite, quizCredentialStore, quizScanOnce
// ===== MODULE: takeover/engine/reverse-api（逆向接口 · 浏览器内接收端）=====
// 双通道备用机制的「入站」一侧：当前系统（注入页面的 userscript）作为被调用方，支持下游系统
// （同浏览器页面/扩展/跨标签，或经本地 HTTP 服务端 ecosystem/reverse-api/server.js 转发）经
//   · window.postMessage（同源/受信源，event.origin 可信）
//   · BroadcastChannel('cx_reverse_api')（跨标签）
// 发起调用。与 server.js 共用同一套协议/数据格式/认证/错误码；规范见 docs/REVERSE_API.md。
// ⚠️ 本协议常量须与 ecosystem/reverse-api/shared/protocol.js 严格保持一致（浏览器内无法 require）。
// 本模块被拼接进主 IIFE，故 REVERSE_API 常量与函数均落在文件作用域，可访问 CONFIG / quizVisionAsk /
// quizSubmitPending / detectSite / bestEffort 等跨模块符号。
var REVERSE_API = {
  VERSION: 1,
  CHANNEL: 'cx_reverse_api',
  METHODS: { ANSWER: 'answer', SUBMIT: 'submit', STATUS: 'status', RUN: 'run' },
  ERR: {
    BAD_ENVELOPE: 'BAD_ENVELOPE', AUTH_REQUIRED: 'AUTH_REQUIRED', AUTH_INVALID: 'AUTH_INVALID',
    METHOD_UNKNOWN: 'METHOD_UNKNOWN', PARAM_INVALID: 'PARAM_INVALID', RATE_LIMITED: 'RATE_LIMITED',
    NO_ENDPOINT: 'NO_ENDPOINT', ANSWER_FAILED: 'ANSWER_FAILED', SUBMIT_FAILED: 'SUBMIT_FAILED',
    METHOD_UNAVAILABLE: 'METHOD_UNAVAILABLE', SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE', INTERNAL: 'INTERNAL'
  }
};

function reverseApiEnabled() {
  return !!(typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_USE_API_KEY && quizCredentialStore.status().hasKey);
}
function reverseApiAuthOk(token) {
  if (!reverseApiEnabled()) return false;
  return quizCredentialStore.matches(token);
}
function reverseApiEnvelopeOk(m) {
  return !!m && typeof m === 'object' && m.v === REVERSE_API.VERSION && typeof m.method === 'string' && typeof m.id !== 'undefined';
}
function reverseApiResOk(id, result) { return { v: REVERSE_API.VERSION, id: id, ok: true, result: result || {} }; }
function reverseApiResErr(id, code, message) { return { v: REVERSE_API.VERSION, id: id, ok: false, error: { code: code, message: message || '' } }; }

// 只读状态快照（查询状态能力）：版本/站点/配置/答题进展
function reverseApiStatus() {
  var cfg = {};
  try {
    cfg = {
      OCR: (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR) || null,
      endpoint: (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENDPOINT) || null,
      useApiKey: !!(typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_USE_API_KEY),
      model: (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_API_MODEL) || null
    };
  } catch (e) {}
  var quiz = { handled: 0, pendingSubmit: 0, submitted: false };
  try {
    if (typeof _quizHandled !== 'undefined' && _quizHandled) quiz.handled = Object.keys(_quizHandled).length;
    if (typeof _quizPendingSubmit !== 'undefined' && _quizPendingSubmit) quiz.pendingSubmit = Object.keys(_quizPendingSubmit).length;
    if (typeof _quizSubmittedNotified !== 'undefined') quiz.submitted = !!_quizSubmittedNotified;
  } catch (e) {}
  return {
    version: (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.version) || null,
    site: (typeof detectSite === 'function') ? detectSite() : null,
    config: cfg,
    quiz: quiz
  };
}

// 业务处理：按 method 分发；返回响应对象或 Promise<响应>
function reverseApiDispatch(method, params, id, context) {
  params = params || {};
  if (method === REVERSE_API.METHODS.STATUS) {
    return reverseApiResOk(id, reverseApiStatus());
  }
  if (method === REVERSE_API.METHODS.ANSWER) {
    var img = params.image || null;
    var prompt = params.prompt || params.question || null;
    if (!img && !prompt) return reverseApiResErr(id, REVERSE_API.ERR.PARAM_INVALID, 'answer 需要 image(截图 dataURL) 或 question/prompt(题目文本)');
    if (typeof quizVisionAsk !== 'function') return reverseApiResErr(id, REVERSE_API.ERR.ANSWER_FAILED, '答题引擎不可用');
    return Promise.resolve(quizVisionAsk(img, prompt, context)).then(function (r) {
      if (!r || (r.text == null && r.answer == null)) return reverseApiResErr(id, REVERSE_API.ERR.ANSWER_FAILED, '作答未返回结果');
      return reverseApiResOk(id, { text: r.text || null, answer: r.answer || null });
    }).catch(function (e) {
      var msg = (e && e.message) || '作答失败';
      var code = /未配置|白名单/.test(msg) ? REVERSE_API.ERR.NO_ENDPOINT : REVERSE_API.ERR.ANSWER_FAILED;
      return reverseApiResErr(id, code, msg);
    });
  }
  if (method === REVERSE_API.METHODS.SUBMIT) {
    try {
      var n = (typeof quizSubmitPending === 'function') ? quizSubmitPending() : 0;
      return reverseApiResOk(id, { submitted: n });
    } catch (e) { return reverseApiResErr(id, REVERSE_API.ERR.SUBMIT_FAILED, (e && e.message) || '提交失败'); }
  }
  if (method === REVERSE_API.METHODS.RUN) {
    // 执行答题：触发当前页答题引擎（quizScanOnce 强制扫当前页并作答）。仅 in-page 接收端有意义。
    try {
      if (typeof quizScanOnce !== 'function') return reverseApiResErr(id, REVERSE_API.ERR.SERVICE_UNAVAILABLE, '答题引擎不可用（quizScanOnce 未加载）');
      quizScanOnce();
      return reverseApiResOk(id, { triggered: true, stats: reverseApiStatus().quiz });
    } catch (e) { return reverseApiResErr(id, REVERSE_API.ERR.INTERNAL, (e && e.message) || '触发作答失败'); }
  }
  return reverseApiResErr(id, REVERSE_API.ERR.METHOD_UNKNOWN, '未知 method: ' + method);
}

// 统一入口：处理一个请求信封 → 响应（同步值或 Promise）
function reverseApiHandle(m) {
  if (!reverseApiEnvelopeOk(m)) return reverseApiResErr(m && m.id, REVERSE_API.ERR.BAD_ENVELOPE, '非法信封（缺 v/method/id 或版本不符）');
  var context = m.method === REVERSE_API.METHODS.ANSWER ? _quizVisionCreateContext(null) : null;
  return quizCredentialStore.ready.then(function () {
    _quizVisionCheckContext(context);
    if (!reverseApiEnabled()) return reverseApiResErr(m.id, REVERSE_API.ERR.SERVICE_UNAVAILABLE, '逆向接口未启用（需在面板开启「使用官方 API Key」并填写 Key）');
    if (!reverseApiAuthOk(m.auth)) return reverseApiResErr(m.id, REVERSE_API.ERR.AUTH_INVALID, '认证失败（auth 与系统 API Key 不匹配）');
    return reverseApiDispatch(m.method, m.params, m.id, context);
  }).catch(function (error) {
    return reverseApiResErr(m.id, REVERSE_API.ERR.ANSWER_FAILED, error && error.name === 'AbortError' ? '作答请求已取消' : '作答请求失败');
  }).finally(function () { if (context) context.finish(); });
}

// 初始化：挂接 postMessage / BroadcastChannel 监听；导出测试钩子
// 传输层引用：命名 handler + 通道句柄，供 reverseApiStop 卸载清理（本模块默认随主脚本注入即常驻，
//   但 uninstall 时须一并摘除，避免匿名监听器/未关闭通道成为资源残留）。
var _reverseApiMsgHandler = null;
var _reverseApiBc = null;
// postMessage 源校验（纵深防御）：同源、或非 Web 上下文(about:blank/iframe srcdoc 等 origin=null，
//   file:/扩展 等 origin 无法被跨站伪造)直接放行；跨站 Web 源一律拒绝——认证 token 本就是第一道门，
//   此校验防「token 泄露时的跨站调用」，与 server.js 的 CORS * 是不同通道、不冲突。
function _reverseApiOriginOk(ev) {
  if (!ev || typeof ev.origin !== 'string') return false;
  var o = ev.origin;
  try {
    if (o === window.location.origin) return true;
    if (o === 'null') return true;
    return /^(file|chrome-extension|moz-extension|safari-extension|opera-extension):/i.test(o);
  } catch (e) { return false; }
}
function initReverseApi() {
  if (typeof window === 'undefined') return;
  var ns = window.__CX_FORCE_PLAY;
  if (ns && ns._reverseApiStarted) return;
  if (ns) ns._reverseApiStarted = true;

  // ① window.postMessage（同源/受信源；event.origin 由浏览器保证不可伪造）
  _reverseApiMsgHandler = function (ev) {
    var data = ev && ev.data;
    if (!data || data.method === undefined || data.v !== REVERSE_API.VERSION) return; // 仅处理本接口请求（带 method）
    if (!_reverseApiOriginOk(ev)) return; // 纵深防御：跨站 Web 源拒绝
    var resp = reverseApiHandle(data);
    Promise.resolve(resp).then(function (r) { if (r && ev.source) { try { ev.source.postMessage(r, ev.origin || '*'); } catch (e) {} } });
  };
  window.addEventListener('message', _reverseApiMsgHandler);

  // ② BroadcastChannel（跨标签；响应按 id 回带，调用方在同一通道上监听带 ok/error 的响应）
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      var bc = new BroadcastChannel(REVERSE_API.CHANNEL);
      bc.onmessage = function (ev) {
        var data = ev && ev.data;
        if (!data || data.method === undefined || data.v !== REVERSE_API.VERSION) return;
        var resp = reverseApiHandle(data);
        Promise.resolve(resp).then(function (r) { if (r) { try { bc.postMessage(r); } catch (e) {} } });
      };
      _reverseApiBc = bc;
    } catch (e) { /* BroadcastChannel 不可用则跳过该通道 */ }
  }

  // 导出供测试/外部直接调用（绕过传输层）
  if (ns) {
    ns.reverseApiHandle = reverseApiHandle;
    ns.reverseApiStatus = reverseApiStatus;
    ns.REVERSE_API = REVERSE_API;
    ns.reverseApiStop = reverseApiStop;
  }
}
// 卸载清理：移除 message 监听 + 关闭 BroadcastChannel（幂等；配合 lifecycle cleanupListeners 调用）
function reverseApiStop() {
  try { if (_reverseApiMsgHandler && typeof window !== 'undefined') window.removeEventListener('message', _reverseApiMsgHandler); } catch (e) {}
  _reverseApiMsgHandler = null;
  try { if (_reverseApiBc) _reverseApiBc.close(); } catch (e) {}
  _reverseApiBc = null;
  if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
    try { window.__CX_FORCE_PLAY._reverseApiStarted = false; } catch (e) {}
  }
}

bestEffort(function () { initReverseApi(); }, 'reverse-api.init');
