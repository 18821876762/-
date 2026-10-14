const projectPaths = require('./project-paths.cjs');
// 沙箱独立性探针：同一 node 进程内加载产物两次到两个独立 jsdom 窗口，
// 验证 (1) 产物不污染 node 全局；(2) 第二个窗口不继承第一个窗口的命名空间状态。
const fs = require('fs');
const { JSDOM } = projectPaths.requireSim('jsdom');

const artifact = fs.readFileSync(projectPaths.bundle, 'utf8');

function loadIntoFreshWindow(label) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const fn = new win.Function(artifact);
  fn.call(win);
  return dom;
}

// 进程启动后立刻采样 node 全局，应为 undefined
const before = globalThis.__CX_FORCE_PLAY;

const dom1 = loadIntoFreshWindow('A');
const afterWin1 = globalThis.__CX_FORCE_PLAY; // 产物是否漏到 node 全局？
const ns1 = dom1.window.__CX_FORCE_PLAY;

const dom2 = loadIntoFreshWindow('B');
const ns2 = dom2.window.__CX_FORCE_PLAY;

let ok = true;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) ok = false; }

check('node 全局在加载前无 __CX_FORCE_PLAY', before === undefined);
check('加载 window A 后 node 全局仍无 __CX_FORCE_PLAY', afterWin1 === undefined);
check('window A 拥有独立命名空间', !!ns1 && typeof ns1 === 'object');
check('window B 拥有独立命名空间', !!ns2 && typeof ns2 === 'object');
check('A、B 命名空间是不同对象引用（未跨沙箱共享单例）', ns1 !== ns2);

dom1.window.close();
dom2.window.close();
console.log(ok ? '\n结论: PASS — 进程内多窗口沙箱独立，产物未污染 node 全局' : '\n结论: FAIL');
process.exit(ok ? 0 : 1);
