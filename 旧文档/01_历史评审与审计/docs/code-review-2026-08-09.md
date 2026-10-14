# 工作区全量代码审查报告

审查日期：2026-08-09　|　审查对象：`c:\Users\24033_1dhcyji\CodeBuddy\20260723173246`
主体代码：`ecosystem/src/chaoxing-force-play/`（55 个源文件，构建为 8107 行单文件 UserScript 产物）

## 一、审查方法与可信度说明

本报告不是"泛读印象"，每条结论都经过下列至少一种方式验证：

1. **分域人工通读**：foundation/engine、dom/bootstrap、sites、presentation/plugins、外围脚本五个域逐文件阅读；
2. **客观静态扫描**：用仓库自带 ESLint 8.57.1 对**拼接产物**（而非单个源文件）执行 `no-undef / no-redeclare / no-unreachable / require-atomic-updates` 等规则——因为该项目所有源文件最终被 `build-force-play.ps1` 拼进同一个 IIFE，只有对产物扫描才是真实作用域；
3. **实际运行验证**：跑通 `sim-uninstall / sim-zh-exam / sim-popup-block / sim-targeting / verify_fixes`，确认现有回归全绿，并据此定位测试盲区；
4. **产物语法校验**：`node --check` 通过。

> 说明：审查过程中我在 `ecosystem/_audit.eslintrc.json` 建了一份"面向产物"的 lint 配置（见 L4 建议，可保留作为质量门禁）。

---

## 二、严重问题（必须修复）

### S1　`_attachEventBus` 未定义 —— 三处 ReferenceError，直接击穿"定向白名单"与"卸载还原"

**位置**
- `takeover/engine/targeting.js:61`、`targeting.js:63`
- `takeover/dom/lifecycle.js:75`

```javascript
// targeting.js:51 / 57 —— 容器变量实际叫 _attachStore
var _attachStore = null;
_attachStore = { value: siteAttachments() };
// targeting.js:58-65 —— 却在 accessor 里访问了另一个从未定义的名字
Object.defineProperty(window, siteAttachmentsKey(), {
  get: function () { return _attachEventBus.value; },        // ← 61 行
  set: function (v) { _attachEventBus.value = v;             // ← 63 行
```

```javascript
// lifecycle.js:74-75 —— 先 delete，再用未定义变量还原
try { delete window[_ak]; } catch (e) { swallow(e); }
try { Object.defineProperty(window, _ak, { ..., value: _attachStore ? _attachEventBus.value : undefined }); } catch (e) { swallow(e); }
```

**证据**：全仓库 grep `_attachEventBus` 只有这 3 处，**没有任何定义**；ESLint 对产物扫描在 1572 / 1574 / 5498 行报 `'_attachEventBus' is not defined (no-undef)`。这明显是一次改名重构做了一半（`_attachEventBus` → `_attachStore`）遗留的残迹。

**具体表现与后果**（三重，均为静默失败）：
1. `defineProperty` 本身在 `try` 内成功执行，但 **getter/setter 的抛错发生在 try 之外**——此后宿主页面（超星自己的业务脚本）每一次读取 `window.attachments` 都会抛 `ReferenceError`，等于本脚本把平台页面的全局变量改成了一颗地雷，可能连带打断平台自身的章节渲染逻辑；
2. setter 抛错 ⇒ 第 64 行 `refreshTargets()` 永远执行不到 ⇒ 该模块注释里承诺的"页面一旦 assign attachments 立即重建白名单，不等 2s 轮询"完全失效，定向长期退化为全量扫描（性能与误触广告视频的风险同时回归）；
3. 卸载路径：`lifecycle.js:74` 的 `delete` 成功、`:75` 的还原抛错并被 `swallow` 吞掉 ⇒ **平台的 `window.attachments` 被永久删除且不还原**，与该文件 43-52 行"十一项还原清单、保证回到注入前状态"的承诺直接矛盾。

