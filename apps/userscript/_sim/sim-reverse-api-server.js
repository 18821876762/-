// 逆向接口(独立 HTTP 服务端)回归：通过 handleEnvelope 验证协议/认证/三方法/错误码。
// 以 require 载入 server.js（require.main 守卫确保不自动起端口），mock 全局 fetch 模拟 LLM 流式。
process.env.REVERSE_API_KEY = 'sk-srv';
process.env.REVERSE_API_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
process.env.REVERSE_API_MODEL = 'deepseek-chat';
let fail = 0;
let assertions = 0;
function assert(name, cond) {
  assertions++;
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}
function fakeStreamResponse(chunks, status) {
  let i = 0;
  const reader = {
    read() {
      if (i >= chunks.length) return Promise.resolve({ done: true, value: undefined });
      const v = chunks[i++];
      return Promise.resolve({ done: false, value: (typeof v === 'string') ? new TextEncoder().encode(v) : v });
    }
  };
  return { ok: (status || 200) >= 200 && (status || 200) < 300, status: status || 200, text() { return Promise.resolve(''); }, body: { getReader: () => reader } };
}

async function main() {
  console.log('--- 逆向接口(独立 HTTP 服务端)回归 ---');
  const srv = require(path_join(__dirname, '..', 'reverse-api', 'server.js'));
  const { handleEnvelope } = srv;

  // mock 全局 fetch = 模拟 OpenAI 兼容 SSE
  global.fetch = function (url, init) {
    return Promise.resolve(fakeStreamResponse([
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":":"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      'data: [DONE]\n\n'
    ]));
  };

  // ① status → 成功
  {
    const r = await handleEnvelope({ v: 1, id: 's1', method: 'status', auth: 'sk-srv' });
    assert('status: ok=true', r && r.ok === true);
    assert('status: role=reverse-api-server', r && r.result && r.result.role === 'reverse-api-server');
    assert('status: endpointConfigured=true', r && r.result && r.result.endpointConfigured === true);
  }

  // ② 密钥错误 → AUTH_INVALID
  {
    const r = await handleEnvelope({ v: 1, id: 's2', method: 'status', auth: 'sk-bad' });
    assert('密钥错误: AUTH_INVALID', r && r.ok === false && r.error && r.error.code === 'AUTH_INVALID');
  }

  // ③ 非法信封 → BAD_ENVELOPE
  {
    const r = await handleEnvelope({ v: 1, id: 's3', auth: 'sk-srv' });
    assert('非法信封: BAD_ENVELOPE', r && r.ok === false && r.error && r.error.code === 'BAD_ENVELOPE');
  }

  // ④ answer → 流式解析出 A，且下游请求带 Bearer
  {
    let cap = null;
    global.fetch = function (url, init) { cap = { url: url, init: init }; return Promise.resolve(fakeStreamResponse([
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":":"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      'data: [DONE]\n\n'
    ])); };
    const r = await handleEnvelope({ v: 1, id: 's4', method: 'answer', params: { image: 'data:image/png;base64,QQQ', prompt: '只输出答案' }, auth: 'sk-srv' });
    assert('answer: ok=true', r && r.ok === true);
    assert('answer: result.answer=A', r && r.result && r.result.answer === 'A');
    assert('answer: 下游请求带 Authorization Bearer', cap && cap.init && cap.init.headers && cap.init.headers['Authorization'] === 'Bearer sk-srv');
  }

  // ⑤ submit → 服务端无页面 → METHOD_UNAVAILABLE
  {
    const r = await handleEnvelope({ v: 1, id: 's5', method: 'submit', auth: 'sk-srv' });
    assert('submit: METHOD_UNAVAILABLE', r && r.ok === false && r.error && r.error.code === 'METHOD_UNAVAILABLE');
  }

  // ⑥ run → 服务端无页面 → METHOD_UNAVAILABLE
  {
    const r = await handleEnvelope({ v: 1, id: 's6', method: 'run', auth: 'sk-srv' });
    assert('run: METHOD_UNAVAILABLE', r && r.ok === false && r.error && r.error.code === 'METHOD_UNAVAILABLE');
  }

  // ⑦ 真实返回格式：解释词不能成为选项；范围未在 RPC 给出时不得截断 E/F。
  const examples = [
    ['B', 'B'],
    ['Answer: B', 'B'],
    ['The correct answer is B. This matches the evidence.', 'B'],
    ['Answer: B because the first step is required.', 'B'],
    ['答案是E，因为这里的条件成立。', 'E'],
    ['最终答案：F', 'F'],
    ['A, E, A', 'AE'],
    ['Answer: F and A', 'AF'],
    ['Answer: F AND A', 'AF'],
    ['答案为 A、F、A', 'AF'],
    ['**Answer:** **E**', 'E'],
    ['Z', 'Z'],
    ['{"answer":"E","explanation":"The evidence supports this choice."}', 'E'],
    ['{"answers":["F","A","F"]}', 'AF'],
    ['```json\n{"correct_answer":"E"}\n```', 'E'],
    ['Answer: E. Final answer: E.', 'E'],
    ['Answer: B. Final answer: C.', null],
    ['The wrong answer is B.', null],
    ['The incorrect answer is A. The correct answer is B.', 'B'],
    ['{"answer":"B","final_answer":"C"}', null],
    ['{"answer":"B","answer":"C"}', null],
    ['Answer: B or C', null],
    ['答案：可能是E', null],
    ['Probably B', null],
    ['Answer: B?', null],
    ['I do not know. Answer: B.', null],
    ['答案：无法确定', null],
    ['Answer: none', null],
    ['because', null],
    ['BECAUSE', null],
    ['ANSWER', null],
    ['The correct explanation covers A and B.', null],
    ['Answer: because the condition is true.', null],
    ['{"text":"The answer is B."}', null],
    ['{"answer":2}', null],
    ['', null]
  ];
  for (const pair of examples) {
    assert('明确答案解析 ' + JSON.stringify(pair[0]), srv.parseAnswer(pair[0]) === pair[1]);
  }
  assert('答案句长空白后解释仍只提取 B', srv.parseAnswer('Answer: B' + ' '.repeat(5000) + 'because the condition is true.') === 'B');

  // ⑧ POST /rpc → 本地服务 → mock LLM SSE → 解析 → 响应；只使用本机 socket。
  const http = require('http');
  function postRpc(port, envelope) {
    return new Promise(function (resolve, reject) {
      const body = JSON.stringify(envelope);
      const req = http.request({ host: '127.0.0.1', port: port, path: '/rpc', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer sk-srv' } }, function (res) {
        let raw = '';
        res.on('data', function (chunk) { raw += chunk; });
        res.on('end', function () { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  await new Promise(function (resolve, reject) { srv.server.once('error', reject); srv.server.listen(0, '127.0.0.1', resolve); });
  try {
    const replies = [
      ['The correct answer is B. This follows from the definition.', 'B'],
      ['Answer: F and A. Both conditions must hold.', 'AF'],
      ['{"answer":"E","reason":"The evidence supports option E."}', 'E'],
      ['Answer: B. Final answer: C.', null],
      ['Answer: probably E.', null]
    ];
    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i][0];
      global.fetch = function () {
        const event = 'data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n';
        return Promise.resolve(fakeStreamResponse([event.slice(0, 19), event.slice(19), 'data: [DONE]\n\n']));
      };
      const result = await postRpc(srv.server.address().port, { v: 1, id: 'http-' + i, method: 'answer', params: { image: 'data:image/png;base64,QQQ', prompt: '请回答题目' } });
      assert('HTTP SSE 答案 ' + i, result.status === 200 && result.body.ok && result.body.result.answer === replies[i][1]);
      assert('HTTP SSE 保留完整回复 ' + i, result.body.result.text === reply);
    }
  } finally {
    await new Promise(function (resolve) { srv.server.close(resolve); });
  }

  console.log(fail === 0 ? '结论: PASS — 逆向接口(独立 HTTP 服务端)，' + assertions + ' assertions' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
function path_join() { return require('path').join.apply(null, Array.prototype.slice.call(arguments)); }
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
