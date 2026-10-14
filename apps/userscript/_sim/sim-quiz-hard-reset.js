// 需求回归：/evict 等同「刷新网页」——quizHardReset 全量运行时归零 + localStorage 用户配置保留
//   用户反馈：旧 /evict（quizCacheEvict）没有清理完全清除自动答题的情况，要做到相当于刷新网页。
//   验证点：
//     R0-R2  出清前确有运行时态（灯/桶 size/计数），出清入口返回数字；
//     R3-R6  出清后运行时态全归零（信号灯清空、quizStats 计数归零、quiz-cache 桶 size=0）；
//     R7-R9  关键：localStorage 用户配置(cx_*) 保留（刷新网页同样不删配置）——等同刷新的核心判定；
//     R10-R11 等同刷新语义：重置后下一 tick 重新扫描仍可重新识别题目（非永久禁用），且自动启动语义仍按配置重算；
//     R12-R13 兼容别名 quizCacheEvict 仍是函数、quizHardReset 导出可见。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
  const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
  win.eval(code);
  return { dom, win, ns: win.__CX_FORCE_PLAY };
}

function makeQuestion(win, stemText, nOpts) {
  const q = win.document.createElement('div');
  q.className = 'question-item';
  const stem = win.document.createElement('div');
  stem.className = 'stem';
  stem.textContent = stemText;
  q.appendChild(stem);
  const opts = [];
  for (let i = 0; i < nOpts; i++) {
    const o = win.document.createElement('div');
    o.className = 'option-item';
    o.textContent = '选项' + i;
    q.appendChild(o);
    opts.push(o);
  }
  const btn = win.document.createElement('button');
  btn.className = 'submit-btn';
  btn.textContent = '提交';
  q.appendChild(btn);
  win.document.body.appendChild(q);
  return { q, opts, btn };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  function assert(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  }
  const errors = [];

  const { dom, win, ns } = loadAt('https://www.pmphmooc.com/course/1');
  win.addEventListener('error', (e) => errors.push(String(e.message || e)));

  // 配置：自动启动关(cx_quiz_auto_start=0)，但保留自动答题总开关/自动交卷——用于验证「配置不被清」
  win.localStorage.setItem('cx_quiz_auto', '1');
  win.localStorage.setItem('cx_quiz_auto_start', '0');
  win.localStorage.setItem('cx_quiz_autosubmit', '1');

  const q = makeQuestion(win, '硬重置回归题', 2);
  await sleep(100);
  ns.quizObserveDispatch();          // 自动启动关 → 挂起(special)，登记 1 灯 + 填充内部态
  await sleep(50);
  ns.quizManualStart();              // 手动作答 → done（填充 _quizHandled/_quizLights/quizStats）
  await sleep(50);

  // —— 出清前：确认确有运行时态 ——
  const lightsBefore = ns.quizLights.length;
  assert('R0: 出清前已登记信号灯(>0)', lightsBefore > 0, { lightsBefore });
  // 手动给 quizStats 注入计数，模拟上一时段累计（验证计数归零路径）
  ns.quizStats.answered = 7; ns.quizStats.scanned = 9; ns.quizStats.done = 3;
  const snapBefore = ns.dataGovernance.snapshot();
  const bkBefore = snapBefore.filter((b) => b.id === 'quiz-cache')[0];
  assert('R1: 出清前 quiz-cache 桶 size>0', bkBefore && bkBefore.size > 0, { size: bkBefore && bkBefore.size });

  // —— 触发「等同刷新」出清 ——
  const cleared = ns.quizHardReset('manual');
  assert('R2: quizHardReset 返回数字', typeof cleared === 'number', { cleared });

  // —— 出清后：运行时态归零 ——
  assert('R3: 信号灯已清空(长度=0)', ns.quizLights.length === 0, { len: ns.quizLights.length });
  assert('R4: quizStats.answered 归零', ns.quizStats.answered === 0, { answered: ns.quizStats.answered });
  assert('R5: quizStats.scanned 归零', ns.quizStats.scanned === 0, { scanned: ns.quizStats.scanned });
  const snapAfter = ns.dataGovernance.snapshot();
  const bkAfter = snapAfter.filter((b) => b.id === 'quiz-cache')[0];
  assert('R6: quiz-cache 桶 size=0（内部题解/失败/跨帧态全清）', bkAfter && bkAfter.size === 0, { size: bkAfter && bkAfter.size });

  // —— 关键：localStorage 用户配置保留（等同刷新不删配置）——
  assert('R7: cx_quiz_auto_start 配置保留(=0)', win.localStorage.getItem('cx_quiz_auto_start') === '0');
  assert('R8: cx_quiz_autosubmit 配置保留(=1)', win.localStorage.getItem('cx_quiz_autosubmit') === '1');
  assert('R9: cx_quiz_auto 配置保留(=1)', win.localStorage.getItem('cx_quiz_auto') === '1');

  // —— 等同刷新语义：重置后重新扫描仍可重新识别题目（非永久禁用）。
  // 注意：q1 仍在 DOM 中，且 _quizHandled 已被清空 → 刷新后 q1 同样按未作答重新扫描，
  // 故此处两题都被重新登记（2 盏灯）才是「等同刷新」的正确语义。
  const q2 = makeQuestion(win, '重置后新题', 2);
  await sleep(100);
  ns.quizObserveDispatch();
  await sleep(50);
  assert('R10: 重置后重新扫描可重新登记全部题目(含此前已答的 q1)', ns.quizLights.length === 2, { len: ns.quizLights.length });
  assert('R11: 重置后自动启动语义仍按配置(关→special 挂起，非 done)', ns.quizLights.every((l) => l.state === 'special'), { states: ns.quizLights.map((l) => l.state) });

  // —— 兼容别名 ——
  assert('R12: quizCacheEvict 别名仍是函数', typeof ns.quizCacheEvict === 'function');
  assert('R13: quizHardReset 导出可见', typeof ns.quizHardReset === 'function');

  assert('全局 无运行时错误', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
