// 回归：DeepSeek 回复解析（_dsParseAnswer）——v4.19.7 实测「答案是D」等句式旧规则解析失败 → 全题红灯
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
win.eval(code);
const ns = win.__CX_FORCE_PLAY;

let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}
const p = (t) => ns._dsParseAnswer(t);
const CASES = [
  ['裸字母 D', 'D', 'D'],
  ['答案是D（v4.19.7 实测失败句式）', '答案是D', 'D'],
  ['答案：C', '答案：C', 'C'],
  ['我认为选D', '我认为选D', 'D'],
  ['应该选B', '应该选B', 'B'],
  ['选A，B不对（答案仍是A，B被否定）', '选A，B不对', 'A'],
  ['多选 AB', 'AB', 'AB'],
  ['多选 A、B', 'A、B', 'AB'],
  ['多选 ABCD（v4.19.16 修复·纯选项字母不被散文误判丢弃）', 'ABCD', 'ABCD'],
  ['多选 ABC（5 选项题）', 'ABC', 'ABC'],
  ['判断题 正确', '正确', '正确'],
  ['判断题 错误', '错误', '错误'],
  ['数字下标 2)', '2)', '2'],
  ['D选项（单字母兜底）', 'D选项', 'D'],
  ['空回复', '', null],
  // v4.19.19：用户实测 DeepSeek 仍输出冗杂内容（解释/前缀）而非纯选项 → 解析须从冗杂文本中取对字母
  ['长篇解析后给答案（「根据…应选 A」）', '根据题目分析，题干强调…综上所述应选 A。', 'A'],
  ['解释+末尾字母（「选B，因为…」）', '这道题的考点是…，所以选B，因为其他选项都不对。', 'B'],
  ['答案句在中段（「答案为 C，理由如下」）', '答案为 C，理由如下：首先…', 'C'],
  ['多选带解释（「正确选项为 ABD」）', '正确选项为 A、B、D，解析：…', 'ABD'],
  ['前缀+孤字母（「答案：A」）', '答案：A', 'A'],
  ['整段推理仅末字母（「因此选择 D」）', '逐步推理：①…②…因此选择 D', 'D'],
  // v4.19.26 对齐 4.19.25 提示词规格：输出恒为大写字母、引号/括号包裹可解析、小写归一
  ['小写 a 归一为大写 A', 'a', 'A'],
  ['小写答案 d（"答案是d"）', '答案是d', 'D'],
  ['引号包裹「A」', '「A」', 'A'],
  ['英文引号 "B"', '"B"', 'B'],
  ['括号包裹 (C)', '(C)', 'C'],
  ['多选小写 ab 归一 AB', 'ab', 'AB'],
  ['多选带解释小写（"正确为 a、b、d"）', '正确为 a、b、d', 'ABD'],
  ['判断题长文仅末字母（"因此选 A"）', '综合判断，本题应选 A', 'A'],
  // v4.19.31：提示词重写（题型判断+few-shot+已还原文本为主依据）后，验证解析器仍能从新格式回复取对
  ['多选题仅1个正确→单字母（提示词"可能只有1个"）', '经分析只有 A 正确', 'A'],
  ['判断题回字母（提示词"务必输出字母不要中文"）', '本题应选 B', 'B'],
  ['带推理前缀的单选（"综上，答案 A"）', '逐步分析各选项，综上，答案 A', 'A'],
  // ---- v4.19.49：用户实测「B｜置信：高 + 长思维链」整题解析失败（answer=null）修复 ----
  ['置信结构·长文前导（真实失败样 B｜置信：高 + 长分析，含并非/不是）', 'B｜置信：高在《西游记》中，孙悟空是一个复杂而光辉的英雄形象，小说整体对其持肯定和赞扬态度。虽然某些情节或旁白中偶有戏谑或贬义词汇（如“妖猴”），但这并非主流，更不是“贬义、贬刺”。', 'B'],
  ['置信结构·答案在前（A｜置信：高）', 'A｜置信：高', 'A'],
  ['置信结构·答案在后（置信：高 → C）', '经分析此题应选 C，置信：高', 'C'],
  ['置信结构·半角（答案 D|置信：高）', '答案 D|置信：高', 'D'],
  ['纯思维链长文无字母 → 不再误判「正确」（旧版 /是/ 全命中）', '好的，用户这次发来了一道《西游记》相关的单选题。题目问的是孙悟空被谁所擒，然后被太上老君带到兜率宫冶炼。孙悟空大闹天宫时，天庭派了二郎神前去捉拿。在太上老君用金刚琢暗中相助后，孙悟空被二郎神和他的兄弟们擒获。之后，孙悟空才被押送到太上老君的兜率', null],
  ['判断·纯词"正确"仍可解析', '正确', '正确'],
  ['判断·纯词"错误"仍可解析', '错误', '错误'],
  ['判断·短句"本题正确"', '本题正确', '正确'],
  ['判断·短句"说法不正确"', '说法不正确', '错误'],
  ['判断·带字母不落语义（选A是不对的 → 宁可不答）', '选A是不对的', null],
];
for (const [name, input, expect] of CASES) {
  const got = p(input);
  assert(name, got === expect, got);
}
// v4.19.32·置信度抽取 _dsReadConfidence：从回复文本推断确定性（显式格式 + 隐式犹豫词 + 自相矛盾）
const rc = (t) => ns._dsReadConfidence(t);
const CONF_CASES = [
  ['显式｜置信：高', '答案：C｜置信：高', 'high'],
  ['显式｜置信：中', '答案：AB｜置信：中', 'mid'],
  ['显式｜置信：低', '答案：A｜置信：低', 'low'],
  ['无信号默认 high', '答案：D', 'high'],
  ['单犹豫词→mid', '可能是 B', 'mid'],
  ['双犹豫词→low', '大概可能是 A 但不确定', 'low'],
  ['自相矛盾→low', '我选 C，但仔细看其实 C 不对', 'low'],
  ['带反思核对句式仍 high', '经核对 B 正确。答案：B｜置信：高', 'high'],
];
for (const [name, input, expect] of CONF_CASES) {
  const got = rc(input);
  assert('置信·' + name, got === expect, got);
}
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
dom.window.close();
process.exit(fail ? 1 : 0);
