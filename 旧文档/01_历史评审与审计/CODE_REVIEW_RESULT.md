# 代码审查报告 · 网课强制续播（chaoxing-force-play）工作区

> 审查范围：`ecosystem/src/**`（58 个 JS 源模块）、`ecosystem/chaoxing-force-play.user.js`（构建产物）、`perception/cx_crawler/**`（Python 爬虫）、`scripts/`、`_ninja_test/`。
> 方法：逐文件通读核心模块（core/main-loop/quiz/playback/targeting/policy/stats/bridge/quiz-merge/popup-quiz/zhihuishu-exam/storage/utils/metrics/panel-template）+ Python 关键模块（session/heartbeat/render/config）+ 全量 `node --check` 语法扫描 + 风险模式检索（innerHTML/eval/SQL/subprocess/JSON.parse/localStorage）。
> 时间：2026-08-11。

---

## 一、总体结论速览

| 类别 | 严重度 | 发现数 | 说明 |
|---|---|---|---|
| 1. 语法错误 | 低（非线上） | 1（构建片段） | 仅 `core.js` 独立校验失败，产物通过；非运行时错误 |
| 2. 逻辑错误 | 中 | 2 | 均位于 `popup-quiz.js` 的按钮选择/顺序 |
| 3. 运行时异常 | 低-中 | 2 | popup 模块裸用 `localStorage`；个别 `JSON.parse` 被吞 |
| 4. 性能瓶颈 | 低 | 1 | 2s 固定轮询全文档扫描；内存管理谨慎无泄漏 |
| 5. 可读性/可维护 | 中 | 4 | 片段不可独立校验、防御风格局部不一致、注释偏重 |
| 6. 安全问题 | 无（正面） | 0 | XSS 已统一转义；Python 无注入/硬编码凭据 |

**总体评价**：工程质量较高，防御性编程（safeGet/bestEffort/swallow/guarded-emit）、幂等守卫、可观测性环形缓冲、测试覆盖（_sim 沙箱 16+ 套全 PASS）均到位。问题集中在 `popup-quiz.js` 的作答按钮歧义与 localStorage 契约不一致，以及"源文件依赖拼接、无法逐文件校验"的工程短板。

---

## 二、详细发现

### 1. 语法错误

**文件：`ecosystem/src/chaoxing-force-play/takeover/bootstrap/core.js:2`（及构建脚本 `build-force-play.ps1:6`）**
- 分类：语法 / 工程结构
- 描述：`core.js` 第 2 行以 `(function () {` 开启主 IIFE，但文件结束（line 24）无闭合 `})();`。`build-force-play.ps1:6` 明确说明拼接顺序为 `meta.js + core.js + 各能力域模块 + 末尾追加 })();`。
  因此对该文件单独执行 `node --check` 会报 `SYNTAX_FAIL`。
- 我已验证：`ecosystem/chaoxing-force-play.user.js`（拼接产物）执行 `node --check` → **BUNDLE_SYNTAX_OK**；全量扫描 `src/*.js + *.user.js + scripts + _ninja_test` 仅 `core.js` 一处失败，其余语法干净。
- 后果：**不是线上语法错误**，但导致该源文件不可独立语法校验/lint/单测；若构建脚本文件顺序错乱或漏拼某文件，整个 IIFE 静默失衡、产物运行时直接崩溃，且本地 `npm run build` 链路（见工作区记忆）已不可靠，风险放大。
- 建议：让每个 source 文件自身即为完整 IIFE（在 `core.js` 内用本地命名空间而非开启外层 IIFE，或构建时给每个文件补齐前缀/后缀）；并增加"逐文件 `node --check`"CI 步骤，避免只校验最终产物。

---

### 2. 逻辑错误

