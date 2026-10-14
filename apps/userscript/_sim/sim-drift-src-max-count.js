'use strict';
/*
 * 回归：修复④ _srcMaxCount 换源删除不递减 → 计数失真、提前触发 5000 上限淘汰
 * 校验：① 换源删除前先 hasOwnProperty 判断再 _srcMaxCount--（修复核心）；
 *       ② 计数自洽：-- 与 ++ 各 2 处（递增在键新增、递减在换源与淘汰）。
 * 注：产物保留加载健全性检查；结构断言读取完整 DOM 源组，避免 esbuild
 *     把参数改名、if 改为 && 表达式后将格式变化误判为逻辑回归。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PRODUCT = require('../scripts/project-paths.cjs').personalProduct;
if (!fs.existsSync(PRODUCT)) { console.error('FAIL: 产物不存在', PRODUCT); process.exit(1); }
const code = fs.readFileSync(PRODUCT, 'utf8');
const source = require('../scripts/source-groups.cjs').readSource(
  path.join(__dirname, '../src/chaoxing-force-play'), 'takeover/dom/dom.js');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://example.com/' });
const win = dom.window;
if (typeof win.GM_setValue !== 'function') win.GM_setValue = function () {};
if (typeof win.GM_getValue !== 'function') win.GM_getValue = function (k, d) { return d; };
try { win.eval(code); } catch (e) { console.error('FAIL: 产物 eval 抛错', e && e.message); process.exit(1); }

let ok = true;
function assert(c, m) { if (!c) { console.error('FAIL:', m); ok = false; } }

// 修复④核心：换源删除前递减
assert(/hasOwnProperty\.call\(_srcMaxTime,\s*cxState\(v\)\.driftSrc\)\)\s*_srcMaxCount--/.test(source),
  '换源删除未先 _srcMaxCount--（修复④ 核心回归：delete 前必须递减）');
assert(/_srcMaxCount\s*=\s*0/.test(source), '_srcMaxCount 初始计数定义缺失');
const dec = (source.match(/_srcMaxCount--/g) || []).length;
const inc = (source.match(/_srcMaxCount\+\+/g) || []).length;
assert(dec === 2, '_srcMaxCount-- 应为 2 处(换源+淘汰)，实为 ' + dec);
assert(inc === 2, '_srcMaxCount++ 应为 2 处(键新增)，实为 ' + inc);

console.log(ok ? 'PASS sim-drift-src-max-count (修复④)' : 'FAIL sim-drift-src-max-count (修复④)');
process.exit(ok ? 0 : 1);
