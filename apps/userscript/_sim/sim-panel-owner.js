// sim-panel-owner.js —— 面板「多 iframe owner 一致性 + 精简模板」回归
//
// 覆盖审计缺陷：
//   R1  syncPanelInputs 半判空：#__cxAutoVal 等数值标签缺失时（精简/裁剪模板）
//       抛 TypeError → 同一 bestEffort 块后续同步（#__cxVer 等）被整体跳过。
//   R4  非 owner 帧仍重绘面板并把本帧 CONFIG 反向覆盖回共享 DOM。
//   R5  owner 帧卸载后 _cxPanelOwner 悬空 → 存活帧永远无法接管，列表永久冻结。
//
// 手法：单 jsdom 窗口内用「伪造 owner 对象」模拟另一个 iframe 持有面板所有权，
//       断言本帧在非 owner 时不得写 DOM、owner 释放后可抢占重绘。
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const html = `<!DOCTYPE html>
<html><head><title>学习通</title></head>
<body>
  <video id="v1" src="https://mooc1.chaoxing.com/a.mp4" preload="metadata"></video>
  <div class="ans-attach-ct"></div>
</body></html>`;

const dom = new JSDOM(html, {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// jsdom 未实现 canvas / 媒体播放，补最小 mock 让绘制与续播路径真正跑通
const mockCtx = new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (p === 'getImageData') return () => ({ data: [] });
  return () => {};
} });
window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

const results = [];
let fail = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) fail++;
  results.push({ name, pass, extra: extra === undefined ? null : extra });
}

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e.stack || String(e); }
ok('产物加载无异常', !loadErr, loadErr);

function press(key) {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
function reshow() { press('p'); press('p'); }   // 隐藏 → 显示：触发 syncPanelInputs + panel:refresh

press('p');
const panel = document.getElementById('__cxPanel');
ok('按 P 后面板已创建', !!panel);

if (panel) {
  // ── 场景 1：创建者帧记录 owner ────────────────────────────────
  ok('R5-1 创建者帧被记录为 owner', panel._cxPanelOwner === window);

  const autoVal = panel.querySelector('#__cxAutoVal');
  const wrap = panel.querySelector('#__cxVideoList');
  ok('模板含 #__cxAutoVal 数值标签', !!autoVal);
  ok('模板含 #__cxVideoList 列表容器', !!wrap);

  if (autoVal && wrap) {
    // ── 场景 2：非 owner 帧（模拟另一 iframe 持有所有权）不得写共享 DOM ──
    const foreignOwner = { tag: 'other-frame' };
    panel._cxPanelOwner = foreignOwner;
    autoVal.textContent = 'SENTINEL_LABEL';
    wrap.innerHTML = '<div id="__simSentinel"></div>';
    wrap.__cxLastHTML = '__SENTINEL_CACHE__';   // 打断渲染缓存，确保 owner 帧会真正重写

    reshow();

    ok('R4-1 非 owner 帧未反向覆盖配置标签',
      autoVal.textContent === 'SENTINEL_LABEL', autoVal.textContent);
    ok('R4-2 非 owner 帧未重绘视频列表',
      !!panel.querySelector('#__simSentinel'));
    ok('R4-3 非 owner 帧未篡夺 owner',
      panel._cxPanelOwner === foreignOwner);

    // ── 场景 3：owner 释放后（原 owner 帧已卸载）存活帧应抢占并重绘 ──
    panel._cxPanelOwner = null;
    reshow();

    ok('R5-2 owner 空缺时本帧抢占所有权',
      panel._cxPanelOwner === window, String(panel._cxPanelOwner && panel._cxPanelOwner.tag));
    ok('R5-3 抢占后配置标签被正常回填',
      /^\d+$/.test((panel.querySelector('#__cxAutoVal') || {}).textContent || ''),
      (panel.querySelector('#__cxAutoVal') || {}).textContent);
    ok('R5-4 抢占后视频列表被重绘（哨兵已消失）',
      !panel.querySelector('#__simSentinel'));
  }

  // ── 场景 4：精简模板（数值标签被裁剪）不得中断后续同步 ────────
  ['#__cxAutoVal', '#__cxResumeVal', '#__cxRescanVal', '#__cxEndRelVal'].forEach(function (sel) {
    const n = panel.querySelector(sel);
    if (n && n.parentNode) n.parentNode.removeChild(n);
  });
  const ver = panel.querySelector('#__cxVer');
  ok('模板含 #__cxVer 版本位', !!ver);
  if (ver) {
    ver.textContent = 'STALE';
    reshow();
    ok('R1 精简模板下同步未被 TypeError 中断（#__cxVer 仍被回填）',
      ver.textContent !== 'STALE' && /^v\d/.test(ver.textContent), ver.textContent);
  }

  // ── 场景 5：pagehide → owner 释放（配合 uninstall）────────────
  panel._cxPanelOwner = window;
  window.dispatchEvent(new window.Event('pagehide'));
  ok('R5-5 pagehide 后 owner 已释放（存活帧可接管）',
    panel._cxPanelOwner === null, String(panel._cxPanelOwner));
  ok('R5-6 pagehide 同时完成卸载（命名空间已撤销）',
    typeof window.__CX_FORCE_PLAY === 'undefined');
}

console.log('\n=== sim-panel-owner ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
