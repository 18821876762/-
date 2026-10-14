const projectPaths = require('./project-paths.cjs');
// XSS 风险聚焦分析：扫描 innerHTML / outerHTML / insertAdjacentHTML / document.write
// 判定右值是否直接拼接了来自页面的数据（未显式 escapeHTML / textContent）。
const fs = require("fs");
const path = require("path");

function walk(d, acc) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) { if (!["node_modules", ".git"].includes(f)) walk(p, acc); }
    else if (f.endsWith(".js")) acc.push(p);
  }
}
const files = [];
const ROOT = projectPaths.sourceRoot;
walk(ROOT, files);

const sinkRe = /(innerHTML|outerHTML|insertAdjacentHTML|document\.write)\s*(\+=|=)/g;
let total = 0;
const findings = [];
for (const f of files) {
  const c = fs.readFileSync(f, "utf8");
  const lines = c.split("\n");
  let m;
  while ((m = sinkRe.exec(c))) {
    const idx = m.index;
    const lineNo = c.slice(0, idx).split("\n").length;
    // 取该行及后几行作为上下文
    const ctx = lines.slice(Math.max(0, lineNo - 1), lineNo + 2).join(" | ");
    const rhs = ctx;
    const usesEscape = /escapeHTML|textContent|createTextNode|createElement|\.text\s*=/.test(ctx);
    const hasVar = /\$\{|\+ [a-zA-Z_$]|[a-zA-Z_$][A-Za-z0-9_$]* \+/.test(ctx);
    findings.push({ f: path.relative(ROOT, f), line: lineNo, hasVar, usesEscape, ctx: rhs.slice(0, 180) });
    total++;
  }
}
console.log("total sink assignments:", total);
const risky = findings.filter(x => x.hasVar && !x.usesEscape);
console.log("potentially risky (has var, no escape nearby):", risky.length);
for (const r of risky) {
  console.log("  RISK", r.f, "L" + r.line, "::", r.ctx);
}
console.log("--- all sinks (file:line) ---");
for (const x of findings) console.log("  ", x.f, "L" + x.line, x.usesEscape ? "[esc]" : "[var?]");
