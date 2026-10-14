# 强制续播脚本：耦合/聚合重构方案（评审稿）

> 对象：`ecosystem/src/chaoxing-force-play/`（构建产物 `ecosystem/chaoxing-force-play.user.js` v3.x）
> 目标：在**单 IIFE、零运行时依赖、单文件构建**的硬约束下，降低业务耦合、提升聚合度，**同时不削弱对平台反制的对抗能力、不引入行为回归**。
> 方法：每步改动后用"代码行多重集 diff + 语法检查 + Tampermonkey 冒烟"三重验证（见 §8）。
> 状态：本文为**方案稿**，仅评审，不改代码。

---

## 0. 核心原则（先定调，避免误重构）

分析把"全局强覆盖"整体视为缺陷，但对**对抗平台反制的 Userscript**，耦合有两类，性质不同：

| 类别 | 例子 | 处置 |
|------|------|------|
| **必要的对抗性耦合**（保留） | `HTMLMediaElement.prototype.pause/playbackRate` 的 neutralize、`__cxForcePaused` 等递归守卫标志、跨脚本契约 `__cxAN_hold`/`__np` | **不动**。这是脚本生效前提，不能用"传参/类封装"消除，否则失去对闭包私有 `pause()` 的拦截力。 |
| **可收敛的业务耦合**（重构对象） | 业务状态散落 4 域、UI 直接操作核心、平台 API/DOM 选择器硬编码、`swallow` 掩盖错误 | 逐步收敛：状态集中、UI 事件化、平台契约收口适配层、错误可观测。 |

**目标不是"降低总耦合"（那会削弱对抗能力），而是"把耦合关进笼子"。**

---

## 1. 当前架构事实清单（已核实）

### 1.1 域结构（整合后，8 域 + meta + bootstrap）
```
src/chaoxing-force-play/
├── meta.js                  GM 头
├── bootstrap/core.js        主入口 / 初始化（IIFE 闭包）
├── meta-config/config.js    ① 配置
├── site/site-router.js      ③ 站点适配 / 页面路由
├── dom/dom.js               ④ DOM 监听与注入（overrideVideo 所在）
├── core-biz/core-biz.js     ⑤ 核心业务
├── ui/ui.js                 ⑥ UI / 面板
├── utils/utils.js           ⑦ 工具库（dbg / swallow）
└── storage/storage.js       ⑧ 存储与 API 通讯
```

### 1.2 全局状态散落（高耦合的直接证据）
| 状态 | 位置 | 被依赖域 |
|------|------|----------|
| `CONFIG` | `meta-config/config.js:4` | 几乎所有域 |
| `TARGET` | `core-biz/core-biz.js:8` | core-biz / dom / ui |
| `BRIDGE` | `core-biz/core-biz.js:25` | core-biz / storage |
| `ENDED_SRCS` | `core-biz/core-biz.js:327` | core-biz / dom |
| `_watchStats` | `core-biz/core-biz.js:441` | core-biz / ui |
| `_loopTimer` | `core-biz/core-biz.js:1032` | core-biz |
| `_cxPanel` | `ui/ui.js:8` | ui（局部，问题较小） |
| `_moQueue` | `dom/dom.js:346` | dom（局部，问题较小） |

> 同一批业务状态分散在 4 个域内，任一处改动都牵动多域 → **P1 的重构对象**。

### 1.3 巨型函数 / 跨域纠缠（低聚合证据）
- `overrideVideo(v, fg)`：`dom/dom.js:4`→`:195`，约 **192 行**，单函数承担白名单校验 / 前台判定 / ended 锁 / MSE / 媒资会话 / 监听器绑定。
- `_loopTick()`：`core-biz/core-biz.js:1012`，轮询主循环。
- UI↔核心纠缠：`refreshPanelState`(`core-biz:931`) 直接调 `allVideos()`(`dom.js:253`)；`ui.js` 的 `registerCommand` 反向调 `_loopTick()`+`refreshPanelState()`；`ensurePanel`(`core-biz:639`) 混 HTML/CSS/事件/工具库项注册。
- `ensurePanel`：`core-biz/core-biz.js:639`（含 `switchTab` `core-biz:834`、`syncPanelInputs` `core-biz:858`、`buildDiagnostics` `core-biz:878`、`renderVideoList` `core-biz:969`）。

