// KVS 异步存储底座回归：验证 localStorage 回退路径（默认 backend=local）读写闭环，
// 以及 IndexedDB 不可用环境下 ready 正常 resolve（不抛、不挂），为 localStorage→IndexedDB 迁移奠基。
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

const artifact = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-force-play.user.js'), 'utf8');

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}

async function main() {
  console.log('--- KVS 异步存储底座回归（localStorage 回退 / IndexedDB 不可用） ---');

  const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
  const kvs = ns.kvs;
  assert('KVS 已暴露', !!kvs);
  // jsdom 无 IndexedDB → 默认 backend=local
  assert('默认 backend=local（IndexedDB 不可用时回退）', kvs.backend() === 'local');
  assert('ready 为 Promise', kvs.ready && typeof kvs.ready.then === 'function');
  const readyOk = await kvs.ready;
  assert('ready resolve（不抛不挂）', readyOk === false);

  // 写 → 读 闭环（默认走 localStorage）
  kvs.set('cx_kvs_test', 'hello');
  const got = await kvs.get('cx_kvs_test');
  assert('kvs.set/get 闭环', got === 'hello');
  assert('localStorage 实际落盘', window.localStorage.getItem('cx_kvs_test') === 'hello');

  // 删除
  kvs.del('cx_kvs_test');
  const afterDel = await kvs.get('cx_kvs_test');
  assert('kvs.del 生效', afterDel == null);

  // CONFIG.KVS_BACKEND 缺省安全
  assert('CONFIG.KVS_BACKEND 缺省不报错', (function () { try { return ns.CONFIG.KVS_BACKEND == null || typeof ns.CONFIG.KVS_BACKEND === 'string'; } catch (e) { return false; } })());

  console.log(fail === 0 ? '结论: PASS — KVS 底座就绪（IndexedDB 就绪后可通过 CONFIG.KVS_BACKEND=indexeddb 启用）' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
