// auto-next 章节测验任务点识别回归：验证"视频播完 → 只点入章节测验任务点，不误点其他 li[onclick]"。
// 关键断言：
//   - 超星页启用 auto-next 后，video ended 触发自动跳课；
//   - 页面含「学习目标」「章节测验」等多个 li[onclick] 任务点时，只点「章节测验」(QUIZ_TEXT_RE 命中)；
//   - 「学习目标」等非测验任务点不被误点；
//   - 点击对象确为带 onclick 的 li（changeDisplayContent 触发点），而非内部 span/div。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

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
  // jsdom 无布局引擎，getBoundingClientRect 恒返回全 0，会导致 $dom.isVisible 误判不可见；
  // 真实浏览器正常。此处 stub 非零尺寸，使「可见」任务点在沙箱中可被判为可见。
  try {
    window.Element.prototype.getBoundingClientRect = function () {
      return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0 };
    };
  } catch (e) {}
  try { window.localStorage.setItem('cx_an_on', '1'); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}

// 构造真实结构的任务点列表：含「学习目标」「章节测验」「章节介绍」三类 li[onclick]
function buildTaskList(window) {
  const ul = window.document.createElement('ul');
  const items = [
    { cls: 'c3', title: '第一章 章节测验', id: 'dct0' },
    { cls: 'c1', title: '学习目标', id: 'dct1' },
    { cls: 'active', title: '视频', id: 'dct2' },
    { cls: 'c3', title: '第二章 章节测验', id: 'dct3' },
    { cls: 'c2', title: '章节介绍', id: 'dct4' },
  ];
  const clicks = {};
  for (const it of items) {
    const li = window.document.createElement('li');
    li.className = it.cls;
    li.title = it.title;
    li.id = it.id;
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.setAttribute('onclick', "changeDisplayContent(1,3,'705052125','099000001','099000000','');");
    const inner = window.document.createElement('div');
    inner.className = 'prev_white';
    inner.setAttribute('aria-hidden', 'true');
    const num = window.document.createElement('span'); num.className = 'num'; num.textContent = it.id.slice(3);
    const txt = window.document.createElement('span'); txt.className = 'spanText'; txt.textContent = it.title;
    inner.appendChild(num); inner.appendChild(txt);
    li.appendChild(inner);
    li.addEventListener('click', function () { clicks[it.title] = (clicks[it.title] || 0) + 1; });
    ul.appendChild(li);
  }
  window.document.body.appendChild(ul);
  return clicks;
}

console.log('--- auto-next 章节测验任务点识别回归 ---');
{
  const { window } = loadAt('https://mooc1.chaoxing.com/learn/1?courseId=1&knowledgeId=1');
  const clicks = buildTaskList(window);

  // 需要一个 video 元素用于派发 ended 事件（auto-next 监听 document capture 'ended'）
  const v = window.document.createElement('video');
  window.document.body.appendChild(v);

  // 等 bootstrap（setTimeout 300ms）注册 ended 监听后再派发
  setTimeout(function () {
    v.dispatchEvent(new window.Event('ended', { bubbles: true }));
    // 题目入口探测有 8s 超时，但这里同步命中 li[onclick]，应很快 click。
    // 用短延时让 Promise 微任务 + 同步 click 落地
    setTimeout(function () {
      assert('active 之后章节测验(第二章) 被点击', (clicks['第二章 章节测验'] || 0) >= 1);
      assert('active 之前章节测验(第一章) 未被误点', (clicks['第一章 章节测验'] || 0) === 0);
      assert('学习目标 未被误点', (clicks['学习目标'] || 0) === 0);
      assert('章节介绍 未被误点', (clicks['章节介绍'] || 0) === 0);
      assert('视频(active) 未被误点', (clicks['视频'] || 0) === 0);
      assert('未触发整页导航(location 不变)', window.location.href.indexOf('changeDisplayContent') < 0 && window.location.href === 'https://mooc1.chaoxing.com/learn/1?courseId=1&knowledgeId=1');
      console.log(fail === 0 ? '结论: PASS — 仅章节测验任务点被自动点入' : ('结论: FAIL (' + fail + ')'));
      process.exit(fail ? 1 : 0);
    }, 0);
  }, 400);
}
