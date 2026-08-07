// 评审#1「swallow 遥测」聚焦回归：
// 1) toolkit.swallow(err) 把错误写入环形缓冲，且保留 stack（根因诊断）。
// 2) toolkit.recentErrors(n) / errorCount() 只读暴露遥测，供诊断/测试 inspect。
// 3) 非 Error 输入（字符串/无 stack 对象）不抛错、降级记录 msg。
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

// 收集所有运行时错误（应无——本测试只调用 swallow 路径）
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
  assert('toolkit 已暴露', !!tk, { hasToolkit: !!tk });

  const before = tk ? tk.errorCount() : 0;

  // 1) Error 输入 → 存 stack
  tk.swallow(new Error('boom-test'), 'sim1');
  const rec = tk.recentErrors(1);
  assert('recentErrors 返回 1 条', rec.length === 1, { len: rec.length });
  assert('记录含 msg', rec[0] && rec[0].msg === 'boom-test', rec[0]);
  assert('记录含 stack（评审#1 核心）', !!(rec[0] && rec[0].stack && /boom-test/.test(rec[0].stack)), rec[0] ? { stack: (rec[0].stack || '').slice(0, 60) } : null);
  assert('errorCount 递增', tk.errorCount() === before + 1, { before, after: tk.errorCount() });

  // 2) 多标签区分
  tk.swallow(new Error('second'), 'sim2');
  const recs = tk.recentErrors(2);
  assert('标签正确', recs.length === 2 && recs[1].tag === 'sim2' && recs[0].tag === 'sim1', recs.map(r => r.tag));

  // 3) 非 Error 降级（字符串 / 无 stack 对象）不崩
  tk.swallow('plain-string', 'sim3');
  const r3 = tk.recentErrors(2).filter(function (x) { return x.tag === 'sim3'; })[0];
  assert('字符串输入降级为 msg（不崩）', r3 && r3.msg === 'plain-string', r3);
  tk.swallow({ foo: 'bar' }, 'sim4');
  const last = tk.recentErrors(1);
  assert('非 Error 输入无 stack 字段（安全降级）', !('stack' in (last[0])), last[0]);

  // 4) 环形缓冲上限不崩（写入超过 50 条仍正常）
  for (let i = 0; i < 60; i++) tk.swallow(new Error('flood-' + i), 'flood');
  assert('高压写入后 recentErrors 仍可用', Array.isArray(tk.recentErrors(3)), { len: tk.recentErrors(3).length });

} catch (e) {
  F++;
  console.log('  ✗ 测试执行异常: ' + (e && e.stack ? e.stack : e));
}

assert('加载 user.js 无致命错误', !loadErr, loadErr ? String(loadErr) : null);
assert('运行无 window.error', errors.length === 0, { errors });

console.log('\nPASS=' + P + ' FAIL=' + F);
if (F > 0) { console.log('结论: FAIL — swallow 遥测回归未通过'); process.exit(1); }
console.log('结论: PASS — swallow 存 stack 且遥测只读暴露（评审#1 落地）');
process.exit(0);
