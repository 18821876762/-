// @provides: ENDED_SRCS, videoDriftStableKeys, videoSrcOf
// @requires: CONST, TARGET, bestEffort, cxState, safeGet
  // ===== DOMAIN: takeover/engine/dedup (replay hardening / dedup) =====
  // ===== MODULE: 重播加固(去重) =====
  // 域：核心业务模块 —— 重播加固(去重)。
  // ===== 重播加固：用 currentSrc 去重"已播完任务的整元素重建" =====
  // 平台跳课时可能销毁旧 video 并以全新元素重建同一已播完视频（src 相同），旧 __cxEndedLock 失效 → 误续播。
  // 故：ended 锁定时登记其 currentSrc；任何"非 ended、地址命中已结束集合"的新 video = 同一任务点重建 → 锁死不播。
  var ENDED_SRCS = {};
  // 已结束 src 上限已集中到 CONST（元配置集中层）
  function _endedPrune() {
    bestEffort(function () {
      var _ks = Object.keys(ENDED_SRCS);
      if (_ks.length > CONST.ENDED_SRCS_CAP) {
        var _drop = _ks.length - CONST.ENDED_SRCS_CAP;
        for (var _p = 0; _p < _drop; _p++) delete ENDED_SRCS[_ks[_p]];   // 淘汰最旧指纹（Object.keys 按插入序，最旧在前）
      }
    }, '_endedPrune');
  }
  function _markEnded(src) { if (!src) return; bestEffort(function () { ENDED_SRCS[src] = true; }, 'markEnded'); }
  function videoSrcOf(v) {
    return safeGet(function () { return v.currentSrc || v.src || ''; }, '');
  }
  // 收集 video 祖先 iframe 的"可定位签名"：平台常把同一任务点视频放在固定签名(通常含任务 id)的 iframe 内重建。
  // #2 修复：旧实现只取 iframe.src，但①src 常为通用播放器地址(不含任务 id，被漏收)；
  //         ②视频走 MSE 后 currentSrc 是 blob: URL，根本不含 objectid → ENDED_SRCS 拿不到指纹。
  //         故扩展收集 iframe 的 id/name/title/data-* 以及 video 自身 id——这些在"整元素重建/ blob: 源"场景下
  //         仍稳定携带任务 id，可被 keyRe 边界匹配命中，重建去重得以成立（即时 src 是 blob: 也照样锁死）。
  // 收敛不变（吸收评审 B）：仅返回"签名含白名单任务 id"的播放器 iframe，排除通用 shell。
  function signatureOf(el) {
    var out = [];
    bestEffort(function () {
      if (el.id) out.push(el.id);
      if (el.name) out.push(el.name);
      if (el.title) out.push(el.title);
      if (el.getAttribute) {
        var d = el.getAttribute('data'); if (d) out.push(d);
        // 常见 data-taskid / data-objectid / data-id 等
        var attrs = el.attributes;
        if (attrs) { for (var a = 0; a < attrs.length; a++) { var an = attrs[a].name; if (an.indexOf('data-') === 0) out.push(attrs[a].value); } }
      }
    }, 'signatureOf');
    return out;
  }
  function videoIframeSrcsOf(v) {
    var out = [];
    if (!TARGET.enabled || !TARGET.ids) return out;
    var idKeys = TARGET.keys || Object.keys(TARGET.ids);   // 评审#2：优先用缓存 key 数组
    if (!idKeys.length) return out;
    // 性能修复(卡顿排查)：签名命中判定复用 targeting.js 的组合正则（O(键数) → O(1) test），
    // 超长回退逐键 keyRe。该函数被 _ovDriftGuard 每 tick 每视频调用（祖先链 × 键数原为热路径）。
    function _sigHits(sig) {
      if (!sig) return false;
      if (typeof keyReAll === 'function') {
        var _reAll = keyReAll(idKeys);
        if (_reAll) return _reAll.test(sig);
      }
      for (var _i = 0; _i < idKeys.length; _i++) { if (keyRe(idKeys[_i]).test(sig)) return true; }
      return false;
    }
    bestEffort(function () {
      if (v.id) {                              // video 自身 id 也纳入指纹（部分播放器直接挂任务 id）
        if (_sigHits(v.id)) out.push(v.id);
      }
      // 修复复审#2：宿主 iframe 签名（下钻时传入）直接并入指纹，覆盖 iframe 内视频 parentElement 链够不到父文档 iframe 的死代码
      var _hs = cxState(v).hostSigs;
      if (_hs && _hs.length) {
        for (var _hsi = 0; _hsi < _hs.length; _hsi++) {
          var _hsig = _hs[_hsi];
          if (_hsig && _sigHits(_hsig)) out.push(_hsig);
        }
      }
      var el = v, _depth = 0;
      while (el && el.parentElement && _depth++ < CONST.MAX_SCAN_DEPTH) {   // 深度上限守卫：避免播放器 shell 自父化导致死循环，并限制每轮遍历成本
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          bestEffort(function () {
            var sigs = signatureOf(el);
            for (var si = 0; si < sigs.length; si++) {
              if (_sigHits(sigs[si])) out.push(sigs[si]);
            }
          }, 'iframeSig');
        }
      }
    }, 'videoIframeSrcsOf');
    return out;
  }
  // v4.19.17 修复·进度漂移守卫稳定键：独立于「定向(TARGET)」开关的每视频稳定进度指纹。
  // 问题：当 定向 关闭时 videoIframeSrcsOf 返回 []，漂移守卫的 keys 只剩 videoSrcOf(v)（MSE 播放器为易变的 blob: URL）。
  // 平台防挂机「重建 <video> 元素 / 重新生成 blob src」时 blob 变化 → 旧进度 _srcMaxTime 被整组删除(dom.js:159-164) →
  // 新元素进度从 0 重新累计 → 视频反复跳回开头重播（用户报「同一视频从头反复播」循环，且 LOOP_PLAY=false）。
  // 修复：额外附加「不依赖定向的稳定键」(video 自身 id + 最近一层宿主 iframe 的稳定 src/id)，该键在元素重建 / blob 重生后仍不变，
  // 使 _srcMaxTime 跨重建存活 → 回拨守卫能正确 seek 回 max → 打破循环。
  function videoDriftStableKeys(v) {
    var out = [];
    bestEffort(function () {
      if (v.id) out.push('v:' + v.id);                       // 视频自身稳定 id（部分播放器直接挂任务 id）
      var el = v, _depth = 0;
      while (el && el.parentElement && _depth++ < CONST.MAX_SCAN_DEPTH) {
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          // 只取最近一层宿主 iframe（任务点视频通常只嵌一层）；优先用 src（播放器地址通常稳定），其次 id/name/title
          var sig = (el.src && String(el.src).indexOf('blob:') !== 0) ? el.src : (el.id || el.name || el.title || '');
          if (sig) out.push('f:' + sig);
          break;
        }
      }
    }, 'videoDriftStableKeys');
    return out;
  }
  function isRebuildFinished(v) {
    var s = videoSrcOf(v);
    if (s && ENDED_SRCS[s]) return true;
    var iss = videoIframeSrcsOf(v);
    for (var i = 0; i < iss.length; i++) { if (iss[i] && ENDED_SRCS[iss[i]]) return true; }
    return false;
  }
