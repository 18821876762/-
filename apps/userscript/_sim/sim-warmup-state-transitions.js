'use strict';

// Exercise warmup persistence across freshly loaded complete distributions.
// A controlled clock avoids waiting for UI messages; all network APIs are denied.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const products = require('../scripts/project-paths.cjs');
const artifactArg = process.argv.indexOf('--artifact');
const artifacts = artifactArg >= 0
  ? [path.resolve(process.argv[artifactArg + 1])]
  : process.env.CX_SIM_ARTIFACT
    ? [path.resolve(process.env.CX_SIM_ARTIFACT)]
    : [products.personalProduct, products.openProduct];
const WARMUP_KEY = 'cx_warmup_v1';
const START_KEY = 'cx_quiz_auto_start';
let failures = 0;
let assertions = 0;
function check(name, condition) {
  assertions++;
  if (!condition) failures++;
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
}

function load(code, mode, gm, persisted) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1',
    runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  const timers = new Map();
  let seq = 0;
  let now = 1780000000000;
  const NativeDate = window.Date;
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  function schedule(fn, ms, interval, args) {
    const id = ++seq;
    timers.set(id, { fn, due: now + Math.max(0, Number(ms) || 0), interval, ms: Math.max(1, Number(ms) || 1), args });
    return id;
  }
  window.setTimeout = (fn, ms, ...args) => schedule(fn, ms, false, args);
  window.setInterval = (fn, ms, ...args) => schedule(fn, ms, true, args);
  window.clearTimeout = id => timers.delete(id);
  window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = fn => schedule(() => fn(now), 16, false, []);
  window.cancelAnimationFrame = id => timers.delete(id);
  window.fetch = () => Promise.reject(new Error('Offline simulation: network disabled'));
  window.XMLHttpRequest = class { open() {} send() { throw new Error('Offline simulation: network disabled'); } abort() {} };
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () {};
  window.HTMLCanvasElement.prototype.getContext = function () { return null; };
  for (const [key, value] of persisted || []) window.localStorage.setItem(key, value);
  window.localStorage.setItem('cx_panel_cfg', JSON.stringify({ BRIDGE_ENABLED: false }));
  if (mode === 'gm' || mode === 'setter-only') window.GM_setValue = (key, value) => { gm.set(key, value); };
  if (mode === 'gm') window.GM_getValue = (key, fallback) => gm.has(key) ? gm.get(key) : fallback;
  vm.runInContext(code, dom.getInternalVMContext(), { filename: 'warmup-artifact.user.js' });
  const ns = window.__CX_FORCE_PLAY;
  const messages = [];
  window.EventBus.onEv('ui:toast', message => messages.push(String(message)));
  function stored() {
    return new Map(Array.from({ length: window.localStorage.length }, (_, i) => {
      const key = window.localStorage.key(i);
      return [key, window.localStorage.getItem(key)];
    }));
  }
  async function advance(ms) {
    const end = now + ms;
    let steps = 0;
    while (true) {
      const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      if (++steps > 2000) throw new Error('Controlled clock did not settle');
      const [id, t] = next;
      now = t.due;
      if (t.interval) t.due += t.ms; else timers.delete(id);
      if (typeof t.fn === 'function') t.fn(...t.args);
      else vm.runInContext(String(t.fn), dom.getInternalVMContext());
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  }
  return { dom, window, ns, messages, stored, advance,
    close() { try { if (ns && ns.uninstall) ns.uninstall(); } finally { timers.clear(); window.close(); } },
  };
}

