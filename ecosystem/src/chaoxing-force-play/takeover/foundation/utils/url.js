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
    try {
      href = w.location.href;
      while (w.parent && w.parent !== w) { w = w.parent; href = w.location.href; }
    } catch (e) { swallow(e); }   // 跨域父帧读不到 href 即抛错，保留最近一层同源 href
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
      const m = href.match(new RegExp('[?&#]' + names[i] + '=([^&#]+)', 'i'));   // F-B5：兼容参数置于 hash（#kid=...）的新模板路由
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    }
    return null;
  }
