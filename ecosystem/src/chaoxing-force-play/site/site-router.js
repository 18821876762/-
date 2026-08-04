  // ===== 站点适配 / 页面路由 =====
  // 站点检测与路由分发：当前聚焦超星学习通(chaoxing)；预留智慧树网(zhihuishu)等兼容点。
  // 路由结果可用于驱动白名单抽取 / 接管策略的差异（不同站点的 attachments 字段、播放器容器不同）。
  // 当前为骨架：detectSite() 识别站点，routeBySite() 预留分支；默认走既有 chaoxing 逻辑，不改动现有行为。
  function detectSite() {
    try {
      var h = (window.location && window.location.hostname) || '';
      if (/chaoxing\.com$/i.test(h)) return 'chaoxing';
      if (/zhihuishu\.com$/i.test(h)) return 'zhihuishu';
    } catch (e) { swallow(e); }
    return 'unknown';
  }
  function routeBySite() {
    var site = detectSite();
    // TODO: 智慧树网适配分支（白名单抽取 / 播放器容器 / 续播策略差异）在此扩展
    return site; // 业务模块可据此分支
  }

  // P4：平台适配收口——把站点私有全局/选择器集中于此，平台改版只改这里。
  // chaoxing 的定向白名单挂全局 window.attachments；属性名亦收口，便于 defineProperty 钩子与读取统一切换。
  function siteAttachments() { try { return window.attachments; } catch (e) { return undefined; } }
  function siteAttachmentsKey() { return 'attachments'; }
  // chaoxing 的全局暂停封装挂在 window.ananas（跨 iframe 需按窗口取，缺省回退顶层）。
  function siteAnanas(win) { try { return (win && win.ananas) || window.ananas; } catch (e) { return null; } }
  // 任务点播放器容器选择器（chaoxing 用 .ans-attach-ct）。
  function siteTaskContainerSel() { return SELECTORS.TASK_CONTAINER; }

