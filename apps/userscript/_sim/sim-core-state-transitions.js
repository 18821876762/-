'use strict';

// Load each complete distribution and exercise the stopped/disabled/disposed
// boundaries through real DOM events and asynchronous media callbacks. No network.
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
let failures = 0;
let assertions = 0;
function check(name, condition) {
  assertions++;
  if (!condition) failures++;
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function load(artifact, preConfig, initialVideo, prepare) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1',
    runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  const media = new WeakMap();
  const proto = window.HTMLMediaElement.prototype;
  function getMedia(v) {
    if (!media.has(v)) media.set(v, { paused: true, ended: false, readyState: 4, duration: 120, playCalls: 0 });
    return media.get(v);
  }
  ['paused', 'ended', 'readyState', 'duration'].forEach(key => {
    Object.defineProperty(proto, key, { configurable: true, get() { return getMedia(this)[key]; } });
  });
  proto.pause = function () { getMedia(this).paused = true; };
  proto.play = function () {
    const s = getMedia(this);
    s.playCalls++;
    if (s.playResult) return s.playResult();
    s.paused = false;
    return Promise.resolve();
  };
  proto.load = function () {};
  window.HTMLCanvasElement.prototype.getContext = function () { return null; };
  window.fetch = () => Promise.reject(new Error('Offline simulation: network disabled'));
  window.XMLHttpRequest = class { open() {} send() { throw new Error('Offline simulation: network disabled'); } abort() {} };
  window.localStorage.setItem('cx_panel_cfg', JSON.stringify(Object.assign({ BRIDGE_ENABLED: false }, preConfig)));
  function video(id, playing) {
    const v = window.document.createElement('video');
    v.id = id;
    v.src = 'https://mooc1.chaoxing.com/' + id + '.mp4';
    v.currentTime = 10;
    getMedia(v).paused = !playing;
    window.document.body.appendChild(v);
    return v;
  }
  const v = initialVideo ? video('initial', initialVideo.playing) : null;
  if (v && initialVideo.playResult) getMedia(v).playResult = initialVideo.playResult;
  if (prepare) prepare(window);
  vm.runInContext(fs.readFileSync(artifact, 'utf8'), dom.getInternalVMContext(), { filename: artifact });
  const ns = window.__CX_FORCE_PLAY;
  return {
    dom, window, ns, core: ns && ns.CoreState, video, getMedia, initial: v,
    close() { try { if (ns && ns.uninstall) ns.uninstall(); } finally { window.close(); } },
  };
}

