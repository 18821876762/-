// sim-quiz-selectors.js —— 共享 quiz 选择器工厂 + 弹窗选择器收窄 回归（NEW-4 / NEW-2）
//
// 覆盖第四轮缺陷：
//   NEW-4：renwei/unipus/ucampus/ilabx 四站 quiz 选择器字面量完全重复 →
//          抽出 createQuizSelectors(thirdQuestionSel) 工厂，四站复用。
//          本用例做**源码级**校验：工厂存在、四站均改为工厂调用、四份重复字面量已消除、
//          工厂在构建产物中的位置早于四站（否则 var 提升下调用时函数已定义但顺序语义需保证）。
//   NEW-2：zhihuishu/icourse163/xuetangx/icve 四站 dialogSels 仍含 [class*="..."] 宽子串选择器，
//          未与 popup-quiz.js 的 S2 收窄对齐 → 会把正常业务容器误判为弹窗。
//
// 采用源码静态断言（而非 jsdom 运行时）：这两项均为**配置/结构**级缺陷，
//   其回归价值在于防止后续有人复制粘贴回退，静态校验更直接且无需浏览器执行。
'use strict';

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const SRC = path.resolve(__dirname, '..', 'src', 'chaoxing-force-play');
const BUNDLE = require('../scripts/project-paths.cjs').personalProduct;