**修复建议**（3 行改动）：
```javascript
get: function () { return _attachStore ? _attachStore.value : undefined; },
set: function (v) { if (!_attachStore) _attachStore = { value: undefined }; _attachStore.value = v; ... }
// lifecycle.js:75
value: _attachStore ? _attachStore.value : undefined
```
并补一条回归：在 jsdom 里 `window.attachments = [...]` 后断言 `window.attachments` 可读、`refreshTargets` 被触发、`uninstall()` 后属性值还原。

---

### S2　测试与 lint 双双失守，导致 S1 这类致命缺陷零成本穿透

**表现**
- `_sim/` 下 38 个回归全部 PASS（`sim-uninstall` 自称 "卸载对称 60 断言"），却没有任何一个用例给 `window.attachments` **赋值**。`sim-targeting.js` 只测了 `collectAttachmentIds` / `keyRe` 两个纯函数，加上一条 "加载 user.js 无致命错误"——而 S1 的错误恰恰只在**属性被访问时**才抛，加载期不抛。
- `ecosystem/.eslintrc.json` 把 `no-undef` 设为 error，但对 `src/` 逐文件扫描时，跨文件共享的函数全被判为未定义：实测 **1601 个问题**。信噪比过低 ⇒ lint 事实上从未被执行 ⇒ 本可被 `no-undef` 一秒抓到的 S1 潜伏至今。

**后果**：质量门禁形同虚设，"全绿"给出虚假安全感。
**建议**：见 L4；并把"卸载后宿主全局状态快照对比"做成通用断言，覆盖十一项还原清单的每一项（当前只覆盖了 pause/rate/命名空间）。

---

## 三、中等问题

### M1　`toast` 函数在同一作用域重复声明，前者整段成为死代码
- `takeover/foundation/utils/utils.js:218` `function toast(msg, ms)`（自建浮层 div，第二参是**毫秒**）
- `presentation/toast.js:20` `function toast(msg, level)`（第二参是**级别**）

两者同处一个 IIFE，产物中 5386 行的 `toast.js` 版本后声明**覆盖**前者（ESLint `no-redeclare` 命中）。
**后果**：utils.js 213-234 行连同其 JSDoc `@param {number} [ms]` 全部是死代码，读代码的人会被误导；更隐蔽的是若有调用方按旧签名传 `toast(msg, 2200)`，会走到 `if (!_FLOAT_LEVELS[2200]) return;` 被静默丢弃——提示"神秘消失"且无任何日志。
**建议**：删除 utils.js 的实现，只保留 `toast.js` 一份；`toolkit.toast` 改为透传，并在注释中明确"第二参是 level 不是 ms"。

### M2　工具库契约名不一致，共享实现从未被复用
`plugins/addons/auto-next.js:67`：
```javascript
if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.toast === 'function') window.__CX_FORCE_PLAY.toast(msg);
```
但 `utils.js:284` 导出的是 `window.__CX_FORCE_PLAY.toolkit.toast`，**`__CX_FORCE_PLAY.toast` 全仓无任何赋值**。
**后果**：该判断恒假，插件永远走本地降级实现，"优先复用共享 toolkit、核心未注入时回退"的设计在 toast 上未生效；同类"命名空间属性契约"不受 lint 保护，属于同一风险家族（S1 是变量层面，M2 是属性层面）。
**建议**：统一挂载点（推荐 `__CX_FORCE_PLAY.toolkit.*` 单一入口），并在 `_sim` 加一条契约测试，遍历插件引用的命名空间属性断言其存在。

### M3　随机兜底被上报为"视觉识别成功"，可观测性失真
`takeover/engine/quiz.js:284,287`：
```javascript
if (!(useIdx != null && useIdx >= 0 && useIdx < opts.length)) useIdx = Math.floor(Math.random() * opts.length);
...
EventBus.emit('ui:toast', '已视觉识别作答 1 题' + (useIdx != null ? '' : '（随机兜底）'));
```
284 行已无条件赋值，287 行的 `useIdx != null` **恒为真**，"（随机兜底）"分支永不出现（`no-unreachable` 类逻辑死枝）。
**后果**：用户在面板看到"已视觉识别作答"，实际可能是掷骰子作答，无法区分——直接违背该模块"运行状态可观测"的设计目标（见 quiz.js:297 注释）。
**建议**：在 284 行前用独立布尔 `var fellBack = false;` 记录兜底，提示文案与统计分开计数。

