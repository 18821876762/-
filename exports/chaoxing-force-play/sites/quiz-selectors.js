// @provides: createQuizSelectors
  // ===== DOMAIN: sites/quiz-selectors (共享 quiz 选择器工厂) =====
  // NEW-4 修复：renwei/unipus/ucampus/ilabx 四站 quiz 选择器结构完全一致，仅第三个 questionSel 不同。
  // 抽出公共工厂，消除四站重复的选择器字面量。选择器仍标 TODO，待真实站点校准。
  function createQuizSelectors(thirdQuestionSel) {
    return {
      questionSels: ['.question-item', '.quiz-item', thirdQuestionSel, '[class*="question"]', '[class*="quiz"]'],
      stemSels: ['.stem', '.question-title', '.q-title', '[class*="stem"]'],
      optionSels: ['.option-item', '.q-option', 'li[class*="option"]', '[class*="choice"]'],
      submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn']
    };
  }
