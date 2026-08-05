  // ===== DOMAIN: biz/ilabx (实验空间 ilab-x / 国家虚拟仿真实验教学平台) =====
  // ===== MODULE: 实验空间专属 —— 真答题(接入 quiz 引擎) + 续播(通用兜底) =====
  // 域：业务模块 —— 仅 detectSite()==='ilabx' 激活。理工科虚拟实验；步骤内嵌题目，接 quiz 真答题引擎。
  //   默认 'random' 兜底保不卡；配置 bank/ai 变真答题。选择器待真实站点校准(标 TODO)。
  var ILABX = {
    questionSels: ['.question-item', '.quiz-item', '.step-question', '[class*="question"]', '[class*="quiz"]'],
    stemSels: ['.stem', '.question-title', '.q-title', '[class*="stem"]'],
    optionSels: ['.option-item', '.q-option', 'li[class*="option"]', '[class*="choice"]'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn']
  };
  function ilabxTickQuiz() {
    if (detectSite() !== 'ilabx') return 0;
    try { return quizTick(ILABX); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.ilabxTickQuiz = ilabxTickQuiz; } catch (e) {}
