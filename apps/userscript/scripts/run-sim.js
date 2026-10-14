'use strict';
/*
 * 运行 _sim 下「无需浏览器」的仿真用例（jsdom 子集）。
 * 两种模式：
 *   --node-test  用 node:test 聚合运行（推荐；针对已迁移 node:test 的 sim 文件，
 *                支持覆盖率 / 按名过滤 / 单进程 watch，消除逐文件 spawn 的 PowerShell stderr 误判坑）
 *   默认         逐文件 spawnSync 运行（兼容尚未迁移 node:test 的旧式 sim 文件）
 *
 * --node-test 模式额外参数：
 *   --coverage   输出测试覆盖率（对应 node --test-coverage，需 node >= 22）
 *   --name <pat> 按名称过滤（对应 node --test-name-pattern）
 *
 * Playwright 真机用例（smoke-pw.js / sim-iframe-pw.js / sim-bridge-noise-pw.js）
 * 由 CI 独立 job `browser-sim` 运行（已转硬门禁），本脚本不收集。
 *
 * 退出码：全部通过 0；任一失败 1。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 单个 sim 文件超时兜底（ms）：防 jsdom 残留句柄等导致进程无限挂起、构建卡死
// （实测 sim-kvs.js 迁移 node:test 后曾因不关 jsdom 窗口而无限挂起）。
const DEFAULT_TIMEOUT = 120000;
const TIMEOUT_ARG = process.argv.indexOf('--timeout');
const TIMEOUT_MS = TIMEOUT_ARG >= 0 && process.argv[TIMEOUT_ARG + 1]
  ? Math.max(5000, Number(process.argv[TIMEOUT_ARG + 1]) || DEFAULT_TIMEOUT)
  : DEFAULT_TIMEOUT;

const SIM_DIR = path.resolve(__dirname, '..', '_sim');
const PW_SKIP = new Set([
  'smoke-pw.js',
  'sim-iframe-pw.js',
  'sim-bridge-noise-pw.js',
  'sim-panel-scroll-pw.js',
  'sim-safety-visible-pw.js',
]);

const node = process.execPath;
const files = fs
  .readdirSync(SIM_DIR)
  .filter((f) => /^sim-.*\.js$/.test(f))
  .sort();

// ---------- --node-test 模式：node:test 单进程聚合 ----------
// 只有已迁移 node:test 的 sim（真正 require('node:test')）才能进单进程聚合；其余旧式 sim 用 process.exit() 作
// 通过/失败信号，若一并丢进单进程 node --test，首个 process.exit() 会直接杀死整个聚合进程，导致后续文件被跳过且可能假绿。
// 故：node:test 文件走 node --test 聚合；旧式文件回退 spawnSync（每文件独立子进程，process.exit 信号安全）。
const NODE_TEST_FILES = new Set([
  'sim-kvs.js',   // 当前唯一 node:test 迁移样板；新增 node:test 风格 sim 时在此登记
]);
if (process.argv.includes('--node-test')) {
  const args = ['--test'];
  if (process.argv.includes('--coverage')) args.push('--test-coverage');
  const nameIdx = process.argv.indexOf('--name');
  if (nameIdx >= 0 && process.argv[nameIdx + 1]) args.push('--test-name-pattern', process.argv[nameIdx + 1]);
  // 仅已迁移 node:test 的文件进聚合，且必须转绝对路径（否则 cwd 不等于 _sim 时 node --test 找不到文件）
  const ntFiles = files.filter((f) => NODE_TEST_FILES.has(f));
  const legacyFiles = files.filter((f) => !PW_SKIP.has(f) && !NODE_TEST_FILES.has(f));
  let aggregateFailed = false;
  if (ntFiles.length) {
    const res = spawnSync(node, args.concat(ntFiles.map((f) => path.join(SIM_DIR, f))), { stdio: 'inherit', encoding: 'utf8', timeout: TIMEOUT_MS * 4 });
    if (res.error && res.error.code === 'ETIMEDOUT') {
      console.error('TIMEOUT(>' + (TIMEOUT_MS * 4) + 'ms): node --test 聚合回归未在限时内退出，可能有 sim 残留句柄挂起');
    }
    if (res.status !== 0) aggregateFailed = true;
  }
  // 旧式文件回退逐文件 spawn（process.exit 信号安全，避免污染 node:test 聚合进程）
  if (legacyFiles.length) {
    for (const f of legacyFiles) {
      const res = spawnSync(node, [path.join(SIM_DIR, f)], { encoding: 'utf8', timeout: TIMEOUT_MS });
      if (res.status === 0) {
        console.log('PASS: ' + f);
      } else {
        aggregateFailed = true;
        console.log('FAIL: ' + f);
        const out = (res.stdout || '') + (res.stderr || '');
        if (out.trim()) console.log(out.trim());
      }
    }
  }
  process.exit(aggregateFailed ? 1 : 0);
}

// ---------- 默认模式：逐文件 spawn（兼容旧式 sim，迁移完成后将默认切到 --node-test） ----------
let total = 0;
let passed = 0;
let failed = 0;
const failures = [];

for (const f of files) {
  const full = path.join(SIM_DIR, f);
  if (PW_SKIP.has(f)) {
    console.log(`SKIP (playwright): ${f}`);
    continue;
  }
  total++;
  const res = spawnSync(node, [full], { encoding: 'utf8', timeout: TIMEOUT_MS });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    failed++;
    failures.push(f);
    console.log(`TIMEOUT(>${TIMEOUT_MS}ms): ${f} — 疑似残留句柄挂起，见下方 stderr/stdout`);
    const out = (res.stdout || '') + (res.stderr || '');
    if (out.trim()) console.log(out.trim());
    continue;
  }
  if (res.status === 0) {
    passed++;
    console.log(`PASS: ${f}`);
  } else {
    failed++;
    failures.push(f);
    console.log(`FAIL: ${f}`);
    const out = (res.stdout || '') + (res.stderr || '');
    if (out.trim()) console.log(out.trim());
  }
}

console.log(`\nsim (jsdom subset): ${passed}/${total} passed, ${failed} failed, ${files.length - total} skipped`);
if (failed > 0) {
  console.log('FAILED: ' + failures.join(', '));
  process.exit(1);
}
