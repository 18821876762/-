// @requires: CONST, FLAGS, bestEffort, lsFlag, lsSetFlag, safeGet, safePlay
// @source-group: plugins/addons/auto-next.js
// 超星自动下一课：统一三态、共同运行门禁、可取消导航及完整题目结算等待。
(function () {
  'use strict';

  // 幂等守卫
  if (window.__cxAutoNextStarted) return;

  // 站点隔离：超星专属
  if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'chaoxing')) return;
  window.__cxAutoNextStarted = true;

  var CFG = {
    LS_KEY: (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.KEYS && window.__CX_FORCE_PLAY.KEYS.AUTO_NEXT_ON) || 'cx_an_on',
    DEBUG: true,
    NAV_LOCK_MS: 4000,            // 导航期间锁，防止 ended 事件重复触发
    QUIZ_PROBE_TIMEOUT: 8000,     // 题目入口探测超时（到则直接跳下一节）
    BRIDGE_PORTS: [7531, 7532, 7533, 8543, 9090],
    BRIDGE_PROBE_TIMEOUT: 1500,
    // 下一节 DOM 选择器（并集：新版 study 页 + 历史版本 + 通用属性兜底）
    // 说明：超星页面结构多年多次改版，此处按「新版优先、旧版兜底」的顺序覆盖已知稳定入口，
    //       最终仍有关键词文本兜底(findNextDOM 第 2/3 段)抗未知改版。
    NEXT_SELECTORS: [
      '#prevNextFocusNext',            // 新版 study 页「下一节」聚焦按钮（较稳定）
      '.prev_next .next',              // 新版上/下节容器内的 next
      '.next_prev_b .nextChapter',    // 旧版容器
      '#prevNextChapterNext',
      '.nextChapterBtn', '.nextChapter',
      'a[title*="下一节"]', 'a[title*="下一章"]', 'a[title*="下一"]',
      '[class*="next"][class*="chapter" i]',   // 属性模糊兜底（class 含 next+chapter）
    ],
    // 题目入口 DOM 选择器（并集：作业/考试图标 + 未完成标记 + 通用属性兜底）
    QUIZ_ENTRY_SELECTORS: [
      '.ans-job-icon',                 // 章节任务点图标
      '.jobUnfinished', '.jobUnfinishCount', '.ans-job-finished ~ .jobUnfinished',
      '.chapterLaunage',
      'a[href*="work"]', 'a[href*="exam"]', 'a[href*="workset"]',
      '[class*="job"][class*="unfinish" i]',   // 属性模糊兜底（class 含 job+unfinish）
    ],
    // 章节任务「已完成」态标记（用于 Bridge 判断跳过已完成节点）
    FINISHED_SELECTORS: ['.ans-job-finished', '.icon_Completed', '[class*="finished" i]'],
    // 验证码/解锁页关键词
    BLOCK_KEYWORDS: ['验证码', '滑动验证', '请完成安全验证', '解锁'],
  };

  // ---- 依赖 ----
  var $log = {
    info: function (m) { if (CFG.DEBUG) console.log('%c[auto-next]%c ' + m, 'color:#3a7;', ''); },
    warn: function (m) { if (CFG.DEBUG) console.warn('[auto-next] ' + m); },
  };
  function toast(msg) {
    bestEffort(function () {
      if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit && typeof window.__CX_FORCE_PLAY.toolkit.toast === 'function') window.__CX_FORCE_PLAY.toolkit.toast(msg);
      else bestEffort(function () { console.log('[auto-next] ' + msg); }, 'an.toast.log');
    }, 'an.toast');
  }
  function isTopFrame() {
    return safeGet(function () { return window.top === window.self; }, false);
  }
  var _storageHandler = null;   // NEW-5：缓存 storage 监听引用，供卸载时反注册
  var $storage = {
    isOn: function () { return lsFlag(CFG.LS_KEY, false); },
    setOn: function (v) { lsSetFlag(CFG.LS_KEY, v); },
    listen: function (fn) {
      _storageHandler = function (e) { if (e.key === CFG.LS_KEY || e.key === 'cx_bridge_on' || e.key === 'cx_bridge_off' || e.key === 'cx_bridge_base') fn(); };
      bestEffort(function () { window.addEventListener('storage', _storageHandler); }, 'an.storage.listen');
    },
  };
  var $dom = {
    one: function (sel) { return safeGet(function () { return document.querySelector(sel); }, null); },
    all: function (sel) { return safeGet(function () { return Array.from(document.querySelectorAll(sel)); }, []); },
    isVisible: function (el) { return safeGet(function () { if (!el) return false; var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(el) : null; var s = cs || el.style; if (s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, false); },
  };
  var $nav = {
    cid: function () { return safeGet(function () { var p = new URLSearchParams(location.search); return p.get('courseId') || p.get('clazzid'); }, null); },
    kid: function () { return safeGet(function () { var p = new URLSearchParams(location.search); return p.get('knowledgeId') || p.get('chapterId') || p.get('kjid'); }, null); },
    isCoursePage: function () { return !!this.cid(); },
  };
  // 导航上下文统一持有作用域令牌；任何取消都会使已排队的 Promise/timer 失效。
  var IDLE = 'IDLE', NAVIGATING = 'NAVIGATING', LOCKED = 'LOCKED';
  var state = IDLE, generation = 0, disposed = false, activeJob = null;
  var timers = [], requests = [], cancelUnsubscribe = null, changeUnsubscribe = null;
  var successes = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var successFallback = [];
  function coreState() { return window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.CoreState; }
  function canRun() {
    var ns = window.__CX_FORCE_PLAY, cs = coreState();
    if (disposed || !ns || !$storage.isOn()) return false;
    if (cs && typeof cs.canRun === 'function') return cs.canRun();
    // 抽取测试及旧宿主兼容；真实产物使用共同控制器。
    return !(ns.SAFETY && ns.SAFETY.tripped) && !(ns.CONFIG && ns.CONFIG.ENABLED === false);
  }
  function context() {
    var cs = coreState();
    return { generation: generation, token: cs && cs.capture ? cs.capture('navigation') : null };
  }
  function valid(ctx) {
    var cs = coreState();
    return !!ctx && ctx.generation === generation && canRun() && (!cs || !cs.valid || cs.valid(ctx.token));
  }
  function later(fn, ms) {
    var id = setTimeout(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, ms);
    timers.push(id); return id;
  }
  function clearLater(id) { clearTimeout(id); var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); }
  function setState(next) { if (state !== next) { state = next; $log.info('state → ' + next); } }
  function releaseHold(resume) {
    var v = _holdVid; _holdVid = null;
    if (!v) return;
    bestEffort(function () { v[FLAGS.anHold] = false; }, 'an.hold.clear');
    if (resume && canRun() && !v.ended) bestEffort(function () { safePlay(v); }, 'an.hold.release');
  }
  function cancelWork(reason) {
    generation++;
    stopHoldTimer();
    timers.splice(0).forEach(function (id) { clearTimeout(id); });
    requests.splice(0).forEach(function (cancel) { cancel(); });
    activeJob = null;
    releaseHold(false);
    setState(IDLE);
    $log.info('cancel: ' + reason);
  }
  function invalidate(reason) {
    var cs = coreState();
    if (cs && cs.invalidateScope) cs.invalidateScope('navigation', reason);
    cancelWork(reason);
  }
  function videoIdentity(v) {
    return [location.href, $nav.kid() || '', v.currentSrc || '', v.getAttribute && v.getAttribute('src') || v.src || ''].join('|');
  }
  function succeeded(v, key) {
    if (successes) return successes.get(v) === key;
    return successFallback.some(function (entry) { return entry.video === v && entry.key === key; });
  }
  function recordSuccess(job) {
    if (successes) successes.set(job.video, job.key);
    else { successFallback.push({ video: job.video, key: job.key }); if (successFallback.length > 64) successFallback.shift(); }
  }
  function jobValid(job) {
    if (activeJob !== job) return false;
    if (!valid(job) || videoIdentity(job.video) !== job.key) { cancelWork('navigation context changed'); return false; }
    if (blockedByVerify()) { cancelWork('verification'); setState(LOCKED); return false; }
    return true;
  }
  function bridgeConfigured() {
    if (!canRun()) return false;
    if (typeof bridgeEnabledByConfig === 'function') return bridgeEnabledByConfig();
    if (safeGet(function () { return localStorage.getItem('cx_bridge_off'); }, null) === '1') return false;
    return /[?&]cxbridge=([^&]+)/i.test(location.search) || safeGet(function () { return localStorage.getItem('cx_bridge_on'); }, null) === '1';
  }
  function bridgeCandidates() {
    var configured = typeof resolveBridgeBase === 'function' ? resolveBridgeBase() : null;
    if (!configured) {
      var raw = safeGet(function () { return new URLSearchParams(location.search).get('cxbridge') || localStorage.getItem('cx_bridge_base'); }, null);
      if (/^\d{1,5}$/.test(raw || '')) configured = 'http://127.0.0.1:' + raw;
      else if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(raw || '')) configured = String(raw).replace(/\/+$/, '');
    }
    var ports = typeof CONST !== 'undefined' && CONST.BRIDGE_PROBE_PORTS || CFG.BRIDGE_PORTS;
    var bases = [configured || 'http://127.0.0.1:7531'];
    ports.forEach(function (port) { var b = 'http://127.0.0.1:' + port; if (bases.indexOf(b) < 0) bases.push(b); });
    return bases;
  }
  var $bridge = (function () {
    var base = null, deadUntil = 0, probing = null;
    function corsFetch(url, timeout, ctx) {
      return new Promise(function (resolve, reject) {
        if (!valid(ctx) || !bridgeConfigured()) { reject(new Error('cancelled')); return; }
        var done = false, ctrl = null, xhr = null, timer = null;
        function finish(err, value) {
          if (done) return;
          done = true;
          if (timer !== null) clearLater(timer);
          var i = requests.indexOf(cancel); if (i >= 0) requests.splice(i, 1);
          if (err) reject(err);
          else if (valid(ctx) && bridgeConfigured()) resolve(value);
          else reject(new Error('cancelled'));
        }
        function abort() { bestEffort(function () { if (ctrl) ctrl.abort(); if (xhr) xhr.abort(); }, 'an.bridge.abort'); }
        function cancel() { finish(new Error('cancelled')); abort(); }
        requests.push(cancel);
        timer = later(function () { finish(new Error('timeout')); abort(); }, timeout || 8000);
        try {
          if (typeof fetch === 'function') {
            ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            fetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' }).then(function (r) {
              if (!r.ok) throw new Error('bad status ' + r.status);
              return r.text();
            }).then(function (txt) { finish(null, JSON.parse(txt)); }).catch(function (err) { finish(err); });
          } else {
            xhr = new XMLHttpRequest(); xhr.open('GET', url, true);
            xhr.onload = function () {
              try { if (xhr.status < 200 || xhr.status >= 300) throw new Error('bad status ' + xhr.status); finish(null, JSON.parse(xhr.responseText)); }
              catch (e) { finish(e); }
            };
            xhr.onerror = function () { finish(new Error('xhr error')); }; xhr.send();
          }
        } catch (e) { finish(e); }
      });
    }
    return {
      probe: function (ctx) {
        if (!valid(ctx) || !bridgeConfigured()) return Promise.reject(new Error('cancelled'));
        if (base) return Promise.resolve(base);
        if (Date.now() < deadUntil) return Promise.reject(new Error('no bridge'));
        if (probing) return probing;
        var bases = bridgeCandidates();
        function tryNext() {
          if (!valid(ctx) || !bridgeConfigured()) return Promise.reject(new Error('cancelled'));
          if (!bases.length) return Promise.reject(new Error('no bridge'));
          var candidate = bases.shift();
          return corsFetch(candidate + '/ping', CFG.BRIDGE_PROBE_TIMEOUT, ctx).then(function () { base = candidate; return base; }).catch(tryNext);
        }
        var pending = tryNext().then(function (b) { if (probing === pending) probing = null; return b; }).catch(function (err) {
          if (probing === pending) probing = null;
          if (valid(ctx) && bridgeConfigured()) deadUntil = Date.now() + 60000;
          throw err;
        });
        probing = pending; return pending;
      },
      reset: function () { base = null; deadUntil = 0; probing = null; },
      getPlaylist: function (cid, ctx) { return this.probe(ctx).then(function (b) { return corsFetch(b + '/playlist/' + encodeURIComponent(cid), 10000, ctx); }); },
    };
  })();

