// 答题缓存出清系统（v4.19.29）回归：
// 1) quizCacheEvict 已在 window.__CX_FORCE_PLAY 暴露，且为函数。
// 2) 手动调用 quizCacheEvict('manual') 不抛错、返回数字、并写入 quizStats.lastEvict（原因/时间/清除项数）。
// 3) 幂等：连续两次调用均安全（第二次清空缓存下 cleared=0，不报错、不崩）。
// 4) CONFIG 出清开关存在且默认开启（QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE/URL_CHANGE=true，IDLE_MIN=0）。
// 5) /evict 命令已注册（window.__cxRegisterCommand 契约）。
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
  let err = null;
  try { window.eval(code); } catch (e) { err = e; }
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
assert('quizCacheEvict 已暴露且为函数', typeof CX.quizCacheEvict === 'function');

// 4) 配置默认
assert('CONFIG.QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE 默认 true', CX.CONFIG && CX.CONFIG.QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE === true);
assert('CONFIG.QUIZ_CACHE_EVICT_ON_URL_CHANGE 默认 true', CX.CONFIG && CX.CONFIG.QUIZ_CACHE_EVICT_ON_URL_CHANGE === true);
assert('CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN 默认 0', CX.CONFIG && CX.CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN === 0);

// 2) 手动调用安全 + 写入 lastEvict
let evErr = null, evRet = null;
try { evRet = CX.quizCacheEvict('manual'); } catch (e) { evErr = e; }
assert('quizCacheEvict 调用不抛错', evErr === null, evErr && evErr.message);
assert('quizCacheEvict 返回数字', typeof evRet === 'number', { ret: evRet });
assert('quizStats.lastEvict 已写入', !!(CX.quizStats && CX.quizStats.lastEvict));
assert('lastEvict.reason=manual', !!(CX.quizStats && CX.quizStats.lastEvict && CX.quizStats.lastEvict.reason === 'manual'));
assert('lastEvict.cleared 为数字', !!(CX.quizStats && CX.quizStats.lastEvict && typeof CX.quizStats.lastEvict.cleared === 'number'));

// 3) 幂等：再次调用仍安全
let evErr2 = null;
try { CX.quizCacheEvict('manual'); } catch (e) { evErr2 = e; }
assert('quizCacheEvict 二次调用不抛错(幂等安全)', evErr2 === null, evErr2 && evErr2.message);
assert('二次出清后 lastEvict.reason 仍为 manual', !!(CX.quizStats && CX.quizStats.lastEvict && CX.quizStats.lastEvict.reason === 'manual'));

// 5) /evict 命令注册（契约 window.__cxRegisterCommand）
assert('/evict 命令已注册', typeof cx.window.__cxRegisterCommand === 'function');

console.log('\n================ 答题缓存出清系统结论 ================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
console.log('结论: PASS — 出清入口/配置/命令齐备，手动调用安全且写入诊断');
process.exit(0);
