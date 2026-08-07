  // ===== DOMAIN: biz/unipus (中国高校外语慕课平台 Unipus / 北外+外研社) =====
  // ===== MODULE: Unipus 专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='unipus' 激活。英语专业/大学英语拓展课常见；题目重，接 quiz 真答题引擎。
  //   默认 'random' 兜底保不卡；配置 bank/ai 变真答题。选择器待真实站点校准(标 TODO)。
  var UNIPUS = {
    questionSels: ['.question-item', '.quiz-item', '.exercise-item', '[class*="question"]', '[class*="quiz"]'],
    stemSels: ['.stem', '.question-title', '.q-title', '[class*="stem"]'],
    optionSels: ['.option-item', '.q-option', 'li[class*="option"]', '[class*="choice"]'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn']
  };
  function unipusTickQuiz() {
    if (detectSite() !== 'unipus') return 0;
    try { return quizTick(UNIPUS); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.unipusTickQuiz = unipusTickQuiz; } catch (e) {}
