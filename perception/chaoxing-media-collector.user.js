// ==UserScript==
// @name         学习通·媒体采集器（通用工具）
// @namespace    http://cx.local/
// @version      1.2
// @description  常驻后台，捕获你在浏览器中打开/播放的视频与音频，记录源地址、页面、时长等元信息；数据仅存本地（Tampermonkey 存储 + 可一键导出到下载文件夹），不发起任何网络请求、不外传。【v1.1 修复】UI 延迟初始化崩溃、GM 共享存储多 tab/frame 互覆、blob 导出改 <a download>、innerHTML 改 textContent 防 XSS、MAX_RECORDS 5000、周期+可见性落盘、换源重记、仅顶层建 UI。【v1.2 架构修复】顶层聚合架构：frame 经 window.top.postMessage 上报、顶层统一持久化与展示(根治 iframe 采集不实时入面板 + frame 内存/写入放大)；清空令牌 epoch(根治跨 tab/frame 清空失效)；@match 补齐裸域名/file:// 盲区；空 src 跳记；mount 时序修正；读改写注释如实说明极小竞态窗口。
// @match        https://*.chaoxing.com/*
// @match        file:///*
// 隐私/性能收敛（修复#15）：默认仅在学习通域与本地文件生效。
// 如需采集其它网站的媒体，请手动在此追加对应 @match 行（如 https://*.edu.cn/*）。
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ===== 配置 =====
  var CONFIG = {
    STORAGE_KEY: 'bmc_records_v1',     // Tampermonkey 本地存储键（关浏览器不丢）
    SAVE_THROTTLE_MS: 1500,            // 持久化节流
    FLUSH_INTERVAL_MS: 5000,           // 顶层周期兜底落盘（frame 不跑定时器，避免写入放大）
    CAPTURE_VIDEO: true,
    CAPTURE_AUDIO: true,
    CAPTURE_ON_METADATA: false,        // true=仅加载(未播放)也记录；默认关，避免预览/追踪视频噪声
    MAX_RECORDS: 5000,                 // TM 存储约 5MB，上限 5000 防超额静默失败
    UI_IN_TOP_ONLY: true               // 仅顶层窗口建悬浮 UI；frame 只采集并上报
  };
  var CLEAR_KEY = CONFIG.STORAGE_KEY + '_clear_epoch';   // 清空令牌：递增即代表发生过清空（评审#1）

  var DEBUG = false;
  var dbg = DEBUG ? function () {
    try { console.log.apply(console, ['[BMC]'].concat([].slice.call(arguments))); } catch (e) { swallow(e); }
  } : function () {};
  function warn() { try { console.warn.apply(console, ['[BMC]'].concat([].slice.call(arguments))); } catch (e) { swallow(e); } }
  // 审查 JS1-2：把空 catch 的静默吞掉改为 DEBUG 下告警；生产默认静默，不污染控制台
  function swallow(e, tag) { if (!DEBUG) return; try { warn((tag || 'swallowed') + ':', (e && e.message) ? e.message : e); } catch (_) {} }

  var isTop = (window.top === window.self);   // 仅顶层负责持久化/UI；frame 仅采集并上报

  // postMessage 白名单校验（审查#6 数据注入修复：同源 + @match 域名前缀学习通 + 本地文件）
  function trustedOrigin(o) {
    try {
      if (!o) return false;
      if (o === location.origin) return true;
      // file:// 时 location.origin 为浏览器差异（'file://' 或 'null' 或 ''），直接放行顶层 frame 的同源通道
      if (location.protocol === 'file:' && (!o || o === 'file://' || o === 'null')) return true;
      // @match 白名单：学习通（子域）、.edu.cn（子域）
      return /^https?:\/\/[^\/]*\.(chaoxing\.com|edu\.cn)(:\d+)?$/.test(o);
    } catch (e) { return false; }
  }
  // 顶层窗口时可安全地通知自身：同源
  function _targetOrigin() {
    try {
      if (location.protocol === 'file:') return '*';   // file:// 无 origin 概念，只能通配（此时是本地文件，已受浏览器沙箱限制）
      return location.origin;
    } catch (e) { return '*'; }
  }

  // ===== 本地持久化（顶层专用；读改写合并 + 清空令牌）=====
  function loadAll() {
    try { return JSON.parse(GM_getValue(CONFIG.STORAGE_KEY, '[]')) || []; } catch (e) { return []; }
  }
  var records = loadAll();            // 顶层内存缓冲；flush 后引用被同步为「存储为准」（见下）
  var dirty = false, lastSave = 0;
  var loadedEpoch = GM_getValue(CLEAR_KEY, 0);   // 启动/清空前记录的令牌值

  // frame 直接追加单条到共享存储（仅作耐久备份；id 去重，频率低，不跑定时器，避免放大，评审#5）
  function appendStore(rec) {
    try {
      var arr = loadAll();
      var have = {};
      for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id) have[arr[i].id] = 1; }
      if (!have[rec.id]) {
        if (arr.length >= CONFIG.MAX_RECORDS) arr = arr.slice(arr.length - CONFIG.MAX_RECORDS);
        arr.push(rec);
        GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(arr));
      }
    } catch (e) { warn('frame 写入失败', e); }
  }

  function scheduleSave() {
    dirty = true;
    var now = Date.now();
    if (now - lastSave > CONFIG.SAVE_THROTTLE_MS) flush();
  }
  function flush() {
    if (!dirty) return;
    // 清空令牌变化：说明别的实例执行过清空，本实例内存已失效 → 以存储为准重置（评审#1）
    var cur = GM_getValue(CLEAR_KEY, 0);
    if (cur !== loadedEpoch) { loadedEpoch = cur; records = loadAll(); dirty = false; updateBadge(); return; }
    try {
      // 读改写合并：取其它 tab/frame 最新数据，按唯一 id 去重后写回。
      // 注：读→合并→写非原子，极端并发下两个实例读同一旧值再各写，可能丢对方刚写入条目
      //（唯一 id 仅保证不重、不能保证不丢）。对“个人采集器”通常可接受，如实说明而非“保证不丢”。
      var existing = loadAll();
      var have = {};
      for (var i = 0; i < existing.length; i++) { if (existing[i] && existing[i].id) have[existing[i].id] = 1; }
      var merged = existing;
      for (var j = 0; j < records.length; j++) {
        var r = records[j];
        if (r && r.id && !have[r.id]) { merged.push(r); have[r.id] = 1; }
      }
      if (merged.length > CONFIG.MAX_RECORDS) merged = merged.slice(merged.length - CONFIG.MAX_RECORDS);
      GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(merged));
      records = merged;               // 内存缓冲同步为存储为准
    } catch (e) {
      warn('持久化失败(可能超出存储配额)，建议导出并清空记录', e);
    }
    dirty = false; lastSave = Date.now();
  }

  // 顶层收到一条记录：先处理清空令牌，再入内存并排程落盘（评审#1/#2）
  function onRec(rec) {
    var cur = GM_getValue(CLEAR_KEY, 0);
    if (cur !== loadedEpoch) { loadedEpoch = cur; records = loadAll(); }
    records.push(rec);
    scheduleSave();
    updateBadge();
  }

  // frame → 顶层实时上报；同时直接追加存储做耐久备份（评审#2/#5；审查#6 targetOrigin 收紧 + 白名单校验）
  function captureRec(rec) {
    if (isTop) { onRec(rec); }
    else {
      try { window.top.postMessage({ __bmc: true, rec: rec }, _targetOrigin()); } catch (e) { swallow(e); }
      appendStore(rec);
    }
  }

  // 顶层监听 frame 上报（审查#6 新增 origin 白名单，防任意 iframe 伪造记录污染数据）
  if (isTop) {
    window.addEventListener('message', function (e) {
      try {
        if (!trustedOrigin(e.origin)) return;
        var d = e.data;
        if (d && d.__bmc && d.rec) onRec(d.rec);
      } catch (e2) { swallow(e2); }
    });
  }

  // ===== 捕获媒体播放 =====
  // 捕获阶段 'play' 监听：任何新插入/直接打开的 video/audio 一开始播放即抓到，无需轮询 DOM。
  // @match 注入到每个 frame（含跨域），每个 frame 独立捕获自身媒体；frame 经 postMessage 汇总到顶层（评审#2/#9）。
  function mediaOf(t) {
    return (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) ? t : null;
  }
  function currentSrcOf(el) {
    var s = '';
    try { s = el.currentSrc || el.src || ''; } catch (e) { swallow(e); }
    if (!s) { try { var x = el.querySelector && el.querySelector('source'); if (x) s = x.src || ''; } catch (e2) { swallow(e2); } }
    return s;
  }
  var seenSrc = new WeakMap();        // el -> 上次记录的 src（评审#7 换源重记；同 src 不重复）
  function onPlay(e) {
    var el = mediaOf(e.target);
    if (!el) return;
    if (el.tagName === 'VIDEO' && !CONFIG.CAPTURE_VIDEO) return;
    if (el.tagName === 'AUDIO' && !CONFIG.CAPTURE_AUDIO) return;
    var src = currentSrcOf(el);
    if (src === '') return;           // 空 src 无复用价值，跳记（评审#6；blob: 仍保留以指示已打开）
    var last = seenSrc.get(el);
    if (last === src) return;         // 同 src 不重复；换源(连续剧切集)才重记
    seenSrc.set(el, src);
    var rec = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 9),  // 唯一 id，供合并去重（评审#2）
      ts: new Date().toISOString(),
      site: location.host,
      pageTitle: document.title || '',
      pageUrl: location.href,
      mediaType: el.tagName === 'VIDEO' ? 'video' : 'audio',
      src: src,
      duration: isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : null,
      referrer: document.referrer || ''
    };
    captureRec(rec);
    dbg('captured', rec);
  }
  document.addEventListener('play', onPlay, true);
  if (CONFIG.CAPTURE_ON_METADATA) document.addEventListener('loadedmetadata', onPlay, true);

  // ===== 悬浮 UI（仅顶层创建；创建与绑定一体，延迟到 body 就绪，评审#1/#10）=====
  var btnEl = null, panelEl = null;
  function updateBadge() {
    if (!btnEl) return;
    var n = records.length;
    btnEl.textContent = '🎬 ' + (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n);
  }
  // 打开面板前从存储合并，确保本会话内 iframe/frame 的采集也进面板（评审#2）
  function syncFromStorage() {
    try {
      var stored = loadAll();
      var have = {};
      for (var i = 0; i < records.length; i++) { if (records[i] && records[i].id) have[records[i].id] = 1; }
      for (var j = 0; j < stored.length; j++) {
        if (stored[j] && stored[j].id && !have[stored[j].id]) { records.push(stored[j]); have[stored[j].id] = 1; }
      }
    } catch (e) { swallow(e); }
  }
  function renderList() {
    if (!panelEl) return;
    var list = panelEl.querySelector('#bmc-list');
    if (!list) return;
    list.innerHTML = '';                                   // 清空；后续全用 textContent 构建，杜绝 XSS（评审#4）
    if (!records.length) {
      var empty = document.createElement('div'); empty.className = 'row'; empty.textContent = '暂无记录';
      list.appendChild(empty); return;
    }
    records.slice(-20).reverse().forEach(function (r) {
      var d = document.createElement('div'); d.className = 'row';
      var t = document.createElement('div'); t.className = 't'; t.textContent = '[' + r.mediaType + '] ' + (r.site || '?');
      var a = document.createElement('div'); a.textContent = (r.pageTitle || r.pageUrl || '').slice(0, 80);
      var s = document.createElement('div'); s.textContent = (r.src || '').slice(0, 90);
      d.appendChild(t); d.appendChild(a); d.appendChild(s);
      list.appendChild(d);
    });
  }
  function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
  function download(filename, text) {
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { swallow(e); } }, 30000);
    } catch (e) { warn('导出失败', e); }
  }
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function exportJSON() { download('media-collector-' + stamp() + '.json', JSON.stringify(records, null, 2)); }
  function exportCSV() {
    var head = ['ts', 'site', 'mediaType', 'src', 'duration', 'pageTitle', 'pageUrl', 'referrer'];
    var lines = [head.map(csvCell).join(',')];
    records.forEach(function (r) { lines.push(head.map(function (k) { return csvCell(r[k]); }).join(',')); });
    download('media-collector-' + stamp() + '.csv', lines.join('\n'));
  }
  function doClear() {
    if (!confirm('确认清空全部本地记录？')) return;
    // 递增清空令牌，使所有实例下次 flush/录入时以空存储重置内存（根治跨 tab/frame 清空失效，评审#1）
    loadedEpoch = loadedEpoch + 1;
    try { GM_setValue(CLEAR_KEY, loadedEpoch); } catch (e) { swallow(e); }
    try { GM_setValue(CONFIG.STORAGE_KEY, '[]'); } catch (e) { swallow(e); }
    records = []; dirty = false;
    updateBadge(); renderList();
  }

  function buildUI() {
    GM_addStyle(
      '#bmc-btn{position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#1f6feb;color:#fff;' +
      'font:13px/1.4 sans-serif;padding:6px 10px;border-radius:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);user-select:none;}' +
      '#bmc-panel{position:fixed;right:12px;bottom:48px;z-index:2147483647;width:340px;max-height:60vh;overflow:auto;' +
      'background:#fff;color:#222;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
      'font:12px/1.5 sans-serif;display:none;}' +
      '#bmc-panel .hd{padding:8px 10px;font-weight:bold;border-bottom:1px solid #eee;display:flex;justify-content:space-between;}' +
      '#bmc-panel .bd{padding:6px 10px;}' +
      '#bmc-panel .row{padding:4px 0;border-bottom:1px dashed #eee;word-break:break-all;}' +
      '#bmc-panel .t{color:#1f6feb;}' +
      '#bmc-panel button{margin:4px 4px 0 0;padding:4px 8px;cursor:pointer;}'
    );
    btnEl = document.createElement('div'); btnEl.id = 'bmc-btn';
    panelEl = document.createElement('div'); panelEl.id = 'bmc-panel';
    panelEl.innerHTML =
      '<div class="hd"><span>媒体采集器</span><span id="bmc-close" style="cursor:pointer">✕</span></div>' +
      '<div class="bd"><div id="bmc-list"></div>' +
      '<button id="bmc-json">导出 JSON</button><button id="bmc-csv">导出 CSV</button>' +
      '<button id="bmc-clear">清空记录</button></div>';
    // 创建与绑定一体；用 panel.querySelector 绑定，不依赖全局 getElementById 时序（评审#1）
    function mount() {
      document.body.appendChild(btnEl);
      document.body.appendChild(panelEl);
      btnEl.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var open = panelEl.style.display === 'block';
        panelEl.style.display = open ? 'none' : 'block';
        if (!open) { syncFromStorage(); renderList(); }   // 展开时先合并存储，iframe 采集实时可见（评审#2）
      });
      panelEl.querySelector('#bmc-close').addEventListener('click', function (ev) { ev.stopPropagation(); panelEl.style.display = 'none'; });
      panelEl.querySelector('#bmc-json').addEventListener('click', function (ev) { ev.stopPropagation(); exportJSON(); });
      panelEl.querySelector('#bmc-csv').addEventListener('click', function (ev) { ev.stopPropagation(); exportCSV(); });
      panelEl.querySelector('#bmc-clear').addEventListener('click', function (ev) { ev.stopPropagation(); doClear(); });
      updateBadge();
    }
    // 极少数脚本注入晚于 DOMContentLoaded 时 body 可能为 null 且事件已过，故用 readyState 兜底（评审健壮性）
    if (document.body || document.readyState !== 'loading') mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }

  // 仅顶层：建 UI、跑持久化定时器与卸载/隐藏落盘（frame 不持有内存、不跑定时器，消除写入放大，评审#5）
  if (isTop) {
    if (!CONFIG.UI_IN_TOP_ONLY || isTop) buildUI();
    setInterval(flush, CONFIG.FLUSH_INTERVAL_MS);
    window.addEventListener('beforeunload', function () { if (dirty) flush(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && dirty) flush(); });
  }
})();
