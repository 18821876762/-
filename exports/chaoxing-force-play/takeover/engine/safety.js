// @provides: SAFETY
// @requires: CONFIG, CONST, CoreState, EventBus, allVideos, bestEffort, isEffectiveTopFrame, markDomDirty, reconcileIntrusionMode, releaseVideo, safeGet
  // ==========================================================================
  // 安全停机（fail-safe）：检测到验证码 / 风控验证时，立即停止全部自动化并提示用户。
  //
  // 设计取向（与"压在触发阈值之下继续运行"相反）：
  //   继续伪装运行，风险会从"被识别"升级为"被判定作弊/账号受限"；
  //   停机并交还控制权后由真人完成验证，对账号与课程进度都最安全。
  //   故本模块选择 fail-safe（停机 + 醒目提示），不做任何绕过验证的行为。
  //
  // 停机动作（交还控制权，且保留面板以便用户看到提示）：
  //   ① 停主循环（停止扫描/续播/漂移守卫/答题轮训）
  //   ② 释放所有视频（恢复实例级原生 pause、关闭强制续播闸门）
  //   ③ 还原原型中性化（pause / playbackRate 完整交还平台）
  //   ④ 面板 toast 告警（warn 级）+ 自检矩阵置告警
  //
  // 恢复：默认需人工确认——刷新页面，或调用 window.__CX_FORCE_PLAY.safetyResume()。
  //   SAFETY_AUTO_RESUME 为预留开关（默认 false，不自动恢复）。
  // ==========================================================================
  var SAFETY = { tripped: false, reason: '', at: 0 };

  function safetyReset() { SAFETY.tripped = false; SAFETY.reason = ''; SAFETY.at = 0; }

  // 可见性判定：过滤掉常驻但隐藏的容器，避免误停机。
  // 判定不了时按"可见"处理——宁可误停机，也不冒险继续自动化。
  function safetyVisible(el) {
    try {
      var vw = (el.ownerDocument && el.ownerDocument.defaultView) ? el.ownerDocument.defaultView : null;
      if (!vw || !vw.getComputedStyle) return true;
      // visibility 会继承，但子元素显式 visible 可以覆盖祖先 hidden；
      // display:none / opacity:0 则无法由子元素覆盖，必须检查整条祖先链。
      var painted = function (node) {
        var st = vw.getComputedStyle(node);
        if (!st) return true;
        if (st.visibility === 'hidden' || st.visibility === 'collapse') return false;
        for (var cur = node; cur && cur.nodeType === 1; cur = cur.parentElement) {
          var cs = cur === node ? st : vw.getComputedStyle(cur);
          if (!cs) return true;
          if (cs.display === 'none' || (cs.opacity !== '' && Number(cs.opacity) === 0)) return false;
        }
        return true;
      };
      if (painted(el)) return true;
      var own = vw.getComputedStyle(el);
      if (!own || (own.visibility !== 'hidden' && own.visibility !== 'collapse')) return false;
      // 隐藏的验证容器仍可能承载显式可见的验证子控件。
      var children = el.querySelectorAll('*');
      for (var i = 0; i < children.length; i++) { if (painted(children[i])) return true; }
      return false;
    } catch (e) { /* 跨域/异常：按可见处理 */ }
    return true;
  }

  // 检测：选择器优先（廉价），其次在「弹层/浮层」候选容器内做关键词匹配
  // （限定容器而非整页 innerText，避免每次 tick 触发布局重算）。
  function safetyDetect(rootDoc) {
    rootDoc = rootDoc || document;
    var sels = CONFIG.SAFETY_CHALLENGE_SELECTORS || [];
    for (var i = 0; i < sels.length; i++) {
      var matches = [];
      try { matches = rootDoc.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var n = 0; n < matches.length; n++) {
        if (safetyVisible(matches[n])) return '验证控件（' + sels[i] + '）';
      }
    }
    var kws = CONFIG.SAFETY_CHALLENGE_KEYWORDS || [];
    if (!kws.length) return '';
    var cands = [];
    try {
      cands = rootDoc.querySelectorAll(
        '.el-dialog, .ant-modal, .modal, .popup, .layui-layer, [class*=verify], [class*=captcha], [class*=slider], [id*=verify], [id*=captcha]'
      );
    } catch (e) { return ''; }
    for (var j = 0; j < cands.length; j++) {
      if (!safetyVisible(cands[j])) continue;
      var t = '';
      // 真浏览器的空 innerText 表示没有可见文字，不能再用隐藏 textContent 命中。
      try { t = typeof cands[j].innerText === 'string' ? cands[j].innerText : (cands[j].textContent || ''); } catch (e2) { continue; }
      if (!t) continue;
      for (var k = 0; k < kws.length; k++) {
        if (t.indexOf(kws[k]) >= 0) return '验证提示「' + kws[k] + '」';
      }
    }
    return '';
  }

  // 每 tick 调用；停机后不再扫描（等人工恢复），避免重复提示。
  function safetyScan() {
    if (SAFETY.tripped) return;
    if (!CONFIG.SAFETY_STOP_ON_CHALLENGE) return;
    // 有效顶层负责同源播放器子帧的巡检；子帧无需各自再开主循环。
    function scan(doc, depth) {
      var hit = safetyDetect(doc);
      if (hit || depth >= CONST.MAX_SCAN_DEPTH) return hit;
      var frames = doc.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        try { var child = frames[i].contentDocument; if (child) { hit = scan(child, depth + 1); if (hit) return hit; } } catch (e) {}
      }
      return '';
    }
    var hit = safeGet(function () { return scan(document, 0); }, '');
    if (hit) safetyTrip(hit);
  }

  // 停机：交还控制权 + 醒目提示
  function safetyTrip(reason) {
    if (SAFETY.tripped) return;
    SAFETY.tripped = true; SAFETY.reason = reason || '未指明原因'; SAFETY.at = Date.now();
    CoreState.canRun();

    // ① 停主循环
    bestEffort(function () { if (typeof stopLoopTimer === 'function') stopLoopTimer(); }, 'safety.stopLoop');
    // ② 释放所有视频：恢复实例级原生 pause、关闭强制续播闸门
    bestEffort(function () {
      var vs = (typeof allVideos === 'function') ? allVideos(true) : [];
      for (var i = 0; i < vs.length; i++) { if (typeof releaseVideo === 'function') releaseVideo(vs[i]); }
    }, 'safety.release');
    // ③ 还原原型中性化：pause / playbackRate 控制权完整交还平台
    bestEffort(function () {
      if (typeof restorePrototypeNeutralization === 'function') restorePrototypeNeutralization();
    }, 'safety.restoreProto');
    // ④ 面板告警（warn 级）
    bestEffort(function () {
      if (typeof EventBus !== 'undefined' && EventBus.emit) {
        EventBus.emit('ui:toast', '⛔ 检测到' + SAFETY.reason + '，已停止全部自动化（续播/答题）。请人工完成验证后刷新页面，或执行 __CX_FORCE_PLAY.safetyResume()', 'warn');
      }
    }, 'safety.toast');
  }

  // 人工恢复：按 INTRUSION_MODE 重装原型中性化，并重启主循环（下轮扫描会重新接管视频）
  function safetyResume() {
    if (!SAFETY.tripped) return false;
    safetyReset();
    CoreState.canRun();
    bestEffort(function () { if (typeof reconcileIntrusionMode === 'function') reconcileIntrusionMode(); }, 'safety.resume.reconcile');
    bestEffort(function () { if (typeof markDomDirty === 'function') markDomDirty(); }, 'safety.resume.dirty');
    bestEffort(function () {
      if (typeof restartLoopTimer === 'function' && typeof isEffectiveTopFrame === 'function' && isEffectiveTopFrame()) restartLoopTimer();
    }, 'safety.resume.loop');
    bestEffort(function () {
      if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('ui:toast', '已恢复自动化运行', 'success');
    }, 'safety.resume.toast');
    return true;
  }

  bestEffort(function () {
    if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};
    var _sn = window.__CX_FORCE_PLAY;
    _sn.SAFETY = SAFETY;
    _sn.safetyScan = safetyScan;
    _sn.safetyTrip = safetyTrip;
    _sn.safetyResume = safetyResume;
    _sn.safetyDetect = safetyDetect;
  }, 'safety.ns');
