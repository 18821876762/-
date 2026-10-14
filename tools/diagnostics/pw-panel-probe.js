const projectPaths = require('./project-paths.cjs');
// 面板交互探针：面板打开 vs 关闭的常驻开销对比 + 一次 panel:refresh 链的 Profiler 分解
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

async function measure(page, label, seconds) {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const m0 = (await client.send('Performance.getMetrics')).metrics;
  await page.waitForTimeout(seconds * 1000);
  const m1 = (await client.send('Performance.getMetrics')).metrics;
  const get = (arr, n) => { const m = arr.find((x) => x.name === n); return m ? m.value : 0; };
  const d = (n) => ((get(m1, n) - get(m0, n)) * 1000);
  const rafCount = await page.evaluate(() => window.__rafCount || 0);
  console.log(`[${label} ${seconds}s] JS=${d('ScriptDuration').toFixed(0)}ms 布局=${d('LayoutDuration').toFixed(0)}ms 样式=${d('RecalcStyleDuration').toFixed(0)}ms rAF=${rafCount}`);
}

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

  // rAF 计数（面板打开期间是否有持续动画）
  await page.evaluate(() => { window.__rafCount = 0; const loop = () => { window.__rafCount++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });

  // 基线：面板关闭 8s
  await measure(page, '面板关闭(基线)', 8);

  // 打开面板
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })));
  await page.waitForTimeout(500);
  const panelInfo = await page.evaluate(() => {
    const p = document.getElementById('__cxPanel');
    return { exists: !!p, nodes: p ? p.getElementsByTagName('*').length : 0, display: p ? p.style.display : null };
  });
  console.log('面板:', JSON.stringify(panelInfo));

  // 面板打开 8s（videos:scanned 每 2s → refreshPanelState）
  await measure(page, '面板打开(常驻)', 8);

  // 一次 panel:refresh 链 Profiler（切 tab 触发）
  const client = await ctx.newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.start');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = document.querySelector('.cx-nav-btn[data-tab="insight"]');
      if (btn) btn.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
    });
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(200);
  const { profile } = await client.send('Profiler.stop');
  const nodes = profile.nodes, samples = profile.samples || [], deltas = profile.timeDeltas || [];
  const fnInfo = new Map(nodes.map((n) => [n.id, n.callFrame]));
  const selfTime = new Map();
  for (let i = 0; i < samples.length; i++) {
    const cf = fnInfo.get(samples[i]); if (!cf) continue;
    const key = cf.functionName || '(anon)';
    selfTime.set(key, (selfTime.get(key) || 0) + (deltas[i] || 0));
  }
  console.log('=== 面板刷新链(切tab×3) Top15 ===');
  [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([name, t]) => {
    if (t < 2000) return;
    console.log((t / 1000).toFixed(2) + 'ms  ' + name.slice(0, 70));
  });

  await browser.close();
  process.exit(0);
})();
