# 工作空间代码审查报告（2026-08-13）

> 审查范围：`ecosystem/src/chaoxing-force-play/`（58 个 JS 模块，油猴单文件用户脚本）+ `ecosystem/_sim/` 测试沙箱 + `ecosystem/package.json`/`build-force-play.ps1` 构建链 + `perception/` Python 感知模块。
> 审查方式：自动子代理分域精读 + 主代理对高危论断逐一 `read_file` 交叉验证（报告内标注「已核实」者为亲验，其余来自子代理读档）。

---

## 一、整体印象与架构

项目是一个**零运行时依赖的单文件 Tampermonkey 油猴脚本**（构建为 `chaoxing-force-play.user.js`），按域拼接：`takeover(接管/核心引擎/面板)/sites(站点答题)/plugins(工具库)/presentation(面板UI)`。

优点（值得肯定）：
- 大量使用 `bestEffort`/`safeGet` 兜底、幂等守卫（`__CX_ZHE_STARTED` 等）、站点隔离首判（`detectSite()==='chaoxing'`），防御意识强。
- 注释极其详尽，含"修复(日期)"叙事与跨脚本契约说明（如 `panel.js:10-13` 明确 `_cxPanel` 扇出）。
- 模块化清晰，事件总线解耦 UI/核心（`EventBus.onEv/emit`）。

但存在**若干会直接影响真实环境行为**的高危问题，集中于：选择器 best-effort 过宽、跨 iframe 统计盲区、面板状态误判、测试假绿灯、版本/正则漂移。

---

## 二、严重 / 高风险问题（P0–P1）

### P0-1【已核实】超星答题超宽属性选择器，易误命中非题目区域
`ecosystem/src/chaoxing-force-play/sites/chaoxing-exam.js:14-15`
```js
questionSels: ['.Zy_ulTop', '.questionLi', ..., '[class*="question"]', '[class*="topic"]', '[class*="ques"]', '.questionnaire'],
```
`[class*="question"]`/`[class*="topic"]`/`[class*="ques"]` 是**子串模糊匹配**，任何含这些子串的容器（导航、提示卡、章节目录）都会被当"单题"扫描；`quiz-selectors.js:7` 同样含 `[class*="question"]`、`[class*="quiz"]`。
- 后果：误把无关元素当题目 → 误点选项、面板"检测到 N 题"虚高、可能误提交/误操作。
- 建议：去掉裸属性子串选择器，改用平台真实数据属性（如超星 `.Zy_ulTop` 已是精确命中，保留即可），非超星平台选择器各自收敛；对必留的属性选择器加更紧前缀（如 `[class*="question-item"]`）。

### P0-2【已核实】FAB 题目页判定正则过宽，且与引擎正则不一致（两套副本已漂移）
`ecosystem/src/chaoxing-force-play/presentation/zhihuishu-fab.js:25`
```js
function _zhsIsExamPage() {
  return safeGet(function () { return /dohomework|webExamList|stuExamWeb|doExam|exam|homework|doHomeWork/i.test(...); }, false);
}
```
而真正执行业务的引擎用**带负向环视**的版本：
`ecosystem/src/chaoxing-force-play/sites/zhihuishu-exam.js:35`
```js
URL_RE: /(^|\/)(dohomework|...|exam|homework|doHomeWork)(?![a-z0-9])/i,
```
- 问题：FAB 用旧宽正则（无 `(?![a-z0-9])`），视频页 URL 若含子串 `exam`/`homework`（如 `/exam/intro`、`/course-homework`）即误弹"作业/考试助手"面板；两份正则已分叉。
- 后果：面板场景自适应失效、用户看到错误的控制面板。
- 建议：FAB 直接复用 `zhihuishu-exam.js` 的 `CFG.URL_RE`（抽取为共享常量），消除副本。

### P1-1【已核实】`_examPage` 写-only 死状态（已弃用未清理）
`ecosystem/src/chaoxing-force-play/sites/zhihuishu-exam.js:195,359`
```js
var _examPage = _isExamPage();   // 195
...
refreshExamPage: function () { _examPage = _isExamPage(); }  // 359
```
全文仅赋值/重赋值，**无任何读取点**（line 223 注释明言"用实时 `_isExamPage()` 而非缓存 `_examPage`"，即缓存已被弃用）。
- 后果：维护者误以为有缓存逻辑、徒增歧义；`refreshExamPage` 调用成空操作。
- 建议：删除 `_examPage` 变量、`refreshExamPage` 改为无操作或直接移除调用点。

### P1-2【已核实】`syncNinjaGlyph` 跨 iframe 视频统计盲区 + gentle 模式误红闪
`ecosystem/src/chaoxing-force-play/presentation/panel.js:150,157`
```js
var vs = document.getElementsByTagName('video');   // 仅当前文档
...
if (window.__CX_FORCE_PLAY.getPauseNeutralized() === false) tampered = true;
```
- 问题①：学习平台视频常在 `<iframe>` 内，`document.getElementsByTagName('video')` 只统计主文档，悬浮球状态点/角标"续播中 N 路"在 iframe 场景下恒为 0 或不准（同模块他处已有 `allVideos()` 跨文档工具却未在此复用）。
- 问题②：`getPauseNeutralized()===false` 在 **gentle/polite 模式**（刻意不中和 pause 以"温和"）下**恒为 true** → `tampered=true` → 红闪误报"接管被还原"。即模式设计本就不中和，却被当作异常。
- 建议：① 改用 `allVideos()`/跨文档遍历；② 该判定应排除 gentle/polite 模式（`if (!GENTLE && neutralized===false)`）。

