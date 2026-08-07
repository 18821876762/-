  // ===== DOMAIN: takeover/engine/dedup (replay hardening / dedup) =====
  // ===== MODULE: 重播加固(去重) =====
  // 域：核心业务模块 —— 重播加固(去重)。
  // ===== 重播加固：用 currentSrc 去重"已播完任务的整元素重建" =====
  // 平台跳课时可能销毁旧 video 并以全新元素重建同一已播完视频（src 相同），旧 __cxEndedLock 失效 → 误续播。
  // 故：ended 锁定时登记其 currentSrc；任何"非 ended、地址命中已结束集合"的新 video = 同一任务点重建 → 锁死不播。
  var ENDED_SRCS = {};
  // 已结束 src 上限已集中到 CONST（元配置集中层）
  function _endedPrune() {
    try {
      var _ks = Object.keys(ENDED_SRCS);
      if (_ks.length > CONST.ENDED_SRCS_CAP) {
        var _drop = _ks.length - CONST.ENDED_SRCS_CAP;
        for (var _p = 0; _p < _drop; _p++) delete ENDED_SRCS[_ks[_p]];   // 淘汰最旧指纹（Object.keys 按插入序，最旧在前）
      }
    } catch (e) { swallow(e); }
  }
  function _markEnded(src) { if (!src) return; try { ENDED_SRCS[src] = true; } catch (e) { swallow(e); } }
  function videoSrcOf(v) {
    try { return v.currentSrc || v.src || ''; } catch (e) { return ''; }
  }
  // 收集 video 祖先 iframe 的"可定位签名"：平台常把同一任务点视频放在固定签名(通常含任务 id)的 iframe 内重建。
  // #2 修复：旧实现只取 iframe.src，但①src 常为通用播放器地址(不含任务 id，被漏收)；
  //         ②视频走 MSE 后 currentSrc 是 blob: URL，根本不含 objectid → ENDED_SRCS 拿不到指纹。
  //         故扩展收集 iframe 的 id/name/title/data-* 以及 video 自身 id——这些在"整元素重建/ blob: 源"场景下
  //         仍稳定携带任务 id，可被 keyRe 边界匹配命中，重建去重得以成立（即时 src 是 blob: 也照样锁死）。
  // 收敛不变（吸收评审 B）：仅返回"签名含白名单任务 id"的播放器 iframe，排除通用 shell。
  function signatureOf(el) {
    var out = [];
    try {
      if (el.id) out.push(el.id);
      if (el.name) out.push(el.name);
      if (el.title) out.push(el.title);
      if (el.getAttribute) {
        var d = el.getAttribute('data'); if (d) out.push(d);
        // 常见 data-taskid / data-objectid / data-id 等
        var attrs = el.attributes;
        if (attrs) { for (var a = 0; a < attrs.length; a++) { var an = attrs[a].name; if (an.indexOf('data-') === 0) out.push(attrs[a].value); } }
      }
    } catch (e) { swallow(e); }
    return out;
  }
  function videoIframeSrcsOf(v) {
    var out = [];
    if (!TARGET.enabled || !TARGET.ids) return out;
    var idKeys = TARGET.keys || Object.keys(TARGET.ids);   // 评审#2：优先用缓存 key 数组
    if (!idKeys.length) return out;
    try {
      if (v.id) {                              // video 自身 id 也纳入指纹（部分播放器直接挂任务 id）
        for (var vi = 0; vi < idKeys.length; vi++) { if (keyRe(idKeys[vi]).test(v.id)) { out.push(v.id); break; } }
      }
      // 修复复审#2：宿主 iframe 签名（下钻时传入）直接并入指纹，覆盖 iframe 内视频 parentElement 链够不到父文档 iframe 的死代码
      var _hs = cxState(v).hostSigs;
      if (_hs && _hs.length) {
        for (var _hsi = 0; _hsi < _hs.length; _hsi++) {
          var _hsig = _hs[_hsi];
          if (_hsig) { for (var _i2 = 0; _i2 < idKeys.length; _i2++) { if (keyRe(idKeys[_i2]).test(_hsig)) { out.push(_hsig); break; } } }
        }
      }
      var el = v;
      while (el && el.parentElement) {
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          try {
            var sigs = signatureOf(el);
            for (var si = 0; si < sigs.length; si++) {
              var sig = sigs[si];
              if (sig) { for (var i = 0; i < idKeys.length; i++) { if (keyRe(idKeys[i]).test(sig)) { out.push(sig); break; } } }
            }
          } catch (e) { swallow(e); }
        }
      }
    } catch (e) { swallow(e); }
    return out;
  }
  function isRebuildFinished(v) {
    var s = videoSrcOf(v);
    if (s && ENDED_SRCS[s]) return true;
    var iss = videoIframeSrcsOf(v);
    for (var i = 0; i < iss.length; i++) { if (iss[i] && ENDED_SRCS[iss[i]]) return true; }
    return false;
  }
