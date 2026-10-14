// 逆向接口(浏览器内接收端)回归：验证 reverseApiHandle 的请求接收/参数解析/数据校验/业务处理/响应返回全链路。
// 直接调用导出的 ns.reverseApiHandle（绕过传输层），覆盖：未启用/认证失败/非法信封/未知方法/状态查询/题目求答(流式)。
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}
const artifact = process.env.CX_SIM_USE_SOURCE === '1'
  ? require('../scripts/source-groups.cjs').analyzeSources(path.join(__dirname, '../src/chaoxing-force-play')).code
  : fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}
function loadAt(url, privateKey) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  window.GM_getValue = function (name, fallback) { return name === 'cx_private_vision_api_key_v1' ? (privateKey ? { key: privateKey, origin: 'https://api.deepseek.com' } : '') : fallback; };
  window.GM_setValue = function () {};
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
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
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

async function main() {
  console.log('--- 逆向接口(浏览器内接收端)回归 ---');
  const EP = 'https://api.deepseek.com/v1/chat/completions';
  const HOST = 'api.deepseek.com';

  // ① 未启用 → SERVICE_UNAVAILABLE（新窗口默认 useApiKey=false）
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1');
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'a', method: 'status', auth: 'x' });
    assert('未启用: 返回 SERVICE_UNAVAILABLE', r && r.ok === false && r.error && r.error.code === 'SERVICE_UNAVAILABLE');
  }

  // ② 启用但密钥错误 → AUTH_INVALID
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-right');
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'b', method: 'status', auth: 'sk-wrong' });
    assert('密钥错误: 返回 AUTH_INVALID', r && r.ok === false && r.error && r.error.code === 'AUTH_INVALID');
  }

  // ③ 非法信封（缺 method）→ BAD_ENVELOPE
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-right');
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'c', auth: 'sk-right' });
    assert('非法信封: 返回 BAD_ENVELOPE', r && r.ok === false && r.error && r.error.code === 'BAD_ENVELOPE');
  }

  // ④ 未知 method → METHOD_UNKNOWN
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-right');
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'd', method: 'frobnicate', auth: 'sk-right' });
    assert('未知方法: 返回 METHOD_UNKNOWN', r && r.ok === false && r.error && r.error.code === 'METHOD_UNKNOWN');
  }

  // ⑤ status → 成功并含配置快照
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-right');
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    ns.CONFIG.QUIZ_VISION_OCR = 'endpoint';
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'e', method: 'status', auth: 'sk-right' });
    assert('status: ok=true', r && r.ok === true);
    assert('status: result.config.useApiKey=true', r && r.result && r.result.config && r.result.config.useApiKey === true);
    assert('status: result.version 非空', r && r.result && typeof r.result.version === 'string');
  }

  // ⑥ answer → 启用+流式 SSE → 解析出答案 A；并校验下游接口调用带 Bearer
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-test');
    ns.CONFIG.QUIZ_VISION_OCR = 'endpoint';
    ns.CONFIG.QUIZ_VISION_ENDPOINT = EP;
    ns.CONFIG.QUIZ_VISION_ENDPOINT_ALLOW = HOST;
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    ns.setQuizSnapshotOverride(function () { return 'data:image/png;base64,FAKE'; });
    let cap = null;
    window.fetch = function (url, init) { cap = { url: url, init: init }; return Promise.resolve(fakeStreamResponse([
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":":"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      'data: [DONE]\n\n'
    ])); };
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'f', method: 'answer', params: { image: 'data:image/png;base64,QQQ', prompt: '只输出答案' }, auth: 'sk-test' });
    assert('answer: ok=true', r && r.ok === true);
    assert('answer: result.answer=A', r && r.result && r.result.answer === 'A');
    assert('answer: 下游请求带 Authorization Bearer', cap && cap.init && cap.init.headers && cap.init.headers['Authorization'] === 'Bearer sk-test');
  }

  // ⑦ answer 缺参数 → PARAM_INVALID
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-right');
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'g', method: 'answer', params: {}, auth: 'sk-right' });
    assert('answer 缺参: 返回 PARAM_INVALID', r && r.ok === false && r.error && r.error.code === 'PARAM_INVALID');
  }

  // ⑧ run → 触发当前页作答；ok + triggered=true + stats 对象
  {
    const { ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-right');
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    await tick();
    const r = await ns.reverseApiHandle({ v: 1, id: 'h', method: 'run', auth: 'sk-right' });
    assert('run: ok=true', r && r.ok === true);
    assert('run: result.triggered=true', r && r.result && r.result.triggered === true);
    assert('run: result.stats 为对象', r && r.result && r.result.stats && typeof r.result.stats === 'object');
  }

  console.log(fail === 0 ? '结论: PASS — 逆向接口(浏览器内接收端)' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
