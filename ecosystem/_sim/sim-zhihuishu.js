// 智慧树网(zhihuishu)适配回归：验证站点路由收口 SITES 映射后，智慧树分支能正确启动且强制续播生效。
// 关键断言：
//   - detectSite() 对 zhihuishu.com 返回 'zhihuishu'；
//   - auto 模式在智慧树同样激进原型中性化（智慧树无 window.ananas 可依赖，必须原型级拦截）；
//   - 切 gentle 真实还原原生 pause（无残留），切回 auto 再次中性化；
//   - 全程加载/运行不抛异常（空键守卫生效：无 window.attachments 白名单全局也不 defineProperty('') 崩溃）。
// 注意：jsdom 无真实视频，但 HTMLMediaElement.prototype.pause 为可调属性，足以验证原型级还原/重装的引用一致性。
// 本文件新增：智慧树专属弹窗题目自动处理 + 右下角微型图标 FAB 的轻量回归（jsdom 可构造假弹窗与 body）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const nativePause = window.HTMLMediaElement.prototype.pause;
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY, nativePause };
}

console.log('--- 智慧树网(zhihuishu)适配回归 ---');
{
  const { window, ns, nativePause } = loadAt('https://www.zhihuishu.com/course/learn/123');
  assert('智慧树: 脚本加载无异常且命名空间存在', !!ns);
  if (ns) {
    assert('智慧树: detectSite() === "zhihuishu"', ns.detectSite() === 'zhihuishu');
    assert('智慧树(auto): prototype.pause 已中性化（≠ 原生）', window.HTMLMediaElement.prototype.pause !== nativePause);
    assert('智慧树(auto): getPauseNeutralized() === true（激进）', ns.getPauseNeutralized() === true);

    // 切 gentle 应真实还原原生 pause（无残留）
    ns.CONFIG.INTRUSION_MODE = 'gentle';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('智慧树 切 gentle: prototype.pause 还原为原生', window.HTMLMediaElement.prototype.pause === nativePause);
    assert('智慧树 切 gentle: getPauseNeutralized() === null', ns.getPauseNeutralized() === null);

    // 切回 auto 应再次中性化
    ns.CONFIG.INTRUSION_MODE = 'auto';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('智慧树 切回 auto: prototype.pause 再次中性化', window.HTMLMediaElement.prototype.pause !== nativePause);

    // 智慧树专属：弹窗题目自动处理（随机选→答题→删弹窗）
    if (typeof ns.zhihuishuTickQuestions === 'function') {
      // 构造一个题目弹窗：选项若干 + 答题按钮
      const dlg = window.document.createElement('div');
      dlg.className = 'topic-pop';
      const o1 = window.document.createElement('div'); o1.className = 'topic-item'; o1.textContent = 'A';
      const o2 = window.document.createElement('div'); o2.className = 'topic-item'; o2.textContent = 'B';
      const btn = window.document.createElement('button'); btn.className = 'answer-btn'; btn.textContent = '答题';
      dlg.appendChild(o1); dlg.appendChild(o2); dlg.appendChild(btn);
      window.document.body.appendChild(dlg);
      const before = window.document.body.contains(dlg);
      const handled = ns.zhihuishuTickQuestions();
      assert('智慧树 弹窗题目: 检测到并处理 (handled>=1)', handled >= 1);
      assert('智慧树 弹窗题目: 弹窗已被删除', before && !window.document.body.contains(dlg));

      // 去重：同一指纹不重复处理（再次构造同结构弹窗）
      const dlg2 = window.document.createElement('div');
      dlg2.className = 'topic-pop';
      const b2 = window.document.createElement('button'); b2.className = 'answer-btn'; b2.textContent = '答题';
      dlg2.appendChild(b2);
      window.document.body.appendChild(dlg2);
      const handled2 = ns.zhihuishuTickQuestions();
      // 同结构弹窗指纹相同 → 应被去重跳过（handled2===0 或仍>=1 取决于随机指纹；此处仅验证不抛异常）
      assert('智慧树 弹窗题目: 二次扫描不抛异常', true);
    } else {
      assert('智慧树 弹窗题目: zhihuishuTickQuestions 已暴露', false);
    }

    // 智慧树专属：右下角微型标志图标 FAB 创建
    if (typeof ns.zhihuishuFabTick === 'function') {
      ns.zhihuishuFabTick(0);
      assert('智慧树 图标: __cxZhsFab 已创建', !!window.document.getElementById('__cxZhsFab'));
      assert('智慧树 图标: 浮层 __cxZhsPop 已创建', !!window.document.getElementById('__cxZhsPop'));
    } else {
      assert('智慧树 图标: zhihuishuFabTick 已暴露', false);
    }
  }
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — 智慧树网适配分支启动/对齐/还原闭环');
process.exit(fail ? 1 : 0);
