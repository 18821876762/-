// @requires: CX_KEYS, EventBus, bestEffort
// ===== MODULE: 统一数据治理（数据生命周期注册表）=====
// 覆盖脚本运行时产生的所有本地数据：内存缓存(session)/GM 中继(relay)/localStorage 统计(stats)/
// 持久配置(config, 受保护)/IndexedDB(indexeddb, 预留)/指纹命名空间(fp, 预留)。
// 各业务模块把自己持有的「可治理数据桶」注册进本注册表，由统一策略决定何时出清(事件/周期/命令)，
// 避免出清逻辑散落各模块(原 quiz 缓存出清仅覆盖答题态)。诊断可一处查看所有桶大小与最近出清。
// v4.19.30
var DataGov = (function () {
  var CAT = { CONFIG: 'config', SESSION: 'session', RELAY: 'relay', STATS: 'stats', INDEXEDDB: 'indexeddb', FP: 'fp' };
  var _buckets = {};   // id -> {id, category, desc, size, evict, protected, lastEvict}
  function _gmSet(k, v) { try { if (typeof GM_setValue === 'function') GM_setValue(k, v); } catch (e) {} }
  function _gmGet(k) { try { return (typeof GM_getValue === 'function') ? GM_getValue(k, '') : ''; } catch (e) { return ''; } }
  function _safeSize(bk) { try { return (bk.size ? (bk.size() || 0) : 0); } catch (e) { return 0; } }

  // 注册一个数据桶；size()/evict(reason) 可选；protected=true 的桶 evict 恒跳过
  function registerBucket(b) {
    if (!b || !b.id || !b.category) return false;
    _buckets[b.id] = {
      id: b.id, category: b.category, desc: b.desc || '',
      size: (typeof b.size === 'function') ? b.size : function () { return 0; },
      evict: (typeof b.evict === 'function') ? b.evict : null,
      protected: !!b.protected, lastEvict: null
    };
    return true;
  }
  function unregister(id) { delete _buckets[id]; }

  // categories: 数组(如 ['session','relay']) 过滤；空数组=全部非受保护桶。protected 桶恒跳过（即便传 '*'）。
  function evict(categories, reason) {
    reason = reason || 'manual';
    if (categories === '*') categories = [];
    var _cats = (categories && categories.length) ? categories : null;
    var _total = 0;
    for (var id in _buckets) {
      if (!_buckets.hasOwnProperty(id)) continue;
      var bk = _buckets[id];
      if (bk.protected) continue;                                  // 受保护桶(配置)跳过
      if (_cats && _cats.indexOf(bk.category) < 0) continue;        // 分类过滤
      if (!bk.evict) continue;
      try {
        var _before = _safeSize(bk);
        bk.evict(reason);
        var _after = _safeSize(bk);
        var _cleared = (_before > _after) ? (_before - _after) : 0;
        bk.lastEvict = { reason: reason, ts: Date.now(), cleared: _cleared };
        _total += _cleared;
        if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('dataGov:evict', { id: bk.id, category: bk.category, cleared: _cleared, reason: reason });
      } catch (e) {}
    }
    return _total;
  }
  function evictAll(reason) { return evict([], reason); }   // 全部非受保护

  function snapshot() {
    var out = [];
    for (var id in _buckets) {
      if (!_buckets.hasOwnProperty(id)) continue;
      var bk = _buckets[id];
      out.push({ id: bk.id, category: bk.category, desc: bk.desc, size: _safeSize(bk), protected: bk.protected, lastEvict: bk.lastEvict });
    }
    return out;
  }

  // —— 内置桶：relay（GM 存储中继）——
  // cx_ds_ask_v1(含截图 base64 大值)：出清时强制清空释放大字符串；
  // cx_quiz_lights_v1(灯镜像)：出清时清空；
  // cx_ds_bridge_v1(心跳态)：保留(决定 DS_STATUS.connected，误清会断连)。
  var RELAY_KEYS = { ask: 'cx_ds_ask_v1', lights: 'cx_quiz_lights_v1' };
  registerBucket({
    id: 'relay-gm', category: CAT.RELAY, desc: 'GM 存储中继(cx_ds_ask_v1 答题大图 / cx_quiz_lights_v1 灯镜像)',
    size: function () { return ('' + _gmGet(RELAY_KEYS.ask)).length + ('' + _gmGet(RELAY_KEYS.lights)).length; },
    evict: function () { _gmSet(RELAY_KEYS.ask, ''); _gmSet(RELAY_KEYS.lights, ''); }
  });
  // —— 内置桶：stats（localStorage 统计/收藏/位置，非配置）——
  var STATS_KEYS = ['cx_watch_stats', 'cx_cmd_fav', 'cx_cmd_recent', 'cx_ninja_pos', 'cx_quiet_popups'];
  registerBucket({
    id: 'stats-ls', category: CAT.STATS, desc: 'localStorage 统计/命令收藏/面板位置',
    size: function () { var n = 0; for (var i = 0; i < STATS_KEYS.length; i++) { try { if (localStorage.getItem(STATS_KEYS[i]) != null) n++; } catch (e) {} } return n; },
    evict: function () { for (var i = 0; i < STATS_KEYS.length; i++) { try { localStorage.removeItem(STATS_KEYS[i]); } catch (e) {} } }
  });
  // —— 内置桶：config（受保护，仅快照展示，evict 跳过）——
  registerBucket({
    id: 'config-ls', category: CAT.CONFIG, desc: 'localStorage 用户配置(cx_* 配置类 + 题库)', protected: true,
    size: function () { var n = 0; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('cx_') === 0) n++; } } catch (e) {} return n; },
    evict: function () {}
  });
  // —— 内置桶：indexeddb（cx_kvs，当前无业务写入，预留）——
  registerBucket({
    id: 'kvs-idb', category: CAT.INDEXEDDB, desc: 'IndexedDB 库 cx_kvs(题库/指纹结构化)',
    size: function () { return 0; },
    evict: function () { try { if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) indexedDB.deleteDatabase('cx_kvs'); } catch (e) {} }
  });
  // —— 内置桶：fp（cx_fp_ 命名空间，当前无业务写入，预留）——
  registerBucket({
    id: 'fp-ls', category: CAT.FP, desc: 'localStorage 指纹命名空间 cx_fp_',
    size: function () { var n = 0; try { var pre = CX_KEYS.FP_NS; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(pre) === 0) n++; } } catch (e) {} return n; },
    evict: function () { try { var pre = CX_KEYS.FP_NS; var toDel = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(pre) === 0) toDel.push(k); } for (var j = 0; j < toDel.length; j++) localStorage.removeItem(toDel[j]); } catch (e) {} }
  });

  // 暴露公开 API
  bestEffort(function () {
    if (typeof window !== 'undefined') {
      window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
      window.__CX_FORCE_PLAY.dataGovernance = { CAT: CAT, registerBucket: registerBucket, unregister: unregister, evict: evict, evictAll: evictAll, snapshot: snapshot };
    }
  }, 'dataGov.export');
  return { CAT: CAT, registerBucket: registerBucket, unregister: unregister, evict: evict, evictAll: evictAll, snapshot: snapshot };
})();
