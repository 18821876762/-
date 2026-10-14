// endpoint 双通道(API Key)+流式解析回归：验证 QUIZ_VISION_USE_API_KEY 切换行为。
//   ① 关（默认）= 逆向/自建接口：{image,prompt} 契约，无 Authorization，答案直接取端点回包；
//   ② 开 = 官方 OpenAI 兼容接口：Authorization: Bearer <key> + chat/completions 形态 + SSE 流式解析 → 答案字母；
//   ③ 开 但端点不支持流式（无 body reader）→ 回退一次性 JSON，答案仍由 _dsParseAnswer 解析。
// 驱动方式：复用已暴露的 quizRecover（endpoint 模式不经混淆解码），经 setQuizSnapshotOverride 注入假截图，
// 再用 window.fetch mock 捕获请求形态 / 模拟 SSE 流式响应。
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
  return {
    ok: (status || 200) >= 200 && (status || 200) < 300,
    status: status || 200,
    text() { return Promise.resolve(''); },
    body: { getReader: () => reader }
  };
}

async function main() {
  console.log('--- endpoint 双通道(API Key)+流式解析回归 ---');
  const EP = 'https://api.deepseek.com/v1/chat/completions';
  const HOST = 'api.deepseek.com';

  // ① 启用 API Key：流式 SSE → Authorization + OpenAI 形态 + 解析出字母 A
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-test-123');
    ns.CONFIG.QUIZ_VISION_OCR = 'endpoint';
    ns.CONFIG.QUIZ_VISION_ENDPOINT = EP;
    ns.CONFIG.QUIZ_VISION_ENDPOINT_ALLOW = HOST;
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    ns.setQuizSnapshotOverride(function () { return 'data:image/png;base64,FAKEIMG'; });
    let cap = null;
    window.fetch = function (url, init) { cap = { url: url, init: init }; return Promise.resolve(fakeStreamResponse([
      'data: {"choices":[{"delta":{"content":"答"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"案"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":":"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      'data: [DONE]\n\n'
    ])); };
    const r = await ns.quizRecover(window.document.body);
    assert('APIKey: fetch 被调用', !!cap);
    assert('APIKey: 请求方法 POST', !!(cap && cap.init && cap.init.method === 'POST'));
    assert('APIKey: 携带 Authorization: Bearer <key>', !!(cap && cap.init && cap.init.headers && cap.init.headers['Authorization'] === 'Bearer sk-test-123'));
    const body = cap && cap.init && JSON.parse(cap.init.body);
    assert('APIKey: 请求体含 model=deepseek-chat', !!(body && body.model === 'deepseek-chat'));
    assert('APIKey: 请求体 stream=true', !!(body && body.stream === true));
    assert('APIKey: 请求体 messages[1] 含 image_url', !!(body && body.messages && body.messages[1] && body.messages[1].content && body.messages[1].content.some(function (c) { return c.type === 'image_url'; })));
    assert('APIKey: 结果 answer 解析为字母 A', !!(r && r.answer === 'A'));
    assert('APIKey: 结果 text 为流式拼装文本「答案:A」', !!(r && typeof r.text === 'string' && r.text === '答案:A'));
  }

  // ② 关闭 API Key：逆向接口契约 {image,prompt}，无 Authorization，答案取端点回包
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_VISION_OCR = 'endpoint';
    ns.CONFIG.QUIZ_VISION_ENDPOINT = EP;
    ns.CONFIG.QUIZ_VISION_ENDPOINT_ALLOW = HOST;
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = false;
    ns.setQuizSnapshotOverride(function () { return 'data:image/png;base64,FAKEIMG'; });
    let cap = null;
    window.fetch = function (url, init) { cap = { url: url, init: init }; return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(''); }, json: function () { return Promise.resolve({ text: '逆向接口文本', answer: 2 }); } }); };
    const r = await ns.quizRecover(window.document.body);
    assert('无Key: 请求无 Authorization', !!(cap && cap.init && (!cap.init.headers || !cap.init.headers['Authorization'])));
    const body = cap && JSON.parse(cap.init.body);
    assert('无Key: 请求体为 {image,prompt}', !!(body && body.image && body.prompt));
    assert('无Key: 结果直接取端点 answer=2', !!(r && r.answer === 2));
  }

  // ③ 启用 API Key 但端点不支持流式（无 body reader）→ 回退一次性 JSON，答案仍解析
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1', 'sk-x');
    ns.CONFIG.QUIZ_VISION_OCR = 'endpoint';
    ns.CONFIG.QUIZ_VISION_ENDPOINT = EP;
    ns.CONFIG.QUIZ_VISION_ENDPOINT_ALLOW = HOST;
    ns.CONFIG.QUIZ_VISION_USE_API_KEY = true;
    ns.setQuizSnapshotOverride(function () { return 'data:image/png;base64,FAKEIMG'; });
    let cap = null;
    window.fetch = function (url, init) { cap = { url: url, init: init }; return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(''); }, json: function () { return Promise.resolve({ text: '答案是A' }); } }); };
    const r = await ns.quizRecover(window.document.body);
    assert('回退JSON: 仍携带 Authorization', !!(cap && cap.init && cap.init.headers && /^Bearer /.test(cap.init.headers['Authorization'])));
    assert('回退JSON: 结果 answer 解析为 A', !!(r && r.answer === 'A'));
  }

  console.log(fail === 0 ? '结论: PASS — endpoint 双通道 + 流式解析' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
