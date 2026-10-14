'use strict';
// 离线执行当前源码：验证停止/重置/换页后的异步隔离与提交结算契约，不访问平台。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const { JSDOM } = require('jsdom');
const src = path.join(__dirname, '../src/chaoxing-force-play');
const quizCode = require('../scripts/source-groups.cjs').readSource(src, 'takeover/engine/quiz.js');
const keysCode = fs.readFileSync(path.join(src, 'takeover/foundation/storage/keys.js'), 'utf8');
const mergeCode = fs.readFileSync(path.join(src, 'takeover/engine/quiz-merge.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let passed = 0;

function load(withCore = true) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://offline.example/course/1' });
  const w = dom.window;
  let seq = 0, epoch = 1, scope = 0, running = true;
  const timers = new Map(), listeners = new Set(), requests = [], network = [];
  const core = {
    canRun: () => running,
    capture: () => ({ epoch, scope }),
    valid: (t) => running && t.epoch === epoch && t.scope === scope,
    invalidateScope: () => { scope++; Array.from(listeners).forEach((fn) => fn('reset')); },
    onCancel: (_scope, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    stop: () => { running = false; epoch++; Array.from(listeners).forEach((fn) => fn('stop')); },
    start: () => { running = true; epoch++; },
  };
  const ctx = vm.createContext({
    window: w, document: w.document, localStorage: w.localStorage, location: w.location,
    CoreState: withCore ? core : undefined, SAFETY: { tripped: false },
    CONFIG: { QUIZ_VISION_ENABLED: true, QUIZ_VISION_OCR: 'endpoint', QUIZ_VISION_TIMEOUT: 60000 },
    CONST: { QUIZ_HANDLED_CAP: 1000, QUIZ_PENDING_CAP: 1000, QUIZ_REVIEW_CAP: 200 },
    EventBus: { emit() {} }, console, dbg() {}, swallow() {},
    safeGet: (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } },
    bestEffort: (fn) => fn(), dsAvailable: () => true, isEffectiveTopFrame: () => true,
    _pqQueryAll: (root, sels) => Array.from(root.querySelectorAll(Array.isArray(sels) ? sels.join(',') : sels)),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id), setInterval: () => ++seq, clearInterval: (id) => timers.delete(id),
    quizRecover: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    fetchWithTimeout: (_url, init) => new Promise((resolve, reject) => network.push({ resolve, reject, signal: init.signal })),
    Event: w.Event, URL: w.URL, AbortController: w.AbortController, MutationObserver: undefined,
  });
  w.__CX_FORCE_PLAY = { CoreState: withCore ? core : undefined };
  vm.runInContext(keysCode + '\n' + mergeCode + '\n' + quizCode, ctx);
  return { dom, w, ctx, ns: w.__CX_FORCE_PLAY, timers, requests, network, core,
    runTimer: (id) => { const t = timers.get(id); timers.delete(id); if (t) t.fn(); }, close: () => dom.window.close() };
}
function question(env, title = '1. 生命周期题') {
  const q = env.w.document.createElement('div');
  q.className = 'question-item';
  q.innerHTML = '<div class="stem">' + title + '</div><label class="option-item">A 甲<input type="radio" name="q"></label><label class="option-item">B 乙<input type="radio" name="q"></label><button class="submit-btn">提交</button>';
  let clicks = 0, submits = 0;
  const opts = Array.from(q.querySelectorAll('.option-item'));
  opts.forEach((el) => el.addEventListener('click', () => clicks++));
  q.querySelector('button').addEventListener('click', () => submits++);
  env.w.document.body.appendChild(q);
  return { q, opts, get clicks() { return clicks; }, get submits() { return submits; } };
}
function vision(env, q) {
  const fp = env.ctx._quizFingerprint(q.q, env.ctx.QUIZ);
  env.ctx._quizHandled[fp] = true;
  env.ctx._quizVisionAnswer(q.q, q.opts, env.ctx.QUIZ, q.q.querySelector('.stem').textContent, fp);
  return fp;
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }

