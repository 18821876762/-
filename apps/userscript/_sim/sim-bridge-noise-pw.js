'use strict';
// Real browser bridge contract: disabled means no requests; enabling the core
// and auto-next clients must not amplify requests when same-origin frames grow.
// Successful shared playlists must still reach each frame's own chapter/targets.
// All page and bridge requests are local fixtures; every fallback is aborted.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const products = require('../scripts/project-paths.cjs');
const artifactArg = process.argv.indexOf('--artifact');
const artifacts = artifactArg >= 0 ? [path.resolve(process.argv[artifactArg + 1])]
  : process.env.CX_SIM_ARTIFACT ? [path.resolve(process.env.CX_SIM_ARTIFACT)]
    : [products.personalProduct, products.openProduct];
const executableArg = process.argv.indexOf('--browser-executable');
const executable = executableArg >= 0 ? path.resolve(process.argv[executableArg + 1])
  : process.env.CX_BROWSER_EXECUTABLE || chromium.executablePath();
const HOST = 'https://mooc1.chaoxing.com';
const TOP_URL = HOST + '/mycourse/studentstudy?courseId=42&chapterId=10';
const CHILD_URL = HOST + '/ananas/modules/video/index.html?courseId=42&chapterId=';
let pass = 0, fail = 0, browser;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ('  → ' + extra) : '')); }
}

function initialize(scenario) {
  window.GM_setValue = function () {};
  window.GM_getValue = function (key, fallback) { return fallback; };
  window.GM_addValueChangeListener = function () { return 0; };
  window.GM_removeValueChangeListener = function () {};
  window.unsafeWindow = window;
  localStorage.setItem('cx_bridge_on', scenario.bridge ? '1' : '0');
  localStorage.setItem('cx_an_on', scenario.autoNext ? '1' : '0');
  if (scenario.forceOff) localStorage.setItem('cx_bridge_off', '1');
  else localStorage.removeItem('cx_bridge_off');
}

async function scenario(source, config, name, frameCount, options) {
  const ctx = await browser.newContext();
  const requests = [], errors = [], unexpected = [];
  const topHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body><div class="ans-attach-ct"></div>' +
    Array.from({ length: frameCount - 1 }, (_, index) => '<iframe src="' + CHILD_URL + (11 + index) + '"></iframe>').join('') + '</body></html>';
  const childHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body><div class="ans-attach-ct"><video controls></video></div></body></html>';
  const playlist = { chapters: [10, 11, 12, 13].map(id => ({ knowledgeId: String(id), title: 'fixture-' + id, completed: id % 2 === 1, unfinishedCount: id % 2 === 1 ? 0 : 1, objectids: ['object-' + id] })) };
  const workingPort = String(config.ports[config.ports.length - 1]);
  await ctx.route('**/*', route => {
    const request = route.request(), url = request.url();
    if (url === TOP_URL) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: topHtml });
    if (url.indexOf(CHILD_URL) === 0) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: childHtml });
    if (/^http:\/\/127\.0\.0\.1:\d+\/(ping|playlist\/)/.test(url)) {
      const parsed = new URL(url), topFrame = !request.frame().parentFrame();
      requests.push({ url, topFrame, frameUrl: request.frame().url() });
      if (options.online && parsed.port === workingPort) {
        return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-private-network': 'true' }, body: JSON.stringify(parsed.pathname === '/ping' ? { version: config.version } : playlist) });
      }
      return route.abort('connectionrefused');
    }
    unexpected.push(url);
    return route.abort('blockedbyclient');
  });
  // The product declares document-idle. Load all fixture documents first, then
  // inject into every real platform frame, as the userscript manager does.
  // Running the complete product from document-start init scripts disrupts
  // sibling-frame construction in this synthetic page before they can inject.
  const injection = 'if (location.href === ' + JSON.stringify(TOP_URL) +
    ' || location.href.indexOf(' + JSON.stringify(CHILD_URL) + ') === 0) {\n' +
    'window.__cxBridgeFixtureInjectedHref = location.href;\n(' + initialize.toString() +
    ')(' + JSON.stringify(options) + ');\n' + source + '\n}';
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(TOP_URL, { waitUntil: 'load' });
  for (const frame of page.frames()) await frame.evaluate(injection);
  await page.waitForTimeout(options.bridge && !options.forceOff ? 1600 : 500);
  const initialCount = requests.length;
  // Exercise repeated public initialization after the first request group settles,
  // plus normal scheduling, rather than relying on obsolete booted console logs.
  for (const frame of page.frames()) {
    await frame.evaluate(() => {
      const bridge = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit.bridge;
      if (bridge) { bridge.bridgeInit(); bridge.bridgeInit(); }
    });
  }
  await page.waitForTimeout(options.bridge && !options.forceOff ? 1600 : 300);
  const states = [];
  for (const frame of page.frames()) {
    states.push(await frame.evaluate(() => {
      const ns = window.__CX_FORCE_PLAY, state = window.EventBus && window.EventBus.state;
      const bridge = state && state.BRIDGE, target = state && state.TARGET;
      return { url: location.href, injectedHref: window.__cxBridgeFixtureInjectedHref, namespace: !!ns, started: !!(ns && ns.started), version: ns && ns.version, runtime: ns && ns.CoreState.state(), chapter: bridge && bridge.chapter, skipResume: bridge && bridge.skipResume, base: bridge && bridge.base, targetIds: target && target.ids ? Object.keys(target.ids) : [] };
    }));
  }
  const pings = requests.filter(request => /\/ping$/.test(request.url));
  const successfulPlaylists = requests.filter(request => new URL(request.url).port === workingPort && /\/playlist\//.test(request.url));
  const label = config.label + ' — ' + name;
  console.log('OBSERVATION ' + JSON.stringify({ name, frameCount, initialCount, requestCount: requests.length, pings: pings.length, requests, states }));
  check(label + ' frame count=' + frameCount, page.frames().length === frameCount);
  check(label + ' all actual platform frames receive fixture injection', states.every(state => state.injectedHref === state.url), states);
  check(label + ' each namespace/version/state is current', states.every(state => state.namespace && state.started && state.version === config.version && state.runtime === 'RUNNING'), states);
  check(label + ' zero uncaught errors', errors.length === 0, errors);
  check(label + ' all traffic uses fixtures', unexpected.length === 0, unexpected);
  if (!options.bridge || options.forceOff) {
    check(label + ' disabled bridge sends zero requests', requests.length === 0, requests);
  } else {
    check(label + ' enabled bridge actually probes', pings.length > 0);
    check(label + ' every candidate comes from actual CONST', pings.every(request => config.ports.map(String).includes(new URL(request.url).port)), pings);
    check(label + ' child frames do not originate bridge traffic', requests.every(request => request.topFrame), requests);
    check(label + ' repeated init does not repeat settled requests', requests.length === initialCount, requests);
    if (options.online) {
      check(label + ' successful playlist fetched once', successfulPlaylists.length === 1, successfulPlaylists);
      for (const state of states) {
        const chapterId = new URL(state.url).searchParams.get('chapterId');
        check(label + ' frame consumes own chapter ' + chapterId, state.chapter && String(state.chapter.knowledgeId) === chapterId && state.chapter.title === 'fixture-' + chapterId, state);
        check(label + ' frame consumes own objectids ' + chapterId, state.targetIds.includes('object-' + chapterId), state);
        check(label + ' frame completion avoidance matches ' + chapterId, state.skipResume === (Number(chapterId) % 2 === 1), state);
      }
    } else {
      check(label + ' unavailable bridge visits all configured candidates', new Set(pings.map(request => new URL(request.url).port)).size === config.ports.length, pings);
    }
  }
  await ctx.close();
  return { requests: requests.length, pings: pings.length, playlists: successfulPlaylists.length };
}

