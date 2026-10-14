// @requires: bestEffort, createQuizSelectors, detectSite, quizTick, registerSiteTick, safeGet
  // ===== DOMAIN: biz/renwei (人卫慕课 / 人民卫生出版社 / 医学院校专用) =====
  // ===== MODULE: 人卫慕课专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='renwei' 激活。医学院校专用；题目/作业重，故接 quiz 真答题引擎。
  //   答案源默认 'random' 保不卡；用户配置 bank/ai 后变真答题（见 quiz.js 说明）。选择器待真实站点校准(标 TODO)。
  var RENWEI = createQuizSelectors('.exam-item');   // NEW-4：复用共享工厂（四站结构一致，仅第三个 questionSel 不同）
  function renweiTickQuiz() {
    if (detectSite() !== 'renwei') return 0;
    return safeGet(function () { return quizTick(RENWEI); }, 0);
  }
  bestEffort(function () { window.__CX_FORCE_PLAY.renweiTickQuiz = renweiTickQuiz; }, 'renwei.export');
  registerSiteTick('renwei', renweiTickQuiz); // Phase 1：自注册每轮 handler（注册表驱动分发）
