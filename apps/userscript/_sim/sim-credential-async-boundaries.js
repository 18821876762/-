'use strict';
// 整份真实源码/产物 + 面板事件；仅注入函数 seam，不公开私有凭据，所有网络/GM/剪贴板均为合成替身。
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const artifact = process.env.CX_SIM_USE_SOURCE === '1'
  ? require('../scripts/source-groups.cjs').analyzeSources(path.join(__dirname, '../src/chaoxing-force-play')).code
  : fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
const code = artifact.replace(/\}\)\(\);\s*$/, 'window.__ASYNC_TEST = { vision: _quizVisionAnswer, quiz: QUIZ, ask: quizVisionAsk, fetch: fetchWithTimeout };})();');
if (code === artifact) throw new Error('完整产物末尾未匹配，测试 seam 未注入');
const PRIVATE = 'cx_private_vision_api_key_v1', KEY = 'synthetic-async-boundary-credential';
const EP = 'https://registered.example/v1/chat/completions', ORIGIN = 'https://registered.example';
const RECORD = { key: KEY, origin: ORIGIN };
let checked = 0, failed = 0;
function check(label, pass) { checked++; if (!pass) failed++; console.log((pass ? 'PASS ' : 'FAIL ') + label); }
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
async function settle() { await wait(); await wait(); }
async function load(delayed = false) {
  const virtual = new VirtualConsole(), logs = [], store = new Map([[PRIVATE, RECORD]]);
  for (const level of ['log', 'warn', 'error', 'info', 'debug']) virtual.on(level, (...args) => logs.push(args.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.pmphmooc.com/course/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: virtual
  });
  const w = dom.window; let release, copied = null;
  const ready = delayed ? new Promise(resolve => { release = resolve; }) : Promise.resolve(RECORD);
  w.GM_getValue = (name, fallback) => name === PRIVATE ? ready : (store.has(name) ? store.get(name) : fallback);
  w.GM_setValue = (name, value) => store.set(name, value);
  try { Object.defineProperty(w.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (_) {}
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
  w.fetch = async () => { throw new Error('Unexpected synthetic network call'); };
  new w.Function(code).call(w);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await wait();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'p', bubbles: true })); await wait();
  const ns = w.__CX_FORCE_PLAY;
  Object.assign(ns.CONFIG, { QUIZ_VISION_USE_API_KEY: true, QUIZ_VISION_OCR: 'endpoint',
    QUIZ_VISION_ENDPOINT: EP, QUIZ_VISION_ENDPOINT_ALLOW: 'registered.example', QUIZ_STRICT_AI: true });
  ns.setQuizSnapshotOverride(() => 'data:image/png;base64,SYNTHETIC');
  return { w, ns, logs, copied: () => copied, release: () => release && release(RECORD),
    close: () => { try { ns.uninstall(); } catch (_) {} w.close(); } };
}
function question(ctx) {
  const q = ctx.w.document.createElement('div');
  // 与自动扫描的 questionSels 隔离：测试只发一次真实视觉请求，恢复时不会额外产生合法新请求。
  q.className = 'async-probe-container';
  q.innerHTML = '<div class="stem">1. 合成异步题</div><label class="option-item">A 甲<input type="radio" name="q"></label><label class="option-item">B 乙<input type="radio" name="q"></label><button class="submit-btn">提交</button>';
  const opts = Array.from(q.querySelectorAll('.option-item')); let clicks = 0, submits = 0;
  opts.forEach(el => el.addEventListener('click', () => clicks++));
  q.querySelector('button').addEventListener('click', () => submits++);
  ctx.w.document.body.append(q);
  return { q, opts, clicks: () => clicks, submits: () => submits };
}
function network(ctx, pending = false) {
  const calls = [];
  ctx.w.fetch = (url, init) => {
    const call = { url, init, aborted: false }; calls.push(call);
    const response = { ok: true, status: 200, json: async () => ({ text: '答案:A', answer: 0 }) };
    if (!pending) return Promise.resolve(response);
    return new Promise((resolve, reject) => {
      call.resolve = () => resolve(response);
      if (init.signal) init.signal.addEventListener('abort', () => {
        call.aborted = true; reject(new ctx.w.DOMException('synthetic cancellation', 'AbortError'));
      }, { once: true });
    });
  };
  return calls;
}
function invalidate(ctx, mode, q) {
  if (mode === 'disable') { ctx.ns.CONFIG.ENABLED = false; ctx.ns.CoreState.state(); }
  if (mode === 'uninstall') ctx.ns.uninstall();
  if (mode === 'restart') {
    ctx.ns.CONFIG.ENABLED = false; ctx.ns.CoreState.state();
    ctx.ns.CONFIG.ENABLED = true; ctx.ns.CoreState.state();
  }
  if (mode === 'url') ctx.w.history.pushState({}, '', '/course/changed');
  if (mode === 'owner') ctx.w.__CX_FORCE_PLAY = { replacement: true };
  if (mode === 'detached') q.q.remove();
}
function invoke(ctx, kind, q, context) {
  if (kind === 'vision') {
    ctx.w.__ASYNC_TEST.vision(q.q, q.opts, ctx.w.__ASYNC_TEST.quiz, '1. 合成异步题', 'synthetic-async-fp');
    return null;
  }
  if (kind === 'recover') return ctx.ns.quizRecover(q.q, context);
  if (kind === 'direct') return ctx.w.__ASYNC_TEST.ask('data:image/png;base64,SYNTHETIC', '合成题', context);
  return ctx.ns.reverseApiHandle({ v: 1, id: 'synthetic-async-id', method: 'answer', auth: KEY,
    params: { image: 'data:image/png;base64,SYNTHETIC', question: '合成题' } });
}
function observe(promise) {
  const state = { settled: false, value: null, error: null };
  if (promise) Promise.resolve(promise).then(value => { state.settled = true; state.value = value; },
    error => { state.settled = true; state.error = error; });
  return state;
}
async function panelBoundaries() {
  const ctx = await load();
  try {
    const tainted = { cx_notes: KEY, cx_prefixed_note: 'before ' + KEY + ' after',
      cx_nested_note: JSON.stringify({ note: KEY }), cx_nested_array: JSON.stringify([{ text: ['ordinary', 'prefix:' + KEY] }]) };
    for (const [name, value] of Object.entries(tainted)) ctx.w.localStorage.setItem(name, value);
    ctx.w.localStorage.setItem('cx_ordinary', 'normal');
    ctx.w.document.getElementById('__cxBtnExportCfg').click(); await settle();
    const exported = JSON.parse(ctx.copied() || '{}');
    check('真实导出按当前 Key 内容过滤普通字段、前后缀和嵌套数组',
      !!ctx.copied() && !ctx.copied().includes(KEY) && Object.keys(tainted).every(name => !(name in exported)));
    check('过滤内容不影响普通配置导出', exported.cx_ordinary === 'normal');
    for (const [name, value] of Object.entries(tainted)) {
      ctx.w.localStorage.removeItem(name);
      ctx.w.prompt = () => JSON.stringify({ [name]: value, cx_atomic_write: 'should-not-write' });
      ctx.w.document.getElementById('__cxBtnImportCfg').click(); await settle();
      check('真实导入拒绝含当前 Key 的普通字段且原子拒绝 ' + name,
        ctx.w.localStorage.getItem(name) === null && ctx.w.localStorage.getItem('cx_atomic_write') === null);
    }
    ctx.w.prompt = () => JSON.stringify({ cx_valid_import: 'normal', cx_valid_nested: JSON.stringify({ note: ['normal'] }) });
    ctx.w.document.getElementById('__cxBtnImportCfg').click(); await settle();
    check('真实导入仍接受普通字符串和嵌套数组', ctx.w.localStorage.getItem('cx_valid_import') === 'normal'
      && ctx.w.localStorage.getItem('cx_valid_nested') === JSON.stringify({ note: ['normal'] }));
    check('面板处理期间 console 与公开 CONFIG 不包含 Key', !ctx.logs.some(line => line.includes(KEY))
      && !JSON.stringify(ctx.ns.CONFIG).includes(KEY) && !ctx.ns.quizCredentialStore);
  } finally { ctx.close(); }
  for (const action of ['export', 'import']) {
    const delayed = await load(true);
    try {
      delayed.w.localStorage.setItem('cx_notes', KEY);
      if (action === 'import') {
        delayed.w.localStorage.removeItem('cx_notes');
        delayed.w.prompt = () => JSON.stringify({ cx_notes: KEY, cx_atomic_write: 'should-not-write' });
      }
      delayed.w.document.getElementById(action === 'export' ? '__cxBtnExportCfg' : '__cxBtnImportCfg').click(); await settle();
      check(action + ' 在私有 GM 读取完成之前不导出或写入', action === 'export' ? delayed.copied() === null
        : delayed.w.localStorage.getItem('cx_notes') === null && delayed.w.localStorage.getItem('cx_atomic_write') === null);
      delayed.release(); await settle();
      check(action + ' 在 GM 晚到后仍过滤真实 Key 内容', action === 'export'
        ? !!delayed.copied() && !delayed.copied().includes(KEY)
        : delayed.w.localStorage.getItem('cx_notes') === null && delayed.w.localStorage.getItem('cx_atomic_write') === null);
      check(action + ' 延期 GM 不泄露 Key 到 console', !delayed.logs.some(line => line.includes(KEY)));
    } finally { delayed.close(); }
  }
}
async function delayedBoundaries() {
  for (const kind of ['vision', 'recover', 'direct', 'reverse']) {
    const modes = ['disable', 'uninstall', 'restart', 'url', 'owner'];
    if (kind === 'vision' || kind === 'recover') modes.push('detached');
    for (const mode of modes) {
      const ctx = await load(true);
      try {
        // 外部 valid=true 只能附加约束，不能绕过内部 CoreState、owner 和 URL 捕获。
        const q = question(ctx), calls = network(ctx), state = observe(invoke(ctx, kind, q, { valid: () => true }));
        await settle(); check(kind + '/' + mode + ' GM 未 ready 时没有网络请求', calls.length === 0);
        invalidate(ctx, mode, q); ctx.release(); await settle();
        check(kind + '/' + mode + ' 取消或上下文变化后 GM 晚到不得发送旧请求', calls.length === 0);
        check(kind + '/' + mode + ' 旧任务不点选、不提交、不回传成功结果', q.clicks() === 0 && q.submits() === 0
          && (kind === 'vision' || state.error || (state.value && state.value.ok === false)));
        check(kind + '/' + mode + ' 异常和日志不包含 Key', !ctx.logs.some(line => line.includes(KEY))
          && !String(state.error || '').includes(KEY) && !JSON.stringify(state.value || {}).includes(KEY));
        if (mode === 'restart') {
          const fresh = observe(invoke(ctx, kind, q)); await settle();
          check(kind + ' 恢复后新 token 请求有效且不复活旧请求', calls.length === 1
            && (kind === 'vision' ? q.clicks() > 0 : fresh.settled && !fresh.error && (kind !== 'reverse' || fresh.value.ok)));
        }
      } finally { ctx.close(); }
    }
  }
  for (const kind of ['recover', 'direct', 'reverse']) {
    const ctx = await load(true);
    try {
      const q = question(ctx), calls = network(ctx), state = observe(invoke(ctx, kind, q));
      await settle(); ctx.release(); await settle();
      check(kind + ' 有效延迟 GM 调用正常完成', calls.length === 1 && state.settled && !state.error
        && (kind !== 'reverse' || state.value.ok === true));
      check(kind + ' 有效请求仍使用私有 Key 且禁止重定向', calls[0] && calls[0].init.headers.Authorization === 'Bearer ' + KEY
        && calls[0].init.redirect === 'error');
    } finally { ctx.close(); }
  }
}
async function abortBoundaries() {
  for (const kind of ['vision', 'recover', 'direct', 'reverse']) {
    const ctx = await load();
    try {
      const q = question(ctx), calls = network(ctx, true); observe(invoke(ctx, kind, q)); await settle();
      check(kind + ' 已发送请求具有 abort signal', calls.length === 1 && !!calls[0].init.signal && !calls[0].init.signal.aborted);
      invalidate(ctx, 'disable', q); await settle();
      check(kind + ' 停用会 abort 已发起的真实请求', calls.length === 1 && calls[0].init.signal.aborted && calls[0].aborted);
      check(kind + ' 已取消网络不触发点选或提交', q.clicks() === 0 && q.submits() === 0);
    } finally { ctx.close(); }
  }
  for (const kind of ['recover', 'direct']) {
    const ctx = await load(true);
    try {
      const q = question(ctx), calls = network(ctx), ac = new ctx.w.AbortController();
      const state = observe(invoke(ctx, kind, q, { signal: ac.signal })); await settle();
      ac.abort(); ctx.release(); await settle();
      check(kind + ' 外部取消在 GM 延迟阶段阻止请求', calls.length === 0 && !!state.error);
    } finally { ctx.close(); }
  }
  const ctx = await load();
  try {
    const calls = network(ctx), ac = new ctx.w.AbortController(); ac.abort();
    const before = observe(ctx.w.__ASYNC_TEST.fetch(EP, { signal: ac.signal }, 60117)); await settle();
    check('fetchWithTimeout 对预先 aborted 的 signal 拒绝且不调用 fetch', calls.length === 0 && !!before.error);
    for (const finish of ['sync-throw', 'resolve', 'reject']) {
      const listeners = new Set(), signal = { aborted: false,
        addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
      const timers = new Set(), nativeSet = ctx.w.setTimeout, nativeClear = ctx.w.clearTimeout;
      ctx.w.setTimeout = (fn, ms) => { const id = nativeSet.call(ctx.w, fn, ms); if (ms === 60117) timers.add(id); return id; };
      ctx.w.clearTimeout = id => { timers.delete(id); return nativeClear.call(ctx.w, id); };
      ctx.w.fetch = () => {
        if (finish === 'sync-throw') throw new Error('synthetic sync failure');
        return finish === 'resolve' ? Promise.resolve({ ok: true }) : Promise.reject(new Error('synthetic async failure'));
      };
      let outcome;
      try { outcome = observe(ctx.w.__ASYNC_TEST.fetch(EP, { signal }, 60117)); }
      catch (error) { outcome = { error, settled: true }; }
      await settle();
      check('fetchWithTimeout ' + finish + ' 清理 caller listener 与 timeout', listeners.size === 0 && timers.size === 0 && outcome.settled);
      ctx.w.setTimeout = nativeSet; ctx.w.clearTimeout = nativeClear;
    }
  } finally { ctx.close(); }
}
(async () => {
  await panelBoundaries(); await delayedBoundaries(); await abortBoundaries();
  console.log('结论: ' + (failed ? 'FAIL' : 'PASS') + ' — 异步凭据边界 ' + checked + ' 项断言');
  process.exit(failed ? 1 : 0);
})().catch(() => { console.log('FAIL 异步凭据回归出现异常（详情抑制，避免打印凭据）'); process.exit(1); });