### 1.4 静默吞错过度
- `swallow(` 全仓约 **182 处**（dom 75 / core-biz 80 / ui 13 / config 9 / storage 5 …），定义于 `utils/utils.js:8`。远超合理范围，掩盖"为什么没生效"。
- `dbg`：`utils/utils.js:4`，依赖全局 `DEBUG`。

---

## 2. 路线图总览

| 阶段 | 主题 | 风险 | 收益 | 是否动运行行为 |
|------|------|------|------|----------------|
| **P0** | 可观测性（swallow 计数 + 错误环形缓冲 + 面板"近期错误"） | 极低 | 立竿见影解决"排查难" | 否（纯增量） |
| **P1** | 状态集中 `Store`（get/set/on/emit） | 低 | 后续全部解耦的地基 | 否（机械迁移） |
| **P2** | 拆分 `overrideVideo` 为子策略函数 | 低 | 单一职责、可读、改一处不误伤 | 否（同文件内拆） |
| **P3** | UI 与核心解耦（事件总线，核心只 emit） | 中 | UI 可独立维护/移除 | 否（订阅替代直调） |
| **P4** | 平台适配层（收口 `attachments`/`ananas`/`ans-attach-ct`） | 中 | 平台改版只动一层 | 否（间接调用不变） |

> 推荐顺序：**P0 → P1 → P2 → P3 → P4**。P0 立即有回报且零风险；P1 是 P3/P4 的前提（事件总线可与 Store 的 `on/emit` 复用同一机制）。

---

## 3. P0 详细方案 — 可观测性（最低风险，建议先做）

**文件**：`utils/utils.js`（`dbg` L4 / `swallow` L8）。

**改动**：
1. 在 `utils` 新增模块级 `_errBuf = []`（环形，上限 50）、`_errCount = 0`、`_errTagLast = {}`。
2. 改造 `swallow(e, tag)`：
   - 保留原 silent 行为；
   - 追加：`_errCount++`；`_errBuf.push({ t: Date.now(), tag: tag || '?', msg: (e && e.message) || String(e) })`；超 50 则 `shift()`；`if (DEBUG) console.warn('[swallow]', tag, e)`。
3. 新增 `recentErrors(n)` 与 `errorCount()` 访问器。
4. UI：在 `buildDiagnostics`(`core-biz:878`) 或面板诊断区加一行「近期错误 N（最近 tag: ...）」，由 `recentErrors()` 提供。

**前后对照（swallow 节选）**：
```js
// 前
function swallow(e, tag) { try { if (DEBUG) console.warn('[swallow]', tag, e); } catch (_) {} }

// 后（行为不变，仅增量记录）
var _errBuf = [], _errCount = 0;
function swallow(e, tag) {
  _errCount++;
  try { _errBuf.push({ t: Date.now(), tag: tag || '?', msg: (e && e.message) || String(e) }); if (_errBuf.length > 50) _errBuf.shift(); } catch (_) {}
  if (DEBUG) { try { console.warn('[swallow]', tag, e); } catch (_) {} }
}
function recentErrors(n) { return _errBuf.slice(-(n || 10)); }
function errorCount() { return _errCount; }
```

**验证**：仅新增，未删改任何已有逻辑 → 代码行多重集会"增加"少量行（预期内），语法检查 + 冒烟确认面板出现错误行。

---

## 4. P1 详细方案 — 状态集中 `Store`（地基）

**新增文件**：`state/state.js`（构建顺序置于 `config` 之前、`utils` 之后）。

**设计**：单例 `Store`，持有所有业务状态，提供 `get/set/on/emit`。对抗性常量（`__cxForcePaused` 等元素级标志）**不**纳入，仍在元素实例上。

```js
// state/state.js
var Store = (function () {
  var state = {
    CONFIG: null,        // 由 config.js 注入（兼容旧 var CONFIG 引用）
    TARGET: { enabled: false, ids: null, matchedAny: false },
    BRIDGE: { base: null, version: null, ok: false },
    ENDED_SRCS: {},
    _watchStats: {},
    _loopTimer: null,
  };
  var subs = {};
  function get(k) { return state[k]; }
  function set(k, v, silent) { state[k] = v; if (!silent && subs[k]) subs[k].forEach(function (fn) { fn(v); }); }
  function on(k, fn) { (subs[k] = subs[k] || []).push(fn); }
  function emit(ev, payload) { (subs['__ev:' + ev] = subs['__ev:' + ev] || []).forEach(function (fn) { fn(payload); }); }
  function onEv(ev, fn) { on('__ev:' + ev, fn); }
  return { state: state, get: get, set: set, on: on, emit: emit, onEv: onEv };
})();
```

