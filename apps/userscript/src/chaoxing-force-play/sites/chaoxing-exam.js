// @requires: bestEffort, detectSite, quizTick, registerSiteTick, safeGet
  // ===== DOMAIN: biz/chaoxing-exam (超星学习通 / 学银在线 作业·考试 真答题) =====
  // ===== MODULE: 超星学习通(含学银在线)作业/考试页「真答题」—— 接入通用 quiz 引擎 =====
  // 域：业务模块 —— 仅 detectSite()==='chaoxing'（含 xueyinonline 并入）激活。
  //   超星作业/考试页与视频续播页同处 chaoxing 域：本模块只调度 quiz 引擎，由 quizTick 内部按「题目容器」扫描；
  //   视频页无题目容器 → quizTick 自动 no-op，与续播（通用 dom.js 兜底）互不干扰。
  //   答案源默认 'random' 保不卡进度；用户配置 bank/ai 后变真答题（见 quiz.js 说明）。
  //   选择器为 best-effort 并集（超星尔雅/学习通作业·考试常见结构）。
  //   校准(2026-08-14, 真实 doHomeWorkNew 作业页 DOM dump)：
  //     题块 div.TiMu.newTiMu（每题一个，作为 questionSel；注意不可再加 ul.Zy_ulTop，否则与题块双重计数）
  //     题干 div.Zy_TItle > span.newZy_TItle（文本如 "1 【多选题】…"）
  //     选项 ul.Zy_ulTop > li.before-after-checkbox（×N）：li 带 qid/qtype(1=多选)/role=checkbox/
  //          aria-label="A 翻阅资料选择"(首词=选项字母)/onclick="addMultipleChoice(this)"；已选=aria-checked=true 或 .check_answer
  //     提交 a.btnSubmit.workBtnIndex（"提交"）/ 暂时保存 a.btnSave.workBtnIndex（页面级，题块外→不自动交卷，用户手动提交）
  //     选项选择器一律限定 li，避免误中内层 span.num_option_dx 致计数翻倍（旧版 OPTION_COUNT=8 即此因）
  var CHAOXING_EXAM = {
    questionSels: ['div.TiMu', '.questionLi', '.questionBox', '.examPaper'],
    stemSels: ['div.Zy_TItle', 'span.newZy_TItle', '.questionTitle', '.topic-title', '[class*="title"]', '[class*="stem"]'],
    optionSels: ['ul.Zy_ulTop > li', 'li.before-after-checkbox', 'li[class*="option"]', 'li.num_option'],
    // 题型识别(step1)：填空题输入选择器——无选项但含单行文本输入的题判定为「填空」(登记待回填)；
    // 含多行 textarea 的题判定为「主观/简答」(走人工队列)。best-effort 并集（超星尔雅/学习通作业·考试常见结构）。
    // 注：textarea 不在此列——填空题在超星多为单 input[type=text]，简答/主观才用 textarea，借此区分二者。
    fillInputSels: ['input[type="text"]', 'input.filldown', 'input[class*="fill"]', 'textarea.answertext', 'textarea[class*="fill"]'],
    // v4.19.23：提交选择器剔除保存按钮（a.btnSave.workBtnIndex / .save-btn）——用户实测「提交只按到保存按钮」：
    // 保存=草稿暂存（页面级），绝非提交；混入选择器会先命中保存。提交类选择器排前，文本兜底亦提交优先。
    submitSels: ['a.btnSubmit.workBtnIndex', 'a.btnSubmit', '[class*="btnSubmit"]', 'a[class*="submit"]', '.submit-btn', '.btn-submit']
  };
  // 站点隔离调度：仅超星域激活（学银在线 xueyinonline 已并入 chaoxing），其他站点零副作用。
  function chaoxingTickQuiz() {
    if (detectSite() !== 'chaoxing') return 0;
    return safeGet(function () { return quizTick(CHAOXING_EXAM); }, 0);
  }
  bestEffort(function () { window.__CX_FORCE_PLAY.chaoxingTickQuiz = chaoxingTickQuiz; }, 'cxExam.export');
  registerSiteTick('chaoxing', chaoxingTickQuiz); // Phase 1：自注册每轮 handler（注册表驱动分发）
