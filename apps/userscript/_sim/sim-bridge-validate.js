// sim-bridge-validate.js — 回归：M1 脚本侧桥清单校验。合法 playlist 通过；结构异常 / 跨域 URL 注入被拒。
// 复跑：node scripts/run-sim.js ；或随 `npm run test:sim` 一并执行。
// 说明：本文件为 jsdom 仿真用例，不在 Playwright 真机用例清单（smoke-pw/sim-iframe-pw/sim-bridge-noise-pw）内。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  process.exit(0);
}

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

// 加载产物并取出桥校验器
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  runScripts: 'outside-only', url: 'https://mooc1.chaoxing.com/', pretendToBeVisual: true,
});
const { window } = dom;
vm.runInContext(artifact, dom.getInternalVMContext(), { filename: 'artifact.user.js' });
const V = window.__CX_FORCE_PLAY.toolkit.bridge.validateBridgePlaylist;

// 合法 playlist（与 cx_crawler 产出结构一致）
const good = {
  chapters: [
    { knowledgeId: '123456', title: '第1章', completed: false, unfinishedCount: 2, objectids: ['a1', 'b2'], objectId: 'x', courseid: '99', clazzid: '88', cpi: '7' },
    { knowledgeId: '999', title: null, completed: true, unfinishedCount: 0 },
  ],
};
assert('[bridge] 合法 playlist 通过校验', V(good) === good);

// 非法：knowledgeId 非数字
assert('[bridge] knowledgeId 非数字被拒', V({ chapters: [{ knowledgeId: 'abc' }] }) === null);

// 非法：chapters 缺失
assert('[bridge] 缺 chapters 被拒', V({}) === null);
assert('[bridge] chapters 非数组被拒', V({ chapters: 'x' }) === null);

// 非法：completed 类型错误
assert('[bridge] completed 非布尔被拒', V({ chapters: [{ knowledgeId: '1', completed: 'yes' }] }) === null);

// 非法：objectids 含非字符串/数字
assert('[bridge] objectids 含非法项被拒', V({ chapters: [{ knowledgeId: '1', objectids: [{}] }] }) === null);

// 非法：注入跨域跳转 URL（M1 核心：防伪造 playlist 驱动点击/跳转）
assert('[bridge] 注入跨域 URL 被拒', V({ chapters: [{ knowledgeId: '1', jumpUrl: 'http://evil.example.com/x' }] }) === null);

// 合法：超星域内 URL 放行（不过滤正常学习通链接）
assert('[bridge] 超星域内 URL 放行', V({ chapters: [{ knowledgeId: '1', url: 'https://mooc1.chaoxing.com/abc' }] }) !== null);

// 向后兼容：未知新增字段不阻断
assert('[bridge] 未知字段不阻断', V({ chapters: [{ knowledgeId: '1', newField: 123 }] }) !== null);

process.exit(fail ? 1 : 0);