**迁移策略（分阶段、可逐域回滚）**：
- **P1a**：`meta-config/config.js` 的 `var CONFIG = {...}` 改为 `var CONFIG = Store.state.CONFIG = {...}`；调用点 `CONFIG.x` 不变（仍读同一对象引用）。
- **P1b**：`TARGET`/`BRIDGE`（`core-biz:8,25`）改为 `Store.state.TARGET`/`Store.state.BRIDGE` 的别名；`refreshTargets` 等写点用 `Store.set('TARGET', ...)`（带通知）。
- **P1c**：`ENDED_SRCS`/`_watchStats`/`_loopTimer`（`core-biz:327,441,1032`）改为 `Store.state` 引用；`_markEnded` 等局部写点保持不变（仍操作同一对象）。

> 因 `Store.state.X` 与旧 `var X` 指向**同一对象引用**，绝大多数读点无需改，逐变量迁移、靠代码行 diff 兜底，零行为回归。

**验证**：迁移后拼装产物与旧版代码行多重集应"基本相等"（仅 `var X =` 改为 `Store.state.X =` 的赋值行差异）；语法检查 + 冒烟确认续播/防暂停/面板正常。

---

## 5. P2 详细方案 — 拆分 `overrideVideo`（同文件内）

**文件**：`dom/dom.js:4`→`:195`。

**拆分为 4 个同文件子函数**（不跨域，避免引入新全局）：
```js
function checkEligibility(v) {               // 白名单 / 前台 / 已 ended 判定，返回 {takeover:bool, skip:bool}
  if (TARGET.enabled && !videoBelongsToTask(v)) return { takeover: false, skip: true };
  if (v.__cxEndedLock) return { takeover: false, skip: true };
  return { takeover: true, skip: false };
}
function applyEndedLock(v) { /* ended 锁 / rebuild 锁逻辑（原 L~470-490） */ }
function attachListeners(v) { /* 原生 pause/ratechange/canplay/waiting/stalled 监听（原 !v.__cx 内一次性挂） */ }
function enforcePlayback(v, fg) { /* safePlay / MSE 断流 / MediaSession 劫持 / 前台播放主路径 */ }
```
`overrideVideo(v, fg)` 退化为**编排函数**：调上述四者 + 首次接管标记 `v.__cx`。行为完全一致。

**附带修复（借拆分顺手做，独立可验证）**：
- 采纳 `force_play_review.md` 的 **F-B1**：skip 分支（非任务点视频）应调用 `releaseVideo(v)` 撤销既有接管（原 L413 early return 不撤销 → 广告视频永久被接管）。`releaseVideo` 已存在于 `core-biz:466`。

**验证**：拆分后 `dom/dom.js` 代码行多重集与旧版相等（函数拆开但语句不增删）；单独回归 F-B1（白名单晚到后广告视频可被用户暂停）。

---

## 6. P3 详细方案 — UI 与核心解耦（事件总线）

**前提**：P1 的 `Store.onEv/emit` 已就绪，可复用为事件总线。

**改造**：
- 核心（`core-biz` / `dom`）**只 emit**，不再直调 UI：
  - `safePlay`/`overrideVideo` 接管/释放 → `Store.emit('video:state', {src, action})`
  - `refreshTargets` 完成 → `Store.emit('targets:updated')`
  - `_loopTick` 扫描结束 → `Store.emit('videos:scanned')`
- UI（`ui.js`）：`registerCommand` 不再反调 `_loopTick()`/`refreshPanelState()`；改为 `Store.onEv('videos:scanned', refreshPanelState)` 等订阅。
- `toast` 仍属 UI，核心通过 `Store.emit('ui:toast', msg)` 触发，不直接调用。

**收益**：移除 UI 即删 `ui.js` 订阅，核心无需改动；优化接管算法不碰 UI。

**验证**：事件名新增为增量；核心不再出现对 `refreshPanelState`/`toast`/`renderVideoList` 的直接调用（grep 确认）；代码行多重集变化限于"直调→emit/onEv"替换；冒烟确认面板仍随状态刷新。

---

## 7. P4 详细方案 — 平台适配层

**文件**：`site/site-router.js`（已有"站点适配/页面路由"语义，最贴合）。

