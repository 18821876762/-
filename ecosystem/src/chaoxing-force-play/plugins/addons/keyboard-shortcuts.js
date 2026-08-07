  // ===== 工具库项：快捷键增强（原 decision/chaoxing-keyboard-shortcuts，v1.0 迁入核心脚本工具库） =====
  // 站点归属：超星学习通。复用核心脚本 __cxUserPaused 暂停契约与 v.muted / v.__np（force-play 进度）。
  (function () {
    'use strict';

    // —— 配置 ——
    var MUTE_TOGGLE = (localStorage.cxKb_muted_toggle || 'KeyM');
    var PLAY_TOGGLE = (localStorage.cxKb_play_toggle || 'Space');
    var SHOW_HINT = (localStorage.cxKb_hint !== '0');
    var MUTE_START = (localStorage.cxKb_muted_start || '0') === '1';

    // 取「面积最大且在视图内」的视频
    function activeVideo() {
      var vs = document.querySelectorAll('video');
      var best = null, bestA = 0;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v.offsetParent && v.offsetWidth === 0 && v.offsetHeight === 0) continue;
        var r = v.getBoundingClientRect();
        if (r.width < 60 || r.height < 40) continue;
        var a = r.width * r.height;
        if (a > bestA) { bestA = a; best = v; }
      }
      return best;
    }

    function onKey(e) {
      if (e.isTrusted === false) return; // 仅真实用户按键
      // 文本框内不拦截（不阻断打字），但保留 M 静音
      var tk = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit;
      var inText = tk && tk.isTextEntry ? tk.isTextEntry(e.target) : false;
      var v = activeVideo();

      if (e.code === PLAY_TOGGLE) {
        if (inText) return;
        if (!v) return;
        // 用户按空格：让位给核心脚本内置播放/暂停（仅当用户没有手动暂停时才接管）
        var pass = (e.code === 'Space') && !(v && v.__cxUserPaused);   // 用视频元素暂停契约 v.__cxUserPaused（window.__cxUserPaused 从未定义，原分支恒 true）
        if (pass) {
          e.preventDefault();
          if (v.paused) v.play(); else v.pause();
        }
        return;
      }

      if (e.code === MUTE_TOGGLE) {
        // 静音无论是否在文本框都生效（快捷键）
        if (!v) return;
        e.preventDefault();
        v.muted = !v.muted;
        if (SHOW_HINT) hintToast(v.muted ? '🔇 已静音' : '🔊 已取消静音');
        return;
      }
    }

    // —— 提示气泡 ——
    var _ht = null;
    function hintToast(text) {
      try {
        // 静默模式（关闭脚本弹窗）：不弹快捷键提示气泡
        if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.isQuietPopups === 'function' && window.__CX_FORCE_PLAY.isQuietPopups()) return;
        if (!_ht) {
          _ht = document.createElement('div');
          _ht.id = 'cxKbHint';
          _ht.style.cssText = 'position:fixed;right:14px;bottom:84px;z-index:999999;background:rgba(0,0,0,.78);color:#fff;padding:6px 12px;border-radius:8px;font:13px/1.4 system-ui;pointer-events:none;opacity:0;transition:opacity .2s;';
          document.body.appendChild(_ht);
        }
        _ht.textContent = text;
        _ht.style.opacity = '1';
        clearTimeout(_ht._t);
        _ht._t = setTimeout(function () { _ht.style.opacity = '0'; }, 1200);
      } catch (e) {}
    }

    // —— 幂等 + 站点隔离 ——
    if (window.__cxKbStarted) return;
    window.__cxKbStarted = true;

    // 站点隔离：核心脚本为多平台脚本，本增强为超星专属快捷键，避免在其他平台误触
    if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'chaoxing')) return;

    try { document.addEventListener('keydown', onKey, true); } catch (e) {}

    if (MUTE_START) {
      // 进入页面默认静音（仅课程页视频）
      var iv = setInterval(function () {
        var v = activeVideo();
        if (v) { v.muted = true; clearInterval(iv); }
      }, 800);
      setTimeout(function () { clearInterval(iv); }, 15000);
    }

    // —— 注入工具库 ——
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'keyboard',
      type: 'toggle',
      label: '快捷键增强 (Space/M)',
      note: 'M 静音/取消静音；Space 接管播放/暂停(手动暂停后让位)',
      get: function () { return (localStorage.cxKb_on || '1') === '1'; },
      set: function (v) { localStorage.cxKb_on = v ? '1' : '0'; },
    });

    if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
})();
