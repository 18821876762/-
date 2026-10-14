'use strict';
/*
 * 逆向接口 · 共享协议（单一事实源）
 * ---------------------------------------------------------------------------
 * 本文件是「逆向接口」通信协议的唯一权威定义，被两处实现共用、必须保持一致：
 *   1) 浏览器内接收端  apps/userscript/src/chaoxing-force-play/takeover/engine/reverse-api.js
 *      （无法直接 require 本文件，故该模块内联了等价的常量——修改本协议须同步该模块）
 *   2) 独立 HTTP 服务端 apps/userscript/reverse-api/server.js（直接 require 本文件）
 *
 * 协议要点（详见 docs/REVERSE_API.md）：
 *   · 信封(Envelope)：请求/响应均为 JSON 对象，含 v / id / method / params / auth(请求) 或 ok/result/error(响应)。
 *   · 认证：下游在请求信封带 auth 字段（共享密钥 = 当前系统的 QUIZ_VISION_API_KEY）；
 *           HTTP 服务端额外接受 Authorization: Bearer <key> 请求头。接口仅在
 *           QUIZ_VISION_USE_API_KEY=true 且已配置 Key 时启用。
 *   · 错误：统一 error.code 枚举（见 ERR），HTTP 服务端将其映射为对应 HTTP 状态码。
 * ---------------------------------------------------------------------------
 */
function httpStatusFor(code) {
  switch (code) {
    case 'BAD_ENVELOPE': return 400;
    case 'PARAM_INVALID': return 400;
    case 'AUTH_REQUIRED': return 401;
    case 'AUTH_INVALID': return 401;
    case 'METHOD_UNKNOWN': return 404;
    case 'METHOD_UNAVAILABLE': return 501;
    case 'RATE_LIMITED': return 429;
    case 'NO_ENDPOINT': return 409;
    case 'ANSWER_FAILED': return 502;
    case 'SUBMIT_FAILED': return 502;
    case 'SERVICE_UNAVAILABLE': return 503;
    case 'INTERNAL': return 500;
    default: return 400;
  }
}

var REVERSE_API = {
  VERSION: 1,
  CHANNEL: 'cx_reverse_api',
  METHODS: { ANSWER: 'answer', SUBMIT: 'submit', STATUS: 'status', RUN: 'run' },
  ERR: {
    BAD_ENVELOPE: 'BAD_ENVELOPE',
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    AUTH_INVALID: 'AUTH_INVALID',
    METHOD_UNKNOWN: 'METHOD_UNKNOWN',
    PARAM_INVALID: 'PARAM_INVALID',
    RATE_LIMITED: 'RATE_LIMITED',
    NO_ENDPOINT: 'NO_ENDPOINT',
    ANSWER_FAILED: 'ANSWER_FAILED',
    SUBMIT_FAILED: 'SUBMIT_FAILED',
    METHOD_UNAVAILABLE: 'METHOD_UNAVAILABLE',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    INTERNAL: 'INTERNAL'
  },
  httpStatusFor: httpStatusFor
};

function buildSuccess(id, result) {
  return { v: REVERSE_API.VERSION, id: id, ok: true, result: result || {} };
}
function buildError(id, code, message) {
  return { v: REVERSE_API.VERSION, id: id, ok: false, error: { code: code, message: message || '' } };
}
function envelopeOk(m) {
  return !!m && typeof m === 'object' && m.v === REVERSE_API.VERSION && typeof m.method === 'string' && typeof m.id !== 'undefined';
}
// 校验共享密钥：expected 为当前系统配置的 Key；空 Key 视为接口未启用
function authOk(token, expected) {
  return typeof token === 'string' && token.length > 0 && token === expected;
}

module.exports = {
  REVERSE_API: REVERSE_API,
  httpStatusFor: httpStatusFor,
  buildSuccess: buildSuccess,
  buildError: buildError,
  envelopeOk: envelopeOk,
  authOk: authOk
};
