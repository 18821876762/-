'use strict';
/*
 * 逆向接口 · 独立 HTTP 服务端（当前系统的「被调用方」独立进程形态）
 * ---------------------------------------------------------------------------
 * 与浏览器内接收端 takeover/engine/reverse-api.js 共用 apps/userscript/reverse-api/shared/protocol.js
 * 定义的同一套协议/数据格式/认证/错误码（规范见 docs/REVERSE_API.md）。
 *
 * 启动：
 *   node apps/userscript/reverse-api/server.js
 * 环境变量（answer 能力必需）：
 *   REVERSE_API_ENDPOINT  官方/兼容 OpenAI 的 chat/completions 地址（如 https://api.deepseek.com/v1/chat/completions）
 *   REVERSE_API_KEY       共享密钥（= 浏览器侧配置的 QUIZ_VISION_API_KEY；下游调用须出示）
 *   REVERSE_API_MODEL     模型名（默认 deepseek-chat）
 *   REVERSE_API_PORT      监听端口（默认 8787）
 *   REVERSE_API_HOST      监听地址（默认 127.0.0.1，仅本机；暴露公网需自行加反代/TLS）
 *
 * 能力：status（查询状态）/ answer（题目求答，走 LLM 流式）/ submit（服务端无页面 → METHOD_UNAVAILABLE）。
 * 通信：POST /rpc，请求体=JSON 信封；认证=Authorization: Bearer <key> 或信封 auth 字段。
 */
const http = require('http');
const path = require('path');
const { REVERSE_API, httpStatusFor, buildSuccess, buildError, envelopeOk, authOk } = require('./shared/protocol.js');

const ENDPOINT = process.env.REVERSE_API_ENDPOINT || '';
const KEY = process.env.REVERSE_API_KEY || '';
const MODEL = process.env.REVERSE_API_MODEL || 'deepseek-chat';
const PORT = parseInt(process.env.REVERSE_API_PORT || '8787', 10);
const HOST = process.env.REVERSE_API_HOST || '127.0.0.1';
const STARTED = Date.now();

// 只接收明确答案字段/答案句或纯选项令牌；解释中的单词不会作为答案。
// 当前 RPC 不携带选项数量，故保留 A-Z 标签而不猜实际题目的选项范围。
function parseAnswer(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const source = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (/\b(?:maybe|perhaps|probably|uncertain|unsure|unknown|undetermined|ambiguous|none|guess(?:ing)?|either|or|not\s+(?:sure|certain)|(?:cannot|can't)\s+(?:determine|decide)|(?:don't|do\s+not)\s+know)\b|不确定|无法确定|无法判断|不能确定|难以判断|不知道|不清楚|可能|猜测|或者|[?？]/i.test(source)) return null;

  function labels(value) {
    if (Array.isArray(value)) {
      const parts = value.map(labels);
      return parts.length && parts.every(Boolean) ? Array.from(new Set(parts.join(''))).sort().join('') : null;
    }
    if (typeof value !== 'string') return null;
    const clean = value.trim().replace(/^[\s`'"*\[（(]+|[\s`'"*\]）)]+$/g, '');
    if (/^(?:ANSWERS?|CORRECT|FINAL|BECAUSE|SINCE|EXPLANATION|REASON|OPTIONS?|CHOICE|SELECT|YES|NO|TRUE|FALSE|NONE|NULL)$/.test(clean.toUpperCase())) return null;
    // 连写多选仅接受大写；分隔的单字母可小写，避免把 because 等词识别成选项。
    const parts = clean.replace(/\band\b|和|及|与/gi, ',').replace(/[,，、;+&\s]+/g, ',').split(',');
    if (!parts.length || parts.some(function (part) { return !/^(?:[A-Z]{1,26}|[a-z])$/.test(part); })) return null;
    return Array.from(new Set(parts.join('').toUpperCase())).sort().join('');
  }
  function agree(values) {
    return values.length && values.every(Boolean) && new Set(values).size === 1 ? values[0] : null;
  }

  // 结构化结果不扫描 reason/explanation 等字段。冲突的显式答案字段不能择一猜测。
  if (/^[{[]/.test(source)) {
    try {
      const obj = JSON.parse(source);
      if (Array.isArray(obj)) return labels(obj);
      const fields = Object.keys(obj).filter(function (key) { return /^(?:answers?|correct_?answer|final_?answer)$/i.test(key); });
      const writtenFields = source.match(/"(?:answers?|correct_?answer|final_?answer)"\s*:/gi) || [];
      if (writtenFields.length !== fields.length) return null; // 重复字段不能被 JSON.parse 静默覆盖后采信。
      return agree(fields.map(function (key) { return labels(obj[key]); }));
    } catch (e) { return null; }
  }

  const pure = labels(source);
  if (pure) return pure;
  const marker = /\b(?:answers?|correct\s+answers?|final\s+answers?)\b\s*(?::|=|is\b|are\b)\s*|(?:正确|最终|参考)?答案\s*(?:[:：=]|是|为)?\s*|正确选项\s*(?:[:：=]|是|为)?\s*/gi;
  const matches = Array.from(source.matchAll(marker)).filter(function (match) {
    return !/\b(?:incorrect|wrong|not|no)\s*$|(?:错误|不是|并非)\s*$/i.test(source.slice(0, match.index));
  });
  const values = matches.map(function (match, i) {
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    let value = source.slice(match.index + match[0].length, end);
    // 答案之后可带独立解释句，或 because/因为 等明确解释引导词。
    value = value.split(/\r?\n|[.!。；;]/, 1)[0];
    value = value.split(/[,，]?\s*(?:\bbecause\b|\bsince\b|\bexplanation\b|\breason\b|因为|理由|解释|解析|说明)/i, 1)[0];
    return labels(value.trim());
  });
  return agree(values);
}

// 复用浏览器侧 quizVisionAsk 的 OpenAI 兼容流式逻辑：Authorization: Bearer + chat/completions + SSE
function callLLM(image, prompt) {
  if (!ENDPOINT) return Promise.reject(new Error('REVERSE_API_ENDPOINT 未配置（服务端 answer 能力不可用）'));
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: prompt || '你是答题助手，请阅读题目图片并只输出答案。' },
      { role: 'user', content: [
        { type: 'text', text: prompt || '请阅读题目图片，输出答案。' },
        { type: 'image_url', image_url: { url: image } }
      ] }
    ],
    stream: true
  });
  const headers = { 'Content-Type': 'application/json' };
  if (KEY) headers['Authorization'] = 'Bearer ' + KEY;
  return fetch(ENDPOINT, { method: 'POST', headers: headers, body: body }).then(function (r) {
    if (!r.ok) return r.text().then(function (t) { throw new Error('LLM ' + r.status + (t ? ' : ' + t.slice(0, 200) : '')); }, function () { throw new Error('LLM ' + r.status); });
    return readSSE(r);
  }).then(function (full) { return { text: full || '', answer: parseAnswer(full) }; });
}

