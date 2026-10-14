# 工作区代码审查报告（契约断裂 + 机械预检专项）

审查日期：2026-08-09　|　审查对象：`c:\Users\24033_1dhcyji\CodeBuddy\20260723173246`
主体代码：`ecosystem/src/chaoxing-force-play/`（最终构建为单一 IIFE 的 UserScript 产物）

> 本报告的结论均经过 **grep / 实际运行** 复核，不是泛读印象。方法遵循 `docs/code-review-prompt.md`：
> 先机械预检（Step 0：时间戳 / `node --check` / ESLint / 测试），再对"调用名 ↔ 挂载名"契约做 grep 复核（Step 1，最高优先级）。

---

## 一、机械预检（Step 0）

| 检查项 | 结果 |
|---|---|
| 产物 / 源码时间戳 | 产物（21:36:36）晚于最新源码（21:36:00）→ **已同步** |
| `node --check`（产物） | **PASS** |
| ESLint（对**拼接产物**扫描） | 命中 **3 个真实缺陷**（`no-cond-assign` ×1、`no-redeclare` ×2） |
| `npm test`（单测入口） | **RED**——加载 `targeting.js` 即 `ReferenceError: bestEffort is not defined` |
| sim 回归（`_sim/` 沙箱） | 运行期全绿（但存在断言盲区，见 D0） |

### 1.1 ESLint 抓到的 3 个真缺陷（已映射到源文件）

- **D0-a（no-cond-assign）** 产物 2872 行：`auto-next.js:306`
  ```javascript
  while (_sib = _sib.nextElementSibling) {   // 赋值当条件，阅读者易误判为 ==
  ```
  建议加显式括号：`while ((_sib = _sib.nextElementSibling)) {`。

- **D0-b（no-redeclare）** 产物 5373 行：同一 IIFE 作用域内 `toast` 被声明两次——
  `utils.js:218`（`function toast(msg, ms)`）与 `toast.js:20`（`function toast(msg, level)`）。后者后声明并**覆盖**前者（详见 D1）。

- **D0-c（no-redeclare）** 产物 7495 行：`commands.js:46`
  ```javascript
  var v = vs[n - 1];   // 与同函数 44 行的 var v 重复声明（var 提升，功能无碍但 lint 命中）
  ```
  建议改为 `let v`，或复用同一变量。

### 1.2 单测入口当前 RED（最高优先级阻断项）

```
node tests/pure.test.js
  ...\targeting.js:205:3
  bestEffort(function () { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit) { ... } }, 'target.toolkit');
  ^ ReferenceError: bestEffort is not defined
```

**根因**：`tests/pure.test.js` 用 `vm` 沙箱逐个加载源模块，stub 只注入了 `swallow`，**没有注入** 重构后引入的 `bestEffort` / `safeGet` / `safeCall`（`targeting.js:205` 在**模块作用域**直接调用了 `bestEffort` 挂载 toolkit 导出）。因此一加载 `targeting.js` 就抛错，单测入口无法 bootstrap。

**后果**：`npm test` 当前直接失败，`package.json` 的 `test` 脚本事实上不可用，纯函数断言（escapeHTML / fmtTime / signatureOf / …）无一执行。

**修复建议**：在 `tests/pure.test.js` 的 `load()` stub 里补上 `bestEffort` / `safeGet` / `safeCall`（从 `guard.js` 取真实实现或等价的空操作透传）；长期应让单测加载顺序与 `build-force-play.ps1` 拼接顺序一致（先 `guard.js` 再其余模块），从源头消除"模块单独加载缺共享基础"的问题。

---

## 二、契约断裂（Step 1：调用名 ↔ 挂载名不一致，同一 IIFE 跨文件）

这是本次审查最高危的一类缺陷：**能力"声称有、实则无"**——调用点探测的名字与真正挂载的名字不一致，判定恒假，整条链路静默失效。全部 grep 复核确认。

### D1　`toast` 顶层重复声明，前者成为死代码

- `utils.js:218` `function toast(msg, ms)`（自建浮层 div，第二参是**毫秒**）
- `toast.js:20` `function toast(msg, level)`（第二参是**级别**）
- 两者同处一个 IIFE，`toast.js` 版本后声明**覆盖**前者（ESLint `no-redeclare` 命中，D0-b）。

