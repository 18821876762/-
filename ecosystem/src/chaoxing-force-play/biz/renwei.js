  // ===== DOMAIN: biz/renwei (人卫慕课 / 人民卫生出版社 / 医学院校专用) =====
  // ===== MODULE: 人卫慕课专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='renwei' 激活。医学院校专用；题目/作业重，故接 quiz 真答题引擎。
  //   答案源默认 'random' 保不卡；用户配置 bank/ai 后变真答题（见 quiz.js 说明）。选择器待真实站点校准(标 TODO)。
  var RENWEI = {
    questionSels: ['.question-item', '.quiz-item', '.exam-item', '[class*="question"]', '[class*="quiz"]'],
    stemSels: ['.stem', '.question-title', '.q-title', '[class*="stem"]'],
    optionSels: ['.option-item', '.q-option', 'li[class*="option"]', '[class*="choice"]'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn']
  };
  function renweiTickQuiz() {
    if (detectSite() !== 'renwei') return 0;
    try { return quizTick(RENWEI); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.renweiTickQuiz = renweiTickQuiz; } catch (e) {}
