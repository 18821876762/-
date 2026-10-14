// @provides: _quizSyncLights
// @requires: EventBus, _quizAIFailed, _quizAIPending, _quizAIProblems, _quizDsGraceUntil, _quizFillItems, _quizHandled, _quizInfoMissing, _quizLastAnswered, _quizLastScanned, _quizLastTickErr, _quizLightFp, _quizLights, _quizManualHold, _quizPendingSubmit, _quizQuestionSettled, _quizRemoteOrder, _quizRemoteState, _quizReviewItems, _quizSkipCounts, _quizVisTimers, bestEffort, detectSite, dsAvailable, swallow
// @source-group: takeover/engine/quiz.js
// 职责：题目状态灯与跨帧合并；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
function _quizSyncLights() {
  bestEffort(function () {
    if (_quizLights.length > _QUIZ_LIGHTS_CAP) {
      var _drop = _quizLights.length - _QUIZ_LIGHTS_CAP;
      for (var _d = 0; _d < _drop; _d++) {
        if (_quizLights[_d].state !== 'busy') {
          if (!_quizLights[_d].remote) delete _quizLightFp[_quizLights[_d].fp];   // 远程灯无本地登记，不删 _quizLightFp
          _quizLights.splice(_d, 1); _d--; _drop--;
        }
      }
    }
    for (var i = 0; i < _quizLights.length; i++) {
      var l = _quizLights[i];
      if (l.remote) continue;   // 跨帧信号灯：状态由来源帧广播维持，本地不推导（fp 不在本地答题状态表）
      var fp = l.fp;
      var st = 'idle'; var _kind = null;
      // v4.19.35 状态推导修复（用户实测）：① 红灯后成功作答不变绿——`_quizAIProblems`（失败登记）从未在
      // 成功时清除，红恒优先于绿；② 红占紫位——曾失败、现处于 DS 宽限（暂时受阻）重试等待的题显示红而非紫。
      // 修复：红仅在「未作答」时生效，且宽限窗口内让位于紫；已作答 + 历史失败登记 → 就地清除并转绿。
      var _inGrace = (_quizDsGraceUntil && Date.now() < _quizDsGraceUntil && !_quizManualHold);
      if (_quizAIFailed[fp] && Date.now() < _quizAIFailed[fp] && !_quizHandled[fp] && !_inGrace) st = 'fail';          // 红=冷却中（当前失败态，未作答）；宽限窗口内让位于紫(对齐行92)
      else if (_quizAIProblems[fp] && !_quizHandled[fp] && !_inGrace) st = 'fail';                       // 红=曾失败且非宽限中（宽限中显示紫）
      else if (_quizPendingSubmit[fp]) { st = 'busy'; _kind = 'confirm'; }                              // 黄=待确认提交（与状态区/toast「待确认提交」对齐）
      else if (typeof _quizReviewItems !== 'undefined' && _quizReviewItems[fp]) { st = 'busy'; _kind = 'review'; }  // 黄=待人工复核（与状态区/toast「待人工复核」对齐）
      else if (_quizRequests['vision:' + fp] || _quizRequests['text:' + fp] || _quizVisTimers[fp] || _quizAIPending[fp]) { st = 'busy'; _kind = 'answering'; }
      else if (typeof _quizFillItems !== 'undefined' && _quizFillItems[fp] && !_quizHandled[fp]) st = 'fill';   // 蓝=填空题待回填：题型识别=fill，step2 接入自动回填
      else if (_quizInfoMissing[fp] && !_quizHandled[fp]) st = 'missing';                               // 橙=信息缺失：无选项/题干无法识别，且尚未作答
      else if (_inGrace && !_quizHandled[fp]) st = 'blocked';                                            // 紫=暂时受阻：DS 通道建立宽限中（等待应答端连接）
      else if (_quizManualHold && !_quizHandled[fp]) st = 'special';                                    // 蓝=特殊情况：自动启动关闭·挂起不作答
      else if (_quizQuestionSettled(fp)) {
        st = 'done';                                                                                     // 绿=已完成
        if (_quizAIProblems[fp]) delete _quizAIProblems[fp];   // v4.19.35：已作答清除失败登记（AI 作答段/首错不再陈旧）
        if (_quizAIFailed[fp] && Date.now() >= _quizAIFailed[fp]) delete _quizAIFailed[fp];
      }
      if (st !== 'fail' && l.msg) l.msg = undefined;   // v4.19.35：恢复后清除灯上历史失败原因（首错不显陈旧）
      l.state = st; l.kind = _kind;
    }
    if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('quiz:lights');   // 通知面板渲染
    // 跨帧信号灯广播：学习通作业题常驻多层 iframe（顶→cards→work→doHomeWorkNew），顶层面板读不到
    // 子帧 quizLights → 子帧把灯快照转发给顶层帧（纯数据 {fp,state}，无 DOM 引用）。
    // 目标 origin 收窄到顶层帧真实 origin；顶层 window===top 不发，避免回环。
    // v4.19.1：fail 灯附带失败原因（_quizAIProblems 的 msg），顶层诊断可直接显示「首错」，不依赖帧可达性。
    if (typeof window !== 'undefined' && window !== window.top) {
      try {
        // v4.19.21：签名并入 DS 可用性与异常位——灯全红稳定时遥测不再陈旧（帧DS 翻转/新错误即重播）
        var _sig = _quizLights.length + ':' + _quizLights.map(function (x) { return x.state; }).join('')
          + ':ds' + ((typeof dsAvailable === 'function' && dsAvailable()) ? 1 : 0)
          + ':e' + (_quizLastTickErr ? 1 : 0);
        if (_sig !== _quizLightsSigLast) {
          _quizLightsSigLast = _sig;
          var _topOrigin = (window.top && window.top.origin) ? window.top.origin : '*';
          window.top.postMessage({ __cxQuizLights: _quizLights.map(function (x) {
            return { fp: x.fp, state: x.state, kind: x.kind, msg: (x.state === 'fail' && _quizAIProblems[x.fp]) ? _quizAIProblems[x.fp].msg : undefined };
          }), __cxQuizTick: { scanned: _quizLastScanned, answered: _quizLastAnswered, err: _quizLastTickErr || undefined, skip: _quizSkipCounts, ds: (typeof dsAvailable === 'function') ? (dsAvailable() ? 1 : 0) : 0, ts: Date.now() } }, _topOrigin);
        }
      } catch (e) { swallow(e, 'quiz.lights.fwd'); }
    }
    // v4.19.9 需求·跨页信号灯镜像：把顶层面板合并后的灯快照经 GM 存储（跨标签页/跨域可用）同步给
    // DeepSeek 应答端面板——DS 页监听 'cx_quiz_lights_v1' 写入 quizLightsRemote 并重渲染做题区。
    // v4.19.46：修复「陈旧镜像」——旧实现仅 `_quizLights.length > 0` 才写镜像，课程页出清/答题结束
    // 后灯清空但 GM 键残留最后一次旧灯，应答端页永远显示残留灯（与答题页真实状态脱节）。
    // 改为空态也写（lights:[] + ts），应答端收到后清空镜像；`_gSig` 签名去重防高频写（空态签名 '0:' 恒定）。
    if (typeof window !== 'undefined' && window === window.top && typeof GM_setValue === 'function') {
      try {
        if (typeof detectSite === 'function' && detectSite() !== 'deepseek') {
          var _gSig = _quizLights.length + ':' + _quizLights.map(function (x) { return x.state; }).join('');
          if (_gSig !== _quizLightsGmSig) {
            _quizLightsGmSig = _gSig;
            GM_setValue('cx_quiz_lights_v1', JSON.stringify({ lights: _quizLights.map(function (x) {
              // v4.19.20 安全加固：跨页镜像仅携带截断后的失败原因（≤40 字符），避免题干/DS 回复全文明文驻留 GM 存储
              return { fp: x.fp, state: x.state, kind: x.kind, msg: (x.state === 'fail') ? String(x.msg || (_quizAIProblems[x.fp] && _quizAIProblems[x.fp].msg) || '').slice(0, 40) : undefined };
            }), ts: Date.now() }));
          }
        }
      } catch (e) { swallow(e, 'quiz.lights.gm'); }
    }
  }, 'quiz.lights');
}
// 跨帧信号灯接收端（仅顶层帧执行）：合并子帧广播的灯快照，供顶层面板渲染 iframe 内题目。
// 安全：仅接受与顶层同源的消息；具名 handler（_topQuizLightsHandler）供 lifecycle 清理。
// v4.19.2 重写：按「源帧」全量替换——子帧每轮广播都是完整快照（含空数组=该帧已重载/清空），
// 旧实现空数组 no-op 导致陈旧灯永久残留（实测复现）。多子帧并存时各源的灯互不覆盖。
function _quizMergeRemoteLights(remote, src) {
  if (!remote) return;
  var _src = src || '?';
  var _changed = false;
  // ① 清除该源全部旧灯（空快照同样生效：源帧重载后陈旧灯移除）
  for (var _oi = _quizRemoteOrder.length - 1; _oi >= 0; _oi--) {
    var _fp0 = _quizRemoteOrder[_oi];
    if (_quizRemoteState[_fp0] && _quizRemoteState[_fp0].src === _src) {
      delete _quizRemoteState[_fp0];
      _quizRemoteOrder.splice(_oi, 1);
      _changed = true;
    }
  }
  // ② 并入新快照（本地已登记的 fp 跳过——本地灯状态由本地推导，子帧广播不再覆盖）
  for (var _ri2 = 0; _ri2 < remote.length; _ri2++) {
    var _r = remote[_ri2];
    if (!_r || typeof _r.fp !== 'string' || _r.fp.indexOf('quiz:') !== 0) continue;
    if (_r.fp in _quizLightFp) continue;
    if (!_quizRemoteState[_r.fp]) { _quizRemoteOrder.push(_r.fp); _changed = true; }
    else if (_quizRemoteState[_r.fp].state !== _r.state) _changed = true;
    _quizRemoteState[_r.fp] = { state: _r.state || 'idle', msg: _r.msg, src: _src };
  }
  // ③ 重建远程灯区（本地灯原样保留，远程灯按发现顺序重排）
  var _newLights = [];
  for (var _li3 = 0; _li3 < _quizLights.length; _li3++) {
    if (!_quizLights[_li3].remote) _newLights.push(_quizLights[_li3]);
  }
  for (var _oi2 = 0; _oi2 < _quizRemoteOrder.length; _oi2++) {
    var _st = _quizRemoteState[_quizRemoteOrder[_oi2]];
    if (!_st) continue;
    var _existing = null;
    for (var _li4 = 0; _li4 < _newLights.length; _li4++) {
      if (_newLights[_li4].fp === _quizRemoteOrder[_oi2]) { _existing = _newLights[_li4]; break; }
    }
    if (_existing) {
      _existing.state = _st.state;
      _existing.msg = _st.msg;
    } else {
      _newLights.push({ seq: _newLights.length + 1, fp: _quizRemoteOrder[_oi2], state: _st.state, msg: _st.msg, remote: true });
    }
  }
  if (_changed || _newLights.length !== _quizLights.length) {
    for (var _si = 0; _si < _newLights.length; _si++) _newLights[_si].seq = _si + 1;
    _quizLights.length = 0;
    for (var _pi2 = 0; _pi2 < _newLights.length; _pi2++) _quizLights.push(_newLights[_pi2]);
    _quizSyncLights();
  }
}
if (typeof window !== 'undefined' && window === window.top && typeof window.addEventListener === 'function') {
  // v4.19.24 遥测归属：按来源帧记录 tick（视频播放器等无题 iframe 也会广播 帧扫=0，直接覆盖会顶掉
  // 答题帧的真实遥测 → 诊断「帧扫/答/帧DS」显示错误来源）。展示取「时间戳最新」的一份。
  var _quizRemoteTickBySrc = (typeof Map !== 'undefined') ? new Map() : null;
  var _quizRemoteTickBest = function () {
    var _best = null;
    if (_quizRemoteTickBySrc) {
      _quizRemoteTickBySrc.forEach(function (t) { if (!_best || t.ts > _best.ts) _best = t; });
    }
    return _best || _quizRemoteTick;
  };
  bestEffort(function () {
    _topQuizLightsHandler = function (e) {
      try {
        if (e && e.origin && e.origin !== window.location.origin) return;   // 仅接受同源消息（与 state.js 跨帧透传同策略）
        var d = e && e.data;
        if (d && d.__cxQuizLights && Array.isArray(d.__cxQuizLights)) {
          _quizMergeRemoteLights(d.__cxQuizLights, e.source);
          if (d.__cxQuizTick) {
            if (_quizRemoteTickBySrc) _quizRemoteTickBySrc.set(e.source, d.__cxQuizTick);
            _quizRemoteTick = _quizRemoteTickBest();
            bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.quizRemoteTick = _quizRemoteTick; }, 'quiz.lights.tick');
          }
        }
      } catch (err) { swallow(err, 'quiz.lights.rcv'); }
    };
    window.addEventListener('message', _topQuizLightsHandler);
  }, 'quiz.lights.bind');
}
