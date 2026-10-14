#!/usr/bin/env node
/**
 * selftest_metadata.js —— verify_metadata.js 的「变异自检」（防规则空转成假绿灯）
 *
 * 门禁最危险的失效方式不是报错，而是【规则写歪后永远返回通过】。
 * 本自检把产物复制到临时目录并注入已知违规（变异），要求门禁必须拦下：
 *   · baseline            未变异     -> 必须通过（exit 0），确保不误伤
 *   · mut-inline-comment  @match 行内注释（P0-1 原始形态） -> 必须失败（exit 1）
 *   · mut-drop-grant      删掉 @grant GM_setValue（P0-2）  -> 必须失败（exit 1）
 *   · mut-inline-grant    @grant 行内注释                   -> 必须失败（exit 1）
 *
 * 退出码：0 = 全部符合预期；1 = 有规则空转/误伤；2 = 环境错误。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'verify_metadata.js');
const PRODUCT = require('./project-paths.cjs').personalProduct;

if (!fs.existsSync(GATE) || !fs.existsSync(PRODUCT)) {
  console.error('METADATA-SELFTEST: gate or product not found');
  process.exit(2);
}

const src = fs.readFileSync(PRODUCT, 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metagate-'));

/** 对产物做一次替换，替换未命中则视为自检失效（产物结构已变，需同步更新本文件）。 */
function mutate(from, to) {
  if (src.indexOf(from) < 0) return null;
  return src.replace(from, to);
}

const cases = [
  { name: 'baseline', text: src, expect: 0 },
  { name: 'mut-drop-modern-grant', text: mutate('// @grant        GM.getValue\n', ''), expect: 1 },
  { name: 'mut-inline-modern-grant', text: mutate('// @grant        GM.setValue', '// @grant        GM.setValue   // inline note'), expect: 1 },
  { name: 'mut-drop-license-tag', text: mutate('// @license      MIT\n', ''), expect: 1 },
  { name: 'mut-drop-license-notice', text: mutate('Permission is hereby granted', 'Permission notice removed'), expect: 1 },
  {
    name: 'mut-inline-comment',
    text: mutate('// @match        *://*.pmphmooc.com/*',
      '// @match        *://*.pmphmooc.com/*   // inline note'),
    expect: 1,
  },
  {
    name: 'mut-drop-grant',
    text: mutate('// @grant        GM_setValue\n', ''),
    expect: 1,
  },
  {
    name: 'mut-inline-grant',
    text: mutate('// @grant        GM_addValueChangeListener',
      '// @grant        GM_addValueChangeListener   // inline note'),
    expect: 1,
  },
];

let failed = 0;
for (const c of cases) {
  if (c.text === null) {
    console.error('  - ' + c.name + ': 变异锚点未命中（产物结构变化，请同步更新自检）');
    failed++;
    continue;
  }
  const f = path.join(tmp, c.name + '.user.js');
  fs.writeFileSync(f, c.text, 'utf8');
  const r = spawnSync(process.execPath, [GATE, f], { encoding: 'utf8' });
  if (r.status !== c.expect) {
    console.error('  - ' + c.name + ': exit=' + r.status + ' expect=' + c.expect +
      ' :: ' + String(r.stdout || '').trim() + String(r.stderr || '').trim());
    failed++;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failed) {
  console.error('METADATA-SELFTEST: FAILED (' + failed + '/' + cases.length + ')');
  process.exit(1);
}
console.log('METADATA-SELFTEST: OK (' + cases.length + '/' + cases.length + ')');
process.exit(0);
