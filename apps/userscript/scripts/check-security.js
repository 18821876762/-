// 安全静态扫描：常见危险/敏感模式（只读）
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'chaoxing-force-play');

const PATTERNS = [
  ['eval(', /eval\s*\(/],
  ['new Function', /new\s+Function\s*\(/],
  ['document.write', /document\.write\s*\(/],
  ['innerHTML 赋值', /\.innerHTML\s*=/],
  ['outerHTML 赋值', /\.outerHTML\s*=/],
  ['insertAdjacentHTML', /insertAdjacentHTML\s*\(/],
  ['setAttribute src/脚本', /setAttribute\(['"](?:src|href)['"][^)]*javascript:/i],
  ['GM 敏感键写入', /GM_setValue\(\s*['"]([^'"]*(?:secret|token|key|bank|pass)[^'"]*)['"]/i],
  ['明文密钥/口令字面量', /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{6,}['"]/i],
  ['http 明文接口', /['"]http:\/\/[^'"]+['"]/],
  ['localStorage 密码类', /localStorage\.(?:get|set)Item\(\s*['"][^'"]*(?:pass|secret|token)[^'"]*['"]/i],
];
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(SRC);

let total = 0;
for (const [name, re] of PATTERNS) {
  let hits = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      if (re.test(ln)) {
        hits++; total++;
        console.log(`[${name}] ${path.relative(SRC, f)}:${i + 1}: ${ln.trim().slice(0, 100)}`);
      }
    });
  }
  if (!hits) console.log(`[${name}] 0 hits`);
}
console.log(`\ntotal hits: ${total}`);