(async () => {
  if (!fs.existsSync(executable)) throw new Error('Chromium executable unavailable: ' + executable);
  browser = await chromium.launch({ executablePath: executable, headless: true });
  console.log('BROWSER: Chromium ' + browser.version() + ' executable=' + executable);
  for (const artifact of artifacts) {
    const source = fs.readFileSync(artifact, 'utf8');
    const portMatch = source.match(/\bBRIDGE_PROBE_PORTS\s*:\s*(\[[0-9,\s]+\])/);
    if (!portMatch) throw new Error('Cannot read actual bridge candidate configuration');
    const config = { label: path.basename(artifact), ports: JSON.parse(portMatch[1]), version: (source.match(/\/\/\s*@version\s+(\S+)/) || [])[1] };
    check(config.label + ' actual bridge ports are valid', config.ports.length > 0 && new Set(config.ports).size === config.ports.length);
    await scenario(source, config, 'default bridge off', 4, { bridge: false, autoNext: true });
    await scenario(source, config, 'force-off overrides explicit enable', 4, { bridge: true, forceOff: true, autoNext: true });
    for (const autoNext of [false, true]) {
      const options = { bridge: true, autoNext, online: false };
      const single = await scenario(source, config, 'offline single frame autoNext=' + autoNext, 1, options);
      const multiple = await scenario(source, config, 'offline four frames autoNext=' + autoNext, 4, options);
      check(config.label + ' offline request count does not amplify autoNext=' + autoNext, single.requests === multiple.requests && single.pings === multiple.pings, { single, multiple });
    }
    const online = { bridge: true, autoNext: true, online: true };
    const single = await scenario(source, config, 'successful single frame', 1, online);
    const multiple = await scenario(source, config, 'successful four frames', 4, online);
    check(config.label + ' successful request count does not amplify', single.requests === multiple.requests && single.pings === multiple.pings && single.playlists === multiple.playlists, { single, multiple });
  }
  await browser.close();
  browser = null;
  console.log('PASS=' + pass + ' FAIL=' + fail);
  console.log('结论: ' + (fail ? 'FAIL' : 'PASS'));
  process.exitCode = fail ? 1 : 0;
})().catch(async error => {
  console.error('RUN_FAIL:', error.stack || String(error));
  if (browser) await browser.close().catch(() => {});
  process.exitCode = 2;
});