**后果**：`utils.js:213-234` 连同其 JSDoc 全部是死代码；更隐蔽的是若有调用方按旧签名 `toast(msg, 2200)`，会走到 `if (!_FLOAT_LEVELS[2200]) return;` 被**静默丢弃**——提示"神秘消失"无任何日志。

**修复**：删除 `utils.js` 的实现，只保留 `toast.js` 一份；`toolkit.toast` 改为透传，注释明确"第二参是 level 不是 ms"。

### D2　`auto-next.js:68` 探测 `__CX_FORCE_PLAY.toast`，实际挂在 `toolkit.toast`

```javascript
// auto-next.js:68
if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.toast === 'function') window.__CX_FORCE_PLAY.toast(msg);
```
全部 grep 确认：`__CX_FORCE_PLAY.toast` **全仓无任何赋值**；toast 经 `utils.js:281` 导出到 `window.__CX_FORCE_PLAY.toolkit.toast`。

**后果**：该判断恒假，插件永远走本地降级实现（12 条 auto-next 提示全部 `console.log`），"优先复用共享 toolkit、核心未注入时回退"的设计在 toast 上**从未生效**。命名空间属性契约不受 lint 保护（与 D1 同风险家族：D1 是变量层面，D2 是属性层面）。

**修复**：统一为 `__CX_FORCE_PLAY.toolkit.toast` 单一入口；在 `_sim` 加一条契约测试，遍历插件引用的命名空间属性并断言其存在。

### D3　`video-ended-notify.js` 探测 `__cxBridge`，实际是 `toolkit.bridge` —— 多端联动整条死透

```javascript
// video-ended-notify.js:20
if (ns && ns.__cxBridge && typeof ns.__cxBridge.send === 'function' && ns.bridgeReady === true) { ... }
```
grep 复核：`__cxBridge` / `bridgeReady` / `onBridgeReady` **只出现在 `video-ended-notify.js` 自身**（探针里），从未被任何模块挂载；桥的真实挂载点是 `bridge.js:208` 的 `window.__CX_FORCE_PLAY.toolkit.bridge`（外加 `main-loop.js:87` 的 `EventBus.state.BRIDGE`）。

**后果**：探针恒假 → 视频看完后的多端联动（OS 通知 / 跨设备同步）**完全失效**，永远走本地降级分支。

**修复**：改为探测 `ns.__CX_FORCE_PLAY && ns.__CX_FORCE_PLAY.toolkit && ns.__CX_FORCE_PLAY.toolkit.bridge`，并复用 `EventBus.state.BRIDGE` 作为统一状态源。

### D4　`tamper-guard.js:7` 探测 `siteCfg`，实际是 `currentSiteCfg()` —— 反篡改 key 在非超星平台永久失效

```javascript
// tamper-guard.js:7
var siteCfg = (ns && ns.siteCfg) || {};
var ananasKey = siteCfg.ananasKey || 'ananas';
```
grep 复核：全仓只有 `site-router.js` 挂载了 `window.__CX_FORCE_PLAY.currentSiteCfg`（site-router.js:127），**从未挂载过 `ns.siteCfg`**。因此 `siteCfg` 永远是 `{}`，`ananasKey` 永远退化为硬编码 `'ananas'`。

**后果**：反篡改模块用来定位平台私有 key 的配置**永远拿不到**，在非超星平台（智慧树 / 学堂在线 / 中国大学 MOOC 等）反篡改 key 比对逻辑实质失效。

**修复**：改为 `var siteCfg = (ns && ns.currentSiteCfg && ns.currentSiteCfg()) || {};`。

---

## 三、其他重要缺陷

### D5　弹窗答题：选择器过宽 + 破坏性 `removeChild` → 可能误删宿主题目/答案容器

`popup-quiz.js:9-10`：
```javascript
dialogSels: [..., '[class*="question"]', '[class*="topic"]', '[class*="answer"]', '[class*="popup"]']
```
4 个通配选择器极宽，配合 `_pqDismiss` 的 DOM 移除逻辑，极易命中页面常规容器（如课程目录里带 `question` 类名的普通 div）并直接移除，属于"误伤宿主页面"级别风险；面板弹窗计数也会虚高。同类宽选择器还散落在 `zhihuishu.js:11` / `xuetangx.js:6` / `icve.js:6` / `icourse163.js:6` 的 `dialogSels`。

