const projectPaths = require('./project-paths.cjs');
const fs = require('fs');
const s = fs.readFileSync(projectPaths.latestBundle, 'utf8');
const checks = [
  ['@version 4.19.13', /^\/\/ @version\s+4\.19\.13$/m.test(s)],
  ['label 完全失败', s.indexOf("fail: '完全失败'") > -1],
  ['label 暂时受阻', s.indexOf("blocked: '暂时受阻'") > -1],
  ['label 特殊情况', s.indexOf("special: '特殊情况'") > -1],
  ['label 信息缺失', s.indexOf("missing: '信息缺失'") > -1],
  ['color blocked purple', s.indexOf("blocked: '#a855f7'") > -1],
  ['color special blue', s.indexOf("special: '#3b82f6'") > -1],
  ['color missing orange', s.indexOf("missing: '#f97316'") > -1],
  ['tooltip 七色', s.indexOf('红=完全失败 · 绿=已完成 · 黄=作答中/待确认/待复核 · 紫=暂时受阻 · 蓝=特殊情况 · 橙=信息缺失 · 黑=未进行') > -1],
  ['diag 紫/蓝/橙计数', s.indexOf('紫') > -1 && s.indexOf('蓝') > -1 && s.indexOf('橙') > -1 && s.indexOf('_la.blocked') > -1],
  ['state missing 推导', s.indexOf("_quizInfoMissing[fp] && !_quizHandled[fp]") > -1],
  ['state blocked 推导', s.indexOf("_quizDsGraceUntil && Date.now() < _quizDsGraceUntil") > -1],
  ['state special 推导', s.indexOf("_quizManualHold && !_quizHandled[fp]") > -1],
];
let ok = true;
for (const [n, c] of checks) { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) ok = false; }
console.log(ok ? '\nROOT 产物含七态七色修复' : '\nROOT 产物缺失项');
process.exit(ok ? 0 : 1);
