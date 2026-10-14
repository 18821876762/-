// sim-ds-ask-retry.js — 审查#C 回归：DeepSeek 跨源中继超时后短期重试一次
// 验证：
//  1) DS 页未开 → 首次 timeout → 重试一次（共 2 次发起）→ 仍 timeout → 最终 reject
//  2) 中途恢复（第二次成功）→ resolve（重试生效，降低暂离错答）
//  3) 明确登录态错误（not-logged-in）→ 不重试，仅 1 次发起即 reject
//  4) context 取消/失效 → 不发送、不续接重试，释放监听且忽略迟到回包；新 context 仍可作答
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

// 直接运行当前源码的完整 DS source-group；不依赖尚未重建的产物，不复制请求实现。
const sourceGroups = require('../scripts/source-groups.cjs');
const src = path.join(__dirname, '../src/chaoxing-force-play');
const group = 'takeover/engine/vision-deepseek-web.js';
const source = sourceGroups.readSource(src, group);

let fail = 0, checks = 0;
function assert(name, cond) {
  checks++;
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

// 用极短超时/延迟，避免测试耗时
const SHORT_TIMEOUT = 200;     // 单次超时
const SHORT_DELAY = 50;        // 重试前等待

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  const asks = [], values = new Map(), gmListeners = new Map();
  window.GM_setValue = function (key, value) { values.set(key, value); if (value) { const m = JSON.parse(value); if (m.type === 'ds-ask') asks.push(m); } };
  window.GM_addValueChangeListener = function (key, cb) { const id = gmListeners.size + 1; gmListeners.set(id, { key, cb }); return id; };
  window.GM_removeValueChangeListener = function (id) { gmListeners.delete(id); };
  window.CONFIG = { QUIZ_VISION_TIMEOUT: SHORT_TIMEOUT };
  window.EventBus = { emit() {} };
  window.bestEffort = function (fn) { return fn(); }; // 隔离测试中同步错误必须显式失败。
  window.safeGet = function (fn, fallback) { try { return fn(); } catch (_) { return fallback; } };
  window.detectSite = function () { return 'chaoxing'; };
  // 仅补 DS 组外的 context 契约，完整检查 signal 与 valid，不绕过校验。
  window._quizVisionCancelled = function () { const e = new Error('视觉请求已取消'); e.name = 'AbortError'; return e; };
  window._quizVisionCheckContext = function (c) { if (c && ((c.signal && c.signal.aborted) || (c.valid && !c.valid()))) throw window._quizVisionCancelled(); };
  window.__CX_FORCE_PLAY = { TimerRegistry: { setTimeout: window.setTimeout.bind(window), setInterval: window.setInterval.bind(window) } };
  const internal = new window.Function(source + '\nreturn { once: _dsAskOnce, listenerCount: function () { return _chanListeners.length; } };')();
  window.__CX_FORCE_PLAY.__setDsAskRetry(SHORT_DELAY, 1);
  window.__CX_FORCE_PLAY.__resetDsAskTryCount();
  return { window, ns: window.__CX_FORCE_PLAY, asks, values, ...internal,
    receive(m) { for (const { key, cb } of gmListeners.values()) if (key === 'cx_ds_bridge_v1') cb(key, null, JSON.stringify(m), true); },
    close() { window.__CX_FORCE_PLAY.quizVisionDeepSeekStop(); window.close(); } };
}

