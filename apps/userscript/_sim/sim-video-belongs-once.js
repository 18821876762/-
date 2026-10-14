'use strict';
/*
 * 回归：修复⑤ videoBelongsToTask 同 tick 重复上溯(matchedAny 与 _ovSkipNonTask 各算一次) → 复用一次计算
 * 校验：overrideVideo 内仅计算一次 var _belongs = TARGET.enabled ? videoBelongsToTask(v) : true;
 *       其后 matchedAny 与 _ovSkipNonTask(v, _belongs) 均复用 _belongs（不二次调用 videoBelongsToTask）。
 * 按 AST 识别缓存绑定和复用：压缩后局部变量会改名、true 会改写成 !0。
 * 产物中 videoBelongsToTask 应为定义 1 处 + dom.js overrideVideo 单次调用 1 处；
 * 若被回退为二次调用(dom.js 出现第 2 次调用)，计数变 3 → 本测试失败。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const espree = require('espree');

const PRODUCT = require('../scripts/project-paths.cjs').personalProduct;
if (!fs.existsSync(PRODUCT)) { console.error('FAIL: 产物不存在', PRODUCT); process.exit(1); }
const code = fs.readFileSync(PRODUCT, 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://example.com/' });
const win = dom.window;
if (typeof win.GM_setValue !== 'function') win.GM_setValue = function () {};
if (typeof win.GM_getValue !== 'function') win.GM_getValue = function (k, d) { return d; };
try { win.eval(code); } catch (e) { console.error('FAIL: 产物 eval 抛错', e && e.message); process.exit(1); }

let ok = true;
function assert(c, m) { if (!c) { console.error('FAIL:', m); ok = false; } }

function nodesOf(root) {
  const nodes = [];
  function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    nodes.push(node);
    Object.values(node).forEach(function (value) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    });
  }
  visit(root);
  return nodes;
}
function namedCall(node, name) { return node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name; }
function identifier(node, name) { return !!node && node.type === 'Identifier' && node.name === name; }
function targetMember(node, key) {
  return !!node && node.type === 'MemberExpression' && identifier(node.object, 'TARGET') &&
    (!node.computed ? identifier(node.property, key) : node.property.type === 'Literal' && node.property.value === key);
}
function booleanTrue(node) {
  return !!node && ((node.type === 'Literal' && node.value === true) ||
    (node.type === 'UnaryExpression' && node.operator === '!' && node.argument.type === 'Literal' && node.argument.value === 0));
}
const nodes = nodesOf(espree.parse(code, { ecmaVersion: 'latest', sourceType: 'script' }));
const overrides = nodes.filter((node) => node.type === 'FunctionDeclaration' && identifier(node.id, 'overrideVideo'));
const override = overrides.length === 1 ? overrides[0] : null;
const overrideNodes = override ? nodesOf(override.body) : [];
const videoParam = override && override.params[0] && override.params[0].name;
const caches = overrideNodes.filter((node) => {
  const init = node.type === 'VariableDeclarator' && node.init;
  return init && init.type === 'ConditionalExpression' && targetMember(init.test, 'enabled') &&
    namedCall(init.consequent, 'videoBelongsToTask') && init.consequent.arguments.length === 1 &&
    identifier(init.consequent.arguments[0], videoParam) && booleanTrue(init.alternate);
});
const cache = caches.length === 1 ? caches[0] : null;
const overrideCalls = overrideNodes.filter((node) => namedCall(node, 'videoBelongsToTask'));
assert(!!cache && overrideCalls.length === 1,
  'overrideVideo 未将 videoBelongsToTask(v) 收敛为单次计算 _belongs（修复⑤ 回归）');
const skipCalls = overrideNodes.filter((node) => namedCall(node, '_ovSkipNonTask'));
assert(!!cache && skipCalls.length === 1 && skipCalls[0].arguments.length === 2 &&
  identifier(skipCalls[0].arguments[0], videoParam) && identifier(skipCalls[0].arguments[1], cache.id.name),
  '_ovSkipNonTask 未复用 _belongs（仍可能二次上溯）');
const definitions = nodes.filter((node) => node.type === 'FunctionDeclaration' && identifier(node.id, 'videoBelongsToTask'));
const invocations = nodes.filter((node) => namedCall(node, 'videoBelongsToTask'));
const calls = definitions.length + invocations.length;
assert(calls === 2, 'videoBelongsToTask( 应仅 2 处(targeting.js 定义 + overrideVideo 单次调用)，实为 ' + calls + '（重复调用回归）');
assert(definitions.length === 1 && invocations.length === 1,
  'videoBelongsToTask 必须恰好定义一次且调用一次，不能用总数掩盖缺失或重复');

dom.window.close();

console.log(ok ? 'PASS sim-video-belongs-once (修复⑤)' : 'FAIL sim-video-belongs-once (修复⑤)');
process.exit(ok ? 0 : 1);
