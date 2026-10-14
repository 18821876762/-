// KVS 异步存储底座回归：验证 localStorage 回退路径（默认 backend=local）读写闭环，
// 以及 IndexedDB 不可用环境下 ready 正常 resolve（不抛、不挂），为 localStorage→IndexedDB 迁移奠基。
// 本文件为 node:test 迁移样板（sim-kvs.js 原自研 assert + process.exit → node:test 风格）：
//   - test() + t.skip 替代「缺 jsdom 时 exit 0」
//   - 断言失败 throw → 由 runner 聚合为 FAIL，删除 process.exit 手动退出
//   - 保留 vm/jsdom 加载构建产物的同源策略（new window.Function(artifact)）
//   - ⚠ 必须 t.after(() => window.close()) 清理 jsdom 窗口：产物会启动主循环 setInterval，
//     不关窗口则测试跑完进程不退出，sim 门禁会无限挂起（曾致回归卡死）
'use strict';

const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { JSDOM = null; }

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

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

test('KVS 异步存储底座回归（localStorage 回退 / IndexedDB 不可用）', { skip: JSDOM ? false : '缺少 jsdom 依赖' }, async (t) => {
  if (!JSDOM) return; // 无 jsdom 时 test 已 skip，这里仅类型防御
  function assert(name, cond) {
    console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
    if (!cond) throw new Error('FAIL ' + name);
  }

  console.log('--- KVS 异步存储底座回归（localStorage 回退 / IndexedDB 不可用） ---');

  const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
  // 关键：jsdom 窗口内产物会启动主循环 setInterval（main-loop TimerRegistry）等句柄，
  // 若不关闭窗口，测试跑完进程也不会退出（--test 与直接 node 跑均无限挂起，曾致 sim 门禁卡死）。
  // t.after 保证无论断言 PASS/FAIL 都执行清理（window.close() 会清掉 jsdom 全部定时器/监听/MO）。
  t.after(() => { try { window.close(); } catch (e) {} });
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

  console.log('结论: PASS — KVS 底座就绪（IndexedDB 就绪后可通过 CONFIG.KVS_BACKEND=indexeddb 启用）');
});
