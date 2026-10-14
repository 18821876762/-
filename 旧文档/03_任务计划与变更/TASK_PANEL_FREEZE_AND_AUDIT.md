# 任务文档：面板冻结修复 + 安全/健壮性审计

> 合并任务（A 类阻断性 bug + B 类审计）。工作区：`c:/Users/24033_1dhcyji/CodeBuddy/20260723173246`
> 产物：`ecosystem/chaoxing-force-play.user.js`（版本 4.18）
> 构建：在 `ecosystem/` 下用 `node_home/node-v24.19.0-win-x64/node.exe` 跑 `powershell -ExecutionPolicy Bypass -File build-force-play.ps1`
> 状态：**A 类①下拉挡 tab 已修复（z-index）②未知透明层挡整面板已加解冻自检+实时诊断（真实页面坐实见 1.6）；B 类 S1/P1 已修复，L1 复核确为已修复项，全部构建门禁（含 `_sim`/`contract doc`）PASS。**

---

## 一、A 类·非 ninja（完整面板）控制面板冻结

### 1.1 现象（用户已确认）
完整面板（右侧大面板，`NINJA=false`）下，**联动答题时/答题后**：
- 无法切换 tab（点「播放/答题/监控/设置」无反应）；
- 无法在面板内点关闭按钮；
- 键盘通道正常——「P」键开关面板有效；
- 只有刷新页面才恢复。

### 1.2 已排除（代码侧全量排查）
- **ninja 悬浮球（FAB）指针捕获残留**：该路径仅在悬浮球模式生效，完整面板无 FAB、无 `setPointerCapture`；其上 `window` 级 `pointerdown` 自愈监听仅在 `_nxDrag.active` 为真时动作且从不无条件 `preventDefault`，故与非 ninja 冻结无关。上一轮对 `panel-core.js` 的自愈改动已通过 `_sim` 且无副作用，保留。
- **全局 `capture:true` + `preventDefault` 的鼠标拦截监听**：全仓 capture 监听仅 `commands.js` 的 document `mousedown`（仅 `hideCmdList()`，无 `preventDefault`）、`panel-core.js` 的 `panelNinjaOutsideClick`（仅当面板 `ninja+open`）、`pd` 级 `pointerdown` 自愈（仅 `_nxDrag.active`）。**无全局吞点击监听**。
- **脚本创建的全面板透明覆盖层**：系统排查 `mask|overlay|shade|dimmer|backdrop`、`appendChild` 到 body、`position:fixed/absolute`+`100%`、全部 `z-index`、`pointer-events` 改写——
  - `cx-ds-status`（`vision-deepseek-web.js`，DS 联动状态浮层）：`pointer-events:none`、位于左下角小条，**非**面板上方 → 排除；
  - toast 提示流 / tamper-guard 条 / keyboard-hint：`pointer-events:none` → 排除；
  - `ninja` 菜单：仅悬浮球模式；
  - `quiz-vision.js`：仅注入/移除 `<script>`，**不创建任何 overlay**；
  - `popup-quiz.js`：仅查找并移除平台弹窗，**不创建任何 overlay**；
  - 命令下拉 `#__cxCmdList`：`position:absolute; top:100%` 仅向下展开，容器 `pointer-events:none`、条目 `pointer-events:auto`，**仅挡其下方 tab 导航，且因在 `.cx-cmd-wrap` 内、向下展开，永不可达位于其上方的 `header` 关闭按钮**。
  → **结论：脚本自身在非 ninja 模式不创建任何可拦截面板点击（尤其关闭按钮）的浮层。**

### 1.3 根因（分层）
面板 DOM 自上而下：`header`（关闭按钮）→ `.cx-cmd-wrap`（命令栏）→ `.cx-seg`（tab 导航）→ `.cx-body`。
命令下拉 `#__cxCmdList`（`z-index:10`，向下展开 200px）盖住 `.cx-seg`，条目 `pointer-events:auto` → 点击 tab 命中下拉项、tab 收不到 click → **「点其他 tab 无反应」**（确证，与 `commands.js` 旧注释一致）。

**但「关闭失效 + 整面板冻结」代码侧无法定位脚本内元凶**：关闭按钮在 `header`（下拉之上方），几何上永不被下拉覆盖；全仓亦无其它脚本浮层/拦截监听可挡关闭按钮。该症状（P 键全局 keydown 正常、仅刷新恢复）的签名，指向**站点侧透明拦截层**（平台随堂题/考试 modal 残留 backdrop、或平台 modal 与面板同处一渲染层且后插入 DOM 而居顶）覆盖整个面板所致——属脚本之外因素，需真实页面抓取坐实（见 1.6）。