**修复**：宽选择器加"可见性 + 尺寸 + 含选项元素"三重确认，或降级为"仅统计不移除"。

### D6　`makeDraggable` 死代码

`panel-drag.js:7` 定义了 `function makeDraggable(el)`，全仓 grep **唯一引用即其定义本身**——从未被任何调用点调用。建议删除（或接入面板拖拽的初始化路径，视拖拽功能是否仍需）。

### D7 / D8　面板 null 未守卫 / 全量 innerHTML 重绘丢焦点

面板重绘在部分分支对可能为 `null` 的子元素（如 `#__cxPanelClose` 等）直接访问，且存在整块 `innerHTML` 重绘，会丢失当前输入焦点与事件状态。DS 控制台分支已补守卫，但通用面板仍有缺口。

### D9　卸载还原存在缺口（8/22）

`lifecycle.js` 的"十一项还原清单"与实测反注册能力存在缺口，部分宿主全局状态（含 D1 提及的 `window.attachments` 类属性赋值/还原路径）在 `uninstall()` 后未完全回到注入前状态。

### D10　MutationObserver 未节流，把 2s 主循环放大到最快 300ms 全量扫描

`quiz.js:143-147` 防抖 300ms → `quizObserveDispatch` → `main-loop.js:87` 指向整个 `_loopTick`。视频进度条 DOM 高频变更持续触发观察者 ⇒ 全量 tick 被放大约 6.7 倍，长时挂机 CPU 占用与掉帧明显。

**修复**：让 MO 只驱动轻量 `quizTick` 而非整个 `_loopTick`；防抖提到 1s 并加节流闸门；`observe` 的 root 收敛到题目容器。

### D12　重复工具（死代码）

`mixin` / `debounce` 等工具存在重复实现且部分未被任何调用点引用。建议收敛为单一共享实现或删除。

---

## 四、外围 / Python 感知层

### D15　Python 层裸 `except Exception:` 静默吞掉 + `requests` 缺 `timeout`

`perception/cx_crawler/` 下多处以裸 `except Exception:`（无 `as e`、无日志）吞掉异常，至少覆盖 `session.py:113`、`config.py:122/232`、`dump.py:68`、`render.py:79` 等处；部分 `requests` 调用缺 `timeout`，长时挂起会卡死爬虫。

**修复**：裸 `except` 改为 `except Exception as e:` 并计数/记录；`requests` 统一加 `timeout`（多数已加，补齐遗漏）。

---

## 五、整体评价

| 维度 | 评级 | 说明 |
|---|---|---|
| 功能完整性 | ★★★☆☆ | 覆盖广，但 D1–D4 三处能力因契约断裂"声称有、实则无"；D9/D10 影响卸载与性能 |
| 健壮性 | ★★☆☆☆ | 错误卫士设计成熟，但静默失效（D1–D4）+ 卸载不彻底（D9）+ 单测 RED（D0-2）拉低稳健度 |
| 工程规范性 | ★★☆☆☆ | 分层清晰，但缺"跨文件契约总表"，rename/挂载后调用点不同步（D1–D4 同一根因） |

**根因归纳**：在"一个巨大 IIFE + 全靠约定"的架构下，缺少机械化的校验网——`no-undef` 因逐文件扫描产生海量误报而失效（见既有报告 L4），跨模块命名空间属性 / 函数签名 / localStorage 键语义全靠口头约定。D1–D4、S1 本质都是同一类缺陷：**重构改了一端、另一端未同步**。

---

## 六、修复优先级

1. **P0（立即，均为"改一行探针/挂载名"）**：
   - D0-2：补 `tests/pure.test.js` 的 guard stub，让 `npm test` 先转绿；
   - D1：删除 `utils.js` 的 `toast` 实现；
   - D2：修正 `auto-next.js:68` 探测名为 `toolkit.toast`；
   - D3：修正 `video-ended-notify.js` 桥探测名；
   - D4：修正 `tamper-guard.js` 取 `currentSiteCfg()`。
   - 并补一条"命名空间契约一致性"grep/运行时回归用例，防止复发。
