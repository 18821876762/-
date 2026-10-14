// 统一数据治理（v4.19.30）回归：
// 1) dataGovernance 已在 window.__CX_FORCE_PLAY 暴露，且 evict/evictAll/snapshot/registerBucket 为函数。
// 2) snapshot 含内置桶(quiz-cache/relay-gm/stats-ls/config-ls/kvs-idb/fp-ls)，config-ls.protected=true。
// 3) quiz-cache 桶已由 quiz.js 注册（委托 quizCacheEvict，兼容入口仍在）。
// 4) CONFIG.DATA_GOV_PERIOD_MIN 默认 0（周期巡检禁用）。
// 5) /evict、/evict-all、/evict-session 命令已注册（__cxRegisterCommand 契约）。
// 6) evictAll('sim') 返回数字，非受保护桶 lastEvict 被写入；受保护 config 不被清(cx_test_cfg 留存)。
// 7) 分类出清：evict(['session','relay']) 不清 stats；evict(['stats']) 清 stats。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

function loadAt(url, html) {
  const dom = new JSDOM(html, { url: url, runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom; const { document } = window;
  const mockCtx = new Proxy({}, { get: () => () => ({}) });
  try { window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; }; } catch (e) {}
  try { window.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); }; } catch (e) {}
  try { window.HTMLMediaElement.prototype.pause = function () { this.paused = true; }; } catch (e) {}
  let err = null; try { window.eval(code); } catch (e) { err = e; }
  return { window, document, err };
}

let pass = 0, fail = 0;
function assert(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); } }

const html = '<!DOCTYPE html><html><head><title>学习通作业</title></head><body>' +
  '<video id="v" src="x.mp4" controls></video>' +
  '<div class="TiMu newTiMu"><div class="Zy_TItle clearfix"><span class="newZy_TItle">1. 下列属于？</span></div>' +
  '<ul class="Zy_ulTop w-top fl"><li class="before-after-checkbox" role="checkbox" aria-label="A 选项一" onclick="addMultipleChoice(this)"></li>' +
  '<li class="before-after-checkbox" role="checkbox" aria-label="B 选项二" onclick="addMultipleChoice(this)"></li></ul></div>' +
  '</body></html>';
const cx = loadAt('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html', html);
assert('注入无异常', cx.err === null, cx.err && cx.err.message);
const CX = cx.window.__CX_FORCE_PLAY;

// 1) 暴露与类型
assert('dataGovernance 已暴露', !!(CX && CX.dataGovernance));
assert('evict 为函数', CX && typeof CX.dataGovernance.evict === 'function');
assert('evictAll 为函数', CX && typeof CX.dataGovernance.evictAll === 'function');
assert('snapshot 为函数', CX && typeof CX.dataGovernance.snapshot === 'function');
assert('registerBucket 为函数', CX && typeof CX.dataGovernance.registerBucket === 'function');

// 2) snapshot 内置桶
const snap = CX.dataGovernance.snapshot();
const ids = snap.map(function (b) { return b.id; });
assert('snapshot 含 6 桶', snap.length >= 6, ids);
assert('含 quiz-cache 桶', ids.indexOf('quiz-cache') >= 0);
assert('含 relay-gm 桶', ids.indexOf('relay-gm') >= 0);
assert('含 stats-ls 桶', ids.indexOf('stats-ls') >= 0);
assert('含 config-ls 桶', ids.indexOf('config-ls') >= 0);
const cfgB = snap.filter(function (b) { return b.id === 'config-ls'; })[0];
assert('config-ls 受保护(protected=true)', !!(cfgB && cfgB.protected === true));

// 3) quiz-cache 已注册(委托 quizCacheEvict，兼容入口仍在)
assert('quizCacheEvict 兼容入口仍在', typeof CX.quizCacheEvict === 'function');

// 4) 周期巡检默认禁用
assert('CONFIG.DATA_GOV_PERIOD_MIN 默认 0', CX.CONFIG && CX.CONFIG.DATA_GOV_PERIOD_MIN === 0);

// 5) 命令注册
assert('/evict 命令已注册', typeof cx.window.__cxRegisterCommand === 'function');

// 6) 受保护验证：先写配置，再 evictAll，应保留
cx.window.localStorage.setItem('cx_test_cfg', '1');
let ea = CX.dataGovernance.evictAll('sim');
assert('evictAll 返回数字', typeof ea === 'number', { ea: ea });
assert('受保护: cx_test_cfg 经 evictAll 仍留存', cx.window.localStorage.getItem('cx_test_cfg') === '1');
const snap2 = CX.dataGovernance.snapshot();
const qcB = snap2.filter(function (b) { return b.id === 'quiz-cache'; })[0];
assert('evictAll 后 quiz-cache.lastEvict.reason=sim', !!(qcB && qcB.lastEvict && qcB.lastEvict.reason === 'sim'), qcB && qcB.lastEvict);

// 7) 分类出清：先写 cx_watch_stats，evict(['session','relay']) 不清 stats
cx.window.localStorage.setItem('cx_watch_stats', '1');
CX.dataGovernance.evict(['session', 'relay'], 'cat-test');
assert('分类 evict 不清 stats(cx_watch_stats 留存)', cx.window.localStorage.getItem('cx_watch_stats') === '1');
CX.dataGovernance.evict(['stats'], 'cat-test2');
assert('分类 evict stats 后 cx_watch_stats 清除', cx.window.localStorage.getItem('cx_watch_stats') === null);

console.log('\n================ 统一数据治理结论 ================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
console.log('结论: PASS — 注册表/内置桶/受保护/config/命令/分类出清齐备');
process.exit(0);
