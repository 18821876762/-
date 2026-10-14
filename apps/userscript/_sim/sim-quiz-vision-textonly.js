// 回归：v4.19.15 空白截图兜底——
// deepseek-web 模式下，题目截图疑似空白（html2canvas 对视口外/混淆字体透明色渲染为空）时，
// 不再整题拒绝（导致信号灯变红、DS 从未收到请求），而是改用「混淆字体解码文本」单独问 DS（text-only），
// 截图缺失由提示词显式说明，避免把空白图发给 AI 造成错答。
// 覆盖：
//   ① deepseek-web + 空白截图 + 解码成功 → 仍作答(imgSkipped=true, decodeOk=true)，仅文本发给 DS；
//   ② deepseek-web + 空白截图 + 解码弱(无字体短文本) → 仍走 text-only 兜底作答，不硬拒绝；
//   ③ endpoint + 空白截图 → 仍 reject（endpoint 依赖截图，无文本兜底，保持原语义）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const SHIFT = 0x1000;
let lastChar = '';
const fakeCtx = {
  clearRect() {}, fillText(ch) { lastChar = String(ch); },
  getImageData() {
    const cp = lastChar.charCodeAt(0) || 0;
    const eff = (cp >= 0x4e00 + SHIFT && cp <= 0x9fa5 + SHIFT) ? cp - SHIFT : cp;
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    let s = (eff * 2654435761) >>> 0;
    s ^= s >>> 15; s = (s * 2246822519) >>> 0; s ^= s >>> 13;
    for (let i = 0; i < 60; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; const idx = (s % 400) * 4; data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255; }
    return { data };
  },
};
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1',
  runScripts: 'dangerously', pretendToBeVisual: true,
});
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx; };   // 假 canvas：模拟字体映射
win.eval(code);
const ns = win.__CX_FORCE_PLAY;

const REAL = '中出大';
const FAKE = REAL.split('').map((c) => String.fromCharCode(c.charCodeAt(0) + SHIFT)).join('');
function makeQuizEl() {
  const el = win.document.createElement('div');
  el.style.fontFamily = 'font-cxsecret';
  el.textContent = FAKE + ' A B C D';   // 混淆字体 + 选项字母
  // 请求生命周期要求题目仍在页面；挂载 fixture 后测试截图兜底，保留生产取消守卫。
  win.document.body.appendChild(el);
  return el;
}

let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}

(async () => {
  // ① deepseek-web + 空白截图 + 解码成功 → text-only 兜底，仍作答
  ns.CONFIG.QUIZ_VISION_OCR = 'deepseek-web';
  ns.DS_STATUS.connected = true; ns.DS_STATUS.loggedIn = true;
  ns.setQuizSnapshotOverride(function () { throw new Error('题目截图疑似空白（已拒绝）'); });
  let askedImg = 'NOT_SET', askedText = null;
  ns.setQuizAskDeepSeekOverride(function (dataUrl, opts, text) { askedImg = dataUrl; askedText = text; return Promise.resolve({ answer: 'A', text: 'A' }); });
  const el1 = makeQuizEl();
  let r1;
  try { r1 = await ns.quizRecover(el1); } catch (e) { r1 = { __rejected: e.message }; }
  assert('① 空白截图不 reject（deepseek-web）', !(r1 && r1.__rejected), r1);
  assert('① imgSkipped=true', r1 && r1.imgSkipped === true, r1);
  assert('① decodeOk=true', r1 && r1.decodeOk === true, r1);
  assert('① 仅文本（无图）发给 DS', askedImg === undefined, askedImg);
  assert('① 提示词含「已还原文本」', /已还原/.test(askedText || ''), (askedText || '').slice(0, 20));

  // ② deepseek-web + 空白截图 + 解码弱(无字体短文本) → 仍走 text-only 兜底，不硬拒绝（比整题失败更优）
  askedImg = 'NOT_SET';
  const el2 = win.document.createElement('div'); el2.textContent = 'AB';   // 无字体 → 解码原样回退、短文本 decodeOk=false
  win.document.body.appendChild(el2);
  let r2;
  try { r2 = await ns.quizRecover(el2); } catch (e) { r2 = { __rejected: e.message }; }
  assert('② 解码弱仍不 reject（deepseek-web 永远兜底）', !(r2 && r2.__rejected), r2);
  assert('② imgSkipped=true（仍无图）', r2 && r2.imgSkipped === true, r2);
  assert('② 未带空白图发给 DS', askedImg === undefined, askedImg);

  // ③ endpoint + 空白截图 → 仍 reject（endpoint 依赖截图，无文本兜底，保持原语义）
  ns.CONFIG.QUIZ_VISION_OCR = 'endpoint';
  ns.setQuizSnapshotOverride(function () { throw new Error('题目截图疑似空白（已拒绝）'); });
  const el3 = win.document.createElement('div');
  win.document.body.appendChild(el3);
  let r3;
  try { r3 = await ns.quizRecover(el3); } catch (e) { r3 = { __rejected: e.message }; }
  assert('③ endpoint 空白截图仍 reject', r3 && r3.__rejected && /题目截图疑似空白/.test(r3.__rejected), r3);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  dom.window.close();
  process.exit(fail ? 1 : 0);
})();
