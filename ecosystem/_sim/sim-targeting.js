// 评审PR1「targeting 模块化+单测」聚焦回归：
// 1) keyRe：正则边界语义——key '123' 不匹配 '12345'（避免子串误命中），特殊字符转义（a.b ≠ aXb）。
// 2) collectAttachmentIds：不同 key 名(objectid/mid/id/objectId/object_id) + childList/attachments 递归 + 顶层直接附件数组；空/none 返回 null。
// 通过 window.__CX_FORCE_PLAY.toolkit 暴露的纯函数 inspect（评审#1 同款可观测性）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));

let P = 0, F = 0;
function assert(name, cond, extra) {
  if (cond) { P++; console.log('  ✓ ' + name); }
  else { F++; console.log('  ✗ ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e; }

try {
  const tk = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit;
  assert('toolkit 已暴露', !!tk);
  assert('keyRe 可访问', !!(tk && typeof tk.keyRe === 'function'));
  assert('collectAttachmentIds 可访问', !!(tk && typeof tk.collectAttachmentIds === 'function'));

  // ===== keyRe 边界 + 转义 =====
  const re123 = tk.keyRe('123');
  assert('keyRe "123" 不匹配 "12345"（子串隔离）', !re123.test('12345'));
  assert('keyRe "123" 匹配完整 "123"', re123.test('123'));
  assert('keyRe "123" 不匹配 alnum 包裹 "x123y"', !re123.test('x123y'));
  assert('keyRe "123" 匹配非 alnum 包裹 "/123/"', re123.test('/123/'));
  assert('keyRe "123" 匹配 "?123?"', re123.test('?123?'));
  assert('keyRe "123" 匹配 "a 123 b"（空格边界）', re123.test('a 123 b'));

  const reDot = tk.keyRe('a.b');
  assert('keyRe "a.b" 转义后匹配 "a.b"', reDot.test('a.b'));
  assert('keyRe "a.b" 不匹配 "aXb"', !reDot.test('aXb'));
  assert('keyRe "a.b" 不匹配 "aab"', !reDot.test('aab'));

  const reStar = tk.keyRe('col*');
  assert('keyRe 特殊字符 * 被转义（不报错）', typeof reStar.test === 'function');

  // 缓存一致性：同 key 返回同一 RegExp 实例
  assert('keyRe 缓存命中返回同实例', tk.keyRe('123') === re123);

  // ===== collectAttachmentIds =====
  const r1 = tk.collectAttachmentIds([{ property: { objectid: '100' } }]);
  assert('objectid 提取', r1 && r1.ids && r1.ids['100'] === true, r1);

  const r2 = tk.collectAttachmentIds([{ property: { mid: 'abc123' } }]);
  assert('mid 提取', r2 && r2.ids['abc123'] === true, r2);

  const r3 = tk.collectAttachmentIds([{ property: { objectId: 'X' } }]);
  assert('objectId(驼峰) 提取', r3 && r3.ids['X'] === true, r3);

  const r4 = tk.collectAttachmentIds([{ property: { object_id: 'Y' } }]);
  assert('object_id 下划线 提取', r4 && r4.ids['Y'] === true, r4);

  const r5 = tk.collectAttachmentIds([{ property: { id: 55 } }]);   // 数值 id → 转字符串
  assert('id(数值) 提取并转字符串', r5 && r5.ids['55'] === true, r5);

  const r6 = tk.collectAttachmentIds([{ property: { childList: [{ objectid: '9' }, { mid: 'm9' }] } }]);
  assert('childList 递归：objectid', r6 && r6.ids['9'] === true, r6);
  assert('childList 递归：mid', r6 && r6.ids['m9'] === true, r6);

  const r7 = tk.collectAttachmentIds([{ property: { attachments: [{ objectid: 'A' }, { objectId: 'B' }] } }]);
  assert('attachments 递归：objectid', r7 && r7.ids['A'] === true, r7);
  assert('attachments 递归：objectId', r7 && r7.ids['B'] === true, r7);

  const r8 = tk.collectAttachmentIds([{ objectid: 'Z' }]);   // 顶层直接是附件（无 property 包裹）
  assert('顶层直接附件数组提取', r8 && r8.ids['Z'] === true, r8);

  const r9 = tk.collectAttachmentIds([{ property: { objectid: '1' } }, { property: { mid: '2' } }]);
  assert('多附件并集', r9 && r9.ids['1'] === true && r9.ids['2'] === true, r9);

  assert('空数组返回 null', tk.collectAttachmentIds([]) === null);
  assert('null 返回 null', tk.collectAttachmentIds(null) === null);
  assert('非数组返回 null', tk.collectAttachmentIds('nope') === null);

} catch (e) {
  F++;
  console.log('  ✗ 测试执行异常: ' + (e && e.stack ? e.stack : e));
}

assert('加载 user.js 无致命错误', !loadErr, loadErr ? String(loadErr) : null);
assert('运行无 window.error', errors.length === 0, { errors });

console.log('\nPASS=' + P + ' FAIL=' + F);
if (F > 0) { console.log('结论: FAIL — targeting 单测未通过'); process.exit(1); }
console.log('结论: PASS — keyRe 边界+转义 / collectAttachmentIds 多 key+递归 全部通过（评审PR1 落地）');
process.exit(0);
