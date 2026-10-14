'use strict';

// Exercise the complete distributions through public configuration, DOM events,
// bridge responses and plugin registration. Every request is an offline stub.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const products = require('../scripts/project-paths.cjs');
const arg = process.argv.indexOf('--artifact');
const artifacts = arg >= 0 ? [path.resolve(process.argv[arg + 1])]
  : process.env.CX_SIM_ARTIFACT ? [path.resolve(process.env.CX_SIM_ARTIFACT)]
    : [products.personalProduct, products.openProduct];
let failures = 0, assertions = 0;
function check(name, condition, detail) {
  assertions++;
  if (!condition) failures++;
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (!condition && detail !== undefined) console.log(JSON.stringify(detail));
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = () => ({ remaining: 0, unsettled: 0, pendingSubmit: 0, reviewCount: 0, pendingAI: 0 });

function load(artifact, on, prepare) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=1',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const { window } = dom, intervals = new Map(), requests = [], addons = [], endedListeners = new Set();
  const addDocumentListener = window.document.addEventListener.bind(window.document);
  const removeDocumentListener = window.document.removeEventListener.bind(window.document);
  window.document.addEventListener = function (type, fn, options) {
    if (type === 'ended') endedListeners.add(fn);
    return addDocumentListener(type, fn, options);
  };
  window.document.removeEventListener = function (type, fn, options) {
    if (type === 'ended') endedListeners.delete(fn);
    return removeDocumentListener(type, fn, options);
  };
  const media = new WeakMap();
  function data(v) {
    if (!media.has(v)) media.set(v, { paused: false, ended: false, readyState: 4, duration: 120, pauses: 0, plays: 0 });
    return media.get(v);
  }
  const proto = window.HTMLMediaElement.prototype;
  ['paused', 'ended', 'readyState', 'duration'].forEach(key => Object.defineProperty(proto, key, {
    configurable: true, get() { return data(this)[key]; },
  }));
  proto.pause = function () { const d = data(this); d.paused = true; d.pauses++; };
  proto.play = function () { const d = data(this); d.paused = false; d.plays++; return Promise.resolve(); };
  proto.load = function () {};
  window.HTMLCanvasElement.prototype.getContext = function () { return null; };
  window.Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 };
  };
  let registryOwner = null;
  const nativeSetInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
  window.setInterval = function (fn, ms) {
    const id = nativeSetInterval(fn, ms); intervals.set(id, { fn, ms, owner: registryOwner }); return id;
  };
  window.clearInterval = function (id) { intervals.delete(id); return nativeClearInterval(id); };
  const nativeSetTimeout = window.setTimeout.bind(window);
  // Only plugin navigation/bootstrap/poll delays are compressed. Media intervals
  // and quiz boot/observation delays retain their normal scheduling.
  window.setTimeout = function (fn, ms, ...args) {
    return nativeSetTimeout(fn, ms === 300 ? 20 : ms === 1500 ? 30 : ms === 4000 ? 40 : ms, ...args);
  };
  let respond = () => Promise.reject(new Error('Offline fixture: bridge unavailable'));
  window.fetch = function (url, options) { requests.push({ url: String(url), options }); return respond(String(url), options); };
  window.XMLHttpRequest = class { open() {} send() { throw new Error('Offline fixture: XHR unavailable'); } abort() {} };
  window.localStorage.setItem('cx_an_on', on ? '1' : '0');
  window.localStorage.setItem('cx_bridge_off', '1');
  window.localStorage.setItem('cx_panel_cfg', JSON.stringify({ ENABLED: true }));
  if (prepare) prepare(window);
  const base = new Set(Object.getOwnPropertyNames(window));
  vm.runInContext(fs.readFileSync(artifact, 'utf8'), dom.getInternalVMContext(), { filename: artifact });
  const ns = window.__CX_FORCE_PLAY;
  // Capture owner while the real registry creates its native interval. Its
  // returned id is a registry id, and callback names may be minified.
  const registerInterval = ns.TimerRegistry.setInterval;
  ns.TimerRegistry.setInterval = function (fn, ms, owner) {
    const previous = registryOwner;
    registryOwner = owner || 'global';
    try { return registerInterval.call(this, fn, ms, owner); }
    finally { registryOwner = previous; }
  };
  // Capture the documented addon queue before the registry drains it.
  const register = window.__cxRegisterAddon;
  window.__cxRegisterAddon = function () {
    if (window.__cxAddonQueue) window.__cxAddonQueue.forEach(a => { if (a.id === 'auto-next') addons.push(a); });
    return register();
  };
  function video(name) {
    const v = window.document.createElement('video');
    v.src = 'https://mooc1.chaoxing.com/' + name + '.mp4'; v.currentTime = 10;
    window.document.body.appendChild(v);
    return v;
  }
  function nextButton() {
    const b = window.document.createElement('button'); b.id = 'prevNextFocusNext'; b.textContent = '下一节';
    let clicks = 0; b.addEventListener('click', () => clicks++); window.document.body.appendChild(b);
    return { b, clicks: () => clicks };
  }
  return {
    dom, window, ns, base, requests, addons, data, video, nextButton,
    setResponder(fn) { respond = fn; },
    bridgeOn() { window.localStorage.removeItem('cx_bridge_off'); window.localStorage.setItem('cx_bridge_on', '1'); },
    addon() { return addons[0]; },
    endedListenerCount() { return endedListeners.size; },
    holdCount() { return ns.TimerRegistry.stats().byOwner['auto-next-hold'] || 0; },
    holdTick() { intervals.forEach(v => { if (v.owner === 'auto-next-hold') v.fn(); }); },
    end(v) { v.dispatchEvent(new window.Event('ended', { bubbles: true })); },
    close() { try { ns.uninstall(); } finally { window.close(); } },
  };
}
function response(payload) { return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(payload)), json: () => Promise.resolve(payload) }; }

