'use strict';
/*
 * 回归：修复② 伪暂停阈值 0.01 散落 6 处 → 收敛为 CONST.PSEUDO_PAUSE_RATE
 * 校验：① 常量定义存在(=0.01)；② CONST.PSEUDO_PAUSE_RATE 恰好 5 处引用(config.js×2 + dom.js×3)。
 *   注：原为 6 处(config×3)，v4.19.51 将「礼貌/字面量」两版 rate 变体合并为一个后，config 侧减少 1 处 → 5。
 * 说明：esbuild 可把 0.01 打印为 .01，常量断言接受这两种等值写法；
 *       核心守卫=引用计数：任一代码位被回退为裸 0.01 → 计数降为 4 → 本测试失败。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PRODUCT = require('../scripts/project-paths.cjs').personalProduct;
if (!fs.existsSync(PRODUCT)) { console.error('FAIL: 产物不存在', PRODUCT); process.exit(1); }
const code = fs.readFileSync(PRODUCT, 'utf8');

// 仅做加载健全性检查（避免产物本身语法/运行期崩坏）
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://example.com/' });
const win = dom.window;
if (typeof win.GM_setValue !== 'function') win.GM_setValue = function () {};
if (typeof win.GM_getValue !== 'function') win.GM_getValue = function (k, d) { return d; };
try { win.eval(code); } catch (e) { console.error('FAIL: 产物 eval 抛错', e && e.message); process.exit(1); }

let ok = true;
function assert(c, m) { if (!c) { console.error('FAIL:', m); ok = false; } }

assert(/PSEUDO_PAUSE_RATE:\s*(?:0?\.01)(?![\d.eE])/.test(code), 'CONST.PSEUDO_PAUSE_RATE 常量定义(=0.01)缺失');
const refCount = (code.match(/CONST\.PSEUDO_PAUSE_RATE/g) || []).length;
assert(refCount === 5, 'CONST.PSEUDO_PAUSE_RATE 引用应为 5 处(config×2+dom×3)，实为 ' + refCount + '（存在裸字面量回归或变体被重复拆分）');

console.log(ok ? 'PASS sim-pseudo-pause-rate (修复②)' : 'FAIL sim-pseudo-pause-rate (修复②)');
process.exit(ok ? 0 : 1);
