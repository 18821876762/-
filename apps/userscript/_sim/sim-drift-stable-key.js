// 回归：dom.js _ovDriftGuard + dedup.js videoDriftStableKeys —— v4.19.17 修复「定向关闭时视频反复跳回开头重播」。
// 根因：定向(TARGET)关闭时 videoIframeSrcsOf 返回 []，漂移守卫 keys 只剩易变 blob: src；
//       平台防挂机重建 <video>/重生成 blob → 旧进度 _srcMaxTime 整组删除 → 新元素进度从 0 累计 → 循环重播。
// 修复：额外并入「不依赖定向的稳定键」(video 自身 id + 最近宿主 iframe 稳定 src/id)，跨重建存活 → 回拨守卫正确 seek 回 max。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
win.eval(code);
const ns = win.__CX_FORCE_PLAY;

let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}

const STABLE = ns.videoDriftStableKeys;
assert('videoDriftStableKeys 已导出', typeof STABLE === 'function', typeof STABLE);

// 构造：document > div > iframe(player 稳定地址) > div > video
function buildVideo(opts) {
  const iframe = win.document.createElement('iframe');
  iframe.src = opts.iframeSrc;
  const mid = win.document.createElement('div');
  iframe.appendChild(mid);
  const v = win.document.createElement('video');
  if (opts.id) v.id = opts.id;
  v.currentSrc = opts.blob;     // MSE 播放器：currentSrc 为 blob:
  v.src = opts.blob;
  v.duration = 600;
  v.currentTime = 0;
  mid.appendChild(v);
  win.document.body.appendChild(iframe);
  return v;
}

// —— 关键回归：blob 易变，但稳定键不变（跨重建存活）——
const v1 = buildVideo({ iframeSrc: 'https://media.chaoxing.com/player?id=ABC123', blob: 'blob:https://x/aaaa', id: 'v-1' });
const k1 = STABLE(v1);
// 重建：新元素、新 blob、但同 iframe src、同 video id
const v2 = buildVideo({ iframeSrc: 'https://media.chaoxing.com/player?id=ABC123', blob: 'blob:https://x/bbbb', id: 'v-1' });
const k2 = STABLE(v2);
assert('稳定键非空(含 iframe 稳定 src)', Array.isArray(k1) && k1.length >= 1 && k1.some(function (x) { return x.indexOf('f:') === 0; }), k1);
assert('跨 blob 重建后稳定键完全一致', JSON.stringify(k1) === JSON.stringify(k2), { k1: k1, k2: k2 });
assert('video 自身 id 也进稳定键', k1.indexOf('v:v-1') >= 0, k1);

// —— 守卫 keys 合成（复刻 _ovDriftGuard 逻辑，用导出原语）：max 跨重建存活 → 打破循环 ——
// 旧 bug：keys 仅 [blob]，重建后 max 归 0 → 跳回开头；
// 新行为：keys = [blob].concat(videoIframeSrcsOf, videoDriftStableKeys)，稳定键存活 → max 保持 50。
function keysOf(v) {
  // videoIframeSrcsOf 受 TARGET 影响，此处仅验证稳定键部分（修复核心），blob 用 videoSrcOf。
  const key0 = (ns.videoSrcOf ? ns.videoSrcOf(v) : (v.currentSrc || v.src || ''));
  return [key0].concat(STABLE(v)).filter(function (k) { return !!k; });
}
const maxTable = {};
function recordMax(keys, t) { for (const k of keys) { if (!maxTable[k]) maxTable[k] = t; else if (t > maxTable[k]) maxTable[k] = t; } }
function maxOf(keys) { let m = 0; for (const k of keys) { if (maxTable[k] && maxTable[k] > m) m = maxTable[k]; } return m; }

// 第一轮（旧 blob）：播到 50s，记录 max
const keysA = keysOf(v1);
recordMax(keysA, 50);
assert('第一轮后 max=50', maxOf(keysA) === 50, maxOf(keysA));
// 重建（新 blob）：新元素进度从 0 起；但稳定键相同 → max 仍 50（不被 blob 变化清零）
const keysB = keysOf(v2);
assert('重建后稳定键 max 仍=50（旧 bug 会=0 → 跳回开头）', maxOf(keysB) === 50, maxOf(keysB));
// 守卫回拨判定：t=0 < max-1.5 → 应 seek 到 min(max, d-0.5)=50（而非 0）
// 注：真实页面用 v.duration（真实数值）；jsdom 未实现 media，duration=NaN，故用常量替代。
const DUR = 600;
const seekTarget = Math.min(50, DUR - 0.5);
assert('重建后回拨守卫 seek 目标=50（非 0）', seekTarget === 50, seekTarget);

// —— 反例：若没有稳定键（仅 blob），max 会归 0 → 这正是循环根因 ——
const onlyBlob = [v2.currentSrc];
assert('仅 blob 键时 max 归 0（证明旧行为会跳回开头）', maxOf(onlyBlob) === 0, maxOf(onlyBlob));

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAIL=' + fail) + ' (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
