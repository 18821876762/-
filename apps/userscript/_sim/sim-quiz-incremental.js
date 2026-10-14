// P1-4 回归：MO 增量 diff —— 指纹跨 tick 缓存，稳态零 textContent 重算；
//   新增题目仍经每 tick 全量 _pqQueryAll 检测作答；MO 触发脏代际后旧题被正确失效重算。
// 关键断言：
//   A) 稳态直接 tick：旧题 fingerprint 命中 WeakMap 缓存 → 不重读 textContent（P1-4 核心收益）
//   B) 增量检测：tick 之间向 DOM 新增题目，下一 tick 仍抓到并作答（检测不丢题）
//   C) MO 失效：observer 检测到 DOM 增删 → 脏代际 +1 → 旧题 fingerprint 被重算（缓存正确失效）
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

let fail = 0;
function assert(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : (' :: ' + JSON.stringify(extra))));
  if (!cond) fail++;
}

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  // 部分 jsdom 配置下 window 不暴露 WeakMap；本优化依赖 WeakMap（生产浏览器自带）。
  // 为让回归在仿真环境可验证，注入 node 全局 WeakMap（不影响真实产物行为）。
  try { if (typeof window.WeakMap === 'undefined') window.WeakMap = WeakMap; } catch (e) {}
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}

function makeQuestion(window, stemText, nOpts) {
  const q = window.document.createElement('div'); q.className = 'question-item';
  const stem = window.document.createElement('div'); stem.className = 'stem'; stem.textContent = stemText;
  q.appendChild(stem);
  for (let i = 0; i < nOpts; i++) {
    const opt = window.document.createElement('div'); opt.className = 'option-item'; opt.textContent = '选项' + i;
    q.appendChild(opt);
  }
  const submitted = { val: false };
  const btn = window.document.createElement('button'); btn.className = 'submit-btn'; btn.textContent = '提交';
  btn.addEventListener('click', function () { submitted.val = true; });
  q.appendChild(btn);
  window.document.body.appendChild(q);
  return { q: q, submitted: submitted };
}

// 给元素 textContent 装计数器（验证 P1-4 缓存是否避免重读）
function spyText(el) {
  const s = { reads: 0, val: el.textContent };
  Object.defineProperty(el, 'textContent', {
    configurable: true,
    get: function () { s.reads++; return s.val; },
    set: function (v) { s.val = v; }
  });
  return s;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  console.log('--- P1-4 MO 增量 diff（fingerprint 跨 tick 缓存）回归 ---');
  const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
  ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';

  // 构建 5 题静态页
  const qs = [];
  for (let i = 0; i < 5; i++) qs.push(makeQuestion(window, '稳态题' + i, 3));
  // 对第 0 题装 textContent 计数器（验证稳态不重读）
  const spy0 = spyText(qs[0].q);

  // ── A) 稳态直接 tick：第 1 tick 作答全部；后续稳态 tick 不重读 textContent ──
  const a1 = ns.quizTick();
  assert('A1: 第1 tick 作答 5 题', a1 === 5, { a1: a1 });
  const afterT1 = spy0.reads;
  assert('A2: 第1 tick 已读取 q0.textContent(>0)', afterT1 > 0, { afterT1: afterT1 });

  const a2 = ns.quizTick();   // 稳态：所有题已答，不应重作答
  assert('A3: 第2 tick 作答 0 题（去重）', a2 === 0, { a2: a2 });
  assert('A4: 稳态旧题 q0.textContent 未被重读（WeakMap 缓存命中）', spy0.reads === afterT1, { reads: spy0.reads, base: afterT1 });

  const a3 = ns.quizTick();
  assert('A5: 第3 tick 仍 0 作答且 q0 未重读', a3 === 0 && spy0.reads === afterT1, { a3: a3, reads: spy0.reads });

  // ── B) 增量检测：tick 之间新增题目，下一 tick 仍抓到作答（检测不丢题）──
  const qNew = makeQuestion(window, '增量新增题', 3);
  const b1 = ns.quizTick();
  assert('B1: 新增题目被检测到并作答（answered=1）', b1 === 1, { b1: b1 });
  assert('B2: 稳态旧题 q0 在本次仍未被重读', spy0.reads === afterT1, { reads: spy0.reads });
  assert('B3: 新增题已提交', qNew.submitted.val === true);

  // ── C) MO 失效：observer 触发脏代际 +1 → 旧题 fingerprint 被重算（缓存正确失效）──
  const spy2 = spyText(qs[2].q);     // 另一道旧题装计数
  const moOk = ns.quizObserve(window.document.body);
  assert('C1: quizObserve 返回 true（MutationObserver 就绪）', moOk === true);
  const qNew2 = makeQuestion(window, 'MO新增题', 3);   // 触发 childList 变更
  // 性能修复(卡顿排查)后：MO 防抖窗口 800→1500ms、置脏节流 2000ms（倒计时等高频变更不再持续失效全部缓存）。
  // 等待窗口同步放宽到 2000ms 覆盖「1500ms 防抖 + 置脏 + 调度 + 扫描」；新题识别不依赖缓存（无缓存直接计算），
  // 旧题重算在置脏生效后的下一次扫描发生（首轮置脏距上次强制置脏 >2s，不在节流窗口内）。
  await sleep(2000);
  assert('C2: MO 触发后新题被作答', qNew2.submitted.val === true);
  assert('C3: 脏代际失效使旧题 q2 被重算（textContent 被重读，证明缓存正确失效）', spy2.reads > 0, { reads: spy2.reads });
  ns.quizDisconnect && ns.quizDisconnect();

  console.log(fail === 0 ? '结论: PASS — P1-4 增量缓存：稳态零重算 + 增量检测 + MO 失效重算 三态正确' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
})();
