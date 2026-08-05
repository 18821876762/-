  // ===== DOMAIN: biz/icourse163 (中国大学MOOC / 爱课程 / icourse163.org) =====
  // ===== MODULE: 中国大学MOOC 专属 —— 弹窗题目随机作答（续播由通用引擎兜底） =====
  // 域：业务模块 —— 仅 detectSite()==='icourse163' 激活。平台无 window.attachments 白名单、无 window.ananas，
  //   续播走通用「全量 + 原型级 pause 中性化」；本模块仅消上课弹窗干扰（随机选→答题→删）。
  var ICOURSE163 = {
    dialogSels: ['.quiz-pop', '.question-pop', '.modal', '.pop-layer', '[class*="question"]', '[class*="quiz"]', '[class*="popup"]'],
    optionSels: ['.option-item', '.q-item', 'li[class*="option"]', '.choice-item', '[class*="choice"]'],
    answerBtnSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn', '.next-btn']
  };
  function icourse163TickQuestions() {
    if (detectSite() !== 'icourse163') return 0;
    try { return popupQuizTick(ICOURSE163); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.icourse163TickQuestions = icourse163TickQuestions; } catch (e) {}