### 1.4 修复（双层）
1. **下拉挡 tab（确证项）·`presentation/styles.js`**：面板 chrome 提升至高于下拉框（z-index:10）：
   - `#__cxPanel .cx-header{position:relative;z-index:30}`（关闭按钮恒居下拉之上）
   - `#__cxPanel .cx-seg{position:relative;z-index:30}`（tab 命中目标恒为 `.cx-seg-btn` 而非下拉项）
2. **未知透明层挡整面板（剩余症状）·`presentation/panel.js` 新增解冻自检 `_cxPanelDefrostCheck`**（订阅 `panel:refresh`）：
   - 仅真实浏览器（`document.elementFromPoint` 可用、且 `getBoundingClientRect` 非 0）生效；jsdom 无布局直接跳过，**不影响 `_sim`**。
   - 用 `document.elementFromPoint` 探测面板关键点（关闭按钮 / 当前 tab 中心）顶层元素是否仍属面板自身（`_cxPanel.contains(top)`）：
     - 否（被外部元素拦截）→ 把面板重挂到父节点末尾（同 `z-index:2147483647` 下 DOM 后者居顶）**抢回点击权**；
     - 首次/元凶变化时 `console.warn` 输出**拦截元凶 tag**（`tagName#id.class`）并 toast「检测到面板被遮挡，已自动恢复」——直接坐实用户要求的 `elementFromPoint`/`getComputedStyle` 诊断路径；
     - 节流 400ms + 元凶变化才告警，避免刷屏。
   - 同时更正 `commands.js` 旧注释（下拉与「关闭无效」无关，避免误导向）。

### 1.5 验证
- `build-force-play.ps1` 重建产物 → `node --check`/`eslint`/`contract verify`/`contract doc`/`contract semantics`/`metadata`/`cross-module`/`_sim` 全 PASS（`_sim` 经 `run-sim.js`）。
- 解冻自检在 jsdom 下因无布局（`getBoundingClientRect` 全 0）提前返回，不触发重挂、不刷 toast，回归安全。
- 真实页面验证见 1.6（Playwright 抓取坐实）。

### 1.6 抓取待办（Playwright 真实页面坐实「关闭失效+整面板冻结」元凶）
非 ninja 模式加载复现页 → 触发联动答题 → 冻结瞬间于控制台执行：
```js
const r = __cxPanel.getBoundingClientRect();
const pts = [[r.right-14, r.top+14], [r.left+r.width/2, r.top+54]];
pts.forEach(([x,y])=>{
  const t = document.elementFromPoint(x,y);
  console.log(x,y, t && (t.tagName+(t.id?'#'+t.id:'')+'.'+t.className), 'inPanel=', __cxPanel.contains(t));
});
// 列出全页覆盖面板的高 z-index 元素
[...document.querySelectorAll('*')].filter(e=>{
  const s=getComputedStyle(e); const rb=e.getBoundingClientRect();
  return (+s.zIndex||0) > 1000 && rb.width && rb.top < r.bottom && rb.bottom > r.top && rb.left < r.right && rb.right > r.left && !__cxPanel.contains(e);
}).forEach(e=>console.log('OVERLAY', e.tagName, e.id, e.className, getComputedStyle(e).zIndex, getComputedStyle(e).pointerEvents));
```
- 若输出 `inPanel=false` 且 `OVERLAY` 列出平台元素 → 即元凶；解冻自检已在控制台以 `[CX] 面板解冻自检：...被外部元素拦截(...)` 给出同一结论，并已在运行时重挂面板恢复点击。
- 该诊断与脚本自带的 defrost 互为印证，复盘时可直接贴 `[CX]` 日志。

---

## 二、B 类·安全/健壮性审计（2026-08-16 深度检测）

> 行号已用 `read_file`/`search_content` 复核；审计报告的行号部分漂移，以真实源码为准。

### 2.1 问题清单表

