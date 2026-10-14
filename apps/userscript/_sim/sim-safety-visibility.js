'use strict';

// Actual distributions: hidden challenges must not trip, while any visible
// challenge or unknown CSS state must still stop automation. No network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const products = require('../scripts/project-paths.cjs');
const arg = process.argv.indexOf('--artifact');
const artifacts = arg >= 0 ? [path.resolve(process.argv[arg + 1])]
  : process.env.CX_SIM_ARTIFACT ? [path.resolve(process.env.CX_SIM_ARTIFACT)]
    : [products.personalProduct, products.openProduct];
let assertions = 0, failures = 0;
function check(name, value) {
  assertions++;
  if (!value) failures++;
  console.log((value ? 'PASS ' : 'FAIL ') + name);
}
const cases = [
  ['visible selector', '<div class="yidun"></div>', true],
  ['display none', '<div class="yidun" style="display:none"></div>', false],
  ['visibility hidden', '<div class="yidun" style="visibility:hidden"></div>', false],
  ['visibility collapse', '<div class="yidun" style="visibility:collapse"></div>', false],
  ['opacity zero', '<div class="yidun" style="opacity:0"></div>', false],
  ['ancestor display none', '<section style="display:none"><div class="yidun" style="display:block"></div></section>', false],
  ['ancestor opacity zero', '<section style="opacity:0"><div class="yidun" style="opacity:1"></div></section>', false],
  ['inherited hidden visibility', '<section style="visibility:hidden"><div class="yidun"></div></section>', false],
  ['child overrides ancestor hidden visibility', '<section style="visibility:hidden"><div class="yidun" style="visibility:visible"></div></section>', true],
  ['visible child inside hidden challenge container', '<div class="yidun" style="visibility:hidden"><span style="visibility:visible">验证控件</span></div>', true],
  ['hidden first visible second match', '<div class="yidun" style="display:none"></div><div class="yidun"></div>', true],
  ['visible keyword', '<div class="popup">验证码</div>', true],
  ['hidden keyword', '<div class="popup" style="visibility:hidden">验证码</div>', false],
  ['empty rendered keyword text ignores hidden textContent', '<div class="popup"><span style="visibility:hidden">验证码</span></div>', false, 'empty-inner-text'],
  ['ancestor hides keyword', '<section style="display:none"><div class="popup">验证码</div></section>', false],
  ['later visible keyword', '<div class="popup" style="display:none">验证码</div><div class="popup">人机验证</div>', true],
  ['unknown computed style conservatively stops', '<div class="yidun"></div>', true, 'throw-style']
];

for (const artifact of artifacts) {
  const code = fs.readFileSync(artifact, 'utf8');
  for (const [name, html, expected, prepare] of cases) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1',
      runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
    const w = dom.window;
    w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    w.HTMLMediaElement.prototype.pause = function () {};
    w.HTMLMediaElement.prototype.load = function () {};
    w.fetch = function () { return Promise.reject(new Error('Network disabled')); };
    w.XMLHttpRequest = class { open() {} send() { throw new Error('Network disabled'); } abort() {} };
    // Reproduce Chromium's nonempty rect on visibility:hidden / opacity:0;
    // layout rectangles cannot override computed visibility.
    w.Element.prototype.getClientRects = function () {
      return this.closest('[style*="display:none"]') ? [] : [{ width: 160, height: 40 }];
    };
    vm.runInContext(code, dom.getInternalVMContext(), { filename: artifact });
    const ns = w.__CX_FORCE_PLAY;
    try {
      ns.stopLoopTimer();
      w.document.body.innerHTML = html;
      if (prepare === 'throw-style') w.getComputedStyle = function () { throw new Error('Unknown CSS'); };
      if (prepare === 'empty-inner-text') w.document.querySelector('.popup').innerText = '';
      const label = path.basename(artifact) + ' — ' + name;
      check(label + ' detection', !!ns.safetyDetect(w.document) === expected);
      ns.safetyScan();
      check(label + ' actual safety trip', ns.SAFETY.tripped === expected);
      check(label + ' runtime state', ns.CoreState.state() === (expected ? 'SAFETY_STOPPED' : 'RUNNING'));
    } finally {
      if (ns && ns.uninstall) ns.uninstall();
      w.close();
    }
  }
}
console.log('Assertions=' + assertions + ' failures=' + failures);
console.log('结论: ' + (failures ? 'FAIL' : 'PASS'));
process.exitCode = failures ? 1 : 0;
