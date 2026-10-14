// 复现：学习通真实题目结构（div.TiMu + Zy_TItle + Zy_ulTop>li）下 4.19 的题目检测与作答
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const examHtml = `<!DOCTYPE html><html><head><title>作业</title></head><body>
<div class="ans-attach-ct"></div>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】中国的首都是？</span></div>
  <ul class="Zy_ulTop">
    <li class="before-after-checkbox" role="checkbox" aria-label="A 北京">A 北京</li>
    <li class="before-after-checkbox" role="checkbox" aria-label="B 上海">B 上海</li>
  </ul>
</div>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">2 【判断题】地球是圆的</span></div>
  <ul class="Zy_ulTop">
    <li class="before-after-checkbox" role="checkbox" aria-label="A 正确">A 正确</li>
    <li class="before-after-checkbox" role="checkbox" aria-label="B 错误">B 错误</li>
  </ul>
</div>
</body></html>`;

const dom = new JSDOM(examHtml, {
  url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2&api=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
// 4.20：点选不等于提交；绿灯场景必须提供实际提交按钮并验证点击。
let submitted = 0;
function addSubmit(q) {
  const button = win.document.createElement('button');
  button.className = 'fixture-submit submit-btn'; button.textContent = '提交';
  button.addEventListener('click', () => submitted++); q.appendChild(button);
}
Array.from(win.document.querySelectorAll('div.TiMu')).forEach(addSubmit);
win.eval(code);
const ns = win.__CX_FORCE_PLAY;
win.localStorage.setItem('cx_quiz_auto', '1');
win.localStorage.setItem('cx_quiz_autosubmit', '1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  function assert(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  }
  const errors = [];
  win.addEventListener('error', (e) => errors.push(String(e.message || e)));

  // 场景 0：静态题检测兜底——题目在加载时已静态渲染。v4.19 起 iframe 无主循环，
  // 唯一检测窗口是 quizObserve 挂载(1200ms)后的 quizScanOnce 一次性补扫；
  // 首轮主循环 tick 在 ~2000ms（RESCAN_INTERVAL），故 t=1500ms 前能检测到题即证明补扫生效。
  await sleep(1500);
  console.log('S0 灯:', JSON.stringify(ns.quizLights.map((l) => ({ seq: l.seq, fp: l.fp, state: l.state }))));
  assert('S0: 静态题在首轮主循环前已被一次性补扫检测（2 题）', ns.quizLights.length === 2, { lights: ns.quizLights.map((l) => l.state) });

  // 场景 1：主循环驱动（题目已静态存在）→ 顶层 2s tick 应检测并作答
  await sleep(1000);
  console.log('S1 灯:', JSON.stringify(ns.quizLights.map((l) => ({ seq: l.seq, fp: l.fp, state: l.state }))));
  assert('S1: 主循环检测到 2 题（信号灯）', ns.quizLights.length === 2, { lights: ns.quizLights.map((l) => l.state) });
  assert('S1b: 信号灯指纹无重复（无重复灯）', new Set(ns.quizLights.map((l) => l.fp)).size === ns.quizLights.length, { fps: ns.quizLights.map((l) => l.fp) });
  assert('S2: 题目实际点击提交后结算（灯绿）', submitted >= 2 && ns.quizLights.every((l) => l.state === 'done'), { submitted, lights: ns.quizLights.map((l) => l.state) });

  // 场景 2：MO 驱动（动态插入新题）
  const q3 = win.document.createElement('div');
  q3.className = 'TiMu newTiMu';
  q3.innerHTML = '<div class="Zy_TItle"><span class="newZy_TItle">3 【单选题】动态题</span></div><ul class="Zy_ulTop"><li class="before-after-checkbox">A 甲</li><li class="before-after-checkbox">B 乙</li></ul>';
  const beforeDynamic = submitted; addSubmit(q3);
  win.document.body.appendChild(q3);
  await sleep(1500);
  console.log('S3 灯:', JSON.stringify(ns.quizLights.map((l) => ({ seq: l.seq, fp: l.fp, state: l.state }))));
  assert('S3: MO 驱动动态插入题被检测（3 题）', ns.quizLights.length === 3, { lights: ns.quizLights.map((l) => l.state) });
  assert('S3b: 动态插入后无重复灯', new Set(ns.quizLights.map((l) => l.fp)).size === ns.quizLights.length, { lights: ns.quizLights.map((l) => l.state) });
  assert('S4: 动态题点击提交后结算（绿）', submitted > beforeDynamic && ns.quizLights[2].state === 'done', { submitted, state: ns.quizLights[2].state });

  // 场景 3：自动启动关 → 挂起不答（黑）→ 手动 → 答
  win.localStorage.setItem('cx_quiz_auto_start', '0');
  const q4 = win.document.createElement('div');
  q4.className = 'TiMu newTiMu';
  q4.innerHTML = '<div class="Zy_TItle"><span class="newZy_TItle">4 【单选题】手动题</span></div><ul class="Zy_ulTop"><li class="before-after-checkbox">A 甲</li><li class="before-after-checkbox">B 乙</li></ul>';
  const beforeManual = submitted; addSubmit(q4);
  win.document.body.appendChild(q4);
  await sleep(100);
  ns.quizObserveDispatch();
  await sleep(50);
  const q4Light = ns.quizLights.filter((l) => l.fp.indexOf('手动题') >= 0)[0];
  assert('S5: 自动启动关 → 手动题蓝（特殊情况·挂起）', q4Light && q4Light.state === 'special', { state: q4Light && q4Light.state, lights: ns.quizLights.map((l) => l.state) });
  ns.quizManualStart();
  await sleep(50);
  const q4Light2 = ns.quizLights.filter((l) => l.fp.indexOf('手动题') >= 0)[0];
  assert('S6: 手动开始实际提交 → 手动题绿', submitted > beforeManual && q4Light2 && q4Light2.state === 'done', { submitted, state: q4Light2 && q4Light2.state });

  // 场景 4：跨帧信号灯合并——顶层帧收到子帧广播（学习通作业题在多层 iframe 内，面板在顶层帧）
  win.dispatchEvent(new win.MessageEvent('message', { data: { __cxQuizLights: [{ fp: 'quiz:0:12:远程题A甲B乙#2:A甲B乙', state: 'done' }] }, origin: win.location.origin }));
  assert('S7: 顶层面板合并子帧广播的题灯', ns.quizLights.some((l) => l.fp.indexOf('远程题') >= 0 && l.state === 'done'), { lights: ns.quizLights.map((l) => l.state) });
  win.dispatchEvent(new win.MessageEvent('message', { data: { __cxQuizLights: [{ fp: 'quiz:0:12:远程题A甲B乙#2:A甲B乙', state: 'fail', msg: 'DeepSeek 网页版应答端不可用（测试）' }] }, origin: win.location.origin }));
  const remL = ns.quizLights.filter((l) => l.fp.indexOf('远程题') >= 0)[0];
  assert('S7b: 子帧状态更新同步到面板', remL && remL.state === 'fail', { state: remL && remL.state });
  assert('S7e: 失败原因随灯携带（首错可见）', remL && remL.msg && remL.msg.indexOf('应答端不可用') >= 0, { msg: remL && remL.msg });
  assert('S7c: 合并后无重复灯', new Set(ns.quizLights.map((l) => l.fp)).size === ns.quizLights.length, { n: ns.quizLights.length });
  // 异源消息必须被拒绝（安全）
  const before = ns.quizLights.length;
  win.dispatchEvent(new win.MessageEvent('message', { data: { __cxQuizLights: [{ fp: 'quiz:0:9:伪造题#2:A甲B乙', state: 'done' }] }, origin: 'https://evil.example.com' }));
  assert('S7d: 异源广播被拒绝', ns.quizLights.length === before && !ns.quizLights.some((l) => l.fp.indexOf('伪造题') >= 0), { n: ns.quizLights.length });
  // v4.19.2：子帧重载后广播空快照 → 陈旧灯必须清除（此前空数组 no-op → 陈旧灯永久残留）
  win.dispatchEvent(new win.MessageEvent('message', { data: { __cxQuizLights: [] }, origin: win.location.origin }));
  assert('S7f: 空快照清除该源陈旧灯', !ns.quizLights.some((l) => l.fp.indexOf('远程题') >= 0) && !ns.quizLights.some((l) => l.remote), { lights: ns.quizLights.map((l) => l.fp.slice(0, 20)) });
  // v4.19.2：答题 tick 遥测随广播上报（扫描/作答计数）
  win.dispatchEvent(new win.MessageEvent('message', { data: { __cxQuizLights: [], __cxQuizTick: { scanned: 5, answered: 3, ts: Date.now() } }, origin: win.location.origin }));
  assert('S7g: 答题 tick 遥测上报（帧扫/答）', ns.quizRemoteTick && ns.quizRemoteTick.scanned === 5 && ns.quizRemoteTick.answered === 3, { t: ns.quizRemoteTick });

  // 场景 5：子帧按需建通道钩子（顶层帧已有通道 → 幂等返回 0，不重复注册）
  assert('S8: __dsEnsureChannel 已导出且顶层幂等', typeof ns.__dsEnsureChannel === 'function' && ns.__dsEnsureChannel() === 0, { r: typeof ns.__dsEnsureChannel === 'function' ? ns.__dsEnsureChannel() : 'missing' });

  // 场景 6：识别已提交（v4.19.10）——结果页元素出现 → 全部灯绿、停止作答
  const res = win.document.createElement('div');
  res.className = 'markResult';
  res.textContent = '已提交';
  win.document.body.appendChild(res);
  ns.quizObserveDispatch();
  await sleep(80);
  assert('S9: 识别已提交 → 全部灯绿', ns.quizLights.length > 0 && ns.quizLights.every((l) => l.state === 'done'), { lights: ns.quizLights.map((l) => l.state) });
  assert('S9b: 提交态不再作答（无在途状态）', ns.quizStats && ns.quizStats.scanned > 0, { stats: ns.quizStats && ns.quizStats.scanned });

  // 场景 7：手动提交按钮（v4.19.22）——移除提交态标记恢复可作答页；v4.19.23 增加「保存按钮在前」校验：
  // 页面同时存在 保存（DOM 在前）与 提交 按钮时，必须点提交、绝不点保存（用户实测误点保存）
  res.remove();
  Array.from(win.document.querySelectorAll('.fixture-submit')).forEach((button) => button.remove());
  const saveBtn = win.document.createElement('a');
  saveBtn.className = 'btnSave workBtnIndex';
  saveBtn.textContent = '暂时保存';
  let saveClicked = 0;
  saveBtn.addEventListener('click', function () { saveClicked++; });
  win.document.body.appendChild(saveBtn);
  const subBtn = win.document.createElement('a');
  subBtn.className = 'btnSubmit workBtnIndex';
  subBtn.textContent = '提交';
  let subClicked = 0;
  subBtn.addEventListener('click', function () { subClicked++; });
  win.document.body.appendChild(subBtn);
  ns.quizManualSubmit();
  await sleep(50);
  assert('S10: 手动提交点击提交按钮（不点保存）', subClicked > 0 && saveClicked === 0, { subClicked, saveClicked });

  // 场景 8：翻页清理（v4.19.24）——移除旧题块、插入新页 3 题 → 旧灯必须清除
  win.localStorage.setItem('cx_quiz_auto_start', '1');   // 恢复自动启动（S5 曾置 0 验证挂起）
  const oldQ = Array.from(win.document.querySelectorAll('div.TiMu'));
  oldQ.forEach((q) => q.remove());
  const beforePage2 = submitted;
  for (let n = 1; n <= 3; n++) {
    const q = win.document.createElement('div');
    q.className = 'TiMu newTiMu';
    q.innerHTML = `<div class="Zy_TItle"><span class="newZy_TItle">${n} 【单选题】第${n}页新题</span></div><ul class="Zy_ulTop"><li class="before-after">A 甲</li><li class="before-after">B 乙</li></ul>`;
    addSubmit(q);
    win.document.body.appendChild(q);
  }
  ns.quizObserveDispatch();
  await sleep(80);
  const page2Lights = ns.quizLights;
  assert('S11: 翻页后旧灯清除（仅剩 3 盏新题灯）', page2Lights.length === 3, { n: page2Lights.length, lights: page2Lights.map((l) => l.state) });
  assert('S11b: 新页3题实际提交后灯均绿', submitted >= beforePage2 + 3 && page2Lights.every((l) => l.state === 'done'), { submitted, lights: page2Lights.map((l) => l.state) });

  // 场景 9：提交确认弹窗代点（v4.19.24）——页面存在 .dialog 确认框（正文含提交关键词）→ 点「确定」不点「取消」
  const dlg = win.document.createElement('div');
  dlg.className = 'dialog';
  dlg.innerHTML = '<div class="body">确定提交该作业？</div><button class="ok">确定</button><button class="cancel">取消</button>';
  dlg.getBoundingClientRect = () => ({ width: 300, height: 150, top: 0, left: 0, right: 300, bottom: 150 });   // jsdom 无布局 → 伪造可见尺寸
  let okClicked = 0, cancelClicked = 0;
  dlg.querySelector('.ok').addEventListener('click', () => okClicked++);
  dlg.querySelector('.cancel').addEventListener('click', () => cancelClicked++);
  win.document.body.appendChild(dlg);
  ns.quizManualSubmit();
  await sleep(600);   // 覆盖立即 + 500ms 补点
  assert('S12: 确认弹窗自动点「确定」（不点取消）', okClicked > 0 && cancelClicked === 0, { okClicked, cancelClicked });

  assert('无运行时错误', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  dom.window.close();
  process.exit(fail ? 1 : 0);
})();
