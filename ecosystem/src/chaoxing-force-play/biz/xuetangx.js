  // ===== DOMAIN: biz/xuetangx (学堂在线 / xuetangx.com) =====
  // ===== MODULE: 学堂在线专属 —— 弹窗题目随机作答（续播由通用引擎兜底；常与雨课堂配套） =====
  // 域：业务模块 —— 仅 detectSite()==='xuetangx' 激活。无白名单/无 ananas，续播走通用全量兜底；
  //   本模块仅消上课弹窗干扰（随机选→答题→删）。
  var XUETANGX = {
    dialogSels: ['.xtx-quiz', '.question-modal', '.pop-mask', '.modal', '[class*="quiz"]', '[class*="question"]', '[class*="popup"]'],
    optionSels: ['.option', '.q-option', 'li[class*="option"]', '.choice', '[class*="choice"]'],
    answerBtnSels: ['.submit', '.answer-btn', 'button[class*="submit"]', '.confirm', '.xtx-submit']
  };
  function xuetangxTickQuestions() {
    if (detectSite() !== 'xuetangx') return 0;
    try { return popupQuizTick(XUETANGX); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.xuetangxTickQuestions = xuetangxTickQuestions; } catch (e) {}