async function scenarios(artifact) {
  const label = path.basename(artifact) + ' — ';
  let e = load(artifact);
  try {
    const { core, ns, window } = e;
    check(label + 'CoreState is exposed', !!core && typeof core.canRun === 'function');
    if (!core) return;
    check(label + 'initialized state is RUNNING', core.state() === 'RUNNING' && core.canRun());
    const snapshot = core.getSnapshot();
    check(label + 'snapshot has state, reason and epoch', snapshot.state === 'RUNNING' && typeof snapshot.reason === 'string' && Number.isFinite(snapshot.epoch));

    const a = core.capture('sim.scope.a');
    const b = core.capture('sim.scope.b');
    let cancelled = 0;
    const off = core.onCancel('sim.scope.a', () => cancelled++);
    core.invalidateScope('sim.scope.a', 'simulation');
    check(label + 'scope invalidation rejects its old token', !core.valid(a));
    check(label + 'scope invalidation preserves another scope', core.valid(b));
    check(label + 'scope cancellation calls its listener', cancelled === 1 && typeof off === 'function');
    off();
    core.invalidateScope('sim.scope.a', 'after-unsubscribe');
    check(label + 'onCancel unsubscribe removes listener', cancelled === 1);

    const beforeStop = core.capture('sim.stop-resume');
    const old = e.video('before-stop', true);
    old.dispatchEvent(new window.Event('play'));
    check(label + 'running play event takes over video', old[ns.FLAGS.forcePaused] === true);
    ns.safetyTrip('synthetic verification');
    check(label + 'safety trip enters SAFETY_STOPPED', core.state() === 'SAFETY_STOPPED' && !core.canRun());
    check(label + 'safety trip releases existing video', old[ns.FLAGS.forcePaused] !== true);
    check(label + 'safety trip stops main-loop timer', !window.EventBus.state._loopTimer);
    old.dispatchEvent(new window.Event('play'));
    const fresh = e.video('after-stop', true);
    fresh.dispatchEvent(new window.Event('play'));
    await wait(60);
    check(label + 'stopped play event does not reengage old video', old[ns.FLAGS.forcePaused] !== true);
    check(label + 'stopped play/MO does not take over new video', fresh[ns.FLAGS.forcePaused] !== true);
    const intervalsAtStop = ns.TimerRegistry.stats().intervals;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await wait(20);
    check(label + 'stopped visibility event does not restart main loop', !window.EventBus.state._loopTimer);
    check(label + 'stopped visibility event does not add an interval', ns.TimerRegistry.stats().intervals === intervalsAtStop);

    check(label + 'manual resume returns true', ns.safetyResume() === true);
    check(label + 'manual resume reenters RUNNING', core.state() === 'RUNNING' && core.canRun());
    check(label + 'stop/resume never revives an old token', !core.valid(beforeStop));
    check(label + 'resumed state accepts a new token', core.valid(core.capture('sim.stop-resume')));

    ns.setTakeoverEnabled(false);
    check(label + 'global disable enters DISABLED', core.state() === 'DISABLED' && !core.canRun());
    const disabled = e.video('disabled-insert', true);
    disabled.dispatchEvent(new window.Event('play'));
    await wait(60);
    check(label + 'disabled play/MO leaves new video native', disabled[ns.FLAGS.forcePaused] !== true);
    ns.setTakeoverEnabled(true);
    check(label + 'global reenable enters RUNNING', core.state() === 'RUNNING' && core.canRun());

    ns.CONFIG.DISABLED_COURSES = ['1'];
    check(label + 'canRun notices direct course-list change', !core.canRun() && core.state() === 'DISABLED');
    ns.CONFIG.DISABLED_COURSES = [];
    check(label + 'canRun notices course-list removal', core.canRun() && core.state() === 'RUNNING');
    window.localStorage.setItem('cx_force_off', '1');
    check(label + 'canRun honors page force-off', !core.canRun() && core.state() === 'DISABLED');
    window.localStorage.removeItem('cx_force_off');
    check(label + 'canRun notices page opt-out removal', core.canRun());

    const disposalToken = core.capture('sim.dispose');
    core.dispose();
    const disposedEpoch = core.getSnapshot().epoch;
    core.dispose();
    check(label + 'dispose is an idempotent terminal state', core.state() === 'DISPOSED' && core.getSnapshot().epoch === disposedEpoch);
    check(label + 'disposed core rejects old tokens and actions', !core.valid(disposalToken) && !core.canRun());
    ns.CONFIG.ENABLED = true;
    ns.safetyResume();
    ns.restartLoopTimer();
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    check(label + 'resume/restart cannot leave DISPOSED', core.state() === 'DISPOSED' && !core.canRun());
    ns.uninstall();
    ns.uninstall();
    check(label + 'uninstall remains idempotent and removes namespace', !window.__CX_FORCE_PLAY && core.state() === 'DISPOSED');
    check(label + 'uninstall clears registered timers', ns.TimerRegistry.stats().intervals === 0 && ns.TimerRegistry.stats().timeouts === 0);
  } finally { e.close(); }

  // Capture the actual initial play Promise, stop before its rejection, then let
  // the rejection arrive. This regression previously performed a second play.
  const rejectInitial = [];
  let mediaCalls = 0;
  let stopped = false;
  e = load(artifact, null, {
    playing: false,
    playResult() {
      mediaCalls++;
      if (!stopped) return new Promise((resolve, reject) => { rejectInitial.push(reject); });
      return Promise.resolve();
    },
  });
  try {
    if (mediaCalls === 0) e.initial.dispatchEvent(new e.window.Event('play'));
    const callsBeforeStop = mediaCalls;
    check(label + 'late-rejection scenario captured pending media calls', callsBeforeStop > 0 && rejectInitial.length === callsBeforeStop);
    e.ns.safetyTrip('synthetic verification');
    stopped = true;
    for (const reject of rejectInitial) reject(new Error('Synthetic autoplay rejection'));
    await wait(20);
    check(label + 'late play rejection does not retry after stop', mediaCalls === callsBeforeStop);
    check(label + 'late play rejection retains stopped state', e.core && e.core.state() === 'SAFETY_STOPPED');
  } finally { e.close(); }

  e = load(artifact, { ENABLED: false }, { playing: true });
  try {
    check(label + 'persisted disable is effective during initialization', e.core && e.core.state() === 'DISABLED' && !e.core.canRun());
    check(label + 'initial scan does not take over an initially disabled video', e.initial[e.ns.FLAGS.forcePaused] !== true);
  } finally { e.close(); }

  // The same-origin course iframe owns a separate runtime. Its actions must
  // still respect the controller above it, including a stop/resume cycle that
  // occurs entirely between two reads of the child runtime.
  e = load(artifact);
  let childNs;
  try {
    const frame = e.window.document.createElement('iframe');
    e.window.document.body.appendChild(frame);
    const child = frame.contentWindow;
    child.fetch = () => Promise.reject(new Error('Offline simulation: network disabled'));
    child.XMLHttpRequest = class { open() {} send() { throw new Error('Offline simulation: network disabled'); } abort() {} };
    child.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    child.HTMLMediaElement.prototype.pause = function () {};
    child.HTMLCanvasElement.prototype.getContext = function () { return null; };
    child.eval(fs.readFileSync(artifact, 'utf8'));
    childNs = child.__CX_FORCE_PLAY;
    const childCore = childNs && childNs.CoreState;
    check(label + 'same-origin iframe has its own running CoreState', !!childCore && childCore !== e.core && childCore.canRun());
    if (childCore) {
      const inheritedToken = childCore.capture('sim.parent-stop');
      e.ns.safetyTrip('synthetic parent verification');
      check(label + 'parent safety stop blocks child actions', !childCore.canRun());
      check(label + 'parent safety stop invalidates child token', !childCore.valid(inheritedToken));
      childNs.CONFIG.ENABLED = true;
      check(label + 'child enabling cannot override stopped parent', !childCore.canRun());
      e.ns.safetyResume();
      check(label + 'parent resume allows child new actions', childCore.canRun());
      check(label + 'parent resume does not revive stopped child token', !childCore.valid(inheritedToken));

      const unobservedToken = childCore.capture('sim.parent-unobserved');
      // Do not inspect the child state between these two parent transitions.
      e.ns.safetyTrip('unobserved parent verification');
      e.ns.safetyResume();
      check(label + 'child can run after unobserved parent stop/resume', childCore.canRun());
      check(label + 'unobserved parent stop/resume still expires old child token', !childCore.valid(unobservedToken));
      check(label + 'new child token after parent resume is valid', childCore.valid(childCore.capture('sim.parent-unobserved')));

      e.ns.setTakeoverEnabled(false);
      check(label + 'parent global disable also blocks child actions', !childCore.canRun());
      e.ns.setTakeoverEnabled(true);
      check(label + 'parent reenable permits child actions again', childCore.canRun());

      const challengeToken = childCore.capture('sim.child-challenge');
      const challenge = child.document.createElement('div');
      challenge.className = 'yidun_popup';
      challenge.textContent = '请完成安全验证';
      child.document.body.appendChild(challenge);
      e.ns.safetyScan();
      check(label + 'challenge inside same-origin iframe stops parent', e.ns.SAFETY.tripped && e.core.state() === 'SAFETY_STOPPED');
      check(label + 'iframe challenge stops child and expires child token', !childCore.canRun() && !childCore.valid(challengeToken));
      challenge.remove();
      check(label + 'manual resume after removing iframe challenge succeeds', e.ns.safetyResume() === true && e.core.canRun() && childCore.canRun());
      check(label + 'iframe challenge resume never revives old child token', !childCore.valid(challengeToken));
    }
  } finally {
    try { if (childNs && childNs.uninstall) childNs.uninstall(); } finally { e.close(); }
  }

  // A platform replacing its own pause wrapper while running owns that new
  // value. Stopping must preserve it rather than restore the older snapshot.
  const originalGlobalPause = function originalGlobalPause() {};
  const platformPatch = function platformPatch() {};
  const platform = { pause: originalGlobalPause };
  e = load(artifact, null, null, window => { window.ananas = platform; });
  try {
    check(label + 'running controller neutralizes platform pause wrapper', platform.pause !== originalGlobalPause);
    platform.pause = platformPatch;
    e.ns.setTakeoverEnabled(false);
    check(label + 'disable preserves a newer platform pause patch', platform.pause === platformPatch);
    check(label + 'newer platform pause patch clears obsolete metadata', !('__cxAnanasNativePause' in platform));
  } finally { e.close(); }

  // Parent scanning records the iframe wrapper first and the parent wrapper
  // second. A read-only first wrapper must not prevent restoring the second.
  let lockedNativeCalls = 0;
  const lockedNativePause = function () { lockedNativeCalls++; return 'native-pause'; };
  const regularNativePause = function regularNativePause() {};
  const locked = { pause: lockedNativePause };
  const regular = { pause: regularNativePause };
  e = load(artifact, null, null, window => {
    const frame = window.document.createElement('iframe');
    window.document.body.appendChild(frame);
    frame.contentWindow.ananas = locked;
    window.ananas = regular;
  });
  try {
    check(label + 'both platform pause fixtures were neutralized', locked.pause !== lockedNativePause && regular.pause !== regularNativePause);
    Object.defineProperty(locked, 'pause', { value: locked.pause, writable: false, configurable: false });
    e.ns.safetyTrip('synthetic locked-wrapper verification');
    check(label + 'read-only first wrapper does not block restoring second wrapper', regular.pause === regularNativePause);
    check(label + 'read-only stopped wrapper delegates to saved native pause', locked.pause() === 'native-pause' && lockedNativeCalls === 1);
  } finally { e.close(); }

  for (const stopMode of ['safety', 'disable']) {
    const originalHandler = function originalHandler() {};
    const laterHandler = function laterHandler() {};
    const mediaSession = {
      pause: originalHandler, playbackState: 'none',
      getActionHandler(action) { return action === 'pause' ? this.pause : null; },
      setActionHandler(action, handler) { if (action === 'pause') this.pause = handler; },
    };
    e = load(artifact, null, { playing: true }, window => {
      Object.defineProperty(window.navigator, 'mediaSession', { value: mediaSession, configurable: true });
    });
    try {
      const prefix = label + stopMode + ' — ';
      check(prefix + 'running video installs MediaSession pause guard', mediaSession.pause !== originalHandler && mediaSession.playbackState === 'playing');
      if (stopMode === 'safety') e.ns.safetyTrip('synthetic MediaSession verification');
      else e.ns.setTakeoverEnabled(false);
      check(prefix + 'stop restores MediaSession pause handler', mediaSession.pause === originalHandler);
      check(prefix + 'stop restores MediaSession playback state', mediaSession.playbackState === 'none');
      mediaSession.pause = laterHandler;
      mediaSession.playbackState = 'paused';
      if (stopMode === 'safety') e.ns.safetyResume();
      else e.ns.setTakeoverEnabled(true);
      e.initial.dispatchEvent(new e.window.Event('play'));
      check(prefix + 'reenabled video installs MediaSession guard again', mediaSession.pause !== laterHandler && mediaSession.playbackState === 'playing');
      e.ns.setTakeoverEnabled(false);
      check(prefix + 'next stop restores the latest platform handler', mediaSession.pause === laterHandler);
      check(prefix + 'next stop restores latest platform playback state', mediaSession.playbackState === 'paused');
    } finally { e.close(); }
  }

  const opaqueMediaSession = {
    pause: function platformHandler() {}, playbackState: 'none',
    setActionHandler(action, handler) { if (action === 'pause') this.pause = handler; },
  };
  e = load(artifact, null, { playing: true }, window => {
    Object.defineProperty(window.navigator, 'mediaSession', { value: opaqueMediaSession, configurable: true });
  });
  try {
    check(label + 'MediaSession without handler getter still receives a guard', typeof opaqueMediaSession.pause === 'function' && opaqueMediaSession.playbackState === 'playing');
    e.ns.safetyTrip('synthetic opaque MediaSession verification');
    check(label + 'stopping opaque MediaSession clears script pause guard', opaqueMediaSession.pause === null);
    check(label + 'stopping opaque MediaSession restores playback state', opaqueMediaSession.playbackState === 'none');
  } finally { e.close(); }

  // Four controller-bearing frames previously caused 120 recursive ancestor
  // snapshot synchronizations per valid(). Guard the growth through the public
  // API rather than imposing machine-dependent timing limits.
  e = load(artifact);
  const descendants = [];
  const originals = [];
  try {
    const controllers = [e.core];
    let parent = e.window;
    const depth = 4;
    for (let i = 0; i < depth; i++) {
      const frame = parent.document.createElement('iframe');
      parent.document.body.appendChild(frame);
      const child = frame.contentWindow;
      child.fetch = () => Promise.reject(new Error('Offline simulation: network disabled'));
      child.XMLHttpRequest = class { open() {} send() { throw new Error('Offline simulation: network disabled'); } abort() {} };
      child.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      child.HTMLMediaElement.prototype.pause = function () {};
      child.HTMLCanvasElement.prototype.getContext = function () { return null; };
      child.eval(fs.readFileSync(artifact, 'utf8'));
      descendants.push(child.__CX_FORCE_PLAY);
      controllers.push(child.__CX_FORCE_PLAY.CoreState);
      parent = child;
    }
    let parentSnapshots = 0;
    for (const controller of controllers.slice(0, -1)) {
      const getSnapshot = controller.getSnapshot;
      originals.push([controller, getSnapshot]);
      controller.getSnapshot = function () { parentSnapshots++; return getSnapshot(); };
    }
    const deepest = controllers[controllers.length - 1];
    const token = deepest.capture('sim.deep-lineage');
    parentSnapshots = 0;
    check(label + 'nested-frame token is valid', deepest.valid(token));
    check(label + 'nested-frame validation avoids exponential ancestor resynchronization', parentSnapshots <= depth * 4);
  } finally {
    for (const [controller, getSnapshot] of originals) controller.getSnapshot = getSnapshot;
    try {
      for (const ns of descendants.reverse()) if (ns && ns.uninstall) ns.uninstall();
    } finally { e.close(); }
  }
}

(async () => {
  for (const artifact of artifacts) await scenarios(artifact);
  console.log('结论: ' + (failures ? 'FAIL' : 'PASS') + ' — CoreState transitions (' + assertions + ' assertions, ' + artifacts.length + ' artifacts)');
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
