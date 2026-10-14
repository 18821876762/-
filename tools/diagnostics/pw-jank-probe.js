const projectPaths = require('./project-paths.cjs');
// 真机卡顿探针（Playwright + Chromium）：本地模拟学习通答题页/视频页，注入产物，
// 用 PerformanceObserver('longtask') + 事件循环延迟测量真实主线程卡顿。
// 用法: node tools/diagnostics/pw-jank-probe.js
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');

const ARTIFACT = projectPaths.bundle;
const code = fs.readFileSync(ARTIFACT, 'utf8');

// ---------- 模拟答题页（两道题 + 倒计时 + 高频动画） ----------
const EXAM_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>考试</title></head><body>
<div class="ans-attach-ct"></div>
<div class="TiMu" id="q1"><div class="Zy_TItle">1. 单选：1+1=?</div>
  <div class="Zy_UlTop"><input type="radio" name="q1" value="A">A.1</div>
  <div class="Zy_UlTop"><input type="radio" name="q1" value="B">B.2</div></div>
<div class="TiMu" id="q2"><div class="Zy_TItle">2. 判断：地球是圆的</div>
  <div class="Zy_UlTop"><input type="radio" name="q2" value="Y">正确</div>
  <div class="Zy_UlTop"><input type="radio" name="q2" value="N">错误</div></div>
<span id="cd">600</span><div id="anim"></div>
<script>
// 平台模拟：倒计时每秒 + 动画节点高频增删 + 心跳轮询
setInterval(() => { const cd = document.getElementById('cd'); if (cd) cd.textContent = String(600 - Math.floor(Date.now()/1000)); }, 1000);
setInterval(() => { const a = document.getElementById('anim'); const d = document.createElement('div'); d.className = 'tick-anim'; a.appendChild(d); setTimeout(() => d.remove(), 250); }, 150);
setInterval(() => { const qs = document.querySelectorAll('.TiMu'); if (qs.length) qs[0].style.borderColor = '#e33'; }, 2000);
</script></body></html>`;

// ---------- 模拟视频页（播放器 + 高频 UI 刷新 + 平台暂停/伪暂停） ----------
const VIDEO_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>学习通视频</title></head><body>
<div id="videoBox"><video id="v" src="https://media.example.com/lesson.mp4" preload="metadata" autoplay></video></div>
<div class="ans-attach-ct"></div>
<div id="playhead">00:00</div><div id="bar"><div id="fill"></div></div>
<script>
const v = document.getElementById('v');
Object.defineProperty(v, 'currentTime', { get() { return this._t || 0; }, set(t) { this._t = t; } });
Object.defineProperty(v, 'duration', { get() { return 1800; } });
Object.defineProperty(v, 'paused', { get() { return this._p === false; }, set(p) { this._p = !p; } });
v._p = false; v._t = 120;
// 播放器 UI 高频刷新（进度条/时间码，每秒 ~20 次 DOM 写）
setInterval(() => { v._t = Math.min(1800, (v._t || 0) + 1); document.getElementById('playhead').textContent = '00:' + String(Math.floor((v._t||0)/60)).padStart(2,'0'); document.getElementById('fill').style.width = ((v._t||0)/1800*100).toFixed(1) + '%'; }, 50);
// 平台强制暂停（每 800ms 尝试 pause）
setInterval(() => { v.pause(); }, 800);
// 平台伪暂停（每 1.6s playbackRate=0）
setInterval(() => { v.playbackRate = 0; setTimeout(() => { v.playbackRate = 1; }, 200); }, 1600);
</script></body></html>`;

async function measure(page, label, seconds) {
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await client.send('Runtime.enable');
  const m0 = (await client.send('Performance.getMetrics')).metrics;
  const get = (arr, name) => { const m = arr.find((x) => x.name === name); return m ? m.value : 0; };
  // 错误收集
  const errors = [];
  const onErr = (e) => errors.push(String(e));
  page.on('pageerror', onErr);

  await page.waitForTimeout(seconds * 1000);

  const m1 = (await client.send('Performance.getMetrics')).metrics;
  page.off('pageerror', onErr);
  const dur = (n) => ((get(m1, n) - get(m0, n)) * 1000).toFixed(0);
  const heapMB = ((get(m1, 'JSHeapUsedSize') - get(m0, 'JSHeapUsedSize')) / 1048576).toFixed(1);
  const script = parseFloat(dur('ScriptDuration'));
  const task = parseFloat(dur('TaskDuration'));
  const layout = parseFloat(dur('LayoutDuration'));
  const style = parseFloat(dur('RecalcStyleDuration'));
  const busy = (script / (seconds * 1000) * 100).toFixed(1);
  console.log(`[${label} ${seconds}s] JS执行 ${dur('ScriptDuration')}ms(${busy}%占用) | 任务总 ${dur('TaskDuration')}ms | 布局 ${layout}ms 样式 ${style}ms | 堆增长 ${heapMB}MB | 页面错误 ${errors.length}`);
  return { script, task, layout, style, errors };
}

(async () => {
  // headless_shell 缺失时回退完整 chromium（--headless=new 走完整浏览器渲染管线，Long Task 数据更真实）
  const execPath = projectPaths.browserExecutable(chromium);
  const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox'] });
  try {
    // ---- 答题页 ----
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    // route 拦截：真实 https 域名（localStorage 可用）+ 本地 HTML 内容
    await ctx1.route('**/*', (route) => {
      const u = route.request().url();
      if (u.includes('reVersionTestStartNew')) return route.fulfill({ status: 200, contentType: 'text/html', body: EXAM_HTML });
      if (u.endsWith('.mp4') || u.includes('media.example.com')) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body></body></html>' });
    });
    await p1.goto('https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?courseId=1&clazzid=2', { waitUntil: 'load' });
    await p1.addScriptTag({ content: code });
    await p1.evaluate(() => localStorage.setItem('cx_quiz_auto', '1'));
    await p1.waitForTimeout(500);
    // 面板开关延迟（用户反馈「无法打开控制面板」）
    const openT = await p1.evaluate(() => {
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
      return performance.now() - t0;
    });
    console.log('[答题页] 按 P 打开面板同步耗时:', openT.toFixed(1) + 'ms');
    await measure(p1, '答题页 20s', 20);
    await ctx1.close();

    // ---- 视频页 ----
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await ctx2.route('**/*', (route) => {
      const u = route.request().url();
      if (u.includes('studyVideo.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: VIDEO_HTML });
      if (u.endsWith('.mp4') || u.includes('media.example.com')) return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body></body></html>' });
    });
    await p2.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2', { waitUntil: 'load' });
    const loadT = await p2.evaluate(async (src) => {
      const t0 = performance.now();
      const s = document.createElement('script');
      s.textContent = src;
      document.documentElement.appendChild(s);
      s.remove();
      return performance.now() - t0;
    }, code);
    console.log('[视频页] 脚本注入同步耗时:', loadT.toFixed(1) + 'ms');
    await p2.waitForTimeout(1000);
    await measure(p2, '视频页 20s', 20);
    await ctx2.close();
  } finally {
    await browser.close();
  }
  console.log('\n探针结束');
  process.exit(0);
})();
