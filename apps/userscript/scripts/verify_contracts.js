#!/usr/bin/env node
/**
 * verify_contracts.js — 命名空间契约一致性回归门禁
 *
 * 目的：防止 D1–D4 类缺陷复发（跨文件“调用名 ↔ 挂载名”不一致）。
 *   D1：顶层重复定义 toast（应单点挂载 toolkit.toast）
 *   D2：addon 误读 window.__CX_FORCE_PLAY.toast（正确挂载点是 toolkit.toast）
 *   D3：video-ended-notify 引用已删除的 __cxBridge/bridgeReady
 *   D4：tamper-guard 直接读未防御的 currentSiteCfg
 *
 * 做法：逐文件扫描 apps/userscript/src/chaoxing-force-play/ 下全部 .js，对每个文件提取：
 *   挂载点：  window.__CX_FORCE_PLAY.X = … / .toolkit.X = … / <本文件内命名空间别名>.X = …
 *            （含对象字面量 {...} 内的 key）
 *   读点：    root.X 且其后不是赋值（即跨文件消费方引用）
 * 任何“读点 X 在全部源中找不到对应挂载点”即视为契约断裂。
 *
 * 别名按“文件”识别（var X = window.__CX_FORCE_PLAY 且后面紧跟 ; , ) 或换行），
 * 避免把其他文件里同名的本地变量（如 quiz.js 的 var ns = qEl.querySelectorAll）误判为命名空间根。
 * toolkit 根加词边界，避免 mytoolkit.x 子串误匹配。
 *
 * 退出码：0 = 契约一致；1 = 发现断裂；2 = 环境/参数错误。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src', 'chaoxing-force-play');
if (!fs.existsSync(ROOT)) {
  console.error('CONTRACT: src dir not found: ' + ROOT);
  process.exit(2);
}

// 已知合法但扫描器无法静态确认挂载点的属性（预留扩展点 / 动态数据字段）。
// 仅作为最后兜底；新增条目必须写明原因，避免掩盖真实断裂。
const ALLOW = new Set([
  // 预留扩展点：多端联动消息 API 尚未在 toolkit.bridge 暴露（见 video-ended-notify.js）
  'bridgeReady',
  '__cxBridge'
]);

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 逐文件别名：变量在该文件内被直接赋值为命名空间本身（可包一层括号、可选 .toolkit）。
// 严格约束：__CX_FORCE_PLAY 之后必须紧跟 ; , ) 或换行（不能是 .xxx 或其他表达式）。
const aliasRe = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*(?:window\.)?__CX_FORCE_PLAY(?!\.)\s*(?=[;,)\n])/g;

const assigned = new Set(); // 已挂载的 prop 名（跨文件汇总）
const reads = [];           // { prop, file, line }

function addLiteralKeys(block, set) {
  const keyRe = /([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = keyRe.exec(block))) set.add(m[1]);
}

function lineOf(text, idx) {
  return text.slice(0, idx).split('\n').length;
}

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');

  // 本文件命名空间别名
  const fileAliases = new Set();
  let am2;
  while ((am2 = aliasRe.exec(t))) fileAliases.add(am2[1]);

  // 根令牌：window.__CX_FORCE_PLAY、工具库 toolkit，以及本文件别名
  const rootToks = ['__CX_FORCE_PLAY', 'toolkit', ...fileAliases].map(esc);
  const rootAlt = rootToks.join('|');
  const mountRe = new RegExp('(?<!\\w)(?:window\\.)?(?:' + rootAlt + ')\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)(?!=)', 'g');
  const readRe = new RegExp('(?<!\\w)(?:window\\.)?(?:' + rootAlt + ')\\.([A-Za-z_$][\\w$]*)', 'g');

  // —— 挂载点（含对象字面量）——
  let am;
  while ((am = mountRe.exec(t))) {
    const prop = am[1];
    assigned.add(prop);
    const after = t.slice(am.index + am[0].length);
    if (/^\s*\{/.test(after)) {
      const i = after.indexOf('{');
      let depth = 0;
      let end = -1;
      for (let j = i; j < after.length; j++) {
        const ch = after[j];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end > i) addLiteralKeys(after.slice(i, end + 1), assigned);
    }
  }

  // —— 读点（后接非赋值）——
  let rm;
  while ((rm = readRe.exec(t))) {
    const prop = rm[1];
    const tail = t.slice(rm.index + rm[0].length);
    if (/^\s*=([^=])/.test(tail)) continue; // 跳过赋值 / 箭头函数
    reads.push({ prop, file: f, line: lineOf(t, rm.index) });
  }
}

// 去重读点用于报告
const seen = new Set();
const violations = [];
for (const r of reads) {
  if (assigned.has(r.prop) || ALLOW.has(r.prop)) continue;
  const key = r.file + ':' + r.line + ':' + r.prop;
  if (seen.has(key)) continue;
  seen.add(key);
  violations.push(r);
}

if (violations.length === 0) {
  console.log('CONTRACT: OK — 命名空间契约一致（挂载 ' + assigned.size +
    ' 个符号，校验 ' + reads.length + ' 处读点）');
  process.exit(0);
}

console.log('CONTRACT: FAILED — 发现 ' + violations.length + ' 处“读点无对应挂载点”的契约断裂：');
for (const v of violations) {
  const rel = path.relative(ROOT, v.file).split('\\').join('/');
  console.log('  - ' + rel + ':' + v.line + '  reads `' + v.prop + '` (no matching `.<' + v.prop + '> =` mount in source)');
}
console.log('CONTRACT: 修复方式——在该属性被消费前，于某模块用 __CX_FORCE_PLAY.<prop> = … 挂载，或确认其为预留扩展点后加入 ALLOW。');
process.exit(1);