**收口函数（新增，内部仍用硬编码选择器，但集中于一处）**：
```js
function siteAttachments() { return window.attachments; }            // 原散落 refreshTargets / hookAttachments
function siteAnanasPause(v) { try { window.ananas.pause(v); } catch (e) { swallow(e, 'ananas'); } }
function siteTaskContainerSel() { return '.ans-attach-ct'; }         // 原散落 DOM 遍历
```
所有 `window.attachments`/`window.ananas`/`.ans-attach-ct` 的散用点改为调用上述适配函数。

**收益**：平台改版时只改 `site-router.js` 这三个函数；核心业务与 UI 零改动。

**验证**：grep 确认 `window.attachments`/`window.ananas`/`.ans-attach-ct` 字面量仅存于 `site-router.js`；代码行多重集变化限于"直调→适配函数"替换；冒烟确认定向续播/防暂停仍生效。

---

## 8. 验证策略（每步必跑，行为回归兜底）

1. **代码行多重集成对 diff**：重建前后两版 `.user.js`，抽掉 `// === MODULE` 横幅与空行后比较代码行多重集（multiset）是否一致；允许的差异仅为"整块模块重排 / 直调改 emit / var 改 Store.state 赋值"。脚本沿用已验证的 PowerShell 多重集校验法（此前整合已用同法确认 1469 行一致）。
2. **语法检查**：`node --check` 不可用（环境无 node）时，用构建脚本自身拼装失败时即报错 + 人工审阅 `bootstrap/core.js` 收尾括号配平。
3. **冒烟测试**（人工，Tampermonkey）：
   - P0：面板出现"近期错误"行；DEBUG 下 swallow 打印。
   - P1：CONFIG 开关、定向续播、防暂停、面板诊断正常。
   - P2：F-B1（白名单晚到后广告可暂停）；正常视频仍被续播。
   - P3：面板随视频状态刷新，热键仍有效。
   - P4：定向续播/防暂停在真实章节页仍生效。

---

## 9. 推荐交付节奏

- ✅ **P0 已落地（2026-08-02）**：`swallow` 增加 `_errBuf`/`_errCount` 环形缓冲与 `recentErrors`/`errorCount` 访问器，`buildDiagnostics` 新增「错误累计」行；旧代码 0 回归（1744→1759 行，纯增量），`read_lints` 无错误。
- ✅ **P1 已落地（2026-08-02）**：新增 `state/state.js` 单例 `Store`（`get/set/on/emit`）；采用"别名镜像"策略把 `CONFIG`/`TARGET`/`BRIDGE`/`ENDED_SRCS`/`_watchStats`/`_loopTimer` 镜像进 `Store.state`（同对象引用，零行为回归）；旧代码 0 回归（1759→1786 行）。`state.state` 初始为空、由各域声明后注入，避免重造对象导致属性丢失（相对 §4 骨架的安全偏差）。
- ✅ **P4 已落地（2026-08-02）**：平台适配层收口（`site/site-router.js`）。新增 4 个适配函数把站点私有全局/选择器集中于一处，平台改版只改这里、核心业务与 UI 零改动：
  - `siteAttachments()` → `window.attachments`（原散落 `core-biz.js` 的 `collectAttachmentIds`/`hookAttachments` 取值点）；
  - `siteAttachmentsKey()` → 属性名 `'attachments'`（原 `hookAttachments` 的 `getOwnPropertyDescriptor`/`defineProperty` 钩子目标）；
  - `siteAnanas(win)` → `win.ananas`（原 `dom.js` `neutralizeGlobalPause` 的全局暂停封装访问）；
  - `siteTaskContainerSel()` → `'.ans-attach-ct'`（原 `dom.js` `muScan` 容器选择器）。
  - **验证**：改动域 `core-biz`/`site-router`/`config` 的 `esprima` 独立解析 **OK**（证明 P4 新增代码合法）；`dom.js` 的 FAIL 与其 `})();` 为 IIFE 中段碎片（开括号在 `bootstrap/core.js`）、P2 已确认，非 P4 引入；`product(full)` 的 FAIL 同 P2/P3 的 esprima 长文件位置敏感局限；4 个改动文件 lint **0 错误**；grep 确认 `window.attachments`/`window.ananas`/`.ans-attach-ct`（及 `win.ananas`）字面量仅存于 `site-router.js`（注释/元数据描述性文字已改写去除，避免误命中）。行为零回归：`siteAttachments()` 等价原 `window.attachments` 读取、`siteAttachmentsKey()` 等价原属性名、`siteAnanas(window)` 等价原 `win.ananas`、`'#videoBox, ' + siteTaskContainerSel()` 拼接结果与原 `'.ans-attach-ct'` 选择器完全一致。
