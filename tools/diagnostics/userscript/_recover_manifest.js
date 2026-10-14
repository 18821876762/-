// 历史恢复算法：按域顺序生成候选清单，须人工比较后采用。
// 背景：该清单是构建拼接的「单一事实源」（缺失即 throw），此前被误当作临时文件删除。
// 因未被 git 跟踪、且当前产物为旧构建（多数文件从未进过产物），无法从产物反推顺序，
// 故按 build-force-play.ps1 头部约定域顺序重建（takeover→sites→plugins→presentation，
// takeover 内 foundation→engine→dom→bootstrap，bootstrap(main-loop) 置于末尾）。
const fs = require('fs');
const path = require('path');
const projectPaths = require('../project-paths.cjs');
if (!process.argv[2] || !process.argv[3]) {
  console.error('用法：node tools/diagnostics/userscript/_recover_manifest.js <源模块目录> <候选清单输出文件>');
  process.exit(2);
}
const srcDir = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
if (output.toLowerCase() === path.join(projectPaths.userscriptRoot, 'build-manifest.txt').toLowerCase()) {
  throw new Error('历史恢复算法只能生成候选清单，不能覆盖现行构建清单');
}

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.js')) acc.push(p);
  }
}
const all = [];
walk(srcDir, all);
const skip = new Set([
  path.join(srcDir, 'takeover/meta.js'),
  path.join(srcDir, 'takeover/bootstrap/core.js'),
]);
const domain = all.filter(f => !skip.has(f)).map(f => path.relative(srcDir, f).replace(/\\/g, '/'));

function groupOf(rel) {
  if (rel.startsWith('takeover/')) return 0;
  if (rel.startsWith('sites/')) return 1;
  if (rel.startsWith('plugins/')) return 2;
  if (rel.startsWith('presentation/')) return 3;
  return 9;
}
function subOf(rel) {
  if (rel.startsWith('takeover/foundation/')) return 0;
  if (rel.startsWith('takeover/engine/')) return 1;
  if (rel.startsWith('takeover/dom/')) return 2;
  if (rel.startsWith('takeover/bootstrap/')) return 3;
  if (rel.startsWith('plugins/addons/')) return 0;
  return 1; // plugins 根(registry.js) / presentation 根
}
domain.sort((a, b) => {
  const ga = groupOf(a), gb = groupOf(b);
  if (ga !== gb) return ga - gb;
  const sa = subOf(a), sb = subOf(b);
  if (sa !== sb) return sa - sb;
  return a < b ? -1 : a > b ? 1 : 0;
});

fs.writeFileSync(projectPaths.writableFile(output), domain.join('\n') + '\n', 'utf8');
console.log('candidate manifest: ' + output + ' with ' + domain.length + ' entries:');
for (const d of domain) console.log('  ' + d);
