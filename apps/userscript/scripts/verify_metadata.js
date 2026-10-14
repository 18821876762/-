#!/usr/bin/env node
/**
 * verify_metadata.js —— 用户脚本元数据块（==UserScript==）门禁
 *
 * 背景：代码审查 P0-1 / P0-2 两条致命项都出在元数据块，且现有门禁全都看不见：
 *   · P0-1「@match 行内注释」——UserScript 元数据块【没有行内注释语法】，
 *     `// @match *://*.pmphmooc.com/*   // 说明文字` 会被解析成含空格与中文的
 *     非法 pattern 并被 Tampermonkey 静默丢弃，导致整站不注入。
 *     而 _sim/* 用 jsdom 直接 eval 产物、根本不解析 @match，仿真门禁永远发现不了。
 *   · P0-2「@grant 与实际用法不一致」——ESLint 的 globals 声明会把 no-undef「消音」，
 *     但运行时未 grant 的 GM_* 不会被注入，真调用到就是 ReferenceError。
 *
 * 本脚本对【构建产物】做两类静态断言：
 *   A. 单 token 校验：@match/@include/@exclude/@connect/@grant/@require/@run-at
 *      的取值必须是不含空白的单一 token（行内注释、多余说明一律判失败）。
 *      注：元数据块内【整行】以 `// ` 开头且不带 @key 的说明行是允许的（解析器忽略）。
 *   B. @grant 双向差集：产物正文中【未被 typeof 守卫】的 GM_* 调用必须已 grant；
 *      已 grant 却完全未使用的仅告警（不阻断，允许为将来预留）。
 *
 * 退出码：0 = 通过；1 = 违规；2 = 环境错误。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 默认校验构建产物；可传入路径参数，便于对「变异副本」做规则非空转自检。
const PRODUCT = process.argv[2]
  ? path.resolve(process.argv[2])
  : require('./project-paths.cjs').personalProduct;

if (!fs.existsSync(PRODUCT)) {
  console.error('METADATA: product not found: ' + PRODUCT);
  process.exit(2);
}

const src = fs.readFileSync(PRODUCT, 'utf8');
const startIdx = src.indexOf('// ==UserScript==');
const endIdx = src.indexOf('// ==/UserScript==');
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error('METADATA: UserScript metadata block not found or malformed');
  process.exit(2);
}

const metaLines = src.slice(startIdx, endIdx).split(/\r?\n/);
const body = src.slice(endIdx);
const errors = [];
const warnings = [];

/* ── A. 单 token 校验（防 P0-1 行内注释复发）──
 * 只约束「取值本就应为单一 token」的键；@name/@description/@compatible/@resource
 * 等天然含空格的键不在此列，避免误伤。                                         */
const SINGLE_TOKEN_KEYS = new Set([
  'match', 'include', 'exclude', 'connect', 'grant', 'require', 'run-at', 'license', 'namespace', 'updateURL', 'downloadURL',
]);

metaLines.forEach((line, i) => {
  const m = /^\s*\/\/\s*@([\w-]+)\s+(.*)$/.exec(line);
  if (!m) return;                       // 非 @key 行（纯说明行）——解析器忽略，放行
  const key = m[1];
  const value = m[2].trim();
  if (!SINGLE_TOKEN_KEYS.has(key)) return;
  if (/\s/.test(value)) {
    errors.push(
      'meta line ' + (i + 1) + ': @' + key + ' 取值含空白，会被解析成非法值并静默丢弃 -> ' +
      JSON.stringify(value) + '（说明文字请另起一整行）'
    );
  }
});

/* ── B. @grant 双向差集（防 P0-2 复发）── */
const granted = new Set();
metaLines.forEach((line) => {
  const m = /^\s*\/\/\s*@grant\s+(\S+)\s*$/.exec(line);
  if (m) granted.add(m[1]);
});

const usedUnguarded = new Set();
const usedAny = new Set();
const GM_RE = /\b(?:GM_\w+|GM\.\w+)/g;
let g;
while ((g = GM_RE.exec(body)) !== null) {
  const name = g[0];
  usedAny.add(name);
  // Modern promise APIs still need an explicit manager permission when guarded.
  if (name.startsWith('GM.')) { usedUnguarded.add(name); continue; }
  // 守卫判定（两种都算「已守卫」，不要求 grant）：
  //   1) 紧邻前缀就是 `typeof `；
  //   2) 同一表达式内先做了 typeof 短路，如
  //      `typeof GM_info !== 'undefined' && GM_info.scriptHandler ? GM_info.x : 'n/a'`
  //      —— 后续引用没有 typeof 前缀但被短路保护，故以「所在行 + 前 200 字符窗口」
  //      内是否出现 `typeof <NAME>` 作为判据。
  const before = body.slice(Math.max(0, g.index - 16), g.index);
  if (/typeof\s+$/.test(before)) continue;

  const lineStart = body.lastIndexOf('\n', g.index) + 1;
  let lineEnd = body.indexOf('\n', g.index);
  if (lineEnd < 0) lineEnd = body.length;
  const window = body.slice(Math.max(lineStart, g.index - 200), g.index);
  const guardRe = new RegExp('typeof\\s+' + name + '\\b');
  if (guardRe.test(window)) continue;

  usedUnguarded.add(name);
}

for (const name of usedUnguarded) {
  if (!granted.has(name)) {
    errors.push(
      '未 grant 却在无 typeof 守卫下直接调用：' + name +
      '（Tampermonkey 下会抛 ReferenceError；请补 @grant 或加 typeof 守卫）'
    );
  }
}
for (const name of granted) {
  if (!usedAny.has(name)) warnings.push('已 @grant 但产物中未使用：' + name);
}

/* License notice lives outside the userscript metadata and minified domain body. */
const normalizeNotice = value => value.replace(/\r\n?/g, '\n').trim();
const license = normalizeNotice(fs.readFileSync(path.resolve(__dirname, '../../../LICENSE'), 'utf8'));
if (!metaLines.some(line => /^\s*\/\/\s*@license\s+MIT\s*$/.test(line))) errors.push('Metadata must declare @license MIT');
if (!normalizeNotice(body).includes('/*\n' + license + '\n*/')) errors.push('Full MIT copyright and permission notice missing from standalone product');

/* ── 输出 ── */
for (const w of warnings) console.log('METADATA WARN: ' + w);

if (errors.length) {
  console.error('METADATA: FAILED (' + errors.length + ')');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(
  'METADATA: OK (single-token keys checked, grants=' + granted.size +
  ', unguarded GM_* uses=' + usedUnguarded.size + ')'
);
process.exit(0);
