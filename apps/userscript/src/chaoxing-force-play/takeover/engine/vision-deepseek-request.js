// @requires: CONFIG, DS_STATUS, EventBus, _dsLoop, _dsRegTimer, _onChannel, _postChannel, _quizVisionCheckContext, bestEffort
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：课程侧请求、重试与熔断；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 审查#C：首次超时后重试前的等待（ms）与重试次数。仅对「timeout（DS 页暂离/消息未达）」重试；
  // 明确的登录态错误（not-logged-in/login-unknown/responder-disabled）不重试——需用户操作，重试无意义。
  var DS_ASK_RETRY_DELAY = 2500;
  var DS_ASK_MAX_RETRY = 1;
  var _dsAskTryCount = 0;   // 诊断/测试：累计实际发起次数（含重试）
  var _lastDsAskReqId = ''; // 测试钩子：最近一次发出的 ds-ask reqId，供沙箱精确回包
  // 电路熔断(防 DeepSeek 卡顿致整卷冻结)：连续超时达到阈值即临时禁用 DeepSeek 问答，
  // 让后续题目立即走兜底（随机/本地），DeepSeek 恢复后自动解除。避免「全红无进展=完全卡住」。
  var DS_DEGRADE_AFTER = 2;       // 连续超时次数达到此值即熔断
  var DS_DEGRADE_MS = 120000;     // 熔断持续时长（ms），到期自动探测恢复
  var _dsConsecFails = 0;         // 当前连续超时计数（成功回传即清零）
  var _dsDegradedUntil = 0;       // 熔断到期时间戳；>now 表示当前处于熔断态
  function _dsIsDegraded() { return Date.now() < _dsDegradedUntil; }
  function _dsDegradeKick() {
    _dsDegradedUntil = Date.now() + DS_DEGRADE_MS;
    _dsConsecFails = 0; // 进入熔断即清零连续失败计数：熔断期内 fast-fail 走 quizAskDeepSeek 直接 reject（run() 不执行，不累计），
    // 故冷却结束后需从 0 重新累计连续超时才再次熔断；否则首次真实 ask 一旦超时（_dsConsecFails 仍≥2）会立即重新熔断，
    // DS 偶发卡慢时熔断将永久抖动（开 120s→一次慢 ask→再开 120s），无法真正恢复。
    bestEffort(function () { EventBus.emit('ui:toast', 'DeepSeek 持续无响应，临时跳过 ' + Math.round(DS_DEGRADE_MS / 1000) + 's 转兜底（恢复后自动解除）'); }, 'ds.degrade');
  }
  // Tier 3: catch→reject 保留（Promise reject 需正确传递错误语义）
  function _dsAskOnce(dataUrl, opts, text, context) {
    return new Promise(function (resolve, reject) {
      if (context) _quizVisionCheckContext(context);
      bestEffort(function () {
        // 幂等性修复(审查 S-1)：卸载后（命名空间已删）不再发起/继续 DS 问答——promise 悬挂，由 quiz.js 的
        // race 超时与卸载守卫兜底，杜绝卸载后在途问答对页面真实点选/提交。
        if (!(window && window.__CX_FORCE_PLAY)) return;
        _dsAskTryCount++;
        _dsLoop.asksSent++; _dsLoop.lastAskAt = Date.now();   // v4.19.37：课程页发题计数
        var reqId = 'r' + Date.now() + Math.random().toString(36).slice(2);
        _lastDsAskReqId = reqId;
        var done = false;
        var signal = context && context.signal;
        var cleanup = function () {
          clearTimeout(to); _offChannel(listener); _dsClearBridge();
          if (signal && signal.removeEventListener) signal.removeEventListener('abort', cancel);
        };
        var cancel = function () { if (done) return; done = true; cleanup(); reject(_quizVisionCancelled()); };
        var _t0 = Date.now();
        var to = _dsRegTimer(function () {   // 幂等性修复(审查 S-1)：经 TimerRegistry 登记(owner 'deepseek')，quizVisionDeepSeekStop 可取消在途超时
          if (!done) { done = true; cleanup(); _dsLoop.lastErr = 'deepseek timeout'; reject(new Error('deepseek timeout')); }
        }, (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_TIMEOUT) || 60000);
        var listener = function (e) {
          var m = e;
          if (m && m.type === 'ds-answer' && m.reqId === reqId) {
            if (done) return;
            try { if (context) _quizVisionCheckContext(context); } catch (error) { cancel(); return; }
            done = true; cleanup();   // DS 已回包，释放持久化截图
            // v4.19.37：数据循环遥测——回包计数 + 往返时延 + 错误记录
            _dsLoop.answersGot++; _dsLoop.lastAnswerAt = Date.now();
            _dsLoop.roundTrips++; _dsLoop.roundTripMs = Date.now() - _t0;
            if (m.error) { _dsLoop.lastErr = String(m.error).slice(0, 40); reject(new Error(m.error)); }
            else resolve({ text: m.text != null ? m.text : null, answer: m.answer != null ? m.answer : null });
            // v4.19.43：课程页自身记录「最近应答」与回包计数，并同步顶层帧——消除课程页诊断「最近请求=无 / 回包=0」盲区
            var _aAns = (m.answer != null ? m.answer : (m.text != null ? m.text : '已作答'));
            if (window.__CX_FORCE_PLAY) { window.__CX_FORCE_PLAY.DS_LAST_ANSWER = String(_aAns).slice(0, 48); window.__CX_FORCE_PLAY.DS_ANSWER_COUNT = (window.__CX_FORCE_PLAY.DS_ANSWER_COUNT || 0) + 1; }
            try { if (window.top && window.top !== window && window.top.__CX_FORCE_PLAY) { window.top.__CX_FORCE_PLAY.DS_LAST_ANSWER = String(_aAns).slice(0, 48); window.top.__CX_FORCE_PLAY.DS_ANSWER_COUNT = (window.top.__CX_FORCE_PLAY.DS_ANSWER_COUNT || 0) + 1; } } catch (e) {}
          }
        };
        _onChannel(listener);
        // 子帧懒建通道：确保 GM 监听在位后再发 ask（否则 ds-answer 回不来，只能干等超时）
        _dsEnsureChannel();
        if (signal && signal.addEventListener) signal.addEventListener('abort', cancel);
        try { if (context) _quizVisionCheckContext(context); } catch (error) { cancel(); return; }
        // 纯文本模式(text 非空、image 可空)：课程页直接把题干文本发给 DS，无需 html2canvas 截图（规避 CDN 被拦截）。
        // v4.19.43：课程页自身记录「最近请求」与发题计数，并同步顶层帧——消除课程页诊断「最近请求=无 / 发题=0」盲区
        // （_dsLoop.asksSent 仅本帧可读，跨帧直接聚合因 iframe 不可直访而恒 0；DS_LAST_ASK 旧逻辑只在应答端置位）。
        if (window.__CX_FORCE_PLAY) { window.__CX_FORCE_PLAY.DS_LAST_ASK = Date.now(); window.__CX_FORCE_PLAY.DS_ASK_COUNT = (window.__CX_FORCE_PLAY.DS_ASK_COUNT || 0) + 1; }
        try { if (window.top && window.top !== window && window.top.__CX_FORCE_PLAY) { window.top.__CX_FORCE_PLAY.DS_LAST_ASK = Date.now(); window.top.__CX_FORCE_PLAY.DS_ASK_COUNT = (window.top.__CX_FORCE_PLAY.DS_ASK_COUNT || 0) + 1; } } catch (e) {}
        _postChannel({ type: 'ds-ask', reqId: reqId, image: dataUrl || undefined, options: opts || [], prompt: text || undefined });
      }, 'ds.askOnce');
    });
  }
  // 课程页侧：把截图/文本交给 DeepSeek 页作答，返回 Promise<{text, answer}>（最终仍超时走 reject → quiz.js 随机兜底）
  //   text：题目文本（deepseek-web 优先用，绕开截图）；dataUrl：截图（文本不可用时的回退）。
  var _quizAskDeepSeekOverride = null;   // TEST SEAM：注入假应答（验证空白截图→text-only 兜底路径）
  function quizAskDeepSeek(dataUrl, opts, text, context) {
    try { if (context) _quizVisionCheckContext(context); } catch (error) { return Promise.reject(error); }
    if (typeof _quizAskDeepSeekOverride === 'function') return _quizAskDeepSeekOverride(dataUrl, opts, text);   // TEST SEAM
    // 电路熔断：已处于熔断态时直接快速失败，交由 quiz.js 立即随机兜底，避免整卷在 DeepSeek 卡顿下冻结
    if (_dsIsDegraded()) {
      return Promise.reject(new Error('deepseek-degraded(fast-fail)'));
    }
    // v4.19.48：应答端标签页后台时浏览器重度节流合成输入/轮询，DS 取答案必然超时——直接快速失败并明确原因，
    // 避免课程页在后台应答端上堆积超时队列（旧行为：13 题排队全 timeout）且误触熔断；前台化后 ds-state.hidden=false 自动恢复。
    if (DS_STATUS.hidden) {
      return Promise.reject(new Error('ds-responder-hidden(background-throttled)'));
    }
    var attempt = 0;
    function run() {
      try { if (context) _quizVisionCheckContext(context); } catch (error) { return Promise.reject(error); }
      // 幂等性修复(审查 S-1)：卸载后重试链不再继续（悬挂，不重复发 ds-ask）
      if (!(window && window.__CX_FORCE_PLAY)) return new Promise(function () {});
      return _dsAskOnce(dataUrl, opts, text, context)
        .then(function (res) {
          // 成功回传：连续失败计数清零、解除熔断（DeepSeek 已恢复）
          _dsConsecFails = 0; _dsDegradedUntil = 0;
          return res;
        })
        .catch(function (err) {
          if (context) _quizVisionCheckContext(context);
          // 超时类错误计入熔断（deepseek timeout / timeout-wait-reply / gen-timeout / degraded 等）；
          // 登录态等明确错误不计入（需用户操作，重试无意义）
          if (err && /timeout|deepseek-degraded/i.test(err.message || '')) {
            _dsConsecFails++;
            if (_dsConsecFails >= DS_DEGRADE_AFTER && !_dsIsDegraded()) _dsDegradeKick();
          } else {
            _dsConsecFails = 0;
          }
          // 重试覆盖所有超时类错误（deepseek timeout / timeout-wait-reply / gen-timeout 等），而非仅 'deepseek timeout'
          if (err && /timeout/i.test(err.message || '') && attempt < DS_ASK_MAX_RETRY) {
            attempt++;
            _dsLoop.retries++;   // v4.19.37：重试计数（数据循环遥测）
            return new Promise(function (res) { _dsRegTimer(res, DS_ASK_RETRY_DELAY); }).then(run);   // 幂等性修复(审查 S-1)：重试延迟经 TimerRegistry 登记，可随卸载取消
          }
          throw err;
        });
    }
    // 终端兜底：重试链中「非超时」错误经 run() 内部 .catch 重新抛出，沿此处返回给调用方；
    // 显式 .catch 声明契约（调用方 quiz.js/quiz-vision.js 已处理），避免未来调用方忽略返回值时出现未处理 rejection。
    return run().catch(function (err) { throw err; });
  }