// 合成 GM 远端回包经过真实消息通道；不访问课程站点或 DeepSeek。
function reply(env, reqId, payload) {
  env.receive(Object.assign({ type: 'ds-answer', reqId: reqId, _from: 'offline-responder' }, payload));
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cancelled = (e) => e && e.name === 'AbortError';
function requestContext(window) {
  const controller = new window.AbortController(), active = new Set();
  const signal = controller.signal, add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  let valid = true;
  signal.addEventListener = function (type, fn, ...args) { if (type === 'abort') active.add(fn); return add(type, fn, ...args); };
  signal.removeEventListener = function (type, fn, ...args) { if (type === 'abort') active.delete(fn); return remove(type, fn, ...args); };
  return { context: { signal, valid: () => valid }, abort: () => controller.abort(), invalidate: () => { valid = false; }, listeners: () => active.size };
}

async function main() {
  console.log('离线来源: 当前 DS source-group，片段=' + sourceGroups.groupFiles(src, group).length + '；GM 端口为合成数据');
  // 场景1：DS 页未开（无 responder）→ 两次超时 → 最终 reject，发起次数=2
  {
    const env = loadAt('https://mooc1.chaoxing.com/learn/'), { ns } = env;
    const t0 = Date.now();
    let got = null;
    try { await ns.quizAskDeepSeek('data:image/png;base64,xxx'); } catch (e) { got = e; }
    const dt = Date.now() - t0;
    assert('C超时重试: 最终 reject(deepseek timeout)', got && got.message === 'deepseek timeout');
    assert('C超时重试: 实际发起次数=2(重试一次)', ns.__dsAskTryCount() === 2);
    assert('C超时重试: 耗时≈首次超时+延迟+二次超时', dt >= SHORT_TIMEOUT + SHORT_DELAY + SHORT_TIMEOUT - 250 && dt <= SHORT_TIMEOUT * 2 + SHORT_DELAY + 1500);
    env.close();
  }

  // 场景2：第一次 ds-ask 不回（超时）→ 重试 → 第二次 ds-ask 发出后回成功 → resolve（重试生效，不随机兜底）
  {
    const env = loadAt('https://mooc1.chaoxing.com/learn/'), { ns } = env;
    let res = null, got = null;
    const p = ns.quizAskDeepSeek('data:image/png;base64,xxx', ['A', 'B'], '离线三参数题').then(function (r) { res = r; }, function (e) { got = e; });
    // 首次超时(SHORT_TIMEOUT=200)+重试延迟(SHORT_DELAY=50)后，第二次 ds-ask 已发出；此时取 reqId 并回包
    await new Promise(function (r) { setTimeout(r, SHORT_TIMEOUT + SHORT_DELAY + 60); });
    const rid = ns.__lastDsAskReqId();
    reply(env, rid, { text: '看图作答', answer: 'B' });
    await p;
    assert('C中途恢复: 重试后 resolve(不随机兜底)', res && res.answer === 'B' && !got);
    assert('C中途恢复: 发起次数=2', ns.__dsAskTryCount() === 2);
    assert('C三参数兼容: image/options/prompt 原样发送', env.asks.every((m) => m.image === 'data:image/png;base64,xxx' && m.options.join(',') === 'A,B' && m.prompt === '离线三参数题'));
    env.close();
  }

  // 场景3：明确登录态错误（not-logged-in）→ 不重试，仅 1 次发起即 reject
  {
    const env = loadAt('https://mooc1.chaoxing.com/learn/'), { ns } = env;
    let got = null;
    const p = ns.quizAskDeepSeek('data:image/png;base64,xxx').then(function () {}, function (e) { got = e; });
    await new Promise(function (r) { setTimeout(r, 40); });   // 等首次 ds-ask 发出
    const rid = ns.__lastDsAskReqId();
    reply(env, rid, { error: 'not-logged-in' });
    await p;
    assert('C登录错误: 不重试，立即 reject(not-logged-in)', got && got.message === 'not-logged-in');
    assert('C登录错误: 发起次数=1(未重试)', ns.__dsAskTryCount() === 1);
    env.close();
  }

  // 已取消和已失效 context：同时覆盖公开入口与 _dsAskOnce 的独立前置检查。
  for (const kind of ['abort', 'invalid']) {
    const env = loadAt('https://offline.example/course/'), c = requestContext(env.window), baseline = env.listenerCount();
    if (kind === 'abort') c.abort(); else c.invalidate();
    const errors = await Promise.all([env.once('', [], '离线题', c.context), env.ns.quizAskDeepSeek('', [], '离线题', c.context)].map((p) => p.then(() => null, (e) => e)));
    assert('context ' + kind + ': 两个入口均 reject(AbortError)', errors.every(cancelled));
    assert('context ' + kind + ': 零发送/零发起', env.asks.length === 0 && env.ns.__dsAskTryCount() === 0);
    assert('context ' + kind + ': 未注册请求或 abort listener', env.listenerCount() === baseline && c.listeners() === 0);
    env.close();
  }

  // 等待回包时取消：释放截图与监听，迟到回包不得结算或改写答案/遥测。
  {
    const env = loadAt('https://offline.example/course/'), c = requestContext(env.window), baseline = env.listenerCount();
    let result = null, error = null, settlements = 0;
    const p = env.ns.quizAskDeepSeek('data:image/png;base64,offline', [], '离线题', c.context).then((r) => { result = r; settlements++; }, (e) => { error = e; settlements++; });
    const rid = env.ns.__lastDsAskReqId();
    assert('等待回包: 已发送且请求/abort listener 均注册', env.asks.length === 1 && env.listenerCount() === baseline + 1 && c.listeners() === 1);
    c.abort(); await p;
    assert('等待回包取消: reject(AbortError)且仅结算一次', cancelled(error) && !result && settlements === 1);
    assert('等待回包取消: 请求/abort listener 释放', env.listenerCount() === baseline && c.listeners() === 0);
    assert('等待回包取消: GM 截图载荷释放', env.values.get('cx_ds_ask_v1') === '');
    reply(env, rid, { text: '迟到答案', answer: 'A' }); await wait(SHORT_TIMEOUT + SHORT_DELAY + 30);
    assert('迟到回包: 无答案/遥测写入且不再重试', settlements === 1 && env.ns._dsLoopStats().answersGot === 0 && env.ns._dsLoopStats().roundTrips === 0 && env.ns.DS_LAST_ANSWER === undefined && env.ns.DS_ANSWER_COUNT === undefined && env.asks.length === 1);
    env.close();
  }

  // 超时已进入重试等待：旧 context 取消后不再发送，新 context 可正常请求并独立结算。
  {
    const env = loadAt('https://offline.example/course/'), old = requestContext(env.window), baseline = env.listenerCount();
    env.ns.__setDsAskRetry(200, 1);
    let error = null, freshResult = null;
    const pending = env.ns.quizAskDeepSeek('', [], '旧离线题', old.context).then(() => null, (e) => { error = e; });
    const oldId = env.ns.__lastDsAskReqId();
    await wait(SHORT_TIMEOUT + 20);
    assert('超时重试等待: 首次已超时且重试待发', env.ns._dsLoopStats().retries === 1 && env.asks.length === 1 && env.listenerCount() === baseline && old.listeners() === 0);
    old.abort();
    const fresh = requestContext(env.window);
    const next = env.ns.quizAskDeepSeek('', ['A', 'B'], '新离线题', fresh.context).then((r) => { freshResult = r; });
    const newId = env.ns.__lastDsAskReqId();
    reply(env, oldId, { answer: 'A' }); await Promise.resolve();
    assert('旧迟到回包: 不结算新 context', newId !== oldId && freshResult === null && env.ns._dsLoopStats().answersGot === 0);
    reply(env, newId, { answer: 'B' }); await next; await pending;
    assert('重试等待取消: reject(AbortError)，旧请求不再发送', cancelled(error) && env.asks.length === 2 && env.ns.__dsAskTryCount() === 2);
    assert('新 context: 合法请求仍 resolve 自身答案', freshResult && freshResult.answer === 'B' && env.ns._dsLoopStats().answersGot === 1 && env.ns.DS_ANSWER_COUNT === 1);
    assert('新旧请求结算: 请求与 abort listener 全部释放', env.listenerCount() === baseline && old.listeners() === 0 && fresh.listeners() === 0);
    env.close();
  }

  // 没有 signal.abort 事件时仍尊重 valid：分别覆盖回包检查和 catch 中的检查。
  for (const phase of ['reply', 'catch']) {
    const env = loadAt('https://offline.example/course/'), c = requestContext(env.window), baseline = env.listenerCount();
    let error = null;
    const pending = env.ns.quizAskDeepSeek('', [], '离线失效题', c.context).then(() => null, (e) => { error = e; });
    const rid = env.ns.__lastDsAskReqId();
    if (phase === 'reply') c.invalidate();
    reply(env, rid, phase === 'reply' ? { answer: 'A' } : { error: 'timeout-wait-reply' });
    if (phase === 'catch') c.invalidate(); // reject 后、重试 catch 的微任务运行前失效。
    await pending;
    assert('valid 失效 ' + phase + ': reject(AbortError)，无重试发送', cancelled(error) && env.asks.length === 1 && env.ns._dsLoopStats().retries === 0);
    assert('valid 失效 ' + phase + ': listener 释放且没有成功答案写入', env.listenerCount() === baseline && c.listeners() === 0 && env.ns.DS_LAST_ANSWER !== 'A');
    env.close();
  }

  console.log('断言: ' + (checks - fail) + ' PASS / ' + fail + ' FAIL（共 ' + checks + '）');
  console.log(fail === 0 ? '结论: PASS — 离线 DS 超时重试与 context 取消闭环；不代表真实站点验收' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