async function scenarios(artifact) {
  const label = path.basename(artifact) + ' — ';
  let e = load(artifact, false);
  try {
    e.bridgeOn();
    await wait(45);
    check(label + 'disabled plugin registers without probing bridge', e.requests.length === 0 && !!e.addon());
    check(label + 'disabled plugin creates no hold interval', e.holdCount() === 0);
    e.window.__CX_FORCE_PLAY.uninstall();
    check(label + 'uninstall leaves no plugin hold global', !Object.prototype.hasOwnProperty.call(e.window, '__cxANHoldTimer'));
    const residual = Object.getOwnPropertyNames(e.window).filter(k => /^[a-zA-Z_$]/.test(k) && !e.base.has(k));
    check(label + 'uninstall restores the original global names', residual.length === 0, residual);
    check(label + 'uninstall clears every registered timer', e.ns.TimerRegistry.stats().intervals === 0 && e.ns.TimerRegistry.stats().timeouts === 0);
  } finally { e.close(); }

  e = load(artifact, true);
  try {
    e.ns.safetyTrip('early-stop fixture');
    await wait(40);
    check(label + 'stop before bootstrap creates no hold interval', e.holdCount() === 0);
    e.ns.safetyResume();
    await wait(25);
    check(label + 'resume after early stop registers plugin', !!e.addon() && e.addons.length === 1);
    check(label + 'resume after early stop starts one hold interval', e.holdCount() === 1);
    const endedListenerCount = e.endedListenerCount();
    e.ns.setTakeoverEnabled(false); e.ns.setTakeoverEnabled(true);
    await wait(10);
    check(label + 'repeated resume keeps one registration and interval', e.addons.length === 1 && e.holdCount() === 1);
    check(label + 'repeated resume does not duplicate ended listener', endedListenerCount > 0 && e.endedListenerCount() === endedListenerCount);
    e.addon().set(false);
    check(label + 'plugin off immediately stops hold interval', e.holdCount() === 0);
    e.addon().set(true);
    check(label + 'plugin on restores one hold interval', e.holdCount() === 1);
    const v = e.video('hold'); v[e.ns.FLAGS.forcePaused] = true;
    for (const field of ['pendingSubmit', 'reviewCount', 'pendingAI']) {
      e.ns.quizStats = settled(); e.ns.quizStats[field] = 1;
      e.data(v).paused = false;
      e.holdTick();
      check(label + field + ' keeps playback held despite remaining=0', v[e.ns.FLAGS.anHold] === true && e.data(v).paused);
      e.ns.quizStats = settled(); e.holdTick();
      await wait(2);
      check(label + field + ' releases only after settlement', v[e.ns.FLAGS.anHold] === false && !e.data(v).paused);
    }
    const next = e.nextButton(), nav = e.video('navigation');
    e.ns.quizStats = settled(); e.ns.quizStats.pendingSubmit = 1;
    e.end(nav); e.end(nav);
    await wait(25);
    check(label + 'duplicate ended waits for submission and does not navigate', next.clicks() === 0);
    e.ns.quizStats = settled();
    await wait(85);
    check(label + 'settled submission permits a single navigation', next.clicks() === 1);
    e.end(nav); await wait(30);
    check(label + 'successful source identity prevents duplicate navigation', next.clicks() === 1);
    nav.src = 'https://mooc1.chaoxing.com/next-lesson.mp4';
    e.end(nav); await wait(100);
    check(label + 'reused video with changed source can navigate again', next.clicks() === 2, { clicks: next.clicks() });
    const retry = e.video('retry'); next.b.remove();
    e.end(retry); await wait(15);
    const recovered = e.nextButton(); e.end(retry); await wait(65);
    check(label + 'failed lookup does not consume the video identity', recovered.clicks() === 1);
    await wait(50);
    const late = e.video('late-dom');
    e.ns.quizStats = settled(); e.ns.quizStats.pendingAI = 1;
    e.end(late); await wait(5); e.addon().set(false); e.ns.quizStats = settled(); await wait(35);
    check(label + 'plugin off cancels a queued navigation', recovered.clicks() === 1, { clicks: recovered.clicks() });
    check(label + 'plugin off leaves no hold interval', e.holdCount() === 0);
    e.addon().set(true); e.ns.quizStats = settled(); e.ns.quizStats.reviewCount = 1;
    e.end(late); await wait(5); e.ns.safetyTrip('late navigation'); e.ns.quizStats = settled(); await wait(35);
    check(label + 'safety stop cancels a queued navigation', recovered.clicks() === 1 && e.holdCount() === 0, { clicks: recovered.clicks(), hold: e.holdCount() });
  } finally { e.close(); }

  for (const shutdown of ['plugin-off', 'core-stop', 'uninstall']) {
    e = load(artifact, true);
    try {
      let resolvePlaylist;
      e.setResponder(url => /\/playlist\//.test(url)
        ? new Promise(resolve => { resolvePlaylist = resolve; }) : Promise.resolve(response({ ok: true })));
      e.bridgeOn(); await wait(45);
      const v = e.video('bridge-' + shutdown); e.ns.quizStats = settled(); e.end(v); await wait(10);
      check(label + shutdown + ' fixture has an in-flight playlist', typeof resolvePlaylist === 'function');
      const target = e.window.location.href + '#next-offline';
      if (shutdown === 'plugin-off') e.addon().set(false);
      else if (shutdown === 'core-stop') e.ns.safetyTrip('late bridge');
      else e.ns.uninstall();
      if (resolvePlaylist) resolvePlaylist(response({ chapters: [{ id: '1', completed: true }, { id: '2', completed: false, url: target }] }));
      await wait(40);
      check(label + shutdown + ' ignores late playlist response', e.window.location.hash === '');
      check(label + shutdown + ' aborts pending bridge request', e.requests.some(r => /\/playlist\//.test(r.url) && r.options.signal && r.options.signal.aborted));
      check(label + shutdown + ' stops the hold interval', e.holdCount() === 0);
    } finally { e.close(); }
  }

  for (const wrapped of [false, true]) {
    e = load(artifact, true);
    try {
      const target = e.window.location.href + (wrapped ? '#wrapped-playlist' : '#legacy-playlist');
      const chapters = [{ id: '1', completed: true }, { id: '2', completed: false, url: target }];
      e.setResponder(url => Promise.resolve(response(/\/playlist\//.test(url) ? wrapped ? { chapters } : chapters : { ok: true })));
      e.bridgeOn(); await wait(40); e.ns.quizStats = settled(); e.end(e.video('playlist')); await wait(45);
      check(label + (wrapped ? 'wrapped' : 'legacy') + ' playlist selects the unfinished next chapter', e.window.location.href === target);
    } finally { e.close(); }
  }

  for (const trigger of ['manual-test', 'ended-event']) {
    let resolvePermission, permissionCalls = 0, notifications = 0, NotificationStub;
    e = load(artifact, false, window => {
      NotificationStub = class {
        constructor() { notifications++; }
        static requestPermission() {
          permissionCalls++;
          return new Promise(resolve => { resolvePermission = resolve; });
        }
      };
      NotificationStub.permission = 'default';
      window.Notification = NotificationStub;
    });
    try {
      await wait(40);
      check(label + trigger + ' notification hook is bootstrapped', typeof e.window.__cxEndedNotifyTest === 'function');
      const v = e.video('notify-' + trigger);
      if (trigger === 'manual-test') e.window.__cxEndedNotifyTest();
      else e.end(v);
      check(label + trigger + ' fixture has a pending permission request', permissionCalls === 1 && typeof resolvePermission === 'function');
      e.ns.safetyTrip('notification permission pending');
      const stopped = e.video('notify-stopped-' + trigger); e.end(stopped);
      check(label + trigger + ' stopped ended neither mutes nor requests permission', !stopped.muted && permissionCalls === 1);
      e.ns.safetyResume();
      NotificationStub.permission = 'granted';
      if (resolvePermission) resolvePermission('granted');
      await wait(5);
      check(label + trigger + ' late permission cannot notify after stop/resume', notifications === 0);
      e.window.__cxEndedNotifyTest();
      check(label + trigger + ' a fresh permitted notification remains usable', notifications === 1);
    } finally { e.close(); }
  }
}

(async () => {
  for (const artifact of artifacts) await scenarios(artifact);
  console.log('结论: ' + (failures ? 'FAIL' : 'PASS') + ' — ' + assertions + ' assertions, ' + failures + ' failures');
  process.exitCode = failures ? 1 : 0;
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
