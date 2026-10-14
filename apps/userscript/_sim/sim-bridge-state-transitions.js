'use strict';

// Full-distribution regression. --source assembles the same ordered modules in
// memory while a build is pending; default execution uses both actual artifacts.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const products = require('../scripts/project-paths.cjs');
const sourceRoot = path.join(products.appRoot, 'src/chaoxing-force-play');
const sourceMode = process.argv.includes('--source');
const arg = process.argv.indexOf('--artifact');
const artifacts = sourceMode ? ['source-personal', 'source-open'] : arg >= 0
  ? [path.resolve(process.argv[arg + 1])] : process.env.CX_SIM_ARTIFACT
    ? [path.resolve(process.env.CX_SIM_ARTIFACT)] : [products.personalProduct, products.openProduct];
let assertions = 0, failures = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function flush() { for (let i = 0; i < 120; i++) await Promise.resolve(); }
function check(name, value, detail) {
  assertions++;
  if (!value) failures++;
  console.log((value ? 'PASS ' : 'FAIL ') + name);
  if (!value && detail !== undefined) console.log(JSON.stringify(detail));
}
function readCode(artifact) {
  if (!sourceMode) return fs.readFileSync(artifact, 'utf8');
  const variant = artifact.endsWith('open') ? 'open' : 'personal';
  const manifest = fs.readFileSync(path.join(products.appRoot, 'build-manifest.txt'), 'utf8').split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#'));
  const coordinator = 'takeover/engine/bridge-coordinator.js';
  if (!manifest.includes(coordinator)) manifest.splice(manifest.indexOf('takeover/engine/bridge.js'), 0, coordinator);
  const core = fs.readFileSync(path.join(sourceRoot, 'takeover/bootstrap/core.js'), 'utf8').replace("  'use strict';", "  'use strict';\n  var __CX_VARIANT = '" + variant + "';");
  return core + '\n' + manifest.map(file => fs.readFileSync(path.join(sourceRoot, file), 'utf8')).join('\n') + '\n})();';
}
function prepare(window, requests, actor, responder, options) {
  const proto = window.HTMLMediaElement.prototype;
  proto.play = function () { return Promise.resolve(); };
  proto.pause = function () {};
  proto.load = function () {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.XMLHttpRequest = class { open() {} send() { throw new Error('Offline fixture'); } abort() {} };
  window.localStorage.setItem('cx_an_on', '0');
  window.fetch = function (url, init) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const request = { url: String(url), init, actor, resolve, reject };
    requests.push(request);
    if (responder) responder(request);
    return promise;
  };
  const intervals = new Map();
  const nativeInterval = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
  window.setInterval = function (fn, ms) { const id = nativeInterval(fn, ms); intervals.set(id, fn); return id; };
  window.clearInterval = function (id) { intervals.delete(id); nativeClear(id); };
  if (options.fastTimeout) {
    const nativeTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 5000 ? 15 : ms, ...args);
  }
  return intervals;
}
function load(code, options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&chapterId=2' + (options.off ? '' : '&cxbridge=7531'),
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const { window } = dom, requests = [];
  const intervals = prepare(window, requests, 'top', options.responder, options);
  window.eval(code);
  const ns = window.__CX_FORCE_PLAY, children = [];
  return {
    window, ns, requests, bridge: window.EventBus.state.BRIDGE,
    tick() { for (const fn of intervals.values()) if (fn.name === '_loopTick') { fn(); break; } },
    child(kid, actor) {
      const frame = window.document.createElement('iframe');
      frame.src = 'https://mooc1.chaoxing.com/embedded?courseId=1&chapterId=' + kid;
      window.document.body.appendChild(frame);
      const child = frame.contentWindow;
      child.document.open(); child.document.write('<!doctype html><html><body></body></html>'); child.document.close();
      prepare(child, requests, actor || 'child', options.responder, options);
      child.eval(code);
      children.push(child.__CX_FORCE_PLAY);
      return { window: child, ns: child.__CX_FORCE_PLAY, bridge: child.EventBus.state.BRIDGE, target: child.EventBus.state.TARGET };
    },
    close() {
      for (const child of children.reverse()) { try { child.uninstall(); } catch (_) {} }
      try { ns.uninstall(); } finally { window.close(); }
    },
  };
}
const playlist = { chapters: [
  { knowledgeId: '2', completed: true, unfinishedCount: 0, objectids: ['top-task'] },
  { knowledgeId: '3', completed: false, unfinishedCount: 1, objectids: ['child-task'] },
] };
const response = data => ({ ok: true, json: () => Promise.resolve(data) });
const aborted = r => !!(r.init && r.init.signal && r.init.signal.aborted);

