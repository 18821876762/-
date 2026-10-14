// @provides: _quizLastAnswered, _quizLastScanned, quizTick
// @requires: CONFIG, CX_KEYS, EventBus, QUIZ, _pqQueryAll, _quizAIFailed, _quizAIPending, _quizAIProblems, _quizCanRun, _quizCancelForFp, _quizClick, _quizDirtyGen, _quizDsGraceUntil, _quizFillItems, _quizHandled, _quizInfoMissing, _quizInvalidateAsync, _quizIsMulti, _quizLastHadQuestions, _quizLastQuestions, _quizLastTickErr, _quizLightFp, _quizLights, _quizMOForced, _quizManualHold, _quizPageSubmitted, _quizParseSeq, _quizPendingSubmit, _quizPrunePending, _quizQuestionSettled, _quizRefreshSettlementStats, _quizRemoteOrder, _quizRemoteState, _quizReviewItems, _quizSettled, _quizSkipCounts, _quizSource, _quizStrictAI, _quizVisGen, _quizVisTimers, bestEffort, dsAvailable, safeGet, swallow
// @source-group: takeover/engine/quiz.js
// 职责：答题扫描与处理循环（函数前片）；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 运行状态可观测（修复"答题不像视频能精准判断是否运行"）：记录 启动/完成 信号 + 实时统计
  var _quizDetectedNotified = false;   // 已发「开始」信号（扫描到题即报一次）
  var _quizDoneNotified = false;       // 已发「完成」信号（剩余=0 即报一次）
  var _quizDisabledNotified = false;   // 已发「已禁用」提示
  var _quizLastScanned = 0;      // 上一轮扫描题数（完成信号/跨帧遥测用）
