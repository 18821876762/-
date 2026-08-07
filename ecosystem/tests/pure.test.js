// 纯函数单测（零 src 改动、零运行时依赖）
// 策略：用 vm 沙箱加载各 src 模块片段。这些模块顶层仅含函数声明（无顶层执行语句），
// 其依赖（swallow / _cxPanel 等）只在被调用时才用到；我们只调用其中的纯函数，
// 因此以最小 stub 提供 ctx 即可安全加载并捕获函数声明到沙箱全局。
//
// 覆盖（来自 code review 的"为纯函数加测试"建议）：
//   - escapeHTML  (takeover/engine/foreground.js)  HTML 转义，防 XSS
//   - fmtTime     (presentation/dashboard.js)      秒 → m:ss / h:mm:ss
//   - signatureOf (takeover/engine/dedup.js)       收集视频/iframe 的可定位签名（id/name/title/data-*）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'chaoxing-force-play');
const FILES = {
  escapeHTML: path.join(SRC, 'takeover', 'engine', 'foreground.js'),
  fmtTime: path.join(SRC, 'presentation', 'dashboard.js'),
  signatureOf: path.join(SRC, 'takeover', 'engine', 'dedup.js'),
};

let failures = 0;
function assert(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.error('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

// 加载单个 src 模块到独立沙箱；stub 运行时依赖，使其顶层（函数声明）可安全求值
function load(file) {
  const ctx = { swallow: function () {}, console: console, module: undefined, window: {}, document: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx;
}

const fg = load(FILES.escapeHTML);
const dash = load(FILES.fmtTime);
const ded = load(FILES.signatureOf);

console.log('escapeHTML:');
const eh = fg.escapeHTML;
// 用无歧义输入：< > & "（四个特殊字符），避免单引号字符串里 \' 转义造成的构造歧义
const inp = '<a href="x">&';
assert('escapes < > & "', eh(inp) === '&lt;a href=&quot;x&quot;&gt;&amp;', eh(inp));
assert('escapes single quote', eh("a'b") === 'a&#39;b', eh("a'b"));
assert('null -> empty', eh(null) === '', 'got: ' + JSON.stringify(eh(null)));
assert('number passes through', eh(123) === '123', 'got: ' + JSON.stringify(eh(123)));
assert('undefined -> empty', eh(undefined) === '', 'got: ' + JSON.stringify(eh(undefined)));

console.log('fmtTime:');
const ft = dash.fmtTime;
assert('0 -> 0:00', ft(0) === '0:00', ft(0));
assert('65 -> 1:05', ft(65) === '1:05', ft(65));
assert('3661 -> 1:01:01', ft(3661) === '1:01:01', ft(3661));
assert('negative clamps to 0:00', ft(-5) === '0:00', ft(-5));
assert('NaN clamps to 0:00', ft(NaN) === '0:00', ft(NaN));
assert('3599 -> 59:59', ft(3599) === '59:59', ft(3599));

console.log('signatureOf:');
const sig = ded.signatureOf;
assert('collects id/name/title',
  JSON.stringify(sig({ id: 'i1', name: 'n1', title: 't1', getAttribute: function () { return null; }, attributes: [] })) ===
  JSON.stringify(['i1', 'n1', 't1']), 'collect id/name/title');
assert('collects data-* and data attr',
  JSON.stringify(sig({
    getAttribute: function (a) { return a === 'data' ? 'D' : null; },
    attributes: [{ name: 'data-x', value: 'vx' }, { name: 'class', value: 'c' }]
  })) === JSON.stringify(['D', 'vx']), 'data attrs');
assert('empty element -> []',
  JSON.stringify(sig({ getAttribute: function () { return null; }, attributes: [] })) === JSON.stringify([]), 'empty');

console.log('\n' + (failures === 0 ? 'ALL PASS (' + 14 + ' assertions)' : (failures + ' ASSERTION(S) FAILED')));
process.exit(failures === 0 ? 0 : 1);