async function scenarios(artifact) {
  const code = fs.readFileSync(artifact, 'utf8');
  const variant = /__CX_VARIANT\s*=\s*['"](open|personal)['"]/.exec(code);
  const isOpen = variant && variant[1] === 'open';
  const label = path.basename(artifact) + ' — ';
  check(label + 'build variant is identifiable', !!variant);
  if (!variant) return;
  if (!isOpen) {
    const gm = new Map();
    const e = load(code, 'gm', gm, new Map([[START_KEY, '1']]));
    try {
      check(label + 'personal does not enter warmup', !e.ns.warmup || !e.ns.warmup.active());
      check(label + 'personal preserves automatic-start preference', e.window.localStorage.getItem(START_KEY) === '1');
      check(label + 'personal does not write warmup marker', !gm.has(WARMUP_KEY) && !e.window.localStorage.getItem(WARMUP_KEY));
      await e.advance(12000);
      check(label + 'personal emits no warmup notices', !e.messages.some(x => /预热/.test(x)));
    } finally { e.close(); }
    return;
  }

  for (const mode of ['gm', 'setter-only', 'local-storage']) {
    const gm = new Map();
    const prefix = label + mode + ' — ';
    let e = load(code, mode, gm, new Map([[START_KEY, '1']]));
    let saved;
    try {
      check(prefix + 'fresh open installation enters warmup', !!e.ns.warmup && e.ns.warmup.active());
      check(prefix + 'warmup closes automatic-start preference', e.window.localStorage.getItem(START_KEY) === '0');
      check(prefix + 'armed marker uses one readable/writable backend', mode === 'gm'
        ? gm.get(WARMUP_KEY) === 'armed' && !e.window.localStorage.getItem(WARMUP_KEY)
        : e.window.localStorage.getItem(WARMUP_KEY) === 'armed' && !gm.has(WARMUP_KEY));
      saved = e.stored();
    } finally { e.close(); }

    e = load(code, mode, gm, saved);
    try {
      check(prefix + 'reload restores pending armed state', !!e.ns.warmup && e.ns.warmup.active());
      e.window.localStorage.setItem(START_KEY, '1');
      e.ns.warmup.acknowledge();
      check(prefix + 'confirmation exits warmup', !e.ns.warmup.active());
      check(prefix + 'done marker uses the same backend', mode === 'gm'
        ? gm.get(WARMUP_KEY) === 'done'
        : e.window.localStorage.getItem(WARMUP_KEY) === 'done' && !gm.has(WARMUP_KEY));
      e.messages.length = 0;
      await e.advance(12000);
      check(prefix + 'confirmation cancels delayed warmup notices', !e.messages.some(x => /预热|首次使用已默认关闭/.test(x)));
      saved = e.stored();
    } finally { e.close(); }

    e = load(code, mode, gm, saved);
    try {
      check(prefix + 'reload restores completed warmup', !!e.ns.warmup && !e.ns.warmup.active());
      check(prefix + 'completed reload keeps user automatic-start choice', e.window.localStorage.getItem(START_KEY) === '1');
      await e.advance(12000);
      check(prefix + 'completed reload schedules no warmup notices', !e.messages.some(x => /预热/.test(x)));
    } finally { e.close(); }

    e = load(code, mode, new Map(), new Map([[START_KEY, '1']]));
    try {
      e.window.localStorage.setItem(START_KEY, '1');
      e.ns.warmup.acknowledge();
      e.messages.length = 0;
      await e.advance(12000);
      check(prefix + 'early confirmation cancels the first pending notice', !e.messages.some(x => /预热|首次使用已默认关闭/.test(x)));
    } finally { e.close(); }

    // Confirm after the first notice has appeared, while the follow-up notices
    // are still pending. Reloading armed state may intentionally be quiet, so
    // this separate fresh-installation scenario is required to test cancellation.
    e = load(code, mode, new Map(), new Map([[START_KEY, '1']]));
    try {
      await e.advance(2500);
      check(prefix + 'fresh active warmup emits its first delayed notice', e.messages.some(x => /预热/.test(x)));
      e.window.localStorage.setItem(START_KEY, '1');
      e.ns.warmup.acknowledge();
      e.messages.length = 0;
      await e.advance(12000);
      check(prefix + 'confirmation cancels already-scheduled follow-up notices', !e.messages.some(x => /预热|首次使用已默认关闭/.test(x)));
    } finally { e.close(); }
  }
}

(async () => {
  for (const artifact of artifacts) await scenarios(artifact);
  console.log('结论: ' + (failures ? 'FAIL' : 'PASS') + ' — warmup persistence (' + assertions + ' assertions, ' + artifacts.length + ' artifacts)');
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