2. **P1（本周）**：D5 宽选择器收敛、D9 卸载还原缺口、D10 MO 节流、D0-a/D0-c lint 清理。
3. **P2（迭代）**：D6/D12 死代码清理、D7/D8 面板守卫与重绘策略、D15 Python 层治理。
4. **背景**：建立"面向产物 lint 门禁 + 跨文件契约总表 + 统一测试入口"。

---

## 七、复核补充（Part 2，续审）

> 本节约在首轮报告后，对未复核的高影响项补做 grep / 阅读复核，更正并细化若干结论。

### 7.1 重要更正：另一份 S1 报告的"严重未定义变量"缺陷已修复（原报告过时）

`docs/code-review-2026-08-09.md`（S1）曾标记 `_attachEventBus` 在 3 处被引用却"未定义"。本次续审对全仓 grep `_attachEventBus` → **0 命中**，确认该符号在当前源码已不存在。当前实现一致使用 `_attachStore`：
- 钩子安装：`targeting.js:51-63`（`_attachStore` 定义 + `Object.defineProperty(window, siteAttachmentsKey(), {...})`）；
- 卸载还原：`lifecycle.js:70-73`（`delete window[_ak]` 后按 `_attachStore.value` 还原）。

安装与卸载路径自洽，无"未定义变量"风险。**建议将 S1 报告该条标注为"已修复/过时"**，避免误导后续修复。

### 7.2 D1 / D2 细化

- `auto-next.js:66` 的 `function toast` 位于插件**私有嵌套 IIFE 作用域**，不参与顶层冲突；顶层 `toast` 的真实冲突仅在 `utils.js:218` ↔ `toast.js:20`（二者均在 IIFE 顶层，命中 `no-redeclare`）。
- D2 真因是 `auto-next.js:68` 探测名缺 `.toolkit`：`utils.js:284` 唯一真实挂载点为 `window.__CX_FORCE_PLAY.toolkit.toast`，全仓 `__CX_FORCE_PLAY.toast` 无任何赋值。

### 7.3 D7 细化（面板 null 守卫）

`ensurePanel` 内 `#__cxPanelClose`(`panel-core.js:90`)、`#__cxBtnPause`(119) 等 **5 个关键按钮已加 `if (x)` 守卫**（DS 控制台分支所需，缺按钮时不再 NPE）。但 `#__cxCmd`(92)、`#__cxVideoList`(125)、`#__cxOnlyFg`(140)、`#__cxResumeAll`(155)、`#__cxAuto`(178)、`#__cxResume`(180) 等多数控件**仍无守卫**，面板模板变动或平台差异时仍可能在 `querySelector` 后立即 NPE。建议对"模板里可能存在也可能不存在"的控件统一加守卫。

### 7.4 D8 复核与降级（innerHTML 重建丢焦点）

`ensurePanel` 仅由 `showPanel()`(`panel.js:50`) 与延迟构建(`panel.js:106`、`panel-core.js:21`) 调用，**非每 tick 重建**。因此 `panel-core.js:41` 的整块 `el.innerHTML = buildPanelHTML(...)` 全量重建，其"丢焦点"风险主要发生在**重新打开面板**时（命令输入框 `#__cxCmd` 焦点被清空）。严重度由"持续丢焦点"降级为"重开丢焦点"。建议 `ensurePanel` 改为：`_cxPanel` 已存在则跳过 innerHTML 重建，仅 `syncPanelInputs()`。
`panel.js:80`（`renderInvasionReport`）与 `dashboard.js:298`（`wrap.innerHTML`）为局部重建，风险较低（节流 1500ms，且非交互输入区）。

### 7.5 量化（待校准选择器是系统性风险）

全仓 **12 个文件含 32+ 处 `待校准` / `best-effort` 标记**：`site-router.js`(13)、`vision-deepseek-web.js`(5)、`zhihuishu-exam.js`(3)、`quiz.js`(3)、`diagnostics.js`(2)、`chaoxing-exam.js`(1)、`unipus/ucampus/renwei/ilabx/zhihuishu.js` 各 (1) 等。说明大量能力依赖**未在真实站点验证**的选择器/钩子，是功能"声称有、实则可能不命中"的系统性根因——与 D1–D4（跨文件命名契约未同步）同源：缺乏"真实环境契约验证"网。

### 7.6 监听器收支