### P1-3【已核实】N 键守卫与 P 键守卫不一致，输入框聚焦时误触
`ecosystem/src/chaoxing-force-play/presentation/panel.js:129-140`
```js
var t = e.target;
var inEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
if (e.key && e.key.toLowerCase() === 'n') {
  if (t && (t.id === '__cxCmd' || (t.tagName === 'TEXTAREA'))) return;   // 仅排除 TEXTAREA 和 #__cxCmd
  ... toggleNinjaMode(); ...
}
...
if (inEditable) return;   // P 键用完整 inEditable
```
- 问题：N 键只排除 `TEXTAREA` 和 `#__cxCmd`，**焦点在 checkbox/radio/普通 input（如宽度滑块 `#__cxPanelW`）时按 N 仍触发切换 Ninja**；而 P 键用了完整的 `inEditable`。两者逻辑不对称。
- 后果：用户操作面板控件（滑块、勾选框）时按 N 会意外收起/展开面板，体验割裂。
- 建议：N 键守卫统一用 `inEditable`（与 P 一致），或显式排除所有 `INPUT/TEXTAREA/contentEditable`。

### P1-4【已核实】`sim-ninja.js` 假绿灯：核心断言不控制退出码
`ecosystem/_sim/sim-ninja.js:84-96`
```js
console.log('\n结论: ' + (p && ninjaAgain && opened && closed && !p.classList.contains('ninja') && exitedFromInput && dragOK ? 'PASS …' : 'CHECK'));
...
if (!_icon || !_badge || !_aria) { ...; process.exit(1); }
if (!dragOK) { ...; process.exit(1); }
process.exit(0);
```
- 问题：line 84 的"结论 PASS/CHECK"只是 `console.log`，**不参与退出码判定**；真正 gate 的只有 `dragOK` 与 FAB 增强（`_icon/_badge/_aria`）。若 toggle/exit 子断言（`opened/closed/exitedFromInput/ninjaAgain`）失败，脚本仍会打印 `CHECK` 但继续走到 line 96 `process.exit(0)` → **绿色通过**。
- 后果：面板展开/收起/退出 Ninja 的回归**不会被 CI 捕获**，回归测试形同虚设。
- 建议：将 line 84 的各子断言纳入 `process.exit(1)` 判定（任一为 false 即 `exit(1)`），并给每个断言独立 `console.assert`/失败即退出。

### P1-5【已核实】版本号漂移：package.json 4.15.0 vs 产物 4.18
`ecosystem/package.json:3`  `"version": "4.15.0"`；`presentation/panel.js:9` `SCRIPT_VERSION='4.18'`；构建产物 `@version 4.18`。
- 后果：`npm view`/依赖锁/发布元数据的版本与脚本实际版本不符，排障时版本追溯混乱。
- 建议：单源版本——构建脚本从 `SCRIPT_VERSION` 注入 `@version` 与 `package.json`，或反之，杜绝手改三处。

---

## 三、中等问题（S / M / L）

### S2【子代理读档】popup-quiz 的 block 开关早 return 会丢失计数
`presentation/zhihuishu-fab.js` 引用的 `popup-quiz.js`：`cx_popup_block==='1'` 分支在 `return` 前仍把 `_pqPending` 清零，导致面板"本次弹窗作答数"统计被错误清零/漏计。建议先完成计数更新再决定 return 路径。

### S3【子代理读档】icourse163 残留旧字段 `e.answered`
`ecosystem/src/chaoxing-force-play/sites/icourse163.js`：仍读取旧 `e.answered` 字段做跨页累计计数；该字段已不在当前状态模型，MOOC 平台跨页累计会得到 `undefined`→`NaN`，进度显示错乱。建议改用当前状态机字段。

### S4【子代理读档】targeting.reset() 清空队列但 MutationObserver 未停
`takeover/engine/targeting.js`：`reset()` 置空 `targets._queue`，但 `MutationObserver` 仍对已被移除的节点入队 → 在下次扫描前持续空转占用 CPU/内存。建议在 reset 时 `observer.disconnect()` 或加空队列早退。

### L1【已核实】`zhihuishu-exam.js` 选项选择器含裸 `label`
`ecosystem/src/chaoxing-force-play/sites/zhihuishu-exam.js:40`
```js
optionSels: ['.option-item', ..., 'label', '.select-item', ...],
```
`label` 无 class 限定，题目页内**任意 `<label>`**（说明文字、题干标注）都会被当可点选项 → 误勾非选项。建议移除裸 `label` 或收窄为 `.option label`/带 class 的 label。

