// 回归：混淆字体解码（_quizDecodeSecretText）——v4.19.7 实测截图只剩 ABCD（透明色/text-shadow 混淆
// html2canvas 渲染为空）→ 需从 DOM 假字还原真实文本发给 DeepSeek。
// 仿真：用假 canvas 模拟「字体映射」——假字 = 真实字码点 + 0x1000，getImageData 按有效码点返回像素模式
// （同字形同模式，跨真实/假字码点一致），验证解码往返。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const SHIFT = 0x1000;
let lastChar = '';
const fakeCtx = {
  clearRect() {},
  fillText(ch) { lastChar = String(ch); },
  getImageData() {
    const cp = lastChar.charCodeAt(0) || 0;
    const eff = (cp >= 0x4e00 + SHIFT && cp <= 0x9fa5 + SHIFT) ? cp - SHIFT : cp;   // 假字 → 真实码点（模拟字形映射）
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);   // 默认亮色；仅字形点置暗
    let s = (eff * 2654435761) >>> 0;                            // xorshift32：良好分布，无低比特退化
    s ^= s >>> 15; s = (s * 2246822519) >>> 0; s ^= s >>> 13;
    for (let i = 0; i < 60; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      const idx = (s % 400) * 4;
      data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
    }
    return { data };
  },
};

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx; };   // 假 canvas：模拟字体映射
win.eval(code);
const ns = win.__CX_FORCE_PLAY;

// 真实文本（选 <0x5E00 的安全码点，避免与「假字区 [0x5E00,0xAFA5]」重叠造成仿真歧义）：
const REAL = '中出大';
const FAKE = REAL.split('').map((c) => String.fromCharCode(c.charCodeAt(0) + SHIFT)).join('');
const el = win.document.createElement('div');
el.style.fontFamily = 'font-cxsecret';
el.textContent = FAKE + ' A B C';

let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}

(async () => {
  const out = await ns._quizDecodeSecretText(el);
  assert('假字还原为真实文本', out.indexOf(REAL) === 0, out.slice(0, 30));
  assert('ASCII/字母透传', out.indexOf(' A B C') >= 0, out.slice(0, 30));
  assert('长度一致', out.length === el.textContent.length, out.length + ' vs ' + el.textContent.length);
  // 幂等：二次调用走缓存，结果一致
  const out2 = await ns._quizDecodeSecretText(el);
  assert('缓存命中结果一致', out2 === out, out2.slice(0, 30));
  // 无字体（computed style 无族名）→ 原样回退
  const el2 = win.document.createElement('div');
  el2.textContent = 'ABCDE';
  const out3 = await ns._quizDecodeSecretText(el2);
  assert('无字体回退原文', out3 === 'ABCDE', out3);
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  dom.window.close();
  process.exit(fail ? 1 : 0);
})();
