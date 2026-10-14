// @requires: CONFIG, CX_KEYS, bestEffort, dsAvailable, lsFlag, lsSetFlag, safeGet
// @source-group: sites/zhihuishu-exam.js
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

    // 站点隔离：智慧树专属，避免其他平台误触发（必须首判，否则幂等标志被遗留注入污染后接口静默失效）
    if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'zhihuishu')) return;

    // 幂等守卫（站点判定后置，确保非智慧树页面不占 __zheStarted 而阻止后续正确注入）
    if (window.__CX_ZHE_STARTED) return;
    window.__CX_ZHE_STARTED = true;

    // ====================================================================
    //  A. 配置常量（选择器均为 best-effort，待真实站点校准）
    // ====================================================================
    var LS_ON = CX_KEYS.ZH_EXAM_ON;             // 自动作答开关
    var LS_SUB = CX_KEYS.ZH_EXAM_AUTO_SUBMIT;     // 自动交卷开关
    var CFG = {
      DEBUG: false,
      // 关键词须落在 path 段边界（前为 ^ 或 /），且其后不为字母/数字，避免 example / homeworking 误中
      URL_RE: /(^|\/)(dohomework|webExamList|stuExamWeb|doExam|examList|onlineExam|exam|homework|doHomeWork)(?![a-z0-9])/i,
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
        info: CFG.DEBUG ? function () { bestEffort(function () { console.info.apply(console, ['[ZHEXAM]'].concat(Array.from(arguments))); }, 'zhex.log.info'); } : noop,
        warn: function () { bestEffort(function () { console.warn.apply(console, ['[ZHEXAM]'].concat(Array.from(arguments))); }, 'zhex.log.warn'); },
        err: function () { bestEffort(function () { console.error.apply(console, ['[ZHEXAM]'].concat(Array.from(arguments))); }, 'zhex.log.err'); }
      };
      var $storage = {
        isOn: function () { return lsFlag(LS_ON, false); },
        setOn: function (v) { lsSetFlag(LS_ON, v); },
        isSub: function () { return lsFlag(LS_SUB, false); },
        setSub: function (v) { lsSetFlag(LS_SUB, v); },
        listen: function (fn) {
          bestEffort(function () {
            window.addEventListener('storage', function (e) {
              if (e.key === LS_ON || e.key === LS_SUB) fn();
            });
          }, 'zhex.storage.listen');
        }
      };
      var $dom = {
        all: function (sel, root) { return safeGet(function () { return (root || document).querySelectorAll(sel); }, []); },
        one: function (sel, root) { return safeGet(function () { return (root || document).querySelector(sel); }, null); }
      };
      return { $log: $log, $storage: $storage, $dom: $dom };
    }

    // 是否位于作业/考试答题主体页
    function _isExamPage() {
      return safeGet(function () { return CFG.URL_RE.test((window.location && window.location.href) || ''); }, false);
    }
    function _dsOk() {
      return safeGet(function () { if (typeof dsAvailable === 'function') return !!dsAvailable(); return false; }, false);
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
      bestEffort(function () { optEl.click(); }, 'zhex.select.click');
      bestEffort(function () {
        var inp = optEl.querySelector ? optEl.querySelector('input[type="radio"],input[type="checkbox"]') : null;
        if (inp) { inp.checked = true; bestEffort(function () { inp.click(); }, 'zhex.select.inpClick'); }
      }, 'zhex.select.inp');
    }
    function _zheResolve(qEl, opts, c) {
      return safeGet(function () {
        var stem = (qEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        var src = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random';
        if (src === 'bank') {
          var bank = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizBank) || null;
          if (!bank && typeof localStorage !== 'undefined') { var raw = safeGet(function () { return localStorage.getItem(CX_KEYS.QUIZ_BANK); }, null); if (raw) bank = safeGet(function () { return JSON.parse(raw); }, null); }
          if (bank && typeof bank === 'object') {
            var b = bank[stem];
            if (b == null) { var keys = Object.keys(bank); for (var k = 0; k < keys.length; k++) { if (stem && stem.indexOf(keys[k]) >= 0) { b = bank[keys[k]]; break; } } }
            if (b != null) { var idx = (typeof b === 'number') ? b : parseInt(b, 10); if (idx >= 0 && idx < opts.length) return idx; }
          }
        }
        return Math.floor(Math.random() * opts.length);
      }, -1);
    }

    // 找「下一页/下一题/下一项」按钮并点击
    function _goNextPage(c) {
      return safeGet(function () {
        var btns = c.$dom.all(CFG.nextSels.join(','), document.documentElement);
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').replace(/\s/g, '');
          if (/下一页|下一题|下一项|next/i.test(t)) { btns[i].click(); return true; }
        }
        return false;
      }, false);
    }
    // 优化点5#2+：题目文本指纹记忆化（WeakMap 按元素缓存，元素被移除即回收，天然无失效问题）。
    // 修复「漏题」：旧版仅取题干前 120 字，同章同题型多题前缀相同即碰撞 → 后题被 handled 命中跳过不勾。
    // 现加题号(seq) + 选项全量签名 → 碰撞概率极低（与 quiz.js _quizFingerprint 同口径 P1-7）。
    var _zheTextCache = new WeakMap();
    function _zheFp(el) {
      var v = _zheTextCache.get(el);
      if (v !== undefined) return v;
      var fp = safeGet(function () {
        var txt = (el.textContent || '').replace(/\s+/g, '');
        var seq = 0;
        var m = txt.match(/^(\d{1,4})[.、)）]/);
        if (!m) { var m2 = txt.match(/(?:^|\s)第\s*(\d{1,4})\s*题/); if (m2) m = m2; }
        if (m && +m[1] > 0 && +m[1] < 10000) seq = +m[1];
        var optsTxt = '';
        try {
          var oEls = el.querySelectorAll(CFG.optionSels.join(','));
          for (var i = 0; i < oEls.length; i++) optsTxt += (oEls[i].textContent || '').replace(/\s+/g, '');
        } catch (e) {}
        return 'zhe:' + seq + ':' + txt.slice(0, 480) + '#' + optsTxt.slice(0, 480);
      }, 'zhe:err');
      _zheTextCache.set(el, fp);
      return fp;
    }

    function _peekNext(c) {
      return safeGet(function () {
        var btns = c.$dom.all(CFG.nextSels.join(','), document.documentElement);
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').replace(/\s/g, '');
          if (/下一页|下一题|下一项|next/i.test(t)) return true;
        }
        return false;
      }, false);
    }
    function _allAnsweredHere(c, handledSet) {
      return safeGet(function () {
        var qs = c.$dom.all(CFG.questionSels.join(','), document.documentElement);
        if (!qs.length) return false;
        for (var i = 0; i < qs.length; i++) {
          var q = qs[i];
          if (handledSet) {
            var _fp = _zheFp(q);
            if (handledSet[_fp]) continue;
          }
          // 修复「总在最后一道题掉链子」：与 tickAnswerPage 口径一致——引擎不可作答的题（无选项：主观/填空/问答，需用户手填）
          // 不计入"未作答"，否则考试/作业常以一道主观题收尾 → _allAnsweredHere 恒返 false → 永远进不了 READY → 无法交卷。
          // 此类题由用户在最终手动提交前自行填写，不阻塞 READY。
          var _optsAll = c.$dom.all(CFG.optionSels.join(','), q);
          if (!_optsAll.length) continue;
          if (q.querySelector && q.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) continue;
          var anySel = false;
          for (var j = 0; j < _optsAll.length; j++) {
            if (/\b(active|selected|checked|on|cur)\b/i.test((_optsAll[j].className || '') + '')) { anySel = true; break; }
          }
          if (!anySel) return false;
        }
        return true;
      }, false);
    }
    function _findSubmitBtn(c) {
      return safeGet(function () {
        var btns = c.$dom.all(CFG.submitSels.join(','), document.documentElement);
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || '').replace(/\s/g, '');
          if (/交卷|提交作业|提交答案|提交|交卷并|save/i.test(t)) return btns[i];
        }
        var all = c.$dom.all('button', document.documentElement);
        for (var k = 0; k < all.length; k++) {
          var tt = (all[k].textContent || '').replace(/\s/g, '');
          if (/交卷|提交作业|提交答案|提交/i.test(tt)) return all[k];
        }
        return null;
      }, null);
    }