### M4　智慧树自动交卷：非末页判定漏传 `handled`，翻页可能永久卡住
`sites/zhihuishu-exam.js:286` vs `:290` / `:326`：
```javascript
if (_allAnsweredHere(c)) { if (_goNextPage(c)) handled = {}; }   // 286：漏传 handled
if (_allAnsweredHere(c, handled)) asubTransition(ASUB_READY);    // 290：传了
allAnswered: _allAnsweredHere(c, handled),                        // 326：传了
```
**后果**：非末页时"已作答指纹"不计入判定，只能靠 DOM 的 `:checked`/class 兜底；对于用 div 模拟选项（`_zheSelect` 点击非 input 的场景）会判定为"未答完"⇒ 永不翻页 ⇒ 自动交卷停在 ANSWERING 态，用户看到"进行中"但毫无进展。
**建议**：286 行补 `handled` 实参；`_allAnsweredHere` 把第二参设为必填或给默认值，避免同一函数三种调用姿势。

### M5　交卷成功路径不复位 `submitting`，且"点击成功"被当作"交卷成功"
`sites/zhihuishu-exam.js:300-315`：`submitting = true` 后，只有 302/310 两条失败路径复位；`b.click()` 成功后直接 `asubTransition(ASUB_DONE)` 且 `submitting` 保持 `true`。
**后果**：① `getState().submitting` 永久为 true，面板/FAB 永远显示"提交中"；② 平台交卷普遍带二次确认弹窗，用户若点"取消"，状态已是 DONE + 锁死，**只能刷新页面才能再次交卷**。
**建议**：`click()` 后进入 `SUBMITTING` 中间态，用 URL 变化 / 结果页特征选择器确认真正提交完成再转 DONE，超时（如 10s）回落 READY 并释放锁。

### M6　弹窗答题：指纹先记后做 + 集合无上限 + 选择器过宽
`sites/popup-quiz.js:78-79`：
```javascript
if (_pqHandled[fp]) return false;
_pqHandled[fp] = true;   // ← 在真正作答/关闭之前就标记为已处理
```
**后果**：中途任一步抛错（选项未渲染完、按钮被遮挡），该弹窗被永久拉黑不再重试，退化为"看得见但不处理"。
同时 `_pqHandled` 是只增不减的普通对象，长时间挂机页面会持续增长（内存与查找成本）；`popup-quiz.js:9` 与 `zhihuishu.js:11`、`xuetangx.js:6`、`icve.js:6`、`icourse163.js:6` 的 `dialogSels` 都含 `[class*="question"] / [class*="topic"] / [class*="answer"] / [class*="popup"]` 这类超宽匹配。
**后果**：极易命中页面常规容器（如课程目录里带 `question` 类名的普通 div）并被 `_pqDismiss` **直接 DOM 移除**，属于"误伤宿主页面"级别的风险；面板弹窗计数也会虚高。
**建议**：① 处理成功后再写指纹，失败走带上限的重试计数；② `_pqHandled` 改 `Map` + LRU 上限（如 500）或按页面路由清空；③ 宽选择器加"可见性 + 尺寸 + 含选项元素"三重确认，或降级为仅统计不移除。

### M7　MutationObserver 把 2s 主循环放大到最快 300ms 一次全量扫描
`takeover/engine/quiz.js:143-147` 防抖 300ms → `_quizMOTick` → `window.__CX_FORCE_PLAY.quizObserveDispatch`，而 `bootstrap/main-loop.js:87` 把该 dispatch 指向 `_loopTick`（整个主循环，含全文档 + 同源 iframe 下钻扫描）。
**后果**：视频播放器进度条 DOM 每秒高频变更 ⇒ 观察者持续触发 ⇒ 全量 tick 从 `RESCAN_INTERVAL`(2s) 被放大约 6.7 倍，长时间挂机页面 CPU 占用与掉帧明显。
**建议**：让 MO 只驱动**轻量的答题扫描**（`quizTick`），不要驱动整个 `_loopTick`；防抖提到 1s 并加"距上次全量 tick < N ms 则跳过"的节流闸门；`observe` 的 root 尽量收敛到题目容器而非 `document.body`。