| 编号 | 严重度 | 类别 | 问题 | 源码位置（复核后） | 状态 |
|------|--------|------|------|--------------------|------|
| S1 | 中危·安全 | 站点判定绕过 | `/chaoxing\.com$/i` 仅锚结尾，`evilchaoxing.com` 可绕过站点判定与桥白名单 | `site-router.js:13`、`bridge.js:152` | **已修复** |
| S2 | 低危·安全 | 导航白名单 | `auto-next.js`/`commands.js` 直接 `location.href = quiz.url`，未走白名单 | `auto-next.js`、`commands.js` | 待处理（非本轮执行顺序） |
| L1 | 低-中危·健壮性 | 配置解析 | `storage.js` 配置 `JSON.parse` 无 `try/catch` | `storage.js:113`（`loadPanelCfg`） | **复核：已修复**（解析已在 `try` 内；全仓 `JSON.parse` 均有 `try/catch`/`safeGet`/`bestEffort` 保护） |
| L2 | 低危·逻辑 | 题库匹配 | `quiz.js` 题库用子串 `indexOf` 匹配，题干互含会答错 | `quiz.js` 题库查找 | 待处理 |
| P1 | 中危·内存 | 长会话累积 | `quiz.js` `_quizAIProblems` 只增不删 | `quiz.js:62`/`_quizStrictFail` | **已修复**（计数上限淘汰） |
| P2 | 低危·内存 | 引用泄漏 | `quiz.js` `_quizReviewItems` 长生命周期保留 live DOM 节点引用 | `quiz.js:92` | 待处理 |
| M1/M2 | 信息 | CI/规范 | 构建产物语法门禁、lint 配置统一 | CI/`.eslintrc` | 已固化（构建门禁含 `node --check`/`eslint`） |

### 2.2 S1 修复（安全单一事实源）
- 新增 `takeover/foundation/utils/url.js` 的 `_cxIsChaoxingHost(h)`（精确边界：仅 `'chaoxing.com'` 自身或其子域 `*.chaoxing.com`，`h==='chaoxing.com' \|\| h.endsWith('.chaoxing.com')`），并挂到 `window.__CX_FORCE_PLAY.isChaoxingHost`。
- `site-router.js`、`bridge.js` 各加委托助手（优先用共享全局、本地兜底防全局未就绪），将 `/chaoxing\.com$/i.test(h)` 与 `!/chaoxing\.com$/i.test(_urlHost(v))` 统一替换为 `_cxIsChaoxingHost(...)`。
- 契约：`docs/CONTRACT.md` 经 `node scripts/verify_contract_doc.js --emit` 重新生成（登记 `isChaoxingHost`，共 155 挂载符号）。

### 2.3 P1 修复（内存护栏）
- `quiz.js` 新增 `_quizPruneAIProblems()`（计数上限淘汰，默认 200，可经 `CONST.QUIZ_AI_PROBLEM_CAP` 调整），与既有 `_quizPruneReviews`/`_quizPruneAIFailed` 同范本。
- 在 `_quizStrictFail` 登记失败题后立即调用，约束 `_quizAIProblems` 长会话无限增长。

### 2.4 L1 复核结论
`storage.js:113` 的 `JSON.parse(s)` 已位于 `loadPanelCfg` 的 `try{...}catch(e){swallow(e)}` 内；全仓其余 `JSON.parse`（`utils.js:196` `safeGet`、`panel-core.js:154` IIFE、`panel-controls.js:220/292`、`commands.js:13/24` `safeGet`、`vision-deepseek-web.js:71` `bestEffort`、`stats.js:12` `safeGet`、`quiz.js:302` `safeGet`、`zhihuishu-exam.js:110` `safeGet`、`auto-next.js:115/131` `try/catch`）均受保护。**L1 实际已在先前轮次修复，非本轮缺口。**

### 2.5 执行顺序与门禁
执行顺序：**S1 → L1 → P1**（用户指定）。本轮完成 S1、P1，L1 复核确认已修复。
- 重建 + `_sim` 全 PASS；`contract doc` 因新增 `isChaoxingHost` 已重生成后 PASS。

---

## 三、预存问题（与本任务无关，另案处理）
- `_sim` 整门中 `sim-quiz-popup.js` 失败属 `popup-quiz.js` 弹窗路径，与面板冻结/审计无关。
- 其余 docs/contract 历史脱节已在本次 `contract:doc` 重生成后消除。

## 四、改动文件清单
- `ecosystem/src/chaoxing-force-play/presentation/styles.js`（A 类 z-index:30 修复：header/seg 高于命令下拉）
- `ecosystem/src/chaoxing-force-play/presentation/panel.js`（**A 类新增解冻自检** `_cxPanelDefrostCheck`，订阅 `panel:refresh`，`elementFromPoint` 探测+重挂面板恢复点击+诊断）
- `ecosystem/src/chaoxing-force-play/presentation/commands.js`（A 类：更正误导性注释——下拉与「关闭无效」无关）
- `ecosystem/src/chaoxing-force-play/takeover/foundation/utils/url.js`（S1 共享超星域判定）
- `ecosystem/src/chaoxing-force-play/takeover/foundation/site/site-router.js`（S1 复用）
- `ecosystem/src/chaoxing-force-play/takeover/engine/bridge.js`（S1 复用 + 白名单加固）
- `ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`（P1 内存护栏）
- `docs/CONTRACT.md`（契约总表重生成，登记 `isChaoxingHost`）
- `ecosystem/chaoxing-force-play.user.js`（重建产物）