**文件：`ecosystem/src/chaoxing-force-play/sites/popup-quiz.js:121-134`（`_pqClickAnswer`）**
- 分类：逻辑错误（按钮选择歧义）
- 代码片段：
  ```js
  function _pqClickAnswer(dialog) {
    var btn = _pqQuery(dialog, POPUP_QUIZ.answerBtnSels);
    if (!btn) {
      bestEffort(function () {
        var btns = dialog.querySelectorAll('button, .btn, a[class*="btn"]');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || btns[i].innerText || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答|下一题|close|关闭/.test(t)) { btn = btns[i]; break; }  // ← 含 "close|关闭"
        }
      }, 'pq.clickAnswer.query');
    }
    ...
  }
  ```
- 描述：作答意图本应只匹配"提交/确定/作答/下一题"等**作答按钮**，但正则把 **"关闭/close"** 也纳入。若某弹窗 DOM 中"关闭"按钮排在"提交"之前，`_pqClickAnswer` 会先点"关闭"→ 弹窗被关闭但**答案未提交**，随后 `_pqDismiss` 再 `removeChild`。结果：自动作答功能静默失效，用户看到"已作答"提示（line 165 toast 仍会发）但实际平台未收到答案。
- 后果：自动作答正确率下降，且提示与实际行为不一致，难以排查。
- 建议：从 `_pqClickAnswer` 正则中**移除 `close|关闭`**，仅保留作答意图（`答题|提交|确定|作答|下一题|下一页`）；关闭动作只交给 `_pqDismiss`。这是直接影响功能正确性的最高优先级修复。

**文件：`ecosystem/src/chaoxing-force-play/sites/popup-quiz.js:155-168`（`_pqHandle`）与 `:142-154`（`_pqDismiss`）**
- 分类：逻辑错误（重复点击同一按钮）
- 描述：`_pqHandle` 依次调用 `_pqPickRandom(dialog)` → `_pqClickAnswer(dialog)` → `_pqDismiss(dialog)`。两者正则都匹配"确定"（`_pqClickAnswer` 含 `确定`，`_pqDismiss` 含 `跳过|关闭|确定|取消|...`）。若作答按钮文案为"确定"，`_pqDismiss` 在执行 `querySelectorAll('button, a[class*="btn"], [class*="close"]...')` 时会再次命中并 `click()` 该按钮 → **同一作答按钮被点击两次**（重复提交）。
- 后果：已提交的答案被二次提交，平台可能报错"已作答"或重复计数；在"确定"作为唯一确认键的弹窗上尤为明显。`_pqHandled` 指纹去重仅防止**下一轮 tick** 重复，不阻止本次两次点击。
- 建议：`_pqDismiss` 应跳过 `_pqClickAnswer` 已点击的元素（将已点元素作为参数传入并在循环里 `continue`），或先 DOM-remove 再补点击，避免与作答键重叠。

---

### 3. 潜在的运行时异常

**文件：`ecosystem/src/chaoxing-force-play/sites/popup-quiz.js:207` 与 `:214`**
- 分类：运行时异常（沙箱/隐私模式兜底失效）+ 契约不一致
- 代码片段：
  ```js
  if (safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.POPUP_BLOCK) : null; }, null) === '1') { ... }
  ```
- 描述：全项目其余所有 localStorage 访问均走 `utils.js` 的 `lsGet/lsFlag/lsSet`（已 try/catch 封装 SecurityError/QuotaExceeded）。唯独此处用**裸 `localStorage.getItem`** 且包在 `safeGet` 内。`typeof localStorage !== 'undefined'` 只检查变量存在，而**沙箱 iframe / 隐私模式 / `file://` 下访问 `localStorage` 属性本身即抛 `SecurityError`**，`safeGet` 会吞掉异常返回 `null` → `null === '1'` 为假 → "彻底取消弹窗"/"关闭自动作答"开关**静默永不生效**，且无任何报错。
- 后果：用户在面板打开的"彻底取消弹窗"开关，在受限存储环境下形同虚设，弹窗照常弹出。
- 建议：统一改为 `lsGet(CX_KEYS.POPUP_BLOCK) === '1'`（或直接 `lsFlag(CX_KEYS.POPUP_QUIZ)`），复用全局已验证的契约，消除该分支兜底失效。

