// ==UserScript==
// @name         学习通·快捷键增强（副脚本）
// @namespace    http://cx.local/
// @version      1.0
// @description  快捷键：Space 暂停/播放、M 静音。复用主脚本 __cxUserPaused 暂停契约与 v.muted，不破坏续播稳定性；倍速快捷键因会被主脚本周期性覆盖故未纳入。
// @author       sub-script
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';

  // ---------- 配置（localStorage 持久化，面板开关控制） ----------
  var KEY_OPT = 'cx_kb_on';
  function getOpt() { try { return localStorage.getItem(KEY_OPT) !== '0'; } catch (e) { return true; } }
  function setOpt(v) { try { localStorage.setItem(KEY_OPT, v ? '1' : '0'); } catch (e) {} }

  // ---------- 前台视频选择：模仿主脚本 foregroundVideo（可见面积最大者），避免误控隐藏/预加载预览 ----------
  function activeVideo() {
    var vs = document.querySelectorAll('video');
    var best = null, bestScore = -1;
    for (var i = 0; i < vs.length; i++) {
      try {
        var v = vs[i];
        var r = v.getBoundingClientRect();
        var score = r.width * r.height;
        if (score <= 0) continue;                       // 零尺寸/隐藏排除
        if (v.paused && !v.ended) score *= 0.5;         // 略偏好正在播放者
        if (score > bestScore) { bestScore = score; best = v; }
      } catch (e) {}
    }
    return best;
  }

  // ---------- 暂停/恢复：复刻主脚本 __cxUserPaused 契约（稳定，不碰 __cxForcePaused/__cxEndedLock/__cxAN_hold） ----------
  function userPause(v) {
    try { v.__cxUserPaused = true; } catch (e) {}
    try { v.__cxUserKeep = false; } catch (e) {}
    try { if (v.__np) v.pause = v.__np; } catch (e) {}  // 还原原生 pause（绕过原型/实例 noop 覆盖）
    try { (v.__np ? v.__np : HTMLMediaElement.prototype.pause).call(v); } catch (e) { try { v.pause(); } catch (e2) {} }
    // 播放闸门：用户暂停期间，平台自调 video.play() 不会拉回（与主脚本 userPause 一致）。
    // 【跨脚本契约·注意】此处在 video 实例上覆盖 play，主脚本 force-play 也会对同一 video 设置 play 闸门；
    // 下方 userResume 用 delete v.play 还原原型 play，可能一并拆除主脚本设置的实例闸门。两者对同一 video 的
    // play 存在共享/竞争，依赖「主脚本先置 v.__np」「续播接管发生在 userResume 之后」的时序约定，勿擅自改动此处。
    try {
      Object.defineProperty(v, 'play', {
        configurable: true, writable: true,
        value: function () { if (this.__cxUserPaused) return Promise.resolve(); return HTMLMediaElement.prototype.play.apply(this, arguments); }
      });
    } catch (e) {}
    try { v.__cxResumeAt = 0; } catch (e) {}            // 禁用自动恢复：快捷键暂停保持到再次按键（主脚本 RESUME_AFTER_MIN 仅面板暂停生效）
  }
  function userResume(v) {
    try { v.__cxUserPaused = false; } catch (e) {}
    try { v.__cxResumeAt = 0; } catch (e) {}
    try { v.__cxWatchMs = 0; } catch (e) {}             // 重置自动停止计时，避免恢复后立刻再停
    try { delete v.play; } catch (e) {}                // 拆除播放闸门，还原原型 play
    try { v.play(); } catch (e) {}                      // 主脚本续播循环随后接管续播
  }

  // ---------- 输入焦点避让：仅"需要输入空格字符"的场景（文本框/文本域/下拉/可编辑区）放行 Space，让用户输入空格；
  // 其余（按钮/链接/复选框等）一律由快捷键接管——避免焦点落在面板按钮上时 Space 变成"激活按钮"而非暂停视频（修复"空格不太灵"）----------
  function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var t = (el.tagName || '').toLowerCase();
    if (t === 'textarea' || t === 'select') return true;
    if (t === 'input') {
      var ty = ((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase();
      return ['text', 'password', 'search', 'email', 'number', 'url', 'tel'].indexOf(ty) >= 0;
    }
    return false; // button / a / input[button|checkbox|radio|...] / 其它：Space/M 接管为视频控制
  }

  // 页面内提示（主脚本 toast 未挂全局，自实现；与其它副脚本风格一致）
  function hintToast(msg) {
    try {
      var el = document.createElement('div');
      el.textContent = '[快捷键] ' + msg;
      el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);' +
        'z-index:2147483647;background:#1565c0;color:#fff;padding:8px 14px;border-radius:6px;' +
        'font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:90vw;';
      (document.body || document.documentElement).appendChild(el);
      setTimeout(function () { try { el.remove(); } catch (_) {} }, 6000);
    } catch (e) {}
  }

  // ---------- 按键处理 ----------
  function onKey(e) {
    if (!getOpt()) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;     // 不抢组合键（保留平台/主脚本快捷键）
    if (isTextEntry(e.target)) return;                  // 仅文本框/文本域/下拉/可编辑区放行 Space（让用户输入空格）
    var v = activeVideo();
    if (!v) return;
    var k = (e.key || '').toLowerCase();
    if (e.code === 'Space' || k === ' ') {
      if (v.paused) userResume(v); else userPause(v);
      e.preventDefault();                               // 阻止页面滚动
    } else if (k === 'm') {
      v.muted = !v.muted;                               // 静音：主脚本从不触碰 v.muted，稳定
      e.preventDefault();
    }
  }

  // ---------- 幂等守卫：避免脚本被多次注入时叠加监听 ----------
  if (window.__cxKbStarted) return;
  window.__cxKbStarted = true;
  try { document.addEventListener('keydown', onKey, true); } catch (e) {}

  // ---------- 接入主脚本面板（主从架构）：开关 + 自检（与 auto-next/progress-panel 一致） ----------
  try {
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'keyboard-shortcuts', type: 'toggle', label: '快捷键增强 (Space/M)',
      note: 'Space=暂停/播放，M=静音；聚焦在文本框内时不拦截（复用主脚本 __cxUserPaused 契约）',
      get: getOpt,
      set: function (v) {
        setOpt(v);
        if (v) hintToast('已开启：Space 暂停/播放 · M 静音（文本框内不拦截；激活按钮请用 Enter）');
      }
    });
    if (typeof window.__cxRegisterAddon === 'function') {
      window.__cxRegisterAddon();
    } else {
      // 自检：主脚本契约暂未就绪，可能是副脚本先于主脚本执行；延迟 3s 复核，确实缺失再告警，避免误报
      setTimeout(function () {
        if (typeof window.__cxRegisterAddon !== 'function') {
          try { console.warn('[keyboard-shortcuts] 未检测到 chaoxing-force-play 主脚本(__cxRegisterAddon 缺失)，面板开关不会显示；快捷键仍按默认开启工作。'); } catch (e2) {}
        }
      }, 3000);
    }
  } catch (e) {}
})();