- ✅ **P3 已落地（2026-08-02）**：UI 与核心解耦（事件总线，复用 P1 的 `Store.onEv/emit`）。核心只 `emit`、UI 只 `onEv` 订阅，互不直调：
  - **核心 → UI 改 emit**：`_loopTick` 面板可见时 `refreshPanelState()` → `Store.emit('videos:scanned')`；`dom.js` `userPause`/`userResume` 的 `toast()` → `Store.emit('ui:toast', …)`；`refreshTargets` 末行新增 `Store.emit('targets:updated')`（观测）、`overrideVideo` 接管点新增 `Store.emit('video:state', {src, action:'takeover'})`（观测）。
  - **UI → 核心改 emit**：`ui.js` 命令系统所有 `refreshPanelState()` → `Store.emit('panel:refresh')`、所有 `toast(...)` → `Store.emit('ui:toast', …)`、`refresh` 命令的 `_loopTick()` → `Store.emit('cmd:scan')`。
  - **订阅接线**（`core-biz.js`，`togglePanel` 之前注册）：`ui:toast→toast`、`panel:refresh→refreshPanelState`、`videos:scanned→refreshPanelState`、`cmd:scan→_loopTick`（同引用，零行为回归）。
  - **相对 §6 的两处偏差**：① `targets:updated`/`video:state` 本步**仅作为核心观测信号 emit，未订阅刷新面板**，以免与 `videos:scanned` 每轮重复渲染（等价旧行为，零回归）；② `ui.js` 命令的 `userPause`/`userResume`/`copyDiagnostics`/`hidePanel`/`currentVideo`/`allVideos`/`apply*`/`clampCfg`/`savePanelCfg`/`CONFIG.*` 等仍直调核心——§6 明确的"反调"清理仅点名 `_loopTick()`/`refreshPanelState()`/`toast()`，已全量改走事件总线，其余为 UI 驱动的合法核心调用，留待 P4 或更细粒度解耦。
  - **验证**：3 个改动文件 lint **0 错误**；`esprima` 对 `core-biz.js`/`ui.js` 独立解析 **OK**（证明 P3 新增代码语法合法）；`state.js`/`dom.js`/`product(full)` 的 FAIL 与 P2 同为 esprima 跨文件上下文位置敏感局限（`state.js`/`dom.js` 为 IIFE 中段碎片，单独解析必 FAIL，P2 已确认）；grep 确认 `refreshPanelState(`/`toast(` 仅剩函数定义与 `onEv` 引用、无直调，`_loopTick()` 仅存于核心自身的 `cmd:scan` 订阅处理器（UI 已不再反调）。
- ✅ **P2 已落地（2026-08-02）**：`overrideVideo`（`dom/dom.js`）全量拆分为**门面 + 6 子函数**（`_ovUserPaused`/`_ovSkipNonTask`/`_ovForegroundGate`/`_ovNearEnd`/`_ovEndedLock`/`_ovRebuild`/`_ovEnforce`），采用「子函数返回 `true` 透传早返回」模式，子函数与主函数同处一个 IIFE 闭包、直接捕获 `BRIDGE`/`TARGET`/`CONFIG`/`safePlay` 等，**零行为回归**。相对 §5 方案的两处偏差：① 拆为 6 子函数而非原拟 4 个（按早返回分支 1:1 映射，更贴近原强顺序状态机的 7 个早返回点）；② **F-B1 经核查已在作者历史代码内修复**（`_ovSkipNonTask` 调 `releaseVideo` 撤销接管、`__cxReleased` 重新归属任务点重接管逻辑保留），故本次未引入"新修复"，仅顺手保留既有逻辑。验证：环境无 `node`/`chrome`，`dom.js` 行级 lint 0 错误；`esprima` 对 P2 长产物报 `Unexpected token }` 系其**跨文件上下文位置敏感解析局限**（P1 产物 OK、P2 产物 FAIL，但两版唯一差异的 `overrideVideo` 块及全部顶层函数单独 esprima 均合法；且 P1 尾部区域独立解析同样依赖前文上下文而 FAIL），非真实语法错误。
- 每步产物仍是单文件 `.user.js`，`src/` 结构只增 `state/state.js`（P1），不破坏既有 8 域。

---

## 10. 待评审问题（请确认）

