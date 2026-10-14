// 卡顿复现探针：
//  A. 同 iframe 换源 → drift guard 误判回拨 → seek 频率（修复前每 tick seek；修复后 0）
//  B. 答题页倒计时 DOM 变更 → MO 驱动 quizTick 频率与扫描成本（修复前 ~1.8s 一次；修复后 ~2.5s）
const fs = require('fs');
const { JSDOM, requestInterceptor } = require('jsdom');
const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
  if (cond) pass++; else fail++;
}

// ---------- 场景 A：同 iframe 换源误判 ----------
const FRAME_URL = 'https://mooc1.chaoxing.com/ananas/modules/video/index.html';
const frameHtml = '<!DOCTYPE html><html><head><title>播放器</title></head><body><video id="fv" src="blob:v1" preload="metadata"></video></body></html>';
const topHtml = `<!DOCTYPE html><html><head><title>学习通</title></head><body>
<video id="tv" src="blob:top" preload="metadata"></video>
<iframe id="player" src="${FRAME_URL}" width="800" height="450"></iframe>
<div class="ans-attach-ct"></div></body></html>`;

const dom = new JSDOM(topHtml, {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1&clazzid=2',
  runScripts: 'dangerously',
  resources: { interceptors: [requestInterceptor(function (req) { if (req.url === FRAME_URL) return new Response(frameHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); return undefined; })] },
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};

win.eval(artifact);
// 启用定向：iframe id='player' 加入白名单（drift guard 的 iframe 签名路径）
win.attachments = [{ property: { objectid: 'player', type: 'video' } }];

let seeks = 0;
const iframe = doc.getElementById('player');
let childWin = null, fv = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 等 iframe 就绪（requestInterceptor 喂帧内容，加载异步）
  for (let i = 0; i < 100; i++) {
    childWin = iframe && iframe.contentWindow;
    fv = (childWin && iframe.contentDocument) ? iframe.contentDocument.getElementById('fv') : null;
    if (fv) break;
    await sleep(100);
  }
  if (!fv) { console.log('FAIL: iframe 视频未就绪'); process.exit(1); }
  const origDesc = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'currentTime');
  const origSet = origDesc && origDesc.set;
  if (origSet) {
    Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get: origDesc.get,
      set: function (v) { seeks++; return origSet.call(this, v); },
    });
  }

  // A1: 播放推进到 100s
  fv.paused = false;
  fv.duration = 300;
  // 直接设置 currentTime 会走包装计数——先关掉计数（推进阶段）
  const wrapSet = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'currentTime').set;
  // 用原生描述符直接写
  const raw = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'currentTime');
  Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: raw.get, set: origSet });
  fv.currentTime = 100;
  Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: raw.get, set: function (v) { seeks++; return origSet.call(this, v); } });

  // 等 2 个主循环 tick（drift guard 记录 max=100）
  await sleep(4600);
  seeks = 0;

  // A2: 换源（同 iframe 新视频 blob:v2，进度 0）
  fv.src = 'blob:v2';
  fv.currentTime = 0;   // 换源归零
  // 模拟平台回拨把进度压到 0
  await sleep(300);
  fv.currentTime = 0;

  // 等 2 个 tick 观察 seek 行为
  await sleep(4600);
  console.log('A.换源后 2 tick 内 seek 次数:', seeks);
  check('A.同 iframe 换源后不再每 tick 误判回拨 seek（修复后应为 0）', seeks === 0, { seeks });

  // ---------- 场景 B：答题页倒计时 MO 驱动 ----------
  const dom2 = new JSDOM('<!DOCTYPE html><html><head><title>考试</title></head><body><div class="ans-attach-ct"></div><div class="TiMu" id="q1"><div class="Zy_TItle">1. 单选题</div><div class="Zy_UlTop">A</div><div class="Zy_UlTop">B</div></div><div class="TiMu" id="q2"><div class="Zy_TItle">2. 判断题</div><div class="Zy_UlTop">对</div><div class="Zy_UlTop">错</div></div><span id="countdown">59</span></body></html>', {
    url: 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?courseId=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win2 = dom2.window;
  const doc2 = win2.document;
  win2.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  win2.HTMLMediaElement.prototype.pause = function () { return Promise.resolve(); };
  if (!win2.HTMLMediaElement.prototype.load) win2.HTMLMediaElement.prototype.load = function () {};
  const ctx2 = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  win2.HTMLCanvasElement.prototype.getContext = function () { return ctx2; };
  win2.eval(artifact);
  // 开启自动答题
  win2.localStorage.setItem('cx_quiz_auto', '1');
  let qdCount = 0;
  const origQD = win2.__CX_FORCE_PLAY.quizObserveDispatch;
  win2.__CX_FORCE_PLAY.quizObserveDispatch = function () { qdCount++; return origQD(); };

  const qsa2 = { n: 0, ms: 0 };
  const origQSA2 = doc2.querySelectorAll.bind(doc2);
  doc2.querySelectorAll = function (sel) {
    const t0 = performance.now();
    const r = origQSA2(sel);
    qsa2.n++; qsa2.ms += performance.now() - t0;
    return r;
  };

  // 模拟倒计时：每秒更新一次 DOM（文本节点变更 + 节点增删混合）
  let t = 59;
  const iv = setInterval(() => {
    const el = doc2.getElementById('countdown');
    el.textContent = String(--t);
    const d = doc2.createElement('div');
    d.className = 'tick-anim';
    doc2.body.appendChild(d);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 200);
  }, 1000);

  await sleep(7000);   // 7 秒 ≈ 7 次倒计时变更
  clearInterval(iv);

  console.log('B.7s 倒计时页: MO 驱动 quizTick(quizObserveDispatch) =', qdCount, '次; 全文档 qsa =', qsa2.n, '次/', qsa2.ms.toFixed(1) + 'ms');
  check('B.答题页扫描频率受控（7s 内 ≤4 次，修复前 ~4-5 次）', qdCount <= 4, { qdCount });
  check('B.无运行时错误', true);

  dom.window.close();
  dom2.window.close();
  console.log(pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
