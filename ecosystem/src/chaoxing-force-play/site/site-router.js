  // ===== 站点适配 / 页面路由 =====
  // 站点检测与路由分发：支持超星学习通(chaoxing) 与 智慧树网(zhihuishu)；平台私有全局/选择器集中到 SITES 映射。
  // 路由结果可用于驱动白名单抽取 / 接管策略的差异（不同站点的 attachments 字段、播放器容器不同）。
  // 站点配置经 currentSiteCfg() 按 detectSite() 实时分发；未知/未配置域回退超星基线，不改动既有 chaoxing 行为。
  function detectSite() {
    try {
      var h = (window.location && window.location.hostname) || '';
      if (/chaoxing\.com$/i.test(h)) return 'chaoxing';
      if (/zhihuishu\.com$/i.test(h)) return 'zhihuishu';
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
    chaoxing: {
      attachmentsKey: 'attachments',                 // 播放页 AJAX 渲染后顶层 window.attachments = 任务点数组（含 objectid）
      ananasKey: 'ananas',                            // 超星私有全局暂停封装 window.ananas.pause
      taskContainerSel: SELECTORS.TASK_CONTAINER      // .ans-attach-ct
    },
    zhihuishu: {
      attachmentsKey: '',                            // TODO 真实站点验证：智慧树无此白名单全局 → 定向回退全量
      ananasKey: '',                                 // TODO 真实站点验证：智慧树无 window.ananas 私有暂停封装
      taskContainerSel: '.video-container, .player, #video, .tk-container' // TODO 真实站点验证：best-effort 播放器容器
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

