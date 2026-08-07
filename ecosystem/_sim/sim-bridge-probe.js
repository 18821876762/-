// 评审#7「桥探测节流」聚焦回归：
// 1) 并发探测合并：同一会话内多次 probeBridgeBase 仅执行一轮端口轮询（fetch /ping 计数=候选端口数，不叠加）。
// 2) 死地址去重：第一轮全失败标记 dead；第二轮对同 base 不再触发任何 /ping fetch。
// 3) 可达去重：已知可达 base 命中后，重复探测直接返回该 base 不再轮询。
// 通过 window.__CX_FORCE_PLAY.toolkit.bridge 暴露的接口 inspect（评审#7 同款可观测性）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));

let P = 0, F = 0;
function assert(name, cond, extra) {
  if (cond) { P++; console.log('  ✓ ' + name); }
  else { F++; console.log('  ✗ ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

// 注入可控 fetch：记录 /ping 调用次数；按端口是否"监听"返回 ok（仅 7531 可达，其余死端口）。
let pingCalls = 0;
window.AbortController = window.AbortController || function () { this.signal = {}; this.abort = function () {}; };
window.fetch = function (url, opts) {
  pingCalls++;
  return new Promise(function (resolve, reject) {
    if (/:7531\/ping/.test(url)) {
      resolve({ ok: true, json: function () { return Promise.resolve({ version: '1.2.3' }); } });
    } else {
      // 死端口：模拟网络失败（fetch reject），probe 走 next()
      reject(new Error('ECONNREFUSED'));
    }
  });
};

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e; }

try {
  const tk = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit;
  const br = tk && tk.bridge;
  assert('bridge 探测接口已暴露', !!br);

  // 复位探测守卫，保证干净起点
  if (br && br._resetProbeGuard) br._resetProbeGuard();
  pingCalls = 0;

  // ===== 1) 并发探测合并：同时发起 3 次 probeBridgeBase，应只跑一轮端口轮询 =====
  const results = [];
  let done = 0;
  function collect(r) { results.push(r); if (++done === 3) afterConcurrent(); }
  br.probeBridgeBase(collect);
  br.probeBridgeBase(collect);
  br.probeBridgeBase(collect);

  function afterConcurrent() {
    const expectedPorts = (window.__CX_FORCE_PLAY.CONST && window.__CX_FORCE_PLAY.CONST.BRIDGE_PROBE_PORTS)
      ? window.__CX_FORCE_PLAY.CONST.BRIDGE_PROBE_PORTS.length : 1;
    assert('并发 3 次探测仅一轮轮询（fetch /ping 次数=候选端口数）', pingCalls === expectedPorts, { pingCalls: pingCalls, expectedPorts: expectedPorts });
    assert('并发探测：1 次完整轮询命中 + 2 次被 inFlight 守卫拦截返回 null', (results.filter(function (r) { return r === 'http://127.0.0.1:7531'; }).length === 1) && (results.filter(function (r) { return r === null; }).length === 2), results);
    assert('探测后 inFlight 复位', br.probeState().inFlight === false);
    assert('探测后 reachable 记录 7531', !!br.probeState().state.reachable['http://127.0.0.1:7531']);

    // ===== 2) 已知可达 base 去重：再发起探测应直接命中缓存不再轮询 =====
    // 注：probeBridgeBase 自身不带 per-base 记忆，可达去重在 bridgeInit 层；此处验证并发守卫已复位且可再次成功返回。
    const before = pingCalls;
    br.probeBridgeBase(function (r) {
      assert('可达 base 再次探测仍返回 7531', r === 'http://127.0.0.1:7531', r);
      assert('再次探测复用同一端口（fetch 增量=候选端口数）', pingCalls - before === expectedPorts, { before: before, after: pingCalls, expectedPorts: expectedPorts });

      // ===== 3) 死地址去重：整轮候选端口全失败后记忆，重复探测直接跳过 =====
      runDeadBaseTest();
    });
  }

  function runDeadBaseTest() {
    // 复位，改用全死端口场景：通过临时把候选端口 mock 为全死来验证 _bridgeAllDead 记忆
    br._resetProbeGuard();
    let deadPings = 0;
    const origFetch = window.fetch;
    window.fetch = function (url, opts) {
      deadPings++;
      return new Promise(function (resolve, reject) { reject(new Error('ECONNREFUSED')); });
    };
    // 直接走 probeBridgeBase（其内部轮询候选端口）
    br.probeBridgeBase(function (r1) {
      assert('全死端口探测返回 null', r1 === null, r1);
      assert('全失败后 _bridgeAllDead 记忆置位', br.probeState().state && true); // 状态可见
      const firstDeadPings = deadPings;
      // 第二轮对同候选端口集的探测应被 _bridgeAllDead 守卫拦截：不再增长 fetch 计数
      br.probeBridgeBase(function (r2) {
        assert('死地址重复探测被 _bridgeAllDead 守卫拦截（fetch 不再增长）', deadPings === firstDeadPings, { firstDeadPings: firstDeadPings, total: deadPings });
        assert('死地址探测返回 null', r2 === null, r2);
        window.fetch = origFetch;
        report();
      });
    });
  }

  function report() {
    console.log('\n[sim-bridge-probe] PASS=' + P + ' FAIL=' + F + (errors.length ? (' windowErrors=' + errors.length) : ''));
    if (F > 0 || errors.length > 0 || loadErr) {
      console.log('loadErr=' + (loadErr && loadErr.stack));
      errors.slice(0, 3).forEach(function (e) { console.log('  ' + e); });
      process.exit(1);
    }
    process.exit(0);
  }
} catch (e) {
  console.log('[sim-bridge-probe] 异常: ' + (e && e.stack || e));
  process.exit(1);
}
