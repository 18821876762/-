// @provides: BRIDGE
// @requires: CONST, CX_KEYS, CoreState, FLAGS, TARGET, _targetMissStreak, bestEffort, cxState, dbg, markDomDirty, refreshTargets, safeGet, topHref, urlParam
  // 每帧保留本章权威状态，同源帧仅共享网络资源与短期探测结果。
  var BRIDGE = { base: null, chapter: null, skipResume: false, version: null };
  function resolveBridgeBase() {
    var _result = null;
    var q = safeGet(function () { return ((window.location.search.match(/[?&]cxbridge=([^&]+)/i) || topHref().match(/[?&]cxbridge=([^&]+)/i)) || [])[1]; }, null);
    if (q) {
      // 与下方 localStorage 路径保持一致的来源面收窄(MED-2)：仅信任回环地址(127.0.0.1/localhost/[::1])，
      // 防止注入 ?cxbridge= 的页面 URL 将桥请求重定向到外部主机(SSRF)。桥本质是本地爬虫代理，回环限制无损功能。
      var _qm = String(q).match(/^(https?):\/\/((127\.0\.0\.1|localhost|\[::1\])(:\d+)?)(\/.*)?$/i);
      if (_qm) { _result = _qm[1] + '://' + _qm[2].replace(/\/+$/, ''); }
      else if (/^\d{1,5}$/.test(q)) { _result = 'http://127.0.0.1:' + q; }
      else if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(q)) { _result = 'http://' + q.replace(/\/+$/, ''); }
    } else {
      var ls = safeGet(function () { return localStorage.getItem(CX_KEYS.BRIDGE_BASE); }, null);
      if (ls) {
        ls = String(ls).replace(/\/+$/, '');
        // 安全修复(审查 MED-2)：仅信任回环地址(127.0.0.1/localhost)，防止同源页面改写 localStorage
        // 将桥请求重定向到外部主机（响应已做结构+同域校验，此处收窄来源面）。
        if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(ls)) _result = ls;
      }
    }
    return _result || 'http://127.0.0.1:7531';   // 修复 #14：默认端口须与 cx_crawler/config.py 的 BRIDGE_PORT 保持一致；改端口时两边同步修改
  }
  var _bridgeOwner = window.__CX_FORCE_PLAY, _bridgeCoordinator = null;
  var _bridgeJobs = [], _bridgeSession = null, _bridgeProbeInFlight = false, _bridgeStarting = false;
  function _bridgeOwnCoordinator() {
    if (!_bridgeCoordinator) _bridgeCoordinator = new BridgeCoordinator();
    return _bridgeCoordinator;
  }
  function _bridgeSharedCoordinator() {
    var frame = window, chosen = _bridgeOwnCoordinator();
    try {
      while (frame.parent && frame.parent !== frame) {
        frame = frame.parent;
        // Reading location enforces the actual same-origin boundary.
        frame.location.href;
        var api = frame.__CX_FORCE_PLAY && frame.__CX_FORCE_PLAY.toolkit && frame.__CX_FORCE_PLAY.toolkit.bridge;
        if (api && api._getCoordinator) chosen = api._getCoordinator();
      }
    } catch (e) { /* 跨域帧自行管理 */ }
    return chosen;
  }
  function _bridgeIdentity() { return String(window.location.href) + '|' + topHref(); }
  function _bridgeConfigIdentity() { return bridgeEnabledByConfig() + '|' + resolveBridgeBase(); }
  function _bridgeCancel(job) {
    if (!job || job.cancelled) return;
    job.cancelled = true;
    job.releases.slice().forEach(function (release) { release(); });
    job.releases = [];
    var index = _bridgeJobs.indexOf(job); if (index >= 0) _bridgeJobs.splice(index, 1);
  }
  function _bridgeFinish(job) {
    var index = _bridgeJobs.indexOf(job); if (index >= 0) _bridgeJobs.splice(index, 1);
  }
  function _bridgeContext(manual) {
    var coordinator = _bridgeSharedCoordinator(), generation = coordinator.generation();
    var job = { token: CoreState.capture('bridge'), identity: _bridgeIdentity(), config: _bridgeConfigIdentity(), coordinator: coordinator, releases: [], cancelled: false };
    job.valid = function () {
      return !job.cancelled && window.__CX_FORCE_PLAY === _bridgeOwner && CoreState.valid(job.token) &&
        job.identity === _bridgeIdentity() && coordinator.generation() === generation &&
        (manual || (bridgeEnabledByConfig() && job.config === _bridgeConfigIdentity()));
    };
    job.subscribe = function (release) {
      job.releases.push(release);
      return function () { var index = job.releases.indexOf(release); if (index >= 0) job.releases.splice(index, 1); };
    };
    _bridgeJobs.push(job);
    return job;
  }
  function _bridgeCancelAll() {
    _bridgeJobs.slice().forEach(_bridgeCancel);
    _bridgeSession = null; _bridgeProbeInFlight = false;
    _bridgeClearState();
  }
  function _bridgeClearState() {
    var hadTargets = !!(BRIDGE.chapter && BRIDGE.chapter.objectids && BRIDGE.chapter.objectids.length);
    BRIDGE.chapter = null; BRIDGE.skipResume = false; BRIDGE.version = null;
    // 只清本帧的派生白名单，再从仍有效的平台 attachments 重新建立。
    // 默认关闭且从未消费桥数据时，不能重置平台白名单的滞回/无命中计数。
    if (hadTargets && typeof TARGET !== 'undefined' && TARGET) {
      TARGET.ids = null; TARGET.keys = []; TARGET.enabled = false; TARGET.matchedAny = false;
      if (typeof _targetMissStreak !== 'undefined') _targetMissStreak = 0;
      if (CoreState.canRun()) bestEffort(function () { refreshTargets(); }, 'bridge.clearTargets');
    }
  }
  // 保留手动 probe 的并发契约：同帧第二次调用立即 cb(null)。
  function probeBridgeBase(cb) {
    if (typeof cb !== 'function') return;
    if (_bridgeProbeInFlight || !CoreState.canRun()) { cb(null); return; }
    var job = _bridgeContext(true);
    _bridgeProbeInFlight = job;
    job.coordinator.probe(job, null, true).then(function (result) {
      if (_bridgeProbeInFlight === job) _bridgeProbeInFlight = false;
      if (job.valid()) { if (result && result.version) BRIDGE.version = result.version; cb(result ? result.base : null); }
      _bridgeFinish(job);
    }).catch(function () { if (_bridgeProbeInFlight === job) _bridgeProbeInFlight = false; if (job.valid()) cb(null); _bridgeFinish(job); });
  }
  function restoreNativePause(root) {
    if (!root || !root.getElementsByTagName) return;
    bestEffort(function () {
      var vs = root.getElementsByTagName('video');
      for (var i = 0; i < vs.length; i++) { bestEffort(function (v) {
        var _nat = v[FLAGS.np] || (typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype.pause : null);
        if (_nat) v.pause = _nat;                                // 恢复实例级原生 pause（绕过原型 noop）；v.__np 缺失时回退原型真原生
        v[FLAGS.forcePaused] = false;                            // F-B2：关闭原型 pause/play/playbackRate 的 noop 拦截
        cxState(v).released = true;                                   // F-B6：标记已释放，续播兜底监听不再自动续播
        // 状态机优化(加载感知)：释放状态变化 → 显式置脏，下一 tick 全量扫描可重新接管（抵消播放稳态扫描降频延迟）
        if (typeof markDomDirty === 'function') markDomDirty();
      }.bind(null, vs[i]), 'bridge.restoreNativeVideo'); }
    }, 'bridge.restoreNative');
    bestEffort(function () {
      [].forEach.call(root.querySelectorAll('iframe'), function (f) {
        bestEffort(function () {
          // 已安装脚本的子帧消费自己的章状态，不能因父帧完成而释放另一未完成章。
          var child = f.contentWindow && f.contentWindow.__CX_FORCE_PLAY;
          if (f.contentDocument && !(child && child.toolkit && child.toolkit.bridge)) restoreNativePause(f.contentDocument);
        }, 'bridge.restoreIframe');
      });
    }, 'bridge.restoreIframes');
  }
  function validateBridgePlaylist(d) {
    if (!d || typeof d !== 'object') return null;
    if (!Array.isArray(d.chapters)) return null;
    var MAX = 5000;
    for (var i = 0; i < d.chapters.length; i++) {
      var c = d.chapters[i];
      if (!c || typeof c !== 'object') return null;
      // knowledgeId 必填且为纯数字（超星章节 ID）
      if (!/^\d{1,20}$/.test(String(c.knowledgeId))) return null;
      if (c.title != null && typeof c.title !== 'string') return null;
      if (c.completed != null && typeof c.completed !== 'boolean') return null;
      if (c.unfinishedCount != null && (typeof c.unfinishedCount !== 'number' || !isFinite(c.unfinishedCount))) return null;
      if (c.objectids != null) {
        if (!Array.isArray(c.objectids) || c.objectids.length > MAX) return null;
        for (var j = 0; j < c.objectids.length; j++) {
          var o = c.objectids[j];
          if (typeof o !== 'string' && typeof o !== 'number') return null;
        }
      }
      // 拒绝任何非超星域的绝对 URL 字段（防伪造 playlist 注入跨域跳转/点击）
      for (var k in c) {
        var v = c[k];
        if (typeof v === 'string' && (v.indexOf('http://') === 0 || v.indexOf('https://') === 0) && !_cxIsChaoxingHost(_urlHost(v))) return null;
      }
    }
    return d;
  }
  // 从绝对 URL 提取主机（用于 M1 校验中的同域判定）；非 URL 返回空串
  function _urlHost(url) {
    var i = url.indexOf('://');
    if (i < 0) return '';
    var rest = url.slice(i + 3);
    var m = /^([^/:#?]+)/i.exec(rest);
    return m ? m[1] : '';
  }
  function bridgeFetch(cid, kid, base, job) {
    return job.coordinator.request(base + '/playlist/' + encodeURIComponent(cid), job).then(function (data) {
      if (!job.valid()) return;
      var valid = validateBridgePlaylist(data);
      if (!valid) { dbg('bridge：清单校验失败，忽略桥数据'); return; }
      var chapter = null;
      for (var i = 0; i < valid.chapters.length; i++) {
        if (String(valid.chapters[i].knowledgeId) === String(kid)) { chapter = valid.chapters[i]; break; }
      }
      if (!job.valid()) return;
      BRIDGE.chapter = chapter;
      BRIDGE.skipResume = !!(chapter && chapter.completed && !(chapter.unfinishedCount > 0));
      if (BRIDGE.skipResume) bestEffort(function () { if (job.valid()) restoreNativePause(document); }, 'bridge.skipResume');
      if (job.valid()) bestEffort(function () { refreshTargets(); }, 'bridge.refreshTargets');
      if (job.valid() && typeof markDomDirty === 'function') markDomDirty();
    }).catch(function () { /* 桥不可达时回退本地逻辑；取消不产生任何落地副作用 */ });
  }
  function bridgeEnabledByConfig() {
    if (safeGet(function () { return localStorage.getItem(CX_KEYS.BRIDGE_OFF); }, null) === '1') return false;
    if (safeGet(function () { return /[?&]cxbridge=([^&]+)/i.test(window.location.search) || /[?&]cxbridge=([^&]+)/i.test(topHref()); }, false)) return true;
    return safeGet(function () { return localStorage.getItem(CX_KEYS.BRIDGE_ON); }, null) === '1';
  }
  function bridgeInit() {
    if (_bridgeStarting) return;
    if (!CoreState.canRun() || !bridgeEnabledByConfig()) { _bridgeCancelAll(); return; }
    if (_bridgeSession && _bridgeSession.valid() && Date.now() < _bridgeSession.refreshAt) return;
    if (_bridgeSession) _bridgeCancel(_bridgeSession);
    _bridgeClearState();
    _bridgeStarting = true;
    bestEffort(function () {
      var href = topHref(), ownHref = String(window.location.href);
      var cid = urlParam(ownHref, ['courseId']) || urlParam(href, ['courseId']);
      var kid = urlParam(ownHref, ['chapterId', 'knowledgeId']) || urlParam(href, ['chapterId', 'knowledgeId']);
      if (!cid || !kid) return;
      var base = resolveBridgeBase(), job = _bridgeContext(false);
      job.refreshAt = Date.now() + 60000;
      _bridgeSession = job;
      BRIDGE.base = base; BRIDGE.chapter = null; BRIDGE.skipResume = false;
      var first = bridgeFetch(cid, kid, base, job);
      var probe = job.coordinator.probe(job, base, false).then(function (result) {
        if (!job.valid() || !result) return;
        BRIDGE.base = result.base;
        if (result.version) BRIDGE.version = result.version;
        if (result.base !== base) return bridgeFetch(cid, kid, result.base, job);
      }).catch(function () {});
      Promise.all([first, probe]).then(function () { _bridgeFinish(job); });
    }, 'bridge.init');
    _bridgeStarting = false;
  }
  // Only the effective top loop walks this tree. Child clients keep their own
  // URL checks/session cooldown, so pushState is observed without new intervals.
  function syncBridgeFrames(root, depth) {
    root = root || window; depth = depth || 0;
    if (depth > CONST.MAX_SCAN_DEPTH) return;
    try {
      var ns = root.__CX_FORCE_PLAY;
      var api = ns && ns.toolkit && ns.toolkit.bridge;
      if (api && typeof api.bridgeInit === 'function') api.bridgeInit();
      for (var i = 0; i < root.frames.length; i++) {
        try { syncBridgeFrames(root.frames[i], depth + 1); } catch (e) { /* Cross-origin boundary. */ }
      }
    } catch (e) { /* Inaccessible frame: its own effective top loop manages it. */ }
  }
  bestEffort(function () {
    if (!window.__CX_FORCE_PLAY.toolkit) window.__CX_FORCE_PLAY.toolkit = {};
    window.__CX_FORCE_PLAY.toolkit.bridge = {
      probeBridgeBase: probeBridgeBase,
      bridgeInit: bridgeInit,
      bridgeEnabledByConfig: bridgeEnabledByConfig,
      validateBridgePlaylist: validateBridgePlaylist,
      probeState: function () { return _bridgeSharedCoordinator().state(); },
      _resetProbeGuard: function () { _bridgeCancelAll(); _bridgeSharedCoordinator().reset(); },
      _getCoordinator: _bridgeOwnCoordinator,
    };
  }, 'bridge.export');
  function _bridgeLocationChanged() { bridgeInit(); }
  function _bridgeStorageChanged(event) {
    if (event.key === CX_KEYS.BRIDGE_OFF || event.key === CX_KEYS.BRIDGE_ON || event.key === CX_KEYS.BRIDGE_BASE) bridgeInit();
  }
  window.addEventListener('popstate', _bridgeLocationChanged);
  window.addEventListener('hashchange', _bridgeLocationChanged);
  window.addEventListener('storage', _bridgeStorageChanged);
  var _bridgeOffCancel = CoreState.onCancel('bridge', _bridgeCancelAll);
  var _bridgeOffChange = CoreState.onChange(function (view) {
    if (view.state === 'RUNNING') bridgeInit();
    else if (view.state === 'DISPOSED') {
      window.removeEventListener('popstate', _bridgeLocationChanged);
      window.removeEventListener('hashchange', _bridgeLocationChanged);
      window.removeEventListener('storage', _bridgeStorageChanged);
      _bridgeOffCancel(); _bridgeOffChange();
    }
  });
