// sim-multiframe.js —— 真·双窗口（顶层帧 + 同源 iframe 帧）面板一致性回归
//
// 与 sim-panel-owner.js 的区别（后者是单窗口伪造 owner）：
//   本用例用 jsdom 的 ResourceLoader 真起一个**同源 iframe**，在两个 window 里各自 eval 一份产物，
//   于是 window.top / 跨帧 document 共享 / 两套独立模块闭包 全部是真的。
//   这正是审计报告附录 D.4 标注「沙箱无法覆盖」的那一层。
//
// 真实场景取自超星：视频播放器在 iframe 内，脚本在两帧各跑一份；面板只应有一个（挂顶层文档）。
// 覆盖：
//   M1 面板全站单例（子帧复用顶层面板，不各建一个）
//   M2 owner = 首个创建帧；另一帧不得篡夺、不得覆盖其渲染
//   M3 跨帧视频聚合（顶层帧列表含 iframe 内视频）
//   M4 owner 帧（此处为 iframe 帧）卸载后，存活帧必须能重新接管并恢复出可见面板
'use strict';

const { JSDOM, requestInterceptor } = require('jsdom');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const TOP_URL = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1&clazzid=2';
const FRAME_URL = 'https://mooc1.chaoxing.com/ananas/modules/video/index.html';

const frameHtml = `<!DOCTYPE html><html><head><title>播放器</title></head>
<body><video id="fv" src="https://mooc1.chaoxing.com/frame.mp4" preload="metadata"></video></body></html>`;

const topHtml = `<!DOCTYPE html><html><head><title>学习通</title></head>
<body>
  <video id="tv" src="https://mooc1.chaoxing.com/top.mp4" preload="metadata"></video>
  <iframe id="pf" src="${FRAME_URL}" width="800" height="450"></iframe>
</body></html>`;

// 用请求拦截器喂 iframe：既保证与顶层**同源**（跨帧可达），又不需要真实网络/本地服务
const dom = new JSDOM(topHtml, {
  url: TOP_URL,
  runScripts: 'dangerously',
  resources: {
    interceptors: [
      requestInterceptor(function (request) {
        if (request.url === FRAME_URL) {
          return new Response(frameHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return undefined;   // 其余请求不放行（无网络环境下自然失败即可）
      })
    ]
  },
  pretendToBeVisual: true,
});
const topWin = dom.window;

const results = [];
let fail = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) fail++;
  results.push({ name, pass, extra: extra === undefined || extra === null ? null : String(extra) });
}

// jsdom 无 canvas / 媒体实现：两帧都要打补丁，否则绘制与续播路径走不通
function patch(win) {
  const mockCtx = new Proxy({}, { get: (t, p) => {
    if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (p === 'getImageData') return () => ({ data: [] });
    return () => {};
  } });
  win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
  win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () {};
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
}

