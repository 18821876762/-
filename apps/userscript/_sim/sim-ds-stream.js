// sim-ds-stream.js — 审查#B 回归：DeepSeek 回复「流式复用同一消息节点(length 不增)」兜底判定
// 验证：当 DeepSeek 把新回复追加到发送前已有的最后一个消息节点（节点数不增）时，
// _dsLatestReply 仍能识别为新回复（不再误判"无新回复"→触发错答兜底）。
const fs = require('fs');
const path = require('path');
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
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}

// 构造 DeepSeek 聊天 DOM：role=list 容器内若干消息节点
function makeChat(window, nExisting, lastText) {
  const list = window.document.createElement('div');
  list.setAttribute('role', 'list');
  for (let i = 0; i < nExisting; i++) {
    const it = window.document.createElement('div');
    it.setAttribute('role', 'listitem');
    it.textContent = (i === nExisting - 1) ? lastText : ('历史消息' + i);
    list.appendChild(it);
  }
  window.document.body.appendChild(list);
  return list;
}

async function main() {
  // 场景1：节点数未增，但末条文本相对发送前快照变化（流式追加到同一节点）→ 应识别为新回复
  {
    const { window, ns } = loadAt('https://chat.deepseek.com/');
    const list = makeChat(window, 2, '我是历史最后一条');
    // 模拟发送前快照：末条是"我是历史最后一条"
    ns.__setDsLastReplyBefore('我是历史最后一条');
    const countBefore = 2;
    // 流式：DeepSeek 把新回复追加进最后一个节点，节点数仍为 2，但文本变了
    list.lastChild.textContent = '答案：B';
    // v4.19.20：终态稳定性——首轮进入等待（防止流式中间态被当终态：多选 AB 在 A 到达即被接受→只点 A 错答），
    // 同一文本连续两轮一致才返回
    const r1 = ns._dsLatestReply(countBefore);
    assert('B流式兜底: 首轮进入稳定性等待', r1 === '__GENERATING__');
    const r2 = ns._dsLatestReply(countBefore);
    assert('B流式兜底: 末条文本两轮一致→识别为新回复', r2 === '答案：B');
  }

  // 场景2：节点数未增且末条文本没变（真正无新回复）→ 返回 ''（不误报）
  {
    const { window, ns } = loadAt('https://chat.deepseek.com/');
    makeChat(window, 2, '我是历史最后一条');
    ns.__setDsLastReplyBefore('我是历史最后一条');
    const r = ns._dsLatestReply(2);   // 节点数2，文本也未变
    assert('B流式兜底: 无变化→返回空(不误报)', r === '');
  }

  // 场景3：节点数正常增加（常规新节点）→ 仍按 length 判定，且流式稳定性守卫与「≤countBefore」分支对齐：
  // 连续两轮文本一致才视为终态（防流式中间态被当终态→错答）
  {
    const { window, ns } = loadAt('https://chat.deepseek.com/');
    const list = makeChat(window, 2, '我是历史最后一条');
    ns.__setDsLastReplyBefore('我是历史最后一条');
    const it = window.document.createElement('div');
    it.setAttribute('role', 'listitem');
    it.textContent = '答案：C';
    list.appendChild(it);   // 节点数 → 3
    const r1 = ns._dsLatestReply(2);
    assert('B常规新节点: 首轮进入稳定性等待', r1 === '__GENERATING__');
    const r2 = ns._dsLatestReply(2);
    assert('B常规新节点: length 增加且两轮一致→返回新节点文本', r2 === '答案：C');
  }

  // 场景4：发送前快照为空（首问），流式追加到唯一节点 → 仍识别为新回复
  {
    const { window, ns } = loadAt('https://chat.deepseek.com/');
    const list = makeChat(window, 1, '');
    ns.__setDsLastReplyBefore('');   // 发送前无回复
    list.lastChild.textContent = '答案：A';   // 流式写入同一节点
    const r1 = ns._dsLatestReply(1);
    assert('B首问流式: 首轮进入稳定性等待', r1 === '__GENERATING__');
    const r2 = ns._dsLatestReply(1);
    assert('B首问流式: 两轮一致→识别为新回复', r2 === '答案：A');
    // _dsLatestReplyTextOnly 仅取末条文本，不判生成态
    assert('辅助: _dsLatestReplyTextOnly 取末条', ns._dsLatestReplyTextOnly() === '答案：A');
  }

  console.log(fail === 0 ? '结论: PASS — DeepSeek 流式复用节点兜底闭环' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
