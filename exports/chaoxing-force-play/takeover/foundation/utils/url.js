// @provides: topHref, urlParam
// @requires: bestEffort
  // ===== DOMAIN: utils/url (URL parsing helpers) =====
  // ===== MODULE: URL 解析 =====
  // 域：基础工具层 —— 与页面结构无关的纯 URL 解析，供定向(targeting)与本地桥(bridge)复用。
  // 【内聚性收敛】原寄居在 takeover/engine/targeting.js，与白名单业务、桥客户端混居；抽为独立工具后
  //   targeting / bridge 仅持有业务职责，URL 解析成为单一事实源（避免散落重复）。
  // 取顶层可访问的最上层同源窗口 href（跨 iframe 场景：播放页视频常嵌于同源 iframe，
  // 课程/章节参数挂在顶层路由上，必须从顶层读而非嵌入帧的 location）。
  /**
   * 取当前顶层框架的 location.href（iframe 内回退到 contentWindow 来源），统一 URL 入口。
   * @returns {string} 顶层页面 URL
   */
  function topHref() {
    let w = window, href = '';
    bestEffort(function () {
      href = w.location.href;
      while (w.parent && w.parent !== w) { w = w.parent; href = w.location.href; }
    }, 'topHref');   // 跨域父帧读不到 href 即抛错，保留最近一层同源 href
    return href;
  }
  // 从 href 取首个匹配的参数值；兼容参数置于 hash（#kid=...）的新模板路由。
  /**
   * 从 URL 解析查询参数（支持单个键名或键名数组）。
   * @param {string} href - 待解析 URL
   * @param {string|string[]} names - 单个键名或键名数组
   * @returns {string|Object} 单键时返回字符串值，多键时返回 {键:值} 对象
   */
  function urlParam(href, names) {
    if (typeof names === 'string') names = [names];   // 兼容单键名字符串入参（避免按字符遍历）
    for (let i = 0; i < names.length; i++) {
      // 键名可能含正则元字符（如 'course.id'），必须转义后再拼入 RegExp，
      // 否则 '.' 会匹配任意字符导致 urlParam(href,'course.id') 误命中 'courseXid=...'。
      const key = String(names[i]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = href.match(new RegExp('[?&#]' + key + '=([^&#]+)', 'i'));   // F-B5：兼容参数置于 hash（#kid=...）的新模板路由
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    }
    return null;
  }
  // S1 修复（安全单一事实源）：超星官方域判定。
  //   旧 /chaoxing\.com$/i 仅「锚结尾」，evilchaoxing.com 之类伪造域可绕过站点判定与桥白名单。
  //   改为精确边界：仅 'chaoxing.com' 自身或其子域（*.chaoxing.com）视为官方域。
  //   站点路由(site-router)与本地桥白名单(bridge)统一复用本函数，禁止再散用锚尾正则。
  function _cxIsChaoxingHost(h) {
    if (!h) return false;
    h = ('' + h).toLowerCase();
    return h === 'chaoxing.com' || h.endsWith('.chaoxing.com');
  }
  try { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.isChaoxingHost = _cxIsChaoxingHost; } catch (e) {}
