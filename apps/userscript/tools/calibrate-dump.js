/* ============================================================================
 * calibrate-dump.js  —  真实站点选择器采集脚本（粘贴到浏览器 DevTools Console 运行）
 * ----------------------------------------------------------------------------
 * 用途：在目标网课/DeepSeek 页面打开并按"采集时机"运行，脚本会打印出
 *       当前页面真实的 class / 选择器 / 平台特征，复制输出反馈给开发方
 *       即可精准替换 best-effort 项。
 *
 * 对应需求：历史需求见旧文档中的 CRAWLER_REQUIREMENTS.md（RQ-01..RQ-11）；
 * 当前采集步骤见项目根 docs/calibration-guide.md。
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
 *
 * 2026-08-14 修正：
 *   - 超星作业/考试页触发条件放宽：「超星域名 + 页面已渲染题目容器」即触发，
 *     覆盖 studentstudy 顶层页。
 *   - 关键：题目常嵌在 doHomeWorkNew iframe 内，顶层 document 拿不到其 DOM。
 *     现脚本会(a)先在本上下文找；(b)若没有，遍历同域 iframe 自动钻取题目容器；
 *     (c)若 iframe 跨域无法访问，打印所有 iframe 的 src/name，提示手动切换到
 *     含 work/exam/doHomeWork 的 frame 再跑。
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
  function first(sel, doc) { doc = doc || document;
    try { var e = doc.querySelector(sel); return e ? (e.tagName.toLowerCase() + '.' + cls(e)) : '(无匹配)'; } catch (e) { return '(选择器非法)'; }
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
  function stablePrefixes(el) {
    if (!el || typeof el.className !== 'string') return '(none)';
    var out = el.className.trim().split(/\s+/).filter(function (c) {
      if (c.charAt(0) === '_') return false;
      if (/^[0-9a-f]{6,}$/i.test(c)) return false;
      return true;
    }).slice(0, 4);
    return out.join('.') || '(none)';
  }
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
  log('CTX', (window.self === window.top ? 'TOP(顶层)' : 'IFRAME(帧内, src=' + (window.frameElement ? (window.frameElement.src || '(无src)') : '(无frameElement)') + ')'));

  // 通用题目容器探测：跨站点复用，返回首个匹配的题容器元素（doc 可指定 iframe 文档）
  var QUIZ_CANDIDATE_SELS = '.Zy_ulTop,.questionLi,.questionBox,.topic-item,.qItem,.question-item,.examPaper,[class*="question"],[class*="topic"],[class*="ques"],[class*="exercise"],[class*="questionnaire"]';
  function probeQuizContainer(doc) {
    doc = doc || document;
    var nodes = doc.querySelectorAll(QUIZ_CANDIDATE_SELS);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.offsetParent !== null || n.getClientRects().length) {
        var hasOpt = n.querySelector('li,a,input,[class*="option"],[class*="answer"],[class*="choice"],[class*="num_option"]');
        if (hasOpt) return n;
      }
    }
    return null;
  }

  /* ---------- frame 清单：顶层页无题目时，列出所有 iframe（含绝对地址/跨域标记） ---------- */
  function absUrl(s) {
    if (!s) return '';
    try { return new URL(s, location.href).href; } catch (e) { return s; }
  }
  function isCrossOrigin(f) {
    try {
      var fd = f.contentDocument;
      return !fd; // 能拿到 contentDocument 即同域；拿不到（抛错或 null）即跨域
    } catch (e) { return true; }
  }
  function dumpFrames() {
    var frames = document.querySelectorAll('iframe');
    if (!frames.length) { log('FRAMES', '(本页无 iframe)'); return; }
    var rep = [];
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var raw = f.src || f.getAttribute('src') || '(无 src/可能是动态)';
      var full = absUrl(raw);
      var xo = isCrossOrigin(f);
      var tag = (xo ? '[跨域·需手动打开]' : '[可读·已自动钻取]');
      if (/doHomeWorkNew|doHomework|work|exam|question|topic|cards|knowledge/i.test(full + '/' + (f.name || ''))) tag += ' [疑似答题帧]';
      rep.push('#' + i + ' <' + (f.name || '(无名)') + '>\n          url=' + full + '\n          ' + tag);
    }
    log('FRAMES', rep.join('\n          '));
    log('FRAME_HINT', '本页无题目 → 题目在上面的[疑似答题帧]内。操作任选其一：①DevTools Console 左上角「执行上下文」下拉切到该 frame 再跑本脚本；②把该帧的 url 复制到地址栏直接打开此页面，在 TOP 上下文跑本脚本（同域可直读）。');
  }

  /* ---------- 通用：弹窗校准区（RQ-01/04/08 共用骨架，按站点分发调用） ---------- */
  function dumpPopup(tag, doc) {
    doc = doc || document;
    log('--- ' + tag + ' ---', '');
    var boxes = doc.querySelectorAll('.dialog,.modal,.popup,[class*="dialog"],[class*="modal"],[class*="popup"],[class*="mask"],[class*="layer"]');
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
  function dumpQuiz(tag, doc) {
    doc = doc || document;
    log('--- ' + tag + ' ---', '');
    var q = probeQuizContainer(doc);
    if (!q) { log('QUESTION_EL', '(当前页面未见题目容器——请在题目渲染完成后运行)'); return; }
    log('QUESTION_EL', q.tagName.toLowerCase() + '.' + cls(q));
    // 题干容器
    var stem = null;
    var kids = q.children;
    for (var i = 0; i < kids.length && i < 5; i++) {
      var k = kids[i];
      var t = (k.textContent || '').trim();
      if (t.length > 4 && !/(option|answer|choice|select|input|btn|num_option)/i.test(String(k.className || ''))) { stem = k; break; }
    }
    if (!stem) {
      var wide = doc.querySelector('.questionTitle,.qItemTitle,.topic-title,.stem,[class*="title"],[class*="stem"]');
      stem = wide;
    }
    log('STEM_EL', stem ? (stem.tagName.toLowerCase() + '.' + cls(stem)) : '(题干未单独成块——可能为纯文本节点)');
    log('STEM_TEXT', txt(stem || q, 80));

    // 选项：优先命中超星 .Zy_ulTop li，其次通用并集
    var optContainer = q.querySelector('.Zy_ulTop') || q;
    var opts = optContainer.querySelectorAll('li, [class*="option"], [class*="answer"], [class*="choice"], .num_option, span[class*="option"]');
    log('OPTION_COUNT', opts.length);
    if (opts.length) {
      var sample = [];
      for (var oi = 0; oi < Math.min(opts.length, 4); oi++) {
        var o = opts[oi];
        var oCls = cls(o);
        var oText = txt(o.querySelector('a,span') || o, 24);
        var oData = o.getAttribute('data') || o.getAttribute('data-id') || o.getAttribute('value') || '';
        var checked = (o.getAttribute('aria-checked') === 'true') || /check_answer|on/.test(oCls) ? ' [已选]' : '';
        sample.push('(' + o.tagName.toLowerCase() + '.' + oCls + ' data="' + oData + '" txt="' + oText + '"' + checked + ')');
      }
      log('OPTION_SAMPLE', sample.join(' '));
    }
    var opt0 = opts[0];
    log('OPTION_EL', opt0 ? (opt0.tagName.toLowerCase() + '.' + cls(opt0)) : '(未命中选择项)');
    log('OPTION_ATTRS', opt0 ? attrs(opt0) : '(无)');

    var next = doc.querySelector('button[class*="next"],.next,.next-btn,[class*="next"],a[title*="下一"]');
    log('NEXT_BTN', next ? (next.tagName.toLowerCase() + '.' + cls(next)) : '(未命中翻页/下一题按钮)');
    var submit = doc.querySelector('button[class*="submit"],button[class*="commit"],.submit,.submit-btn,.btn-submit,[class*="submit"]');
    log('SUBMIT_BTN', submit ? (submit.tagName.toLowerCase() + '.' + cls(submit)) : '(未命中提交/交卷按钮)');
  }

  /* ---------- 超星作业/考试页增强采集（RQ-02，覆盖 .Zy_ulTop 真实结构） ---------- */
  function dumpChaoxingQuiz(doc) {
    doc = doc || document;
    log('--- 超星作业/考试页校准(增强) ---', '');
    var ul = doc.querySelector('ul.Zy_ulTop');
    var qc = ul || probeQuizContainer(doc);
    if (!qc) { log('QUESTION_EL', '(当前页面未见题目容器——请在题目渲染完成后运行)'); return; }
    log('QUESTION_EL', qc.tagName.toLowerCase() + '.' + cls(qc));
    // 题块（含题干+选项的祖先）
    var block = null;
    try { block = qc.closest('[class*="question"],[class*="topic"],[class*="ques"],[class*="exam"]') || (qc.parentElement && qc.parentElement.parentElement); } catch (e) {}
    if (!block && qc.parentElement) block = qc.parentElement;
    log('QUESTION_BLOCK', block ? (block.tagName.toLowerCase() + '.' + cls(block)) : '(无)');
    // 题干：题块内非选项区的长文本节点
    var stem = null;
    if (block) {
      var kids = block.children;
      for (var si = 0; si < kids.length; si++) {
        var k = kids[si];
        if (k === qc || (qc.contains && qc.contains(k))) continue;
        var st = (k.textContent || '').replace(/\s+/g, ' ').trim();
        if (st.length > 5) { stem = k; break; }
      }
    }
    if (!stem) stem = doc.querySelector('.questionTitle,.qItemTitle,.topic-title,.stem,[class*="title"],[class*="stem"]');
    log('STEM_EL', stem ? (stem.tagName.toLowerCase() + '.' + cls(stem)) : '(题干未单独成块)');
    log('STEM_TEXT', txt(stem || qc, 120));
    log('QUESTION_SKELETON', skeleton(block || qc, 3, 5));
    // 选项：直接 li 子项，避免 span 重复计数
    var opts = qc.querySelectorAll('li');
    log('OPTION_COUNT', opts.length);
    if (opts.length) {
      var sample = [];
      for (var oi = 0; oi < Math.min(opts.length, 6); oi++) {
        var o = opts[oi];
        var oCls = cls(o);
        var lbl = o.getAttribute('aria-label') || '';
        var letter = (lbl.split(/\s+/)[0] || '');
        var qid = o.getAttribute('qid') || '';
        var qtype = o.getAttribute('qtype') || '';
        var inner = o.querySelector('span,div,a');
        var oText = txt(inner || o, 30);
        var checked = (o.getAttribute('aria-checked') === 'true') || /check_answer/.test(oCls) || (o.querySelector && o.querySelector('.check_answer') ? true : false) ? ' [已选]' : '';
        sample.push('(li.' + oCls + ' letter="' + letter + '" qid="' + qid + '" qtype="' + qtype + '" label="' + lbl.slice(0, 30) + '" txt="' + oText + '"' + checked + ')');
      }
      log('OPTION_SAMPLE', sample.join('\n          '));
    }
    var opt0 = opts[0];
    log('OPTION_EL', opt0 ? (opt0.tagName.toLowerCase() + '.' + cls(opt0)) : '(未命中选择项)');
    log('OPTION_ATTRS', opt0 ? attrs(opt0) : '(无)');
    log('OPTION_ONCLICK', opt0 && opt0.getAttribute('onclick') ? opt0.getAttribute('onclick') : '(无/由事件委托)');
    // 翻页/提交/交卷：扫描全页 button/input/a，按文本或类命中
    var btns = Array.prototype.slice.call(doc.querySelectorAll('button,input[type=button],input[type=submit],a.btn,a[class*="btn"]'));
    var btnRep = [];
    for (var bi = 0; bi < btns.length && bi < 24; bi++) {
      var b = btns[bi];
      var bt = ((b.textContent || '') + ' ' + (b.value || '')).replace(/\s+/g, ' ').trim().slice(0, 16);
      var bCls = cls(b);
      var role = b.getAttribute('role') || '';
      var hit = /下一|上题|提交|交卷|save|submit|next|prev|继续/i.test(bt + bCls + role) ? ' <<<动作按钮' : '';
      btnRep.push(b.tagName.toLowerCase() + '.' + bCls + ' [txt="' + bt + '"][role="' + role + '"]' + hit);
    }
    log('ALL_BUTTONS', btnRep.join('\n          '));
    var next = doc.querySelector('button[class*="next"],.next,.next-btn,[class*="next"],a[title*="下一"],a[class*="next"]');
    log('NEXT_BTN', next ? (next.tagName.toLowerCase() + '.' + cls(next) + ' [txt="' + (next.textContent || '').trim().slice(0, 12) + '"]') : '(未命中通用下一题→见 ALL_BUTTONS)');
    var submit = doc.querySelector('button[class*="submit"],button[class*="commit"],.submit,.submit-btn,.btn-submit,[class*="submit"],button[class*="save"],button[class*="exam"]');
    log('SUBMIT_BTN', submit ? (submit.tagName.toLowerCase() + '.' + cls(submit) + ' [txt="' + (submit.textContent || '').trim().slice(0, 12) + '"]') : '(未命中通用提交→见 ALL_BUTTONS)');
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
  // 修正(2026-08-14)：超星作业页题目常嵌 doHomeWorkNew iframe，顶层 document 拿不到。
  // 策略：①本上下文有题目容器→直接 dump；②遍历同域 iframe 自动钻取；③都不行→打印 iframe 清单提示手动切。
  var chaoxingQuizByUrl = /chaoxing\.com|xueyinonline\.com/.test(host) && /doHomeWorkNew|doHomework|work|exam/i.test(href);
  var chaoxingQuizByDom = /chaoxing\.com|xueyinonline\.com/.test(host) && !!probeQuizContainer();
  if (/chaoxing\.com|xueyinonline\.com/.test(host)) {
    if (chaoxingQuizByDom) {
      dumpChaoxingQuiz(document);
    } else {
      // 尝试同域 iframe 自动钻取
      var hitFrame = null, hitDoc = null;
      try {
        var fr = document.querySelectorAll('iframe');
        for (var fi = 0; fi < fr.length; fi++) {
          try {
            var fd = fr[fi].contentDocument;
            if (fd && probeQuizContainer(fd)) { hitFrame = fr[fi]; hitDoc = fd; break; }
          } catch (e) { /* 跨域：跳过，稍后提示 */ }
        }
      } catch (e) {}
      if (hitDoc) {
        var fsrc = hitFrame.src || hitFrame.getAttribute('src') || '(动态无src)';
        dumpQuiz('超星作业/考试页校准(自动跨同域 iframe 命中: ' + fsrc + ')', hitDoc);
      } else {
        // 顶层无、iframe 也拿不到（跨域或异步未渲染）→ 打印清单
        log('--- 超星作业/考试页校准 ---', '');
        log('QUESTION_EL', '(本上下文无题目容器；题目可能嵌在 iframe 内)');
        dumpFrames();
      }
    }
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
  if (/deepseek\.com/.test(host)) {
    log('--- DeepSeek 应答端校准 ---', '');
    log('LOGIN_BTN', first('a[href*="login"],a[href*="auth"],button[class*="login"]'));
    var input = document.querySelector('textarea[placeholder^="给 DeepSeek 发送消息"],textarea,textarea.ds-scroll-area');
    log('INPUT', input ? (input.tagName.toLowerCase() + '.' + cls(input)) : '(无匹配)');
    log('INPUT_STABLE', input ? stablePrefixes(input) : '(none)');
    log('FILE_INPUT', first('input[type=file],input[accept*="image"],[class*="upload"] input[type=file]'));
    if (input) {
      var chain = [], p = input.parentElement, d = 0;
      while (p && d < 5) { chain.push(p.tagName.toLowerCase() + '.' + stablePrefixes(p)); p = p.parentElement; d++; }
      log('INPUT_PARENT', chain.join(' < '));
    }
    var send = document.querySelector('button[aria-label*="发送"],button[aria-label*="send"],div[role="button"][aria-label*="发送"],div[role="button"][aria-label*="send"],button:last-of-type');
    if (!send) {
      var sCands = Array.prototype.slice.call(document.querySelectorAll('button,div[role="button"],a')).filter(function (b) {
        var t = ((b.getAttribute && b.getAttribute('aria-label')) || '') + ' ' + (b.textContent || '');
        return /发送|send|submit/i.test(t) && t.trim().length < 30;
      });
      send = sCands[0] || null;
    }
    log('SEND_BTN', send ? (send.tagName.toLowerCase() + '.' + stablePrefixes(send) + (send.getAttribute && send.getAttribute('aria-label') ? ' [aria-label="' + send.getAttribute('aria-label') + '"]' : '')) : '(未命中——见 SEND_CANDIDATES)');
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
    var root = document.getElementById('root') || document.body;
    log('ROOT_SKELETON', skeleton(root, 4, 6));
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

  var DUMP_TEXT = '==== CALIBRATION DUMP ====\n' + L.join('\n') + '\n==== END ====';
  console.log(DUMP_TEXT);
  try {
    if (navigator.clipboard) navigator.clipboard.writeText(DUMP_TEXT).catch(function(){});
  } catch (e) {}

  /* ---------- 兜底：把 dump 渲染成页面浮层，避免从 Console 复制丢行 ---------- */
  try {
    var box = document.createElement('div');
    box.setAttribute('id', '__calibDumpBox');
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;width:560px;max-height:70vh;' +
      'background:#111;color:#0f0;font:12px/1.4 Consolas,Menlo,monospace;padding:10px;' +
      'border:2px solid #0f0;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.6);overflow:auto;';
    var ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = DUMP_TEXT;
    ta.style.cssText = 'width:100%;height:50vh;background:#000;color:#0f0;border:1px solid #0f0;' +
      'font:12px/1.4 Consolas,Menlo,monospace;resize:none;';
    ta.addEventListener('focus', function () { ta.select(); });
    var tip = document.createElement('div');
    tip.textContent = '校准输出已生成：点此文本框自动全选，Ctrl+C 复制，把全部内容发回开发者。';
    tip.style.cssText = 'color:#ff0;margin-bottom:6px;';
    var close = document.createElement('div');
    close.textContent = '✕ 关闭';
    close.style.cssText = 'position:absolute;right:8px;top:6px;color:#f55;cursor:pointer;';
    close.addEventListener('click', function () { box.remove(); });
    box.appendChild(close);
    box.appendChild(tip);
    box.appendChild(ta);
    (document.body || document.documentElement).appendChild(box);
    // 自动聚焦并全选，用户直接 Ctrl+C 即可
    setTimeout(function () { try { ta.focus(); ta.select(); } catch (e) {} }, 50);
  } catch (e) {}
})();
