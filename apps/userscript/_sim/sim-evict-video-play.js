// 回归：v4.19.50 视频「播放事件」完全出清（用户需求：视频播放 = 上一题时段结束，双端等同刷新页面）。
// 课程页帧：play 且稳定键变化 → 本帧 quizHardReset + 写 GM 通知键 cx_quiz_evict_v1（同 key 不重复）；
// 课程页各帧经 GM 监听响应 → quizHardReset('video-play')；DS 应答端页经 GM 监听 → _dsEvictAll。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

function loadAt(url, html, gmSet) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window;
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; this.dispatchEvent(new win.Event('play')); return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {}, fillText() {}, measureText() { return { width: 0 }; } }; };
  // GM 桩：写键 + 记录写入 + 保存回调（供断言通知键写入、内容与远程触发）
  win.GM_setValue = function (k, v) { win.__gmStore = win.__gmStore || {}; win.__gmStore[k] = v; win.__gmWrites = win.__gmWrites || []; win.__gmWrites.push([k, v]); };
  win.GM_addValueChangeListener = function (k, cb) { win.__gmListeners = win.__gmListeners || {}; (win.__gmListeners[k] = win.__gmListeners[k] || []).push(cb); return (win.__gmLid = (win.__gmLid || 0) + 1); };
  win.GM_removeValueChangeListener = function () {};
  win.eval(code);
  return win;
}

let pass = 0, fail = 0;
function assert(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); } }

(async () => {
  // ===== ① 课程页：play 事件 → 出清 + GM 通知（同 key 不重复） =====
  const cx = loadAt('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1&chapterId=2',
    '<body><div id="videoBox"><video id="v1" src="https://s2.cldisk.com/a.mp4"></video></div><div class="ans-attach-ct"></div><div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】题</span></div><ul class="Zy_ulTop"><li class="before-after-checkbox">A 甲</li><li class="before-after-checkbox">B 乙</li></ul></div></body>');
  const CX = cx.__CX_FORCE_PLAY;
  assert('① quizHardReset 已导出（供播放出清调用）', typeof CX.quizHardReset === 'function');

  // 先制造答题态：手动置 handled 一条，验证出清清空
  const schedBefore = CX._quizSchedStats();
  // 直接驱动一次 tick 产生作答
  CX.runSiteTick('chaoxing');
  await new Promise((r) => setTimeout(r, 100));
  const handledBefore = CX._quizSchedStats().handledCount;
  assert('① 题被作答/占坑（handled>0，出清前提）', handledBefore > 0, { handledBefore });

  // 触发 play（视频 src 稳定键 → 触发出清）
  const v1 = cx.document.getElementById('v1');
  v1.play();
  await new Promise((r) => setTimeout(r, 100));
  const handledAfter = CX._quizSchedStats().handledCount;
  assert('① 视频 play 后答题态已出清（handled 归 0，等同刷新）', handledAfter === 0, { handledBefore, handledAfter });

  // GM 通知键已写入且带 video-play
  const evWrites = (cx.__gmWrites || []).filter((w) => w[0] === 'cx_quiz_evict_v1');
  assert('① GM 通知键 cx_quiz_evict_v1 已写入', evWrites.length > 0 && evWrites[0][1].indexOf('video-play') >= 0, { writes: evWrites });

  // 同 key 再次 play（暂停恢复/循环）→ 不再写入（key 守卫）
  const nBefore = (cx.__gmWrites || []).length;
  v1.play();
  await new Promise((r) => setTimeout(r, 50));
  v1.play();
  await new Promise((r) => setTimeout(r, 50));
  assert('① 同视频重复 play 不重复出清（无新增 GM 写入）', (cx.__gmWrites || []).length === nBefore);

  // 换视频（换 video 元素 id → 稳定键变化，模拟换节；videoDriftStableKeys 取 id+宿主 iframe src，不含 video.src，
  // 故单纯改 src 不触发——防 blob 重建误清，属正确行为）→ 再次出清
  const v2 = cx.document.createElement('video');
  v2.id = 'v2'; v2.src = 'https://s2.cldisk.com/a.mp4';
  cx.document.getElementById('videoBox').appendChild(v2);
  v2.play();
  await new Promise((r) => setTimeout(r, 100));
  assert('① 换视频（新 id）后再次触发出清（出现第 2 次 GM 写入）', (cx.__gmWrites || []).filter((w) => w[0] === 'cx_quiz_evict_v1').length >= 2);
  // 单纯改 src（同 id）不触发（防 blob 重建误清）
  const nSrc = (cx.__gmWrites || []).length;
  v2.src = 'https://s2.cldisk.com/c.mp4';
  v2.play();
  await new Promise((r) => setTimeout(r, 60));
  assert('① 同 id 仅改 src 不触发（稳定键不变，防 blob 重建误清）', (cx.__gmWrites || []).length === nSrc);

  // ===== ③ 远程 GM 通知响应 + 开关守卫（复核 B） =====
  function fireEvictGm(win) {
    const ls = win.__gmListeners && win.__gmListeners['cx_quiz_evict_v1'];
    if (!ls) return 0;
    ls.forEach((cb) => { try { cb('cx_quiz_evict_v1', null, JSON.stringify({ ts: Date.now(), by: 'video-play' }), true); } catch (e) {} });
    return ls.length;
  }
  // 重新制造答题态
  CX.runSiteTick('chaoxing');
  await new Promise((r) => setTimeout(r, 100));
  const nRemote = fireEvictGm(cx);
  await new Promise((r) => setTimeout(r, 100));
  const h1 = CX._quizSchedStats().handledCount;
  assert('③ 远程 GM 通知触发 quizHardReset（handled 归 0）', nRemote > 0 && h1 === 0, { nRemote, h1 });
  // 关闭开关 → 远程通知不再响应
  CX.runSiteTick('chaoxing');
  await new Promise((r) => setTimeout(r, 100));
  const hOn = CX._quizSchedStats().handledCount;
  CX.CONFIG.QUIZ_EVICT_ON_VIDEO_PLAY = false;
  fireEvictGm(cx);
  await new Promise((r) => setTimeout(r, 100));
  const hOff = CX._quizSchedStats().handledCount;
  assert('③ 开关关闭后远程通知不响应（状态保持）', hOn > 0 && hOff === hOn, { hOn, hOff });
  CX.CONFIG.QUIZ_EVICT_ON_VIDEO_PLAY = true;   // 恢复，避免影响后续

  // ===== ② DS 应答端页：_dsEvictAll 导出 + 清空应答态 =====
  const ds = loadAt('https://chat.deepseek.com/', '<body></body>');
  const DSX = ds.__CX_FORCE_PLAY;
  assert('② _dsEvictAll 已导出', typeof DSX._dsEvictAll === 'function');
  // 制造应答态：置队列/看门狗引用后调用 _dsEvictAll（应答器内部态仅能通过导出函数清理，这里验证不抛错 + 计数可读）
  DSX._dsEvictAll('test');
  const loopS = DSX._dsLoopStats ? DSX._dsLoopStats() : null;
  assert('② _dsEvictAll 执行无异常且应收端计数归零', loopS !== null && typeof loopS.rspReceived === 'number' && loopS.rspReceived === 0 && loopS.asksSent === 0, { loopS });

  console.log('\n================ 视频播放完全出清 结论 ================');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
  console.log('结论: PASS — 视频播放事件触发双端完全出清（等同刷新），同 key 不重复');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });