const projectPaths = require('./project-paths.cjs');
// A/B 交互延迟探针：同一真实结构页面，分别注入 Release 4.18 与当前构建，
// 实测「交互操作响应时间」与主线程占用——定位新版本相对老版本的交互延迟来源。
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');

if (!process.argv[2]) {
  console.error('用法：node tools/diagnostics/pw-ab-interact.js <Release-4.18脚本> [当前脚本]');
  process.exit(2);
}
const REL = fs.readFileSync(path.resolve(process.argv[2]), 'utf8');
const CUR = fs.readFileSync(process.argv[3] ? path.resolve(process.argv[3]) : projectPaths.latestBundle, 'utf8');

let topHtml = fs.readFileSync(projectPaths.chaoxingFixture, 'utf8');
topHtml = topHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

const PLAYER_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>播放器</title></head><body>
<div id="videoBox"><video id="v" src="https://media.example.com/l.mp4" preload="metadata"></video></div>
<div id="ph">00:00</div><div id="bar"><div id="fill"></div></div>
<script>
const v = document.getElementById('v');
Object.defineProperty(v, 'currentTime', { get() { return this._t || 0; }, set(t) { this._t = t; } });
Object.defineProperty(v, 'duration', { get() { return 1800; } });
Object.defineProperty(v, 'paused', { get() { return this._p === false; }, set(p) { this._p = !p; } });
v._p = false; v._t = 120;
setInterval(() => { v._t = Math.min(1800, (v._t || 0) + 1); document.getElementById('ph').textContent = '00:' + String(Math.floor((v._t||0)/60)).padStart(2,'0'); document.getElementById('fill').style.width = ((v._t||0)/1800*100).toFixed(1) + '%'; }, 50);
setInterval(() => { v.pause(); }, 800);
setInterval(() => { v.playbackRate = 0; setTimeout(() => { v.playbackRate = 1; }, 200); }, 1600);
</script></body></html>`;

async function runOnce(browser, code, label) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('studyVideo.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: topHtml });
    if (u.includes('/ananas/')) return route.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_HTML });
    if (u.endsWith('.mp4') || u.includes('media.example.com')) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body></body></html>' });
  });
  const page = await ctx.newPage();
  await page.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2', { waitUntil: 'load' });
  await page.addScriptTag({ content: code });
  await page.waitForTimeout(1500);

  // 主线程占用（CDP）
  const client = await ctx.newCDPSession(page);
  await client.send('Performance.enable');
  const m0 = (await client.send('Performance.getMetrics')).metrics;
  const get = (arr, n) => { const m = arr.find((x) => x.name === n); return m ? m.value : 0; };

  // 交互响应测量：20 次「按键 P + 点击 body」，测每次事件派发同步耗时
  const interact = await page.evaluate(async () => {
    const res = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
      const tKey = performance.now() - t0;
      const t1 = performance.now();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      const tClick = performance.now() - t1;
      res.push({ key: Math.round(tKey * 10) / 10, click: Math.round(tClick * 10) / 10 });
      await new Promise((r) => setTimeout(r, 250));
    }
    return res;
  });
  const m1 = (await client.send('Performance.getMetrics')).metrics;
  const d = (n) => ((get(m1, n) - get(m0, n)) * 1000);
  const keyMs = interact.map((x) => x.key);
  const clickMs = interact.map((x) => x.click);
  const pct = (arr) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
  console.log(`[${label}] 按键响应 平均${pct(keyMs)}ms 最大${Math.max(...keyMs).toFixed(1)}ms >30ms:${keyMs.filter((v) => v > 30).length}次 | 点击响应 平均${pct(clickMs)}ms | JS占用 ${d('ScriptDuration').toFixed(0)}ms/${(d('ScriptDuration')/1000*100/5).toFixed(1)}% `);
  await ctx.close();
  return { keyMs, clickMs, script: d('ScriptDuration') };
}

(async () => {
  const execPath = projectPaths.browserExecutable(chromium);
  const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox'] });
  try {
    console.log('=== A/B 交互延迟（真实结构 + 播放器对抗，5s 窗口） ===');
    const rel = await runOnce(browser, REL, 'Release 4.18(老版本)');
    const cur = await runOnce(browser, CUR, '当前构建(新版本)');
    const relSlow = rel.keyMs.filter((v) => v > 30).length;
    const curSlow = cur.keyMs.filter((v) => v > 30).length;
    console.log(`\n对比: 按键>30ms次数 ${relSlow} vs ${curSlow} | 按键平均 ${(rel.keyMs.reduce((a,b)=>a+b,0)/20).toFixed(1)}ms vs ${(cur.keyMs.reduce((a,b)=>a+b,0)/20).toFixed(1)}ms | JS占用 ${(rel.script/1000*100/5).toFixed(1)}% vs ${(cur.script/1000*100/5).toFixed(1)}%`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})();
