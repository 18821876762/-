// @provides: currentSiteCfg, detectSite, registerSiteTick
// @requires: CoreState, SELECTORS, bestEffort, safeGet
  // ===== 站点适配 / 页面路由 =====
  // 站点检测与路由分发：支持超星学习通(chaoxing) 与 智慧树网(zhihuishu)；平台私有全局/选择器集中到 SITES 映射。
  // 路由结果可用于驱动白名单抽取 / 接管策略的差异（不同站点的 attachments 字段、播放器容器不同）。
  // 站点配置经 currentSiteCfg() 按 detectSite() 实时分发；未知/未配置域回退超星基线，不改动既有 chaoxing 行为。
  // S1 修复：超星域判定统一使用 url.js 的 _cxIsChaoxingHost（同 IIFE 闭包内函数声明 hoist，全局可见，单一事实源，精确边界防 'evilchaoxing.com' 绕过）。
  // 性能修复(面板卡顿/交互)：detectSite 结果缓存——被主循环 tick/事件/渲染高频调用（含 edu.cn 分支的
  // 运行时全局读取），URL（hostname+pathname）未变时复用上次结果，近乎零成本。
  // 注意：edu.cn 域不做缓存——其「运行时全局特征（ananas/attachments 就绪后从 edu 延迟升级 chaoxing）」
  // 依赖每轮重判（注释见下），缓存会破坏该语义；其余域（chaoxing/zhihuishu/多平台/unknown）URL 即定态，缓存安全。
  var _siteCache = { sig: '', site: 'unknown' };
  function detectSite() {
    var _sig = '';
    bestEffort(function () {
      _sig = ((window.location && window.location.hostname) || '') + ((window.location && window.location.pathname) || '');
    }, 'site.sig');
    if (_sig === _siteCache.sig && !/edu\.cn$/i.test((window.location && window.location.hostname) || '')) return _siteCache.site;
    var _site = 'unknown';
    bestEffort(function () {
      var h = (window.location && window.location.hostname) || '';
      var p = (window.location && window.location.pathname) || '';
      if (/chat\.deepseek\.com/i.test(h)) { _site = 'deepseek'; return; }   // 视觉后端 responder 域：面板特化为应答端控制台
      if (_cxIsChaoxingHost(h)) { _site = 'chaoxing'; return; }
      if (/zhihuishu\.com$/i.test(h)) { _site = 'zhihuishu'; return; }
      // 学银在线(xueyinonline.com / xueyinonline.chaoxing.com)：超星 + 国家开放大学出品，与超星尔雅同源，
      // 播放器/暂停封装结构同超星 → 并入 chaoxing 策略（auto 激进原型中性化 + 读 window.attachments 白名单）。
      if (/xueyinonline\.com$/i.test(h)) { _site = 'chaoxing'; return; }
      // rev2 多平台扩展：整域匹配（避免子串误伤）。这些平台无白名单/无 ananas，续播走全量+原型中性化兜底，
      // 站点专属逻辑(弹窗作答/真答题)由各 biz 模块按 detectSite 分支调度；选择器均 best-effort 待真实站点校准。
      if (/icourse163\.org$/i.test(h)) { _site = 'icourse163'; return; }   // 中国大学MOOC / 爱课程
      if (/icourses\.cn$/i.test(h)) { _site = 'icourse163'; return; }      // 爱课程备用域
      if (/xuetangx\.com$/i.test(h)) { _site = 'xuetangx'; return; }       // 学堂在线
      if (/icve\.com\.cn$/i.test(h)) { _site = 'icve'; return; }           // 智慧职教
      // L3 修复：原 /renwei/i 无锚点会误匹配任何含 "renwei" 子串的域名（如 myrenwei.com / renwei-shop.cn），
      // 触发人卫慕课专属作答分支产生非预期 DOM 注入。改为带域名边界的精确匹配：
      //   · pmphmooc.com（人卫慕课已知主域占位）
      //   · *.renwei.com / *.renwei.cn（人卫自有域及其子域）
      //   · *-renwei.* / renwei-*.*（医学院校镜像域，如 mooc-renwei.edu.cn）
      if (/pmphmooc\.com$/i.test(h) || /(^|[-.])renwei\.(com|cn|edu\.cn)$/i.test(h)) { _site = 'renwei'; return; } // 人卫慕课（仅精确边界匹配，避免 myrenwei.com 等子串误伤）
      if (/unipus\.cn$/i.test(h)) { _site = 'unipus'; return; }            // 中国高校外语慕课 Unipus
      if (/ucampus\.cn$/i.test(h)) { _site = 'ucampus'; return; }          // U校园
      if (/ilab-x\.com$/i.test(h)) { _site = 'ilabx'; return; }            // 实验空间
      // edu.cn 兜底（P0 收窄，修复评审 #19 / #6842）：脚本 @match 含 *.edu.cn，但 edu.cn 体量庞大，
      // 直接等同 chaoxing 过宽——会把非超星高校站误判 chaoxing，触发 window.attachments / window.ananas
      // 钩子副作用（若该站恰有同名属性）。改为「正向识别超星」：仅当主机/路径/运行时全局呈超星特征时才
      // 升级为 chaoxing；否则回落安全基线 'edu'（SITES.edu 空附件键，不钩超星私有全局，仅由 auto 模式按
      // 站点自适应决定原型级 pause 中性化）。上方各平台专属域已先校验，故此处只作用于非专属域的 edu.cn 主机。
      if (/edu\.cn$/i.test(h)) { _site = isChaoxingEduCn(h, p) ? 'chaoxing' : 'edu'; return; }
    }, 'detectSite');
    _siteCache = { sig: _sig, site: _site };
    return _site;
  }
  // 正向识别「承载超星」的 edu.cn 高校镜像（best-effort，待真实站点校准；与 detectSite 同 IIFE）：
  // 超星高校镜像主机名常不含 chaoxing 字样（如 mooc.xxx.edu.cn），故靠特征而非字面子串判定。
  //   ① 主机子域特征：mooc/learn/course/study/class/kczy/sxk/mycourse/visit/space 等超星典型前缀；
  //   ② 路径特征：/learn /mooc /course /mycourse /visit /knowledge /work /exam /space /study /portal 等课程/考试路径；
  //   ③ 运行时全局特征：window.ananas 已就绪，或 window.attachments 为数组（detectSite 每轮重判，可延迟升级）。
  function isChaoxingEduCn(host, path) {
    if (/(^|[-.])(mooc|learn|course|study|class|kczy|sxk|mycourse|visit|space)\./i.test(host)) return true;
    if (/^(\/learn|\/mooc|\/course|\/mycourse|\/visit|\/knowledge|\/work|\/exam|\/space|\/study|\/portal|\/mooc-ans)/i.test(path || '')) return true;
    try {
      if (window.ananas) return true;
      if (window.attachments && (typeof Array !== 'undefined' ? Array.isArray(window.attachments) : (window.attachments.length !== undefined))) return true;
    } catch (e) {}
    return false;
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
    // 安全基线（P0 edu.cn 兜底收窄产物，修复评审 #19 / #6842）：非超星特征的高校 edu.cn 站回落此处，
    // 空附件键 → 不钩 window.attachments / window.ananas（消除同名属性副作用），仅由 auto 模式按站点自适应决定
    // 原型级 pause 中性化；taskContainerSel 为空 → 全量扫描兜底。选择器待真实站点校准。
    edu: {
      attachmentsKey: '', ananasKey: '',
      taskContainerSel: ''
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
  // Phase 1：站点专属每轮 handler 注册表（与 SITES 并列），消除 main-loop 的 if/else 长链。
  // 各站点模块加载时 registerSiteTick(site, fn) 自注册；核心循环只调 runSiteTick(detectSite())，新增平台不再改核心文件。
  // 站点识别本身仍由 SITES/detectSite() 注册表驱动（见上），此处仅承载「每轮调度哪个 handler」。
  var SITE_TICKS = {};
  function registerSiteTick(site, fn) { if (site && typeof fn === 'function') SITE_TICKS[site] = fn; }
  function runSiteTick(site) { if (!CoreState.canRun()) return; var fn = SITE_TICKS[site]; if (typeof fn === 'function') { bestEffort(fn, 'siteTick.' + site); } }
  // 站点配置按 detectSite() 实时解析（脚本单页单站，性价比最高且无需启动期缓存）；未知/未配置域回退超星基线以免崩溃。
  function currentSiteCfg() {
    var s = detectSite();
    return SITES[s] || SITES.chaoxing;
  }

  function siteAttachments() {
    var k = currentSiteCfg().attachmentsKey;
    if (!k) return undefined;
    return safeGet(function () { return window[k]; }, undefined);
  }
  function siteAttachmentsKey() { return currentSiteCfg().attachmentsKey; }
  // 平台自定义全局暂停封装：返回该 window 的私有暂停对象，无则 null（智慧树无 ananasKey → null，仅原型级拦截生效）
  function siteAnanas(win) {
    var k = currentSiteCfg().ananasKey;
    if (!k) return null;
    return safeGet(function () { return (win && win[k]) || window[k]; }, null);
  }
  // 任务点播放器容器选择器（MO 钻入 iframe/容器用）
  function siteTaskContainerSel() { return currentSiteCfg().taskContainerSel; }

  // 暴露站点路由/配置函数供诊断与回归测试
  bestEffort(function () {
    window.__CX_FORCE_PLAY.detectSite = detectSite;
    window.__CX_FORCE_PLAY.currentSiteCfg = currentSiteCfg;
    window.__CX_FORCE_PLAY.siteAttachments = siteAttachments;
    window.__CX_FORCE_PLAY.siteAttachmentsKey = siteAttachmentsKey;
    window.__CX_FORCE_PLAY.siteAnanas = siteAnanas;
    window.__CX_FORCE_PLAY.siteTaskContainerSel = siteTaskContainerSel;
    window.__CX_FORCE_PLAY.routeBySite = routeBySite;   // 备用 API：暴露供诊断/外部调用，消除未接线死代码
    window.__CX_FORCE_PLAY.registerSiteTick = registerSiteTick; // Phase 1：站点自注册每轮 handler
    window.__CX_FORCE_PLAY.runSiteTick = runSiteTick;                 // Phase 1：核心循环按 detectSite() 调度的唯一入口
  }, 'siteRouter.export');