const results = [];
let fail = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) fail++;
  results.push({ name, pass, extra: extra === undefined ? null : extra });
}
function readSrc(rel) {
  const p = path.join(SRC, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// ══════════════ NEW-4：共享 quiz 选择器工厂 ══════════════
const factorySrc = readSrc(path.join('sites', 'quiz-selectors.js'));
ok('NEW-4-1 共享工厂文件 sites/quiz-selectors.js 存在', factorySrc !== null);
ok('NEW-4-2 工厂导出 createQuizSelectors(thirdQuestionSel)',
  !!factorySrc && /function\s+createQuizSelectors\s*\(\s*thirdQuestionSel\s*\)/.test(factorySrc));
ok('NEW-4-3 工厂返回四类选择器（question/stem/option/submit）',
  !!factorySrc && ['questionSels', 'stemSels', 'optionSels', 'submitSels'].every((k) => factorySrc.includes(k + ':')));
ok('NEW-4-4 第三个 questionSel 由参数注入（而非硬编码）',
  !!factorySrc && /questionSels:\s*\[[^\]]*thirdQuestionSel/.test(factorySrc));

// 四站均应改为工厂调用，且不再保留 stem/option/submit 重复字面量
const SITE_EXPECT = [
  { file: 'renwei.js', varName: 'RENWEI', third: '.exam-item' },
  { file: 'unipus.js', varName: 'UNIPUS', third: '.exercise-item' },
  { file: 'ucampus.js', varName: 'UCAMPUS', third: '.exercise-item' },
  { file: 'ilabx.js', varName: 'ILABX', third: '.step-question' },
];
SITE_EXPECT.forEach(function (s) {
  const src = readSrc(path.join('sites', s.file));
  ok('NEW-4-5 ' + s.file + ' 存在', src !== null);
  if (!src) return;
  const callRe = new RegExp('var\\s+' + s.varName + '\\s*=\\s*createQuizSelectors\\(\\s*[\'"]' + s.third.replace('.', '\\.') + '[\'"]\\s*\\)');
  ok('NEW-4-6 ' + s.file + ' 已改用工厂并传入 ' + s.third, callRe.test(src),
    (src.match(/var\s+\w+\s*=\s*[^\n]*/) || [''])[0].trim().slice(0, 80));
  // 重复字面量必须消除：不应再出现自建的 stemSels/optionSels/submitSels
  ok('NEW-4-7 ' + s.file + ' 已删除重复的 stemSels 字面量', !/stemSels\s*:/.test(src));
  ok('NEW-4-8 ' + s.file + ' 已删除重复的 optionSels 字面量', !/optionSels\s*:/.test(src));
  ok('NEW-4-9 ' + s.file + ' 已删除重复的 submitSels 字面量', !/submitSels\s*:/.test(src));
});

// 构建顺序：工厂必须在四站之前注入同一闭包，且已进入产物
const bundle = fs.existsSync(BUNDLE) ? fs.readFileSync(BUNDLE, 'utf8') : '';
ok('NEW-4-10 构建产物存在', bundle.length > 0);
// 压缩会合并 var 声明、去除空格；按 AST 校验调用、参数和所在闭包，不依赖排版。
const bundleAst = espree.parse(bundle, { ecmaVersion: 'latest', sourceType: 'script', range: true });
const bundleNodes = [];
function collectNodes(node, scope) {
  if (!node || typeof node.type !== 'string') return;
  bundleNodes.push({ node, scope });
  const childScope = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type) ? node : scope;
  Object.values(node).forEach(function (value) {
    if (Array.isArray(value)) value.forEach(function (child) { collectNodes(child, childScope); });
    else if (value && typeof value === 'object') collectNodes(value, childScope);
  });
}
collectNodes(bundleAst, null);
const factory = bundleNodes.find(({ node }) => node.type === 'FunctionDeclaration' && node.id.name === 'createQuizSelectors');
ok('NEW-4-11 工厂已打包进产物', !!factory);
SITE_EXPECT.forEach(function (s) {
  const site = bundleNodes.find(({ node }) => node.type === 'VariableDeclarator' && node.id.name === s.varName);
  const call = site && site.node.init;
  ok('NEW-4-12 产物中 ' + s.varName + ' 使用工厂',
    !!call && call.type === 'CallExpression' && call.callee.type === 'Identifier' &&
    call.callee.name === 'createQuizSelectors' && call.arguments.length === 1 &&
    call.arguments[0].type === 'Literal' && call.arguments[0].value === s.third);
  ok('NEW-4-13 产物中工厂定义早于 ' + s.varName + ' 调用',
    !!factory && !!site && factory.scope === site.scope && factory.node.range[0] < site.node.range[0],
    factory && site ? factory.node.range[0] + ' < ' + site.node.range[0] + '（同一闭包）' : '缺少工厂或站点声明');
});

// ══════════════ NEW-2：弹窗选择器收窄传导 ══════════════
// 宽子串选择器会命中正常业务容器（如 .question-list 区域），造成误判/误删。
const WIDE_RE = /\[class\*=["'](question|topic|answer|quiz|popup)["']\]/;
// H1 中央化：弹窗选择器改引用 popup-quiz.js 的 POPUP_BASE，提前读取其源码供 NEW-2-4 跨文件统计具名数
const pqSrc = readSrc(path.join('sites', 'popup-quiz.js'));
const POPUP_SITES = ['zhihuishu.js', 'icourse163.js', 'xuetangx.js', 'icve.js'];
POPUP_SITES.forEach(function (f) {
  const src = readSrc(path.join('sites', f));
  ok('NEW-2-1 ' + f + ' 存在', src !== null);
  if (!src) return;
  // H1 中央化后 zhihuishu.js 的 dialogSels 为引用表达式（含 `: []` 兜底空数组），原 `\[[^\]]*\]` 会误匹配到兜底 `[]`；
  // 改为捕获整行（到换行），确保取到完整引用表达式而非空数组兜底。
  const m = src.match(/dialogSels\s*:\s*[^\n]*/);
  ok('NEW-2-2 ' + f + ' 含 dialogSels 配置', !!m);
  if (!m) return;
  ok('NEW-2-3 ' + f + ' dialogSels 已去除宽子串选择器', !WIDE_RE.test(m[0]),
    m[0].slice(0, 110));
  // 收窄不等于清空：必须仍保留具名 class 选择器，否则弹窗完全识别不到。
  // H1 中央化后 zhihuishu.js 的 dialogSels 改为引用 POPUP_BASE（如 POPUP_BASE_REF.dialogSels），
  // 行内不再内联具名 class；此时去 popup-quiz.js 的 POPUP_BASE 定义处统计对应数组的实际具名数，确保未过度收窄。
  let named;
  const baseRef = m[0].match(/POPUP_BASE\w*\.(\w+)/);
  if (baseRef && pqSrc) {
    const arr = baseRef[1];
    const baseDef = pqSrc.match(new RegExp('var\\s+POPUP_BASE\\s*=\\s*\\{[\\s\\S]*?' + arr + '\\s*:\\s*\\[([\\s\\S]*?)\\]'));
    named = baseDef ? (baseDef[1].match(/['"]\.[a-zA-Z][\w-]*['"]/g) || []).length : 0;
  } else {
    named = (m[0].match(/['"]\.[a-zA-Z][\w-]*['"]/g) || []).length;
  }
  ok('NEW-2-4 ' + f + ' 仍保留具名 class 选择器（未过度收窄）', named >= 3, '具名数=' + named);
});

// 通用骨架 popup-quiz.js 的 POPUP_QUIZ 是**有意保留** [class*="popup"] 的兜底配置：
//   S2 收窄时明确论证过「真弹窗由 .dialog-wrap/.modal/.question-pop/[class*="popup"] 覆盖」，
//   且经 _pqIsDialogCandidate 尺寸门禁 + 三重确认过滤。故只豁免 popup 一项，
//   question/topic/answer/quiz 四类宽选择器在任何位置都不得回归。
// （pqSrc 已在上方 NEW-2 段前读取，供 NEW-2-4 跨文件统计 POPUP_BASE 具名数）
ok('NEW-2-5 sites/popup-quiz.js 存在', pqSrc !== null);
if (pqSrc) {
  const pqm = pqSrc.match(/dialogSels\s*:\s*\[[\s\S]*?\]/);   // 跨行匹配（该配置换行书写）
  ok('NEW-2-6 popup-quiz.js 含 dialogSels 配置', !!pqm);
  if (pqm) {
    ok('NEW-2-7 popup-quiz.js 已去除 question/topic/answer 宽选择器（S2 收窄）',
      !/\[class\*=["'](question|topic|answer|quiz)["']\]/.test(pqm[0]), pqm[0].replace(/\s+/g, ' ').slice(0, 130));
  }
}

// 产物侧防漂移：打包后所有 dialogSels 均不得含 question/topic/answer/quiz 宽选择器
// 从 AST 取完整配置表达式（含共享数组引用和 concat）；字符串自身的 ] 不再截断数组。
const STRICT_WIDE_RE = /\[class\*=["'](question|topic|answer|quiz)["']\]/;
const bundleDialogs = bundleNodes.map(({ node }) => node).filter((node) =>
  node.type === 'Property' && (node.key.name || node.key.value) === 'dialogSels');
ok('NEW-2-8 产物中存在 dialogSels 配置', bundleDialogs.length >= 5, '共 ' + bundleDialogs.length + ' 处');
function containsWideSelector(node) {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'Literal' && typeof node.value === 'string') return STRICT_WIDE_RE.test(node.value);
  return Object.values(node).some((value) => Array.isArray(value)
    ? value.some(containsWideSelector) : value && typeof value === 'object' && containsWideSelector(value));
}
const widened = bundleDialogs.filter((property) => containsWideSelector(property.value));
ok('NEW-2-9 产物中所有 dialogSels 均无 question/topic/answer/quiz 宽选择器', widened.length === 0,
  widened.length ? bundle.slice(...widened[0].range).replace(/\s+/g, ' ').slice(0, 130) : null);

console.log('\n=== sim-quiz-selectors ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
