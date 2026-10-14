const projectPaths = require('./project-paths.cjs');
// 卡顿深挖探针：模拟学习通平台的典型「对抗」行为，统计脚本响应调用频率——
//   ① 平台周期性 pause()（强制暂停策略）
//   ② 平台周期性 playbackRate=0（伪暂停）
//   ③ 答题页高频 DOM 变更（倒计时/动画）
// 若任一计数出现异常高频（如 play() 每秒 >2 次、ratechange 每秒 >5 次），即为持续卡顿源。
const fs = require('fs');
const { JSDOM } = projectPaths.requireSim('jsdom');
const artifact = fs.readFileSync(projectPaths.bundle, 'utf8');

// ---------- 学习通答题页模拟：两道题 + 倒计时 ----------
const examHtml = `<!DOCTYPE html><html><head><title>考试</title></head><body>
<div class="ans-attach-ct"></div>
<div class="TiMu"><div class="Zy_TItle">1. 单选：1+1=?</div><div class="Zy_UlTop">A.1</div><div class="Zy_UlTop">B.2</div></div>
<div class="TiMu"><div class="Zy_TItle">2. 判断：地球是圆的</div><div class="Zy_UlTop">正确</div><div class="Zy_UlTop">错误</div></div>
<span id="cd">600</span><div id="anim"></div>
</body></html>`;

const dom = new JSDOM(examHtml, {
  url: 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?courseId=1&clazzid=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};

// ---------- 调用计数 ----------
const counts = { play: 0, pause: 0, rateSet: 0, ratechange: 0, qsa: 0, moFlush: 0, quizTick: 0, tick: 0 };
const origPlay = win.HTMLMediaElement.prototype.play;
const origPause = win.HTMLMediaElement.prototype.pause;
win.HTMLMediaElement.prototype.play = function () { counts.play++; return origPlay.call(this); };
win.HTMLMediaElement.prototype.pause = function () { counts.pause++; return origPause.call(this); };
const rateDesc = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'playbackRate');
if (rateDesc && rateDesc.set) {
  Object.defineProperty(win.HTMLMediaElement.prototype, 'playbackRate', {
    configurable: true, get: rateDesc.get,
    set: function (v) { counts.rateSet++; return rateDesc.set.call(this, v); },
  });
}
const origQSA = doc.querySelectorAll.bind(doc);
doc.querySelectorAll = function (sel) { counts.qsa++; return origQSA(sel); };
const origDispatch = win.EventTarget.prototype.dispatchEvent;
win.EventTarget.prototype.dispatchEvent = function (e) {
  if (e && e.type === 'ratechange') counts.ratechange++;
  return origDispatch.call(this, e);
};

win.eval(artifact);
const ns = win.__CX_FORCE_PLAY;
// 开自动答题
win.localStorage.setItem('cx_quiz_auto', '1');
// 挂钩 quizTick 计数（quizObserveDispatch 驱动 + 主循环驱动都会走到）
const origQD = ns.quizObserveDispatch;
ns.quizObserveDispatch = function () { counts.quizTick++; return origQD(); };
// 主循环 tick 计数：通过 TimerRegistry 不可见，改用 videos:scanned 信号近似（面板隐藏时不发——先开面板）
const pressP = () => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
pressP();   // 打开面板（也是用户反馈「打不开」的观察点，测量打开耗时）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 面板打开耗时
  const t0 = performance.now();
  pressP();   // 已开再按 = 关闭
  const tClose = performance.now() - t0;
  const t1 = performance.now();
  pressP();   // 再开
  const tOpen = performance.now() - t1;
  console.log('面板 关闭/打开 单次操作耗时:', tClose.toFixed(1) + 'ms /', tOpen.toFixed(1) + 'ms');

  // 模拟 20s 对抗负载：
  //   平台：每 1s pause 一次 + 每 2s playbackRate=0 一次 + 每秒 DOM 变更（倒计时+动画节点增删）
  //   观察脚本的响应调用频率
  let sec = 0;
  const iv = setInterval(() => {
    sec++;
    const v = doc.querySelector('video');
    if (v) {
      win.HTMLMediaElement.prototype.pause.call(v);          // 平台强制暂停
      if (sec % 2 === 0) { rateDesc.set.call(v, 0); }        // 平台伪暂停
      v.dispatchEvent(new win.Event('ratechange'));
    }
    const cd = doc.getElementById('cd');
    if (cd) cd.textContent = String(600 - sec);
    const anim = doc.getElementById('anim');
    if (anim) {
      const d = doc.createElement('div');
      d.className = 'tick-anim';
      anim.appendChild(d);
      setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 300);
    }
  }, 1000);

  await sleep(20000);
  clearInterval(iv);

  console.log('\n=== 20s 学习通对抗负载统计 ===');
  console.log('平台 pause 调用(响应前): 20 次 → 脚本侧 play 响应:', counts.play, '次 (', (counts.play / 20).toFixed(1), '/秒 )');
  console.log('平台 rate=0 设置(响应前): 10 次 → 脚本侧 rate 重设:', counts.rateSet, '次');
  console.log('ratechange 事件:', counts.ratechange, '次 (', (counts.ratechange / 20).toFixed(1), '/秒 )');
  console.log('quizTick(quizObserveDispatch):', counts.quizTick, '次 (', (counts.quizTick / 20).toFixed(1), '/秒 )');
  console.log('全文档 qsa:', counts.qsa, '次 (', (counts.qsa / 20).toFixed(1), '/秒 )');

  // 判定
  const playRate = counts.play / 20;
  const rateRate = counts.ratechange / 20;
  const quizRate = counts.quizTick / 20;
  let ok = true;
  if (playRate > 2) { console.log('FAIL: play 响应高频（平台 pause 对抗循环）'); ok = false; }
  if (rateRate > 6) { console.log('FAIL: ratechange 事件风暴（伪暂停对抗循环）'); ok = false; }
  if (quizRate > 2.5) { console.log('FAIL: quizTick 高频（MO 驱动扫描风暴）'); ok = false; }
  if (ok) console.log('结论: PASS — 对抗负载下各响应频率受控');

  dom.window.close();
  process.exit(ok ? 0 : 1);
})();