// 读取 SSE 流（text/event-stream）；无 body reader 时回退一次性 JSON
function readSSE(r) {
  return new Promise(function (resolve, reject) {
    const reader = (r && r.body && typeof r.body.getReader === 'function') ? r.body.getReader() : null;
    if (!reader) { return r.json().then(function (j) { resolve(contentOf(j) || ''); }, function () { resolve(''); }); }
    const dec = new TextDecoder('utf-8');
    let buf = '', acc = '', stop = false;
    function finish() { if (buf) { const c = sseLine(buf.replace(/\r$/, '')); if (c && c !== '__DONE__') acc += c; } resolve(acc); }
    function step() {
      reader.read().then(function (res) {
        if (res.done) { finish(); return; }
        buf += dec.decode(res.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          const c = sseLine(line);
          if (c === '__DONE__') { stop = true; break; }
          if (c) acc += c;
        }
        if (stop) { finish(); return; }
        step();
      }, function (err) { reject(err); });
    }
    step();
  });
}
function sseLine(line) {
  if (!line) return '';
  if (line.indexOf('data:') !== 0) return '';
  let data = line.slice(5);
  if (data.charAt(0) === ' ') data = data.slice(1);
  if (data === '[DONE]') return '__DONE__';
  try {
    const j = JSON.parse(data);
    const ch = j && j.choices && j.choices[0];
    if (ch) {
      if (ch.delta && ch.delta.content) return ch.delta.content;
      if (ch.message && ch.message.content) return ch.message.content;
    }
  } catch (e) {}
  return '';
}
function contentOf(j) {
  if (!j) return '';
  if (typeof j === 'string') return j;
  if (typeof j.text === 'string') return j.text;
  const ch = j.choices && j.choices[0];
  if (ch) {
    if (ch.message && ch.message.content) return ch.message.content;
    if (ch.delta && ch.delta.content) return ch.delta.content;
  }
  return '';
}

