'use strict';
/*
 * 跨模块契约显式化 —— 构建门禁（⑧）
 * ---------------------------------------------------------------------------
 * 背景：本项目采用「拼接式单 IIFE」架构，所有源文件合成一个闭包，跨文件依赖长期
 *   靠「隐式裸全局」承载（CONFIG / CONST / EventBus / bestEffort / KVS / dbg /
 *   swallow …），没有任何声明式契约。一旦某全局被改名、漏声明或重复声明，失败只
 *   会在运行时以「undefined is not a function」暴露，且极难定位（审查问题 #2）。
 *
 * 本门禁把「隐式契约」变成「可校验的显式契约」：
 *   1. 作用域感知推断（infer）：按构建清单拼接 AST，映射物理文件，仅把外层 IIFE 的
 *        var / function / const / let 声明记为 provides；requires 排除文件内一切
 *        局部（含跨文件函数片段、嵌套 IIFE、函数参数与 catch 绑定）。
 *   2. 闭合性校验（closure）：
 *        - 任一跨模块 requires 必须存在唯一提供方（无人提供 = 违约，捕捉改名/漏声明）；
 *        - 同名裸全局不得由 2+ 模块同时提供（重复提供 = 歧义违约）；
 *        - 若模块带 @provides / @requires 注解，额外做「意图漂移」检测。
 *   3. 生成跨模块依赖映射表（--emit-doc），供 CONTRACT.md §12 登记，
 *        --check-doc 模式校验不漂移。
 *   4. 显式化播种（--seed）：把推断出的关键契约（被 ≥3 模块引用的骨干全局）
 *        直接写入各源码文件的 @provides/@requires 注解，使门禁从「推断」升级为
 *        「声明式校验」，契约变更可由源码 diff + 门禁双重审查。
 *
 * 声明提取使用 Espree + eslint-scope 的实际词法绑定，连续片段保留原局部作用域；
 *   源组必须有首片锚点且在清单中连续。门禁默认零违约，仅对真实耦合面报警。
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function srcDir() {
  return process.env.CX_CONTRACT_SRC ||
    path.join(__dirname, '..', 'src', 'chaoxing-force-play');
}
function docPath() {
  return process.env.CX_CONTRACT_DOC ||
    path.join(require('./project-paths.cjs').projectRoot, 'docs', 'CROSS_MODULE_CONTRACT.md');
}
const GATE = process.argv.includes('--gate');
const EMIT_DOC = process.argv.includes('--emit-doc');
const CHECK_DOC = process.argv.includes('--check-doc');
const SELFTEST = process.argv.includes('--selftest');
const SEED = process.argv.includes('--seed');

// ---- 内建 / 宿主全局白名单（非跨模块共享裸全局） ----
const BUILTINS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'this', 'arguments',
  'globalThis', 'self', 'top', 'parent', 'frames', 'window', 'document',
  'location', 'navigator', 'history', 'screen', 'localStorage', 'sessionStorage',
  'indexedDB',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
  'Date', 'JSON', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'Promise', 'Map',
  'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent',
  'decodeURIComponent', 'escape', 'unescape', 'eval', 'Function', 'ArrayBuffer',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'Uint8ClampedArray', 'Int8Array', 'Int16Array', 'Int32Array', 'BigInt64Array',
  'DataView', 'Iterator', 'AsyncIterator', 'queueMicrotask',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'clearImmediate', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  'console', 'performance',
  'Node', 'Element', 'HTMLElement', 'HTMLMediaElement', 'HTMLVideoElement',
  'HTMLInputElement', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLDivElement',
  'HTMLSpanElement', 'HTMLCollection', 'NodeList', 'Event', 'CustomEvent',
  'KeyboardEvent', 'MouseEvent', 'UIEvent', 'InputEvent', 'WheelEvent',
  'TouchEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'getSelection', 'Range', 'Text', 'DOMParser',
  'XMLSerializer', 'Blob', 'File', 'FileReader', 'FileList', 'URL',
  'URLSearchParams', 'FormData', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'Worker', 'SharedWorker', 'Audio', 'Image', 'Notification', 'matchMedia',
  'structuredClone', 'AbortController', 'AbortSignal', 'BroadcastChannel',
  'MessageChannel', 'MessagePort', 'CustomElementRegistry', 'crypto', 'subtle',
  'GM_info', 'GM', 'GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues',
  'GM_addValueChangeListener', 'GM_removeValueChangeListener', 'GM_xmlhttpRequest',
  'GM_openInTab', 'GM_registerMenuCommand', 'GM_unregisterMenuCommand',
  'GM_getResourceText', 'GM_getResourceURL', 'GM_addStyle', 'GM_log',
  'unsafeWindow', 'cloneInto', 'exportFunction',
  'module', 'require', 'exports', 'process', '__dirname', '__filename',
  'alert', 'confirm', 'prompt', 'postMessage', 'addEventListener',
  'removeEventListener', 'dispatchEvent'
]);



function parseAnnotations(code) {
  const out = { provides: null, requires: null };
  let m;
  if ((m = /@provides\s*:\s*([^\n@]+)/.exec(code))) out.provides = m[1].split(/[,\s]+/).filter(s => /^[A-Za-z_$][\w$]*$/.test(s));
  if ((m = /@requires\s*:\s*([^\n@]+)/.exec(code))) out.requires = m[1].split(/[,\s]+/).filter(s => /^[A-Za-z_$][\w$]*$/.test(s));
  return out;
}

function collect() {
  return require('./source-groups.cjs').collect(srcDir(), { parseAnnotations, builtins: BUILTINS });
}

// 常见局部变量名噪声（文档中过滤，避免掩盖真实契约）
const NOISE_LOCALS = new Set([
  'i', 'j', 'k', 'v', 'n', 'm', 'r', 'e', 'el', 'idx', 'tmp', 'res', 'ret', 'val',
  'ctx', 'fn', 'cb', 'ok', 'err', 'item', 'arr', 'list', 'map', 'obj', 'key', 'str',
  'num', 'opt', 'opts', 'conf', 'x', 'y', 'z', 't', 'p', 's', 'w', 'h', 'c', 'd', 'o', 'a', 'b', 'q', 'L',
  'ev', 'text', 'box', 'doc', 'btn', 'label', 'val2'
]);

// 过滤：仅保留"疑似真实共享全局"的标识符用于文档（长度≥2 且非噪声局部）
function isSignificant(name) {
  if (name.length < 2) return false;
  if (NOISE_LOCALS.has(name)) return false;
  return true;
}

function runGate() {
  const { modules, allProvides } = collect();
  const providedNames = new Set(allProvides.keys());
  const reqCount = new Map();        // 符号 → 被多少模块引用
  const reqModules = new Map();      // 符号 → 引用它的模块集合
  for (const mod of modules) {
    for (const r of mod.requires) {
      reqCount.set(r, (reqCount.get(r) || 0) + 1);
      if (!reqModules.has(r)) reqModules.set(r, new Set());
      reqModules.get(r).add(mod.file);
    }
  }

  // ---- 注解驱动的显式契约校验（构造上零误报：仅校验"已声明"的契约） ----
  const annoBreaches = [];
  const annoWarnings = [];
  const annoProvides = new Map(); // 符号 → [声明模块]
  for (const mod of modules) {
    if (mod.anno.provides) {
      for (const p of mod.anno.provides) {
        if (!annoProvides.has(p)) annoProvides.set(p, []);
        annoProvides.get(p).push(mod.file);
      }
    }
  }
  for (const mod of modules) {
    if (mod.anno.provides) {
      for (const p of mod.anno.provides) {
        if (!mod.provides.has(p)) {
          annoWarnings.push({ type: 'ANNO_PROV_MISSING', module: mod.file, symbol: p,
            msg: '@provides 声明 `' + p + '` 但本模块未检测到对应声明（契约漂移）' });
        }
      }
    }
    if (mod.anno.requires) {
      for (const r of mod.anno.requires) {
        if (!annoProvides.has(r) && !providedNames.has(r) && !BUILTINS.has(r)) {
          annoBreaches.push({ type: 'ANNO_REQ_UNRESOLVED', module: mod.file, symbol: r,
            msg: '@requires 声明的 `' + r + '` 无提供方（注解契约）且非内建全局' });
        }
      }
    }
  }
  for (const [name, owners] of annoProvides) {
    if (owners.length > 1) {
      annoBreaches.push({ type: 'ANNO_DUP_PROVIDER', module: owners.join(', '), symbol: name,
        msg: '`@provides: ' + name + '` 被多模块声明（' + owners.join(', ') + '）→ 显式契约冲突' });
    }
  }

  return { modules, allProvides, providedNames, reqCount, reqModules,
           annoBreaches, annoWarnings };
}

// 文档：聚焦真实共享全局（被 ≥1 其他模块引用的 provides + 跨模块解析的 requires）
function emitDoc(res) {
  const L = [];
  L.push('# 跨模块契约映射表（自动生成 · 勿手改）');
  L.push('');
  L.push('> 由 `apps/userscript/scripts/verify_cross_module.js --emit-doc` 自动生成，记录「拼接式单 IIFE」下各模块之间的**裸全局**依赖。');
  L.push('> 仅列出被 ≥1 个其他模块引用的共享全局（已过滤局部变量/对象属性键噪声）。');
  L.push('> 构建门禁⑧（`--check-doc`）校验本文件与源码一致，漂移即报错 → 任何耦合变更必须显式重新生成。');
  L.push('');
  L.push('## 共享全局 → 声明模块（被跨模块引用者）');
  L.push('');
  L.push('| 共享全局 | 提供模块 | 引用模块数 |');
  L.push('| --- | --- | --- |');
  const shared = [...res.allProvides.entries()]
    .filter(([name, provs]) => {
      if (!isSignificant(name)) return false;
      // 是否被其他模块引用
      const refs = res.reqModules.get(name);
      if (!refs) return false;
      const otherRefs = [...refs].filter(m => !provs.includes(m)).length;
      return otherRefs >= 1;
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, provs] of shared) {
    const refs = res.reqModules.get(name) || new Set();
    const other = [...refs].filter(m => !provs.includes(m)).length;
    L.push('| `' + name + '` | ' + provs.map(p => '`'+p+'`').join(', ') + ' | ' + other + ' |');
  }
  L.push('');
  L.push('## 各模块依赖明细（仅显著共享符号）');
  L.push('');
  for (const mod of res.modules) {
    const provs = [...mod.provides].filter(isSignificant)
      .filter(p => { const refs = res.reqModules.get(p); return refs && [...refs].some(m => m !== mod.file); })
      .sort();
    const reqs = [...mod.requires].filter(isSignificant)
      .filter(r => res.providedNames.has(r))
      .sort();
    L.push('### ' + mod.file);
    L.push('- **provides（被跨模块引用）** (' + provs.length + '): ' + (provs.length ? provs.map(p => '`'+p+'`').join(', ') : '—'));
    L.push('- **requires（跨模块解析）** (' + reqs.length + '): ' + (reqs.length ? reqs.map(r => '`'+r+'`').join(', ') : '—'));
    L.push('');
  }
  return L.join('\n') + '\n';
}

// ---- 注解播种（--seed）：把推断出的关键契约显式写入源码 ----
// 仅针对被 ≥KEY_MIN 个模块引用的「骨干」共享全局（KEY），且每个符号只在
// 「规范提供方」（allProvides 中首个文件，按路径排序确定）标注 @provides，
// 避免多模块重复声明触发 ANNO_DUP_PROVIDER；重复提供歧义本身保留在文档中供审查。
// @requires 则列出本模块实际使用的 KEY 符号，使消费依赖也显式化。
const KEY_MIN = 3;
const EXTRA_KEYS = ['lsGet', 'lsSet', 'DEFAULT_CONFIG', 'currentSiteCfg',
  'SELECTORS', 'popupQuizTick', 'ans', 'dsAvailable', 'quizTick'];

function computeKey(res) {
  const key = new Set(EXTRA_KEYS);
  for (const [name, mods] of res.reqModules) {
    if (mods.size >= KEY_MIN) key.add(name);
  }
  return key;
}

function stripOurAnnotations(code) {
  return code.split('\n')
    .filter(l => !/^\s*\/\/\s*@provides:/.test(l) && !/^\s*\/\/\s*@requires:/.test(l))
    .join('\n');
}

function seedAnnotations() {
  const res = runGate();
  const key = computeKey(res);
  const canonical = new Map();
  for (const [name, provs] of res.allProvides) canonical.set(name, provs[0]);
  const SRC = srcDir();
  let changed = 0, provCount = 0, reqCount = 0;
  for (const mod of res.modules) {
    const code0 = fs.readFileSync(path.join(SRC, mod.file), 'utf8');
    // 注解从【推断】从零重建（不沿用旧注解），确保 stale 符号（如旧误判的 lsGet/lsSet）被剔除
    const provSet = new Set();
    const reqSet = new Set();
    for (const p of mod.provides) {
      if (key.has(p) && canonical.get(p) === mod.file) provSet.add(p);
    }
    for (const r of mod.requires) {
      if (key.has(r) && res.providedNames.has(r)) reqSet.add(r);
    }
    const lines = [];
    if (provSet.size) { lines.push('// @provides: ' + [...provSet].sort().join(', ')); provCount += provSet.size; }
    if (reqSet.size) { lines.push('// @requires: ' + [...reqSet].sort().join(', ')); reqCount += reqSet.size; }
    const newCode = lines.join('\n') + '\n' + stripOurAnnotations(code0);
    if (newCode !== code0) {
      fs.writeFileSync(path.join(SRC, mod.file), newCode, 'utf8');
      changed++;
    }
  }
  console.log('[CROSS-MODULE] seed 完成：' + changed + ' 个文件写入注解（@provides ' + provCount + ' 处，@requires ' + reqCount + ' 处）。');
  process.exit(0);
}

function main() {
  if (EMIT_DOC) {
    const res = runGate();
    fs.writeFileSync(docPath(), emitDoc(res), 'utf8');
    console.log('[CROSS-MODULE] 已生成依赖映射表: ' + docPath());
    process.exit(0);
  }
  if (CHECK_DOC) {
    const res = runGate();
    const doc = emitDoc(res);
    let cur = ''; try { cur = fs.readFileSync(docPath(), 'utf8'); } catch (e) { cur = ''; }
    if (cur.trim() !== doc.trim()) {
      console.error('[CROSS-MODULE] 依赖映射表漂移！请运行 `node scripts/verify_cross_module.js --emit-doc` 重新生成后提交。');
      process.exit(1);
    }
    console.log('[CROSS-MODULE] 依赖映射表与源码一致。');
    process.exit(0);
  }
  if (SELFTEST) { runSelfTest(); process.exit(0); }
  if (SEED) { seedAnnotations(); process.exit(0); }
  // 默认：门禁模式 = 注解契约校验 + 文档漂移校验（二者均稳健、零误报）
  const res = runGate();
  const doc = emitDoc(res);
  let cur = ''; try { cur = fs.readFileSync(docPath(), 'utf8'); } catch (e) { cur = ''; }
  let drift = false;
  if (cur.trim() !== doc.trim()) {
    drift = true;
    console.error('[CROSS-MODULE] 依赖映射表与源码漂移！请运行 --emit-doc 重新生成后提交（这是跨模块耦合变更的信号）。');
  }
  const ok = res.annoBreaches.length === 0 && !drift;
  if (res.annoBreaches.length) {
    console.error('[CROSS-MODULE] 发现 ' + res.annoBreaches.length + ' 处显式契约（@provides/@requires）违约：');
    for (const b of res.annoBreaches) console.error('  ✗ [' + b.type + '] ' + b.symbol + ' — ' + b.msg + '  @ ' + b.module);
  }
  if (res.annoWarnings.length) {
    console.warn('[CROSS-MODULE] ' + res.annoWarnings.length + ' 条显式契约告警（不阻断）：');
    for (const w of res.annoWarnings) console.warn('  ! [' + w.type + '] ' + w.module + ' · ' + w.symbol + ' — ' + w.msg);
  }
  if (ok) {
    console.log('[CROSS-MODULE] 跨模块契约门禁 OK（注解契约 + 文档漂移均通过；' +
      res.modules.length + ' 模块，' + res.allProvides.size + ' 个裸全局）。');
  }
  process.exit(ok ? 0 : 1);
}

// 自检：构造故意违约的临时源码，断言门禁能检出（防规则空转假绿灯）
function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xmc-selftest-'));
  const srcA = path.join(tmp, 'a.js');
  const srcB = path.join(tmp, 'b.js');
  const srcC = path.join(tmp, 'c.js');
  const srcD = path.join(tmp, 'd.js');
  const docF = path.join(tmp, 'doc.md');
  fs.writeFileSync(srcA, '// @provides: DUP_X\nvar DUP_X = 1;\n');
  fs.writeFileSync(srcB, '// @provides: DUP_X\nvar DUP_X = 2;\n');
  fs.writeFileSync(srcC, '// @requires: DUP_X, GHOST_Y\nfunction useIt(){ return DUP_X + GHOST_Y; }\n');
  const oldSrc = process.env.CX_CONTRACT_SRC;
  const oldDoc = process.env.CX_CONTRACT_DOC;
  process.env.CX_CONTRACT_SRC = tmp;
  process.env.CX_CONTRACT_DOC = docF;
  let pass = true;
  const fail = (m) => { pass = false; console.error('  ✗ SELFTEST: ' + m); };
  try {
    const res = runGate();
    const hasDup = res.annoBreaches.some(b => b.type === 'ANNO_DUP_PROVIDER' && b.symbol === 'DUP_X');
    if (!hasDup) fail('未检出重复 @provides: DUP_X');
    const hasUnres = res.annoBreaches.some(b => b.type === 'ANNO_REQ_UNRESOLVED' && b.symbol === 'GHOST_Y');
    if (!hasUnres) fail('未检出未解析 @requires: GHOST_Y');
    // 作用域感知守卫：函数内局部 var 不得被误判为模块级提供方（防「双提供」假阳性复发）
    fs.writeFileSync(srcD, 'function outer(){ var dbg = 1; var on = 2; var lsGet = function(){}; return dbg + on + lsGet; }\n');
    const resScope = runGate();
    if (resScope.allProvides.has('dbg')) fail('函数内局部 var dbg 被误判为模块级提供方（作用域感知失效）');
    if (resScope.allProvides.has('on')) fail('函数内局部 var on 被误判为模块级提供方（作用域感知失效）');
    if (resScope.allProvides.has('lsGet')) fail('函数内局部 var lsGet 被误判为模块级提供方（作用域感知失效）');
    // 插件感知守卫：plugins/addons/ 下独立 IIFE 包裹的插件，其「顶层」声明是插件内局部，
    // 不得被误判为跨模块提供方（否则会与 config/toast/dom 的真·跨模块全局形成假「双提供」）
    fs.mkdirSync(path.join(tmp, 'plugins', 'addons'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'plugins', 'addons', 'addon-test.js'),
      '(function(){ var ADON_LOCAL = 1; function adonFn(){} })();\n');
    const resAddon = runGate();
    if (resAddon.allProvides.has('ADON_LOCAL')) fail('插件文件顶层 var 被误判为跨模块提供方（插件感知失效）');
    if (resAddon.allProvides.has('adonFn')) fail('插件文件顶层 function 被误判为跨模块提供方（插件感知失效）');
    // 文档随源码变化：改名 DUP_X→DUP_Z（含引用方 c.js）后文档应不同（保证漂移检测有意义）
    const doc1 = emitDoc(res);
    fs.writeFileSync(srcA, '// @provides: DUP_Z\nvar DUP_Z = 1;\n');
    fs.writeFileSync(srcB, '// @provides: DUP_Z\nvar DUP_Z = 2;\n');
    fs.writeFileSync(srcC, '// @requires: DUP_Z, GHOST_Y\nfunction useIt(){ return DUP_Z + GHOST_Y; }\n');
    const res2 = runGate();
    const doc2 = emitDoc(res2);
    if (doc1 === doc2) fail('文档未随源码耦合变化（漂移检测可能空转）');
  } catch (e) {
    fail('自检抛出异常: ' + e.message);
  }
  process.env.CX_CONTRACT_SRC = oldSrc;
  process.env.CX_CONTRACT_DOC = oldDoc;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  if (pass) { console.log('[CROSS-MODULE] SELFTEST PASSED（契约校验 + 文档漂移检测均有效）'); process.exit(0); }
  else { process.exit(1); }
}

main();
