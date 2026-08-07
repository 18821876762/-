  // ===== 站点适配 / 页面路由 =====
  // 站点检测与路由分发：支持超星学习通(chaoxing) 与 智慧树网(zhihuishu)；平台私有全局/选择器集中到 SITES 映射。
  // 路由结果可用于驱动白名单抽取 / 接管策略的差异（不同站点的 attachments 字段、播放器容器不同）。
  // 站点配置经 currentSiteCfg() 按 detectSite() 实时分发；未知/未配置域回退超星基线，不改动既有 chaoxing 行为。
  function detectSite() {
    try {
      var h = (window.location && window.location.hostname) || '';
      if (/chat\.deepseek\.com/i.test(h)) return 'deepseek';   // 视觉后端 responder 域：面板特化为应答端控制台
      if (/chaoxing\.com$/i.test(h)) return 'chaoxing';
      if (/zhihuishu\.com$/i.test(h)) return 'zhihuishu';
      // 学银在线(xueyinonline.com / xueyinonline.chaoxing.com)：超星 + 国家开放大学出品，与超星尔雅同源，
      // 播放器/暂停封装结构同超星 → 并入 chaoxing 策略（auto 激进原型中性化 + 读 window.attachments 白名单）。
      if (/xueyinonline\.com$/i.test(h)) return 'chaoxing';
      // rev2 多平台扩展：整域匹配（避免子串误伤）。这些平台无白名单/无 ananas，续播走全量+原型中性化兜底，
      // 站点专属逻辑(弹窗作答/真答题)由各 biz 模块按 detectSite 分支调度；选择器均 best-effort 待真实站点校准。
      if (/icourse163\.org$/i.test(h)) return 'icourse163';   // 中国大学MOOC / 爱课程
      if (/icourses\.cn$/i.test(h)) return 'icourse163';      // 爱课程备用域
      if (/xuetangx\.com$/i.test(h)) return 'xuetangx';       // 学堂在线
      if (/icve\.com\.cn$/i.test(h)) return 'icve';           // 智慧职教
      if (/pmphmooc\.com$/i.test(h) || /renwei/i.test(h)) return 'renwei'; // 人卫慕课（真实主域待确认，先占位 pmphmooc.com；如学校镜像域含 renwei 亦匹配）
      if (/unipus\.cn$/i.test(h)) return 'unipus';            // 中国高校外语慕课 Unipus
      if (/ucampus\.cn$/i.test(h)) return 'ucampus';          // U校园
      if (/ilab-x\.com$/i.test(h)) return 'ilabx';            // 实验空间
      // #1 开放问题落地：脚本 @match 仅 *.chaoxing.com + *.edu.cn；高校超星学习通常承载于 *.edu.cn（如 mooc.xxx.edu.cn），
      // 该域运行脚本即超星上下文，须与 chaoxing 同一接管策略（auto 模式激进原型中性化），否则会被误判 unknown→温和漏拦。
      // 注意：智慧树(知到)域为 zhihuishu.com，不落 edu.cn，故此规则不会误伤智慧树。
      if (/edu\.cn$/i.test(h)) return 'chaoxing';
    } catch (e) { swallow(e); }
    return 'unknown';
  }
  function routeBySite() {
    return detectSite(); // 业务模块可据此分支；站点配置经 currentSiteCfg() 实时分发
  }

  // P4 + 智慧树适配：站点私有全局/选择器集中到 SITES 映射，按 detectSite() 实时分发；平台改版只改这里。
  // chaoxing：定向白名单挂 window.attachments，全局暂停封装挂 window.ananas（超星专属）。
  // zhihuishu（智慧树/知到）：与超星结构不同——无 window.attachments 白名单、无 window.ananas 私有暂停封装。
  //   attachmentsKey/ananasKey 置空：① siteAttachments() 回退 undefined → 定向续播自动回退全量（targeting 已有兜底）；
  //   ② hookAttachments 见空键跳过 defineProperty 钩子（targeting.js 空键守卫）→ 退回轮询/全量；③ 仅原型级 pause 拦截生效。
  //   taskContainerSel 为 best-effort 猜测，需在本站实测校准（TODO）。
  var SITES = {
    deepseek: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '',   // DeepSeek 无网课视频容器，无需任务点容器选择器
      title: 'DeepSeek 应答端控制台',            // 供面板特化：DS 页标题（buildDSConsoleHTML 直接消费）
      copyDiagnosticsLabel: '复制联动诊断'
    },
    chaoxing: {
      attachmentsKey: 'attachments',                 // 播放页 AJAX 渲染后顶层 window.attachments = 任务点数组（含 objectid）
      ananasKey: 'ananas',                            // 超星私有全局暂停封装 window.ananas.pause
      taskContainerSel: SELECTORS.TASK_CONTAINER      // .ans-attach-ct
    },
    zhihuishu: {
      attachmentsKey: '',                            // TODO 真实站点验证：智慧树无此白名单全局 → 定向回退全量
      ananasKey: '',                                 // TODO 真实站点验证：智慧树无 window.ananas 私有暂停封装
      taskContainerSel: '.video-container, .player, #video, .tk-container' // TODO 真实站点验证：best-effort 播放器容器
    },
    // ===== rev2 多平台扩展：中国大学MOOC / 学堂在线 / 智慧职教 / 人卫 / Unipus / U校园 / 实验空间 =====
    // 这些平台与智慧树同理——无 window.attachments 白名单、无 window.ananas 私有暂停封装，故 attachmentsKey/ananasKey 置空，
    // 续播走「全量 + 原型级 pause 中性化」兜底；taskContainerSel / 弹窗选择器为 best-effort 猜测，待真实站点校准（标 TODO）。
    // 真答题引擎(takeover/engine/quiz.js)与弹窗随机作答(sites/popup-quiz.js)共用这些选择器的同构映射，站点隔离、逻辑只写一处。
    icourse163: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.course-content, .video-wrap, #video, .jwplayer, .course-player' // TODO 真实站点校准
    },
    xuetangx: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.video-container, #video-box, .xuetangx-player, .course-video' // TODO 真实站点校准
    },
    icve: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.video-box, #player, .course-player, .icve-player' // TODO 真实站点校准
    },
    renwei: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.video-wrap, #video, .player-box' // TODO 真实站点校准（人卫慕课）
    },
    unipus: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.video-container, #video, .unipus-player' // TODO 真实站点校准（Unipus 外语慕课）
    },
    ucampus: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.video-box, #video, .ucampus-player' // TODO 真实站点校准（U校园）
    },
    ilabx: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: '.video-wrap, #video, .lab-player' // TODO 真实站点校准（实验空间虚拟仿真）
    }
  };
  // 站点配置按 detectSite() 实时解析（脚本单页单站，性价比最高且无需启动期缓存）；未知/未配置域回退超星基线以免崩溃。
  function currentSiteCfg() {
    var s = detectSite();
    return SITES[s] || SITES.chaoxing;
  }

  function siteAttachments() {
    var k = currentSiteCfg().attachmentsKey;
    if (!k) return undefined;
    try { return window[k]; } catch (e) { return undefined; }
  }
  function siteAttachmentsKey() { return currentSiteCfg().attachmentsKey; }
  // 平台自定义全局暂停封装：返回该 window 的私有暂停对象，无则 null（智慧树无 ananasKey → null，仅原型级拦截生效）
  function siteAnanas(win) {
    var k = currentSiteCfg().ananasKey;
    if (!k) return null;
    try { return (win && win[k]) || window[k]; } catch (e) { return null; }
  }
  // 任务点播放器容器选择器（MO 钻入 iframe/容器用）
  function siteTaskContainerSel() { return currentSiteCfg().taskContainerSel; }

  // 暴露站点路由/配置函数供诊断与回归测试
  try {
    window.__CX_FORCE_PLAY.detectSite = detectSite;
    window.__CX_FORCE_PLAY.currentSiteCfg = currentSiteCfg;
    window.__CX_FORCE_PLAY.siteAttachments = siteAttachments;
    window.__CX_FORCE_PLAY.siteAttachmentsKey = siteAttachmentsKey;
    window.__CX_FORCE_PLAY.siteAnanas = siteAnanas;
    window.__CX_FORCE_PLAY.siteTaskContainerSel = siteTaskContainerSel;
    window.__CX_FORCE_PLAY.routeBySite = routeBySite;   // 备用 API：暴露供诊断/外部调用，消除未接线死代码
  } catch (e) {}

