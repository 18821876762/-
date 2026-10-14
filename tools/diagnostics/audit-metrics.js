const projectPaths = require('./project-paths.cjs');
// 代码指标分析器（常驻于 tools/diagnostics，非临时清理对象）
const fs = require("fs");
const path = require("path");

function walk(d, acc) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) {
      if (!["node_modules", ".git"].includes(f)) walk(p, acc);
    } else if (f.endsWith(".js")) {
      acc.push(p);
    }
  }
}

const ROOT = process.argv[2] || projectPaths.sourceRoot;
const files = [];
walk(ROOT, files);

let totalLines = 0;
let totalFuncs = 0;
const bigFiles = [];
const fnRe = /\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g;
const arrowRe = /=>\s*\{/g;

for (const f of files) {
  const c = fs.readFileSync(f, "utf8");
  const lines = c.split("\n").length;
  totalLines += lines;
  let m, fc = 0;
  while ((m = fnRe.exec(c))) fc++;
  while ((m = arrowRe.exec(c))) fc++;
  totalFuncs += fc;
  if (lines > 800) bigFiles.push({ f: path.relative(ROOT, f), lines });
}

console.log("scan root:", ROOT);
console.log("js files:", files.length);
console.log("total lines:", totalLines);
console.log("total function-ish decls (function/arrow):", totalFuncs);
bigFiles.sort((a, b) => b.lines - a.lines);
console.log("files > 800 lines:", bigFiles.length);
for (const b of bigFiles.slice(0, 20)) console.log("  ", b.lines, b.f);

// product metrics
const prod = projectPaths.bundle;
if (fs.existsSync(prod)) {
  const pc = fs.readFileSync(prod, "utf8");
  console.log("product bytes:", pc.length);
  console.log("product lines:", pc.split("\n").length);
}
