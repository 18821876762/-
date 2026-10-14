'use strict';

// Real layout regression. All routes are synthetic fixtures and every fallback
// request is aborted. No user profile, external platform or submission is used.
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
let assertions = 0, failures = 0;
function check(name, condition, detail) {
  assertions++;
  if (!condition) failures++;
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (!condition && detail !== undefined) console.log(JSON.stringify(detail));
}
const cases = [
  ['visible selector', '<div class="yidun"></div>', true],
  ['display none', '<div class="yidun" style="display:none"></div>', false],
  ['visibility hidden with layout box', '<div class="yidun" style="visibility:hidden"></div>', false],
  ['visibility collapse', '<div class="yidun" style="visibility:collapse"></div>', false],
  ['opacity zero with layout box', '<div class="yidun" style="opacity:0"></div>', false],
  ['ancestor display none cannot be overridden', '<section style="display:none"><div class="yidun" style="display:block"></div></section>', false],
  ['ancestor opacity zero cannot be overridden', '<section style="opacity:0"><div class="yidun" style="opacity:1"></div></section>', false],
  ['inherited hidden visibility', '<section style="visibility:hidden"><div class="yidun"></div></section>', false],
  ['explicit child visible overrides ancestor hidden', '<section style="visibility:hidden"><div class="yidun" style="visibility:visible"></div></section>', true],
  ['hidden challenge has visible descendant', '<div class="yidun" style="visibility:hidden"><span style="visibility:visible">验证控件</span></div>', true],
  ['hidden first visible second selector match', '<div class="yidun" style="display:none"></div><div class="yidun"></div>', true],
  ['visible keyword', '<div class="popup">验证码</div>', true],
  ['hidden keyword with layout box', '<div class="popup" style="visibility:hidden">验证码</div>', false],
  ['keyword hidden by ancestor', '<section style="display:none"><div class="popup">验证码</div></section>', false],
  ['visible keyword descendant overrides hidden popup', '<div class="popup" style="visibility:hidden"><span style="visibility:visible">验证码</span></div>', true],
  ['invisible keyword child inside visible popup', '<div class="popup"><span style="visibility:hidden">验证码</span></div>', false],
  ['hidden first visible second keyword match', '<div class="popup" style="display:none">验证码</div><div class="popup">人机验证</div>', true],
  ['unknown CSS stays conservative', '<div class="yidun"></div>', true, 'throw-style']
];
function initialize() {
  window.GM_setValue = function () {};
  window.GM_getValue = function (key, fallback) { return fallback; };
  window.GM_addValueChangeListener = function () { return 0; };
  window.GM_removeValueChangeListener = function () {};
  window.unsafeWindow = window;
}
let browser;
(async function () {
  if (!fs.existsSync(executable)) throw new Error('Chromium executable unavailable: ' + executable);
  browser = await chromium.launch({ executablePath: executable, headless: true });
  console.log('BROWSER: Chromium ' + browser.version() + ' executable=' + executable);
  for (const artifact of artifacts) {
    const source = fs.readFileSync(artifact, 'utf8');
    for (const [name, html, expected, prepare] of cases) {
      const context = await browser.newContext();
      const errors = [], unexpected = [];
      const url = 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html';
      await context.route('**/*', function (route) {
        if (route.request().url() === url) {
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"><style>.yidun,.popup{width:160px;min-height:40px}</style></head><body></body></html>' });
        }
        unexpected.push(route.request().url());
        return route.abort('blockedbyclient');
      });
      await context.addInitScript({ content: '(' + initialize.toString() + ')();\n' + source });
      const page = await context.newPage();
      page.on('pageerror', function (error) { errors.push(String(error)); });
      await page.goto(url, { waitUntil: 'load' });
      const observation = await page.evaluate(function (fixture) {
        const ns = window.__CX_FORCE_PLAY;
        ns.stopLoopTimer();
        document.body.innerHTML = fixture.html;
        const layout = Array.from(document.querySelectorAll('.yidun,.popup')).map(function (element) {
          const style = getComputedStyle(element);
          return { rectCount: element.getClientRects().length, display: style.display, visibility: style.visibility, opacity: style.opacity, innerText: element.innerText, textContent: element.textContent };
        });
        if (fixture.prepare === 'throw-style') window.getComputedStyle = function () { throw new Error('Unknown CSS fixture'); };
        const detected = ns.safetyDetect(document);
        ns.safetyScan();
        return { detected, tripped: ns.SAFETY.tripped, state: ns.CoreState.state(), layout };
      }, { html, prepare });
      const label = path.basename(artifact) + ' — ' + name;
      console.log('OBSERVATION ' + JSON.stringify({ artifact: path.basename(artifact), name, expected, ...observation }));
      check(label + ' visible challenge detection', !!observation.detected === expected, observation);
      check(label + ' actual stopped/running state', observation.tripped === expected && observation.state === (expected ? 'SAFETY_STOPPED' : 'RUNNING'), observation);
      check(label + ' zero uncaught errors', errors.length === 0, errors);
      check(label + ' fixture-only network', unexpected.length === 0, unexpected);
      await context.close();
    }
  }
  await browser.close();
  browser = null;
  console.log('Assertions=' + assertions + ' failures=' + failures);
  console.log('结论: ' + (failures ? 'FAIL' : 'PASS'));
  process.exitCode = failures ? 1 : 0;
})().catch(async function (error) {
  console.error('RUN_FAIL:', error.stack || String(error));
  if (browser) await browser.close().catch(function () {});
  process.exitCode = 2;
});
