const projectPaths = require('./project-paths.cjs');
// 真机探针 2：真实学习通顶层 dump（strip 脚本）+ 合成播放器 iframe（高频 UI + 平台对抗）
//   对比「无脚本基线 vs 注入后」的 CDP ScriptDuration 差 → 脚本在真实结构上的真实开销
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');

const ARTIFACT = projectPaths.bundle;
const code = fs.readFileSync(ARTIFACT, 'utf8');
const DIAG = fs.readFileSync(path.resolve(__dirname, 'chaoxing-diag.js'), 'utf8');

// 真实顶层 dump：去掉 script/link/style 外链，保留 DOM 结构
let topHtml = fs.readFileSync(projectPaths.chaoxingFixture, 'utf8');
topHtml = topHtml
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<link[^>]*>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[^>]*\/>/gi, '');

// 合成播放器 iframe（ananas 播放器页：video + 高频 UI + 平台 pause/rate 对抗）
const PLAYER_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>视频播放器</title></head><body>
<div id="videoBox"><video id="v" src="https://media.example.com/lesson.mp4" preload="metadata" autoplay></video></div>
<div id="playhead">00:00</div><div id="bar"><div id="fill"></div></div>
<script>
const v = document.getElementById('v');
Object.defineProperty(v, 'currentTime', { get() { return this._t || 0; }, set(t) { this._t = t; } });
Object.defineProperty(v, 'duration', { get() { return 1800; } });
Object.defineProperty(v, 'paused', { get() { return this._p === false; }, set(p) { this._p = !p; } });
v._p = false; v._t = 120;
setInterval(() => { v._t = Math.min(1800, (v._t || 0) + 1); document.getElementById('playhead').textContent = '00:' + String(Math.floor((v._t||0)/60)).padStart(2,'0'); document.getElementById('fill').style.width = ((v._t||0)/1800*100).toFixed(1) + '%'; }, 50);
setInterval(() => { v.pause(); }, 800);
setInterval(() => { v.playbackRate = 0; setTimeout(() => { v.playbackRate = 1; }, 200); }, 1600);
</script></body></html>`;

async function measure(page, label, seconds) {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const m0 = (await client.send('Performance.getMetrics')).metrics;
  await page.waitForTimeout(seconds * 1000);
  const m1 = (await client.send('Performance.getMetrics')).metrics;
  const get = (arr, n) => { const m = arr.find((x) => x.name === n); return m ? m.value : 0; };
  const d = (n) => ((get(m1, n) - get(m0, n)) * 1000);
  console.log(`[${label} ${seconds}s] JS=${d('ScriptDuration').toFixed(0)}ms 任务=${d('TaskDuration').toFixed(0)}ms 布局=${d('LayoutDuration').toFixed(0)}ms 样式=${d('RecalcStyleDuration').toFixed(0)}ms`);
  return d('ScriptDuration');
}

(async () => {
  const execPath = projectPaths.browserExecutable(chromium);
  const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.includes('studyVideo.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: topHtml });
      if (u.includes('/ananas/')) return route.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_HTML });
      if (u.endsWith('.mp4') || u.includes('media.example.com')) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body></body></html>' });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    await page.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2', { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // 基线（无脚本）
    const base = await measure(page, '基线(无脚本)', 15);

    // 注入产物
    await page.addScriptTag({ content: code });
    await page.waitForTimeout(1000);
    const injected = await measure(page, '注入脚本后', 15);

    // 运行诊断脚本自测
    const diag = await page.evaluate((src) => {
      return new Promise((resolve) => {
        window.__diagOut = null;
        const origLog = console.log;
        const chunk = [];
        console.log = function () { chunk.push(Array.from(arguments).join(' ')); };
        try {
          eval(src);
          setTimeout(() => { console.log = origLog; resolve({ chunk: chunk.join('\n'), ns: !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.version) }); }, 13000);
        } catch (e) { console.log = origLog; resolve({ err: String(e) }); }
      });
    }, DIAG);
    const diagJson = diag.chunk ? diag.chunk.slice(diag.chunk.indexOf('=====')) : diag;
    console.log('[诊断脚本自测] 输出片段:', String(diagJson).slice(0, 400));
    console.log('[诊断脚本自测] 命名空间可见:', diag.ns);

    console.log('\n[结论] 脚本增量开销 =', (injected - base).toFixed(0) + 'ms / 15s =', ((injected - base) / 150).toFixed(2) + '% 主线程占用');
    console.log('页面错误:', errors.length ? errors.slice(0, 5) : '无');
    await ctx.close();
  } finally {
    await browser.close();
  }
  process.exit(0);
})();