(async () => {
  await test('停止并恢复后，旧视觉成功/失败都不能点选或提交', async () => {
    for (const result of ['resolve', 'reject']) {
      const e = load(), q = question(e); vision(e, q); e.core.stop(); e.core.start();
      e.requests[0][result](result === 'resolve' ? { answer: 0 } : new Error('stale failure'));
      await flush(); assert.equal(q.clicks, 0); assert.equal(q.submits, 0); assert.equal(e.timers.size, 0); e.close();
    }
  });
  await test('重置后同题重发，新请求只采纳自己的答案和看门狗', async () => {
    const e = load(), q = question(e); const fp = vision(e, q); e.ns.quizHardReset('test'); vision(e, q);
    const id = e.ctx._quizVisTimers[fp]; e.requests[0].resolve({ answer: 0 }); await flush();
    assert.equal(q.clicks, 0); assert.equal(e.ctx._quizVisTimers[fp], id); assert.equal(e.timers.has(id), true);
    e.requests[1].resolve({ answer: 1 }); await flush(); assert(q.clicks > 0); assert.equal(q.submits, 1); e.close();
  });
  await test('同题新代际替换旧请求，旧失败不清新timer、不触发随机提交', async () => {
    const e = load(), q = question(e); const fp = vision(e, q); vision(e, q); const id = e.ctx._quizVisTimers[fp];
    e.requests[0].reject(new Error('old failed')); await flush(); assert.equal(q.clicks, 0); assert.equal(e.timers.has(id), true); e.close();
  });
  for (const gate of ['quiz-auto', 'auto-start', 'safety', 'unload', 'detached']) {
    await test('在途视觉遇到门禁 ' + gate + ' 后没有作答副作用', async () => {
      const e = load(), q = question(e); vision(e, q);
      if (gate === 'quiz-auto') e.w.localStorage.setItem('cx_quiz_auto', '0');
      if (gate === 'auto-start') e.w.localStorage.setItem('cx_quiz_auto_start', '0');
      if (gate === 'safety') e.ctx.SAFETY.tripped = true;
      if (gate === 'unload') e.ns.quizDisconnect();
      if (gate === 'detached') q.q.remove();
      e.requests[0].resolve({ answer: 0 }); await flush(); assert.equal(q.clicks, 0); assert.equal(q.submits, 0); e.close();
    });
  }
  await test('缺少CoreState的单模块执行仍尊重SAFETY', async () => {
    const e = load(false), q = question(e); vision(e, q); e.ctx.SAFETY.tripped = true;
    e.requests[0].resolve({ answer: 0 }); await flush(); assert.equal(q.submits, 0); e.close();
  });
  for (const key of ['cx_quiz_auto', 'cx_quiz_auto_start']) {
    await test(key + '关闭再重开后的旧回传永远失效，新请求正常结算', async () => {
      const e = load(), q = question(e); vision(e, q);
      e.w.localStorage.setItem(key, '0'); e.ns.quizSyncGate();
      e.w.localStorage.setItem(key, '1'); e.ns.quizSyncGate();
      e.requests[0].resolve({ answer: 0 }); await flush(); assert.equal(q.clicks, 0); assert.equal(q.submits, 0);
      assert.equal(e.requests.length, 2); e.requests[1].resolve({ answer: 1 }); await flush(); assert.equal(q.submits, 1); e.close();
    });
  }
  await test('停止时待答重扫和MO防抖立即取消，不留下空转timer', async () => {
    const e = load(); e.ctx._quizRetryTimer = 42; e.ctx._quizMOTimer = 43; e.ctx._quizMOBusy = true;
    e.timers.set(42, { fn() {}, ms: 2000 }); e.timers.set(43, { fn() {}, ms: 800 }); e.core.stop();
    assert.equal(e.timers.size, 0); assert.equal(e.ctx._quizRetryTimer, null); assert.equal(e.ctx._quizMOTimer, null); assert.equal(e.ctx._quizMOBusy, false);
    e.ctx._quizMOHandle([{ target: e.w.document.body, addedNodes: [] }]); assert.equal(e.timers.size, 0); e.close();
  });
  await test('文本AI在停止/恢复和重置后不能回写题库或复活命名空间', async () => {
    const e = load(); e.ctx.CONFIG.QUIZ_AI_ENDPOINT = 'https://offline.example/ai'; e.w.localStorage.setItem('cx_quiz_offline', '0');
    e.ctx.CONFIG.QUIZ_ENDPOINT_WHITELIST = ['offline.example'];
    e.ctx._quizAskAI('stale stem', [], 'fp-text'); e.core.stop(); e.core.start();
    assert.equal(e.network[0].signal.aborted, true);
    e.network[0].resolve({ ok: true, json: () => Promise.resolve({ index: 0 }) }); await flush(); assert.equal(e.ns.quizBank, undefined);
    e.ctx._quizAskAI('new stem', [], 'fp-text'); e.ns.quizHardReset('test'); delete e.w.__CX_FORCE_PLAY;
    e.network[1].resolve({ ok: true, json: () => Promise.resolve({ answer: 'A' }) }); await flush(); assert.equal(e.w.__CX_FORCE_PLAY, undefined); e.close();
  });
  await test('已提交结果页重复tick不双计数、不产生负remaining', async () => {
    const e = load(), q = question(e); const r = e.w.document.createElement('div'); r.className = 'markResult'; e.w.document.body.appendChild(r);
    for (let i = 0; i < 3; i++) { e.ns.quizTick(); assert.equal(e.ns.quizStats.done, 1); assert.equal(e.ns.quizStats.remaining, 0); assert.equal(e.ns.quizStats.doneAll, true); }
    assert.equal(q.submits, 0); e.close();
  });
  await test('待确认题始终未结算，确认提交后立即结算', async () => {
    const e = load(), q = question(e); e.w.localStorage.setItem('cx_quiz_autosubmit', '0'); e.ctx.CONFIG.QUIZ_VISION_ENABLED = false;
    e.ns.quizTick(); e.ns.quizTick(); assert.equal(e.ns.quizStats.remaining, 1); assert.equal(e.ns.quizStats.pendingSubmit, 1); assert.equal(e.ns.quizStats.doneAll, false); assert.equal(q.submits, 0);
    assert.equal(e.ns.quizSubmitPending(), 1); assert.equal(e.ns.quizStats.remaining, 0); assert.equal(e.ns.quizStats.doneAll, true); e.close();
  });
  await test('仅保存/暂存/草稿入口绝不点击、结算或显示绿灯', async () => {
    for (const css of ['save-btn', 'submit-btn']) {
      const e = load(), q = question(e); e.ctx.CONFIG.QUIZ_VISION_ENABLED = false;
      const button = q.q.querySelector('button'); button.className = css; button.textContent = '暂存草稿';
      e.ns.quizTick(); e.ns.quizTick(); assert.equal(q.submits, 0); assert.equal(e.ns.quizStats.done, 0);
      assert.equal(e.ns.quizStats.remaining, 1); assert.equal(e.ns.quizStats.doneAll, false);
      assert.equal(e.ns.quizLights[0].state, 'busy'); assert.equal(e.ns.quizSubmitPending(), 0); assert.equal(q.submits, 0); e.close();
    }
  });
  await test('视觉占坑仍remaining=1，回传提交后才doneAll', async () => {
    const e = load(), q = question(e); e.ns.quizTick(); e.ns.quizTick(); assert.equal(e.ns.quizStats.pendingAI, 1); assert.equal(e.ns.quizStats.remaining, 1); assert.equal(e.ns.quizStats.doneAll, false);
    e.requests[0].resolve({ answer: 0 }); await flush(); assert.equal(q.submits, 1); assert.equal(e.ns.quizStats.remaining, 0); assert.equal(e.ns.quizStats.doneAll, true); e.close();
  });
  for (const mode of ['text', 'vision']) {
    await test(mode + '低置信候选必须先复核再确认，自动提交开着也不抢提交', async () => {
      const e = load(), q = question(e);
      if (mode === 'text') e.ctx._quizResolveAnswer = () => ({ idx: 0, confidence: 0.3, source: 'ai' });
      e.ns.quizTick();
      if (mode === 'vision') { e.requests[0].resolve({ answer: 0, visionConf: 'low' }); await flush(); }
      assert.equal(q.submits, 0); assert.equal(e.ns.quizStats.reviewCount, 1); assert.equal(e.ns.quizStats.pendingSubmit, 1); assert.equal(e.ns.quizStats.remaining, 1);
      assert.equal(e.ns.quizSubmitPending(), 0); const item = e.ns.quizReviewList()[0]; assert.equal(e.ns.quizReviewAccept(item.fp, 1), true);
      assert.equal(q.submits, 0); assert.equal(e.ns.quizSubmitPending(), 1); assert.equal(e.ns.quizStats.doneAll, true); e.close();
    });
  }
  await test('确认弹窗补点定时器在停止后作废', async () => {
    const e = load(), q = question(e); e.ctx.CONFIG.QUIZ_VISION_ENABLED = false; e.ns.quizTick();
    let calls = 0; e.ctx._quizConfirmDialog = () => calls++; const timer = Array.from(e.timers.keys())[0]; e.core.stop(); e.runTimer(timer); assert.equal(calls, 0); e.close();
  });
  await test('待确认弹窗不会在后续tick被删除而提前丢失任务', async () => {
    const e = load(), q = question(e); e.w.localStorage.setItem('cx_quiz_autosubmit', '0'); e.ctx.CONFIG.QUIZ_VISION_ENABLED = false;
    const box = e.w.document.createElement('div'); box.className = 'dialog'; e.w.document.body.appendChild(box); box.appendChild(q.q);
    e.ns.quizTick(); e.ns.quizTick(); assert.equal(q.q.isConnected, true); assert.equal(e.ns.quizStats.remaining, 1); assert.equal(e.ns.quizStats.doneAll, false); e.close();
  });
  await test('硬重置保留用户配置且新会话请求ID单调递增', async () => {
    const e = load(), q = question(e); e.w.localStorage.setItem('cx_quiz_autosubmit', '0'); vision(e, q); const before = e.ctx._quizRequestSeq;
    e.ns.quizHardReset('test'); vision(e, q); assert(e.ctx._quizRequestSeq > before); assert.equal(e.w.localStorage.getItem('cx_quiz_autosubmit'), '0'); e.close();
  });
  console.log(passed + ' PASS / 0 FAIL');
})().catch((err) => { console.error(err); process.exitCode = 1; });