### M8　监听器收支严重失衡，卸载语义打折
产物统计：`addEventListener` **93 处** vs `removeEventListener` **14 处**；`cleanupListeners`（lifecycle.js:56 起）只显式摘除 keydown / visibilitychange / play 等少数几类，面板与各插件绑定的大量 UI 事件依赖"整棵 DOM 被移除"间接回收。
**后果**：面板重建（`ensurePanel` 多次调用）时存在重复绑定风险；`uninstall` 后仍可能有闭包持有 DOM 引用，SPA 式页面长期不刷新会累积泄漏。
**建议**：统一走一个 `on(el, type, fn, opts)` 注册表，登记到数组，`cleanupListeners` 一次性反注册；面板绑定改为"事件委托到面板根节点"，把 93 处收敛到个位数。

### M9　错误吞没规模过大：719 个 try / 446 次 `swallow` / 163 个空 catch
**后果**：脚本"永不崩溃"的表象下，S1 这种致命错误被完全掩盖（卸载还原失败就是被 `swallow` 吃掉的）；线上问题只能靠用户描述复现。
**建议**：`swallow` 增加分级——可预期失败（DOM 尚未渲染）走 debug 级；不可预期失败（`ReferenceError`/`TypeError`）必须计数并在诊断页红字暴露；空 `catch (e) {}` 全部替换为 `swallow(e, '上下文标签')`，标签已在 `utils.js:207` 有先例。

---

## 四、轻微问题

| 编号 | 位置 | 问题 | 建议 |
|---|---|---|---|
| L1 | `presentation/dashboard.js:79,91`（`var bridge`）、`panel-controls.js:110`（`_pb`）、产物 7542（`_videoByArg` 内 `var v`） | 同一函数作用域内 `var` 重复声明（`no-redeclare`），虽合法但是复制粘贴痕迹，易误读为两个变量 | 改 `let`/复用同一变量，或开启 `no-redeclare` 门禁 |
| L2 | 产物 2832 `while (_sib = _sib.nextElementSibling)` | 赋值当条件（`no-cond-assign`），阅读者易误判为 `==` | 加显式括号 `while ((_sib = ...))` |
| L3 | 全仓 `localStorage.` 直接访问 **91 处**，`cx_*` 键 20+ 个 | 真值语义三套并存：`=== '1'`（cx_popup_block/cx_quiz_cdn）、`!== '0'`（cx_quiz_offline/cx_quiz_auto）、`=== '0'`（cx_popup_quiz），默认值散落在各读取点；`storage.js` 与 `toolkit.lsFlag` 抽象存在却未被统一使用 | 建一张 `SETTINGS = { key: {default, parse} }` 表，读写只经 `getFlag/setFlag`，UI 与逻辑共用同一事实源 |
| L4 | `ecosystem/.eslintrc.json` | 对 `src/` 逐文件跑 `no-undef` 产生 1601 条误报，门禁不可用 | 改为对产物 lint（可直接复用本次生成的 `_audit.eslintrc.json`），或在 `.eslintrc` 用 `globals` 声明跨文件符号；接入 `npm run lint` 与提交钩子 |
| L5 | `_sim/verify_patch.js` | 只做字符串包含检查的伪测试，且用相对路径 `'chaoxing-force-play.user.js'`，从 `_sim/` 目录运行必然 ENOENT | 删除或改为基于 `__dirname` 的真实行为断言 |
| L6 | 根 `package.json` 仅 `test:dom` 一条脚本 | 38 个 `sim-*.js` 无统一入口，只能手工逐个 `node` 执行；`_sim/package.json` 无 scripts，且 jsdom 版本与根不一致（^29 vs ^30，两套 node_modules） | 加 `npm test` 批量跑全部 sim 并以非零退出码失败；统一 jsdom 版本与依赖树 |
| L7 | 根 `_check_dom.js`、`ecosystem/_extract_css.js`、`ui-verify.html` | 一次性排查脚本长期滞留仓库根，与正式代码混放 | 收进 `tools/` 或删除 |
| L8 | `sites/*.js` 站点模块（15~28 行的配置表） | 结构雷同但体量很小，属于合理的"配置即代码" | 无需抽象；唯一要治理的是 M6 提到的宽选择器重复 |

