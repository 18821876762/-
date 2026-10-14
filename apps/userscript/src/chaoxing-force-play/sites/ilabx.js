// @requires: bestEffort, createQuizSelectors, detectSite, quizTick, registerSiteTick, safeGet
  // ===== DOMAIN: biz/ilabx (实验空间 ilab-x / 国家虚拟仿真实验教学平台) =====
  // ===== MODULE: 实验空间专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='ilabx' 激活。理工科虚拟实验；步骤内嵌题目，接 quiz 真答题引擎。
  //   默认 'random' 兜底保不卡；配置 bank/ai 变真答题。选择器待真实站点校准(标 TODO)。
  var ILABX = createQuizSelectors('.step-question');   // NEW-4：复用共享工厂
  function ilabxTickQuiz() {
    if (detectSite() !== 'ilabx') return 0;
    return safeGet(function () { return quizTick(ILABX); }, 0);
  }
  bestEffort(function () { window.__CX_FORCE_PLAY.ilabxTickQuiz = ilabxTickQuiz; }, 'ilabx.export');
  registerSiteTick('ilabx', ilabxTickQuiz); // Phase 1：自注册每轮 handler（注册表驱动分发）
