// @requires: bestEffort, safeGet
  // ===== 工具库项：原型篡改报警（原 decision/chaoxing-tamper-guard，v1.0 迁入核心脚本工具库） =====
  // 站点归属：超星学习通。依赖核心脚本暴露的 getPauseNeutralized()/getRateNeutralized()（ananas 接管检测）。
  (function () {
    'use strict';

    var ns = window.__CX_FORCE_PLAY;
    var STORAGE_KEY = 'cxTg_on';
    // S7：静音契约标记——仅记录本工具库因礼貌模式导致的静音，恢复时只还原自身标记，
    // 不与 video-ended-notify 的 __cxEndedMuted 冲突（两者可能同时作用于同一视频）
    var TG_MUTED = '__cxTgMuted';
    var TG_MUTED_BACKUP = '__cxTgMutedBackup';

    function enabled() {
      return safeGet(function () { return localStorage[STORAGE_KEY] !== '0'; }, true);
    }

    function applyVisual(on) {
      // 静默模式（关闭脚本弹窗）：顶部色条也是脚本浮层，开启时不显示（状态仍只在洞察页提示流反映）
      if (ns && typeof ns.isQuietPopups === 'function' && ns.isQuietPopups()) {
        var _b = document.getElementById('cxTgBar'); if (_b) _b.style.display = 'none';
        return;
      }
      var bar = document.getElementById('cxTgBar');
      if (on) {
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'cxTgBar';
          bar.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:4px;background:linear-gradient(90deg,#ff4d4f,#ffa940);z-index:2147483646;box-shadow:0 1px 4px rgba(0,0,0,.3);opacity:.85;pointer-events:none;';
          document.body.appendChild(bar);
        }
        bar.style.display = 'block';
      } else if (bar) {
        bar.style.display = 'none';
      }
    }

    function emitFeed(msg, level) {
      bestEffort(function () { if (window.EventBus && window.EventBus.emit) window.EventBus.emit('ui:toast', msg, level || 'error'); }, 'tg.emitFeed');
    }
    // S7 修复：接管恢复后还原礼貌模式静音——仅还原本工具库标记的静音，避免永久静音无还原
    function restoreTgMuted() {
      bestEffort(function () {
        var vs = document.querySelectorAll('video');
        for (var i = 0; i < vs.length; i++) { bestEffort(function () {
          var vv = vs[i];
          if (vv[TG_MUTED]) { vv.muted = !!vv[TG_MUTED_BACKUP]; vv[TG_MUTED] = false; vv[TG_MUTED_BACKUP] = undefined; }
        }, 'tg.restore'); }
      }, 'tg.restoreAll');
    }
    // 红色报警条（仅非静默时悬浮）；无论是否静默都进洞察页提示流，保证可追溯
    function tgToast(msg, level) {
      bestEffort(function () {
        var quiet = (ns && typeof ns.isQuietPopups === 'function') ? ns.isQuietPopups() : false;
        emitFeed(msg, level);
        if (quiet) return;
        var t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);background:rgba(220,38,38,.95);color:#fff;padding:10px 16px;border-radius:10px;font:14px/1.4 system-ui;z-index:2147483647;max-width:80vw;box-shadow:0 6px 20px rgba(0,0,0,.3);';
        (document.body || document.documentElement).appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
      }, 'tg.toast');
    }

    function notify() {
      bestEffort(function () {
        if (ns && typeof ns.isQuietPopups === 'function' && ns.isQuietPopups()) return;
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') new Notification('超星防暂停被绕过', { body: '检测到页面接管了暂停，请检查。' });
      }, 'tg.notify');
    }

    var wasBypassed = false;       // 上一帧是否已确认"被绕过"（去抖用）
    var lastAlert = 0;
    var bypassStreak = 0, okStreak = 0;   // 连续轮次计数：避免原型每轮重装间隙的瞬时抖动反复弹窗

    function guardTick() {
      if (!enabled()) { applyVisual(false); wasBypassed = false; bypassStreak = 0; okStreak = 0; return; }
      // 无视频页面：没有接管对象，既不告警也不显示色条（修复"明明没视频却提示被绕过"的误报）
      var hasVideo = safeGet(function () { return document.querySelectorAll('video').length > 0; }, false);
      if (!hasVideo) { applyVisual(false); wasBypassed = false; bypassStreak = 0; okStreak = 0; return; }
      // 真正"被绕过" = 中性化已不在位（get*===false）；null 表示不适用（温和/未装原型），不算绕过
      var pauseBypassed = safeGet(function () { if (typeof ns.getPauseNeutralized === 'function') return ns.getPauseNeutralized() === false; return false; }, false);
      var rateBypassed = safeGet(function () { if (typeof ns.getRateNeutralized === 'function') return ns.getRateNeutralized() === false; return false; }, false);
      var nowBypassed = pauseBypassed || rateBypassed;

      // 连续 2 轮确认才认定状态翻转，消除原型重装间隙的瞬时抖动造成的反复弹窗
      if (nowBypassed) { bypassStreak++; okStreak = 0; } else { okStreak++; bypassStreak = 0; }
      var alarm = (bypassStreak >= 2);

      // 顶部色条（始终反映真实接管状态）
      applyVisual(nowBypassed);

      // 恢复提示（仅进洞察页，不悬浮红条，减少刷屏）
      if (wasBypassed && !alarm) {
        emitFeed('✅ 暂停接管已恢复', 'success');
        restoreTgMuted();   // S7：接管恢复后还原礼貌模式静音，避免永久静音无还原
      } else if (alarm && !wasBypassed) {
        var now = Date.now();
        if (now - lastAlert > 3000) {
          lastAlert = now;
          tgToast((pauseBypassed ? '⚠ 暂停接管被绕过' : '') + (rateBypassed ? '⚠ 倍速接管被绕过' : ''), 'critical');
          notify();
        }
        // 安静/礼貌模式：被接管时自动静音前一次播放，避免被发现
        if (ns.CONFIG && ns.CONFIG.POLITE_MODE) {
          var vs = document.querySelectorAll('video');
          for (var i = 0; i < vs.length; i++) { bestEffort(function () {
            var vv = vs[i];
            // S7 修复：仅标记本工具库导致的静音并记录用户原静音状态；接管恢复时 restoreTgMuted 还原，避免永久静音无还原
            if (!vv[TG_MUTED]) { vv[TG_MUTED] = true; vv[TG_MUTED_BACKUP] = vv.muted; vv.muted = true; }
          }, 'tg.mute'); }
        }
      }
      wasBypassed = alarm;
    }

    var _tgTimer = null;    // 保存定时器注册表 id(owner 'tamper-guard')，避免双重调度；uninstall 时由 TimerRegistry.clearAll() 兜底清理

    function init() {
      bestEffort(function () {
        function _startGuard() {
          if (_tgTimer) { ns.TimerRegistry.clearInterval(_tgTimer); _tgTimer = null; }
          _tgTimer = ns.TimerRegistry.setInterval(guardTick, 2000, 'tamper-guard');
          guardTick();
        }
        if (document.readyState !== 'loading') { _startGuard(); }
        else { document.addEventListener('DOMContentLoaded', _startGuard); }
      }, 'tg.init');
    }

    // —— 幂等 + 站点隔离 ——
    if (window.__cxTgStarted) return;
    window.__cxTgStarted = true;

    // 站点隔离：ananas 接管检测为超星专属，仅超星上下文激活
    if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'chaoxing')) return;

    init();

    // 注入工具库
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'tamper-guard',
      type: 'toggle',
      label: '原型篡改报警',
      note: '检测 ananas 暂停/倍速接管被绕过并告警',
      get: enabled,
      set: function (v) { bestEffort(function () {
        localStorage[STORAGE_KEY] = v ? '1' : '0';
        applyVisual(v);
        // 仅在用户交互（点击开关）这一手势内请求通知权限，避免无手势调用被浏览器忽略/拦截
        if (v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      }, 'tg.setEnabled'); },
    });

    // NEW-5 修复：注册卸载清理，反注册篡改检测定时器，避免脚本卸载后定时器泄漏
    window.__cxAddonCleanups = window.__cxAddonCleanups || [];
    window.__cxAddonCleanups.push(function () {
      try { if (_tgTimer) { ns.TimerRegistry.clearInterval(_tgTimer); _tgTimer = null; } } catch (e) {}
    });
    if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
})();
