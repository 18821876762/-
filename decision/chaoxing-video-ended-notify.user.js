// ==UserScript==
// @name         学习通·视频结束系统通知（副脚本）
// @namespace    http://cx.local/
// @version      1.1
// @author       anon
// @description  【副脚本·接入主控面板】视频播放到结束后提醒。已授权通知权限→弹系统级通知；未授权→标签页标题闪烁+图标红点+底部常驻横幅（切回页面即弹出）+ 任务栏应用红点徽标（需把本页装成 Edge 应用/PWA，无需权限），等效"浏览器外弹窗"。监听原生 ended 事件，不干预主脚本续播状态机。默认关闭。开关挂入 chaoxing-force-play(4.7) 主控面板（按 P 呼出 → 副脚本区）。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

// ┌──────────────────────────────────────────────────────────────────────────┐
// │ 内聚性分层（v1.1 结构重组，行为零变更）                                   │
// │ 副脚本的分发单元是单个 .user.js（用户直接导入油猴），不可拆多文件，        │
// │ 故采用「文件内分层」：同层内聚、层间单向依赖，自上而下不回头引用。        │
// │                                                                          │
// │   L0 基础设施  swallow / TOP 顶层窗口解析                                │
// │   L1 状态      state（启用态）+ 各层私有模块变量                          │
// │   L2 提醒通道  CHANNELS 注册表：badge/banner/titleFlash/favicon/system     │
// │                —— 每通道自持状态与 fire/clear，互不知晓                   │
// │   L3 提醒编排  attention（降级链编排）/ showNotify（权限分诊）            │
// │   L4 视频发现  scanDoc / scanAll / bindVideo（穿透 iframe + Shadow DOM）  │
// │   L5 结束判定  fire / onEnded / onTimeupdate / checkLoop（三路信号归一）  │
// │   L6 集成      悬浮开关 UI / 主面板 addon 契约 / 调试钩子 / 启动          │
// └──────────────────────────────────────────────────────────────────────────┘

