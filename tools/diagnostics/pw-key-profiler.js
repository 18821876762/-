const projectPaths = require('./project-paths.cjs');
// 按键路径 Profiler：CDP Profiler 采样一次 P 键处理的函数级耗时分布
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');

const CUR = fs.readFileSync(projectPaths.latestBundle, 'utf8');
let topHtml = fs.readFileSync(projectPaths.chaoxingFixture, 'utf8');
topHtml = topHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

const PLAYER_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>播放器</title></head><body>
<div id="videoBox"><video id="v" src="https://media.example.com/l.mp4" preload="metadata"></video></div>
<script>
const v = document.getElementById('v');
Object.defineProperty(v, 'currentTime', { get() { return this._t || 0; }, set(t) { this._t = t; } });
Object.defineProperty(v, 'duration', { get() { return 1800; } });
Object.defineProperty(v, 'paused', { get() { return this._p === false; }, set(p) { this._p = !p; } });
v._p = false; v._t = 120;
setInterval(() => { v._t = Math.min(1800, (v._t || 0) + 1); }, 50);
setInterval(() => { v.pause(); }, 800);
</script></body></html>`;

(async () => {
  const execPath = projectPaths.browserExecutable(chromium);
  const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('studyVideo.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: topHtml });
    if (u.includes('/ananas/')) return route.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_HTML });
    if (u.endsWith('.mp4')) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body></body></html>' });
  });
  const page = await ctx.newPage();
  await page.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2', { waitUntil: 'load' });
  await page.addScriptTag({ content: CUR });
  await page.waitForTimeout(1500);

  const client = await ctx.newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.start');
  // 触发 3 次按键（间隔 100ms）→ 3 条 keydown 处理链
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })));
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(200);
  const { profile } = await client.send('Profiler.stop');

  // 聚合：按函数自耗时统计（排除平台内部高频小函数）
  const nodes = profile.nodes;
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  const selfTime = new Map();
  const fnInfo = new Map();
  nodes.forEach((n) => fnInfo.set(n.id, n.callFrame));
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const d = deltas[i] || 0;
    total += d;
    const cf = fnInfo.get(samples[i]);
    if (!cf) continue;
    const key = cf.functionName || '(anon)';
    selfTime.set(key, (selfTime.get(key) || 0) + d);
  }
  const sorted = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('=== 按键处理链自耗时 Top25（总采样 ' + (total / 1000).toFixed(1) + 'ms） ===');
  sorted.forEach(([name, t]) => {
    if (t < 2000) return;   // 滤掉 <2μs 噪声
    console.log((t / 1000).toFixed(2) + 'ms  ' + name.slice(0, 70));
  });
  await browser.close();
  process.exit(0);
})();
