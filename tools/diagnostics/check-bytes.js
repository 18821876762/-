const projectPaths = require('./project-paths.cjs');
// 检查构建产物与各源文件字节0是否含 BOM / 非常规空白（真机元数据识别杀手）
const fs = require('fs');
const path = require('path');
const base = projectPaths.userscriptRoot;
function chk(p) {
  try {
    const b = fs.readFileSync(p);
    const bom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
    let irreg = 0; const labels = [];
    for (let i = 0; i < Math.min(b.length, 400); i++) {
      const c = b[i];
      if (c === 0xC2 || c === 0xA0) { irreg++; if (labels.length < 8) labels.push('C2/A0@' + i); }
      if (c === 0xE2 && b[i+1] === 0x80 && (b[i+2] === 0x89||b[i+2]===0x88||b[i+2]===0x8B||b[i+2]===0x9C)) { irreg++; if (labels.length<8) labels.push('E2808x@'+i); }
      if (c === 0x00) { irreg++; if (labels.length<8) labels.push('NUL@'+i); }
    }
    console.log(path.basename(p), 'BOM=' + bom,
      'first=' + [...b.slice(0,6)].map(x=>'0x'+x.toString(16)).join(','),
      'irreg=' + irreg, labels.join(','));
  } catch (e) { console.log('ERR', p, e.message); }
}
console.log('=== 产物与 meta.js ===');
chk(projectPaths.bundle);
chk(base + '/src/chaoxing-force-play/takeover/meta.js');
console.log('=== 扫描 src 下所有 .js 前3字节含 BOM ===');
function walk(d) {
  let hit = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) hit = hit.concat(walk(fp));
    else if (e.name.endsWith('.js')) {
      const b = fs.readFileSync(fp);
      if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) hit.push(fp);
    }
  }
  return hit;
}
const hits = walk(base + '/src');
console.log(hits.length ? hits.map(x=>path.relative(base,x)).join('\n') : '(无 BOM 源文件)');