源文件 `addEventListener`/`removeEventListener` 分布：`panel-core.js`(32)、`panel-controls.js`(16)、`panel-drag.js`(5)、`dom.js`(10)、`lifecycle.js`(8)、`zhihuishu-fab.js`(6)、`zhihuishu-exam.js`(3)、`playback.js`(3)、`video-ended-notify.js`(7)… 与产物层面"注册 ≫ 注销"判断一致。卸载依赖整段 DOM 移除而非精确 `removeEventListener`，正是 D9"还原缺口"的系统性根因。

---

## 九、修复进度（P1/P2 已落地）

> 2026-08-10 续审后，已落地 D5/D6/D9/D10/D12/D15，并复核 D7/D8（当前代码已自行解决）。验证：`node --check` PASS、`_sim` **35/35 PASS**、ESLint **0 problems**、`npm test` **52/52 ALL PASS**、Python `py_compile` 通过。

| 编号 | 修复内容 | 文件 / 位置 | 状态 |
|---|---|---|---|
| D5 | `popup-quiz.js` 为新加 `_pqIsDialogCandidate` 三重确认门禁（含选项/作答元素 或 弹窗语义按钮/类名 才视为弹窗），所有命中点在 `popupQuizTick`/`popupQuizBlock` 及 fallback 均过该门禁，杜绝宽选择器误删宿主题目/答案容器；尺寸门禁改为「仅布局可测量时生效」，避免无头/jsdom 环境误杀正常弹窗 | `sites/popup-quiz.js` | ✅ |
| D6 | 删除未接入的死代码 `makeDraggable`（面板拖拽在 `panel-core.js` 中已「禁用」，全仓无调用点） | `presentation/panel-drag.js` | ✅ |
| D7 | 复核发现当前 `panel-core.js` 的 `ensurePanel` **已对 `#__cxCmd`/`#__cxVideoList`/`#__cxOnlyFg`/`#__cxResumeAll`/`#__cxAuto`/`#__cxResume` 等控件全部加 `if(x)` 守卫**——报告撰写时的缺口已在后续重构中补上，**无需改动** | `presentation/panel-core.js` | ➖ 已满足 |
| D8 | 复核发现 `_cxPanel` 早返回（`if (_cxPanel) return`）已保证面板仅首次构建一次 innerHTML，重新打开不重建、不丢焦点；`switchTab` 仅切 display、`panel:refresh` 仅 `syncPanelInputs` 不重建——报告担忧的「持续丢焦点」当前已不成立，**无需改动** | `presentation/panel-core.js` | ➖ 已满足 |
| D9 | `cleanupListeners` 补齐卸载还原缺口：① Ninja 面板外点击全局 `mousedown` 监听由匿名→命名 `panelNinjaOutsideClick` + 单次绑定，卸载时 `removeEventListener`；② `document` 级 `play`/`pause` 的 `syncNinjaGlyph` 监听与 `EventBus.onEv('panel:refresh', syncNinjaGlyph)` 订阅在卸载时移除 | `presentation/panel-core.js`、`presentation/panel.js`、`takeover/dom/lifecycle.js` | ✅ |
| D10 | `quizObserveDispatch` 改为只驱动轻量 `quizTick`（不再触发整个 `_loopTick`）；MO 防抖 300ms→800ms；保留 `_quizMOBusy` 节流闸门 | `takeover/bootstrap/main-loop.js`、`takeover/engine/quiz.js` | ✅ |
| D12 | 删除全仓无调用点的 `debounce` 函数及 `toolkit.debounce` 导出（`throttle` 仍在使用） | `takeover/foundation/utils/utils.js` | ✅ |
| D15 | `cx_crawler` 下 6 处裸 `except Exception:`（config.py×3、dump.py、render.py、session.py）改为 `except Exception as e:` 并落日志/告警（含 `import sys`）；`requests` 超时：经核查 `session.py`/`api_client.py` 的 HTTP 调用已统一走 `timeout=TIMEOUT`，**已满足** | `perception/cx_crawler/{config,dump,render,session}.py` | ✅ |

**回归说明**：D5 初版因尺寸门禁在无头环境误杀正常弹窗，导致 `sim-mooc.js` 3 例弹窗断言 FAIL；将尺寸门禁改为「仅布局可测量时生效」后，`_sim` 恢复 35/35 PASS。证明防御性门禁必须考虑测试/无头环境的布局缺位。

