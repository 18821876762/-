// 视觉识别层·隐私合规回归：验证外部 CDN 脚本加载默认被拒（隐私优先，拒绝静默外连），
// 仅当用户在面板显式授权（QUIZ_VISION_PRIVACY_OK=true）后才允许尝试加载。
//   - 默认关：quizSnapshot 直接 reject，消息含「隐私」，绝不发起外部请求；
//   - 授权开：通过隐私闸门，真正尝试加载外部脚本（jsdom 无资源→onerror「load fail」而非「隐私」拦截）；
//   - 已缓存：window.html2canvas 已存在时直接复用，不受隐私开关影响（无外连）。
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
const tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 40); }); };

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
  console.log('--- 视觉识别层·隐私合规（外部 CDN 脚本授权）回归 ---');

  // 1. 默认关：quizSnapshot 应被隐私闸门拦截，reject 且消息含「隐私」
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    assert('默认: QUIZ_VISION_PRIVACY_OK=false', ns.CONFIG.QUIZ_VISION_PRIVACY_OK === false);
    let rej = null;
    try { await ns.quizSnapshot(window.document.createElement('div')); }
    catch (e) { rej = e; }
    assert('默认关: quizSnapshot 被隐私拦截(reject)', !!rej);
    assert('默认关: 拦截消息含「隐私」', !!rej && /隐私/.test(rej.message));
  }

  // 2. 授权开：通过隐私闸门，进入真正的外部脚本加载（jsdom 不拉取资源→onerror「load fail」而非「隐私」）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.CONFIG.QUIZ_VISION_PRIVACY_OK = true;     // 用户显式授权
    // 让 jsdom 在 appendChild 后立刻触发 script.onerror，验证已越过低闸门、真正尝试加载
    const origCreate = window.document.createElement.bind(window.document);
    window.document.createElement = function (tag) {
      const el = origCreate(tag);
      if (tag === 'script') { setTimeout(function () { if (el.onerror) el.onerror(); }, 5); }
      return el;
    };
    let rej = null;
    try { await ns.quizSnapshot(window.document.createElement('div')); }
    catch (e) { rej = e; }
    assert('授权开: 越过敏感闸门(非「隐私」拦截)', !!rej && !/隐私/.test(rej.message));
    assert('授权开: 真正尝试加载外部脚本(load fail)', !!rej && /load fail/.test(rej.message));
  }

  // 3. 已缓存：window.html2canvas 已存在时复用，无外连、不受隐私开关影响（应 resolve 而非 reject）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.CONFIG.QUIZ_VISION_PRIVACY_OK = false;    // 隐私关
    window.html2canvas = function () { return { toDataURL: function () { return 'data:image/png;base64,AAAA'; } }; };
    let resolved = false, rej = null;
    try { await ns.quizSnapshot(window.document.createElement('div')); resolved = true; }
    catch (e) { rej = e; }
    assert('已缓存: 复用 window.html2canvas 不触发外连/不拒绝', resolved === true && !rej);
  }

  console.log(fail === 0 ? '结论: PASS — 外部 CDN 脚本隐私合规闭环' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
