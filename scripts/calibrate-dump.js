/* ============================================================================
 * calibrate-dump.js  —  真实站点选择器采集脚本（粘贴到浏览器 DevTools Console 运行）
 * ----------------------------------------------------------------------------
 * 用途：在目标网课/DeepSeek 页面打开并按"采集时机"运行，脚本会打印出
 *       当前页面真实的 class / 选择器 / 平台特征，复制输出反馈给开发方
 *       即可精准替换 best-effort 项。
 *
 * 对应需求：历史需求见旧文档中的 CRAWLER_REQUIREMENTS.md（RQ-01..RQ-11）；
 * 当前采集步骤见 docs/calibration-guide.md。
 * 本脚本按"目标站点"自动分发到对应校准区：
 *   - 通用弹窗校准区（按站点分发）→ RQ-01 超星 / RQ-04 智慧树 / RQ-08 多平台
 *   - 作业/考试页真答题校准区（按站点分发）→ RQ-02 超星 / RQ-05 智慧树 / RQ-07 多平台
 *   - 多平台播放器容器区 → RQ-03 / RQ-06
 *   - DeepSeek 应答端校准区 → RQ-09
 *   - edu.cn 特征校准区 → RQ-10
 *   - RQ-11 为后端联调契约（非 DOM 采集），不在本脚本内。
 *
 * 运行方式：
 *   1. 浏览器打开目标页面（如超星学习通作业页 / 上课互动弹窗 / chat.deepseek.com）
 *   2. F12 → Console
 *   3. 把本文件全部内容粘贴进去回车
 *   4. 复制控制台里 "==== CALIBRATION DUMP ====" 到 "==== END ====" 之间的内容发回
 * 注意：本脚本只读 DOM，不修改页面、不发网络请求，安全。
 * ==========================================================================*/
