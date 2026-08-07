  // ===== DOMAIN: biz/chaoxing-exam (超星学习通 / 学银在线 作业·考试 真答题) =====
  // ===== MODULE: 超星学习通(含学银在线)作业/考试页「真答题」—— 接入通用 quiz 引擎 =====
  // 域：业务模块 —— 仅 detectSite()==='chaoxing'（含 xueyinonline 并入）激活。
  //   超星作业/考试页与视频续播页同处 chaoxing 域：本模块只调度 quiz 引擎，由 quizTick 内部按「题目容器」扫描；
  //   视频页无题目容器 → quizTick 自动 no-op，与续播（通用 dom.js 兜底）互不干扰。
  //   答案源默认 'random' 保不卡进度；用户配置 bank/ai 后变真答题（见 quiz.js 说明）。
  //   选择器为 best-effort 并集（超星尔雅/学习通作业·考试常见结构），待真实站点校准（标 TODO）。
  var CHAOXING_EXAM = {
    questionSels: ['.questionLi', '.questionBox', '.topic-item', '.qItem', '.question-item', '.examPaper',
                   '[class*="question"]', '[class*="topic"]', '[class*="ques"]', '.questionnaire'],
    stemSels: ['.questionTitle', '.qItemTitle', '.topic-title', '.stem', '[class*="title"]', '[class*="stem"]'],
    optionSels: ['.answerBg', '.answerOption', '.option', '.choice', 'li[class*="option"]',
                 '[class*="answer"]', 'label', '.q-item-option', '.select-item'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn', '.btn-submit', '.save-btn']
  };
  // 站点隔离调度：仅超星域激活（学银在线 xueyinonline 已并入 chaoxing），其他站点零副作用。
  function chaoxingTickQuiz() {
    if (detectSite() !== 'chaoxing') return 0;
    try { return quizTick(CHAOXING_EXAM); } catch (e) { swallow(e); return 0; }
  }
  try { window.__CX_FORCE_PLAY.chaoxingTickQuiz = chaoxingTickQuiz; } catch (e) {}