var _quizLastAnswered = 0;     // 上一轮已作答数（跨帧遥测用）
  var _quizSeqWarnNotified = false;   // 完成度校验告警节流：避免每 tick 重复刷屏（状态恢复正常后复位）
  // 统计"已作答"题数：已记入去重指纹 或 含已勾选输入（比单纯看 class 名更稳）
  function _quizCountAnswered(qs) {
    var n = 0;
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (!q) continue;
      if (_quizQuestionSettled(_quizFingerprint(q))) n++;
    }
    return n;
  }

  // 通用入口：扫描题目并认真作答（随机/bank/ai/视觉识别 兜底）。selectors 可选覆盖默认 QUIZ。
  //   - 文本路径(random/bank/ai)同步可解 → 立即作答；
  //   - 文本无解且 QUIZ_VISION_ENABLED → 截图还原(异步)后作答（先占坑防每轮重复截图）；
  //   - 其余 → 随机兜底保不卡。
  function quizTick(selectors) {
    // 安全停机（fail-safe）：检测到验证码/风控验证后不再自动作答。
    // 闸门必须设在此处（不能只靠停主循环）——答题还由 MutationObserver 驱动，停主循环挡不住 MO 路径。
    quizSyncGate();
    if (!_quizCanRun()) {
      if (Object.keys(_quizRequests).length) _quizInvalidateAsync('gate-closed');
      _quizRefreshSettlementStats();
      return 0;
    }
    var sels = selectors || QUIZ;
    var answered = 0;
    var _seqs = [];   // 本轮扫描到的题目序号集合（完成度校验用）
    var _doneInTick = 0;  // §3.1：inline 计数已作答题数，避免 _quizCountAnswered 二次遍历 + 重算 textContent
    // 状态机优化(卡顿排查·答题调度)：无题稳态降频——上次扫描 0 题且距上次扫描 <2000ms 时直接跳过。
    // 窗口 4000→2000ms：与主循环节奏对齐，题目检测兜底延迟不超过 2s（与老版本一致）；省扫描收益
    // 由 MO 动态防抖（无关变更 5s）承担，主循环兜底扫描只在顶层每 2s 一次（成本 ~1-3ms，可控）。
    // MO 驱动（_quizMOForced，已有动态防抖）豁免节流——题目出现由 quizObserve 的 MO 短防抖即时接管。
    var _nowQ = Date.now();
    var _moDriven = _quizMOForced;
    _quizMOForced = false;
    if (!_moDriven && !_quizLastHadQuestions && _nowQ - _quizLastScanAt < 2000) return 0;
    _quizLastScanAt = _nowQ;
    // P1-4：不再每 tick 强制重算指纹（见 _quizFingerprint 的脏代际缓存）；
    //   改为「全量安全刷新」节奏：每 _QUIZ_FULL_REFRESH_TICKS 次 tick 强制脏代际 +1，
    //   覆盖 MutationObserver 未触发的字符变更 / MO 未初始化场景，确保不丢题目更新。
    _quizTickCount++;
    if (_quizTickCount % _QUIZ_FULL_REFRESH_TICKS === 0) { _quizDirtyGen++; _quizPruneAIFailed(); _quizPruneAIPending(); }   // 幂等性修复(审查 G-3)：与 AI 失败冷却同轮淘汰在途 AI 题解残留
    // 中途关闭开关（在控制台设置 CX_KEYS.QUIZ_AUTO = 'cx_quiz_auto' 对应 localStorage.setItem('cx_quiz_auto','0') 切换）
    if (safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO) : null; }, null) === '0') {
      if (!_quizDisabledNotified) { _quizDisabledNotified = true; bestEffort(function () { EventBus.emit('ui:toast', '自动答题已禁用（cx_quiz_auto=0，置 1 恢复）'); }, 'quiz.toast.disabled'); }
      return 0;
    }
    // 「弹窗自动作答」开关（cx_popup_quiz）：仅作用于位于弹窗内的题目（超星/ilabx 上课互动弹窗由此控制，与通用答题开关互补）。关闭则不作答、仅静默关闭弹窗。
    _quizPopupOff = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.POPUP_QUIZ) === '0' : false; }, false);
    // v4.19.10 识别已提交（用户手动提交/结果页/只读回看）→ 全题标记完成、停止作答
    var _quizSubmitted = _quizPageSubmitted(sels);
    if (!_quizSubmitted) _quizSubmittedNotified = false;
    // 需求·自动启动控制：自动启动关 → 挂起作答（只扫描登记信号灯，等手动按钮或开启自动启动）；
    // 手动按钮/开启动置位（_quizManualArmed）→ 本次强制作答（绕过自动启动关，并解除挂起态）。
    if (_quizManualArmed) { _quizManualArmed = false; _quizManualHold = false; }
    else { _quizManualHold = !_quizAutoStartOn(); }
    // 有效顶层帧下钻可访问子 iframe：题目常驻嵌套作业帧（doHomeWorkNew/about:blank/blob），顶层 document 扫不到 → 0 灯。
    // 下钻后由顶层统一扫描/作答，信号灯直接登记在顶层（修复·跨帧 postMessage 聚合盲区）。
    var _roots = [(document && document.documentElement) || document];
    if (_isEffectiveTop()) {
      var _awfDocs = _accessibleWorkFrames();
      for (var _ri = 0; _ri < _awfDocs.length; _ri++) { if (_awfDocs[_ri] && _awfDocs[_ri].documentElement) _roots.push(_awfDocs[_ri].documentElement); }
    }
    var qs = [];
    // v4.19.50 修复·跨 root 节点去重：document 与 _accessibleWorkFrames() 下钻的各子帧 doc 直接拼接时，
    // 同一题块可能被「外层 root 递归命中」与「内层子帧 root 直接命中」各计一次；且 SPA 下 window.frames
    // 随会话累积，同一节点被重复计入 scanned 数会逐轮递增（用户实证：实际 5 题报 10→15→20 递增）。
    // 按节点引用去重后 scanned/序号/完成度均反映「唯一题块数」，灯（fp 去重）与统计口径一致。
    for (var _r = 0; _r < _roots.length; _r++) {
      var _rq = _pqQueryAll(_roots[_r], sels.questionSels);
      for (var _q = 0; _q < _rq.length; _q++) {
        var _nq = _rq[_q];
        if (_nq && qs.indexOf(_nq) < 0) qs.push(_nq);
      }
    }
    var scanned = qs.length;
    _quizLastQuestions = qs.map(function (q) { return { qEl: q, fp: _quizFingerprint(q, sels) }; });
    var src = _quizSource();  // 提到循环外，避免全部跳过时 source 为 undefined；必须与实际求解口径一致（面板改答案源即时反映到 stats）
    var _confAcc = 0, _confN = 0, _srcMap = {}, _lvlMap = {};   // 统计：平均置信度 + 实际命中来源集合 + 分级分布(auto/confirm/review)
    // v4.19.2 遥测：单题异常不再静默中断整轮——捕获后随跨帧广播上报顶层诊断（帧错=…），可定位答题中断根因
    _quizLastTickErr = '';
    _quizSkipCounts = { handled: 0, cooldown: 0, popup: 0, hold: 0, noOpts: 0, gate: 0, fill: 0 };   // v4.19.3：跳过原因计数（诊断显示每题被哪条路径跳过；fill=识别为填空题待回填）
    try {
    for (var i = 0; i < qs.length; i++) {
      var qEl = qs[i];
      // 序号收集放在所有 continue 之前（含「已作答则跳过」），否则第二轮题已被 handled 跳过 → _seqs 为空 → 完成度校验失效
      var stem = _quizText(qEl, sels.stemSels);
      var _seq = _quizParseSeq(stem);
      // v4.19.50：序号去重（配合跨 root 节点去重）——重复命中同一题时序号不再重复计入完成度校验
      if (_seq && _seqs.indexOf(_seq) < 0) _seqs.push(_seq);
      var fp = _quizFingerprint(qEl, sels);
        // 需求·信号灯：新题按发现顺序登记（初始黑=未进行）
        // 修复·重复灯：_quizLightFp 存的是下标，首灯下标 0 为假值 → 旧守卫 !_quizLightFp[fp]
        // 在后续每轮扫描对「第一道题」恒真 → 同一 fp 重复登记新灯（实测 sim-quiz-chaoxing S3 复现 4 灯）。
        // 改为存 下标+1（恒真）且守卫用 in 判断，杜绝重复灯。
        if (fp && !(fp in _quizLightFp)) {
          // 跨帧信号灯：若已存在同 fp 的远程灯（子帧先广播、本帧后扫到同题），就地升级为本地灯，
          // 避免同一题出现两盏灯（升级后状态由本地推导覆盖，同步即生效）。
          var _remoteDup = -1;
          for (var _rd = 0; _rd < _quizLights.length; _rd++) {
            if (_quizLights[_rd].remote && _quizLights[_rd].fp === fp) { _remoteDup = _rd; break; }
          }
          if (_remoteDup >= 0) {
            _quizLights[_remoteDup].remote = false;
            _quizLights[_remoteDup].msg = undefined;   // 升级为本地灯后状态本地推导，广播携带的失败原因不再适用
            delete _quizRemoteState[fp];               // 本地接管：该 fp 移出远程快照（后续子帧广播不再覆盖本地灯）
            var _rio = _quizRemoteOrder.indexOf(fp);
            if (_rio >= 0) _quizRemoteOrder.splice(_rio, 1);
            // v4.19.20 审查修复：漏登记 _quizLightFp → 下一轮同 fp 再次进入登记分支重复建灯（双灯回归）
            _quizLightFp[fp] = _remoteDup + 1;
          } else {
            _quizLightFp[fp] = _quizLights.length + 1;
            _quizLights.push({ seq: _quizLights.length + 1, fp: fp, state: 'idle' });
          }
        }
        // 完成数在本轮末尾统一按结算状态计算；占坑、点选、待确认不计完成。
        // v4.19.10 识别已提交：页面进入结果/只读态 → 本帧全部题目标记完成（灯绿），清空在途状态，不再作答
        if (_quizSubmitted) {
          _quizCancelForFp(fp);
          delete _quizAIFailed[fp]; delete _quizAIProblems[fp]; delete _quizAIPending[fp]; delete _quizPendingSubmit[fp];
          if (_quizVisTimers[fp]) { try { clearTimeout(_quizVisTimers[fp]); } catch (e) {} delete _quizVisTimers[fp]; }
          delete _quizVisGen[fp];   // v4.19.49：已提交态清除代际（此后晚到 settle 均为过期，不再触发点选）
          _quizHandled[fp] = true; _quizPruneHandled();
          _quizSettled[fp] = true;
          delete _quizReviewItems[fp];
          if (!_quizSubmittedNotified) {
            _quizSubmittedNotified = true;
            bestEffort(function () { EventBus.emit('ui:toast', '检测到已提交/作答完成，停止作答'); }, 'quiz.submitted.toast');
          }
          continue;
        }
        if (_quizHandled[fp]) {                    // 已作答：重弹的弹窗仅静默关闭，不再重复作答
          _quizSkipCounts.handled++;
          if (_quizQuestionSettled(fp) && _quizIsInPopup(qEl)) _quizClosePopup(qEl);
          continue;
        }
        if (_quizAIFailed[fp] && Date.now() < _quizAIFailed[fp]) { _quizSkipCounts.cooldown++; continue; } // 严格 AI 失败冷却中：跳过，避免 2s 紧循环反复向 DeepSeek 上传截图
        if (_quizIsInPopup(qEl) && _quizPopupOff) { // 「弹窗自动作答」关闭：弹窗仅静默关闭（不作答），界面不再烦人
          _quizSkipCounts.popup++;
          _quizClosePopup(qEl); continue;
        }
        // 需求·自动启动关：挂起作答——不发起 AI 请求、不点选、不提交，仅登记信号灯（保持黑/黄状态），
        // 等手动按钮或开启自动启动（_quizManualArmed 置位后下一轮 quizTick 强制作答）。
        if (_quizManualHold) { _quizSkipCounts.hold++; continue; }
        var opts = _quizOptions(qEl, sels.optionSels);
        if (opts.length) { delete _quizInfoMissing[fp]; }   // 修复：题已识别到选项 → 清除信息缺失标志（避免「先无选项后加载出选项」永久显橙误导）
        else {
          // 题型识别(step1)：不再笼统「信息缺失」——区分填空(可自动回填)/主观(走人工队列)
          var _qt = _quizDetectQType(qEl, opts, sels);
          if (_qt === 'fill') {
            if (!_quizFillEnabled()) {   // 面板开关默认关：仅识别登记，不回填（蓝灯待回填，与未实现前一致）
              if (!_quizFillItems[fp]) { _quizFillItems[fp] = { fp: fp, stem: stem, ts: Date.now() }; _quizPruneFill(); }
              _quizSkipCounts.fill++; continue;
            }
            var _fr = _quizFillAnswer(qEl, stem, sels, fp);   // step2：题库/AI 文本 → 双路径注入
            _quizSkipCounts.fill++;
            if (_fr.status === 'filled') {
              _quizHandled[fp] = true; _quizPruneHandled();
              delete _quizFillItems[fp];
              _quizPendingSubmit[fp] = { qEl: qEl, sels: sels.submitSels, ts: Date.now() }; _quizPrunePending();   // 不自动提交：挂二次确认
              answered++;
              bestEffort(function () { EventBus.emit('ui:toast', '填空题已回填·待确认提交 ' + _quizSeqLabel(_seq) + '（源=' + (_fr.source || '?') + '）'); }, 'quiz.fill.done');
            } else {
              // pending / manual / noinput → 登记待回填（蓝灯）或转人工（橙）
              if (!_quizFillItems[fp]) { _quizFillItems[fp] = { fp: fp, stem: stem, ts: Date.now() }; _quizPruneFill(); }
              if (_fr.status === 'manual' && _fr.noinput) _quizInfoMissing[fp] = true;   // 结构异常→转信息缺失(橙)
            }
            continue;
          }
          _quizSkipCounts.noOpts++; _quizInfoMissing[fp] = true; continue;   // 主观/其他无结构化输入 → 走人工队列(橙=信息缺失)
        }
        var idxObj = _quizResolveAnswer(stem, opts, fp, qEl);  // 文本求解绑定题目节点与本次请求身份
        // 归一化待点选下标：多选题点选全部正确下标（题库可存"AB"/数组），单选题点单个
        var clickIdxs = [];
        if (idxObj) {
          if (idxObj.idxs && idxObj.idxs.length) {
            idxObj.idxs.forEach(function (i) { if (typeof i === 'number' && i >= 0 && i < opts.length) clickIdxs.push(i); });
          } else if (idxObj.idx != null) {
            if (typeof idxObj.idx === 'number' && idxObj.idx >= 0 && idxObj.idx < opts.length) clickIdxs.push(idxObj.idx);
          }
        }
        if (clickIdxs.length) {
          // —— 置信度分级决策（评估建议#3：置信度驱动行为，而非无差别点选+提交）——
          //   auto(≥0.9)：点选 + 按二次确认开关提交/挂起
          //   confirm(0.6~0.9)：点选但强制挂起待用户确认（即便自动提交开着也不直接交，避免中置信误交）
          //   review(<0.6)：低可信，转随机兜底保不卡，但标记"人工复核"（不计入高可信来源）
          var _c = (typeof idxObj.confidence === 'number') ? idxObj.confidence : 1;
          var _lvl = (typeof decisionFor === 'function') ? decisionFor(_c) : (_c >= 0.9 ? 'auto' : (_c >= 0.6 ? 'confirm' : 'review'));
          if (_lvl === 'review') {
            // 低置信：不盲选"正确"，随机兜底保不卡进度，但标记为人工复核（多选题按多选语义随机选多项）
            if (_quizStrictAI()) { _quizStrictFail(fp, qEl, sels, 'AI 未给出高置信答案（置信度 ' + Math.round(_c * 100) + '%）'); continue; }
            var _rp = _quizRandomPick(opts, _quizIsMulti(opts));
            _rp.forEach(function (i) { _quizClick(opts, i); });
            var _guessed = _rp[0];
            _quizPendingSubmit[fp] = { qEl: qEl, sels: sels.submitSels, optionSels: sels.optionSels, ts: Date.now() }; _quizPrunePending();
            _quizHandled[fp] = true; _quizPruneHandled(); answered++;
            _srcMap['review'] = true; _lvlMap['review'] = true;
            // 登记到人工复核队列：供面板「一键采纳/导出」闭环（评估建议#6 增量进本地题库）
            // 只存选项文本摘要，不持有 opts DOM 节点引用（防止整棵题目子树被 JS 强引用而无法 GC）
            var _optTexts = (opts || []).map(function (o) { return (o && o.textContent != null) ? o.textContent : o; });
            _quizReviewItems[fp] = { fp: fp, stem: stem, optTexts: _optTexts, guessedIdx: _guessed, ts: Date.now() }; _quizPruneReviews();
            (function (_c2, _obj) { bestEffort(function () { EventBus.emit('ui:toast', '低置信度(' + Math.round(_c2 * 100) + '%)·' + _quizSeqLabel(_seq) + '·已随机兜底·待人工复核（源=' + (_obj.source || '?') + '）'); }, 'quiz.toast.review'); })(_c, idxObj);
            continue;
          }
          // 多选题：逐个点选全部正确下标；单选题仅点一个
          clickIdxs.forEach(function (i) { _quizClick(opts, i); });
          if (_lvl === 'confirm') {
            // 中置信：点选但不提交，强制挂起待用户「确认提交」（_quizMaybeSubmit 的挂起语义天然满足；此处额外绕过自动提交开关）
            _quizPendingSubmit[fp] = { qEl: qEl, sels: sels.submitSels, ts: Date.now() }; _quizPrunePending();
            _quizHandled[fp] = true; _quizPruneHandled(); answered++;
            _confAcc += _c; _confN++;
            if (idxObj.source) { _srcMap[idxObj.source] = true; }
            _lvlMap['confirm'] = true;
            (function (_c2, _obj) { bestEffort(function () { EventBus.emit('ui:toast', '中置信度(' + Math.round(_c2 * 100) + '%)·' + _quizSeqLabel(_seq) + '·已点选·待确认提交（源=' + _obj.source + '）'); }, 'quiz.toast.confirm'); })(_c, idxObj);
            continue;
          }
          // auto：点选 + 按二次确认开关提交/挂起
          _quizMaybeSubmit(qEl, sels.submitSels, fp);
          _quizHandled[fp] = true; _quizPruneHandled();
          if (_quizQuestionSettled(fp)) _quizClosePopup(qEl);
          if (_quizAIPending[fp]) { (function (_fp) { bestEffort(function () { delete _quizAIPending[_fp]; }, 'quiz.pendingDel'); })(fp); }
          answered++;
          _confAcc += _c; _confN++;
          if (idxObj.source) _srcMap[idxObj.source] = true;
          _lvlMap['auto'] = true;
          (function (_c2, _obj) { bestEffort(function () { EventBus.emit('ui:toast', '已作答 ' + _quizSeqLabel(_seq) + '（源=' + _obj.source + ' 置信度=' + Math.round(_c2 * 100) + '%）'); }, 'quiz.toast.auto'); })(_c, idxObj);
          continue;
        }
        // AI 异步题解进行中：暂不下发、不下坑，记录待回填；超过 QUIZ_AI_WAIT 未命中则随机兜底（不空题）
        if (idxObj && idxObj.pending) {
          if (!_quizAIPending[fp]) _quizAIPending[fp] = Date.now();
          else {
            var _wait = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_WAIT) || 20000;
            if (Date.now() - _quizAIPending[fp] > _wait) {
              _quizCancelForFp(fp);
              delete _quizAIPending[fp];
              if (_quizStrictAI()) { _quizStrictFail(fp, qEl, sels, 'AI 题解超时（DeepSeek 未回传答案）'); continue; }
              _quizRandomPick(opts, _quizIsMulti(opts)).forEach(function (i) { _quizClick(opts, i); });   // 超时随机兜底（多选按多选语义选多项）+ 自动提交/挂起
              _quizMaybeSubmit(qEl, sels.submitSels, fp);
              _quizHandled[fp] = true; _quizPruneHandled();
              answered++;
              _srcMap['random'] = true;
              bestEffort(function () { EventBus.emit('ui:toast', 'AI 题解超时，已随机兜底 ' + _quizSeqLabel(_seq)); }, 'quiz.toast.aiTimeout');
            }
          }
          continue;
        }
        // 文本路径无果 + 视觉识别启用 → 截图还原后作答（异步；先占坑防重复触发截图）
        // deepseek-web 模式还需确认 DeepSeek 已登录可用，否则直接随机兜底（并在状态徽标显示"不可用"）
        var _visionOk = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENABLED) && typeof quizRecover === 'function';
        var _dsWebMode = _visionOk && (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR === 'deepseek-web');
        // 严格 AI（DeepSeek 网页版）模式但应答端不可用 → 停下报错，绝不错降级到随机兜底
        if (_dsWebMode && !(typeof dsAvailable === 'function' && dsAvailable())) {
          // 修复·子帧首次懒建通道（v4.19.1 回归）：iframe 内 dsAvailable 恒 false（子帧无通道、收不到
          // ds-state）→ 旧实现每题立即「应答端不可用」严格失败、截图从未发出。此处先确保通道注册，
          // 并给 ds-state 广播一个到达窗口（≤10s，DS 页 5s 心跳）：窗口内不误判、下一轮重试。
          var _chT = 0;
          if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.__dsEnsureChannel === 'function') {
            _chT = window.__CX_FORCE_PLAY.__dsEnsureChannel() || 0;
          }
          if (_chT > 0 && Date.now() - _chT < 10000) { _quizSkipCounts.gate++; _quizDsGraceUntil = Date.now() + (10000 - (Date.now() - _chT)); continue; }   // 紫=暂时受阻：DS 通道建立宽限窗口内，下一轮重试
          _quizStrictFail(fp, qEl, sels, 'DeepSeek 网页版应答端不可用（未登录 / 未开启应答端 / 未连接）');
          continue;
        }
        if (_visionOk && ((typeof CONFIG === 'undefined' || CONFIG.QUIZ_VISION_OCR !== 'deepseek-web') || (typeof dsAvailable === 'function' && dsAvailable()))) {
          _quizHandled[fp] = true; _quizPruneHandled();
          _quizVisionAnswer(qEl, opts, sels, stem, fp);
          continue;
        }
        // 兜底随机：保证不卡进度 / 不空题
        if (_quizStrictAI()) { _quizStrictFail(fp, qEl, sels, '无可用 AI 答案源（未启用 DeepSeek 网页版 / 未配置 AI 接口 / DS 未就绪）'); continue; }
        _quizRandomPick(opts, _quizIsMulti(opts)).forEach(function (i) { _quizClick(opts, i); });   // 兜底随机（多选按多选语义选多项）
        _quizMaybeSubmit(qEl, sels.submitSels, fp);   // 自动提交或挂起待二次确认
        _quizHandled[fp] = true; _quizPruneHandled();
        answered++;
        _srcMap['random'] = true;   // 随机兜底计入来源集合（置信度不累计，视为低可信）
        bestEffort(function () { EventBus.emit('ui:toast', '已随机作答 ' + _quizSeqLabel(_seq) + '（无答案源）'); }, 'quiz.toast.random');
      }
    } catch (e) {
      // v4.19.2 遥测：答题循环异常不再中断整轮静默失败——捕获并随广播上报顶层诊断（帧错=…）
      _quizLastTickErr = String((e && e.message) || e);
      swallow(e);
    }
