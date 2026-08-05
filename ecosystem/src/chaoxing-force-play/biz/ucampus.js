  // ===== DOMAIN: biz/ucampus (U校园 / 外研社 / 英语教材配套) =====
  // ===== MODULE: U校园专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='ucampus' 激活。偏英语教材配套(听力/作业)；题目重，接 quiz 真答题引擎。
  //   默认 'random' 兜底保不卡；配置 bank/ai 变真答题。选择器待真实站点校准(标 TODO)。
  var UCAMPUS = {
    questionSels: ['.question-item', '.quiz-item', '.exercise-item', '[class*="question"]', '[class*="quiz"]'],
    stemSels: ['.stem', '.question-title', '.q-title', '[class*="stem"]'],
    optionSels: ['.option-item', '.q-option', 'li[class*="option"]', '[class*="choice"]'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn']
  };
  function ucampusTickQuiz() {
    if (detectSite() !== 'ucampus') return 0;
    try { return quizTick(UCAMPUS); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.ucampusTickQuiz = ucampusTickQuiz; } catch (e) {}
