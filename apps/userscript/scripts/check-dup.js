// 跨模块重复代码检测（n-gram 指纹）——只读扫描，输出跨文件重复块
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'chaoxing-force-play');
const N = 16;          // token 粒度（词法近似：按空白/符号切分）
const MIN_HITS = 3;    // 同一指纹至少出现在 N 个不同文件中才算可疑
function tokens(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    .split(/[^\w$]+/).filter((t) => t.length > 2);
}
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(SRC);
const grams = new Map();   // gram -> [{file, count}]
for (const f of files) {
  const toks = tokens(fs.readFileSync(f, 'utf8'));
  const seen = new Set();
  for (let i = 0; i + N <= toks.length; i++) {
    const g = toks.slice(i, i + N).join('.');
    if (seen.has(g)) continue;   // 文件内自重复不计
    seen.add(g);
    if (!grams.has(g)) grams.set(g, []);
    grams.get(g).push({ file: path.relative(SRC, f), count: 1 });
  }
}
let suspicious = 0;
for (const [g, list] of grams) {
  const files2 = new Set(list.map((x) => x.file));
  if (files2.size >= MIN_HITS) {
    suspicious++;
    console.log('DUP x' + files2.size + ' [' + g.slice(0, 80) + '...]');
    for (const f of files2) console.log('   - ' + f);
  }
}
console.log('\nsuspicious cross-file duplicate grams: ' + suspicious + ' (N=' + N + ', min files=' + MIN_HITS + ')');