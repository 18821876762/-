  // ===== 工具库项：视频结束系统通知（原 decision/chaoxing-video-ended-notify，v3.1 迁入核心脚本工具库） =====
  // 站点归属：超星学习通。复用核心脚本 bridge（__cxBridge/bridgeReady）做多端联动；本地降级为 OS 通知。
  // 调试钩子：window.__cxEndedNotifyTest() 手动触发通知；window.__cxEndedNotifyStatus() 查看状态。
  (function () {
    'use strict';

    var TK = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit) || {};
    var swallow = TK.swallow || function (e) {};
    // 跨脚本就绪标志（与核心脚本/其他模块解耦，避免重复初始化）
    window.__cxEndedNotifyReady = true;

    var TOP = this || window;
    var ns = window.__CX_FORCE_PLAY;

    // 解耦 bridge：从核心脚本桥读取（仅本页有桥时）
    var bridgeReady = false;
    var bridgePort = 0;
    var bridgePeer = null;
    function getBridge() {
      if (ns && ns.__cxBridge && typeof ns.__cxBridge.send === 'function' && ns.bridgeReady === true) {
        return ns.__cxBridge;
      }
      return null;
    }
    function getStatus() {
      if (ns && ns.__cxBridge && typeof ns.__cxBridge.status === 'function') {
        try { return ns.__cxBridge.status(); } catch (e) { return null; }
      }
      return null;
    }
    function onBridge(cb) {
      if (ns && typeof ns.onBridgeReady === 'function') { ns.onBridgeReady(cb); }
    }

    // —— 幂等 + 站点隔离 ——
    if (window.__cxEndedNotifyStarted) return;
    window.__cxEndedNotifyStarted = true;

    // 站点隔离：核心脚本为多平台脚本，本通知为超星专属视频结束联动，仅超星上下文激活
    if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'chaoxing')) return;

    var MARK_MUTED = '__cxEndedMuted';

    function setEnabled(v) { try { localStorage.cxEndedNotify = v ? '1' : '0'; } catch (e) {} }
    function isEnabled() { try { return localStorage.cxEndedNotify !== '0'; } catch (e) { return true; } }

    function muteAll() {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        try {
          if (vs[i].muted) continue;
          vs[i][MARK_MUTED] = true;
          vs[i].muted = true;
        } catch (e) {}
      }
    }
    function restoreAll() {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        try { if (vs[i][MARK_MUTED]) { vs[i].muted = false; vs[i][MARK_MUTED] = false; } } catch (e) {}
      }
    }

    // —— OS 通知 ——
    function notifyOS(title, body) {
      try {
        if (!('Notification' in window)) { TK.toast && TK.toast(body); return; }
        if (Notification.permission === 'granted') {
          try { new Notification(title, { body: body, tag: 'cx-ended', renotify: true }); } catch (e) { TK.toast && TK.toast(body); }
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(function (p) {
            if (p === 'granted') { try { new Notification(title, { body: body, tag: 'cx-ended', renotify: true }); } catch (e2) {} }
          }).catch(function () {});
        } else {
          TK.toast && TK.toast(body);
        }
      } catch (e) { swallow(e); }
    }

    // 若本页是“被联动端”且有用户正在观看，不要自动恢复（避免打断）
    function restoreIfNeeded() {
      try {
        var st = getStatus();
        if (st && st.playing && st.foreground) { /* 远端仍在看，保持静音 */ return; }
        restoreAll();
      } catch (e) { swallow(e); restoreAll(); }
    }

    // 在视频真正播放时回调（解决 autoplay 限制：首次需用户手势）
    function whenPlaying(video, cb) {
      try {
        if (!video) { cb(); return; }
        if (!video.paused && video.currentTime > 0) { cb(); return; }
        var done = false;
        var fin = function () { if (done) return; done = true; try { video.removeEventListener('playing', fin); } catch (e) {} cb(); };
        video.addEventListener('playing', fin, { once: true });
        // 兜底：若 3s 内未播放也触发（权限允许时）
        setTimeout(function () { if (!done) { done = true; try { video.removeEventListener('playing', fin); } catch (e) {} cb(); } }, 3000);
      } catch (e) { cb(); }
    }

    function closeVideoWhenReady(info) {
      // 联动端：视频播完后，若本页是后台标签页，则关闭视频释放资源（可选）
      try {
        var v = info && info.video;
        if (v) { try { v.pause(); } catch (e) {} }
        // 不直接关页面，避免误伤；仅静音
        muteAll();
      } catch (e) { swallow(e); }
    }

    // 联动端：冻结当前视频到末尾并等待结束（用于“另一端已看完”的场景）
    function freezeVideoAndWait(video, onEnded) {
      try {
        if (!video) { onEnded && onEnded(); return; }
        var ended = false;
        var handler = function () { if (ended) return; ended = true; try { video.removeEventListener('ended', handler); } catch (e) {} onEnded && onEnded(); };
        video.addEventListener('ended', handler, { once: true });
        // 若已接近末尾则直接视为结束
        if (video.duration && (video.duration - video.currentTime) < 1.5) {
          try { video.currentTime = video.duration - 0.05; } catch (e) {}
          setTimeout(function () { if (!ended) { ended = true; onEnded && onEnded(); } }, 600);
        }
        // 兜底超时
        setTimeout(function () { if (!ended) { ended = true; onEnded && onEnded(); } }, 8000);
      } catch (e) { swallow(e); onEnded && onEnded(); }
    }

    // ====== 启动 ======
    function start() {
      var addon = {
        id: 'video-ended-notify',
        type: 'toggle',
        label: '视频结束系统通知',
        note: '视频播完→系统通知(多端联动/本地OS通知)',
        get: isEnabled,
        set: setEnabled,
      };
      if (typeof window.__cxAddonQueue !== 'undefined') window.__cxAddonQueue.push(addon);

      // 本页视频结束时（本地或联动触发）
      function onThisPageEnded(e) {
        if (!isEnabled()) return;
        var v = e && e.target;
        var ttl = (document.title || '学习通') + '：视频已播放完毕';
        // 优先走桥（多端联动）
        var b = getBridge();
        if (b) {
          try {
            b.send({ type: 'video-ended', url: location.href, title: document.title, ts: Date.now() });
          } catch (err) { swallow(err); }
        }
        // 本地 OS 通知（降级/补充）
        notifyOS(ttl, '可前往作答或进入下一节');
        muteAll();
      }

      document.addEventListener('ended', function (e) {
        if (!e.target || e.target.tagName !== 'VIDEO') return;
        onThisPageEnded(e);
      }, true);

      // 联动：收到其他端“视频结束”→ 本页静音并提示
      onBridge(function (msg) {
        if (!msg) return;
        if (msg.type === 'video-ended') {
          if (!isEnabled()) return;
          muteAll();
          var nm = (msg.title || '另一设备') + '：视频已播放完毕';
          notifyOS(nm, '本端已静音（可前往作答）');
        } else if (msg.type === 'ping') {
          var b = getBridge();
          if (b) { try { b.send({ type: 'pong', url: location.href }); } catch (e) {} }
        }
      });

      // 跨脚本调试钩子
      TOP.__cxEndedNotifyTest = function () { notifyOS('学习通：视频已播放完毕', '手动测试通知'); };
      TOP.__cxEndedNotifyStatus = function () {
        var st = getStatus();
        return { bridgeReady: !!getBridge(), status: st, enabled: isEnabled() };
      };

      // 注册进面板工具库
      if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
})();
