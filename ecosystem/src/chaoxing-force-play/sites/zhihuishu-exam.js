  // ===== 智慧树作业/考试答题主体页·题目区逻辑（v4.15 工具库项→题目区专属面板驱动） =====
  // 站点归属：智慧树/知到（detectSite()==='zhihuishu'）。
  // 为什么不放通用「工具库」区：题目区与视频续播是两套不同场景，用户要求题目区有专属面板（FAB 场景自适应），
  //   故本模块只暴露「状态 + 执行」接口，由 presentation/zhihuishu-fab.js 在题目页渲染专属面板（自动作答/自动交卷开关、DeepSeek 状态、进度），不再注册进通用工具库区。
  //
  // 【状态机 + 硬闸门】
  //   作答态 IDLE/ACTIVE、自动交卷子态 OFF/ANSWERING/READY/DONE。两类操作（作答、交卷）均被同一硬闸门锁死：
  //   未连入 DeepSeek 应答端（dsAvailable() 为假）时，isActive()/asubOn() 恒为假 —— 不做任何自动操作。
  //   FAB 题目区面板在「未连 DeepSeek」时会把开关灰禁用 + 提示，与状态机闸门双重保险。
  //
  // 【安全策略】
  //   作答：只勾选选项（依赖 DeepSeek 连接才执行；连入后当前为 best-effort 勾选，DeepSeek 智能回填待 responder 校准）。
  //   交卷：默认关；开启后自动作答所有分页、翻到末页，待「所有页答完」才进入 READY，由用户手动点「确认交卷」按钮才提交（二次确认，交卷不自动）。
  //
  // 【选择器校准】智慧树真实作业页 DOM 结构待实测，下方 best-effort 并集；若命中不到，请在控制台跑诊断脚本把真实 class 反馈微调。
  (function () {
    'use strict';

    // 幂等守卫
    if (window.__zheStarted) return;
    window.__zheStarted = true;

    // 站点隔离：智慧树专属，避免其他平台误触发
    if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'zhihuishu')) return;

    // ====================================================================
    //  A. 配置常量（选择器均为 best-effort，待真实站点校准）
    // ====================================================================
    var LS_ON = 'cx_zh_exam_on';             // 自动作答开关
    var LS_SUB = 'cx_zh_exam_autosubmit';     // 自动交卷开关
    var CFG = {
      DEBUG: false,
      URL_RE: /dohomework|webExamList|stuExamWeb|doExam|exam|homework|doHomeWork/i,
      questionSels: ['.question-item', '.quiz-item', '.topic-item', '.exam-item', 'li[class*="question"]',
                     '[class*="quiz-item"]', '.q-container', '.subject-item', '.test-item',
                     '[class*="answer-item"]', '.tk-item', '.stu-exam-question', '[class*="question-box"]'],
      optionSels: ['.option-item', '.q-option', '.choice-item', 'li[class*="option"]', '[class*="choice"]',
                   '.answer-item', 'label', '.select-item', '.tk-option', '[class*="option-item"]'],
      nextSels: ['.next-page', '.next', '.next-btn', '[class*="next"]', '[class*="page-next"]', 'a[title*="下一"]', 'a[title*="下一项"]'],
      submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn', '.tk-submit', '.btn-submit']
    };

    // ====================================================================
    //  B. DI 容器工厂
    // ====================================================================
    function createContainer() {
      var noop = function () {};
      var $log = {
        info: CFG.DEBUG ? function () { try { console.info.apply(console, ['[ZHEXAM]'].concat([].slice.call(arguments))); } catch (e) {} } : noop,
        warn: function () { try { console.warn.apply(console, ['[ZHEXAM]'].concat([].slice.call(arguments))); } catch (e) {} },
        err: function () { try { console.error.apply(console, ['[ZHEXAM]'].concat([].slice.call(arguments))); } catch (e) {} }
      };
      var $storage = {
        isOn: function () { try { return '1' === localStorage[LS_ON]; } catch (e) { return false; } },
        setOn: function (v) { try { localStorage[LS_ON] = v ? '1' : '0'; } catch (e) {} },
        isSub: function () { try { return '1' === localStorage[LS_SUB]; } catch (e) { return false; } },
        setSub: function (v) { try { localStorage[LS_SUB] = v ? '1' : '0'; } catch (e) {} },
        listen: function (fn) {
          try {
            window.addEventListener('storage', function (e) {
              if (e.key === LS_ON || e.key === LS_SUB) fn();
            });
          } catch (e) { $log.warn('storage listener failed'); }
        }
      };
      var $dom = {
        all: function (sel, root) { try { return (root || document).querySelectorAll(sel); } catch (e) { return []; } },
        one: function (sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
      };
      return { $log: $log, $storage: $storage, $dom: $dom };
    }

    // 是否位于作业/考试答题主体页
    function _isExamPage() {
      try { return CFG.URL_RE.test((window.location && window.location.href) || ''); } catch (e) { return false; }
    }
    // DeepSeek 连接闸门（硬约束）
    function _dsOk() {
      try { if (typeof dsAvailable === 'function') return !!dsAvailable(); } catch (e) {}
      return false;
    }
    // 在题目容器内筛选真正选项
    function _zheOptions(qEl, c) {
      var raw = c.$dom.all(CFG.optionSels.join(','), qEl);
      var out = [];
      if (!raw || !raw.length) return out;
      for (var i = 0; i < raw.length; i++) {
        var el = raw[i];
        if (!el) continue;
        var hasInput = el.querySelector && el.querySelector('input[type="radio"],input[type="checkbox"]');
        var cls = (el.className || '') + '';
        var isOptClass = /option|choice|answer|select/i.test(cls);
        if (hasInput || isOptClass) out.push(el);
      }
      return out;
    }
    function _zheSelect(optEl) {
      try { optEl.click(); } catch (e) {}
      try {
        var inp = optEl.querySelector ? optEl.querySelector('input[type="radio"],input[type="checkbox"]') : null;
        if (inp) { inp.checked = true; try { inp.click(); } catch (e2) {} }
      } catch (e3) {}
    }
    function _zheResolve(qEl, opts, c) {
      try {
        var stem = (qEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        var src = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random';
        if (src === 'bank') {
          var bank = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizBank) || null;
          if (!bank && typeof localStorage !== 'undefined') { try { var raw = localStorage.getItem('cx_quiz_bank'); if (raw) bank = JSON.parse(raw); } catch (e) {} }
          if (bank && typeof bank === 'object') {
            var b = bank[stem];
            if (b == null) { var keys = Object.keys(bank); for (var k = 0; k < keys.length; k++) { if (stem && stem.indexOf(keys[k]) >= 0) { b = bank[keys[k]]; break; } } }
            if (b != null) { var idx = (typeof b === 'number') ? b : parseInt(b, 10); if (idx >= 0 && idx < opts.length) return idx; }
          }
        }
        return Math.floor(Math.random() * opts.length);  // 默认 random（作业不计成绩；连 DeepSeek 智能回填待 responder 校准）
      } catch (e) { return -1; }
    }

    // 找「下一页/下一题/下一项」按钮并点击
    function _goNextPage(c) {
      try {
        var btns = c.$dom.all(CFG.nextSels.join(','), document.documentElement);
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').replace(/\s/g, '');
          if (/下一页|下一题|下一项|next/i.test(t)) { btns[i].click(); return true; }
        }
      } catch (e) {}
      return false;
    }
    // 仅探测是否存在下一页按钮（不点击），用于末页判定
    function _peekNext(c) {
      try {
        var btns = c.$dom.all(CFG.nextSels.join(','), document.documentElement);
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').replace(/\s/g, '');
          if (/下一页|下一题|下一项|next/i.test(t)) return true;
        }
      } catch (e) {}
      return false;
    }
    // 当前页所有题是否已作答（best-effort：已记入作答指纹 或 有选中输入 或 选中态 class）
    function _allAnsweredHere(c, handledSet) {
      try {
        var qs = c.$dom.all(CFG.questionSels.join(','), document.documentElement);
        if (!qs.length) return false;
        for (var i = 0; i < qs.length; i++) {
          var q = qs[i];
          // 已记入作答指纹（与 tickAnswerPage 同口径）→ 视为已作答，避免只靠 class 名猜测的漏判
          if (handledSet) {
            var _fp = 'zhe:' + ((q.textContent || '').replace(/\s+/g, '')).slice(0, 120);
            if (handledSet[_fp]) continue;
          }
          if (q.querySelector && q.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) continue;
          var opts = c.$dom.all(CFG.optionSels.join(','), q);
          var anySel = false;
          for (var j = 0; j < opts.length; j++) {
            if (/\b(active|selected|checked|on|cur)\b/i.test((opts[j].className || '') + '')) { anySel = true; break; }   // 词边界：避免 "option"/"secure" 等含 on/cur 子串误判
          }
          if (!anySel) return false;   // 该题未作答
        }
        return true;
      } catch (e) { return false; }
    }
    function _findSubmitBtn(c) {
      try {
        var btns = c.$dom.all(CFG.submitSels.join(','), document.documentElement);
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').replace(/\s/g, '');
          if (/交卷|提交作业|提交答案|提交|交卷并|save/i.test(t)) return btns[i];
        }
        // 兜底：扫所有 button 含提交语义
        var all = c.$dom.all('button', document.documentElement);
        for (var k = 0; k < all.length; k++) {
          var tt = (all[k].textContent || '').replace(/\s/g, '');
          if (/交卷|提交作业|提交答案|提交/i.test(tt)) return all[k];
        }
      } catch (e) {}
      return null;
    }

    // ====================================================================
    //  C. 状态机
    // ====================================================================
    function createStateMachine(c) {
      var IDLE = 'IDLE', ACTIVE = 'ACTIVE';
      var ASUB_OFF = 'OFF', ASUB_ANSWERING = 'ANSWERING', ASUB_READY = 'READY', ASUB_DONE = 'DONE';
      var state = IDLE;
      var asub = ASUB_OFF;
      var handled = {};   // 已勾选题目指纹去重

      function isActive() { return state === ACTIVE && _dsOk(); }          // 作答态（含 DeepSeek 闸门）
      function asubOn() { return c.$storage.isSub() && _isExamPage() && _dsOk(); }  // 自动交卷态（含 DeepSeek 闸门）

      function transition(s) { if (state !== s) { var p = state; state = s; c.$log.info('zh-exam answer state: ' + p + ' → ' + s); } }
      function asubTransition(s) { if (asub !== s) { var p = asub; asub = s; c.$log.info('zh-exam autosub state: ' + p + ' → ' + s); } }

      function sync() {
        // 作答态
        if (c.$storage.isOn() && _isExamPage() && _dsOk()) { if (state !== ACTIVE) { handled = {}; transition(ACTIVE); } }
        else { if (state === ACTIVE) { handled = {}; transition(IDLE); } }
        // 自动交卷态：DONE 保持（交卷后不自动回 ANSWERING，避免重复作答/交卷）；仅 OFF→ANSWERING 重新进入
        if (asubOn()) { if (asub === ASUB_OFF) asubTransition(ASUB_ANSWERING); }
        else asubTransition(ASUB_OFF);
      }

      // —— 作答：勾选当前页所有题（依赖 isActive 闸门）——
      function tickAnswerPage() {
        if (!isActive()) return 0;
        var n = 0, h = handled;
        var qs = c.$dom.all(CFG.questionSels.join(','), document.documentElement);
        for (var i = 0; i < qs.length; i++) {
          var qEl = qs[i];
          if (!qEl) continue;
          var fp = 'zhe:' + ((qEl.textContent || '').replace(/\s+/g, '')).slice(0, 120);
          if (h[fp]) continue;
          var opts = _zheOptions(qEl, c);
          if (!opts.length) continue;
          var idx = _zheResolve(qEl, opts, c);
          if (idx < 0 || idx >= opts.length) idx = Math.floor(Math.random() * opts.length);
          _zheSelect(opts[idx]);
          h[fp] = true;
          n++;
        }
        if (n) { try { Store.emit('ui:toast', '已自动勾选 ' + n + ' 题（未提交，请手动交卷）'); } catch (e) {} }
        return n;
      }

      // —— 自动交卷：每轮由主循环调用，不自动交卷（交卷需用户确认）——
      function autoSubmitTick() {
        if (!asubOn()) { asubTransition(ASUB_OFF); return; }
        if (asub === ASUB_DONE) return;
        var last = !_peekNext(c);
        if (!last) {
          // 非末页：当前页答完则翻页
          if (_allAnsweredHere(c)) _goNextPage(c);
          asubTransition(ASUB_ANSWERING);
        } else {
          // 末页：当前页所有题答完 → READY（等用户确认交卷）
          if (_allAnsweredHere(c, handled)) asubTransition(ASUB_READY);
          else asubTransition(ASUB_ANSWERING);
        }
      }
      function submitNow() {
        if (asub !== ASUB_READY) return false;     // 仅 READY（所有页答完）才允许交卷
        var b = _findSubmitBtn(c);
        if (b) { try { b.click(); asubTransition(ASUB_DONE); return true; } catch (e) {} }
        return false;
      }

      function getState() {
        return {
          ds: _dsOk(),
          answering: state === ACTIVE,
          asub: asub,
          lastPage: !_peekNext(c),
          allAnswered: _allAnsweredHere(c, handled),
          confirmReady: asub === ASUB_READY
        };
      }

      return {
        isActive: isActive, sync: sync, tickAnswerPage: tickAnswerPage,
        autoSubmitTick: autoSubmitTick, submitNow: submitNow, getState: getState
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

      function reSync() { sm.sync(); }
      reSync();
      c.$storage.listen(reSync);
      try {
        window.addEventListener('hashchange', reSync);
        var _op = history.pushState, _or = history.replaceState;
        history.pushState = function () { var r = _op.apply(this, arguments); reSync(); return r; };
        history.replaceState = function () { var r = _or.apply(this, arguments); reSync(); return r; };
      } catch (e) {}

      c.$log.info('v4.15 zhihuishu-exam booted');
    }

    setTimeout(bootstrap, 300);
  })();
