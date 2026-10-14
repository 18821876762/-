'use strict';
// 临时深度检查：列出「挂载但从未被任何读点引用」的命名空间符号（孤儿挂载/死 API 候选）。
// 排除已知公开 API（面板/诊断/外部契约/事件驱动入口），仅报告可疑死代码。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src', 'chaoxing-force-play');

function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walk(ROOT);

const mounts = new Map(); // sym -> [{file,line}]
const reads = new Set();
const aliasByFile = {};

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const lines = t.split('\n');
  // 本文件别名
  const aliases = new Set();
  const aRe = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*(?:window\.)?__CX_FORCE_PLAY(?![\w$])\s*(?=[;,)\n])/g;
  let m;
  while ((m = aRe.exec(t))) aliases.add(m[1]);
  aliasByFile[f] = aliases;

  const roots = ['(?:window\\.)?__CX_FORCE_PLAY', ...[...aliases].map(a => '(?:window\\.)?' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
  const rootRe = new RegExp('(?:' + roots.join('|') + ')\\.([A-Za-z_$][\\w$]*)', 'g');
  while ((m = rootRe.exec(t))) {
    const sym = m[1];
    const ln = t.slice(0, m.index).split('\n').length;
    reads.add(sym);
  }

  // 挂载检测：__CX_FORCE_PLAY.X =  (含箭头函数等)
  const mRe = /(?:window\.)?__CX_FORCE_PLAY\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = mRe.exec(t))) {
    const sym = m[1];
    const ln = t.slice(0, m.index).split('\n').length;
    if (!mounts.has(sym)) mounts.set(sym, []);
    mounts.get(sym).push(path.relative(ROOT, f) + ':' + ln);
  }
}

// 孤儿 = 已挂载但从未被读
const orphans = [];
for (const [sym, locs] of mounts) {
  if (!reads.has(sym)) orphans.push({ sym, locs });
}
orphans.sort((a, b) => a.sym.localeCompare(b.sym));

console.log('=== ORPHAN MOUNTS (挂载但从未被读) ===');
console.log('total mounts=' + mounts.size + '  readSymbols=' + reads.size + '  orphans=' + orphans.length);
orphans.forEach(o => console.log('  ' + o.sym + '  <-  ' + o.locs.join(', ')));
