// @requires: CONFIG, _dsLastReplyBefore, _dsLoop, _dsRegTimer, _onChannel, _postChannel, bestEffort, detectSite
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：应答端队列、去重、看门狗与出清；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // ---- DeepSeek 页侧 responder：收到答题请求 → 检查登录 → 驱动 DOM 作答 → 回传 ----
  // 校准后的 DOM 驱动（选择器在真实 DeepSeek 页用 DevTools 校准；用户已提供输入框选择器）：
  //   输入框：textarea[placeholder^="给 DeepSeek 发送消息"]（或其容器 textarea，统一用 [contenteditable] 与 textarea 兜底）
  //   发送按钮：底部发送按钮（button，aria-label 含"发送"/"send"，或存在 svg 的最后一个主按钮）—— best-effort 待校准
  //   回复气泡：对话区消息容器（[role="list"]/聊天容器）末尾最后一条 AI 回复，且非用户输入
  //   生成中：回复气泡内出现"正在生成…/DeepSeek 正在思考"等占位或 loading 转圈 → 轮询等待消失
  // 并发护栏：处理中的 ask 不重入（避免同一题被重复上传/重复作答）；处理期间到达的新 ask 入 FIFO 队列，结束后依次续接；
  // 相同 reqId 的重复投递（多标签/多监听器）去重，彻底消除"数据上传一直重复"。
  // 注：队列必须为 FIFO（先后入队依次处理），不可为单槽覆盖——单槽只存最新一个会导致并发多题时中间题 ask 被覆盖丢失，
  //     被覆盖的题在课程页侧超时→重试→DS 反复收到同一题截图（"重复问同一题"），而另一些题永远轮不到作答（"漏答一题"）。
  var _dsResponding = false;
  var _dsAskQueue = [];
  var _dsLastReqId = '';
  var _dsWatchdogTimer = null;    // v4.19.34 稳定性看门狗句柄（应答端楔死自愈）
  var _dsCurrentReqId = '';       // 当前处理中的 ask reqId（看门狗超时回包用）
  // v4.19.49：应答器关键动作写入「提示流」（经 public pushToastFeed），使应答端页「复制诊断·[15]提示流」
  // 可追溯收题/回包/看门狗/去重/丢队等历史（此前这些事件不入 toast 链路 → 提示流恒空）。
  function _dsFeed(msg, lvl) {
    bestEffort(function () {
      if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.pushToastFeed === 'function') window.__CX_FORCE_PLAY.pushToastFeed(msg, lvl);
    }, 'ds.feed');
  }
  // v4.19.50：应答端「完全出清」（等同刷新页面）——视频播放通知触发。清空应答器队列/处理态/看门狗/熔断态、
  // 最近请求应答/远程灯镜像/计数（保留 writes 流量统计），使新一段答题从零开始。
  function _dsEvictAll(reason) {
    bestEffort(function () {
      if (_dsWatchdogTimer) { try { clearTimeout(_dsWatchdogTimer); } catch (e) {} _dsWatchdogTimer = null; }
      _dsResponding = false;
      _dsAskQueue.length = 0;
      _dsCurrentReqId = ''; _dsLastReqId = '';
      _dsDegradedUntil = 0; _dsConsecFails = 0;   // 熔断态解除
      _dsStreamStable = ''; _dsLastReplyBefore = '';
      // 计数归零（保留 writes/lastWriteAt 流量统计）
      ['asksSent', 'answersGot', 'retries', 'roundTrips', 'roundTripMs', 'received', 'sent', 'watchdog', 'dedupe', 'qdrop', 'lastAskAt', 'lastAnswerAt'].forEach(function (k) { _dsLoop[k] = 0; });
      _dsLoop.lastErr = '';
      if (window.__CX_FORCE_PLAY) {
        window.__CX_FORCE_PLAY.DS_LAST_ASK = 0;
        window.__CX_FORCE_PLAY.DS_LAST_ANSWER = '';
        window.__CX_FORCE_PLAY.DS_ASK_COUNT = 0;
        window.__CX_FORCE_PLAY.DS_ANSWER_COUNT = 0;
        window.__CX_FORCE_PLAY.quizLightsRemote = null;
        window.__CX_FORCE_PLAY.quizLightsRemoteTs = 0;
        window.__CX_FORCE_PLAY._dsLastAskHadImage = undefined;
      }
      _dsFeed('应答端已完全出清（' + (reason || '外部通知') + '，等同刷新页面）', 'warn');
    }, 'ds.evictAll');
  }
  // v4.19.50：应答端监听「视频播放出清」GM 通知键（cx_quiz_evict_v1，由课程页 main-loop 写入；仅 DS 站点注册，
  // 课程页各帧自身经 quiz.js 的等价监听执行 quizHardReset，不重复清理）。
  var _dsEvictGmId = null;
  function _dsInstallEvictGM() {
    bestEffort(function () {
      if (_dsEvictGmId != null || typeof GM_addValueChangeListener !== 'function') return;
      try { if (typeof detectSite === 'function' && detectSite() !== 'deepseek') return; } catch (e) {}
      _dsEvictGmId = GM_addValueChangeListener('cx_quiz_evict_v1', function (name, oldV, newV, remote) {
        if (!remote || !newV) return;
        // v4.19.50 复核·开关守卫：本页关闭 QUIZ_EVICT_ON_VIDEO_PLAY 时不响应（否则关开关无效）
        if (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_EVICT_ON_VIDEO_PLAY === false) return;
        _dsEvictAll('video-play');
      });
    }, 'ds.evictGmInit');
  }
  function _dsInitResponder() {
    bestEffort(function () {
      _dsInstallEvictGM();   // v4.19.50：应答端注册视频播放出清 GM 监听（仅 DS 页）
      _onChannel(function (e) {
        bestEffort(function () {
          var m = e;
          if (!m || m.type !== 'ds-ask') return;
          _dsLoop.received++; _dsLoop.lastAskAt = Date.now();   // v4.19.37：应答端收题计数
          if (m.reqId === _dsLastReqId) { _dsLoop.dedupe++; _dsFeed('收到重复题目请求，已去重', 'warn'); return; }        // 同一请求重复投递去重
          // v4.19.34 队列上限：楔死窗口（≤90s 看门狗）内持续涌入时丢弃最旧，防内存与积压失控
          if (_dsAskQueue.length > 30) { _dsAskQueue.shift(); _dsLoop.qdrop++; _dsFeed('答题队列已满，丢弃最旧 1 条', 'warn'); }   // v4.19.37：队列丢弃计数
          if (_dsResponding) { _dsAskQueue.push(m); _dsFeed('收到题目请求，已排队（当前队列 ' + _dsAskQueue.length + '，处理中）'); return; } // 处理中：入 FIFO 队列，结束后依次续接（避免并发多题时中间题被覆盖丢失）
          _dsFeed('开始处理题目请求（队列 ' + _dsAskQueue.length + '）');
          _dsRunRespond(m);
        }, 'ds.responder.channel');
      });
    }, 'ds.responder');
  }
  function _dsRunRespond(m) {
    _dsResponding = true;
    _dsCurrentReqId = m.reqId;
    _dsLastReqId = m.reqId;
    if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._dsLastAskHadImage = !!(m && m.image);  // v4.19.42：题目载荷是否含截图（纯文本模式标志，供应答端控制台呈现）
    var _finish = function (ans) {
      // v4.19.34：settle 先取消看门狗
      if (_dsWatchdogTimer) { try { clearTimeout(_dsWatchdogTimer); } catch (e) {} _dsWatchdogTimer = null; }
      // v4.19.37：回包计数 + 最近回包时间 + 错误记录
      _dsLoop.sent++; _dsLoop.lastAnswerAt = Date.now();
      if (ans && ans.error) _dsLoop.lastErr = String(ans.error).slice(0, 40);
      // v4.19.49：截断 DS_LAST_ANSWER（旧存完整回复文本 → 诊断 [5]「最近请求」内联 500+ 字思维链撑爆可读性）；
      // 完整回复已可在应答端提示流（_dsFeed「已回传答案」）追溯，此处仅留摘要。
      bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_LAST_ANSWER = ans ? String(ans.text || ans.answer || '已作答').slice(0, 48) : '未获取到回复'; }, 'ds.resp.lastAnswer');
      // v4.19.49：回传结果写入提示流（应答端页「复制诊断·[15]」可追溯）
      if (ans && ans.error) {
        var _errTxt = ({ 'responder-disabled': '应答端已暂停，已拒绝课程页请求', 'not-logged-in': '未登录 DeepSeek，已拒绝请求', 'login-unknown': '登录态未识别，已拒绝请求', 'timeout-wait-reply': '应答超时（看门狗 90s），已强制续接队列' })[ans.error] || ('回传失败：' + ans.error);
        _dsFeed(_errTxt, 'warn');
      } else {
        _dsFeed('已回传答案：' + String(ans && (ans.answer != null ? ans.answer : (ans.text || ''))).slice(0, 40));
      }
      _postChannel(ans || { type: 'ds-answer', reqId: m.reqId, error: 'no-answer' });
      _dsResponding = false;
      var q = _dsAskQueue.shift();   // FIFO：取最早入队的下一个，依次续接，不再互相覆盖
      if (q) _dsRunRespond(q);
    };
    var reply = { type: 'ds-answer', reqId: m.reqId };
    if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED === false) { reply.error = 'responder-disabled'; _finish(reply); return; }
    if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_LAST_ASK = Date.now();
    var _li = _dsIsLoggedIn();
    if (_li === false) { reply.error = 'not-logged-in'; _finish(reply); return; }
    if (_li === undefined) { reply.error = 'login-unknown'; _finish(reply); return; }
    // v4.19.34 稳定性看门狗：`_dsRespond` 内部同步异常被 bestEffort 吞掉时 `_finish` 永不调用 →
    // `_dsResponding` 恒 true → FIFO 永久停摆（后续所有题超时变红，用户实测「截屏题目不稳定」）。
    // 90s（=课程页 ask 预算）强制释放并续接队列，单题异常后自愈。
    if (_dsWatchdogTimer) { try { clearTimeout(_dsWatchdogTimer); } catch (e) {} }
    _dsWatchdogTimer = _dsRegTimer(function () {
      _dsWatchdogTimer = null;
      if (!_dsResponding) return;
      _dsLoop.watchdog++;   // v4.19.37：看门狗触发计数
      _dsFeed('应答超时，已强制续接队列（看门狗 90s）', 'warn');
      bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_LAST_ANSWER = '应答端看门狗超时（已强制续接队列）'; }, 'ds.watchdog.lastAnswer');
      _postChannel({ type: 'ds-answer', reqId: _dsCurrentReqId, error: 'timeout-wait-reply' });
      _dsResponding = false;
      var q = _dsAskQueue.shift();
      if (q) _dsRunRespond(q);
    }, 90000);
    _dsRespond(m, _finish);
  }
