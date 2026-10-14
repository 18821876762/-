// @requires: bestEffort, createQuizSelectors, detectSite, quizTick, registerSiteTick, safeGet
  // ===== DOMAIN: biz/unipus (中国高校外语慕课平台 Unipus / 北外+外研社) =====
  // ===== MODULE: Unipus 专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='unipus' 激活。英语专业/大学英语拓展课常见；题目重，接 quiz 真答题引擎。
  //   默认 'random' 兜底保不卡；配置 bank/ai 变真答题。选择器待真实站点校准(标 TODO)。
  var UNIPUS = createQuizSelectors('.exercise-item');   // NEW-4：复用共享工厂
  function unipusTickQuiz() {
    if (detectSite() !== 'unipus') return 0;
    return safeGet(function () { return quizTick(UNIPUS); }, 0);
  }
  bestEffort(function () { window.__CX_FORCE_PLAY.unipusTickQuiz = unipusTickQuiz; }, 'unipus.export');
  registerSiteTick('unipus', unipusTickQuiz); // Phase 1：自注册每轮 handler（注册表驱动分发）
