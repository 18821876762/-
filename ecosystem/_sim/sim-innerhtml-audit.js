// 审查整改 #2「面板 innerHTML→DOM」聚焦回归（单测级）：
// 1) toolkit.h 正确构建 DOM（tag / class / style对象 / 事件 / 文本子节点 / 元素子节点）。
// 2) toolkit.setSafeText 文本化：写入含 <img onerror> 的恶意串后，元素内无注入的 DOM 节点（XSS 免疫）。
// 3) 注入审计：对动态元素用 setSafeText 写入恶意串，断言无 <img>/<script> 子节点且 textContent 保留原串。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://mooc1.chaoxing.com/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e; }

let P = 0, F = 0;
function assert(name, cond, extra) {
  if (cond) { P++; console.log('  ✓ ' + name); }
  else { F++; console.log('  ✗ ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));

try {
  const tk = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit;
  assert('toolkit.h 已暴露', !!(tk && typeof tk.h === 'function'));
  assert('toolkit.setSafeText 已暴露', !!(tk && typeof tk.setSafeText === 'function'));
  if (!tk || !tk.h) throw new Error('h 未暴露，无法继续');

  // ===== 1) h() 构建正确性 =====
  const el = tk.h('div', { class: 'cx-card', style: { color: 'red', margin: '4px' }, title: 'hello' }, [
    '前缀',
    tk.h('b', null, '加粗'),
    '后缀',
  ]);
  assert('h 生成正确标签', el.tagName === 'DIV', el.tagName);
  assert('h class 属性生效', el.className === 'cx-card', el.className);
  assert('h style 对象生效', el.style.color === 'red' && el.style.margin === '4px', el.style.cssText);
  assert('h title 属性生效', el.getAttribute('title') === 'hello');
  assert('h 文本+元素子节点拼接正确', el.textContent === '前缀加粗后缀', el.textContent);
  assert('h 元素子节点数量正确', el.children.length === 1 && el.children[0].tagName === 'B');

  // onXxx 事件绑定
  let clicked = false;
  const btn = tk.h('button', { onclick: function () { clicked = true; } }, '点我');
  btn.dispatchEvent(new window.Event('click'));
  assert('h onXxx 绑定可触发', clicked === true);

  // ===== 2) setSafeText 文本化（XSS 免疫）=====
  const t = window.document.createElement('div');
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)<\/script>';
  tk.setSafeText(t, payload);
  assert('setSafeText 写入后 textContent 保留原串', t.textContent === payload, t.textContent);
  assert('setSafeText 不创建任何子元素（纯文本）', t.children.length === 0, t.children.length);
  assert('setSafeText 注入的 <img> 不存在', t.querySelector('img') === null);
  assert('setSafeText 注入的 <script> 不存在', t.querySelector('script') === null);

  // null/undefined 清空
  tk.setSafeText(t, null);
  assert('setSafeText(null) 清空', t.textContent === '', t.textContent);

  // ===== 3) 注入审计：动态元素回填恶意串应被文本化 =====
  const dyn = window.document.createElement('div');
  const evil = '<img src=x onerror=alert(1)>';
  tk.setSafeText(dyn, '状态：' + evil);
  assert('动态回填：含恶意串被当作文本', dyn.querySelector('img') === null && dyn.textContent.indexOf('<img') >= 0, dyn.textContent);

  console.log('\n[sim-innerhtml-audit] PASS=' + P + ' FAIL=' + F + (errors.length ? (' windowErrors=' + errors.length) : ''));
  if (F > 0 || errors.length > 0 || loadErr) {
    console.log('loadErr=' + (loadErr && loadErr.stack));
    errors.slice(0, 3).forEach((e) => console.log('  ' + e));
    process.exit(1);
  }
  process.exit(0);
} catch (e) {
  console.log('[sim-innerhtml-audit] 异常: ' + (e && e.stack || e));
  process.exit(1);
}
