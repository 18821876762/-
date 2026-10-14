// @requires: bestEffort, detectSite, popupQuizTick, registerPopupQuizEnded, registerSiteTick, safeGet
  // ===== DOMAIN: biz/zhihuishu (Zhihuishu / 智慧树-知到 专属业务) =====
  // ===== MODULE: 智慧树上课弹窗题目自动处理（随机选选项→点击答题→删除弹窗） =====
  // 域：业务模块 —— 智慧树(知到)专属，与超星(学习通)完全隔离；仅 detectSite()==='zhihuishu' 时才激活。
  // 【需求差异】智慧树上课期间会弹「随堂题目」弹窗（互动题/弹幕答题），UI 与超星学习通结构完全不同：
  //   ① 无 window.attachments 白名单、无 window.ananas 私有暂停封装（已由 site-router.js 收口为智慧树空键）；
  //   ② 强制续播仍由原型级 pause 中性化(usePrototypeNeutralize auto 分支对智慧树激进)兜底，无需本模块介入；
  //   ③ 本模块独有职责：弹窗题目干扰处理 —— 复用站点无关骨架 popupQuizTick()（随机选 → 答题 → 删弹窗）。
  // 题目对错不在意（用户明确：只随机选一个然后答题、删弹窗），故不解析题干语义、不判断正确率。
  // 【选择器校准】智慧树真实 DOM 结构待实测校准，下方选择器为 best-effort 猜测并集，命中其一即生效（rev2 收口到 POPUP_QUIZ）。
  // H1·SELECTORS 中央化（DRY，消除 §4.2 缺陷）：ZHIHUISHU 是 popup-quiz.js POPUP_BASE 各数组的逐元素前缀子集
  // （dialogSels 前 7 / optionSels 前 6 / answerBtnSels 前 7，顺序一致），故直接引用 POPUP_BASE（经 window.__CX_FORCE_PLAY
  // 跨模块共享，manifest 保证 popup-quiz.js 先于本模块加载），运行时数组与改造前逐元素等价（零行为回归）。
  var POPUP_BASE_REF = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.POPUP_BASE) || null;
  var ZHIHUISHU = {
    dialogSels: (POPUP_BASE_REF ? POPUP_BASE_REF.dialogSels : []).slice(),
    optionSels: (POPUP_BASE_REF ? POPUP_BASE_REF.optionSels : []).slice(),
    answerBtnSels: (POPUP_BASE_REF ? POPUP_BASE_REF.answerBtnSels : []).slice()
  };

  function zhihuishuTickQuestions() {
    if (detectSite() !== 'zhihuishu') return 0;   // 隔离：非智慧树页面不执行任何逻辑
    return safeGet(function () { return popupQuizTick(ZHIHUISHU); }, 0);
  }

  // 暴露给主循环与回归测试
  bestEffort(function () { window.__CX_FORCE_PLAY.zhihuishuTickQuestions = zhihuishuTickQuestions; }, 'zhs.export');
  registerPopupQuizEnded('zhihuishu', ZHIHUISHU); // 视频结束节点即时作答（关键生命周期事件）

  // Phase 1：智慧树专属每轮调度自注册（含 FAB + 作业考试答题）；zhihuishuFabTick/zhihuishuExamTick 经闭包延迟引用（tick 时已就绪），跨站零副作用。
  registerSiteTick('zhihuishu', function () {
    var _zhsAns = zhihuishuTickQuestions();
    bestEffort(function () { zhihuishuFabTick(_zhsAns); }, 'zhs.fab');
    var _reg = window.__CX_FORCE_PLAY;
    bestEffort(function () { if (_reg && typeof _reg.zhihuishuExamEnabled === 'function' && _reg.zhihuishuExamEnabled() && typeof _reg.zhihuishuExamTick === 'function') _reg.zhihuishuExamTick(); }, 'zhs.exam');
    bestEffort(function () { if (_reg && typeof _reg.zhihuishuExamAutoSubmitTick === 'function') _reg.zhihuishuExamAutoSubmitTick(); }, 'zhs.examAuto');
  });