**修复后量化**：`node --check` PASS；`_sim` **35/35**；ESLint **0 problems**；`npm test` **52/52**；Python `py_compile` 0 错误。

> 至此 P0 + P1/P2 全部审查项均已落地或复核确认已满足。剩余的根因性机制建议（"跨文件契约总表 + 面向产物 lint 门禁 + 真实环境选择器校准"）属工程基建，不在单次修复范围内。

---

## 十、根因性工程基建（防复发，2026-08-10 续）

将审查报告中列为"根因性机制建议"的两项工程基建落地，并清理 D3 深层误导点。

### 10.1 D3 深层误导点清理（多端联动 → 预留扩展点）

`video-ended-notify.js` 顶部注释仍残留已删除的 `__cxBridge/bridgeReady` 旧名，与下方"toolkit.bridge 无消息 API"的真实说明自相矛盾，易误导维护者以为多端联动已实现。

- 修正 `video-ended-notify.js:2` 注释：移除旧名，明确"多端联动为**预留扩展点**"（toolkit.bridge 当前仅爬虫桥客户端，未暴露 `send`/`status`/`onReady`）。
- 同步 `build-force-play.ps1` 内 `video-ended-notify` 模块说明注释。
- 运行逻辑不变：`getBridge()` 在无消息 API 时本就返回 `null`，OS 通知降级行为保持一致。

### 10.2 命名空间契约一致性校验器（防 D1–D4 复发）

新增 `ecosystem/scripts/verify_contracts.js`：逐文件扫描全部源，提取「挂载点」（`__CX_FORCE_PLAY.X =` / `toolkit.X =` / 本文件内别名 `X = …`）与「读点」（消费方引用），任何读点无对应挂载点即报契约断裂（退出码 1）。

- 关键设计：别名**逐文件**识别（`var X = window.__CX_FORCE_PLAY` 且后接 `; , )` 或换行），避免把其他文件同名的本地变量（如 `quiz.js` 的 `var ns = qEl.querySelectorAll(...)`）误判为命名空间根；`toolkit` 根加词边界防 `mytoolkit.x` 子串误匹配。
- 验证：当前代码 **134 个挂载符号 / 136 处读点 / 0 断裂**；注入未挂载探针 `window.__CX_FORCE_PLAY.fakeUnmountedRead` 能正确报 FAILED（退出码 1），证明门禁有效可拦截回归。

### 10.3 面向产物 lint 门禁 + 契约门禁接入构建

`build-force-play.ps1` 在产物生成后新增两道门禁：

- ③ ESLint 产物门禁：用 node 直跑 `node_modules/eslint/bin/eslint.js` 校验产物 `chaoxing-force-play.user.js`，0 problem 才通过。
- ④ 契约一致性门禁：跑 `verify_contracts.js`，0 断裂才通过。
- 修复原 `nodeCandidates` 指向不存在的 `node-v20.19.0` 路径（导致 ①② 门禁被**静默 SKIP**），改为实际存在的 `node-v24.19.0`；现在四道门禁（node --check / _sim / ESLint / 契约）均真实生效。
- `ecosystem/package.json` 增加 `verify:contracts` 脚本，可单独运行。

### 10.4 跨文件契约总表

新增 `docs/CONTRACTS.md`：人工可读快照，列明全局命名空间根、共享工具库 `toolkit` 表面、各能力域顶层 API、localStorage 键约定、预留扩展点，以及历史契约缺陷对照表；并声明 `verify_contracts.js` 为机器权威源。

### 10.5 全量验证（含根因基建落地后）

`node --check` PASS；`_sim` **35/35**；ESLint **0 problems**；契约校验 **0 断裂**；`npm test`（`tests/pure.test.js`，直跑 node）**52/52 ALL PASS**；产物重新构建成功并落盘 `ecosystem/chaoxing-force-play.user.js`。

> 剩余未决项（需真实站点/跨端环境，非纯代码可解）：① 12 文件 32+ 处 `待校准`/`best-effort` 选择器与钩子的真实环境校准；② `toolkit.bridge` 是否扩展消息 API 以使多端联动真正可用（当前为预留扩展点）。

---

## 八、修复进度（P0 已落地）

> 2026-08-09 续审后，已直接落地全部 P0 修复并重建产物。验证：`node --check` PASS、`_sim` 35/35 PASS、ESLint **0 problems**、`npm test` **52/52 ALL PASS**。

