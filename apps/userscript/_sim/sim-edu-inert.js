// sim-edu-inert.js — 行为回归：edu.cn 路由与接管边界。
// 历史：早期评审 #19/#6842 曾要求非超星特征 edu.cn 完全惰性（不接管）；但该实现误伤真实超星高校镜像视频，
// 违反 #1 回归「edu.cn 视为 chaoxing 须接管视频」（优先级更高）。现约定：edu 站**也接管视频**，
// 但 SITES.edu 为空键（无 attachmentsKey/ananasKey），不钩 window.attachments/ananas 私有全局 ——
// 即 #19 的「收窄」由空键满足，而非靠惰性跳过。正向识别为超星的 edu.cn 与常规 chaoxing.com 路由到 'chaoxing'。
// 复跑：node scripts/run-sim.js ；或随 `npm run test:sim` 一并执行。
// 说明：本文件为 jsdom 仿真用例，不在 Playwright 真机用例清单（smoke-pw/sim-iframe-pw/sim-bridge-noise-pw）内。
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
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

// 在指定 URL 下加载产物并触发一次视频 play 事件，返回接管探针结果
function probe(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const ctx = dom.getInternalVMContext();
  vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' });
  const v = window.document.createElement('video');
  window.document.body.appendChild(v);
  v.dispatchEvent(new window.Event('play'));
  return {
    site: window.__CX_FORCE_PLAY.detectSite(),
    // v4.19.51：forcePaused 已 Symbol 化，须经命名空间 FLAGS 访问
    taken: !!v[window.__CX_FORCE_PLAY.FLAGS.forcePaused],
    pauseNative: v.pause === window.HTMLMediaElement.prototype.pause,
  };
}

// ① 非超星特征 edu.cn（根路径、无超星特征）→ 仍路由 'edu'，但自 #1 回归起 edu **也接管视频**（仅不钩私有全局，由 SITES.edu 空键保证），
//    故视频 play 会被接管、pause 被中性化覆写；#19 的「收窄」已由 SITES.edu 空键（无 attachmentsKey/ananasKey）满足，不靠惰性跳过。
{
  const r = probe('https://www.pku.edu.cn/');
  assert('[edu] detectSite=edu @ www.pku.edu.cn', r.site === 'edu');
  assert('[edu] 非超星特征 edu.cn 视频 play 仍被接管（__cxForcePaused 已置，#1 回归：edu 也接管）', r.taken);
  assert('[edu] 非超星特征 edu.cn 视频 pause 被覆写中性化（不依赖原生 pause）', !r.pauseNative);
}
// ② 正向识别为超星的 edu.cn（/learn 路径特征）→ 路由到 chaoxing（接管由其它用例覆盖，此处仅确认不被惰性拦截）
{
  const r = probe('https://xxx.edu.cn/learn/abc');
  assert('[chaoxing-edu] detectSite=chaoxing @ xxx.edu.cn/learn（未被惰性）', r.site === 'chaoxing');
}
// ③ 常规 chaoxing.com → 仍路由到 chaoxing
{
  const r = probe('https://mooc1.chaoxing.com/learn/abc');
  assert('[chaoxing] detectSite=chaoxing @ mooc1.chaoxing.com', r.site === 'chaoxing');
}

process.exit(fail ? 1 : 0);
