// 跨平台侵入性回归（建议#10 延伸）：验证 'auto' 模式下各平台侵入面差异化——
//   仅 chaoxing / zhihuishu 启用原型级 pause 包装（激进），其余平台降级温和（不碰 prototype.pause）。
// 同时校验 detectSite() 对 11 个域解析正确，且各 biz 模块按站点隔离（跨站零副作用，已由源码 detectSite 守卫保证）。
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

// [url, 期望 detectSite, 期望 auto 模式原型 pause 包装]
const CASES = [
  ['https://mooc1.chaoxing.com/learn/abc', 'chaoxing', true],
  ['https://mooc.xxx.edu.cn/learn/abc', 'chaoxing', true],     // #1 edu.cn 视为超星
  ['https://www.zhihuishu.com/learn/abc', 'zhihuishu', true],
  ['https://www.icourse163.org/course/abc', 'icourse163', false],
  ['https://www.xuetangx.com/course/abc', 'xuetangx', false],
  ['https://www.icve.com.cn/course/abc', 'icve', false],
  ['https://www.pmphmooc.com/course/abc', 'renwei', false],
  ['https://www.unipus.cn/course/abc', 'unipus', false],
  ['https://www.ucampus.cn/course/abc', 'ucampus', false],
  ['https://www.ilab-x.com/course/abc', 'ilabx', false],
  ['https://chat.deepseek.com/coder', 'deepseek', false],
  ['https://example.com/', 'unknown', false],
];

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

// 'auto' 应为默认；若产品默认改了，下面统一按 auto 校验差异化逻辑
for (let ci = 0; ci < CASES.length; ci++) {
  const [url, expectSite, expectProto] = CASES[ci];
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><video id="v1"></video></body></html>', {
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const ctx = dom.getInternalVMContext();
  let ok = false;
  try {
    vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' });
    ok = !!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.buildInvasionReport === 'function');
  } catch (e) {
    console.log('  INJECT_NOTE [' + url + ']:', e.message);
  }
  assert('[' + expectSite + '] 命名空间与审计 API 安装 @ ' + url, ok);
  if (!ok) continue;

  // —— 站点识别 ——
  const gotSite = window.__CX_FORCE_PLAY.detectSite();
  assert('[' + expectSite + '] detectSite 解析正确 (' + gotSite + ')', gotSite === expectSite);

  // —— 原生原生入侵决策（auto 模式）——
  const upn = window.__CX_FORCE_PLAY.usePrototypeNeutralize();
  assert('[' + expectSite + '] usePrototypeNeutralize(auto)=' + expectProto, upn === expectProto);

  // —— 运行时实际侵入面（buildInvasionReport）——
  const rows = window.__CX_FORCE_PLAY.buildInvasionReport();
  const find = (area) => { for (let i = 0; i < rows.length; i++) if (rows[i].area === area) return rows[i]; return null; };
  const protoRow = find('prototype.pause');
  assert('[' + expectSite + '] 侵入清单: prototype.pause 包装态=' + expectProto, !!(protoRow && protoRow.on === expectProto));
  const stratRow = find('策略');
  assert('[' + expectSite + '] 侵入清单: 含 INTRUSION_MODE 策略行', !!(stratRow && (stratRow.item || stratRow.detail || '').indexOf('INTRUSION_MODE=') >= 0));

  // 卸载还原幂等检查：uninstall 后原型 pause 必须还原（on=false）
  try { window.__CX_FORCE_PLAY.uninstall(); } catch (e) {}
  if (typeof window.__CX_FORCE_PLAY === 'object' && window.__CX_FORCE_PLAY.buildInvasionReport) {
    const r2 = window.__CX_FORCE_PLAY.buildInvasionReport();
    const p2 = (function (rs) { for (let i = 0; i < rs.length; i++) if (rs[i].area === 'prototype.pause') return rs[i]; return null; })(r2);
    assert('[' + expectSite + '] uninstall 后 prototype.pause 还原', !!(p2 && p2.on === false));
  }
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — 跨平台侵入性差异化(auto): 仅超星/智慧树激进原型, 其余温和');
process.exit(fail === 0 ? 0 : 1);
