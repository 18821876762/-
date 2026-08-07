  // ===== DOMAIN: biz/zhihuishu (Zhihuishu / 智慧树-知到 专属业务) =====
  // ===== MODULE: 智慧树上课弹窗题目自动处理（随机选选项→点击答题→删除弹窗） =====
  // 域：业务模块 —— 智慧树(知到)专属，与超星(学习通)完全隔离；仅 detectSite()==='zhihuishu' 时才激活。
  // 【需求差异】智慧树上课期间会弹「随堂题目」弹窗（互动题/弹幕答题），UI 与超星学习通结构完全不同：
  //   ① 无 window.attachments 白名单、无 window.ananas 私有暂停封装（已由 site-router.js 收口为智慧树空键）；
  //   ② 强制续播仍由原型级 pause 中性化(usePrototypeNeutralize auto 分支对智慧树激进)兜底，无需本模块介入；
  //   ③ 本模块独有职责：弹窗题目干扰处理 —— 复用站点无关骨架 popupQuizTick()（随机选 → 答题 → 删弹窗）。
  // 题目对错不在意（用户明确：只随机选一个然后答题、删弹窗），故不解析题干语义、不判断正确率。
  // 【选择器校准】智慧树真实 DOM 结构待实测校准，下方选择器为 best-effort 猜测并集，命中其一即生效（rev2 收口到 POPUP_QUIZ）。
  var ZHIHUISHU = {
    dialogSels: ['.dialog-wrap', '.question-pop', '.topic-pop', '.ans-pop', '.pop-box', '.question-dialog', '.tk-pop', '[class*="question"]', '[class*="topic"]', '[class*="answer"]'],
    optionSels: ['.topic-item', '.option-item', '.answer-item', 'li[class*="option"]', '.dialog-wrap li', '[class*="choice"]'],
    answerBtnSels: ['.answer-btn', '.submit-btn', '.dialog-submit', '.topic-submit', 'button[class*="answer"]', 'button[class*="submit"]', '.pop-btn']
  };

  function zhihuishuTickQuestions() {
    if (detectSite() !== 'zhihuishu') return 0;   // 隔离：非智慧树页面不执行任何逻辑
    try { return popupQuizTick(ZHIHUISHU); } catch (e) { swallow(e); return 0; }
  }

  // 暴露给主循环与回归测试
  try { window.__CX_FORCE_PLAY.zhihuishuTickQuestions = zhihuishuTickQuestions; } catch (e) {}