(function () {
  var L = [];
  function log(k, v) { L.push(k + ' = ' + (v == null ? '(空)' : v)); }
  function cls(el) {
    if (!el) return '(null)';
    var c = el.className;
    if (typeof c === 'string' && c) return c.trim().split(/\s+/).slice(0, 6).join('.').replace(/^\./, '');
    return el.tagName || '(unknown)';
  }
  function first(sel) {
    try { var e = document.querySelector(sel); return e ? (e.tagName.toLowerCase() + '.' + cls(e)) : '(无匹配)'; } catch (e) { return '(选择器非法)'; }
  }
  function attrs(el) {
    if (!el) return '(null)';
    var out = [];
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      out.push(a.name + (a.value ? '="' + a.value.slice(0, 40) + '"' : ''));
    }
    return out.join(' ');
  }
  function txt(el, max) {
    if (!el) return '(null)';
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, max || 60);
  }
  // 稳定类前缀：DeepSeek 为 SPA，class 常带 hash（如 _27c9245 / d96f2d2a），每次构建可能变。
  // 仅过滤「以 _ 开头的类」与「纯 hex 串（≥6 位）」，保留 ds-scroll-area / ds-chat 这类语义稳定前缀。
  function stablePrefixes(el) {
    if (!el || typeof el.className !== 'string') return '(none)';
    var out = el.className.trim().split(/\s+/).filter(function (c) {
      if (c.charAt(0) === '_') return false;
      if (/^[0-9a-f]{6,}$/i.test(c)) return false;
      return true;
    }).slice(0, 4);
    return out.join('.') || '(none)';
  }
  // 结构骨架：从某元素出发打印 深度≤depth 的 tag.稳定前缀[子数]，供人工反推容器（如 DeepSeek 无 main/header 时）
  function skeleton(el, depth, width) {
    if (!el) return '(null)';
    depth = depth || 4; width = width || 6;
    var lines = [];
    (function walk(node, d, prefix) {
      if (!node || !node.children || d > depth) return;
      var kids = node.children;
      var n = Math.min(kids.length, width);
      for (var i = 0; i < n; i++) {
        var c = kids[i];
        var name = (c.tagName || '?').toLowerCase();
        if (name === 'script' || name === 'style' || name === 'svg' || name === 'link' || name === 'meta') continue;
        var sp = stablePrefixes(c);
        lines.push(prefix + name + (sp !== '(none)' ? '.' + sp : '') + ' [' + kids.length + ']');
        walk(c, d + 1, prefix + '  ');
      }
    })(el, 0, '');
    return lines.join('\n') || '(空)';
  }

  var host = location.hostname;
  var path = location.pathname;
  var href = location.href;
  log('PAGE_HOST', host);
  log('PAGE_URL', href);

  /* ---------- 通用：弹窗校准区（RQ-01/04/08 共用骨架，按站点分发调用） ---------- */
  function dumpPopup(tag) {
    log('--- ' + tag + ' ---', '');
    // 弹窗容器：找含"题目/答题"语义的可见浮层（先让弹窗出现再运行本脚本）
    var boxes = document.querySelectorAll('.dialog,.modal,.popup,[class*="dialog"],[class*="modal"],[class*="popup"],[class*="mask"],[class*="layer"]');
    var visibleBox = null;
    boxes.forEach(function (b) { if (!visibleBox && b.offsetParent) visibleBox = b; });
    if (!visibleBox) { log('POPUP_BOX', '(当前页面无可见弹窗——请在弹窗弹出时运行本脚本)'); return; }
    log('POPUP_BOX', visibleBox.tagName.toLowerCase() + '.' + cls(visibleBox));
    log('POPUP_TEXT', txt(visibleBox, 80));
    var closeBtn = visibleBox.querySelector('button[aria-label*="关闭"],button[aria-label*="close"],.close,[class*="close"],[class*="dismiss"]');
    log('POPUP_CLOSE', closeBtn ? (closeBtn.tagName.toLowerCase() + '.' + cls(closeBtn) + (closeBtn.getAttribute('aria-label') ? ' [aria-label="' + closeBtn.getAttribute('aria-label') + '"]' : '')) : '(弹窗内未见关闭按钮)');
    var q = visibleBox.querySelector('.questionLi,.questionBox,.topic-item,.qItem,.question-item,[class*="question"],[class*="topic"],[class*="ques"]');
    log('QUESTION_EL', q ? (q.tagName.toLowerCase() + '.' + cls(q)) : '(未命中题容器)');
    var opt = visibleBox.querySelector('.answerBg,.answerOption,.option,.choice,.select-item,[class*="option"],[class*="answer"],[class*="choice"]');
    log('OPTION_EL', opt ? (opt.tagName.toLowerCase() + '.' + cls(opt)) : '(未命中选择项)');
    var submit = visibleBox.querySelector('button[class*="submit"],button[class*="answer-btn"],[class*="submit"],[class*="confirm"]');
    log('ANSWER_BTN', submit ? (submit.tagName.toLowerCase() + '.' + cls(submit)) : '(未命中作答/提交按钮)');
  }

  /* ---------- 通用：作业/考试页真答题校准区（RQ-02/05/07 共用骨架，按站点分发调用） ---------- */
  function dumpQuiz(tag) {
    log('--- ' + tag + ' ---', '');
    var q = document.querySelector('.questionLi,.questionBox,.topic-item,.qItem,.question-item,[class*="question"],[class*="topic"],[class*="ques"],[class*="exercise"]');
    if (!q) { log('QUESTION_EL', '(当前页面未见题目容器——请在题目渲染完成后运行)'); return; }
    log('QUESTION_EL', q.tagName.toLowerCase() + '.' + cls(q));
    // 题干容器（RQ-02 重点：校准 stemSels）：题目容器内前几个非选项/按钮的直接子块
    var stem = null;
    var kids = q.children;
    for (var i = 0; i < kids.length && i < 5; i++) {
      var k = kids[i];
      var t = (k.textContent || '').trim();
      if (t.length > 4 && !/(option|answer|choice|select|input|btn)/i.test(String(k.className || ''))) { stem = k; break; }
    }
    log('STEM_EL', stem ? (stem.tagName.toLowerCase() + '.' + cls(stem)) : '(题干未单独成块——可能为纯文本节点)');
    log('STEM_TEXT', txt(stem || q, 80));
    var opt = document.querySelector('.answerBg,.answerOption,.option,.choice,.select-item,.Zy_ulTop li,[class*="option"],[class*="answer"],[class*="choice"]');
    log('OPTION_EL', opt ? (opt.tagName.toLowerCase() + '.' + cls(opt)) : '(未命中选择项)');
    log('OPTION_ATTRS', opt ? attrs(opt) : '(无)');
    var next = document.querySelector('button[class*="next"],.next,.next-btn,[class*="next"],a[title*="下一"]');
    log('NEXT_BTN', next ? (next.tagName.toLowerCase() + '.' + cls(next)) : '(未命中翻页/下一题按钮)');
    var submit = document.querySelector('button[class*="submit"],button[class*="commit"],.submit,.submit-btn,.btn-submit,[class*="submit"]');
    log('SUBMIT_BTN', submit ? (submit.tagName.toLowerCase() + '.' + cls(submit)) : '(未命中提交/交卷按钮)');
  }

  /* ---------- 1. 通用弹窗区：按站点分发（RQ-01 超星 / RQ-04 智慧树 / RQ-08 多平台） ---------- */
  if (/chaoxing\.com|xueyinonline\.com|edu\.cn/.test(host)) {
    dumpPopup('超星·上课互动弹窗校准');
    log('VIDEO_CT', first('.ans-attach-ct,.ans-attachbox,.video-container,#video'));
  }
  if (/zhihuishu\.com/.test(host)) {
    dumpPopup('智慧树·上课随堂弹窗校准');
  }
  if (/icourse163\.org|icourses\.cn|xuetangx\.com|icve\.com\.cn/.test(host)) {
    dumpPopup('多平台·上课弹窗校准');
  }

  /* ---------- 2. 作业/考试页真答题区：按站点分发（RQ-02 超星 / RQ-05 智慧树 / RQ-07 多平台） ---------- */
  if (/chaoxing\.com|xueyinonline\.com/.test(host) && /doHomeWorkNew|doHomework|work|exam/i.test(href)) {
    dumpQuiz('超星作业/考试页校准');
  }
  if (/zhihuishu\.com/.test(host) && /(^|\/)(dohomework|webExamList|stuExamWeb|doExam|examList|onlineExam|exam|homework|doHomeWork)(?![a-z0-9])/i.test(href)) {
    dumpQuiz('智慧树作业/考试页校准');
  }
  if (/pmphmooc\.com|(^|[-.])renwei\.(com|cn|edu\.cn)|unipus\.cn|ucampus\.cn|ilab-x\.com/.test(host)) {
    dumpQuiz('多平台真答题校准');
  }

  /* ---------- 3. 多平台播放器容器（RQ-03 / RQ-06） ---------- */
  if (/zhihuishu\.com|icourse163\.org|icourses\.cn|xuetangx\.com|icve\.com\.cn|(^|[-.])renwei\.(com|cn|edu\.cn)|unipus\.cn|ucampus\.cn|ilab-x\.com/.test(host)) {
    log('--- 多平台播放器容器校准 ---', '');
    log('VIDEO_CT_TRY', first('.video-container,.video-wrap,#video,.course-player,.jwplayer,.player-box,.lab-player,[class*="player"],[class*="video"]'));
  }

  /* ---------- 4. DeepSeek 应答端（RQ-09） ---------- */
  /* 注意：DeepSeek 为 SPA，class 多为带 hash 的 BEM 名（如 _27c9245 / d96f2d2a），
     每次构建可能变化——校准时只用稳定前缀（如 ds-scroll-area / ds-chat），不硬编码 hash 类。
     候选选择器 miss 时做启发式宽扫描，确保仍能暴露真实 class 供校准。 */
  if (/deepseek\.com/.test(host)) {
    log('--- DeepSeek 应答端校准 ---', '');
    // 登录态：已登录时无登录按钮（LOGIN_BTN="无匹配"属正常信号，勿改 loginBtnSel）
    log('LOGIN_BTN', first('a[href*="login"],a[href*="auth"],button[class*="login"]'));
    // 输入框（稳定，保留 textarea 回退）
    var input = document.querySelector('textarea[placeholder^="给 DeepSeek 发送消息"],textarea,textarea.ds-scroll-area');
    log('INPUT', input ? (input.tagName.toLowerCase() + '.' + cls(input)) : '(无匹配)');
    log('INPUT_STABLE', input ? stablePrefixes(input) : '(none)');
    log('FILE_INPUT', first('input[type=file],input[accept*="image"],[class*="upload"] input[type=file]'));
    // 输入框祖先链（定位发送按钮同容器）
    if (input) {
      var chain = [], p = input.parentElement, d = 0;
      while (p && d < 5) { chain.push(p.tagName.toLowerCase() + '.' + stablePrefixes(p)); p = p.parentElement; d++; }
      log('INPUT_PARENT', chain.join(' < '));
    }
    // 发送按钮：新 UI 可能无 <button>，改用 role=button / aria-label 语义扫描
    var send = document.querySelector('button[aria-label*="发送"],button[aria-label*="send"],div[role="button"][aria-label*="发送"],div[role="button"][aria-label*="send"],button:last-of-type');
    if (!send) {
      var sCands = Array.prototype.slice.call(document.querySelectorAll('button,div[role="button"],a')).filter(function (b) {
        var t = ((b.getAttribute && b.getAttribute('aria-label')) || '') + ' ' + (b.textContent || '');
        return /发送|send|submit/i.test(t) && t.trim().length < 30;
      });
      send = sCands[0] || null;
    }
    log('SEND_BTN', send ? (send.tagName.toLowerCase() + '.' + stablePrefixes(send) + (send.getAttribute && send.getAttribute('aria-label') ? ' [aria-label="' + send.getAttribute('aria-label') + '"]' : '')) : '(未命中——见 SEND_CANDIDATES)');
    // 发送按钮候选枚举：列出页面全部可点元素（button / div[role=button] / a）的稳定前缀 + aria-label + 父容器，供定位
    var clicks = Array.prototype.slice.call(document.querySelectorAll('button,div[role="button"],a'));
    var scRep = [];
    for (var sci = 0; sci < clicks.length && sci < 16; sci++) {
      var cb = clicks[sci];
      var cbl = (cb.getAttribute && cb.getAttribute('aria-label')) || '';
      var cbt = (cb.textContent || '').trim().slice(0, 12);
      var cbp = cb.parentElement ? stablePrefixes(cb.parentElement) : '(none)';
      scRep.push(cb.tagName.toLowerCase() + '.' + stablePrefixes(cb) + ' [aria="' + cbl + '"][txt="' + cbt + '"] <' + cbp + '>');
    }
    log('SEND_CANDIDATES', scRep.join(' | '));
    // 头像：优先语义命中 ds-avatar / 账户 / profile；否则枚举全部 img 打印 alt + 父稳定前缀
    var avatar = document.querySelector('img[class*="avatar"],img[class*="ds-avatar"],img[aria-label*="账户"],img[aria-label*="profile"],[class*="avatar"],[aria-label*="账户"],[aria-label*="profile"],[class*="user"],[class*="account"]');
    log('AVATAR', avatar ? (avatar.tagName.toLowerCase() + '.' + stablePrefixes(avatar) + (avatar.getAttribute && avatar.getAttribute('aria-label') ? ' [aria-label="' + avatar.getAttribute('aria-label') + '"]' : '')) : '(无语义命中——见 AVATAR_CANDIDATES)');
    var imgs = document.querySelectorAll('img');
    var imgRep = [];
    for (var ii = 0; ii < imgs.length && ii < 16; ii++) {
      var im = imgs[ii];
      var ialt = (im.getAttribute && im.getAttribute('alt')) || '';
      var iar = (im.getAttribute && im.getAttribute('aria-label')) || '';
      var ip = im.parentElement ? stablePrefixes(im.parentElement) : '(none)';
      imgRep.push('img[alt="' + ialt.slice(0, 16) + '"][aria="' + iar.slice(0, 16) + '"] <' + ip + '>');
    }
    log('AVATAR_CANDIDATES', imgRep.join(' | '));
    // 消息列表：不再依赖 <main>；扫 #root 下含语义容器，否则报告根骨架
    var msgList = document.querySelector('[role="list"],[class*="chat"],[class*="conversation"],[class*="message"],[class*="thread"],[class*="dialog"],[class*="editor"],[class*="composer"],main,form');
    if (msgList) {
      log('MSG_LIST', msgList.tagName.toLowerCase() + '.' + stablePrefixes(msgList));
      var mItems = msgList.querySelectorAll('[class*="message"],[data-message-id],[role="listitem"],div[class*="bubble"],div[class*="turn"]');
      log('MSG_ITEM_COUNT', mItems.length);
      var lastM = mItems[mItems.length - 1];
      log('LAST_MSG_EL', lastM ? (lastM.tagName.toLowerCase() + '.' + stablePrefixes(lastM)) : '(容器内未定位消息块)');
    } else {
      log('MSG_LIST', '(候选miss)');
    }
    // 根结构骨架：彻底看清布局（DeepSeek 无 main/header 时的人工反推依据）
    var root = document.getElementById('root') || document.body;
    log('ROOT_SKELETON', skeleton(root, 4, 6));
    // 生成中：建议在"正在生成"时运行
    var gen = document.querySelector('[class*="loading"],[class*="spinner"],[class*="thinking"],[class*="generating"]');
    if (!gen) {
      var gC = Array.prototype.slice.call(document.querySelectorAll('div,span')).filter(function (e) {
        var t = (e.textContent || '').trim();
        return /思考中|正在生成|生成中|thinking|generating|loading/i.test(t) && t.length < 24;
      });
      gen = gC[0] || null;
    }
    log('GENERATING', gen ? (gen.tagName.toLowerCase() + '.' + stablePrefixes(gen) + ' 文本="' + (gen.textContent || '').trim().slice(0, 12) + '"') : '(未命中——建议 DeepSeek 正在生成回复时运行)');
  }

  /* ---------- 5. edu.cn 高校镜像特征（RQ-10，校准 isChaoxingEduCn 三特征） ---------- */
  if (/edu\.cn$/.test(host)) {
    log('--- edu.cn 高校镜像特征校准 ---', '');
    var hostFeats = ['mooc', 'learn', 'course', 'study', 'class', 'kczy', 'sxk', 'mycourse', 'visit', 'space'];
    var h0 = host.split('.')[0];
    var hitHost = hostFeats.filter(function (f) { return new RegExp('(^|[-.])' + f + '\\.', 'i').test(host); });
    log('HOST_FEAT', hitHost.length ? ('命中特征: ' + hitHost.join(',')) : ('未命中以上特征; 主机第一段=' + (h0 || '(无)')));
    var pathFeats = ['/learn', '/mooc', '/course', '/mycourse', '/visit', '/knowledge', '/work', '/exam', '/space', '/study', '/portal', '/mooc-ans'];
    var hitPath = pathFeats.filter(function (f) { return path.indexOf(f) === 0; });
    log('PATH_FEAT', hitPath.length ? ('命中前缀: ' + hitPath.join(',')) : '未命中以上路径前缀');
    log('GLOBALS', 'window.ananas=' + (window.ananas ? '存在' : '不存在') + '; window.attachments=' + (window.attachments instanceof Array ? ('数组(' + window.attachments.length + ')') : typeof window.attachments));
  }

  console.log('==== CALIBRATION DUMP ====');
  console.log(L.join('\n'));
  console.log('==== END ====');
  // 同时尝试写入剪贴板（部分环境允许）
  try {
    if (navigator.clipboard) navigator.clipboard.writeText('==== CALIBRATION DUMP ====\n' + L.join('\n') + '\n==== END ====').catch(function(){});
  } catch (e) {}
})();
