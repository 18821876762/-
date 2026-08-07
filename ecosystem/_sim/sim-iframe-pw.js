// 真机跨 frame 续播回归（Playwright + 完整 chromium）。
// 背景：jsdom 版 sim-iframe.js 因 jsdom 不支持 <iframe> 跨 frame 而 SKIP；本用例用真实 chromium
// 构造「顶层页 + 嵌套同源 iframe 播放器」逼近真实超星，验证脚本在跨 frame 环境下：
//   ① 正常加载、命名空间可见、运行无未捕获错误；
//   ② chaoxing 激进模式原型包装在真机生效（HTMLMediaElement.prototype.pause 不再是 [native code]）；
//   ③ 续播引擎钻入同源 iframe，对 iframe 内 <video> 调用 play（跨 frame 续播）——这是 jsdom 无法验证的核心。
// 信息性（非断言）：iframe 焦点下按 P → 顶层面板是否出现。浏览器跨 frame 键盘事件不冒泡到父 document，
//   顶层 document 的 keydown 监听收不到，预期不触发（属浏览器固有行为，非回归）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

// 探测完整 chromium 可执行文件（headless_shell 可能未下载完，改用完整 chromium 的 chrome.exe）
const LOCAL = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local');
const base = path.join(LOCAL, 'ms-playwright');
let exe = undefined;
try {
  for (const d of fs.readdirSync(base)) {
    if (/^chromium-\d+$/.test(d)) {
      const cand = path.join(base, d, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(cand)) { exe = cand; break; }
    }
  }
} catch (e) {}

const errors = [];
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: exe });
  const ctx = await browser.newContext();

  // 拦截 chaoxing 域请求，返回构造的「顶层页 + 嵌套同源 iframe 播放器」
  await ctx.route('**://mooc1.chaoxing.com/**', async (route) => {
    const u = route.request().url();
    if (/\/playvideo\.html(\?|$)/.test(u)) {
      return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><head></head><body><video id="v2" controls></video></body></html>' });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><head><title>学习通</title></head><body><div class="ans-attach-ct"><iframe id="player" src="https://mooc1.chaoxing.com/playvideo.html"></iframe></div></body></html>' });
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/Not implemented:/i.test(t) && !/Failed to load resource/i.test(t)) errors.push('console.error: ' + t.split('\n')[0]); } });

  // 在脚本前注入探针：GM_* stub + unsafeWindow stub + 记录所有 video.play 调用（含跨 frame 来源）
  await page.addInitScript(() => {
    try {
      window.GM_setValue = function () {};
      window.GM_getValue = function (k, d) { return d; };
      window.GM_addValueChangeListener = function () { return 0; };
      window.GM_removeValueChangeListener = function () {};
      window.GM_deleteValue = function () {};
      window.GM_listValues = function () { return []; };
      if (typeof window.unsafeWindow === 'undefined') window.unsafeWindow = window;
      window.__pwPlayCalls = [];
      const _o = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        try { window.__pwPlayCalls.push({ inIframe: (this.ownerDocument !== window.document) }); } catch (e) {}
        return _o.apply(this, arguments);
      };
    } catch (e) {}
  });
  // 注入产物（作为 content script 在页面脚本前运行）
  await page.addInitScript({ content: code });

  await page.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html', { waitUntil: 'load' });
  // 给 iframe 内 v2 注入真实可播放流（canvas.captureStream，不依赖网络/外部文件），
  // 使脚本续播引擎检测到"可播放视频"并主动 play（跨 frame 续播）。
  await page.evaluate(() => {
    try {
      const fr = document.getElementById('player');
      const idoc = fr && fr.contentDocument;
      const v = idoc && idoc.getElementById('v2');
      if (v && !v.srcObject && idoc.createElement('canvas').captureStream) {
        const c = idoc.createElement('canvas');
        c.width = 320; c.height = 240;
        const cx = c.getContext('2d');
        cx.fillStyle = '#222'; cx.fillRect(0, 0, 320, 240);
        v.srcObject = c.captureStream(15);
      }
    } catch (e) {}
  });
  // 等脚本初始化 + 续播 tick 跑若干轮（RESCAN_INTERVAL=2000ms）
  await page.waitForTimeout(5000);

  const nsLoaded = await page.evaluate(() => !!window.__CX_FORCE_PLAY);
  const pauseWrapped = await page.evaluate(() => !/\[native code\]/.test(HTMLMediaElement.prototype.pause.toString()));
  const probe = await page.evaluate(() => {
    const fr = document.getElementById('player');
    const idoc = fr && fr.contentDocument;
    const v = idoc && idoc.getElementById('v2');
    return { iframeVideoExists: !!v, playCalls: (window.__pwPlayCalls || []) };
  });

  // 诊断：脚本是否 drill 进 iframe、v2 续播态、play 调用明细
  const diag = await page.evaluate(() => {
    const fr = document.getElementById('player');
    const idoc = fr && fr.contentDocument;
    const v2 = idoc && idoc.getElementById('v2');
    return {
      hasIFrame: !!fr,
      iframeDocAccessible: !!idoc,
      v2Exists: !!v2,
      v2Paused: v2 ? v2.paused : null,
      v2ReadyState: v2 ? v2.readyState : null,
      v2OwnerIsIframe: v2 ? (v2.ownerDocument !== window.document) : null,
      detectSite: (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function') ? window.__CX_FORCE_PLAY.detectSite() : '?',
      topVideos: document.querySelectorAll('video').length,
      iframeVideos: idoc ? idoc.querySelectorAll('video').length : 0,
      totalPlayCalls: (window.__pwPlayCalls || []).length,
      playCallsAll: (window.__pwPlayCalls || []),
    };
  });
  console.log('DIAG:', JSON.stringify(diag));
  // 注：Playwright addInitScript 仅注入主 frame realm，同源 iframe 有独立 realm，其 play 原型未被探针 patch，
  // 故 playCalls 无法捕获 iframe 内调用；直接以「iframe video 经脚本续播后处于播放态(paused=false)」为证据。
  const iframeVideoPlaying = diag.v2Paused === false;

  // 信息性：iframe 焦点下按 P，顶层面板是否出现（预期不触发，跨 frame 事件不冒泡）
  let panelOnIframeP = null;
  try {
    await page.evaluate(() => {
      const fr = document.getElementById('player');
      const idoc = fr.contentDocument;
      const ev = new idoc.defaultView.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
      idoc.dispatchEvent(ev);
    });
    await page.waitForTimeout(300);
    panelOnIframeP = await page.evaluate(() => !!document.getElementById('__cxPanel'));
  } catch (e) { panelOnIframeP = 'ERR:' + e.message; }

  await browser.close();

  const pass = nsLoaded && errors.length === 0 && pauseWrapped && probe.iframeVideoExists && iframeVideoPlaying;
  console.log('命名空间加载        :', nsLoaded);
  console.log('原型 pause 已包装   :', pauseWrapped, '(chaoxing 激进模式)');
  console.log('iframe 内 video 存在 :', probe.iframeVideoExists);
  console.log('iframe 内 video 播放 :', diag.v2Paused, '(paused=false = 跨 frame 续播生效)');
  console.log('iframe 焦点按 P 面板 :', panelOnIframeP, '(信息性: 跨 frame 事件不冒泡，预期不触发)');
  console.log('errors              :', errors.length);
  errors.forEach((e, i) => console.log('  [' + (i + 1) + '] ' + e));
  console.log('\n结论: ' + (pass ? 'PASS' : 'FAIL'));
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('RUN_FAIL:', e.stack || e.message);
  if (browser) browser.close().catch(() => {});
  process.exit(1);
});