(function () {
  'use strict';

  // 幂等守卫：防止油猴重复注入叠加监听器
  if (window.__cxEndedNotifyStarted) return;
  window.__cxEndedNotifyStarted = true;

  // ═══════════════════════════════════════════════════════════════════════
  // L0 · 基础设施
  // ═══════════════════════════════════════════════════════════════════════

  function swallow(e) { try { /* 静默吞掉，仅开发态可放开 console */ } catch (_) {} }

  // 顶层窗口：超星视频常嵌在同源 iframe 内，iframe 的 title/favicon 不影响浏览器标签页。
  // 故所有「标签页级」反馈（标题闪烁、图标红点、底部横幅、悬浮开关、调试钩子）一律作用到 window.top，
  // 否则你在任务栏/标签页看到的仍是顶层文档，提醒形同虚设。跨域 iframe 访问 top.document 会抛错，回退到自身。
  var TOP = window;
  try { if (window.top && window.top !== window && window.top.document) TOP = window.top; } catch (e) { TOP = window; }

  // ═══════════════════════════════════════════════════════════════════════
  // L1 · 状态
  // ═══════════════════════════════════════════════════════════════════════

  var state = {
    enabled: false
  };
  try { state.enabled = localStorage.getItem('cx_ended_notify') === '1'; } catch (e) { swallow(e); }

  var _videos = [];           // WeakRef 数组（弱引用）：video 从 DOM 移除后随 GC 回收，下轮 checkLoop 自动裁剪，避免常驻强引用导致的 detached-node 内存滞留（对齐主脚本 videoState 的 WeakMap 做法）
  var _checkTimer = null;
  var _scanTick = 0;          // 兜底轮询计数，用于周期性补绑（穿透 iframe）

  // ═══════════════════════════════════════════════════════════════════════
  // L2 · 提醒通道（CHANNELS 注册表）
  // ═══════════════════════════════════════════════════════════════════════
  // 每个通道是自包含单元：私有状态 + fire(title, body) + clear()，通道之间互不引用。
  // 新增一种提醒方式（如震动/声音）只需往 CHANNELS 里加一项，attention 无需改动。
  // 均为「无需任何权限」的浏览器外提醒手段；system 通道（需权限）单列于 L3 权限分诊。

  var CHANNELS = {};

  // —— 通道①：任务栏徽标（Badging API）——
  // 仅当把本页装成 Edge 应用(PWA) 时生效，会在任务栏应用图标上显示红点；普通标签页自动 no-op。无需权限。
  CHANNELS.badge = {
    fire: function () { try { if (navigator.setAppBadge) navigator.setAppBadge(); } catch (e) {} },
    clear: function () { try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (e) {} },
    supported: function () { return !!navigator.setAppBadge; }
  };

  // —— 通道②：底部常驻横幅 ——
  // 切回页面/前台时出现在屏幕底部，带关闭按钮，关闭前不消失。
  // 持有 _pending：后台发生的提醒暂存于此，由 visibilitychange 在切回前台时补弹。
  CHANNELS.banner = (function () {
    var _bannerEl = null;
    var _pending = null;    // 待显示的视频结束提醒（切回前台页面时展示）

    function show(title, body) {
      try {
        if (!_bannerEl) {
          _bannerEl = TOP.document.createElement('div');
          _bannerEl.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);' +
            'z-index:2147483647;background:#1565c0;color:#fff;padding:10px 14px;border-radius:8px;' +
            'font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:90vw;' +
            'display:flex;gap:10px;align-items:center;';
          var span = TOP.document.createElement('span');
          span.id = '__cxEndedMsg';
          _bannerEl.appendChild(span);
          var btn = TOP.document.createElement('button');
          btn.textContent = '✕';
          btn.style.cssText = 'background:transparent;border:0;color:#fff;font-size:16px;cursor:pointer;line-height:1;';
          // 用户主动关闭横幅 = 已知悉，一并清掉待办与任务栏红点
          btn.addEventListener('click', function () {
            try { _bannerEl.style.display = 'none'; } catch (e) {}
            _pending = null;
            CHANNELS.badge.clear();
          });
          _bannerEl.appendChild(btn);
          (TOP.document.body || TOP.document.documentElement).appendChild(_bannerEl);
        }
        _bannerEl.querySelector('#__cxEndedMsg').textContent = '[视频结束] ' + title + (body ? ('：' + body) : '');
        _bannerEl.style.display = 'flex';
      } catch (e) { swallow(e); }
    }

    // 切回前台（用户在标签页/窗口间切回来）时，把后台已发生的视频结束提醒在底部弹出（监听顶层文档可见性）
    try {
      TOP.document.addEventListener('visibilitychange', function () {
        if (!TOP.document.hidden && _pending) show(_pending.title, _pending.body);
      });
    } catch (e) { swallow(e); }

    return {
      // 记录待办；当前前台直接弹，后台则等切回页面由 visibilitychange 触发
      fire: function (title, body) {
        _pending = { title: title, body: body };
        if (!document.hidden) show(title, body);
      },
      clear: function () { _pending = null; },
      hasPending: function () { return !!_pending; }
    };
  })();

  // —— 通道③：标签页标题闪烁 ——
  // 作用于顶层标签页，后台也可见；20s 后自动复位。
  CHANNELS.titleFlash = (function () {
    var _origTitle = null, _flashTimer = null;
    return {
      fire: function (title) {
        try {
          if (_origTitle === null) _origTitle = TOP.document.title;
          if (_flashTimer) clearInterval(_flashTimer);
          var on = false;
          _flashTimer = setInterval(function () {
            TOP.document.title = on ? _origTitle : ('🔔 ' + title);
            on = !on;
          }, 1000);
          setTimeout(function () {
            if (_flashTimer) { clearInterval(_flashTimer); _flashTimer = null; }
            try { TOP.document.title = _origTitle; } catch (e) {}
            CHANNELS.badge.clear();
          }, 20000);
        } catch (e) { swallow(e); }
      },
      clear: function () {
        try {
          if (_flashTimer) { clearInterval(_flashTimer); _flashTimer = null; }
          if (_origTitle !== null) TOP.document.title = _origTitle;
        } catch (e) {}
      }
    };
  })();

  // —— 通道④：favicon 红点徽标 ——
  // 用 canvas 现画一个红底白「!」图标替换顶层标签页图标；20s 后还原。
  CHANNELS.favicon = (function () {
    var _origIconHref = null;
    return {
      fire: function () {
        try {
          if (_origIconHref === null) {
            var ex = TOP.document.querySelector("link[rel~='icon']");
            _origIconHref = ex ? (ex.href || '') : '';
          }
          var c = TOP.document.createElement('canvas');
          c.width = c.height = 32;
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#e53935';
          ctx.beginPath(); ctx.arc(16, 16, 15, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 22px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('!', 16, 18);
          var link = TOP.document.querySelector("link[rel~='icon']");
          if (!link) {
            link = TOP.document.createElement('link');
            link.rel = 'icon';
            (TOP.document.head || TOP.document.documentElement).appendChild(link);
          }
          link.href = c.toDataURL('image/png');
          setTimeout(function () {
            try { if (link && _origIconHref) link.href = _origIconHref; } catch (e) {}
            CHANNELS.badge.clear();
          }, 20000);
        } catch (e) { swallow(e); }
      },
      clear: function () {
        try {
          var link = TOP.document.querySelector("link[rel~='icon']");
          if (link && _origIconHref) link.href = _origIconHref;
        } catch (e) {}
      }
    };
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // L3 · 提醒编排（降级链）
  // ═══════════════════════════════════════════════════════════════════════

  // 无权限路径：并联点亮全部免权限通道（badge + 标题闪烁 + favicon + 底部横幅）。
  // 顺序即原实现顺序，任一通道内部自行 try/catch，互不影响。
  function attention(title, body) {
    try {
      CHANNELS.badge.fire();              // 任务栏应用图标红点（装成 Edge 应用时生效，无需权限）
      CHANNELS.titleFlash.fire(title);    // 标题闪烁（作用于顶层标签页，后台也可见）
      CHANNELS.favicon.fire();            // favicon 红点徽标（作用于顶层标签页图标）
      CHANNELS.banner.fire(title, body);  // 底部横幅（前台直接弹，后台切回时补弹）
    } catch (e) { swallow(e); }
  }

  // 权限分诊：已授权 → 系统通知；未决 → 请求后按结果分流；拒绝/不支持 → 降级 attention
  function showNotify(title, body) {
    try {
      if (!('Notification' in window)) { attention(title, body); return; }
      if (Notification.permission === 'granted') {
        new Notification(title, { body: body || '', tag: 'cx-ended', requireInteraction: false });
        return;
      }
      if (Notification.permission === 'default') {
        // 非手势场景下可能弹不出授权框，降级为标题/图标提醒
        Notification.requestPermission().then(function (p) {
          if (p === 'granted') new Notification(title, { body: body || '', tag: 'cx-ended' });
          else attention(title, body);
        }).catch(function () { attention(title, body); });
        return;
      }
      // denied：权限被拒，用标题闪烁 + 图标红点提醒（无需权限）
      attention(title, body);
    } catch (e) {
      attention(title, body);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // L4 · 视频发现（穿透 iframe + Shadow DOM）
  // ═══════════════════════════════════════════════════════════════════════

  // 绑定到具体 video（幂等）
  function bindVideo(v) {
    if (!v || v.__cxEndedNotifyBound) return;
    v.__cxEndedNotifyBound = true;
    try { v.addEventListener('ended', onEnded, true); } catch (e) {}
    try { v.addEventListener('timeupdate', onTimeupdate, true); } catch (e) {}
    // 仅存 WeakRef：不阻止 video 被 GC；重复绑定由上方 __cxEndedNotifyBound 拦截，此处用 every 去重
    if (_videos.every(function (r) { return r.deref() !== v; })) _videos.push(new WeakRef(v));
  }

  // 遍历某文档及嵌套 iframe / Shadow DOM 内所有 <video> 并绑定。
  // 超星播放器常嵌在同源 iframe 内：notify 若在顶层运行，其 document 里并没有 <video>，
  // 视频实际在 iframe 中，必须穿透 iframe 去绑，否则 _videos 永远为空、永不提醒。
  // 跨域 iframe 访问 contentDocument 会抛错，静默跳过即可。
  var _MAX_SCAN_DEPTH = 16;
  function scanDoc(doc, depth) {
    if (!doc || !doc.querySelectorAll) return;
    depth = depth || 0;
    if (depth > _MAX_SCAN_DEPTH) return;
    // 1) 直接 video
    try { doc.querySelectorAll('video').forEach(bindVideo); } catch (e) {}
    // 2) Shadow DOM（部分播放器把 <video> 藏在 shadowRoot 内，普通 querySelector 查不到）
    try {
      var _cts = doc.querySelectorAll('#videoBox, .ans-attach-ct, *');
      _cts.forEach(function (el) {
        try { if (el.shadowRoot) scanDoc(el.shadowRoot, depth + 1); } catch (e) {}
      });
    } catch (e) {}
    // 3) 嵌套同源 iframe（含动态创建的播放器 iframe，可能尚未加载完 → load 时再补绑）
    try {
      doc.querySelectorAll('iframe').forEach(function (f) {
        try {
          if (!f.__cxEndedIframeBound) {
            f.__cxEndedIframeBound = true;
            f.addEventListener('load', function () { try { scanDoc(f.contentDocument, depth + 1); } catch (e) {} });
          }
          if (f.contentWindow && f.contentDocument) scanDoc(f.contentDocument, depth + 1);
        } catch (e) { /* 跨域 iframe：忽略 */ }
      });
    } catch (e) {}
  }

  // 全量扫描：notify 可能在顶层或某个子 iframe 内运行，
  // 仿照主脚本 allVideos 同时下钻本帧 + 回扫顶层同源文档，确保不漏掉任何 frame 的视频。
  function scanAll() {
    try { scanDoc(document, 0); } catch (e) {}
    try { if (window.top && window.top !== window && window.top.document && window.top.document.body) scanDoc(window.top.document, 0); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════
  // L5 · 结束判定（三路信号归一：ended 事件 / timeupdate 逼近 / 兜底轮询）
  // ═══════════════════════════════════════════════════════════════════════

  // 取视频标题（提醒正文的数据来源）
  var TITLE_SEL = '.ans-attach-title,.video-js .vjs-title,.title,#videoTitle,.job-title,h2.title,.course_title';
  function getVideoTitle(v) {
    try {
      var node = (v && v.closest) ? v.closest('.job,#job,div[class*="job"]') : null;
      var sel = node ? node.querySelector(TITLE_SEL) : document.querySelector(TITLE_SEL);
      var t = sel ? (sel.textContent || '').trim() : '';
      if (!t) t = (document.title || '').replace(/\s*[-–|]\s*学习通.*$/i, '').trim();
      return t;
    } catch (e) { swallow(e); return ''; }
  }

  // 触发通知（每个视频仅提醒一次，重看后允许再次提醒）——三路信号的唯一汇聚点
  function fire(v) {
    if (!state.enabled) return;
    if (!v || v.__cxEndedNotified) return;       // 已提醒过则跳过（避免 ended 锁死态被轮询重复触发）
    v.__cxEndedNotified = true;
    try { console.log('[cx-ended] 触发提醒：视频已结束（当前可见=' + !document.hidden +
      '，badge=' + CHANNELS.badge.supported() + '）'); } catch (e) {}
    var t = getVideoTitle(v);
    showNotify('学习通：视频已播放完毕', t ? ('《' + t + '》') : '当前视频已观看至结束');
  }

  // 信号①：原生 ended 事件
  function onEnded(e) { try { fire(e.currentTarget || e.target); } catch (err) { swallow(err); } }

  // 信号②：timeupdate 逼近结尾（部分平台 ended 不派发，用 99.95% 进度兜底）
  function onTimeupdate(e) {
    try {
      var v = e.currentTarget || e.target;
      if (v && isFinite(v.duration) && v.duration > 1 && !v.paused &&
          v.currentTime >= v.duration * 0.9995) {
        fire(v); // fire 内部用 __cxEndedNotified 单次标志，与 ended/轮询不会重复弹
      }
    } catch (err) { swallow(err); }
  }

  // 信号③：兜底轮询 —— 覆盖「原生 ended 因平台/MSE 未派发」的场景。
  // 主脚本 force-play 在视频真正放完时会置 v.__cxEndedLock=true；直接读该标志作为「已结束」信号，
  // 比单纯依赖 ended 事件更可靠。重看（currentTime 明显回退）时清除标志，允许再次提醒。
  function checkLoop() {
    try {
      // 每 5 秒补绑一次（穿透 iframe + Shadow DOM，并回扫顶层），防止 MutationObserver 漏网导致视频一直未绑定
      _scanTick = (_scanTick | 0) + 1;
      if (_scanTick % 5 === 0) { try { scanAll(); } catch (e) {} }
      // 倒序遍历并裁剪已回收的 WeakRef（video 被移除后 deref() 返回 undefined）
      for (var i = _videos.length - 1; i >= 0; i--) {
        var v = _videos[i].deref();
        if (!v) { _videos.splice(i, 1); continue; }
        var ended = false;
        try { ended = v.ended || !!v.__cxEndedLock; } catch (e) {}
        if (ended) {
          fire(v);
        } else if (v.__cxEndedNotified) {
          // 已提醒过，但视频进度明显回退（重看/跳回开头）→ 允许下次结束再提醒
          try {
            if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration * 0.5) v.__cxEndedNotified = false;
          } catch (e) {}
        }
      }
    } catch (e) { swallow(e); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // L6 · 集成（悬浮开关 UI / 主面板契约 / 调试钩子 / 启动）
  // ═══════════════════════════════════════════════════════════════════════

  // 启用态的唯一写入口：同步 state + localStorage + 悬浮开关外观，避免三处各写一遍导致不一致
  function setEnabled(val) {
    state.enabled = !!val;
    try { localStorage.setItem('cx_ended_notify', val ? '1' : '0'); } catch (e) { swallow(e); }
    try { TOP.__cxEndedPaintToggle && TOP.__cxEndedPaintToggle(); } catch (e) {}
  }

  // 独立悬浮开关：即使不打开主脚本控制面板，也能直接开/关「视频结束提醒」（插在顶层文档，确保可见）
  function ensureToggleButton() {
    try {
      if (TOP.document.getElementById('__cxEndedToggle')) return;
      var btn = TOP.document.createElement('div');
      btn.id = '__cxEndedToggle';
      function paint() {
        var on = state.enabled;
        btn.textContent = on ? '🔔 结束提醒：开' : '🔕 结束提醒：关';
        btn.style.background = on ? 'rgba(21,101,192,.92)' : 'rgba(40,44,52,.85)';
      }
      btn.style.cssText = 'position:fixed;right:12px;bottom:56px;z-index:2147483646;color:#fff;padding:6px 10px;' +
        'border-radius:18px;font:12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;user-select:none;';
      btn.addEventListener('click', function () {
        var nv = !state.enabled;
        setEnabled(nv);
        // 直调本地 paint：setEnabled 内的 TOP.__cxEndedPaintToggle 在跨域 TOP 不可达时可能未挂载，
        // 此处直调保证本按钮外观必定刷新（paint 幂等，重复调用无副作用）。
        paint();
        if (nv) attention('已开启', '视频结束后将通过标题闪烁/图标红点/底部横幅提醒你（切回页面即见）');
        else CHANNELS.badge.clear();
      });
      paint();
      try { TOP.__cxEndedPaintToggle = window.__cxEndedPaintToggle = paint; } catch (e) {}
      (TOP.document.body || TOP.document.documentElement).appendChild(btn);
    } catch (e) { swallow(e); }
  }

  // 初始绑定 + 监听后续动态插入的 video
  function start() {
    scanAll();
    ensureToggleButton();
    try { if (_checkTimer) clearInterval(_checkTimer); } catch (e) {}
    try { _checkTimer = setInterval(checkLoop, 1000); } catch (e) {}   // 兜底轮询，覆盖 ended 事件未派发场景
    try {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'VIDEO') bindVideo(n);
            else if (n.querySelectorAll) scanDoc(n, 0);
          });
        });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { swallow(e); }
    // 启动日志只由顶层 frame 打印一次，避免学习通多 iframe 页面重复刷屏；
    // 跨域场景下无法访问顶层文档时，由子 frame 兜底打印（顶层不可达，只能自己打）。
    var _cxLog = (window === window.top);
    if (!_cxLog) { try { _cxLog = !(window.top && window.top.document && window.top.document.body); } catch (e) { _cxLog = true; } }
    if (_cxLog) {
      try { console.log('[cx-ended] 已启动：enabled=' + state.enabled + '，已绑定视频=' + _videos.length +
        '；输入 __cxEndedNotifyStatus() 查看详情，__cxEndedNotifyTest() 验证提醒链路'); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // —— 注册到主脚本副面板（toggle，默认关）——
  (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
    id: 'video-ended-notify',
    type: 'toggle',
    label: '视频结束系统通知',
    note: '结束后提醒：已授权→系统通知；未授权→标题闪烁+图标红点+底部横幅+任务栏红点(需把本页装成Edge应用)；均无需权限',
    get: function () {
      try { return localStorage.getItem('cx_ended_notify') === '1'; } catch (e) { return false; }
    },
    set: function (val) {
      setEnabled(val);
      try { console.log('[cx-ended] 开关 set enabled=' + state.enabled); } catch (e) {}
      // 用户手动开启即处于点击手势内，可弹授权框；若已授权/被拒则不强求
      if (val && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(function () {});
      } else if (val && !('Notification' in window)) {
        attention('已开启', '当前浏览器不支持系统通知，已用标签页标题/图标提醒');
      }
    }
  });

  // —— 调试/测试钩子（控制台用）——
  // 同时挂到 window 与顶层 window.top，这样无论你在 DevTools 控制台选「top」还是视频所在 iframe 上下文都能调用。
  try {
    function testFn() { attention('测试提醒', '若看到标题闪烁 / 图标红点 / 底部横幅，说明提醒链路正常'); }
    function statusFn() {
      var list = [];
      var live = 0;
      try {
        for (var i = 0; i < _videos.length; i++) {
          var v = _videos[i].deref();
          if (!v) continue;
          live++;
          list.push({
            ended: !!(v.ended),
            lock: !!(v.__cxEndedLock),
            notified: !!(v.__cxEndedNotified),
            ct: Math.round(v.currentTime),
            dur: Math.round(v.duration)
          });
        }
      } catch (e) {}
      return {
        isIframe: window !== window.top,
        topReachable: TOP !== window,
        started: !!window.__cxEndedNotifyStarted,
        enabled: state.enabled,
        videosBound: live,
        videos: list,
        badgeSupported: CHANNELS.badge.supported(),
        pending: CHANNELS.banner.hasPending(),
        hint: '开启：点页面右下角「结束提醒」开关，或主面板(P)→副面板；验证：__cxEndedNotifyTest()'
      };
    }
    window.__cxEndedNotifyTest = TOP.__cxEndedNotifyTest = testFn;
    window.__cxEndedNotifyStatus = TOP.__cxEndedNotifyStatus = statusFn;
  } catch (e) { swallow(e); }

  // 自检：探测主脚本契约（force-play 暴露的 __cxRegisterAddon）。
  // 立即缺失可能是「副脚本先于主脚本执行」所致，故延迟 3s 复核，确实缺失再告警，避免误报。
  if (typeof window.__cxRegisterAddon === 'function') {
    window.__cxRegisterAddon();
  } else {
    setTimeout(function () {
      if (typeof window.__cxRegisterAddon !== 'function') {
        try { console.warn('[video-ended-notify] 未检测到 chaoxing-force-play 主脚本(__cxRegisterAddon 缺失)，本副脚本不会生效；请确认主脚本已安装且与本脚本在相同的 @match 下运行。'); } catch (e) { swallow(e); }
      }
    }, 3000);
  }
})();
