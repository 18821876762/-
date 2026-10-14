// 把 tests/fixtures 中的两份 DOM dump（chaoxing-page.html / deepseek-page.html）代表的站点元素模拟出来，
// 并断言现有代码的选择器能正确命中（校准回归）。
//
// 覆盖：
//   A) 学习通：嵌套 iframe 视频播放器(video#video_html5_api / .vjs-big-play-button / iframe[objectid])、
//              任务点列表(li[onclick][title=章节测验] / li.active 锚定)、window.attachments(定向白名单)。
//   B) DeepSeek：SPA 外壳(#root 空壳 + head 脚本)、运行时聊天 DOM(input/send/msgList/reply/generating)。
const { JSDOM } = require('jsdom');
const espree = require('espree');
const path = require('path');
const fx = require('./fixtures-dump-elements.js');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = require('fs').readFileSync(userJs, 'utf8');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

// ============ A) 学习通 ============
console.log('==================== A) 学习通元素模拟 ====================');

// A1. 嵌套 iframe 视频播放器：把播放器 iframe 内容注入 #iframe.contentDocument，断言选择器命中。
{
  const dom = new JSDOM(fx.chaoxingStudyHtml(), {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  // 注入播放器到 #iframe 的 contentDocument（jsdom 若支持跨 frame）
  let iframeDoc = null, iframeWin = null;
  try {
    const outer = document.getElementById('iframe');
    iframeDoc = outer && (outer.contentDocument || null);
    iframeWin = outer && (outer.contentWindow || null);
  } catch (e) {}
  // jsdom 多数版本：contentDocument 为 null → 退化为「顶层平铺」选择器命中测试（见 A2），
  // 这里只验证「iframe 节点本身 + 属性选择器」能命中。
  assert('A1 #iframe 节点存在', !!document.getElementById('iframe'));
  if (iframeDoc) {
    iframeDoc.open(); iframeDoc.write(fx.chaoxingPlayerIframeHtml({})); iframeDoc.close();
    const v = iframeDoc.querySelector('#video_html5_api');
    const btn = iframeDoc.querySelector('.vjs-big-play-button');
    const innerIframe = iframeDoc.querySelector('iframe[objectid]');
    assert('A1 iframe 内 video#video_html5_api 命中', !!v, v && v.id);
    assert('A1 iframe 内 .vjs-big-play-button 命中', !!btn);
    assert('A1 iframe 内 iframe[objectid] 命中', !!innerIframe && innerIframe.getAttribute('objectid') === 'abc123objectid');
  } else {
    console.log('SKIP A1 跨 frame：jsdom contentDocument 为 null（跨 frame 续播由 sim-iframe-pw.js 实机覆盖）');
  }
}

// A2. 平铺版播放器（专测选择器命中，不依赖跨 frame）。
{
  const dom = new JSDOM(fx.chaoxingFlatPlayerHtml({}), {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const v = document.querySelector('#video_html5_api');
  const btn = document.querySelector('.vjs-big-play-button');
  const byObj = document.querySelector('video[objectid]');
  assert('A2 顶层 #video_html5_api 命中', !!v);
  assert('A2 顶层 .vjs-big-play-button 命中', !!btn);
  assert('A2 video[objectid] 属性选择器命中', !!byObj && byObj.getAttribute('objectid') === 'abc123objectid');
}

// A3. 任务点列表 + li.active 锚定（与 sim-auto-next 一致，这里用 fixture 复核）。
{
  const dom = new JSDOM(fx.chaoxingStudyHtml(), {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const exact = [].slice.call(document.querySelectorAll('li[onclick]'));
  const cand = exact.filter(li => /章节测验/.test((li.getAttribute('title') || li.textContent || '').trim()));
  const active = document.querySelector('li.active');
  assert('A3 任务点 li[onclick] 全部命中', exact.length === 5, exact.length);
  assert('A3 章节测验候选 = 2（第一/第二章）', cand.length === 2, cand.map(c => c.getAttribute('title')));
  assert('A3 li.active 是视频任务点', !!active && /视频/.test(active.getAttribute('title') || active.textContent));
  // active 锚定：只取 active 之后的兄弟测验
  let sib = active, hit = null;
  while ((sib = sib.nextElementSibling)) {
    if (sib.tagName === 'LI' && cand.indexOf(sib) >= 0) { hit = sib; break; }
  }
  assert('A3 active 锚定只命中「之后」的第二章章节测验', !!hit && /第二章/.test(hit.getAttribute('title')), hit && hit.getAttribute('title'));
}

// A4. window.attachments 定向白名单结构（targeting.js 依赖）。
{
  const dom = new JSDOM(fx.chaoxingFlatPlayerHtml({}), {
    url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  window.eval(fx.chaoxingAttachmentsScript());
  const att = window.attachments || [];
  assert('A4 window.attachments 已挂载', att.length === 2, att.length);
  const ids = att.map(a => a.property.objectid);
  assert('A4 含 objectid=abc123objectid（与播放器命中）', ids.indexOf('abc123objectid') >= 0, ids);
  assert('A4 含 type=video 任务点', att.some(a => a.property.type === 'video'));
}

// ============ B) DeepSeek ============
console.log('\n==================== B) DeepSeek 元素模拟 ====================');

// B1. SPA 外壳：#root 空壳 + head 脚本（静态 dump 真实样子）。
{
  const dom = new JSDOM(fx.deepseekShellHtml(), {
    url: 'https://chat.deepseek.com/',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const root = document.getElementById('root');
  assert('B1 #root 空壳存在（运行时聊天 DOM 不在此静态 dump）', !!root);
  assert('B1 静态 dump 无 textarea（印证需运行时校准）', document.querySelector('textarea') === null);
  assert('B1 静态 dump 无发送按钮（印证需运行时校准）', document.querySelector('button[aria-label*="发送"]') === null);
}

// B2. 运行时聊天 DOM（按 best-effort 回退选择器模拟）→ responder 命中逻辑。
{
  const dom = new JSDOM(fx.deepseekChatHtml(), {
    url: 'https://chat.deepseek.com/',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const inputSel = 'textarea[placeholder^="给 DeepSeek 发送消息"], textarea, [contenteditable="true"]';
  const sendSel = 'div.ds-button--iconLabelPrimary, button[aria-label*="发送"], button[aria-label*="send"]';
  const msgSel = '.ds-virtual-list, [role="list"], .chat-messages, .ds-chat-messages, main [class*="message"], [class*="conversation"]';

  const ta = document.querySelector(inputSel);
  const sendBtn = document.querySelector(sendSel);
  const box = document.querySelector(msgSel);
  const last = box ? box.querySelectorAll('.ds-message, [role="listitem"], [data-message-id], [class*="message-item"]') : [];
  const lastReply = last.length ? last[last.length - 1] : null;

  assert('B2 输入框命中 textarea[placeholder^="给 DeepSeek 发送消息"]', !!ta && /给 DeepSeek 发送消息/.test(ta.getAttribute('placeholder') || ''));
  assert('B2 发送按钮命中 div.ds-button--iconLabelPrimary', !!sendBtn && /ds-button--iconLabelPrimary/.test(sendBtn.className || ''));
  assert('B2 消息列表命中 .ds-virtual-list', !!box);
  assert('B2 末条消息为 AI 回复（非 user）', !!lastReply && !!lastReply.querySelector('.ds-markdown.ds-assistant-message-main-content'), lastReply && lastReply.className);
  // 登录态启发式：存在可输入 textarea → 已登录特征
  assert('B2 登录态启发式：textarea 存在→视为已登录', document.querySelector('textarea, [contenteditable="true"], div[role="textbox"]') !== null);
}

// B3. 生成中状态：末条 AI 回复含 thinking 占位。
{
  const dom = new JSDOM(fx.deepseekChatGeneratingHtml(), {
    url: 'https://chat.deepseek.com/',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;
  const box = document.querySelector('.ds-virtual-list');
  const items = box.querySelectorAll('.ds-message');
  const lastReply = items[items.length - 1];
  const genSel = '[class*="loading"], [class*="spinner"], [class*="thinking"], [class*="generating"]';
  const generating = !!(lastReply.querySelector(genSel));
  assert('B3 生成中占位命中 [class*="loading"] (site_logo_loading)', generating, lastReply.innerHTML.slice(0, 60));
}

// B4. 固化后的 DEEPSEEK 配置选择器（从 user.js 提取）能命中模拟 DOM。
{
  // 从真实产物 AST 的声明 init.range 提取完整对象，不依赖换行或逗号合并声明。
  const ast = espree.parse(code, { ecmaVersion: 2022, sourceType: 'script', range: true });
  const declarations = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === 'DEEPSEEK') {
      declarations.push(node);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === 'string') walk(value);
    }
  }
  walk(ast);
  const declaration = declarations.length === 1 && declarations[0];
  const init = declaration && declaration.init;
  const objectCode = init && init.type === 'ObjectExpression' ? code.slice(init.range[0], init.range[1]) : null;
  assert('B4 能从 user.js 提取 DEEPSEEK 配置', !!objectCode, { declarations: declarations.length, length: objectCode && objectCode.length });
  if (objectCode) {
    // 浏览器全局（jsdom window）下 eval 出对象
    let DEEPSEEK = null;
    try { DEEPSEEK = (new Function('return (' + objectCode + ');'))(); } catch (e) { assert('B4 eval DEEPSEEK 对象', false, e.message); }
    assert('B4 eval DEEPSEEK 对象成功', !!DEEPSEEK);
    if (DEEPSEEK) {
      const dom = new JSDOM(fx.deepseekChatHtml(), { url: 'https://chat.deepseek.com/', runScripts: 'outside-only', pretendToBeVisual: true });
      const { document } = dom.window;
      const testSel = (label, sel, expectNull) => {
        let r = null; try { r = document.querySelector(sel); } catch (e) { r = 'ERR'; }
        assert('B4 ' + label + ' 命中 =' + (expectNull ? 'null' : '命中'), expectNull ? r === null : !!r, sel + ' => ' + (r === 'ERR' ? 'ERR' : (r ? r.outerHTML.slice(0, 40) : 'null')));
      };
      testSel('inputSel', DEEPSEEK.inputSel, false);
      testSel('sendBtnSel', DEEPSEEK.sendBtnSel, false);
      testSel('msgListSel', DEEPSEEK.msgListSel, false);
      testSel('lastReplySel', DEEPSEEK.lastReplySel, false);
      testSel('generatingSel', DEEPSEEK.generatingSel, true);   // 聊天 DOM 无生成中占位 → 命中 null 正确
      testSel('fileInputSel', DEEPSEEK.fileInputSel, true);       // 模拟聊天 DOM 无 file input → null 正确（回退 input[type=file] 未命中）
      testSel('avatarSel', DEEPSEEK.avatarSel, true);             // 已登录聊天页无头像占位元素 → 依赖运行时节点的真实头像
      // 未登录场景：仅"登录"链接 → loginBtnSel 命中
      const loggedOut = new JSDOM('<html><body><a href="/login">登录</a></body></html>', { url: 'https://chat.deepseek.com/', runScripts: 'outside-only' });
      assert('B4 loginBtnSel 未登录场景命中', !!loggedOut.window.document.querySelector(DEEPSEEK.loginBtnSel));
    }
  }
}

// B5. _dsParseAnswer 解析回归（复刻函数逻辑，确保回复文本→选项下标正确）。
{
  function dsParseAnswer(text) {
    if (!text) return null;
    var m3 = text.match(/(?:答案|正确选项|应选|选择|选)[：:\s为]*([A-D])/i);
    if (m3) {
      // 强模式已是显式答案标注，误采信风险低；仅当答案字母后紧跟否定词（"选 A 不对/不是 A"）才作废
      var _rest = text.slice(m3.index + m3[0].length);
      var _neg = /^(?:[^，。、\n]{0,6}?)(不对|不是|并非|非|错误|不正确|不对的是)/i.test(_rest);
      if (!_neg) return m3[1];
    }
    var m1 = text.match(/(?:^|[\s，。、])([A-D])(?:[\s，。、]|$)/);
    if (m1) {
      var listed = (text.match(/[A-D][)．.、]|\b[A-D]\s*[A-D]\b/g) || []).length;
      if (listed <= 1) return m1[1];
    }
    var m2 = text.match(/(\d)[)．.]/);
    if (m2) return m2[1];
    return null;
  }
  assert('B5 强模式 "答案：B" → B', dsParseAnswer('经过分析，答案：B') === 'B');
  assert('B5 弱模式 孤立 "C" → C', dsParseAnswer('这道题应该选 C') === 'C');
  assert('B5 列举 "A. B. C. D." 不误采信', dsParseAnswer('选项有 A. B. C. D. 四种') === null);
  assert('B5 强模式 + 并列列举 "选项有 A、B、C、D，答案选 A" → A', dsParseAnswer('选项有 A、B、C、D，答案选 A') === 'A');
  assert('B5 强模式否定 "选项有 A、B、C、D 其中选 A 不对" → 不误采信', dsParseAnswer('选项有 A、B、C、D，其中选 A 不对') === null);
  assert('B5 强模式非否定 "选 A 正确" → A', dsParseAnswer('选项有 A、B、C、D，其中选 A 正确') === 'A');
  assert('B5 数字选项 "2)" → 2', dsParseAnswer('正确项是 2) 第二点') === '2');
  assert('B5 空回复 → null', dsParseAnswer('') === null);
}

console.log('\n==================== 元素模拟结论 ====================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
console.log('结论: PASS — 两份 dump 中代表真实站点结构的元素已全部模拟，现有选择器命中通过');
process.exit(0);