async function scenarios(artifact) {
  const code = readCode(artifact), label = path.basename(artifact) + ' — ';
  for (const stop of ['safety', 'disable', 'uninstall', 'bridge-off']) {
    const e = load(code);
    try {
      check(label + stop + ': initial playlist/ping requests exist', e.requests.length === 2);
      const old = e.requests.slice(), oldBridge = e.bridge;
      const v = e.window.document.createElement('video'); e.window.document.body.appendChild(v);
      let writes = 0;
      Object.defineProperty(v, 'pause', { configurable: true, get: () => function () {}, set: () => writes++ });
      if (stop === 'safety') e.ns.safetyTrip('Offline fixture');
      else if (stop === 'disable') e.ns.setTakeoverEnabled(false);
      else if (stop === 'uninstall') e.ns.uninstall();
      else { e.window.localStorage.setItem('cx_bridge_off', '1'); e.ns.toolkit.bridge.bridgeInit(); }
      const stoppedWrites = writes;
      check(label + stop + ': requests are aborted', old.every(aborted));
      check(label + stop + ': bridge timeout resources removed', !e.ns.TimerRegistry.stats().byOwner.bridge);
      old.find(r => r.url.includes('/playlist/')).resolve(response(playlist));
      old.find(r => r.url.endsWith('/ping')).reject(new Error('Offline late failure'));
      await flush();
      check(label + stop + ': late response does not write chapter/skipResume', oldBridge.chapter === null && oldBridge.skipResume === false);
      check(label + stop + ': late response does not assign video.pause', writes === stoppedWrites);
      check(label + stop + ': late ping failure does not continue probing', e.requests.length === old.length);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const old = e.requests.slice();
      e.ns.safetyTrip('Offline fixture'); e.ns.safetyResume();
      const fresh = e.requests.slice(old.length);
      check(label + 'resume creates fresh playlist/ping requests', fresh.length === 2);
      old.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'old' })));
      await flush();
      check(label + 'old stop/resume response cannot revive chapter or version', e.bridge.chapter === null && e.bridge.version === null);
      fresh.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'new' })));
      await flush();
      check(label + 'fresh resumed requests consume completed chapter', e.bridge.chapter && e.bridge.chapter.knowledgeId === '2' && e.bridge.skipResume);
      check(label + 'fresh resumed ping consumes current version', e.bridge.version === 'new');
      const count = e.requests.length;
      e.ns.toolkit.bridge.bridgeInit(); e.tick();
      check(label + 'repeated init/main tick does not refetch active session', e.requests.length === count);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      let bodyResolve;
      e.requests.find(r => r.url.includes('/playlist/')).resolve({ ok: true, json: () => new Promise(resolve => { bodyResolve = resolve; }) });
      await flush();
      check(label + 'body parsing retains playlist timeout', e.ns.TimerRegistry.stats().byOwner.bridge === 2);
      e.ns.setTakeoverEnabled(false);
      bodyResolve(playlist);
      e.requests.find(r => r.url.endsWith('/ping')).resolve(response({ version: 'late' }));
      await flush();
      check(label + 'late JSON body cannot land after disable', e.bridge.chapter === null && !e.bridge.skipResume && e.bridge.version === null);
      check(label + 'disable cancels body-stage requests and all bridge timers', e.requests.every(aborted) && !e.ns.TimerRegistry.stats().byOwner.bridge);
    } finally { e.close(); }
  }
  {
    const e = load(code, { fastTimeout: true });
    try {
      let bodyResolve;
      const request = e.requests.find(r => r.url.includes('/playlist/'));
      request.resolve({ ok: true, json: () => new Promise(resolve => { bodyResolve = resolve; }) });
      e.requests.find(r => r.url.endsWith('/ping')).resolve(response({ version: 'ready' }));
      await flush(); await wait(35);
      check(label + 'hung JSON body expires and aborts', aborted(request) && !e.ns.TimerRegistry.stats().byOwner.bridge);
      bodyResolve(playlist); await flush();
      check(label + 'body resolved after timeout cannot write chapter', e.bridge.chapter === null && !e.bridge.skipResume);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const old = e.requests.slice();
      e.window.history.replaceState(null, '', '?courseId=1&chapterId=3&cxbridge=7531');
      // pushState/replaceState need no custom history monkey patch: main-loop
      // identity checking starts the new session; old response also checks URL.
      e.tick();
      const fresh = e.requests.slice(old.length);
      check(label + 'main loop notices URL change and creates fresh requests', fresh.length === 2 && old.every(aborted));
      old.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'old-url' })));
      await flush();
      check(label + 'old URL responses cannot consume chapter', e.bridge.chapter === null && e.bridge.version === null);
      fresh.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'new-url' })));
      await flush();
      check(label + 'new URL selects its own unfinished chapter', e.bridge.chapter && e.bridge.chapter.knowledgeId === '3' && !e.bridge.skipResume);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const old = e.requests.slice();
      e.window.history.replaceState(null, '', '?courseId=1&chapterId=3&cxbridge=7531');
      old.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'late' })));
      await flush();
      check(label + 'URL changed before next tick rejects old response immediately', e.bridge.chapter === null && e.bridge.version === null && old.every(aborted));
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const child = e.child('3');
      check(label + 'same-origin child shares two in-flight top requests', e.requests.length === 2 && e.requests.every(r => r.actor === 'top'));
      e.requests.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'shared' })));
      await flush();
      check(label + 'parent consumes its own completed chapter', e.bridge.chapter && e.bridge.chapter.knowledgeId === '2' && e.bridge.skipResume);
      check(label + 'child consumes its own unfinished chapter', child.bridge.chapter && child.bridge.chapter.knowledgeId === '3' && !child.bridge.skipResume);
      check(label + 'child consumes objectids into its own targeting state', child.target.ids && child.target.ids['child-task']);
      const count = e.requests.length, late = e.child('3', 'late-child');
      await flush();
      check(label + 'late child consumes cached playlist without extra network', e.requests.length === count && late.bridge.chapter && late.bridge.chapter.knowledgeId === '3');
    } finally { e.close(); }
  }
  for (const method of ['replaceState', 'pushState']) {
    const e = load(code);
    try {
      const child = e.child('2');
      e.requests.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'shared' })));
      await flush();
      const count = e.requests.length, parentTarget = e.window.EventBus.state.TARGET;
      check(label + method + ': parent and child initially consume completed chapter', e.bridge.skipResume && child.bridge.skipResume && child.bridge.chapter.knowledgeId === '2');
      child.window.history[method](null, '', '?courseId=1&chapterId=3');
      // Child frames have no main loop. Drive only the actual parent's loop;
      // calling child.bridgeInit() here would mask the missing orchestration.
      e.tick(); await flush();
      check(label + method + ': parent tick refreshes child chapter and clears old completion hold', child.bridge.chapter && child.bridge.chapter.knowledgeId === '3' && !child.bridge.skipResume);
      check(label + method + ': child target reflects its new chapter only', child.target.ids && child.target.ids['child-task'] && !child.target.ids['top-task']);
      check(label + method + ': child SPA change preserves parent chapter and targets', e.bridge.chapter && e.bridge.chapter.knowledgeId === '2' && e.bridge.skipResume && parentTarget.ids && parentTarget.ids['top-task'] && !parentTarget.ids['child-task']);
      check(label + method + ': cached child SPA synchronization adds no network requests', e.requests.length === count);
    } finally { e.close(); }
  }
  {
    const e = load(code, { off: true });
    try {
      const api = e.ns.toolkit.bridge, callbacksA = [], callbacksB = [], callbacksC = [];
      api.probeBridgeBase(base => callbacksA.push(base));
      const requestA = e.requests[0];
      check(label + 'probe A initially creates one pending request', e.requests.length === 1 && !aborted(requestA));
      e.ns.CoreState.invalidateScope('bridge', 'Cancel probe A');
      check(label + 'scope reset aborts probe A', aborted(requestA));
      // Start B before A's promise rejection/cancellation chain has settled.
      api.probeBridgeBase(base => callbacksB.push(base));
      const requestB = e.requests[1];
      check(label + 'probe B starts fresh while A cancellation is queued', e.requests.length === 2 && !aborted(requestB));
      requestA.resolve(response({ version: 'stale-A' }));
      await flush();
      api.probeBridgeBase(base => callbacksC.push(base));
      check(label + 'late A cannot clear B guard: concurrent C is immediately rejected', callbacksC.length === 1 && callbacksC[0] === null && e.requests.length === 2);
      check(label + 'cancelled A has no callback and does not interrupt pending B', callbacksA.length === 0 && callbacksB.length === 0 && !aborted(requestB));
      requestB.resolve(response({ version: 'current-B' }));
      await flush();
      check(label + 'B completes with exactly one normal callback', callbacksB.length === 1 && callbacksB[0] === 'http://127.0.0.1:7531');
      check(label + 'only B publishes current bridge version', e.bridge.version === 'current-B' && callbacksA.length === 0 && callbacksC.length === 1);
      check(label + 'completed B releases probe guard and timeout resources', !api.probeState().inFlight && !e.ns.TimerRegistry.stats().byOwner.bridge);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const child = e.child('3');
      child.ns.CONFIG.ENABLED = false; child.ns.CoreState.canRun();
      check(label + 'one disabled consumer does not abort a shared active parent', e.requests.every(r => !aborted(r)));
      e.requests.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'shared' })));
      await flush();
      check(label + 'active parent consumes while disabled child remains unchanged', e.bridge.chapter && child.bridge.chapter === null);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const child = e.child('3');
      e.ns.CoreState.invalidateScope('bridge', 'Local scope reset');
      check(label + 'owner frame scope reset preserves another active consumer', e.requests.every(r => !aborted(r)) && child.ns.CoreState.canRun());
      e.requests.forEach(r => r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'shared' })));
      await flush();
      check(label + 'child still consumes after owning parent resets its bridge scope', e.bridge.chapter === null && child.bridge.chapter && child.bridge.chapter.knowledgeId === '3');
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const child = e.child('3');
      child.ns.CoreState.invalidateScope('bridge', 'Child reset');
      check(label + 'first local cancellation keeps shared requests alive', e.requests.every(r => !aborted(r)));
      e.ns.CoreState.invalidateScope('bridge', 'Last consumer reset');
      check(label + 'last consumer cancellation aborts shared requests and timers', e.requests.every(aborted) && !e.ns.TimerRegistry.stats().byOwner.bridge);
    } finally { e.close(); }
  }
  {
    const e = load(code);
    try {
      const child = e.child('3');
      e.ns.safetyTrip('Offline parent verification');
      check(label + 'parent stop cancels shared requests and child', e.requests.every(aborted) && !child.ns.CoreState.canRun());
      e.requests.forEach(r => r.reject(new Error('Late offline failure')));
      await flush();
      check(label + 'shared stop does not leave bridge timeouts or new probes', e.requests.length === 2 && !e.ns.TimerRegistry.stats().byOwner.bridge && !child.ns.TimerRegistry.stats().byOwner.bridge);
    } finally { e.close(); }
  }
  {
    const e = load(code, { responder(r) { r.reject(new Error('Offline fixture')); } });
    try {
      await flush();
      const pings = e.requests.filter(r => r.url.endsWith('/ping'));
      check(label + 'offline candidate loop tries each of five ports once', pings.length === 5 && new Set(pings.map(r => r.url)).size === 5, pings.map(r => r.url));
      const count = e.requests.length;
      e.child('3', 'late-offline-child'); await flush();
      check(label + 'late offline child shares failure cooldown without extra requests', e.requests.length === count);
      e.ns.toolkit.bridge.bridgeInit(); e.tick(); await flush();
      check(label + 'offline session does not retry before cooldown', e.requests.length === count);
    } finally { e.close(); }
  }
  {
    const e = load(code, { responder(r) {
      if (r.url.includes(':9090/')) r.resolve(response(r.url.endsWith('/ping') ? { version: 'fallback' } : playlist));
      else r.reject(new Error('Offline fixture'));
    } });
    try {
      await flush();
      check(label + 'fallback selects final reachable port and playlist', e.bridge.base === 'http://127.0.0.1:9090' && e.bridge.chapter && e.bridge.chapter.knowledgeId === '2');
      const count = e.requests.length, child = e.child('3', 'late-fallback-child'); await flush();
      check(label + 'delayed child shares fallback discovery and correct chapter', e.requests.length === count && child.bridge.base === e.bridge.base && child.bridge.chapter && child.bridge.chapter.knowledgeId === '3');
    } finally { e.close(); }
  }
  {
    const e = load(code, { off: true });
    try {
      check(label + 'bridge default off does not create requests or bridge timers', e.requests.length === 0 && !e.ns.TimerRegistry.stats().byOwner.bridge);
      e.window.attachments = [{ property: { objectid: 'native-only' } }];
      const target = e.window.EventBus.state.TARGET, ids = target.ids;
      e.ns.toolkit.bridge.bridgeInit(); e.ns.toolkit.bridge.bridgeInit();
      check(label + 'repeated default-off init preserves native target state and identity', target.ids === ids && target.enabled && target.ids['native-only']);
      e.tick(); e.tick(); e.tick();
      check(label + 'default-off bridge does not reset three-round native no-match fallback', target.enabled === false);
    } finally { e.close(); }
  }
  {
    let online = false;
    const e = load(code, { responder(r) {
      if (online) r.resolve(response(r.url.endsWith('/ping') ? { version: 'now-online' } : playlist));
      else r.reject(new Error('Offline fixture'));
    } });
    try {
      await flush();
      const before = e.requests.length, started = e.window.Date.now();
      let now = started;
      e.window.Date.now = () => now;
      online = true; now = started + 30000; e.tick(); await flush();
      check(label + 'newly online bridge still respects existing cooldown', e.requests.length === before);
      now = started + 61000; e.tick(); await flush();
      check(label + 'expired cooldown retries and consumes newly online bridge', e.requests.length === before + 2 && e.bridge.chapter && e.bridge.chapter.knowledgeId === '2' && e.bridge.version === 'now-online');
    } finally { e.close(); }
  }
  for (const change of ['bridge-off', 'no-chapter', 'unmatched-chapter']) {
    const e = load(code, { responder(r) { r.resolve(response(r.url.includes('/playlist/') ? playlist : { version: 'ready' })); } });
    try {
      await flush();
      const target = e.window.EventBus.state.TARGET;
      e.window.attachments = [{ property: { objectid: 'native-task' } }];
      check(label + change + ': completed chapter and bridge targets initially consumed', e.bridge.skipResume && target.ids && target.ids['top-task']);
      if (change === 'bridge-off') e.window.localStorage.setItem('cx_bridge_off', '1');
      else e.window.history.replaceState(null, '', '?courseId=1&cxbridge=7531' + (change === 'unmatched-chapter' ? '&chapterId=99' : ''));
      e.ns.toolkit.bridge.bridgeInit(); await flush();
      check(label + change + ': obsolete chapter and completion hold are cleared', e.bridge.chapter === null && !e.bridge.skipResume);
      check(label + change + ': old bridge objectids removed and native attachments retained', target.ids && target.ids['native-task'] && !target.ids['top-task']);
    } finally { e.close(); }
  }
}
(async () => {
  for (const artifact of artifacts) await scenarios(artifact);
  console.log('结论: ' + (failures ? 'FAIL' : 'PASS') + ' — bridge state transitions (' + assertions + ' assertions, ' + artifacts.length + ' artifacts)');
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