// 业务分发
function dispatch(method, params, id) {
  params = params || {};
  if (method === REVERSE_API.METHODS.STATUS) {
    return Promise.resolve(buildSuccess(id, {
      role: 'reverse-api-server',
      uptimeMs: Date.now() - STARTED,
      endpointConfigured: !!ENDPOINT,
      keySet: !!KEY,
      model: MODEL
    }));
  }
  if (method === REVERSE_API.METHODS.ANSWER) {
    const img = params.image || null;
    const prompt = params.prompt || params.question || null;
    if (!img && !prompt) return Promise.resolve(buildError(id, REVERSE_API.ERR.PARAM_INVALID, 'answer 需要 image(截图 dataURL) 或 question/prompt(题目文本)'));
    if (!img) return Promise.resolve(buildError(id, REVERSE_API.ERR.PARAM_INVALID, '服务端 answer 需要 image(截图 dataURL)；纯文本题目请直连 LLM'));
    return callLLM(img, prompt).then(function (r) {
      if (!r || (r.text == null && r.answer == null)) return buildError(id, REVERSE_API.ERR.ANSWER_FAILED, '作答未返回结果');
      return buildSuccess(id, { text: r.text || null, answer: r.answer || null });
    }).catch(function (e) {
      const msg = (e && e.message) || '作答失败';
      const code = /未配置/.test(msg) ? REVERSE_API.ERR.NO_ENDPOINT : REVERSE_API.ERR.ANSWER_FAILED;
      return buildError(id, code, msg);
    });
  }
  if (method === REVERSE_API.METHODS.SUBMIT) {
    // 服务端无浏览器页面，提交须在浏览器内接收端执行
    return Promise.resolve(buildError(id, REVERSE_API.ERR.METHOD_UNAVAILABLE, 'submit 需要浏览器内接收端（服务端无页面可提交）'));
  }
  if (method === REVERSE_API.METHODS.RUN) {
    // 服务端无浏览器页面，执行答题须在浏览器内接收端执行
    return Promise.resolve(buildError(id, REVERSE_API.ERR.METHOD_UNAVAILABLE, 'run 需要浏览器内接收端（服务端无页面可作答）'));
  }
  return Promise.resolve(buildError(id, REVERSE_API.ERR.METHOD_UNKNOWN, '未知 method: ' + method));
}

function handleEnvelope(m) {
  if (!envelopeOk(m)) return buildError(m && m.id, REVERSE_API.ERR.BAD_ENVELOPE, '非法信封（缺 v/method/id 或版本不符）');
  if (!KEY) return buildError(m.id, REVERSE_API.ERR.AUTH_REQUIRED, '服务端未配置 REVERSE_API_KEY（逆向接口关闭）');
  if (!authOk(m.auth, KEY)) return buildError(m.id, REVERSE_API.ERR.AUTH_INVALID, '认证失败（auth 与 REVERSE_API_KEY 不匹配）');
  return dispatch(m.method, m.params, m.id);
}

const server = http.createServer(function (req, res) {
  // CORS：本接口定位本地工具调用，默认放行所有源；生产暴露公网请改 Host 绑定+反代鉴权
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/rpc') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildError(null, REVERSE_API.ERR.METHOD_UNKNOWN, '仅支持 POST /rpc')));
    return;
  }
  let raw = '';
  let tooBig = false;
  req.on('data', function (c) { raw += c; if (raw.length > 1e6) { tooBig = true; raw = ''; req.destroy(); } });
  req.on('end', function () {
    if (tooBig) { res.writeHead(413); res.end(JSON.stringify(buildError(null, REVERSE_API.ERR.BAD_ENVELOPE, '请求体过大'))); return; }
    let m = null;
    try { m = JSON.parse(raw || '{}'); } catch (e) { res.writeHead(400); res.end(JSON.stringify(buildError(null, REVERSE_API.ERR.BAD_ENVELOPE, 'JSON 解析失败'))); return; }
    // 兼容 Authorization: Bearer <key>
    const authHdr = req.headers['authorization'] || '';
    if (!m.auth && authHdr.indexOf('Bearer ') === 0) m.auth = authHdr.slice(7);
    Promise.resolve(handleEnvelope(m)).then(function (resp) {
      const status = resp && resp.ok ? 200 : httpStatusFor(resp && resp.error && resp.error.code);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp));
    }).catch(function (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildError(m && m.id, REVERSE_API.ERR.INTERNAL, (e && e.message) || '内部错误')));
    });
  });
});

// 仅当以独立进程运行（node server.js）时监听端口；被 require 测试时不应自动起监听
if (require.main === module) {
  server.listen(PORT, HOST, function () {
    console.log('[reverse-api] HTTP 服务端已启动 ' + HOST + ':' + PORT + ' (channel=' + REVERSE_API.CHANNEL + ', endpoint=' + (ENDPOINT || '(未配置)') + ')');
    if (!KEY) console.log('[reverse-api] 警告：REVERSE_API_KEY 未设置，接口将返回 AUTH_REQUIRED（关闭）');
    if (!ENDPOINT) console.log('[reverse-api] 警告：REVERSE_API_ENDPOINT 未设置，answer 能力将返回 NO_ENDPOINT');
  });
  function shutdown() { try { server.close(); } catch (e) {} process.exit(0); }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { server: server, handleEnvelope: handleEnvelope, callLLM: callLLM, parseAnswer: parseAnswer };
