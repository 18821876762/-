  // ===== DOMAIN: biz/icve (智慧职教 / icve.com.cn) =====
  // ===== MODULE: 智慧职教专属 —— 弹窗题目随机作答（续播由通用引擎兜底） =====
  // 域：业务模块 —— 仅 detectSite()==='icve' 激活。高职院校主用，无白名单/无 ananas，续播走通用全量兜底；
  //   本模块仅消上课弹窗干扰（随机选→答题→删）。智慧职教考试有防作弊屏捕，本模块只处理普通课程弹窗、不碰考试态。
  var ICVE = {
    dialogSels: ['.question-pop', '.modal', '.pop-mask', '.tk-pop', '[class*="question"]', '[class*="quiz"]', '[class*="popup"]'],
    optionSels: ['.option-item', '.q-item', 'li[class*="option"]', '.choice-item', '[class*="choice"]'],
    answerBtnSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn', '.next-btn']
  };
  function icveTickQuestions() {
    if (detectSite() !== 'icve') return 0;
    try { return popupQuizTick(ICVE); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.icveTickQuestions = icveTickQuestions; } catch (e) {}