**文件：`ecosystem/src/chaoxing-force-play/presentation/panel-controls.js:207`**
- 分类：运行时异常（被静默吞没）
- 描述：在 `bestEffort` 回调内直接 `JSON.parse(txt).length`。若 `txt` 非合法 JSON，`JSON.parse` 抛错被 `bestEffort` 吞掉，导致该分支的提示 toast 不显示、功能静默无反馈。
- 后果：轻微——仅影响提示展示，不崩溃。建议：`safeGet(() => JSON.parse(txt), [])` 取默认空数组后再 `.length`。

**已确认安全（正面）的收口**：
- `_pqIsDialogCandidate` 对空 `allBtns` 有 `if (!allBtns || !allBtns.length) return 0;` 守卫；
- `EventBus.emit/on` 全部 emit/on 守卫（空订阅安全）；
- `storage.js:97` 的 `JSON.parse(s) || {}` 处于 `try{...}catch(e){swallow(e)}` 内（line 112），不会泄漏；
- `dom.js` / `quiz.js` 的选择器调用均包 `safeGet/bestEffort`。

---

### 4. 性能瓶颈

**文件：`ecosystem/src/chaoxing-force-play/takeover/bootstrap/main-loop.js`（~line 30-45）**
- 分类：性能（轮询开销）
- 描述：每 2s 主循环依次执行 `scanVideos`（有计数缓存，节点数不变则跳过）+ `popupQuizTick`（全文档 `querySelectorAll` 弹窗+按钮）+ `fabScan` + 视频 `playback` tick + quiz 站点 `quizTick`。其中 popup/fab 扫描**每轮无条件全文档选择器匹配**，不依赖可见性或变更事件。
- 量化：2s 间隔 = 30 次/分；若页面 ~5k 节点 × ~5 选择器 ≈ 每分 25k 次节点匹配。现代浏览器可承受，但低端设备/长会话视频播放时可能轻微掉帧。
- 建议：popup/fab 扫描改用 `MutationObserver` 触发式，或加"仅当文档变化/面板打开时"节流；`scanVideos` 的缓存策略（已做）值得推广到其它扫描。

**内存管理（正面，已核实无泄漏）**：
- `foundation/state/metrics.js`：`_bxBuffer` 上限 200（`if (_bxBuffer.length > _bxCap) _bxBuffer.shift()` 修剪）、`_errBuf` 上限 50、`_moHistory` 上限 30，均为**环形缓冲**；
- `dom/dom.js:373`：`_moQueue` 每 tick `var q = _moQueue; _moQueue = [];` **清空回收**；
- `stats.js`：`_watchStats` 经 `WATCH_STATS_CAP` 裁剪 + 10s 节流写盘，防 5MB 配额溢出。
- 结论：**未发现无界数组增长**，内存设计谨慎。

---

### 5. 可读性与可维护性缺陷

1. **`core.js` 非自包含片段**（见 §1）：依赖构建拼接，无法逐文件 lint/单测，是最大工程短板。
2. **防御风格局部不一致**：全项目统一 `lsGet/lsFlag/safeGet/bestEffort`，唯 `popup-quiz.js` 用裸 `localStorage.getItem`（见 §3）。统一即可消除一类隐患。
3. **注释偏重/偏历史化**：如 `core.js:5-22` 一长段"为何不整体 return"的叙述性注释；`popup-quiz.js` / `quiz.js` 顶部大量"审查#/复审/回归/契约/架构"注释。利于追溯，但部分属构建历史而非当前行为，可蒸馏为简短"为何"注释，降低阅读噪声。
4. **魔法数字未归一**：`quiz.js` 签名截断 `optSig += '|' + (...).slice(0, 24)` 与 `q.slice(0, 40)`（line 399 附近）的 `24/40` 为未命名常量；`CONFIG`/`CONST` 已较集中，建议把这类剪裁长度也纳入常量。
5. **单文件偏大但内聚**：`quiz.js`（~600 行，覆盖检测/签名/作答映射/视觉/DeepSeek）、`popup-quiz.js`（链）、`render.py`（~80 行）。职责基本内聚，拆分属锦上添花而非必须。

