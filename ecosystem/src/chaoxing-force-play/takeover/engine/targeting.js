  // ===== DOMAIN: biz/targeting (targeting whitelist) =====
  // ===== MODULE: 定向/白名单 =====
  // 域：核心业务模块 —— 定向/白名单，驱动续播范围与回退策略。
  // ===== 定向续播：从 siteAttachments() 抽任务点视频白名单 =====
  // 播放页 JS 渲染后，顶层 siteAttachments() 是任务点数组，每项 { property: {...} }，
  // property.objectid / mid / id 为视频资源标识，property.type 标记类型(video/document/...)。
  // 据此只续任务点视频，广告/插播视频不在白名单内 → 跳过（不让 force-play 误续）。
  // 【内聚性收敛】本地桥客户端(BRIDGE / bridgeFetch / bridgeInit / …)已迁至同域 takeover/engine/bridge.js，
  //   URL 解析(topHref / urlParam)已迁至 takeover/foundation/utils/url.js；本文件现仅承载「白名单」单一职责。
  var TARGET = { enabled: false, ids: null, matchedAny: false };

  // 下钻收集 attachments 中所有可定位视频的 id（objectid/mid/id），兼容大小写与子附件
  /**
   * 收集附件 ID 集合（去重），用于定向白名单匹配。
   * 评审PR1：入参可选，默认读 siteAttachments()，保持原行为不变，便于纯函数单测。
   * @param {Array} [attachments] - 附件数组（默认 siteAttachments()）
   * @returns {Object} 以附件 ID 为键的集合对象（值为 true）
   */
  function collectAttachmentIds(attachments) {           // 评审PR1：可选入参便于纯函数单测（默认读 siteAttachments，行为不变）
    try {
      const a = (attachments !== undefined) ? attachments : siteAttachments();
      if (!Array.isArray(a) || !a.length) return null;
      const ids = {};
      function walk(prop) {
        if (!prop || typeof prop !== 'object') return;
        const oid = prop.objectid || prop.objectId || prop.object_id;
        if (oid != null) ids[String(oid)] = true;
        const mid = prop.mid || prop.mediaId;
        if (mid != null) ids[String(mid)] = true;
        const idv = prop.id;
        if (idv != null) ids[String(idv)] = true;
        if (Array.isArray(prop.attachments)) prop.attachments.forEach(walk);
        if (Array.isArray(prop.childList)) prop.childList.forEach(walk);
      }
      for (let i = 0; i < a.length; i++) {
        const item = a[i];
        if (item) walk(item.property || item);
      }
      return { ids: ids };
    } catch (e) { return null; }
  }

  // #1 修复：siteAttachments() 延迟/缺失导致"无米之炊"。
  // 该变量常在 AJAX 回包后异步挂到 window，早期轮询只能读到 undefined；某些旧版/移动端页甚至永不出现。
  // 故：①定义 setter 钩子——页面一旦 assign siteAttachments() 立即触发 refreshTargets，不等 2s 轮询；
  //    ②refreshTargets 退化时优先用桥清单 objectids（爬虫侧权威、早于 AJAX 渲染），保证白名单不空窗；
  //    ③保留轮询兜底，应对 setter 被平台劫持/描述符受限写不进的极端情况。
  var _attachHooked = false;
  // 钩子安装时捕获的 window.attachments 取值容器（跨模块供 cleanupListeners ③ 还原使用）；
  // 仅当 window 无自有属性时本钩子才会安装，故容器内即「注入前语义」的快照，cleanup 据此还原以免 delete 丢失平台数据。
  var _attachStore = null;
  function hookAttachments() {
    if (_attachHooked) return;
    if (!siteAttachmentsKey()) return;   // 空键（智慧树等无白名单全局）→ 跳过钩子，回退轮询/全量，避免 defineProperty('') 抛错
    try {
      if (Object.getOwnPropertyDescriptor(window, siteAttachmentsKey())) return;  // 已被平台定义（不可重定义）→ 退回轮询兜底
      _attachStore = { value: siteAttachments() };
      Object.defineProperty(window, siteAttachmentsKey(), {
        configurable: true,
        enumerable: true,
        get: function () { return _attachStore.value; },
        set: function (v) {
          _attachStore.value = v;
          try { refreshTargets(); } catch (e) { swallow(e); }   // 即时重建白名单，无需等下一个 2s 周期
        }
      });
      _attachHooked = true;
    } catch (e) { swallow(e); }
  }

  // 刷新定向目标：基于 siteAttachments() + 桥清单 objectids 重建任务点白名单。
  // 改进（吸收评审）：① 滞回——已启用状态下若本次 attachments 暂为空窗，保持稳定不回退，避免"定向↔全量"横跳误触广告；
  //                 ② 仅在"任务点 id 集合真变化"(真实章节/课程切换)时清空 ENDED_SRCS 黑名单，既保留重建重播保护，
  //                    又允许切到新一课/回看（原"任意新 video 即清空"写法会令黑名单失效，已删除）。
  // #1 强化：attachments 永不出现时，桥 objectids 可独立撑起白名单（ids 非空即启用），不再"无米之炊"。
  var _lastTaskKey = null;
  var _lastChapterKey = null;                 // 专项诊断#八：章节参数跟踪，跨章复用同 objectid 时强制清空 ENDED_SRCS 防误锁
  var _targetMissStreak = 0;                  // 定向 0 命中连续轮数（迟滞：连续 N 轮才回退全量，避免瞬时空窗横跳，专项诊断#三）
  // 定向回退轮数阈值已集中到 CONST（元配置集中层）
  var _dbgTargetState = null;                 // 诊断#刷屏修复：记录上次 dbg 输出的定向/全量状态，仅在状态切变时打印，避免每轮 2s 刷屏
  var _lockFg = null;                         // 锁定前台视频（不为 null 时，忽略自动前台计算，强制将此视频视为前台）
  // 运维仪表盘数据（_moHistory/_safePlay*/_targetHit*）与黑匣子（_bxBuffer/_bxLog）已迁出至
  // takeover/foundation/state/metrics.js（可观测性状态层）——它们不属于定向业务。本文件仍可直接调用 _bxLog（同一 IIFE 闭包）。
  // 原 _lastMoLen 为死变量（仅声明、无任何读写，趋势判断实际由 _moHistory 承担），已随迁移删除。
  // 跨脚本契约：auto-next 脚本在插播题/答题需暂停时，向具体 video 写入 v.__cxAN_hold=true（暂停时清除）。
  // 本脚本只读此标志并一律避让，不自行定义/初始化——若 auto-next 未加载，该标志恒为 undefined(假)，不影响续播。
  // 【易误判·诊断#十】字段名刻意不提取为常量：属与 auto-next 的隐式契约，改名需两端同步；提取常量无收益且增间接层。
  /**
   * 刷新定向目标：重新读取白名单/附件钩子并重建匹配键正则缓存（_keyReCache 用 Map.clear 复用）。
   * @returns {void}
   */
  function refreshTargets() {
    let info = collectAttachmentIds();
    // 合并桥清单预填的 objectids：attachments 未渲染/缺字段时白名单仍完整；
    // 每轮固定合并同一集合，键集稳定，不会扰动 _lastTaskKey 的章节切换判定。
    try {
      const bo = BRIDGE.chapter && BRIDGE.chapter.objectids;
      if (bo && bo.length) {
        if (!info || !info.ids) info = { ids: {} };
        for (let _b = 0; _b < bo.length; _b++) info.ids[String(bo[_b])] = true;
      }
    } catch (e) { swallow(e); }
    const keyArr = (info && info.ids) ? Object.keys(info.ids) : [];
    if (keyArr.length) {
      const keys = keyArr.slice().sort().join('|');
      const kid = urlParam(topHref(), ['chapterId', 'knowledgeId']) || '';   // 专项诊断#八：章节参数亦纳入切换判定
      const _taskChanged = (keys !== _lastTaskKey);
      const _chapChanged = (kid !== _lastChapterKey);
      if (_taskChanged || _chapChanged) {        // 真实章节切换（任务点 id 集或章节参数任一变化）→ 重置"已结束地址"黑名单(防微量泄漏)
        ENDED_SRCS = {};                          // 专项诊断#八：跨章复用同一 objectid 时仍清空，避免旧章已结束指纹误锁新章首播
        if (_taskChanged) _keyReCache.clear();    // 正则缓存按 task id 维护（Map），仅 id 集变化才需清（与章节无关）
        _lastTaskKey = keys;
        _lastChapterKey = kid;
      }
      TARGET.ids = info.ids;
      TARGET.keys = keyArr;               // 评审#2：key 数组随白名单一次性生成，热路径复用，免每视频每轮 Object.keys 分配
      TARGET.enabled = true;
      TARGET.matchedAny = false; // 本轮重置，扫描命中后置真
      // 诊断#刷屏修复：原先每轮(2s)都无条件打印"定向模式启用"刷屏控制台；
      // 改为仅在「全量↔定向」状态切换、或任务点 id 集真变化(_taskChanged)时打印，稳定态保持静默。
      if (_dbgTargetState !== 'target' || _taskChanged) {
        dbg('定向模式启用，任务点 id 数=', keyArr.length);
        _dbgTargetState = 'target';
      }
    } else {
      // 滞回分支修补（吸收外部评审 2.1）：保持"空窗不回退"的滞回设计不变（避免定向↔全量横跳），
      // 但此前 matchedAny 只在 if 分支重置——空窗期间沿用旧轮真值，导致 setInterval 里
      // "定向 0 命中→回退全续播"的兜底永不触发，过期 TARGET.ids 可能长期误杀新视频。
      // 现空窗轮也重置 matchedAny，本轮扫描若过期 ids 一个都没命中，兜底立即回退全续播。
      TARGET.matchedAny = false;
      if (!TARGET.enabled) {              // 仅从未启用时才回退，已启用遇瞬时空窗保持稳定
        TARGET.enabled = false;
        TARGET.ids = null;
        TARGET.keys = null;
        // 诊断#刷屏修复：仅在「定向→全量」状态跃迁那一次打印，避免后续每轮重复刷屏。
        if (_dbgTargetState !== 'fallback') {
          dbg('无可用 attachments 任务点，回退全续播');
          _dbgTargetState = 'fallback';
        }
      }
    }
    try { Store.emit('targets:updated'); } catch (e) { swallow(e); }   // P3：定向目标变更信号（事件总线，供 UI 订阅刷新面板）
  }

  // 任务点 id 的边界正则缓存：要求 key 前后为非字母数字边界或字符串边界。
  // 注：v3.9 曾把边界收窄为 [/?&=.#]，系"纯损"修改——该集合是 [^A-Za-z0-9] 的真子集，
  // 会漏匹 _ - : 等分隔符包裹的合法 id(如 lesson_123 / clip-123)，而旧版本就不会把 123 误命中 12345
  //(因 "12345" 中 "123" 之后是 alnum '5'，边界不成立)。故回退到 [^A-Za-z0-9]（吸收评审 A）。
  const _keyReCache = new Map();   // 评审PR1：const + Map（替代 var+{}），避免键隐式字符串化、更清晰
  /**
   * 构造/缓存定向键正则：对 key 做正则转义并编译为忽略大小写匹配（白名单命中判据）。
   * 评审PR1：缓存由 {} 改为 Map，避免重复编译、便于收敛到 toolkit.keyRe 暴露。
   * @param {string} key - 定向键（如章节名片段）
   * @returns {RegExp} 转义后、忽略大小写的正则
   */
  function keyRe(key) {
    if (!_keyReCache.has(key)) {
      const esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      _keyReCache.set(key, new RegExp('(?:^|[^A-Za-z0-9])' + esc + '(?:[^A-Za-z0-9]|$)'));
    }
    return _keyReCache.get(key);
  }

  // 判断某 video 是否属于任务点：向上收集 video.currentSrc / 祖先 iframe 的 src/name/id/data，
  // 任一含白名单 id 即命中。定向未启用或缺白名单时返回 true（全续播兜底）。
  /**
   * 判断视频 v 是否属于当前定向任务（命中白名单键/附件 ID）。
   * 用于定向统计与「非任务视频不接管」的跳过闸门。
   * @param {HTMLVideoElement} v - 视频元素
   * @returns {boolean}
   */
  function videoBelongsToTask(v) {
    if (!TARGET.enabled || !TARGET.ids) return true;
    try {
      var urls = [];
      try { if (v.currentSrc) urls.push(v.currentSrc); } catch (e) { swallow(e); }
      try { if (v.src) urls.push(v.src); } catch (e) { swallow(e); }
      // 修复复审#2：iframe 内视频 parentElement 链够不到父文档 iframe，故把下钻时传入的宿主 iframe 签名并入匹配源
      try { var _hs = cxState(v).hostSigs; if (_hs) { for (var _hi = 0; _hi < _hs.length; _hi++) { if (_hs[_hi]) urls.push(_hs[_hi]); } } } catch (e) { swallow(e); }
      var el = v;
      while (el && el.parentElement) {
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          try { if (el.src) urls.push(el.src); } catch (e) { swallow(e); }
          try { if (el.id) urls.push(el.id); } catch (e) { swallow(e); }
          try { if (el.name) urls.push(el.name); } catch (e) { swallow(e); }
          try { if (el.getAttribute) { var d = el.getAttribute('data'); if (d) urls.push(d); } } catch (e) { swallow(e); }
        }
      }
      const idKeys = TARGET.keys || Object.keys(TARGET.ids);   // 评审#2：优先用缓存 key 数组
      for (let ki = 0; ki < idKeys.length; ki++) {
        const key = idKeys[ki];
        const re = keyRe(key);
        for (let u = 0; u < urls.length; u++) {
          if (urls[u] && re.test(urls[u])) return true;
        }
      }
    } catch (e) { swallow(e); }
    return false; // 定向模式但无任何白名单 id 命中 → 视为广告/插播 → 跳过
  }

  // 评审PR1：暴露纯函数 keyRe / collectAttachmentIds 到 toolkit，供诊断与单测 inspect（行为不变）
  try { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit) { window.__CX_FORCE_PLAY.toolkit.keyRe = keyRe; window.__CX_FORCE_PLAY.toolkit.collectAttachmentIds = collectAttachmentIds; } } catch (e) {}