---

## 五、值得肯定的工程实践

- **幂等守卫**（`bootstrap/core.js:8`）与错误监听注册顺序处理得当，注释明确解释了"为何必须放在守卫之后"；
- **卸载还原十一项清单**（`lifecycle.js:45-52`）思路完整，`restorePrototypePause/Rate` 复用单一还原原语避免双份漂移，`mediaSession` 还原原始 handler 而非置空——这类细节远超同类脚本平均水平（可惜第 ③ 项被 S1 打穿）；
- **EventBus 解耦**：`toast` 迁移到 UI 域实现零调用点改动，注释里写明了调用契约；
- **XSS 防护**：`dashboard.js` 动态视频列表走 `escapeHTML`，`utils.js:242` 提供 `h()` DOM 构建助手替代 innerHTML 拼接，方向正确；
- **敏感数据治理**：`.gitignore` 已覆盖 `cookies.json`/`__pycache__`，git 跟踪清单中无凭据文件；Python 侧 `requests` 均设置了 `timeout`；
- **回归资产可观**：38 个 jsdom 沙箱用例、构建脚本单一事实源、产物 `node --check` 通过。

---

## 六、整体评价

### 功能完整性：★★★★☆
覆盖 10+ 平台的强制续播、随堂弹窗、作业/考试助手、DeepSeek 应答端、诊断面板与工具库插件，主链路完整且有面板可观测。扣分项：**S1 使"定向白名单"这一核心优化实际长期未生效**；M4/M5 让智慧树自动交卷在特定路径上会卡死；大量选择器仍是 `best-effort` 待真机校准（产物中 17 处 `best-effort/待校准` 标记），属于已知的"功能上限受平台 DOM 漂移限制"。

### 健壮性：★★☆☆☆
这是最薄弱的一环，且薄弱方式很有欺骗性——**代码到处是 try/catch，看起来非常稳，实则是"稳定地失败"**：719 个 try、446 次 swallow、163 个空 catch，把 S1 这种 `ReferenceError` 完整地藏了起来，连"卸载后把宿主页面全局变量删没了"这种严重副作用都无声无息。加上监听器 93 收 / 14 放的失衡与无上限的去重集合，长时挂机场景的资源曲线不可控。**建议把"错误必须分级、致命错误必须可见"作为下一阶段第一优先级。**

### 工程实践规范性：★★★☆☆
分层（foundation / engine / dom / sites / presentation / plugins）清晰，注释密度和"为什么这么写"的决策记录质量很高，构建脚本与产物同步（产物 18:03 晚于最新源码 17:45）。但三项关键工程约束缺位：**lint 配置与构建模型不匹配导致门禁失效（1601 条误报）、测试无统一入口且断言集中在纯函数与快乐路径、跨模块契约（命名空间属性、函数签名、localStorage 键语义）全靠约定无任何静态或运行时校验**——S1、M1、M2、M4 四个问题本质上都是同一个根因：**在"一个巨大 IIFE + 全靠约定"的架构下，重构缺少机械化的校验网**。

### 修复优先级
1. **立即**：S1（3 行改动，风险最高收益最大）→ 补 attachments 赋值/卸载还原回归（S2）
2. **本周**：M4、M5（智慧树交卷卡死）、M1/M2（契约与死代码）
3. **迭代**：M6、M7、M8、M9（健壮性与性能治理）
4. **背景任务**：L3 设置项统一、L4 lint 门禁、L6 测试入口
