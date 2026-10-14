// @requires: bestEffort, safeGet
  // ===== 工具库项：视频结束系统通知（原 decision/chaoxing-video-ended-notify，v3.1 迁入核心脚本工具库） =====
  // 站点归属：超星学习通。多端联动为「预留扩展点」：当前 toolkit.bridge 仅是爬虫桥客户端，
  // 未暴露 send/status/onReady 这类消息 API，故联动保持 OS 通知降级（详见下方 toolkit.bridge 说明）。
  // 调试钩子：window.__cxEndedNotifyTest() 手动触发通知；window.__cxEndedNotifyStatus() 查看状态。
  (function () {
    'use strict';

    var TK = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit) || {};

    var TOP = window;
    var ns = window.__CX_FORCE_PLAY;
    var core = ns && ns.CoreState, stopped = false, started = false;
    function active() { return !stopped && window.__CX_FORCE_PLAY === ns && (!core || core.canRun()); }

    // 解耦 bridge：从核心脚本 toolkit.bridge 读取（仅本页有桥时）。
    // 注：当前 toolkit.bridge 是爬虫桥客户端（probeBridgeBase/bridgeInit/...），
    // 尚未暴露 send/status/onReady 这类「消息联动」API；多端联动保持 OS 通知降级，
    // 待 toolkit.bridge 提供消息 send API 后，getBridge/send 即可自动启用。
    var bridgeReady = false;
    var bridgePort = 0;
    var bridgePeer = null;
    function getBridge() {
      var b = ns && ns.toolkit && ns.toolkit.bridge;
      if (b && typeof b.send === 'function') return b;   // 需消息 send API 才视为可用（当前无 → 返回 null）
      return null;
    }
    function getStatus() {
      var b = ns && ns.toolkit && ns.toolkit.bridge;
      if (b && typeof b.status === 'function') {
        return safeGet(function () { return b.status(); }, null);
      }
      return null;
    }
    function onBridge(cb) {
      var b = ns && ns.toolkit && ns.toolkit.bridge;
      if (cb && b && typeof b.onReady === 'function') { b.onReady(cb); }
    }

    // —— 幂等 + 站点隔离 ——
    if (window.__cxEndedNotifyStarted) return;
    window.__cxEndedNotifyStarted = true;

    // 站点隔离：核心脚本为多平台脚本，本通知为超星专属视频结束联动，仅超星上下文激活
    if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'chaoxing')) return;

    var MARK_MUTED = '__cxEndedMuted';

    function setEnabled(v) { bestEffort(function () { localStorage.cxEndedNotify = v ? '1' : '0'; }, 'en.setEnabled'); }
    function isEnabled() { return safeGet(function () { return localStorage.cxEndedNotify !== '0'; }, true); }

    function muteAll() {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        (function (v) {
          bestEffort(function () {
            if (v.muted) return;
            v[MARK_MUTED] = true;
            v.muted = true;
          }, 'en.mute');
        })(vs[i]);
      }
    }
    function restoreAll() {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        (function (v) {
          bestEffort(function () { if (v[MARK_MUTED]) { v.muted = false; v[MARK_MUTED] = false; } }, 'en.restore');
        })(vs[i]);
      }
    }

    // —— OS 通知 ——
    function notifyOS(title, body) {
      if (!active()) return;
      var token = core && core.capture('notifications');
      bestEffort(function () {
        if (!('Notification' in window)) { TK.toast && TK.toast(body); return; }
        if (Notification.permission === 'granted') {
          bestEffort(function () { new Notification(title, { body: body, tag: 'cx-ended' }); }, 'en.notify.os');
          if (!document.hidden) TK.toast && TK.toast(body);  // 兜底：通知失败仍有 toast
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(function (p) {
            if (active() && (!core || core.valid(token)) && p === 'granted') { bestEffort(function () { new Notification(title, { body: body, tag: 'cx-ended' }); }, 'en.notify.perm'); }
          })['catch'](function () {});
        } else {
          TK.toast && TK.toast(body);
        }
      }, 'en.notify');
    }

    // 若本页是"被联动端"且有用户正在观看，不要自动恢复（避免打断）
    function restoreIfNeeded() {
      bestEffort(function () {
        var st = getStatus();
        if (st && st.playing && st.foreground) { return; }
        restoreAll();
      }, 'en.restoreIf');
    }

    // 在视频真正播放时回调（解决 autoplay 限制：首次需用户手势）
    function whenPlaying(video, cb) {
      bestEffort(function () {
        if (!video) { cb(); return; }
        if (!video.paused && video.currentTime > 0) { cb(); return; }
        var done = false;
        var fin = function () { if (done) return; done = true; bestEffort(function () { video.removeEventListener('playing', fin); }, 'en.whenPlaying.rm'); cb(); };
        video.addEventListener('playing', fin, { once: true });
        setTimeout(function () { if (!done) { done = true; bestEffort(function () { video.removeEventListener('playing', fin); }, 'en.whenPlaying.rm2'); cb(); } }, 3000);
      }, 'en.whenPlaying');
    }

    function closeVideoWhenReady(info) {
      bestEffort(function () {
        var v = info && info.video;
        if (v) { bestEffort(function () { v.pause(); }, 'en.closeVideo.pause'); }
        muteAll();
      }, 'en.closeVideo');
    }

    // 联动端：冻结当前视频到末尾并等待结束（用于"另一端已看完"的场景）
    function freezeVideoAndWait(video, onEnded) {
      bestEffort(function () {
        if (!video) { onEnded && onEnded(); return; }
        var ended = false;
        var handler = function () { if (ended) return; ended = true; bestEffort(function () { video.removeEventListener('ended', handler); }, 'en.freeze.rm'); onEnded && onEnded(); };
        video.addEventListener('ended', handler, { once: true });
        if (video.duration && (video.duration - video.currentTime) < 1.5) {
          bestEffort(function () { video.currentTime = video.duration - 0.05; }, 'en.freeze.seek');
          setTimeout(function () { if (!ended) { ended = true; onEnded && onEnded(); } }, 600);
        }
        setTimeout(function () { if (!ended) { ended = true; onEnded && onEnded(); } }, 8000);
      }, 'en.freeze');
    }

    // ====== 启动 ======
    function start() {
      if (started || stopped || window.__CX_FORCE_PLAY !== ns || (core && core.state() === 'DISPOSED')) return;
      started = true;
      var originalTest = Object.getOwnPropertyDescriptor(TOP, '__cxEndedNotifyTest');
      var originalStatus = Object.getOwnPropertyDescriptor(TOP, '__cxEndedNotifyStatus');
      var testHook, statusHook;
      var cancelUnsubscribe = core && core.onCancel('notifications', restoreAll);
      var addon = {
        id: 'video-ended-notify',
        type: 'toggle',
        label: '视频结束系统通知',
        note: '视频播完→系统通知(多端联动/本地OS通知)',
        get: isEnabled,
        set: setEnabled,
      };
      if (!Array.isArray(window.__cxAddonQueue)) window.__cxAddonQueue = [];
      window.__cxAddonQueue.push(addon);
      if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();

      // 本页视频结束时（本地或联动触发）
      function onThisPageEnded(e) {
        if (!active() || !isEnabled()) return;
        var v = e && e.target;
        var ttl = (document.title || '学习通') + '：视频已播放完毕';
        // 优先走桥（多端联动）
        var b = getBridge();
        if (b) {
          bestEffort(function () {
            b.send({ type: 'video-ended', url: location.href, title: document.title, ts: Date.now() });
          }, 'en.onEnded.send');
        }
        // 本地 OS 通知（降级/补充）
        notifyOS(ttl, '可前往作答或进入下一节');
        muteAll();
      }

      // 幂等性修复(审查 G2-notify)：具名监听器 + 注册 __cxAddonCleanups——旧实现为匿名 capture 监听且未注册
      // 卸载清理（6 个 addon 中唯一缺失者），手动 uninstall 后 ended/play 监听仍附着 document、闭包持有 ns/TK，
      // 卸载后通知/静音副作用仍可能触发（与其余 addon 的成对清理模式对齐）。
      var _onDocEndedCapture = function (e) {
        if (!e.target || e.target.tagName !== 'VIDEO') return;
        onThisPageEnded(e);
      };
      var _onDocPlayCapture = function () { bestEffort(restoreIfNeeded, 'ven.restoreOnPlay'); };
      document.addEventListener('ended', _onDocEndedCapture, true);
      // R6 修复：静音后需要恢复——任何视频开始播放即回收所有被标记静音的视频（本地场景 getStatus 返回 null→restoreAll 生效）
      try { document.addEventListener('play', _onDocPlayCapture, true); } catch (e) {}
      window.__cxAddonCleanups = window.__cxAddonCleanups || [];
      window.__cxAddonCleanups.push(function () {
        stopped = true;
        if (cancelUnsubscribe) cancelUnsubscribe();
        restoreAll();
        try { document.removeEventListener('ended', _onDocEndedCapture, true); } catch (e) {}
        try { document.removeEventListener('play', _onDocPlayCapture, true); } catch (e) {}
        bestEffort(function () {
          if (TOP.__cxEndedNotifyTest === testHook) {
            if (originalTest) Object.defineProperty(TOP, '__cxEndedNotifyTest', originalTest); else delete TOP.__cxEndedNotifyTest;
          }
        }, 'en.cleanup.testHook');
        bestEffort(function () {
          if (TOP.__cxEndedNotifyStatus === statusHook) {
            if (originalStatus) Object.defineProperty(TOP, '__cxEndedNotifyStatus', originalStatus); else delete TOP.__cxEndedNotifyStatus;
          }
        }, 'en.cleanup.statusHook');
      });

      // 联动：收到其他端"视频结束"→ 本页静音并提示
      onBridge(function (msg) {
        if (!msg) return;
        if (msg.type === 'video-ended') {
          if (!isEnabled()) return;
          muteAll();
          var nm = (msg.title || '另一设备') + '：视频已播放完毕';
          notifyOS(nm, '本端已静音（可前往作答）');
        } else if (msg.type === 'ping') {
          var b = getBridge();
          if (b) { bestEffort(function () { b.send({ type: 'pong', url: location.href }); }, 'en.ping.send'); }
        }
      });

      // 跨脚本调试钩子
      testHook = function () { notifyOS('学习通：视频已播放完毕', '手动测试通知'); };
      statusHook = function () {
        var st = getStatus();
        return { bridgeReady: !!getBridge(), status: st, enabled: isEnabled() };
      };
      TOP.__cxEndedNotifyTest = testHook;
      TOP.__cxEndedNotifyStatus = statusHook;

      // 注册进面板工具库
      if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
})();