function press(doc, win, key) {
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
function reshow(doc, win) { press(doc, win, 'p'); press(doc, win, 'p'); }   // 隐藏→显示：触发同步 + 重绘

function finish() {
  console.log('\n=== sim-multiframe ===');
  results.forEach(function (r) {
    console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
  });
  console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
  process.exit(fail === 0 ? 0 : 1);
}

const guard = setTimeout(function () {
  ok('iframe 在 8s 内完成加载', false, 'timeout');
  finish();
}, 8000);

topWin.addEventListener('load', function () {
  clearTimeout(guard);
  setTimeout(run, 30);
});

function run() {
  const topDoc = topWin.document;
  const iframe = topDoc.getElementById('pf');
  const childWin = iframe && iframe.contentWindow;
  const childDoc = iframe && iframe.contentDocument;

  ok('前置：同源 iframe 已就绪', !!(childWin && childDoc && childDoc.getElementById('fv')),
    childDoc && childDoc.readyState);
  if (!childWin || !childDoc || !childDoc.getElementById('fv')) return finish();

  ok('前置：子帧可达顶层文档（同源）', childWin.top === topWin && !!childWin.top.document.body);

  patch(topWin);
  patch(childWin);

  // ── 注入顺序取真实情形：播放器 iframe 常先就绪并抢先建面板（owner = 子帧）──
  let err1 = null, err2 = null;
  try { childWin.eval(code); } catch (e) { err1 = e.stack || String(e); }
  try { topWin.eval(code); } catch (e) { err2 = e.stack || String(e); }
  ok('子帧产物加载无异常', !err1, err1);
  ok('顶层帧产物加载无异常', !err2, err2);

  // ── M1：子帧建面板 → 必须挂在顶层文档，且全站仅一个 ──────────────
  press(childDoc, childWin, 'p');
  const panel = topDoc.getElementById('__cxPanel');
  ok('M1-1 子帧建的面板挂在顶层文档', !!panel);
  ok('M1-2 子帧自身文档内不存在面板副本',
    childDoc.querySelectorAll('#__cxPanel').length === 0,
    childDoc.querySelectorAll('#__cxPanel').length);
  if (!panel) return finish();
  ok('M1-3 owner 记为子帧（首个创建者）', panel._cxPanelOwner === childWin);

  // 顶层帧随后也启用面板：应复用同一节点，不得新建第二个
  press(topDoc, topWin, 'p');
  ok('M1-4 顶层帧复用同一面板（顶层文档仍只有 1 个）',
    topDoc.querySelectorAll('#__cxPanel').length === 1,
    topDoc.querySelectorAll('#__cxPanel').length);

  // ── M3：跨帧视频聚合（owner 帧的列表应同时含顶层与 iframe 内视频）──
  // 注意：一行里 item 容器与 toggle 按钮都带 data-vi，统计行数必须限定 .cx-video-item
  const rows0 = panel.querySelectorAll('#__cxVideoList .cx-video-item[data-vi]');
  ok('M3-1 owner 帧列表聚合了两帧视频（顶层 1 + iframe 1）',
    rows0.length === 2, rows0.length + ' 行');
  ok('M3-2 列表 data-vi 连续无缺口',
    Array.prototype.map.call(rows0, function (n) { return n.getAttribute('data-vi'); })
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(',') === '0,1',
    Array.prototype.map.call(rows0, function (n) { return n.getAttribute('data-vi'); }).join(','));

  // ── M2：非 owner 帧（顶层帧）不得覆盖 owner 帧的渲染与所有权 ──────
  const verNode = panel.querySelector('#__cxVer');
  const wrap = panel.querySelector('#__cxVideoList');
  ok('前置：面板含版本位与列表容器', !!verNode && !!wrap);
  if (verNode && wrap) {
    verNode.textContent = 'SENTINEL_VER';
    wrap.innerHTML = '<div id="__simSentinel"></div>';
    wrap.__cxLastHTML = '__SENTINEL_CACHE__';

    reshow(topDoc, topWin);   // 顶层帧（非 owner）刷新

    ok('M2-1 非 owner 帧未回填版本位', verNode.textContent === 'SENTINEL_VER', verNode.textContent);
    ok('M2-2 非 owner 帧未重绘视频列表', !!panel.querySelector('#__simSentinel'));
    ok('M2-3 非 owner 帧未篡夺 owner', panel._cxPanelOwner === childWin);

    reshow(childDoc, childWin);   // owner 帧刷新：应正常重绘
    ok('M2-4 owner 帧刷新正常回填版本位',
      /^v\d/.test(panel.querySelector('#__cxVer').textContent || ''),
      panel.querySelector('#__cxVer').textContent);
    ok('M2-5 owner 帧刷新重绘了列表（哨兵消失）', !panel.querySelector('#__simSentinel'));
  }

  // ── M4：owner 帧（iframe）被卸载/替换后，存活的顶层帧必须能恢复面板 ──
  // 真实触发：章节切换时播放器 iframe 被移除 → 子帧 pagehide → 子帧执行卸载清理。
  childWin.dispatchEvent(new childWin.Event('pagehide'));

  ok('M4-1 owner 帧卸载后所有权已释放',
    !panel._cxPanelOwner || panel._cxPanelOwner !== childWin, String(panel._cxPanelOwner));
  ok('M4-2 子帧卸载不得撤销顶层帧的命名空间（各帧独立）',
    typeof topWin.__CX_FORCE_PLAY !== 'undefined' && typeof childWin.__CX_FORCE_PLAY === 'undefined');

  // 存活帧继续操作：面板必须仍然可见可用（不得因子帧清理把共享面板删成"幽灵"）
  reshow(topDoc, topWin);
  const liveNodes = topDoc.querySelectorAll('#__cxPanel');
  ok('M4-3 存活帧仍有且仅有一个面板挂在顶层文档', liveNodes.length === 1, liveNodes.length);
  const live = liveNodes[0];
  if (live) {
    ok('M4-4 存活帧接管所有权', live._cxPanelOwner === topWin, String(live._cxPanelOwner));
    const liveVer = live.querySelector('#__cxVer');
    if (liveVer) liveVer.textContent = 'STALE_AFTER_UNLOAD';
    reshow(topDoc, topWin);
    ok('M4-5 接管后面板内容可被正常刷新',
      liveVer && /^v\d/.test(liveVer.textContent || ''), liveVer && liveVer.textContent);
    ok('M4-6 接管后列表仍渲染出顶层视频',
      live.querySelectorAll('#__cxVideoList .cx-video-item[data-vi]').length >= 1,
      live.querySelectorAll('#__cxVideoList .cx-video-item[data-vi]').length);
  }

  // ── M5：面板节点被外力移除（站点 SPA 重写 body / 别的帧手动卸载）后必须自愈 ──
  // 这是 R11 的直接回归：旧实现里 ensurePanel 会把已脱离文档的缓存节点原样返回，
  // 之后所有读写都打在孤儿 DOM 上 → 面板永远不再出现。
  const before = topDoc.getElementById('__cxPanel');
  if (before && before.parentNode) before.parentNode.removeChild(before);
  ok('M5-1 前置：面板节点已被外力移除', !topDoc.getElementById('__cxPanel'));

  press(topDoc, topWin, 'p');   // 隐藏（此时已无节点）
  press(topDoc, topWin, 'p');   // 再显示：应重建
  const healed = topDoc.getElementById('__cxPanel');
  ok('M5-2 存活帧重建出新面板（缓存脱离态被丢弃）', !!healed);
  ok('M5-3 重建后仍是唯一面板', topDoc.querySelectorAll('#__cxPanel').length === 1,
    topDoc.querySelectorAll('#__cxPanel').length);
  if (healed) {
    ok('M5-4 重建面板归本帧所有', healed._cxPanelOwner === topWin);
    reshow(topDoc, topWin);
    const hv = healed.querySelector('#__cxVer');
    ok('M5-5 重建面板内容可正常刷新', !!hv && /^v\d/.test(hv.textContent || ''), hv && hv.textContent);
  }

  finish();
}
