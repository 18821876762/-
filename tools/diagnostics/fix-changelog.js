const fs = require('fs');
const path = require('path');
const projectPaths = require('./project-paths.cjs');
if (!process.argv[2] || !process.argv[3]) {
  console.error('用法：node tools/diagnostics/fix-changelog.js <输入文件> <输出文件>');
  process.exit(2);
}
const p = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
if (p.toLowerCase() === output.toLowerCase()) throw new Error('输出必须与输入文件不同，以保留原始记录');
let s = fs.readFileSync(p, 'utf8');
const BS = String.fromCharCode(92);          // backslash
const literal = BS + 'n';                     // literal "\n" (two chars) used as row separator
const before = s;
s = s.split(literal).join('\n');             // turn literal \n into real newlines
console.log('sepFixed=', s !== before);
let lines = s.split('\n');
const i17 = lines.findIndex(l => l.indexOf('| v4.19.17 ') === 0);
const i16 = lines.findIndex(l => l.indexOf('| v4.19.16 ') === 0);
console.log('i17', i17, 'i16', i16);
if (i17 >= 0 && i16 >= 0 && i17 < i16) {      // want 4.19.16 before 4.19.17
  const t = lines[i17]; lines[i17] = lines[i16]; lines[i16] = t;
  s = lines.join('\n');
  console.log('swapped 4.19.16 <-> 4.19.17');
}
fs.writeFileSync(projectPaths.writableFile(output), s, 'utf8');
console.log('done:', output);