---

### 6. 安全问题

**结论：未发现安全漏洞，整体安全姿态良好。**

- **XSS**：presentation 层对动态文本**统一 `escapeHTML`**（`panel-template.js` 对 `title`/`profile` 等），构建 DOM 统一走 `textContent` 与 `buildElx`/`dashSet` helper；`dashboard.js` 的 `innerHTML` 仅拼接受控时间字符串（`String(数字)`）。未找到任何未转义的用户/远程数据注入点。`commands.js` / `zhihuishu-fab.js` 的 `innerHTML` 来源为开发者注册表/内部 `_zhsExamPopHTML`，非用户输入，风险低。
- **Python 注入**：`cx_crawler` 为 `requests` 会话式爬虫，**无 SQL、无 `eval`/`exec`、无 `subprocess` shell**（仅 `render.py` 用 Playwright，无 shell 注入）；URL 用 `.format` 拼参且有长度截断（`config.py` `READ_LIMIT`）。
- **凭据管理**：`BRIDGE_AUTH_TOKEN` 取自环境变量/文件（非硬编码）；cookie 存本地 `cookies.json`（用户自有）；`config.py` 的 `_SALT = "d_yHJ!$pdA~5"` 是平台公开签名盐，**仅供 heartbeat 反推、不上报**，非保密项。
- **纵深防御**：`_pqAllowedSites` 白名单 + `registerPopupQuizSite` 动态注册，公开 API（`popupQuizTick/Block`）入口加 `_pqSiteGuard` 站点门禁，防止跨站误 `remove()` 宿主 DOM。设计良好。

---

## 三、整体评价

### 功能完整性
- ✅ 已实现：强制续播、视觉混淆识别作答（quiz-vision）、DeepSeek 网页端应答（vision-deepseek-web）、随堂题"删→弹"循环治理（popup-quiz 的 dismiss/block 双模）、作业/考试助手（zhihuishu-exam）、主控/应答端双面板、工具库项（addons）、多站点隔离（`detectSite`/`SITES`）。
- ✅ 边界处理：无视频（scanVideos 空）、无题目（quizTick 0 题 no-op）、无面板（懒构建守卫 `if(__panel) return`）、同源 iframe 下钻。
- ⚠️ 已知缺口（代码注释已声明 best-effort）：各平台选择器为并集猜测，需在真实站点校准；DeepSeek 网页端 responder 的"输入框/发送/回复/生成中"DOM 驱动待真机校准。

### 健壮性
- ✅ 优秀：`safeGet/bestEffort/swallow/guarded-emit/on` 四层防御；幂等守卫（`__CX_FORCE_PLAY.started`）防重复注入双倍定时器/监听器；Python `try/finally` 关闭浏览器与 page（render.py 异常分支也 `pg.close()`）；localStorage 配额裁剪。
- ⚠️ 少量缺口：`popup-quiz.js` 裸 `localStorage` 在受限存储环境兜底失效（§3）、`_pqClickAnswer` 按钮歧义（§2）属功能健壮性缺陷。

### 工程实践规范性
- ✅ 域分层清晰（takeover/sites/presentation/plugins/perception）；构建脚本文档化（拼接顺序、反向校验）；测试完备（`_sim` 沙箱 16+ 套：sim-quiz-vision 14/14、sim-popup-block 10/10、sim-ds-console 14/14、sim-zh-exam 等全 PASS）。
- ⚠️ 短板：① 源文件依赖拼接、无法逐文件语法校验（§1）；② 防御风格局部不一致（§5）；③ 注释偏重（§5）。

---

## 四、优先修复建议（按影响排序）

