// ==UserScript==
// @name         学习通·视频结束系统通知（副脚本）
// @namespace    http://cx.local/
// @version      1.0
// @author       anon
// @description  【副脚本·接入主控面板】视频播放到结束后提醒。已授权通知权限→弹系统级通知；未授权→标签页标题闪烁+图标红点（无需权限，Edge 后台标签页在任务栏也可见），等效"浏览器外弹窗"。监听原生 ended 事件，不干预主脚本续播状态机。默认关闭。开关挂入 chaoxing-force-play(4.0) 主控面板（按 P 呼出 → 副脚本区）。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // 幂等守卫：防止油猴重复注入叠加监听器
  if (window.__cxEndedNotifyStarted) return;
  window.__cxEndedNotifyStarted = true;

  function swallow(e) { try { /* 静默吞掉，仅开发态可放开 console */ } catch (_) {} }

  // ===== 状态 =====
  var state = {
    enabled: false,
    // 上次提示时间戳，用于避免重复弹窗（同一视频 10s 内只通知一次）
  };
  try { state.enabled = localStorage.getItem('cx_ended_notify') === '1'; } catch (e) { swallow(e); }

  // ===== 页面内降级 toast（主脚本 toast 未挂全局，自实现）=====
  function fallbackToast(msg) {
    try {
      var el = document.createElement('div');
      el.textContent = '[视频结束通知] ' + msg;
      el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);' +
        'z-index:2147483647;background:#b00020;color:#fff;padding:8px 14px;border-radius:6px;' +
        'font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:90vw;';
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { try { el.remove(); } catch (_) {} }, 6000);
    } catch (e) { swallow(e); }
  }

  // ===== 无权限时的「浏览器外」提醒：标题闪烁 + 图标红点 + 页面内提示 =====
  // 不需任何权限；只要 Edge 窗口开着（含后台标签页），任务栏里的标题/图标即可见，等效"浏览器外弹窗"。
  var _origTitle = null, _flashTimer = null, _origIconHref = null;
  function attention(title, body) {
    try {
      fallbackToast(title + (body ? ('：' + body) : ''));
      // 1) 标题闪烁（后台标签页在任务栏也可见）
      if (_origTitle === null) _origTitle = document.title;
      if (_flashTimer) clearInterval(_flashTimer);
      var on = false;
      _flashTimer = setInterval(function () {
        document.title = on ? _origTitle : ('🔔 ' + title);
        on = !on;
      }, 1000);
      setTimeout(function () {
        if (_flashTimer) { clearInterval(_flashTimer); _flashTimer = null; }
        try { document.title = _origTitle; } catch (e) {}
      }, 20000);
      // 2) favicon 红点徽标
      try {
        if (_origIconHref === null) {
          var ex = document.querySelector("link[rel~='icon']");
          _origIconHref = ex ? (ex.href || '') : '';
        }
        var c = document.createElement('canvas');
        c.width = c.height = 32;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#e53935';
        ctx.beginPath(); ctx.arc(16, 16, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('!', 16, 18);
        var link = document.querySelector("link[rel~='icon']");
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          (document.head || document.documentElement).appendChild(link);
        }
        link.href = c.toDataURL('image/png');
        setTimeout(function () {
          try { if (link && _origIconHref) link.href = _origIconHref; } catch (e) {}
        }, 20000);
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
  }

  // ===== 系统通知 =====
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

  // ===== 取视频标题 =====
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

  // ===== 触发通知（带去抖）=====
  function fire(v) {
    if (!state.enabled) return;
    var now = Date.now();
    if (v.__cxEndedNotifyTs && now - v.__cxEndedNotifyTs < 10000) return; // 10s 去抖
    v.__cxEndedNotifyTs = now;
    var t = getVideoTitle(v);
    showNotify('学习通：视频已播放完毕', t ? ('《' + t + '》') : '当前视频已观看至结束');
  }

  function onEnded(e) { try { fire(e.currentTarget || e.target); } catch (err) { swallow(err); } }

  function onTimeupdate(e) {
    try {
      var v = e.currentTarget || e.target;
      if (v && isFinite(v.duration) && v.duration > 1 && !v.paused &&
          v.currentTime >= v.duration * 0.9995) {
        fire(v); // 复用 10s 去抖，与 ended 不会重复弹
      }
    } catch (err) { swallow(err); }
  }

  // ===== 绑定到具体 video（幂等）=====
  function bindVideo(v) {
    if (!v || v.__cxEndedNotifyBound) return;
    v.__cxEndedNotifyBound = true;
    v.addEventListener('ended', onEnded, true);
    v.addEventListener('timeupdate', onTimeupdate, true);
  }
  function bindAll(root) {
    (root || document).querySelectorAll('video').forEach(bindVideo);
  }

  // 初始绑定 + 监听后续动态插入的 video
  function start() {
    bindAll(document);
    try {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'VIDEO') bindVideo(n);
            else if (n.querySelectorAll) bindAll(n);
          });
        });
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { swallow(e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // ===== 注册到主脚本副面板（toggle，默认关）=====
  (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
    id: 'video-ended-notify',
    type: 'toggle',
    label: '视频结束系统通知',
    note: '结束后提醒：已授权→系统通知；未授权→标签页标题闪烁+图标红点（无需权限，后台也可见）',
    get: function () {
      try { return localStorage.getItem('cx_ended_notify') === '1'; } catch (e) { return false; }
    },
    set: function (val) {
      state.enabled = !!val;
      try { localStorage.setItem('cx_ended_notify', val ? '1' : '0'); } catch (e) { swallow(e); }
      // 用户手动开启即处于点击手势内，可弹授权框；若已授权/被拒则不强求
      if (val && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(function () {});
      } else if (val && !('Notification' in window)) {
        attention('已开启', '当前浏览器不支持系统通知，已用标签页标题/图标提醒');
      }
    }
  });

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
