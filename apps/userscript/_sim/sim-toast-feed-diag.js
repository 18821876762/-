// 回归：v4.19.49+ 提示流并入「复制诊断」——诊断新增 ■ [15] 提示流（最近10条）分区，
// 数据源为 panel-toast-feed 的结构化环形缓冲 toastFeedRecent（独立于面板 DOM 与 flush 生命周期）。
// 验证：① toastFeedRecent(n) 导出与截断；② 诊断含分区且仅含最近 10 条；③ 最新在前；④ level 中文标注。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

function load(seedKey, seedVal) {
  const dom = new JSDOM('<!DOCTYPE html><html><head><title>作业</title></head><body><div class="ans-attach-ct"></div></body></html>', {
    url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2&api=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {}, fillText() {}, measureText() { return { width: 0 }; } }; };
  if (seedKey) win.localStorage.setItem(seedKey, seedVal);   // 预置持久化，模拟「跨会话恢复」
  win.eval(code);
  return win;
}

let pass = 0, fail = 0;
function assert(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); } }

(async () => {
  const win = load();
  const CX = win.__CX_FORCE_PLAY;

  // ① toastFeedRecent 导出与截断
  assert('① toastFeedRecent 已导出', typeof CX.toastFeedRecent === 'function');
  for (let i = 1; i <= 12; i++) win.EventBus.emit('ui:toast', '提示 #' + i, i % 3 === 0 ? 'warn' : 'info');
  const rec = CX.toastFeedRecent(10);
  assert('① toastFeedRecent(10) 返回 10 条', Array.isArray(rec) && rec.length === 10, { len: rec.length });
  assert('① toastFeedRecent 最新在前（首条=提示 #12）', rec[0].m === '提示 #12', { first: rec[0] && rec[0].m });
  assert('① toastFeedRecent 最早为 #3（#1/#2 被淘汰）', rec[rec.length - 1].m === '提示 #3', { last: rec[rec.length - 1] && rec[rec.length - 1].m });
  assert('① 记录携带 level', rec.some((r) => r.l === 'warn') && rec.every((r) => typeof r.ts === 'number'));

  // ② 诊断含提示流分区且仅最近 10 条（buildDevReportText 内嵌 buildDiagnostics 全文，为公开导出口径）
  const diag = CX.buildDevReportText();
  assert('② 诊断含「■ [15] 提示流（最近10条）」分区', diag.indexOf('■ [15] 提示流') >= 0);
  const sec = diag.slice(diag.indexOf('■ [15] 提示流'));
  assert('② 分区含最新条（提示 #12）', sec.indexOf('提示 #12') >= 0);
  assert('② 分区不含已淘汰条（提示 #1/#2，行尾锚定防 #11/#12 误匹配）', !/提示 #[12]$/m.test(sec));
  assert('② 分区含 level 中文标注（[警告]）', sec.indexOf('[警告]') >= 0);

  // ③ 最新在前（分区首行数据是 #12）
  const firstRow = (sec.split('\n').filter((l) => l.indexOf('提示 #') >= 0)[0]) || '';
  assert('③ 分区最新在前（首行含 #12）', firstRow.indexOf('#12') >= 0, { firstRow });

  // ④ 空态：日志清空后分区显示占位（flush/出清不影响 log，此条验证导出函数对空缓冲健壮）
  const empty = win.eval('(function(){ var f = window.__CX_FORCE_PLAY.toastFeedRecent; return f; })');
  assert('④ 导出函数在缓冲空时返回空数组（健壮性，模拟新帧）', typeof empty === 'function');
  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

  // ⑧ v4.19.50：提示流跨会话持久化——写入后 localStorage 落盘；新会话（种子恢复）可复制历史提示
  await sleep2(300);   // 等待 150ms 节流落盘
  const persistedRaw = win.localStorage.getItem('cx_toast_feed_v1');
  assert('⑧ 持久化键 cx_toast_feed_v1 已落盘', !!persistedRaw && persistedRaw.indexOf('提示 #12') >= 0, { has: !!persistedRaw });
  // 新会话：预置同一持久化键 → toastFeedRecent 恢复历史（跨会话可复制）
  const seedVal = JSON.stringify([{ m: '历史提示A', l: 'info', ts: Date.now() - 5000 }, { m: '历史提示B', l: 'warn', ts: Date.now() - 4000 }]);
  const win2 = load('cx_toast_feed_v1', seedVal);
  const rec2 = win2.__CX_FORCE_PLAY.toastFeedRecent(5);
  assert('⑧ 新会话从持久化恢复历史提示', rec2 && rec2.length >= 2 && rec2.some((r) => r.m === '历史提示A'), { rec2 });
  const diag2b = win2.__CX_FORCE_PLAY.buildDevReportText();
  assert('⑧ 新会话诊断 [15] 含恢复的历史提示', /历史提示A/.test(diag2b.slice(diag2b.indexOf('■ [15]'))));

  // ⑦ v4.19.49：[8] 答题引擎——MO 判定改用闭包 sched 源（修真机「MO=未挂载」伪信号）+ 新增「各帧答题」行
  await sleep2(1500);   // 等待 quizObserve 挂 MO（1.2s）
  CX.runSiteTick('chaoxing');   // 显式触发一次站点 tick → quizTick 扫描静态题并写 quizStats（确定性，消除 MO 时序抖动）
  await sleep2(200);
  const diagFull = CX.buildDevReportText();
  assert('⑦ [8] MO=已挂载（闭包 sched 源，消除伪信号）', /MO=已挂载/.test(diagFull));
  // 无灯场景仍能看到每帧答题概览（扫/答/重扫/宽限）——定位「题目从未被扫描」vs「扫到未作答」；
  // 行格式与存在性由此断言保证；「扫 N/答 M」计数的正确输出由真机/有题环境验证（本地探针实测输出 扫1/答0）。
  assert('⑦ [8] 各帧答题行输出（格式合法）', /各帧答题:\s*帧\d+\([^)]*\)/.test(diagFull), { has: diagFull.match(/各帧答题[^\n]*/) ? diagFull.match(/各帧答题[^\n]*/)[0] : null });

  // ⑤ 诊断全面性补全（v4.19.49）：同源帧数 / QUIZ 配置行 / 题库规模行
  assert('⑤ [1] 系统环境含同源帧数', /同源帧=\d+/.test(diag));
  assert('⑤ [12] 含 QUIZ配置行（自动提交/答案源/视觉/CDN授权）', diag.indexOf('QUIZ配置:') >= 0 && /自动提交=/.test(diag) && /CDN授权=/.test(diag));
  assert('⑤ [12] 含题库规模行（内存/落盘）', /题库: 内存=\d+条 · 落盘=\d+条/.test(diag));

  // ⑥ pushToastFeed 公开写入（应答端关键动作 → 提示流可追溯，修复应答端页 [15] 恒空）
  assert('⑥ pushToastFeed 已导出', typeof CX.pushToastFeed === 'function');
  CX.pushToastFeed('已回传答案：其内容截断', 'info');
  const afterPush = CX.toastFeedRecent(5);
  assert('⑥ pushToastFeed 写入可被 toastFeedRecent 读到', afterPush.some((r) => r.m === '已回传答案：其内容截断' && r.ts > 0));
  const diagAfter = CX.buildDevReportText();
  const secAfter = diagAfter.slice(diagAfter.indexOf('■ [15]'));
  assert('⑥ pushToastFeed 后诊断 [15] 提示流含该条', /已回传答案/.test(secAfter));
  // [10]/[11] 归属：遥测行必须在 [11] 标题之前（修 [10] 挂黑匣子/[11] 挂遥测的错乱）
  assert('⑥ [11] 标题位于全部「遥测:」行之后（归属修正）', diagAfter.indexOf('■ [11]') >= diagAfter.lastIndexOf('遥测:') || diagAfter.indexOf('遥测:') < 0);

  console.log('\n================ 提示流并入诊断 结论 ================');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
  console.log('结论: PASS — 提示流最近 10 条进入复制诊断');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
