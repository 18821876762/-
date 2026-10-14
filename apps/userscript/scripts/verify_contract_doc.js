#!/usr/bin/env node
/**
 * verify_contract_doc.js —— 跨文件契约总表（docs/CONTRACT.md）防漂移门禁
 *
 * 背景：verify_contracts.js 只校验「读点必须有挂载点」，无法回答
 *       "这个符号由谁挂载、被谁消费、真值语义是什么" —— 审计中 R1/R4 类
 *       （多帧共享 DOM 的 owner 语义）与 R3（卸载还原清单）反复复发，
 *       根因即缺少一份可校验的跨文件契约总表。
 *
 * 做法：扫描 src 下全部 .js，提取「命名空间挂载符号 → 挂载文件 → 跨文件消费方」，
 *       生成确定性表格，与 docs/CONTRACT.md 中的自动区块逐字比对。
 *         - 默认模式：比对，不一致退出 1（提示重新生成）
 *         - --emit  ：把最新表格写回自动区块
 *
 * 自动区块以下列标记包裹（手写章节不受影响）：
 *   <!-- AUTO:MOUNTS:BEGIN --> … <!-- AUTO:MOUNTS:END -->
 *
 * 退出码：0 = 一致；1 = 漂移；2 = 环境/参数错误。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'chaoxing-force-play');
const DOC = path.join(require('./project-paths.cjs').projectRoot, 'docs', 'CONTRACT.md');
const BEGIN = '<!-- AUTO:MOUNTS:BEGIN -->';
const END = '<!-- AUTO:MOUNTS:END -->';

if (!fs.existsSync(SRC)) {
  console.error('CONTRACT-DOC: src dir not found: ' + SRC);
  process.exit(2);
}

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(SRC, f).split('\\').join('/');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const aliasRe = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*(?:window\.)?__CX_FORCE_PLAY(?!\.)\s*(?=[;,)\n])/g;

const mounts = new Map();    // prop -> Set(挂载文件)
const consumers = new Map(); // prop -> Set(读取文件)

function addLiteralKeys(block, file) {
  const keyRe = /([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = keyRe.exec(block))) {
    if (!mounts.has(m[1])) mounts.set(m[1], new Set());
    mounts.get(m[1]).add(file);
  }
}

for (const f of walk(SRC)) {
  const t = fs.readFileSync(f, 'utf8');
  const file = rel(f);

  const fileAliases = new Set();
  let am2;
  aliasRe.lastIndex = 0;
  while ((am2 = aliasRe.exec(t))) fileAliases.add(am2[1]);

  const rootAlt = ['__CX_FORCE_PLAY', 'toolkit', ...fileAliases].map(esc).join('|');
  const mountRe = new RegExp('(?<!\\w)(?:window\\.)?(?:' + rootAlt + ')\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)', 'g');
  const readRe = new RegExp('(?<!\\w)(?:window\\.)?(?:' + rootAlt + ')\\.([A-Za-z_$][\\w$]*)', 'g');

  let am;
  while ((am = mountRe.exec(t))) {
    const prop = am[1];
    if (!mounts.has(prop)) mounts.set(prop, new Set());
    mounts.get(prop).add(file);
    const after = t.slice(am.index + am[0].length);
    if (/^\s*\{/.test(after)) {
      const i = after.indexOf('{');
      let depth = 0, end = -1;
      for (let j = i; j < after.length; j++) {
        const ch = after[j];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end > i) addLiteralKeys(after.slice(i, end + 1), file);
    }
  }

  let rm;
  while ((rm = readRe.exec(t))) {
    const prop = rm[1];
    const tail = t.slice(rm.index + rm[0].length);
    if (/^\s*=([^=])/.test(tail)) continue;
    if (!consumers.has(prop)) consumers.set(prop, new Set());
    consumers.get(prop).add(file);
  }
}

const props = [...mounts.keys()].sort();
const lines = [];
lines.push(BEGIN);
lines.push('');
lines.push('> 本区块由 `apps/userscript/scripts/verify_contract_doc.js` 自动生成，请勿手改；');
lines.push('> 新增/删除挂载点后运行 `npm run contract:doc` 重新生成，构建门禁 ⑤ 会校验一致性。');
lines.push('');
lines.push('| 符号（`window.__CX_FORCE_PLAY.<符号>` / `toolkit.<符号>`） | 挂载文件 | 跨文件消费方 |');
lines.push('|---|---|---|');
for (const p of props) {
  const mf = [...mounts.get(p)].sort();
  const cf = [...(consumers.get(p) || new Set())].filter((f) => !mounts.get(p).has(f)).sort();
  const cText = cf.length ? (cf.length > 3 ? cf.slice(0, 3).join('<br>') + '<br>…(+' + (cf.length - 3) + ')' : cf.join('<br>')) : '—（仅挂载侧使用）';
  lines.push('| `' + p + '` | ' + mf.join('<br>') + ' | ' + cText + ' |');
}
lines.push('');
lines.push('合计：**' + props.length + '** 个挂载符号。');
lines.push('');
lines.push(END);
const block = lines.join('\n');

const emit = process.argv.includes('--emit');

if (!fs.existsSync(DOC)) {
  if (!emit) {
    console.log('CONTRACT-DOC: FAILED — 契约总表缺失：' + DOC);
    console.log('CONTRACT-DOC: 修复方式——运行 `npm run contract:doc` 生成。');
    process.exit(1);
  }
  fs.writeFileSync(DOC, '# 跨文件契约总表\n\n' + block + '\n', 'utf8');
  console.log('CONTRACT-DOC: created ' + DOC);
  process.exit(0);
}

const doc = fs.readFileSync(DOC, 'utf8');
const bi = doc.indexOf(BEGIN);
const ei = doc.indexOf(END);
if (bi < 0 || ei < 0 || ei < bi) {
  console.log('CONTRACT-DOC: FAILED — docs/CONTRACT.md 缺少自动区块标记 ' + BEGIN + ' / ' + END);
  process.exit(1);
}
const current = doc.slice(bi, ei + END.length);

if (current === block) {
  console.log('CONTRACT-DOC: OK — 契约总表与源码一致（' + props.length + ' 个挂载符号）');
  process.exit(0);
}

if (emit) {
  fs.writeFileSync(DOC, doc.slice(0, bi) + block + doc.slice(ei + END.length), 'utf8');
  console.log('CONTRACT-DOC: regenerated（' + props.length + ' 个挂载符号）');
  process.exit(0);
}

// 漂移明细：只列符号级差异，避免刷屏
const curProps = new Set([...current.matchAll(/^\| `([A-Za-z_$][\w$]*)` \|/gm)].map((m) => m[1]));
const added = props.filter((p) => !curProps.has(p));
const removed = [...curProps].filter((p) => !mounts.has(p));
console.log('CONTRACT-DOC: FAILED — 契约总表已漂移（源码与 docs/CONTRACT.md 不一致）');
if (added.length) console.log('  新增未登记符号: ' + added.join(', '));
if (removed.length) console.log('  已删除仍登记符号: ' + removed.join(', '));
if (!added.length && !removed.length) console.log('  符号集合相同，但挂载/消费方归属已变化');
console.log('CONTRACT-DOC: 修复方式——运行 `npm run contract:doc` 重新生成后提交。');
process.exit(1);