| 编号 | 修复内容 | 文件 / 位置 | 状态 |
|---|---|---|---|
| D0-2 | `tests/pure.test.js` 的 vm stub 注入 `bestEffort`/`safeGet`/`safeDOM`/`safeCall`（与 `guard.js` 一致），单测入口由 RED → 52 断言全绿 | `ecosystem/tests/pure.test.js` | ✅ |
| D1 | 删除 `utils.js` 顶层重复的 `function toast(msg, ms)`，`toolkit.toast` 改由 `toast.js` 单一实现提供（ESLint `no-redeclare toast` 由此消失） | `takeover/foundation/utils/utils.js` | ✅ |
| D2 | auto-next 的 toast 探测名 `__CX_FORCE_PLAY.toast` → `__CX_FORCE_PLAY.toolkit.toast`（与真实挂载点一致，12 条提示不再静默降级到 console） | `plugins/addons/auto-next.js:68` | ✅ |
| D3 | 桥探测名 `__cxBridge`/`bridgeReady`/`onBridgeReady` → 真实挂载点 `toolkit.bridge`；并注明当前 `toolkit.bridge` 为爬虫桥客户端、未暴露 `send/status/onReady` 消息联动 API，故多端联动仍保持 OS 通知降级（待 `toolkit.bridge` 提供消息 API 后自动启用） | `plugins/addons/video-ended-notify.js` | ✅ |
| D4 | 反篡改配置探测 `ns.siteCfg` → `ns.currentSiteCfg()`（非超星平台反篡改 key 比对恢复生效） | `plugins/addons/tamper-guard.js:7` | ✅ |
| D0-a | `while` 赋值当条件加括号：`while ((_sib = _sib.nextElementSibling))`，消除 `no-cond-assign` | `plugins/addons/auto-next.js:306` | ✅ |
| D0-c | 重复 `var v` 重命名为 `v2`，消除 `no-redeclare` | `presentation/commands.js:46-48` | ✅ |

**修复后量化**：产物 ESLint 由「3 缺陷」降至 **0 problems**；单测由 RED 升至 **52/52 PASS**。

**未覆盖（后续迭代，非 P0）**：D5 宽选择器收敛、D6 `makeDraggable` 死代码、D7 面板 null 守卫补全、D8 面板重建丢焦点、D9 卸载还原缺口、D10 MutationObserver 节流、D12 重复工具、D15 Python 层治理，以及"跨文件契约总表 + 面向产物 lint 门禁"的根因性机制。

> 注：D3 的修复让探针对齐到真实对象，但**多端联动功能本身仍不可用**——核心脚本 `toolkit.bridge` 当前只暴露爬虫桥 API（`probeBridgeBase`/`bridgeInit`/`probeState`…），没有 `send/status/onReady` 消息接口。这揭示了一个比"命名不一致"更深的缺陷：多端联动的设计意图从未被真正实现。建议在 P1 明确 `toolkit.bridge` 是否需要扩展消息 API，否则 `video-ended-notify.js` 的整段桥逻辑应降级为"注释说明的预留扩展点"以免误导。

---

## 附：本审查已 grep 复核的关键事实清单

- `function toast` 共 3 处：`utils.js:218` / `toast.js:20` / `auto-next.js:66`（后两者顶层冲突）。
- `__CX_FORCE_PLAY.toast` 全仓无赋值；真实挂载点为 `utils.js:281` 的 `toolkit.toast`。
- `__cxBridge` / `bridgeReady` 仅出现在 `video-ended-notify.js`（探针），真实挂载点为 `bridge.js:208` 的 `toolkit.bridge`。
- `ns.siteCfg` 全仓无挂载；真实接口为 `site-router.js:127` 的 `currentSiteCfg()`。
- `makeDraggable` 仅 `panel-drag.js:7` 一处定义，无调用点。
- `popup-quiz.js:9-10` 含 `[class*="question"]` / `[class*="topic"]` / `[class*="answer"]` / `[class*="popup"]` 四个通配选择器。
- `npm test` 实测 RED：`targeting.js:205` 模块作用域调用 `bestEffort`，vm stub 未提供该符号。
- `perception/cx_crawler/` 下多处裸 `except Exception:` 静默吞异常。