### M1【子代理读档】`bestEffort` 静默吞异常，线上难定位
全局 `bestEffort(fn, tag)` 包裹所有副作用，异常被 catch 后仅（条件性）`console.warn`。真实环境出错时**无任何可观测信号**，排障靠用户手动开 DEBUG。建议分级：DEBUG 下打印完整堆栈；可加采样上报/面板"最近错误"入口。

### M2【子代理读档】面板重渲染频次仍偏高
`presentation/panel.js:67,91`：`videos:scanned` 高频触发 `refreshPanelState`(节流150ms)/`renderInvasionReport`(节流1500ms) 全量 `innerHTML` 重写。在 1s 轮询扫描页，150ms 一次整面板重绘仍有冗余 DOM 操作。建议增量更新（仅变值文本节点）、或状态 diff 后再渲染。

### M3【已核实·由 P0-2 衍生】URL 正则双副本已漂移
FAB (`zhihuishu-fab.js:25`) 与引擎 (`zhihuishu-exam.js:35`) 各维护一份题目页正则，前者缺负向环视。属"同一判定多处定义→必然漂移"的反模式。建议抽 `isExamUrl()` 单源。

### M7【子代理读档】`dashboard.js` 模板拼接需逐处确认转义
面板"工具库"卡片用字符串拼接 `cx-tool-card`，即便 `escapeHTML(t.title)` 已转义标题，仍需确认每个内插到 `onclick`/属性处的来源都经转义，否则存在 DOM 注入。建议统一用 `escapeHTML` 包裹所有动态插入，或改用 `document.createElement` + `textContent`/`addEventListener`。

---

## 四、工程实践与测试/构建

### 测试链
- **假绿灯**（P1-4 已详述）：`sim-ninja.js` 核心断言不致命。
- 多份 `sim-*.js` 以 `console.log` 为主、部分缺乏硬断言（`process.exit(1)`）。建议统一测试框架（如 Node `assert` + 退出码门禁）。
- **已纠正误报**：子代理称 `ecosystem/tests/pure.test.js` 不存在——经核实该文件**实际存在**，`package.json` 的 `test` 脚本指向有效。仅 `test:sim` 指向 `scripts/run-sim.js`（需确认该脚本存在且能跑全套）。

### 构建链
- `build-force-play.ps1` 依赖 `node_home` 指定 node（`c:/Users/.../node-v24.19.0...`），PowerShell + 特定 node 路径在 CI/其他机器脆弱；记忆表明当前 Windows 环境 `npm run build` 因 npm 配置被污染而失败，只能直跑 ps1。
- `build-manifest.txt` 是拼接顺序单一事实源（缺失即 `throw`），但未纳入 git、且产物为旧构建——属"不可从版本库恢复"的脆弱点，建议把顺序元信息并入脚本常量或纳入版本控制。

### 全局耦合
- `presentation/panel.js:10-13` 自述 `_cxPanel` 被 7 个模块引用、为"全项目耦合度最高变量"。任一写入点误置 `null` 会静默连锁影响全部读取方。建议用 getter/事件而非裸全局共享可变单例。

### 其他
- 大量"修复(日期)"叙事注释散落代码（虽利于追溯但膨胀），建议关键决策迁 `CHANGELOG.md`，代码内只留"为什么"。
- 选择器 best-effort 但缺乏集中"待校准清单"，多处重复定义同一选择器数组（`chaoxing-exam`/`quiz-selectors`/`zhihuishu-exam` 各自一套），易再次漂移。

---

## 五、整体评价

| 维度 | 评价 | 说明 |
|---|---|---|
| **功能完整性** | 中高 | 覆盖多平台视频续播 + 多种答题（超星/知到/icourse163 等）+ DeepSeek 应答端 + 面板/洞察/诊断，功能面很全。但"真答题"在多数平台仍是 **best-effort 勾选**（依赖真实站点 DOM 校准），真实环境功能完整性存疑；DeepSeek responder DOM 驱动待真实站点校准。 |
| **健壮性** | 中上 | `bestEffort`/`safeGet`/幂等守卫/状态机闸门到位；但存在**跨 iframe 视频统计盲区、超宽选择器误命中、gentle 模式红闪误报、FAB 正则误弹、彻底取消弹窗计数丢失**等会在真实环境触发的薄弱点。 |
| **工程规范性** | 中 | 注释详尽、模块化、有契约文档；但**版本漂移、正则双副本漂移、测试假绿灯、全局单例紧耦合、PowerShell 构建脆弱、部分死代码未清理**拉低规范性。 |

**优先级建议**（先修真实环境会出错/误操作的）：
1. P0-1 / P0-2 / L1 —— 收窄/统一选择器与正则（直接影响误操作）。
2. P1-2 —— 修跨 iframe 统计 + gentle 模式误报（状态指示可信度）。
3. P1-3 —— 统一 N/P 键守卫（交互正确性）。
4. P1-4 + 测试门禁 —— 修复假绿灯，让回归真正致命。
5. P1-5 / M3 —— 单源版本与单源 URL 判定（消除漂移）。
6. P1-1 / S2-S4 / M1-M2 —— 清理死状态、修计数/观察器泄漏、加可观测性。