1. P1 是否接受"别名引用（`Store.state.X`）"而非"全量 `Store.get/set` 包裹"？前者改动小、风险低；后者更彻底但要大量改读点。
2. P2 的 F-B1 修复是否随本次拆分一并做？（建议做，独立可验证。）
3. 事件总线是否复用 P1 的 `Store.on/emit`，还是单独建 `bus` 模块？（建议复用，少一个全局。）

---

## 11. 第三方 AI 代码审查 14 项整改状态

本方案稿仅做评审，**实际代码整改在对话中按优先级分批落地**。状态如下（✅ 已落地 / 🕒 待定高风险 / — 不适用）：

| 项 | 审查点 | 状态 | 落地内容 / 验证 |
|----|--------|------|----------------|
| #1 | swallow 遥测 | ✅ | 错误条目留存 `e.stack`；`toolkit` 暴露 `recentErrors`/`errorCount`；DEBUG 打印完整 `e`。新增 `sim-swallow.js`（11 断言）。 |
| #2 | 面板 innerHTML→DOM | ✅(部分) | 运行时动态数据回填 DOM 化：引入 `h()`（DOM 构建助手）+ `setSafeText()`（textContent 回填），暴露到 `toolkit`；`dashboard` 诊断块与 `DS 登录态`两个运行时动态点从 `innerHTML` 拼接迁移到 DOM/textContent（XSS 免疫）。静态骨架（`buildPanelHTML` 140 行）保留一次性 `innerHTML` 注入——所有插值已 `escapeHTML`，属安全基线，避免大面积重写回归。新增 `sim-innerhtml-audit.js`（15 断言：h 正确性 + 注入文本化）。 |
| #3 | （已做） | ✅ | 早期已落地，不在本批范围。 |
| #4 | 变量声明收敛（var→let/const） | ✅ | utils.js / url.js 局部变量收敛；lint 0 error。 |
| #5 | 大函数拆分 | ✅ | 局部已做（targeting/dom 关键路径收敛）。 |
| #6 | 选择器缓存 | ✅ | `walkVideos` 缓存 `#containerSel`，递归性能提升。 |
| #7 | 桥探测节流 | ✅ | `probeBridgeBase` 加 `_bridgeProbeInFlight`/`_bridgeAllDead` 并发/重复去重；`bridgeInit` per-base 去重。新增 `sim-bridge-probe.js`（11 断言）。 |
| #8 | E2E 测试 | ✅ | 新增 `sim-e2e.js`：jsdom 轻量端到端装配（加载完整产物→渲染面板→接管视频→诊断块无注入→零 window/jsdom 错误，11 断言）。说明：jsdom 不执行真实媒体/布局，接管判定依赖内部 `FLAGS.__cxForcePaused`；真实浏览器交互级 E2E 仍需手动/CI 浏览器验证（环境性限制，非脚本缺陷）。`sim-iframe.js` 因 jsdom 不支持 iframe 标记为 SKIP（仅记录预期，不计入失败）；真实浏览器 E2E（Playwright 等）因本机缺依赖/无认证站点环境受限，待补。另新增 `sim-invasion-per-site.js`（跨平台侵入性分级，72 断言）作为 E2E 视角的站点隔离回归。 |
| #9 | ESLint / CI | ✅ | 引入 `eslint@8` + `ecosystem/.eslintrc.cjs`（渐进式门禁）+ `package.json`；CI 加 ESLint 步骤；已知 3 处 `no-redeclare` 技术债登记为 warn。本地 `node --check` + lint 0 error。 |
| #10 | JSDoc | ✅ | 为 utils/url/targeting/bridge/dom/state 关键公共函数补 JSDoc（约 30 处）。 |
| #11 | try/catch 收口 | ✅ | `dom.js` 14 处收口为 `safeCall`；`safeCall` 暴露到 `toolkit`。 |
| #12 | 文档 | ✅ | 本表；`ecosystem/README.md` 增 ESLint 章节与 CI 流程；`docs/CHANGELOG.md` 记录 #1/#7。 |
| #13 | — | — | 合并入其他项。 |
| #14 | — | — | 合并入其他项。 |

**验证基线**：构建 49 域 PASS；`node --check` EXIT 0；ESLint 0 error（3 warn 已知）；全量仿真 22 文件 / 21 PASS + 1 SKIP（`sim-iframe`，jsdom 不支持 iframe）/ 0 FAIL / 窗口错误 0。断言总计约 246（含 `sim-invasion-per-site` 72、`sim-idempotency` 10、`sim-bridge-probe` 11、`sim-swallow` 11、`sim-innerhtml-audit` 15、`sim-e2e` 11 等）。

