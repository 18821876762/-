// ===== 工具库项：超星(学习通)自动下一课（v4.15 重写） =====
// 站点归属：超星/学习通（detectSite()==='chaoxing'），与智慧树 zhihuishu-auto-next.js 并列、互不干扰。
//
// 需求（用户原话）：学习通是「视频 → 题目 → 视频」的闭环——视频播完跳到题目(或下一节)，处理完再回/进下一个视频。
// 旧版(v4.14 及以前)「完全无法使用」的根因已定位并修复：
//   1) 【致命】onVideoEnded 里 `if (__cxForcePaused) defer` —— 而被本脚本强制续播的视频恰好都带 __cxForcePaused，
//      导致续播接管后的视频永远被 defer、永不跳转。已移除该误判（续播的视频 ended 本就该跳）。
//   2) isChapterPage 强制要求 knowledgeId+courseId 同时存在，学习通新版 study 页 URL 一旦少参数就整段 skip。已放宽。
//   3) 跳转强依赖本地 Bridge(7531) 服务，未装则只能走猜测的 DOM 选择器。改为 DOM 优先、Bridge 仅补充，且找不到时给出诊断而非静默卡死。
//   4) 状态机 POLLING_QUIZ/TRYING_CLICK 过于复杂、任一环节失败即 LOCKED。重写为轻量三态：IDLE / NAVIGATING / LOCKED。
//
// 设计原则：
//   - 触发：document 的 capture `ended` 事件（核心脚本只锁死 play、不 stopPropagation，事件可冒泡到此处）。
//   - 防重播冲突：视频 ended 时核心脚本已用 __cxEndedLock 锁死 play，本项只负责「找下一节并跳转」，互不打架。
//   - 防重复跳转：WeakSet 记录已处理视频；导航期间 navLock 防二次触发；检测验证码/解锁页则放弃(LOCKED)。
//   - 题目环节：学习通视频流中的随堂题目多为独立作业入口或弹窗。本项在跳转「下一节」前做一次轻量题目入口探测，
//     命中则优先点入；探测超时(8s)或缺失则直接跳下一节，绝不长时间卡死在题目轮询。
(function () {
  'use strict';

  // 幂等守卫
  if (window.__cxAutoNextStarted) return;
  window.__cxAutoNextStarted = true;

  // 站点隔离：超星专属
  if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'chaoxing')) return;

  var CFG = {
    LS_KEY: 'cx_an_on',
    DEBUG: true,
    NAV_LOCK_MS: 4000,            // 导航期间锁，防止 ended 事件重复触发
    QUIZ_PROBE_TIMEOUT: 8000,     // 题目入口探测超时（到则直接跳下一节）
    BRIDGE_PORTS: [7531, 7532, 7530, 17531],
    BRIDGE_PROBE_TIMEOUT: 1500,
    // 下一节 DOM 选择器（best-effort 并集，待真实站点校准）
    NEXT_SELECTORS: ['.nextChapter', '#prevNextChapterNext', '.next_prev_b .nextChapter', '.nextChapterBtn', 'a[title*="下一节"]', 'a[title*="下一章"]'],
    // 题目入口 DOM 选择器（best-effort 并集，待真实站点校准）
    QUIZ_ENTRY_SELECTORS: ['.ans-job-icon', '.jobUnfinished', '.chapterLaunage', 'a[href*="work"]', 'a[href*="exam"]'],
    // 验证码/解锁页关键词
    BLOCK_KEYWORDS: ['验证码', '滑动验证', '请完成安全验证', '解锁'],
  };

  // ---- 依赖 ----
  var $log = {
    info: function (m) { if (CFG.DEBUG) console.log('%c[auto-next]%c ' + m, 'color:#3a7;', ''); },
    warn: function (m) { if (CFG.DEBUG) console.warn('[auto-next] ' + m); },
  };
  function toast(msg) {
    try { if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.toast === 'function') window.__CX_FORCE_PLAY.toast(msg); }
    catch (e) { try { console.log('[auto-next] ' + msg); } catch (e2) {} }
  }
  var $storage = {
    isOn: function () { try { return '1' === localStorage[CFG.LS_KEY]; } catch (e) { return false; } },
    setOn: function (v) { try { localStorage[CFG.LS_KEY] = v ? '1' : '0'; } catch (e) {} },
    listen: function (fn) { try { window.addEventListener('storage', function (e) { if (e.key === CFG.LS_KEY) fn(); }); } catch (e) {} },
  };
  var $dom = {
    one: function (sel) { try { return document.querySelector(sel); } catch (e) { return null; } },
    all: function (sel) { try { return [].slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } },
    isVisible: function (el) { try { if (!el) return false; var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(el) : null; var s = cs || el.style; if (s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (e) { return false; } },
  };
  var $nav = {
    // 放宽：只要有 courseId（学习通 study 页基本都有）即视为课程页；knowledgeId 仅作辅助
    cid: function () { try { var p = new URLSearchParams(location.search); return p.get('courseId') || p.get('clazzid') || p.get('courseId'); } catch (e) { return null; } },
    kid: function () { try { var p = new URLSearchParams(location.search); return p.get('knowledgeId') || p.get('chapterId') || p.get('kjid'); } catch (e) { return null; } },
    isCoursePage: function () { return !!this.cid(); },
  };
  var $bridge = (function () {
    var base = null;
    function corsFetch(url, timeout) {
      return new Promise(function (resolve, reject) {
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, timeout || 8000);
        try {
          var x = new XMLHttpRequest();
          x.open('GET', url, true);
          x.onload = function () { if (!done) { done = true; clearTimeout(t); try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } } };
          x.onerror = function () { if (!done) { done = true; clearTimeout(t); reject(new Error('xhr error')); } };
          x.send();
        } catch (e) { if (!done) { done = true; clearTimeout(t); reject(e); } }
      });
    }
    return {
      probe: function () {
        var ports = CFG.BRIDGE_PORTS.slice();
        function tryNext() {
          if (!ports.length) return Promise.reject(new Error('no bridge'));
          var p = ports.shift();
          return corsFetch('http://127.0.0.1:' + p + '/ping', CFG.BRIDGE_PROBE_TIMEOUT).then(function () { base = 'http://127.0.0.1:' + p; return base; }).catch(tryNext);
        }
        return tryNext();
      },
      getPlaylist: function (cid) { if (!base) return Promise.reject(new Error('no bridge')); return corsFetch(base + '/playlist/' + encodeURIComponent(cid), 10000); },
      isConnected: function () { return !!base; },
      getBase: function () { return base; },
    };
  })();

  // ---- 状态机（轻量三态）----
  var IDLE = 'IDLE', NAVIGATING = 'NAVIGATING', LOCKED = 'LOCKED';
  var state = IDLE;
  var navLockUntil = 0;
  var seenVideos = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
  var handledUrls = (typeof Object.create === 'function') ? Object.create(null) : {};  // 无原型链，避免 'toString'/'constructor' 等键误判已处理

  function isNavLocked() { return Date.now() < navLockUntil; }
  function lockNav() { navLockUntil = Date.now() + CFG.NAV_LOCK_MS; }
  function setState(s) { state = s; $log.info('state → ' + s); }

  function blockedByVerify() {
    try {
      var txt = (document.body ? document.body.innerText : '') || '';
      for (var i = 0; i < CFG.BLOCK_KEYWORDS.length; i++) { if (txt.indexOf(CFG.BLOCK_KEYWORDS[i]) >= 0) return true; }
    } catch (e) {}
    return false;
  }

  // ---- 下一节查找（DOM 优先，Bridge 补充）----
  function findNextDOM() {
    // 1) 显式选择器
    for (var i = 0; i < CFG.NEXT_SELECTORS.length; i++) {
      var el = $dom.one(CFG.NEXT_SELECTORS[i]);
      if (el && $dom.isVisible(el)) {
        var href = el.getAttribute('href') || el.href;
        if (href && href !== '#' && !/javascript:/.test(href)) return { url: href, label: (el.textContent || '下一节').trim() || '下一节(DOM)' };
      }
    }
    // 2) 关键词兜底
    var as = $dom.all('a');
    for (var j = 0; j < as.length; j++) {
      var t = (as[j].textContent || as[j].title || '').trim();
      if (/下一章|下一节|下一课|后一章|继续学习/.test(t)) {
        var h = as[j].getAttribute('href') || as[j].href;
        if (h && h !== '#' && !/javascript:/.test(h)) return { url: h, label: t };
      }
    }
    return null;
  }

  function findNextBridge(cid) {
    if (!cid || !$bridge.isConnected()) return Promise.reject(new Error('bridge unavailable'));
    return $bridge.getPlaylist(cid).then(function (chapters) {
      if (!chapters || !chapters.length) return null;
      var cur = $nav.kid(), found = false;
      for (var i = 0; i < chapters.length; i++) {
        var ch = chapters[i];
        if (found) {
          if ((ch.unfinishedCount != null && ch.unfinishedCount > 0) || !ch.completed) return { url: ch.url || (ch.knowledgeId ? ('?knowledgeId=' + ch.knowledgeId) : null), label: ch.title || '下一章(Bridge)' };
        }
        if (String(ch.knowledgeId || ch.id) === String(cur)) found = true;
      }
      return null;
    });
  }

  function resolveNext(cid) {
    var dom = findNextDOM();
    if (dom) return Promise.resolve(dom);
    return findNextBridge(cid).catch(function () { return null; });
  }

  function doNavigate(next) {
    if (!next || !next.url) { setState(LOCKED); toast('未找到下一节入口（已停止自动跳课，请手动点下一节）'); return; }
    var url = next.url;
    if (/^https?:\/\//.test(url) || url.charAt(0) === '/') {
      lockNav();
      $log.info('navigate → ' + url);
      toast('自动跳下一节：' + (next.label || ''));
      setTimeout(function () { try { window.location.href = url; } catch (e) { window.location.assign(url); } }, 300);
    } else if (url.charAt(0) === '#' || /javascript:/.test(url)) {
      // 同页锚点/SPA 路由：尝试点击触发
      var link = $dom.one('a[href="' + url + '"]');
      if (link) { lockNav(); setState(IDLE); $log.info('click SPA next: ' + url); link.click(); }
      else { setState(LOCKED); toast('下一节为 SPA 路由但找不到可点击节点'); }
    } else {
      setState(LOCKED); toast('下一节地址无法解析：' + url);
    }
  }

  // ---- 题目入口轻量探测（超时即放弃，直接跳下一节）----
  function probeQuizEntry() {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, CFG.QUIZ_PROBE_TIMEOUT);
      try {
        for (var i = 0; i < CFG.QUIZ_ENTRY_SELECTORS.length; i++) {
          var els = $dom.all(CFG.QUIZ_ENTRY_SELECTORS[i]);
          for (var j = 0; j < els.length; j++) {
            if ($dom.isVisible(els[j])) {
              var href = els[j].getAttribute('href') || els[j].href || (els[j].tagName === 'A' ? els[j].getAttribute('onclick') : null);
              if (href && href !== '#' && !/javascript:/.test(href)) {
                if (!done) { done = true; clearTimeout(t); resolve({ el: els[j], url: href }); }
                return;
              }
              // 无 href 的可点击节点（学习通常直接点开作业弹层）：直接点
              if (!done) { done = true; clearTimeout(t); resolve({ el: els[j], url: null }); }
              return;
            }
          }
        }
      } catch (e) {}
      if (!done) { done = true; clearTimeout(t); resolve(null); }
    });
  }

  // ---- 核心：视频结束处理 ----
  function onVideoEnded(v) {
    if (state === LOCKED) { $log.info('LOCKED, ignore'); return; }
    if (isNavLocked()) { $log.info('nav lock, ignore'); return; }
    if (blockedByVerify()) { $log.warn('verify page detected → LOCKED'); setState(LOCKED); toast('检测到验证/解锁页，已停止自动跳课'); return; }
    if (seenVideos ? seenVideos.has(v) : handledUrls[v.src]) { $log.info('already handled, skip'); return; }
    if (seenVideos) seenVideos.add(v); else handledUrls[v.src] = true;

    $log.info('video ended → 处理跳转');
    setState(NAVIGATING);

    var cid = $nav.cid();
    // 先轻量探测题目入口（限时）；命中则点入，否则直接找下一节
    probeQuizEntry().then(function (quiz) {
      if (quiz) {
        $log.info('题目入口命中，点入');
        toast('检测到题目入口，点入作答');
        lockNav();
        try { if (quiz.url) { window.location.href = quiz.url; } else if (quiz.el) { quiz.el.click(); } } catch (e) { resolveNext(cid).then(doNavigate); }
        return;
      }
      // 直接找下一节并跳转
      resolveNext(cid).then(function (next) {
        if (next) doNavigate(next);
        else { $log.warn('no next (DOM+Bridge) → LOCKED'); setState(LOCKED); toast('已播完且未找到下一节（停止自动跳课）'); }
      }).catch(function (e) {
        swallow(e);
        $log.warn('resolveNext error → LOCKED'); setState(LOCKED); toast('查找下一节出错（停止自动跳课）');
      });
    });
  }

  function onToggleChanged(on) {
    if (on) { if (state === LOCKED) setState(IDLE); $log.info('enabled'); }
    else { setState(IDLE); $log.info('disabled'); }
  }

  // ---- 面板注册（工具库项）----
  function panelRegister() {
    var addon = {
      id: 'auto-next',
      type: 'toggle',
      label: '章节读完自动下一课',
      note: '视频播完跳下一节/题目（超星专属；移除旧版 force-paused 误判）',
      get: $storage.isOn,
      set: function (v) { $storage.setOn(v); onToggleChanged(v); },
    };
    try {
      if (!Array.isArray(window.__cxAddonQueue)) window.__cxAddonQueue = [];
      window.__cxAddonQueue.push(addon);
      if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
    } catch (e) {}
  }

  // ---- 启动 ----
  function bootstrap() {
    panelRegister();
    document.addEventListener('ended', function (e) {
      var v = e.target;
      if (!v || v.tagName !== 'VIDEO') return;
      if (!$storage.isOn()) return;
      onVideoEnded(v);
    }, true);
    $storage.listen(function () {
      var on = $storage.isOn();
      onToggleChanged(on);
      toast(on ? '已开启：章节读完自动下一课' : '已关闭：自动下一课');
    });
    // Bridge 探活（非阻塞，仅日志）
    $bridge.probe().then(function (b) { $log.info('bridge connected: ' + b); }).catch(function () { $log.info('bridge offline，仅 DOM 跳转'); });
    $log.info('v4.15 booted, state=' + state + ', coursePage=' + $nav.isCoursePage());
  }

  setTimeout(bootstrap, 300);
})();
