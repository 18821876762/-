// ==UserScript==
// @name         学习通·原型篡改报警（副脚本）
// @namespace    http://cx.local/
// @version      1.0
// @description  调试/运维：周期性比对 HTMLMediaElement.prototype.pause 与 playbackRate 的 toString 是否仍含 __cxForcePaused 标记，若被平台还原（Object.freeze/重新赋值）则弹窗+红条报警。仅报警，不修改主脚本状态。
// @author       sub-script
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  // ---------- 配置（localStorage 持久化，面板开关控制） ----------
  var KEY_OPT = 'cx_tamper_guard_on';
  function getOpt() { try { return localStorage.getItem(KEY_OPT) !== '0'; } catch (e) { return true; } }
  function setOpt(v) { try { localStorage.setItem(KEY_OPT, v ? '1' : '0'); } catch (e) {} }

  // ---------- 独立 toast（主脚本 toast 未挂全局，需自实现） ----------
  function toast(msg) {
    try {
      var el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#b91c1c;color:#fff;padding:10px 16px;border-radius:8px;font:14px/1.5 system-ui,sans-serif;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:80vw;pointer-events:none;';
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { try { el.remove(); } catch (e) {} }, 6000);
    } catch (e) {}
  }

  // ---------- 持续红条（替代"标红主面板状态"：不耦合主面板 DOM，避免 id 易变导致失效） ----------
  var bannerEl = null;
  function showBanner(text) {
    try {
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483646;' +
          'background:#dc2626;color:#fff;padding:8px 12px;font:13px/1.4 system-ui,sans-serif;text-align:center;' +
          'box-shadow:0 2px 8px rgba(0,0,0,.3);';
        (document.body || document.documentElement).appendChild(bannerEl);
      }
      bannerEl.textContent = text;
    } catch (e) {}
  }
  function hideBanner() { try { if (bannerEl) { bannerEl.remove(); bannerEl = null; } } catch (e) {} }

  // ---------- 篡改检测 ----------
  // 主脚本 neutralizeGlobalPause 把 pause 覆盖为读取 this.__cxForcePaused 的函数、把 playbackRate 的 setter
  // 写为同样含该标记的函数；一旦平台用 Object.freeze/重新赋值还原原型，toString() 就不再含标记。
  function containsMarker(s) { return typeof s === 'string' && s.indexOf('__cxForcePaused') >= 0; }
  function rateToString() {
    try { var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate'); return (d && d.set) ? d.set.toString() : ''; } catch (e) { return ''; }
  }

  var baselineSeen = false;   // 是否已观测到主脚本完成中性化注入（避免加载顺序误报）
  var alarmed = false;        // 当前是否处于已报警状态（去抖：仅在 OK→篡改 跳变时报警一次）

  function alarm(pauseOk, rateOk) {
    var parts = [];
    if (!pauseOk) parts.push('pause');
    if (!rateOk) parts.push('playbackRate');
    var msg = '⚠ 原型篡改报警：HTMLMediaElement.' + parts.join('/') + ' 的防暂停中性化已被平台还原，强制续播可能失效！';
    toast(msg);
    showBanner(msg);
    try { console.error('[tamper-guard] ' + msg); } catch (e) {}
  }

  function check() {
    if (!getOpt()) return;
    var pauseOk = false, rateOk = false;
    try { var p = HTMLMediaElement.prototype.pause; pauseOk = containsMarker(p && p.toString()); } catch (e) {}
    try { rateOk = containsMarker(rateToString()); } catch (e) {}
    if (pauseOk && rateOk) {
      baselineSeen = true;                 // 基线建立：主脚本已注入
      if (alarmed) { alarmed = false; hideBanner(); }
      return;
    }
    if (!baselineSeen) return;             // 主脚本尚未完成注入，等待基线，不误报
    if (!alarmed) { alarmed = true; alarm(pauseOk, rateOk); }
  }

  // ---------- 幂等守卫 + 周期比对（2s，与主脚本轮询同频；检查本身仅 toString+indexOf，无重 DOM） ----------
  if (window.__cxTamperGuardStarted) return;
  window.__cxTamperGuardStarted = true;
  try { setInterval(check, 2000); } catch (e) {}   // 计时器 id 不再挂到 window（避免额外全局；脚本随页面寿命存活，无需句柄清理）
  try { setTimeout(check, 1500); } catch (e) {}   // 主脚本通常已就绪，尽早建立基线

  // ---------- 接入主脚本面板（主从架构）：开关 + 自检（与 auto-next/progress-panel/keyboard-shortcuts 一致） ----------
  try {
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'tamper-guard', type: 'toggle', label: '原型篡改报警',
      note: 'pause/playbackRate 被平台还原时弹窗+红条报警',
      get: getOpt,
      set: setOpt
    });
    if (typeof window.__cxRegisterAddon === 'function') {
      window.__cxRegisterAddon();
    } else {
      setTimeout(function () {
        if (typeof window.__cxRegisterAddon !== 'function') {
          try { console.warn('[tamper-guard] 未检测到 chaoxing-force-play 主脚本(__cxRegisterAddon 缺失)，面板开关不会显示；篡改报警仍按默认开启工作。'); } catch (e2) {}
        }
      }, 3000);
    }
  } catch (e) {}
})();
