// sim-submit-lock.js —— 交卷防重入锁「全路径释放」回归（NEW-1）+ 站点守卫前置（NEW-7）
//
// 覆盖第四轮缺陷：
//   NEW-1（P0）：zhihuishu-exam.js submitNow() 的**成功路径**（resolve(true) 前）未释放
//     submitting 锁，只有 catch 失败分支释放。一次成功交卷后锁永久为 true，
//     导致 getState().submitting 永远误报"提交中"，且后续任何重试（如交卷被平台驳回后重来）
//     都被防重入分支直接吞掉 —— 锁语义从"防并发"退化为"一次性熔断"。
//   NEW-7（P2）：keyboard-shortcuts.js 的 detectSite() 站点守卫位于 localStorage 读之后，
//     非超星站点仍执行无意义的存储读取，应提前至 IIFE 首行。
//
// NEW-1 采用「函数体切片 + 出口路径枚举」静态校验：submitNow 内每一条
//   resolve(...) 出口之前都必须能追溯到一次 submitting = false（catch 分支同理）。
//   相比 jsdom 跑真实智慧树考试页（需大量站点 DOM 桩），该校验对锁语义的回归防护更直接。
'use strict';

const fs = require('fs');
const path = require('path');
const { readSource } = require('../scripts/source-groups.cjs');

const SRC = path.resolve(__dirname, '..', 'src', 'chaoxing-force-play');

const results = [];
let fail = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) fail++;
  results.push({ name, pass, extra: extra === undefined ? null : extra });
}
function readSrc(rel) {
  const p = path.join(SRC, rel);
  return fs.existsSync(p) ? readSource(SRC, rel.replace(/\\/g, '/')) : null;
}

// 从 "function name(" 起按花括号配对切出完整函数体
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// ══════════════ NEW-1：submitNow 防重入锁全路径释放 ══════════════
const examSrc = readSrc(path.join('sites', 'zhihuishu-exam.js'));
ok('NEW-1-1 sites/zhihuishu-exam.js 存在', examSrc !== null);

const fnSrc = examSrc ? sliceFn(examSrc, 'submitNow') : null;
ok('NEW-1-2 可解析出 submitNow 函数体', !!fnSrc);

if (fnSrc) {
  ok('NEW-1-3 submitNow 仍保留防重入闸门（submitting 早退）',
    /if\s*\(\s*submitting\s*\)\s*return/.test(fnSrc));
  ok('NEW-1-4 submitNow 进入时置锁（submitting = true）',
    /submitting\s*=\s*true/.test(fnSrc));

  // 出口枚举：Promise 执行器内每个 resolve(...) 之前都应有配对的解锁
  const execStart = fnSrc.indexOf('new Promise');
  const body = execStart >= 0 ? fnSrc.slice(execStart) : fnSrc;
  const resolveIdxs = [];
  const re = /resolve\s*\(\s*(true|false)\s*\)/g;
  let m;
  while ((m = re.exec(body)) !== null) resolveIdxs.push({ idx: m.index, val: m[1] });

  ok('NEW-1-5 submitNow 至少有 2 条 resolve 出口（成功/失败）', resolveIdxs.length >= 2,
    '出口数=' + resolveIdxs.length);

  // 关键断言：成功出口 resolve(true) 之前必须有 submitting = false
  const trueExit = resolveIdxs.filter((r) => r.val === 'true');
  ok('NEW-1-6 存在成功出口 resolve(true)', trueExit.length >= 1);
  trueExit.forEach(function (r, i) {
    const before = body.slice(0, r.idx);
    const lastUnlock = before.lastIndexOf('submitting = false');
    const lastLock = before.lastIndexOf('submitting = true');
    ok('NEW-1-7 成功出口#' + (i + 1) + ' resolve(true) 前已释放锁（submitting = false）',
      lastUnlock >= 0 && lastUnlock > lastLock,
      'unlock@' + lastUnlock + ' lock@' + lastLock);
  });

  // 失败出口同样必须解锁（回归保护，防止改动时误删）
  const falseExit = resolveIdxs.filter((r) => r.val === 'false');
  ok('NEW-1-8 存在失败出口 resolve(false)', falseExit.length >= 1);
  falseExit.forEach(function (r, i) {
    const before = body.slice(0, r.idx);
    const lastUnlock = before.lastIndexOf('submitting = false');
    const lastLock = before.lastIndexOf('submitting = true');
    ok('NEW-1-9 失败出口#' + (i + 1) + ' resolve(false) 前已释放锁',
      lastUnlock >= 0 && lastUnlock > lastLock,
      'unlock@' + lastUnlock + ' lock@' + lastLock);
  });

  // 解锁点数量应覆盖 Promise 内全部出口（成功 + 无按钮 + catch）
  const unlockCount = (body.match(/submitting\s*=\s*false/g) || []).length;
  ok('NEW-1-10 解锁点数量 >= Promise 内出口数（无遗漏路径）',
    unlockCount >= resolveIdxs.length, '解锁=' + unlockCount + ' 出口=' + resolveIdxs.length);
  ok('NEW-1-11 catch 分支保留解锁（异常不卡死锁）',
    /catch\s*\([^)]*\)\s*\{[\s\S]{0,200}?submitting\s*=\s*false/.test(body));
}

// ══════════════ NEW-7：站点守卫前置 ══════════════
const ksSrc = readSrc(path.join('plugins', 'addons', 'keyboard-shortcuts.js'));
ok('NEW-7-1 plugins/addons/keyboard-shortcuts.js 存在', ksSrc !== null);
if (ksSrc) {
  // 剔除注释后再比较位置：修复注释里出现的 "localStorage" 字样干扰判定
  const stripped = ksSrc.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/\S/g, ' '))
                        .replace(/\/\/[^\n]*/g, (s) => s.replace(/\S/g, ' '));
  const guardIdx = stripped.indexOf("detectSite() === 'chaoxing'");
  const lsIdx = stripped.search(/localStorage\s*\./);   // 真实读写调用，而非文字提及
  ok('NEW-7-2 仍保留 chaoxing 站点隔离守卫', guardIdx >= 0);
  ok('NEW-7-3 站点守卫早于首次 localStorage 实际读写', guardIdx >= 0 && (lsIdx < 0 || guardIdx < lsIdx),
    'guard@' + guardIdx + ' localStorage@' + lsIdx);
  const guardCount = (ksSrc.match(/detectSite\(\)\s*===\s*'chaoxing'/g) || []).length;
  ok('NEW-7-4 守卫未重复（旧位置已删除）', guardCount === 1, '守卫数=' + guardCount);
}

console.log('\n=== sim-submit-lock ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