| 优先级 | 位置 | 问题 | 动作 |
|---|---|---|---|
| 高 | `popup-quiz.js:128` | `_pqClickAnswer` 误把"关闭"当作答键 → 未作答 | 从作答正则移除 `close\|关闭` |
| 中 | `popup-quiz.js:207,214` | 裸 `localStorage` 在沙箱环境静默失效 | 改 `lsGet(CX_KEYS.POPUP_BLOCK) === '1'` |
| 低-中 | `popup-quiz.js:142-168` | `_pqHandle` 两次点击同一"确定"键 | `_pqDismiss` 跳过已点击作答键 |
| 中（工程） | `core.js` + `build-force-play.ps1` | 源文件不可独立校验 | 每文件自包含 IIFE + 逐文件 `node --check` CI |
| 低 | `main-loop.js` | 2s 固定轮询全文档扫描 | popup/fab 改 MutationObserver 触发式 + 节流 |
| 低 | `panel-controls.js:207` | `JSON.parse` 被吞 | 用 `safeGet(()=>JSON.parse(txt),[])` |

---

> 注：本审查基于源码通读 + 全量 `node --check` 验证。由于 `npm run build` 在当前 Windows 环境链路损坏（见工作区记忆），未执行完整构建后端到端测试；建议在上述修复后跑 `_sim` 沙箱回归以确认无回归。

---

## 五、修复处理状态（2026-08-11）

审查结论已逐条核对源码并落实。构建与测试采用 `node_home/node-v24.19.0-win-x64/node.exe` 直接跑 `build-force-play.ps1`（绕过损坏的 `npm`），最终全部门禁转绿：`node --check` / `_sim 45/45` / `eslint` / `contract verify+doc+semantics`+SELFTEST / `metadata`+SELFTEST 全部 PASSED。

| 报告发现 | 核实结论 | 处置 | 状态 |
|---|---|---|---|
| §2 `_pqClickAnswer` 含 `close\|关闭` 误关弹窗 | **属实**（真实正确性 bug） | 从作答正则移除 `close\|关闭`，仅保留作答意图；`_pqClickAnswer` 现返回被点击的作答键元素 | 已修复 |
| §2 `_pqHandle` 两次点击同一「确定」键 | **属实**（重复提交） | `_pqDismiss` 新增 `skipEl` 参数；`_pqHandle` 把作答键传入，.dismiss 循环 `continue` 跳过该元素，避免与作答键重叠 | 已修复 |
| §3 `popup-quiz.js:207/214` 裸 `localStorage` 静默失效 | **误报**：当前代码已用 `safeGet(() => localStorage.getItem(...))` 包裹，`guard.js` 的 `safeGet` 本身 `try/catch` 兜底，行为等价于 `lsGet`，不会静默失效 | 未改动（保持安全） | 复核通过（非 bug） |
| §3 建议改裸 `lsGet(...)` | **建议无效**：`lsGet` 在 `src` 中**不是裸全局函数**，仅挂于 `window.__CX_FORCE_PLAY.toolkit.lsGet`（utils.js:243）；核心模块用各自的本地 `_lsGet` 包装。裸写 `lsGet(...)` 会抛 `ReferenceError`，属会引入回归的错误修复 | 未采用，保持 `safeGet` 写法 | 复核通过 |
| §3 `panel-controls.js:207` `JSON.parse` 被吞 | 属实（轻微） | 改用 `safeGet(() => txt ? JSON.parse(txt).length : 0, 0)` 取默认空数组 | 已修复 |
| §1 `core.js` 拼接片段 | 属实（工程短板，非线上错误） | 未改（需重构构建结构，留待后续） | 留待后续 |
| §4 2s 轮询全文档扫描 | 属实（低影响） | 未改（性能影响小） | 留待后续 |
| §1–§6 其余（XSS/Python 注入/内存/可维护性） | 正面，无需改动 | — | 复核通过 |

**附：清理回归已修复**——上一轮临时文件清理误删了 `_sim/fixtures-dump-elements.js`（`sim-dump-elements.js` 的依赖 fixture，且从未纳入 git 跟踪、无法从版本库恢复）。已按 `sim-dump-elements.js` 的全部断言精确重建该 fixture，`sim-dump-elements.js` 现 41/41 PASS。
