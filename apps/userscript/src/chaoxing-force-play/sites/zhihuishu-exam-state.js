// @requires: EventBus, bestEffort, safeGet
// @source-group: sites/zhihuishu-exam.js
// 智慧树题目区闭包续段：答题/待交卷状态机及启动挂载。
// 必须紧接 zhihuishu-exam.js；保留其 CFG/DOM 助手闭包，本段关闭原 IIFE。
    // ====================================================================
    //  C. 状态机
    // ====================================================================
    function createStateMachine(c) {
      var IDLE = 'IDLE', ACTIVE = 'ACTIVE';
      var ASUB_OFF = 'OFF', ASUB_ANSWERING = 'ANSWERING', ASUB_READY = 'READY', ASUB_DONE = 'DONE';
      var state = IDLE;
      var asub = ASUB_OFF;
      var handled = {};   // 已勾选题目指纹去重
      var submitting = false;            // 交卷防重入锁
      var _lastSubmitTs = 0;            // 最近一次成功交卷时间戳（与 submitting 锁双重防极端竞态）
      var _SUBMIT_MIN_GAP = 1500;       // 交卷最小间隔（ms）：防止 click 同步冒泡/双击造成二次提交
      var _listeners = [];               // onStateChange 订阅者
      var _errBox = [];                  // 最近错误黑匣子（DEBUG 下可观测，最多保留 10 条）
      var _lastActive = null, _lastSub = null, _lastSubFlag = null;  // 状态变更去重（同值不重复 emit）
      var _lastSyncTs = 0, _SYNC_MIN_GAP = 120;  // sync 节流（ms）：history 事件在 SPA 中可密集触发

      // 优化点5#3：状态查询跨函数复用（无 TTL，避免同步帧内过期）。autoSubmitTick 每轮实时计算并写入 _zheComputed；
      // getState 由 _emitIfChanged 在 autoSubmitTick 改态后同帧调用，复用共享结果，消除 getState 每 tick 二次全文档扫描。
      // getState 独立调用时若尚未计算则实时兜底一次，保证始终可读（最多落后一个 autoSubmitTick）。
      var _zheComputed = { lastPage: null, allAnswered: null, progress: null };
      function _zhePeekNext(c) { var v = _peekNext(c); _zheComputed.lastPage = v; return v; }
      function _zheAllAnswered(c, handledSet) { var v = _allAnsweredHere(c, handledSet); _zheComputed.allAnswered = v; return v; }
      // 进度统计（新增·面板进度条用）：当前页题目总数 / 已作答数（按 handled 命中判定，与漏题修复同源指纹 _zheFp）
      function _zheProgress(c) {
        if (_zheComputed.progress) return _zheComputed.progress;
        var pr = safeGet(function () {
          var qs = c.$dom.all(CFG.questionSels.join(','), document.documentElement);
          var total = qs.length, answered = 0, h = handled;
          for (var i = 0; i < total; i++) { if (h[_zheFp(qs[i])]) answered++; }
          return { total: total, answered: answered };
        }, { total: 0, answered: 0 });
        _zheComputed.progress = pr;
        return pr;
      }

      // 错误黑匣子：记录最近 N 条异常（含来源），便于排错；DEBUG 模式下额外向控制台冒泡
      function _recordErr(e, where) {
        bestEffort(function () {
          var msg = (e && e.message) ? e.message : ('' + e);
          _errBox.push({ ts: Date.now(), where: where || '', msg: msg });
          if (_errBox.length > 10) _errBox.shift();
          if (CFG.DEBUG) { bestEffort(function () { console.error('[ZHEXAM]' + (where ? '(' + where + ')' : '') + ': ' + msg); }, 'zhex.err.log'); }
        }, 'zhex.err');
      }

      function isActive() { return state === ACTIVE && _dsOk(); }          // 作答态（含 DeepSeek 闸门）

      // —— 可观测诊断：闸门拦停时发射事件（§1.1 修复静默空转） ——
      // diagDS: 上次 ds 可连接状态；diagBlockedReason: 最后一条拦停原因；仅在阈值内去重发射
      var _diagDS = true, _diagBlocked = '', _diagLastTs = 0, _DIAG_MIN_GAP = 8000;
      function _emitDiag(reason) {
        var now = Date.now();
        if (reason === _diagBlocked && now - _diagLastTs < _DIAG_MIN_GAP) return;
        _diagBlocked = reason; _diagLastTs = now;
        bestEffort(function () {
          c.$log.info('zh-exam blocked: ' + reason);
          if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('zhExam:diag', { reason: reason });
        }, 'zhex.diag.emit');
      }

      // 自动交卷态判定（含 DeepSeek 闸门）。DS/页面态来自事件更新（_dsOk 闸门 + 实时 _isExamPage()），不在此同步重算。
      // 关键修复：用实时 _isExamPage() 而非任何缓存快照。智慧树翻页/切题为局部 DOM 刷新(不走 history)，
    // onRoute 不会触发，缓存可能永远停在初始化时的 false，导致自动交卷子态卡死在 OFF。
    // 与 sync() 的作答态判定口径统一为实时 location，保证任意翻页方式都能进入 ANSWERING→READY。
    function asubOn() { return c.$storage.isSub() && _isExamPage() && _dsOk(); }

      function transition(s) { if (state !== s) { var p = state; state = s; c.$log.info('zh-exam answer state: ' + p + ' → ' + s); _emitIfChanged(); } }
      function asubTransition(s) { if (asub !== s) { var p = asub; asub = s; c.$log.info('zh-exam autosub state: ' + p + ' → ' + s); _emitIfChanged(); } }

      // 状态变更可观测：仅在真正变化时 emit，避免刷屏。
      // 去重键含 submitting（交卷防重入锁），否则 submitting 翻转（用户点确认→true）不触发 emit，
      // 订阅者拿不到实时交卷态。
      function _emitIfChanged() {
        var a = (state === ACTIVE), s = asub, sub = submitting;
        if (a === _lastActive && s === _lastSub && sub === _lastSubFlag) return;
        _lastActive = a; _lastSub = s; _lastSubFlag = sub;
        var snap = getState();
        bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('zh-exam:state', snap); }, 'zhex.emit');
        for (var i = 0; i < _listeners.length; i++) { (function (fn) { bestEffort(function () { fn(snap); }, 'zhex.onChange'); })(_listeners[i]); }
      }
      function onStateChange(fn) { if (typeof fn === 'function') _listeners.push(fn); }
      function offStateChange(fn) { for (var i = _listeners.length - 1; i >= 0; i--) { if (_listeners[i] === fn) { _listeners.splice(i, 1); break; } } }

      function sync() {
        // 节流：history.pushState/replaceState 在 SPA 中可能短时间内密集触发，合并更新
        var now = Date.now();
        if (now - _lastSyncTs < _SYNC_MIN_GAP) { if (!_syncTimer) _syncTimer = setTimeout(function () { _syncTimer = null; sync(); }, _SYNC_MIN_GAP); return; }
        _lastSyncTs = now;
        // 作答态
        var _on = c.$storage.isOn(), _exam = _isExamPage();
        if (_on && _exam && _dsOk()) {
          if (state !== ACTIVE) { handled = {}; _zheComputed.progress = null; transition(ACTIVE); }
          _diagDS = true;  // DS 可用，清除拦停标记
        } else {
          if (state === ACTIVE) { handled = {}; _zheComputed.progress = null; transition(IDLE); }
          // 闸门拦停诊断（§1.1 静默空转可观测化）
          if (_on && _exam && !_dsOk()) _emitDiag('ds-unavailable');  // 开关 ON 但在考试页，DeepSeek 未连
          else if (_on && !_exam && !_dsOk()) _emitDiag('no-ds-no-exam');  // DS 未连且不在考试页
          else if (_on && !_exam) _emitDiag('not-exam-page');      // 开关 ON 但不在考试页（DS 已连）
        }
        _diagDS = _dsOk(); // 跟踪 DS 连接状态
        // 自动交卷态：
        //   - DONE 保持（交卷后不自动回 ANSWERING，避免重复作答/交卷）
        //   - READY 保持：所有页已答完即视为可交卷，不依赖实时 DS 闸门（选项已勾在 DOM）；
        //     否则 DS 短暂断连会把 READY 打回 OFF，导致"已答完却因 DS 断连无法交卷"的入口死锁。
        //   - 仅 OFF→ANSWERING 受 asubOn()（开关+考试页+DS）闸门约束
        if (asub === ASUB_DONE || asub === ASUB_READY) { /* 保持，不退回 */ }
        else if (asubOn()) { if (asub === ASUB_OFF) asubTransition(ASUB_ANSWERING); }
        else asubTransition(ASUB_OFF);
      }
      var _syncTimer = null;

      // —— 作答：勾选当前页所有题（依赖 isActive 闸门）——
      function tickAnswerPage() {
        if (!isActive()) {
          // ①可观测性：作答被拦停时，给调用方返回拦停原因（§1.1）
          if (state !== ACTIVE && c.$storage.isOn() && _isExamPage() && !_dsOk()) _emitDiag('tick-ds-unavailable');
          return 0;
        }
        var n = 0, h = handled;
        var qs = c.$dom.all(CFG.questionSels.join(','), document.documentElement);
        for (var i = 0; i < qs.length; i++) {
          var qEl = qs[i];
          if (!qEl) continue;
          var fp = _zheFp(qEl);
          if (h[fp]) continue;
          var opts = _zheOptions(qEl, c);
          if (!opts.length) continue;
          var idx = _zheResolve(qEl, opts, c);
          if (idx < 0 || idx >= opts.length) idx = Math.floor(Math.random() * opts.length);
          _zheSelect(opts[idx]);
          h[fp] = true; _zheComputed.progress = null;
          n++;
        }
        if (n) { bestEffort(function () { EventBus.emit('ui:toast', '已自动勾选 ' + n + ' 题（未提交，请手动交卷）'); }, 'zhex.toast.tick'); }
        return n;
      }

      // —— 自动交卷：每轮由主循环调用，不自动交卷（交卷需用户确认）——
      function autoSubmitTick() {
        // READY/DONE 保持：已答完即视为可交卷，不依赖实时 DS 闸门（选项已在 DOM），避免被 asubOn() 打回 OFF
        if (asub === ASUB_READY || asub === ASUB_DONE) return;
        if (!asubOn()) { asubTransition(ASUB_OFF); return; }
        var last = !_zhePeekNext(c);
        if (!last) {
          // 非末页：当前页答完则翻页；翻页成功后清空作答指纹，避免跨页同题干片段误判"已答"而漏答
          if (_zheAllAnswered(c)) { if (_goNextPage(c)) { handled = {}; _zheComputed.progress = null; } }
          asubTransition(ASUB_ANSWERING);
        } else {
          // 末页：当前页所有题答完 → READY（等用户确认交卷）
          if (_zheAllAnswered(c, handled)) asubTransition(ASUB_READY);
          else asubTransition(ASUB_ANSWERING);
        }
      }
      // 交卷：返回 Promise，带 submitting 防重入锁，避免快速重复点击/并发提交导致重复交卷
      function submitNow() {
        if (asub !== ASUB_READY) return Promise.resolve(false);   // 仅 READY（所有页答完）才允许交卷
        if (submitting) return Promise.resolve(false);            // 防重入：正在提交则忽略重复请求
        var _now = Date.now();
        if (_now - _lastSubmitTs < _SUBMIT_MIN_GAP) return Promise.resolve(false); // 极端竞态（click 冒泡/双击）二次保护
        submitting = true;
        return new Promise(function (resolve) {
          var b = _findSubmitBtn(c);
          if (!b) { submitting = false; resolve(false); return; }
          try {
            b.click();
            asubTransition(ASUB_DONE);
            _lastSubmitTs = Date.now();
            c.$log.info('zh-exam submit clicked (DONE)');
            submitting = false;   // NEW-1 修复：成功路径同样释放防重入锁（失败路径已在 catch 释放），避免锁永久卡死导致状态误报
            resolve(true);
          } catch (e) {
            submitting = false;   // 失败释放锁，允许重试（幂等：非 READY 即拒，不会重复交卷）
            _recordErr(e, 'submitNow');
            c.$log.err('zh-exam submit failed: ' + (e && e.message));
            resolve(false);
          }
        });
      }

      function getState() {
        return {
          ds: _dsOk(),
          answering: state === ACTIVE,
          asub: asub,
          submitting: submitting,
          lastPage: (_zheComputed.lastPage !== null) ? _zheComputed.lastPage : !_peekNext(c),
          allAnswered: (_zheComputed.allAnswered !== null) ? _zheComputed.allAnswered : _allAnsweredHere(c, handled),
          confirmReady: asub === ASUB_READY,
          progress: _zheProgress(c)
        };
      }

      return {
        isActive: isActive, sync: sync, tickAnswerPage: tickAnswerPage,
        autoSubmitTick: autoSubmitTick, submitNow: submitNow, getState: getState,
        onStateChange: onStateChange, offStateChange: offStateChange,
        lastErrors: function () { return _errBox.slice(); }
      };
    }

    // ====================================================================
    //  D. 启动入口（暴露接口给主循环 + FAB 题目区面板）
    // ====================================================================
    function bootstrap() {
      var c = createContainer();
      var sm = createStateMachine(c);

      window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
      window.__CX_FORCE_PLAY.zhihuishuExamEnabled = function () { return sm.isActive(); };
      window.__CX_FORCE_PLAY.zhihuishuExamTick = function () { return sm.tickAnswerPage(); };
      window.__CX_FORCE_PLAY.zhihuishuExamAutoSubmitTick = function () { sm.autoSubmitTick(); };
      window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow = function () { return sm.submitNow(); };
      window.__CX_FORCE_PLAY.zhihuishuExamState = function () { return sm.getState(); };
      window.__CX_FORCE_PLAY.zhihuishuExamOnStateChange = function (fn) { sm.onStateChange(fn); };
      window.__CX_FORCE_PLAY.zhihuishuExamOffStateChange = function (fn) { sm.offStateChange(fn); };
      window.__CX_FORCE_PLAY.zhihuishuExamLastErrors = function () { return sm.lastErrors(); };

      function reSync() { sm.sync(); }
      reSync();
      c.$storage.listen(reSync);
      bestEffort(function () {
        window.addEventListener('hashchange', reSync);
        function onRoute() { reSync(); }
        window.addEventListener('popstate', onRoute);
        var _op = history.pushState, _or = history.replaceState;
        history.pushState = function () { var r = _op.apply(this, arguments); onRoute(); return r; };
        history.replaceState = function () { var r = _or.apply(this, arguments); onRoute(); return r; };
      }, 'zhex.bootstrap.events');

      var _ver = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.version) || '?';
      c.$log.info('v' + _ver + ' zhihuishu-exam booted');
    }

    setTimeout(bootstrap, 300);
  })();
