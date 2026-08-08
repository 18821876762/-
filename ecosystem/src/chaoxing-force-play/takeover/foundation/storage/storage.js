  // ===== 存储与 API 通讯 =====
  // 面板配置持久化（localStorage: cx_panel_cfg）。爬虫桥的 fetch 类 API 通讯仍在其业务模块(bridge)，
  // 此处集中「本地存储」基础能力；后续看播统计等本地存储也可统一收口到此。

  // 依赖无关 KVS：异步优先的键值存储，作为 localStorage→IndexedDB 迁移的底座。
  //   backend = 'local'（默认）：同步 localStorage，行为零变化；
  //   backend = 'indexeddb'：异步 IndexedDB（更大配额、worker 友好），不可用时自动回退 localStorage。
  // 通过 CONFIG.KVS_BACKEND 切换；暴露 kvs.get/set/del/ready/backend。
  var KVS = (function () {
    function backendName() {
      try { return (typeof CONFIG !== 'undefined' && CONFIG.KVS_BACKEND) || 'local'; } catch (e) { return 'local'; }
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
    var idb = null;
    function hasIDB() {
      try { return backendName() === 'indexeddb' && typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; }
    }
    function initIDB() {
      return new Promise(function (resolve) {
        if (!hasIDB()) { resolve(false); return; }
        try {
          var req = indexedDB.open('cx_kvs', 1);
          req.onupgradeneeded = function () { try { req.result.createObjectStore('kv'); } catch (e) {} };
          req.onsuccess = function () { idb = req.result; resolve(true); };
          req.onerror = function () { resolve(false); };
          req.onblocked = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }
    var _ready = (backendName() === 'indexeddb') ? initIDB() : Promise.resolve(false);
    function get(k) {
      if (backendName() !== 'indexeddb') return Promise.resolve(lsGet(k));
      return _ready.then(function (ok) {
        if (!ok) return lsGet(k);
        return new Promise(function (resolve) {
          try {
            var tx = idb.transaction('kv', 'readonly');
            var rq = tx.objectStore('kv').get(k);
            rq.onsuccess = function () { resolve(rq.result == null ? null : String(rq.result)); };
            rq.onerror = function () { resolve(lsGet(k)); };
          } catch (e) { resolve(lsGet(k)); }
        });
      });
    }
    function set(k, v) {
      var val = String(v);
      if (backendName() !== 'indexeddb') { lsSet(k, val); return Promise.resolve(); }
      return _ready.then(function (ok) {
        if (!ok) { lsSet(k, val); return; }
        try { var tx = idb.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, k); }
        catch (e) { lsSet(k, val); }
      });
    }
    function del(k) {
      if (backendName() !== 'indexeddb') { lsDel(k); return Promise.resolve(); }
      return _ready.then(function (ok) { if (!ok) { lsDel(k); return; } try { var tx = idb.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); } catch (e) { lsDel(k); } });
    }
    return { get: get, set: set, del: del, ready: _ready, backend: backendName };
  })();

  function clampCfg() {                            // 载入后把越界值夹回面板控件允许范围
    CONFIG.AUTO_STOP_MIN = Math.max(0, Math.min(120, +CONFIG.AUTO_STOP_MIN || 0));
    CONFIG.RESUME_AFTER_MIN = Math.max(0, Math.min(60, +CONFIG.RESUME_AFTER_MIN || 0));
    CONFIG.RESCAN_INTERVAL = Math.max(500, Math.min(5000, +CONFIG.RESCAN_INTERVAL || 2000));
    CONFIG.END_RELEASE_SEC = Math.max(0, Math.min(120, +CONFIG.END_RELEASE_SEC || 0));
    CONFIG.USER_RATE = Math.max(0.25, Math.min(4, +CONFIG.USER_RATE || 1));
    CONFIG.PANEL_W = Math.max(288, Math.min(760, +CONFIG.PANEL_W || 380));
    if (CONFIG.INTRUSION_MODE !== 'gentle' && CONFIG.INTRUSION_MODE !== 'aggressive') CONFIG.INTRUSION_MODE = 'auto';
    CONFIG.POLITE_MODE = !!CONFIG.POLITE_MODE;
    DEBUG = !!DEBUG;
  }
  function savePanelCfg() {
    try {
      localStorage.setItem('cx_panel_cfg', JSON.stringify({
        AUTO_STOP_MIN: CONFIG.AUTO_STOP_MIN,
        RESUME_AFTER_MIN: CONFIG.RESUME_AFTER_MIN,
        RESCAN_INTERVAL: CONFIG.RESCAN_INTERVAL,
        END_RELEASE_SEC: CONFIG.END_RELEASE_SEC,
        USER_RATE: CONFIG.USER_RATE,
        DEBUG: DEBUG,
        LOOP_PLAY: CONFIG.LOOP_PLAY,
        SINGLE_VIDEO: CONFIG.SINGLE_VIDEO,
        NINJA_MODE: CONFIG.NINJA_MODE,
        PANEL_W: CONFIG.PANEL_W,
        PANEL_POS: CONFIG.PANEL_POS,
        INTRUSION_MODE: CONFIG.INTRUSION_MODE,
        POLITE_MODE: CONFIG.POLITE_MODE
      }));
    } catch (e) { swallow(e); }
  }
  function loadPanelCfg() {
    try {
      var s = localStorage.getItem('cx_panel_cfg');
      if (!s) return;
      var o = JSON.parse(s) || {};
      if (typeof o.AUTO_STOP_MIN === 'number') CONFIG.AUTO_STOP_MIN = o.AUTO_STOP_MIN;
      if (typeof o.RESUME_AFTER_MIN === 'number') CONFIG.RESUME_AFTER_MIN = o.RESUME_AFTER_MIN;
      if (typeof o.RESCAN_INTERVAL === 'number') CONFIG.RESCAN_INTERVAL = o.RESCAN_INTERVAL;
      if (typeof o.END_RELEASE_SEC === 'number') CONFIG.END_RELEASE_SEC = o.END_RELEASE_SEC;
      if (typeof o.USER_RATE === 'number') CONFIG.USER_RATE = o.USER_RATE;
      if (typeof o.DEBUG === 'boolean') DEBUG = o.DEBUG;
      if (typeof o.LOOP_PLAY === 'boolean') CONFIG.LOOP_PLAY = o.LOOP_PLAY;
      if (typeof o.SINGLE_VIDEO === 'boolean') CONFIG.SINGLE_VIDEO = o.SINGLE_VIDEO;
      if (typeof o.NINJA_MODE === 'boolean') CONFIG.NINJA_MODE = o.NINJA_MODE;
      if (typeof o.PANEL_W === 'number') CONFIG.PANEL_W = o.PANEL_W;
      if (o.PANEL_POS && typeof o.PANEL_POS.x === 'number' && typeof o.PANEL_POS.y === 'number') CONFIG.PANEL_POS = o.PANEL_POS;
      if (o.INTRUSION_MODE === 'gentle' || o.INTRUSION_MODE === 'aggressive' || o.INTRUSION_MODE === 'auto') CONFIG.INTRUSION_MODE = o.INTRUSION_MODE;
      if (typeof o.POLITE_MODE === 'boolean') CONFIG.POLITE_MODE = o.POLITE_MODE;
      clampCfg();
    } catch (e) { swallow(e); }
  }

  // 暴露 KVS 异步存储底座（IndexedDB 就绪/回退由 backend() 决定）
  try { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.kvs = KVS; } catch (e) {}
