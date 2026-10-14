'use strict';
// 实际完整脚本 + 真实面板事件；GM/网络/剪贴板均为本地合成替身。
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const artifact = process.env.CX_SIM_USE_SOURCE === '1'
  ? require('../scripts/source-groups.cjs').analyzeSources(path.join(__dirname, '../src/chaoxing-force-play')).code
  : fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
const PRIVATE = 'cx_private_vision_api_key_v1', LEGACY = 'cx_quiz_vision_api_key';
const KEY = 'synthetic-credential-never-real';
const EP = 'https://registered.example/v1/chat/completions', ORIGIN = 'https://registered.example';
let checked = 0, failed = 0;
function check(label, pass) { checked++; if (!pass) failed++; console.log((pass ? 'PASS ' : 'FAIL ') + label); }
const wait = () => new Promise(resolve => setTimeout(resolve, 35));
async function load(options = {}) {
  const store = options.store || new Map(), logs = [], virtual = new VirtualConsole();
  virtual.on('log', (...values) => logs.push(values.map(String).join(' ')));
  virtual.on('warn', (...values) => logs.push(values.map(String).join(' ')));
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.pmphmooc.com/course/1', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: virtual
  });
  const w = dom.window;
  try { Object.defineProperty(w.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (_) {}
  if (options.legacy) w.localStorage.setItem(LEGACY, options.legacy);
  const read = (name, fallback) => {
    if (options.readFail && name === PRIVATE) throw new Error(KEY);
    return store.has(name) ? store.get(name) : fallback;
  };
  const write = (name, value) => {
    if (options.writeFail) throw new Error(KEY);
    if (options.deferWrite && name === PRIVATE) return options.deferWrite(() => store.set(name, value), value);
    store.set(name, value);
  };
  if (options.mode === 'async') w.GM = { getValue: async (...args) => read(...args), setValue: async (...args) => write(...args) };
  else if (options.mode !== 'none') { w.GM_getValue = read; w.GM_setValue = write; }
  if (options.deferRead) {
    let resolve;
    const pending = new Promise(r => { resolve = r; });
    options.deferRead(resolve);
    w.GM_getValue = (name, fallback) => name === PRIVATE ? pending : read(name, fallback);
  }
  let copied = null;
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
  w.fetch = async () => { throw new Error('Unexpected synthetic network call'); };
  new w.Function(artifact).call(w);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await wait();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  await wait();
  return { w, ns: w.__CX_FORCE_PLAY, store, logs, copied: () => copied,
    close: () => { try { w.__CX_FORCE_PLAY.uninstall(); } catch (_) {} w.close(); } };
}
function input(ctx, value) {
  const el = ctx.w.document.getElementById('__cxQuizApiKey');
  check('实际密码输入框存在', !!el && el.type === 'password');
  if (!el) return;
  el.value = value; el.dispatchEvent(new ctx.w.Event('change', { bubbles: true }));
  check('保存后立即清空输入', el.value === '');
}
function endpointInput(ctx, endpoint = EP, allow = 'registered.example') {
  const el = ctx.w.document.getElementById('__cxQuizApiEndpoint');
  check('实际端点输入框存在', !!el && el.type === 'url');
  if (el) { el.value = endpoint; el.dispatchEvent(new ctx.w.Event('change', { bubbles: true })); }
  ctx.ns.CONFIG.QUIZ_VISION_ENDPOINT_ALLOW = allow;
}
function recordIs(ctx, key = KEY, origin = ORIGIN) {
  const value = ctx.store.get(PRIVATE);
  return value && value.key === key && value.origin === origin;
}
async function request(ctx, endpoint = EP, allow = 'registered.example') {
  Object.assign(ctx.ns.CONFIG, { QUIZ_VISION_USE_API_KEY: true, QUIZ_VISION_OCR: 'endpoint',
    QUIZ_VISION_ENDPOINT: endpoint, QUIZ_VISION_ENDPOINT_ALLOW: allow });
  ctx.ns.setQuizSnapshotOverride(() => 'data:image/png;base64,SYNTHETIC');
  let captured = null;
  ctx.w.fetch = async (url, init) => { captured = { url, init }; return { ok: true, status: 200,
    json: async () => ({ text: '答案:A' }) }; };
  let error = null;
  try { await ctx.ns.quizRecover(ctx.w.document.body); } catch (e) { error = e; }
  return { captured, error };
}
async function main() {
  for (const mode of ['sync', 'async', 'none']) {
    const ctx = await load({ mode, legacy: KEY });
    try {
      check(mode + '：旧网页 Key 已删除', ctx.w.localStorage.getItem(LEGACY) === null);
      check(mode + '：公开 CONFIG 不含 Key', ctx.ns.CONFIG.QUIZ_VISION_API_KEY === '' && !JSON.stringify(ctx.ns.CONFIG).includes(KEY));
      check(mode + '：私有能力未挂到 namespace', !ctx.ns.quizCredentialStore && !ctx.ns.getApiKey);
      check(mode + '：密码框不回显', ctx.w.document.getElementById('__cxQuizApiKey').value === '');
      check(mode + '：迁移值不自动信任公开端点', mode === 'none' ? !ctx.store.has(PRIVATE) : recordIs(ctx, KEY, ''));
      const untrusted = await request(ctx);
      check(mode + '：旧 LS Key 未授权时实际请求被阻止', !!untrusted.error && !untrusted.captured);
      check(mode + '：旧凭据明确提示重新授权', /尚未授权接口/.test(ctx.w.document.getElementById('__cxQuizApiKeyStatus').textContent));
      endpointInput(ctx); input(ctx, KEY); await wait();
      const result = await request(ctx);
      check(mode + '：实际请求携带闭包 Key', result.captured && result.captured.init.headers.Authorization === 'Bearer ' + KEY);
      check(mode + '：凭据请求禁止重定向', result.captured && result.captured.init.redirect === 'error');
      check(mode + '：日志未含凭据', !ctx.logs.some(line => line.includes(KEY)));
      if (mode === 'none') check('无 GM 时明确提示会话有效期', /仅当前页面有效/.test(ctx.w.document.getElementById('__cxQuizApiKeyStatus').textContent));
      const reload = await load({ mode, store: ctx.store });
      try {
        const result2 = await request(reload);
        check(mode + '：重启读取绑定或内存失效正确', mode === 'none' ? !!result2.error && !result2.captured : !!result2.captured && recordIs(reload));
      } finally { reload.close(); }
    } finally { ctx.close(); }
  }
  const ctx = await load({ mode: 'sync' });
  try {
    endpointInput(ctx);
    input(ctx, KEY); await wait();
    check('输入通过 GM 私有持久化 Key 与 Origin', recordIs(ctx) && ctx.w.localStorage.getItem(LEGACY) === null);
    ctx.ns.CONFIG.QUIZ_VISION_API_KEY = KEY;
    check('公开 CONFIG 赋值不保存凭据', ctx.ns.CONFIG.QUIZ_VISION_API_KEY === '');
    ctx.w.localStorage.setItem('cx_ordinary', 'normal');
    ctx.w.localStorage.setItem('cx_access_token', KEY);
    ctx.w.localStorage.setItem('cx_password', KEY);
    ctx.w.localStorage.setItem('cx_nested', JSON.stringify({ accessToken: KEY }));
    ctx.w.document.getElementById('__cxBtnExportCfg').click(); await wait();
    check('实际导出保留普通配置', JSON.parse(ctx.copied()).cx_ordinary === 'normal');
    check('实际导出剔除凭据与嵌套凭据', !ctx.copied().includes(KEY) && !ctx.logs.some(line => line.includes(KEY)));
    const badImports = [{ [LEGACY]: KEY, cx_new: 'bad' }, { cx_accessToken: KEY, cx_new: 'bad' },
      { cx_nested: JSON.stringify({ password: KEY }), cx_new: 'bad' }];
    for (const value of badImports) {
      ctx.w.prompt = () => JSON.stringify(value);
      ctx.w.document.getElementById('__cxBtnImportCfg').click();
      check('实际导入拒绝凭据且不部分写入', ctx.w.localStorage.getItem('cx_new') === null && ctx.w.localStorage.getItem(LEGACY) === null);
    }
    ctx.w.prompt = () => JSON.stringify({ cx_new: 'good' });
    ctx.w.document.getElementById('__cxBtnImportCfg').click();
    check('普通配置仍能实际导入', ctx.w.localStorage.getItem('cx_new') === 'good');
    for (const endpoint of ['https://unregistered.example/rpc', 'http://registered.example/rpc', 'https://user:password@registered.example/rpc']) {
      const result = await request(ctx, endpoint);
      check('未登记/明文/URL 凭据端点阻止发送 Key', !!result.error && !result.captured);
    }
    ctx.w.localStorage.setItem('cx_quiz_vision_endpoint', 'https://attacker.example/rpc');
    ctx.w.localStorage.setItem('cx_quiz_vision_allow', 'attacker.example');
    const hijacked = await request(ctx, 'https://attacker.example/rpc', 'attacker.example');
    check('网页修改 CONFIG 与 LS 白名单仍不能把已有 Key 发送到恶意 Origin', !!hijacked.error && !hijacked.captured && recordIs(ctx));
    check('公开 namespace 不提供凭据授权 setter', !ctx.ns.saveCredential && !ctx.ns.authorizeOrigin && !ctx.ns.quizCredentialStore);
    const changedPort = await request(ctx, 'https://registered.example:8443/rpc');
    check('同主机不同端口必须重新授权', !!changedPort.error && !changedPort.captured && recordIs(ctx));
    const sameOrigin = await request(ctx, 'https://registered.example/another/path');
    check('相同 Origin 不同路径仍能实际请求', !!sameOrigin.captured);
    const result = await request(ctx);
    check('私有 Key 请求仍通过白名单端点', !!result.captured);
    ctx.w.fetch = async () => ({ ok: false, status: 401, text: async () => KEY });
    let rejected = null;
    try { await ctx.ns.quizRecover(ctx.w.document.body); } catch (error) { rejected = error; }
    check('HTTP 错误不回显服务端可能反射的 Key', rejected && !String(rejected).includes(KEY));
    ctx.w.fetch = () => { throw new Error(KEY); };
    rejected = null;
    try { await ctx.ns.quizRecover(ctx.w.document.body); } catch (error) { rejected = error; }
    check('同步网络异常不回显 Key', rejected && !String(rejected).includes(KEY));
    ctx.w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ text: '答案:A ' + KEY }) });
    const echoed = await ctx.ns.quizRecover(ctx.w.document.body);
    check('成功响应反射 Key 时返回结果遮盖', echoed && !JSON.stringify(echoed).includes(KEY));
    ctx.w.document.getElementById('__cxBtnResetCfg').click(); await wait();
    check('恢复默认关闭 Key 通道并清空私有凭据', ctx.store.get(PRIVATE) === '' && ctx.ns.CONFIG.QUIZ_VISION_USE_API_KEY === false);
    input(ctx, KEY); await wait(); input(ctx, ''); await wait();
    check('输入空值清理私有凭据', ctx.store.get(PRIVATE) === '');
    input(ctx, KEY); await wait();
    ctx.w.document.getElementById('__cxQuizClearApiKey').click(); await wait();
    check('实际清除按钮清理私有凭据', ctx.store.get(PRIVATE) === '');
    check('清除按钮同时删除 Origin 授权', !!(await request(ctx)).error);
  } finally { ctx.close(); }
  const failedWrite = await load({ mode: 'sync', writeFail: true, legacy: KEY });
  try {
    check('GM 写失败仍删除旧网页 Key', failedWrite.w.localStorage.getItem(LEGACY) === null);
    check('GM 写失败提示仅当前页面有效', /仅当前页面有效/.test(failedWrite.w.document.getElementById('__cxQuizApiKeyStatus').textContent));
    check('GM 写失败旧迁移凭据仍不得自动授权', !!(await request(failedWrite)).error);
    endpointInput(failedWrite); input(failedWrite, KEY); await wait();
    check('GM 写失败重新授权后当前会话仍可用', !!(await request(failedWrite)).captured);
    check('GM 异常详情不进入日志', !failedWrite.logs.some(line => line.includes(KEY)));
  } finally { failedWrite.close(); }
  const failedRead = await load({ mode: 'sync', readFail: true, legacy: KEY });
  try {
    check('GM 读失败保留未授权凭据并删网页旧值', failedRead.w.localStorage.getItem(LEGACY) === null && !!(await request(failedRead)).error);
    endpointInput(failedRead); input(failedRead, KEY); await wait();
    check('GM 读失败可显式授权当前会话', !!(await request(failedRead)).captured);
    check('GM 读异常详情不进入日志', !failedRead.logs.some(line => line.includes(KEY)));
  } finally { failedRead.close(); }
  const failedClear = await load({ mode: 'sync', writeFail: true, store: new Map([[PRIVATE, { key: KEY, origin: ORIGIN }]]) });
  try {
    input(failedClear, ''); await wait();
    check('私有清理失败不虚报已经持久清空', /删除|清理/.test(failedClear.w.document.getElementById('__cxQuizApiKeyStatus').textContent));
    check('私有清理失败仍关闭当前会话使用', !!(await request(failedClear)).error);
  } finally { failedClear.close(); }
  const preferred = await load({ mode: 'sync', legacy: KEY, store: new Map([[PRIVATE, 'synthetic-existing-private-key']]) });
  try {
    const result = await request(preferred);
    check('已有旧格式私有凭据优先保留且不自动授权', !!result.error && !result.captured && preferred.store.get(PRIVATE) === 'synthetic-existing-private-key');
    check('旧格式 GM Key 提示重新输入授权', /尚未授权接口/.test(preferred.w.document.getElementById('__cxQuizApiKeyStatus').textContent));
    endpointInput(preferred); input(preferred, 'synthetic-existing-private-key'); await wait();
    check('旧格式 GM Key 经面板重输后转换为绑定记录', recordIs(preferred, 'synthetic-existing-private-key'));
  } finally { preferred.close(); }
  let completeRead;
  const racing = await load({ mode: 'sync', deferRead: resolve => { completeRead = resolve; } });
  try {
    endpointInput(racing); input(racing, KEY); completeRead({ key: 'synthetic-stale-read', origin: 'https://stale.example' }); await wait();
    const result = await request(racing);
    check('晚到的 GM 读取不覆盖刚保存的 Key 与 Origin', result.captured && result.captured.init.headers.Authorization === 'Bearer ' + KEY && recordIs(racing));
  } finally { racing.close(); }
  const rebinding = await load({ mode: 'sync', store: new Map([[PRIVATE, { key: KEY, origin: ORIGIN }]]) });
  try {
    const next = 'https://replacement.example/api', nextOrigin = 'https://replacement.example';
    endpointInput(rebinding, next, 'replacement.example');
    check('仅在面板更换接口地址不会重新授权已有 Key', !!(await request(rebinding, next, 'replacement.example')).error && recordIs(rebinding));
    input(rebinding, KEY); await wait();
    check('重新输入非空 Key 才建立新 Origin 授权', recordIs(rebinding, KEY, nextOrigin) && !!(await request(rebinding, next, 'replacement.example')).captured);
    check('改绑后原 Origin 不再获准接收 Key', !!(await request(rebinding)).error);
    const restart = await load({ mode: 'sync', store: rebinding.store });
    try {
      check('重启仍只信任私有记录里的新 Origin', !!(await request(restart, next, 'replacement.example')).captured && !!(await request(restart)).error);
      restart.w.localStorage.setItem('cx_quiz_vision_allow', 'attacker.example');
      check('重启后恶意网页白名单改写仍不能外发 Key', !!(await request(restart, 'https://attacker.example/api', 'attacker.example')).error);
    } finally { restart.close(); }
    endpointInput(rebinding, 'http://replacement.example/api', 'replacement.example');
    input(rebinding, 'synthetic-invalid-new-key'); await wait();
    check('不安全端点拒绝保存且保留之前的私有 Key 与 Origin', recordIs(rebinding, KEY, nextOrigin));
    endpointInput(rebinding, 'https://new-unregistered.example/api', 'replacement.example');
    input(rebinding, KEY); await wait();
    check('保存 Key 时也验证主机白名单', recordIs(rebinding, KEY, nextOrigin));
    endpointInput(rebinding, 'https://user:password@replacement.example/api', 'replacement.example');
    input(rebinding, KEY); await wait();
    check('含 URL 凭据的端点不能建立 Origin 授权', recordIs(rebinding, KEY, nextOrigin));
    endpointInput(rebinding, 'http://127.0.0.1:18234/api', '');
    input(rebinding, KEY); await wait();
    check('本地回环 HTTP 接口可按完整 Origin 显式授权', recordIs(rebinding, KEY, 'http://127.0.0.1:18234') && !!(await request(rebinding, 'http://127.0.0.1:18234/api', '')).captured);
    check('本地回环改端口仍必须重输 Key 授权', !!(await request(rebinding, 'http://127.0.0.1:18235/api', '')).error);
  } finally { rebinding.close(); }
  const malformed = await load({ mode: 'sync', store: new Map([[PRIVATE, { key: KEY, origin: 'https://registered.example/path' }]]) });
  try {
    check('私有记录里的非规范 Origin 不被当作已授权', !!(await request(malformed)).error && /尚未授权接口/.test(malformed.w.document.getElementById('__cxQuizApiKeyStatus').textContent));
  } finally { malformed.close(); }
  const writes = [];
  const concurrent = await load({ mode: 'sync', deferWrite: (commit, value) => new Promise(resolve => writes.push({ commit, value, resolve })) });
  try {
    endpointInput(concurrent); input(concurrent, KEY); await wait();
    const next = 'https://replacement.example/api';
    endpointInput(concurrent, next, 'replacement.example'); input(concurrent, 'synthetic-newer-key');
    input(concurrent, ''); await wait();
    check('连续保存后清空立即关闭当前会话凭据请求', !!(await request(concurrent, next, 'replacement.example')).error);
    check('GM 写入按队列执行，旧写入未被并发新写入越过', writes.length === 1 && writes[0].value.key === KEY);
    writes[0].commit(); writes[0].resolve(); await wait();
    check('过时保存任务被跳过，最终只写入清空值', writes.length === 2 && writes[1].value === '');
    if (writes[1]) { writes[1].commit(); writes[1].resolve(); await wait(); }
    check('晚到的旧 GM 写入不能恢复被清空的 Key 或 Origin', concurrent.store.get(PRIVATE) === '' && !!(await request(concurrent)).error);
  } finally { concurrent.close(); }
  console.log('结论: ' + (failed ? 'FAIL' : 'PASS') + ' — 私有凭据边界 ' + checked + ' 项断言');
  process.exit(failed ? 1 : 0);
}
main().catch(() => { console.log('FAIL 私有凭据回归出现异常（详情已抑制，避免打印凭据）'); process.exit(1); });
