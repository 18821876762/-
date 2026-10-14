// @provides: _quizVisGen, _quizVisTimers
// @requires: CONFIG, EventBus, _quizAIFailed, _quizAIProblems, _quizCanRun, _quizClick, _quizHandled, _quizIsMulti, _quizPageSubmitted, _quizParseSeq, _quizPendingSubmit, _quizPrunePending, _quizRefreshSettlementStats, _quizReviewItems, _quizSource, _quizStrictAI, _quizSyncLights, bestEffort, swallow
// @source-group: takeover/engine/quiz.js
// 职责：视觉答案请求与结算；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  var _quizVisTimers = {};   // 线程审计：在途视觉超时定时器句柄（fp→句柄），quizDisconnect 时统一清除
  var _quizVisGen = {};    // v4.19.49：视觉发题代际——解占坑并重发后，旧请求的晚到 settle 应被丢弃（否则重复作答/旧答案覆盖新请求）
  function _quizVisionAnswer(qEl, opts, sels, stem, fp) {
    if (!_quizCanRun()) { delete _quizHandled[fp]; return; }
    var _seq = _quizParseSeq(stem || '');
    var _req = _quizNewRequest('vision', fp, qEl);
    var _gen = _req.id;
    _quizVisGen[fp] = _gen;
    // 【幂等修复·视觉异步软死锁】调用前 quizTick 已将 _quizHandled[fp]=true（占坑防重复触发截图）。
    // v4.19.21 修复「DS 已作答但本地全红 + 一直重搜」：deepseek-web 模式预算对齐 DS 问答链
    // （60s 超时 + 2.5s 重试 + 余量）→ 默认 90s；旧 45s 本地竞速 < DS 长文生成时间 → 本地先杀 → 严格失败
    // → 30s 冷却后重发同一题 → 重复上传风暴。现改为：直挂 settle（晚到答案仍采纳点选，绝不重发）；
    // 预算内未回传仅置长冷却转红，余量窗口后仍无回传才解锁占坑允许真正重试（新请求而非重复上传）。
    var _dsMode = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR === 'deepseek-web');
    // v4.19.49：dsMode（deepseek-web）恒 90s 预算——v4.19.21 的意图被 CONFIG.QUIZ_VISION_TIMEOUT 默认 60000
    // truthy 短路掉（`||` 右侧不生效），实测长思维链回复 >60s 本地先杀 → 解占坑重发 → 重复作答/红灯。
    // deepseek-web 下忽略面板 60s 配置（面板"视觉超时"仅用于 endpoint/OCR 模式）。
    var _visTo = _dsMode ? 90000 : ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_TIMEOUT) || 45000);
    bestEffort(function () {
      var _settled = false;
      var _visTimer = null;
      var _visClear = function () { _quizClearRequestTimer(_req); _visTimer = null; };
      var _onSettle = function (res) {
        if (_settled) return;
        if (!_quizRequestValid(_req)) { _quizCancelRequest(_req); return; }
        _settled = true;
        _visClear();   // 先清本代资源（定时器/注册表），再判代际——旧代际晚到同样要清自己的 timer，否则残留至 90s 后才弹跳（⑨ 复核修复）
        // v4.19.49 代际校验：解占重发后旧请求晚到 → 丢弃（旧答案不覆盖新请求，杜绝重复作答）
        if (!_quizRequestValid(_req)) return;
        try {
        _quizSyncLights();   // 需求·信号灯：视觉 settle（成功/失败）后即时刷新该题状态
        // 幂等性修复(审查 S-1)：卸载后（命名空间已删）在途视觉问答 settle 时不再点选/提交——手动 uninstall 后
        // 旧实现在 .then/.catch 里对页面真实执行 _quizClick/_quizSubmit（卸载残留副作用）。
        if (!(window && window.__CX_FORCE_PLAY)) return;
        // v4.19.14 诊断：先抓本题「回传内容」基线（题型/选项数/DeepSeek 回传的 answer 与 text/混淆字体解码状态），
        // 后续各分支只补 result/parseReason/err，供诊断页「AI 作答诊断明细」逐题定位根因。
        var _d = {
          ts: Date.now(),
          recovered: !!(res && (res.text != null || res.answer != null)),
          hasAnswer: !!(res && res.answer != null),
          hasText: !!(res && res.text != null),
          answer: (res && res.answer != null) ? String(res.answer) : null,
          text: (res && res.text != null) ? String(res.text).replace(/\s+/g, ' ').slice(0, 160) : null,
          decodeOk: !!(res && res.decodeOk),
          decodeLen: (res && res.decodeLen) || 0,
          imgSkipped: (res && res.imgSkipped === true),
          parseReason: null,
          result: null
        };
        if (!res || (res.text == null && res.answer == null)) {
          _d.result = 'error'; _d.err = 'empty-recover（DeepSeek 未回传文本/答案，或截图识别全程失败）';
          _quizRecordDiag(fp, qEl, opts, _d);
          throw new Error('empty recover');   // 进入 catch → 标注为“未回传/连接问题”而非“解析失败”
        }
        // 答案令牌 → 待点击下标数组（支持 多选/单选/判断 三类）
        var useIdxs = null, multi = false;
        if (res.answer != null) {
          if (typeof res.answer === 'number') {
            useIdxs = [res.answer]; // 多模态端点直接给答案索引
          } else {
            multi = _quizIsMulti(opts);
            var _pp = _quizAnswerParse(String(res.answer), opts, multi); // DeepSeek 经 _dsParseAnswer 解析出的令牌(字母/多选字母/判断语义词)
            _d.parseReason = _pp ? _pp.reason : 'no-parse';
            if (_pp && _pp.idxs.length) { useIdxs = _pp.idxs; multi = _pp.multi; }
          }
        }
        if (!(useIdxs && useIdxs.length)) {
          // 还原文本 → 查本地题库（题干已还原为真实文本，可命中 bank）；仍无则对原(可能混淆)题干再查一次
          var src = _quizSource();   // 与主求解口径统一（面板 localStorage 设置优先于 CONFIG）
          if (src === 'bank' && res.text) {
            var b = _quizBankLookup(res.text);
            if (b != null) useIdxs = [(typeof b === 'number') ? b : parseInt(b, 10)];
          }
          if (!(useIdxs && useIdxs.length)) { var b2 = _quizBankLookup(stem); if (b2 != null) useIdxs = [(typeof b2 === 'number') ? b2 : parseInt(b2, 10)]; }
        }
        if (!(useIdxs && useIdxs.length && useIdxs.every(function (i) { return i >= 0 && i < opts.length; }))) {
          // 修复：本分支只在 DeepSeek 已回传（resolve）但 res.answer 不可解析为合法选项下标时触发（真正"未回传"
          // 会走超时 reject → 另一句 "题目识别/作答失败：..."）。旧措辞"DeepSeek 未回传"与事实相反、误导排查。
          // 且原始回复(res.text)不在报错里 → 看不到 DeepSeek 实际回了什么。此处补回原始回复片段便于定位
          // （常见三类：① 回的是选项内容而非字母 → no-letter-or-semantic；② 字母超出选项数 → letter-out-of-range；
          //  ③ 判断语义词未匹配 → no-letter-or-semantic）。
          if (_quizStrictAI()) {
            var _raw = (res && res.answer != null ? ('answer=' + res.answer) : 'answer=null')
              + (res && res.text ? (' · DeepSeek回复=' + String(res.text).replace(/\s+/g, ' ').slice(0, 140)) : ' · (无文本内容)');
            _d.result = 'fail'; _d.err = '解析失败(' + (_d.parseReason || '?') + ') · ' + _raw;
            _quizRecordDiag(fp, qEl, opts, _d);
            _quizStrictFail(fp, qEl, sels, 'DeepSeek 已回传但答案无法解析为选项（' + _raw + '）');
            if (_quizHandled[fp]) delete _quizHandled[fp]; return;
          }
          _d.result = 'random'; _d.err = '解析失败→随机兜底(' + (_d.parseReason || '?') + ')';
          _quizRecordDiag(fp, qEl, opts, _d);
          useIdxs = [Math.floor(Math.random() * opts.length)]; // 无果→随机兜底保不卡（单选/未知类型点一项；多选随机仅作占位）
        }
        // v4.19.10：settle 时页面已提交/只读 → 不再点选（用户已手动提交，避免在只读页误操作）
        if (_quizPageSubmitted(sels)) { _d.result = (_d.result || 'ok'); _d.err = (_d.err || '') + ' · 页面已提交(只读)未点选'; _quizRecordDiag(fp, qEl, opts, _d); return; }
        // 过滤越界；单选项只取首个（避免误点多个 radio）
        useIdxs = useIdxs.filter(function (i) { return i >= 0 && i < opts.length; });
        if (!useIdxs.length) useIdxs = [Math.floor(Math.random() * opts.length)];
        if (!multi) useIdxs = [useIdxs[0]];
        // v4.19.32·置信度分级落点：把 DS 的确定性信号接回决策（旧逻辑恒 high → 错答无条件直交）。
        // 决策经 _quizVisConfAction 单一事实源（high→submit / mid→hold / low→random），与 sim 断言一致。
        var _vc = (res && res.visionConf) || 'high';
        var _act = _quizVisConfAction(_vc);
        _d.visionConf = _vc;
        if (_act === 'random') {
          // 低置信：不盲选真实答案，随机兜底保不卡 + 入人工复核队列（非严格模式不整题失败）
          useIdxs = [Math.floor(Math.random() * opts.length)];
          _quizReviewItems[fp] = { fp: fp, stem: stem, optTexts: (opts || []).map(function (o) { return (o && o.textContent != null) ? o.textContent : o; }), guessedIdx: useIdxs[0], ts: Date.now() }; _quizPruneReviews();
          _quizPendingSubmit[fp] = { qEl: qEl, sels: sels.submitSels, optionSels: sels.optionSels, ts: Date.now() }; _quizPrunePending();
          bestEffort(function () { EventBus.emit('ui:toast', '低置信度(' + _quizSeqLabel(_seq) + ')·视觉作答已随机兜底·待人工复核'); }, 'quiz.vis.low');
        }
        for (var _k = 0; _k < useIdxs.length; _k++) { if (!_quizRequestValid(_req)) return; _quizClick(opts, useIdxs[_k]); }
        if (!_quizRequestValid(_req)) return;
        // 信号灯修复·幂等断言：晚到答案采纳点选后重新登记 _quizHandled——旧实现完全依赖调用方占坑维持完成态，
        // 超时分支解占坑后 settle 晚到时占坑已不存在 → 灯不绿 + quizTick 重扫重复作答。此处断言使完成态自愈。
        _quizHandled[fp] = true; _quizPruneHandled();
        if (_quizAIFailed[fp]) delete _quizAIFailed[fp];   // 成功作答：清除失败冷却，避免遗留（含看门狗置的长冷却）
        _d.result = 'ok'; _d.idxs = useIdxs.slice();
        _quizRecordDiag(fp, qEl, opts, _d);
        // v4.19.20 审查修复：视觉路径原直接 _quizSubmit 绕过二次确认开关——改为 _quizMaybeSubmit，
        // 遵守 cx_quiz_autosubmit=0「作答但不提交、挂起待确认」契约（与文本路径语义一致）
        // v4.19.32：hold(mid) 强制挂起（即便自动提交开着也不直交，避免中置信误交）；submit(high) 才随 _quizMaybeSubmit 提交策略；random(low) 不提交，由人工复核
        if (_act === 'hold') {
          // 信号灯修复：中置信挂起必须登记 _quizPendingSubmit——旧实现只发 toast 不挂队，占坑 _quizHandled=true
          // 使 _quizSyncLights 行99 命中 → 灯显绿(已完成)，实际题「已点选未提交」被误标完成；
          // 且 quizSubmitPending「确认提交」按钮也漏掉此题（无登记即不提交）。对齐文本路径 confirm 分支。
          _quizPendingSubmit[fp] = { qEl: qEl, sels: sels.submitSels, ts: Date.now() }; _quizPrunePending();
          bestEffort(function () { EventBus.emit('ui:toast', '中置信度(' + _quizSeqLabel(_seq) + ')·已点选·待确认提交'); }, 'quiz.vis.confirm');
        } else if (_act === 'submit') {
          _quizMaybeSubmit(qEl, sels.submitSels, fp);
          bestEffort(function () { EventBus.emit('ui:toast', '已视觉识别作答 ' + _quizSeqLabel(_seq) + (useIdxs.length > 1 ? '（多选·点击 ' + useIdxs.length + ' 项）' : '') + ' · 置信=' + _vc); }, 'quiz.vis.toast');
        }
        } catch (err) { _settled = false; _onFail(err); }
        finally { _quizFinishRequest(_req); _quizRefreshSettlementStats(); _quizSyncLights(); }
      };
      var _onFail = function (e) {
        if (_settled) return;
        if (!_quizRequestValid(_req)) { _quizCancelRequest(_req); return; }
        _settled = true;
        _visClear();   // 先清本代资源，再判代际（同 _onSettle，⑨ 复核修复）
        // v4.19.49 代际校验（同 _onSettle）：过期请求的失败回调不落地
        if (!_quizRequestValid(_req)) return;
        try {
        // 线程审计：settle 后清除超时定时器句柄
        _quizSyncLights();   // 需求·信号灯：视觉失败后即时刷新该题状态
        swallow(e);
        // 幂等性修复(审查 S-1)：卸载后不随机兜底/提交（同上，卸载残留副作用阻断）
        if (!(window && window.__CX_FORCE_PLAY)) return;
        // v4.19.14 诊断：catch 分支 = 超时/DS错误/空回传等「未成功回传」类失败，与「回传但解析失败」明确区分。
        var _blank = e && /题目截图疑似空白/.test(e.message || '');
        var _de = { ts: Date.now(), recovered: false, hasAnswer: false, hasText: false, result: 'error', imgSkipped: _blank ? true : undefined, err: ((e && e.message) ? e.message : '未知错误（请查「错误累计/最近(3)」真实堆栈）') };
        _quizRecordDiag(fp, qEl, opts, _de);
        if (_quizStrictAI()) { _quizStrictFail(fp, qEl, sels, '题目识别/作答失败：' + ((e && e.message) ? e.message : '未知原因（非 DeepSeek 未回传，请查上方真实错误）')); if (_quizHandled[fp]) delete _quizHandled[fp]; return; }
        _quizClick(opts, Math.floor(Math.random() * opts.length));   // 识别失败→随机兜底，绝不卡进度
        if (!_quizRequestValid(_req)) return;
        // 信号灯修复·幂等断言：与 _onSettle 成功分支同口径——随机兜底后断言 _quizHandled，完成态不依赖调用方占坑。
        _quizHandled[fp] = true; _quizPruneHandled();
        // v4.19.20 审查修复：同成功分支——经 _quizMaybeSubmit 遵守二次确认开关
        _quizMaybeSubmit(qEl, sels.submitSels, fp);
        bestEffort(function () { EventBus.emit('ui:toast', '题目识别未成功，已随机兜底 ' + _quizSeqLabel(_seq)); }, 'quiz.vis.failToast');
        } finally { _quizFinishRequest(_req); _quizRefreshSettlementStats(); _quizSyncLights(); }
      };
      // 直挂 settle（不再用 Promise.race 丢弃晚到答案）：deepseek-web 下 DS 晚于预算回传仍走 _onSettle 点选
      try { quizRecover(qEl, { signal: _req.abort && _req.abort.signal, valid: function () { return _quizRequestValid(_req); } }).then(_onSettle, _onFail); }
      catch (err) { _onFail(err); return; }
      _visTimer = setTimeout(function () {
        if (_settled) return;
        if (!_quizRequestValid(_req)) { _quizCancelRequest(_req); return; }
        _quizClearRequestTimer(_req);
        if (_dsMode) {
          // 预算内未回传：不杀底层请求（晚到答案仍会被 _onSettle 采纳并清除冷却）；
          // 置长冷却（红灯）避免重发；余量窗口后仍无回传 → 解锁占坑允许真正重试（新请求而非重复上传）
          if (!(window && window.__CX_FORCE_PLAY)) return;
          // v4.19.49 代际校验：本级超时弹跳时若题已被重发（代际已变），不得动新占坑——否则 `delete _quizHandled`
          // 误删新占坑 → 下一轮重扫又重发 → 「第1题 15s 内被答两次」重复作答循环（用户诊断实证）。
          if (!_quizRequestValid(_req)) return;
          // 信号灯修复：解除占坑——旧实现置 _quizAIFailed 意图显红，但占坑 _quizHandled=true 使红灯条件
          // (!handled) 恒不满足，灯实际显黄(answering)卡 180s；解占后行91 红灯可命中（DS 超时警示用户），
          // 且 quizTick 行1339 的 90s 冷却防重发（行为不变）。晚到 settle 会重新断言 _quizHandled（见 _onSettle）。
          if (_quizHandled[fp]) delete _quizHandled[fp];
          _quizAIFailed[fp] = Date.now() + 90000;
          if (!_quizAIProblems[fp]) {
            _quizAIProblems[fp] = { fp: fp, msg: '[第' + _seq + '题] DS 应答超时（' + Math.round(_visTo / 1000) + 's 未回传；晚到答案仍会采纳，不会重发）', ts: Date.now() };
            _quizPruneAIProblems();
          }
          _quizSyncLights();
          _req.timer = setTimeout(function () {
            if (_settled) return;
            if (!_quizRequestValid(_req)) { _quizCancelRequest(_req); return; }
            // v4.19.49 代际校验（同本级）：重发后旧余量窗口弹跳不得删新占坑/冷却
            _quizCancelRequest(_req);
            delete _quizHandled[fp]; delete _quizAIFailed[fp]; delete _quizAIProblems[fp];
            _quizRefreshSettlementStats();
            _quizSyncLights();
          }, 90000);
          _quizVisTimers[fp] = _req.timer;
        } else {
          _onFail(new Error('vision-timeout'));
        }
      }, _visTo);
      _req.timer = _visTimer;
      _quizVisTimers[fp] = _visTimer;   // 线程审计：登记在途超时句柄，quizDisconnect 时统一 clearTimeout（卸载后不再残留在途定时器）
    }, 'quiz.vis.answer');
  }
