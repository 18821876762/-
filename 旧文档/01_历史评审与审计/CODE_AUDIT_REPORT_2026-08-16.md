# 深度代码检测报告 · 网课强制续播（chaoxing-force-play）

- **检测时间**：2026-08-16
- **检测范围**：`ecosystem/src/chaoxing-force-play/`（58 个 JS 模块）+ 构建产物 `ecosystem/chaoxing-force-play.user.js`
- **方法**：① `node --check` 逐模块语法校验；② 构建产物语法校验；③ 静态模式扫描（`eval/Function/innerHTML/postMessage/localStorage/JSON.parse/host 校验/定时器`）；④ 关键引擎文件（storage / utils / bridge / quiz / vision-deepseek-web / state / panel / zhihuishu-fab）人工复审。
- **严重程度**：严重(Critical) / 高(High) / 中(Medium) / 低(Low) / 信息(Info)

---

## 一、总体结论

| 维度 | 结论 |
|------|------|
| 语法正确性 | 源码 57/58 模块 `node --check` 通过；唯一「失败」的 `core.js` 是**故意不闭合**供构建脚本拼接为单一 IIFE（预期内）。构建产物 `chaoxing-force-play.user.js` 语法校验**通过**。 |
| 安全（XSS） | **总体良好**：所有注入 `innerHTML` 的页面/题目文本均经 `escapeHTML()` 处理，未发现注入点。 |
| 安全（其它） | 发现 **1 处中危 host 校验绕过**，1 处低危导航未走白名单。 |
| 逻辑缺陷 | 2 处低-中危（配置解析健壮性、题库子串误匹配）。 |
| 性能/内存 | 1 处中危（失败题登记无上限累积）、1 处低危（保留 live DOM 引用）。 |
| 可维护性 | 2 处信息级（构建门禁、lint 配置一致化）。 |

> 该仓库工程质量较高：错误吞除（`safeCall`/`safeGet`/`swallow`）、定时器统一 `TimerRegistry` 跟踪、postMessage 来源白名单校验、离线优先隐私策略、fetch 超时、导航/endpoint 白名单校验均已落地。

---

## 二、问题清单（含文件:行号、严重程度、影响、改进建议）

### S1【中危·安全】host 白名单正则可被「形似域名」绕过
- **位置**：
  - `ecosystem/src/chaoxing-force-play/takeover/foundation/site-router.js:13`
    ```js
    if (/chaoxing\.com$/i.test(h)) { _site = 'chaoxing'; return; }
    ```
  - `ecosystem/src/chaoxing-force-play/takeover/engine/bridge.js:152`
    ```js
    if (typeof v === 'string' && (v.indexOf('http://') === 0 || v.indexOf('https://') === 0) && !/chaoxing\.com$/i.test(_urlHost(v))) return null;
    ```
- **原因**：正则 `/chaoxing\.com$/` 仅锚定**结尾**，因此 `evilchaoxing.com`、`notchaoxing.com` 等形如 `…chaoxing.com` 的域名也会匹配通过。
- **影响**：
  - `site-router.js`：钓鱼/形似域会被误判为 `chaoxing` 站点，进而激活强制续播、自动作答、弹窗处理等逻辑（向第三方发截图 / 操作 DOM）。
  - `bridge.js`：导航白名单失效，`_cxBridgeNavigate` 可能放行跳转到非 chaoxing 的形似域。
- **对比**：同仓 `quiz.js:223` 与 `vision-deepseek-web.js:615` 已**正确**使用 `h === X || h.endsWith('.' + X)`，本处写法与之一致性缺失。
- **建议**：统一改为精确匹配：
  ```js
  function _isChaoxingHost(h){ return h === 'chaoxing.com' || h.endsWith('.chaoxing.com'); }
  ```
  并抽成 `utils` 共享函数，全仓复用。

---

### S2【低危·安全】题目导航 URL 未走 host 白名单
- **位置**：
  - `ecosystem/src/chaoxing-force-play/plugins/addons/auto-next.js:380`
    ```js
    if (quiz.url) { window.location.href = quiz.url; } else if (quiz.el) { quiz.el.click(); }
    ```
  - `ecosystem/src/chaoxing-force-play/presentation/commands.js:292`
    ```js
    setTimeout(function () { try { window.location.href = url; } catch (e) { window.location.assign(url); } }, 300);
    ```
- **影响**：`quiz.url` / `url` 直接作为导航目标。若题目数据/命令来源不可信（如被篡改的 localStorage 题库、外部命令注入），可触发到任意域的跳转。
- **建议**：复用 S1 修复后的共享 host 校验；对 `quiz.url` 在执行前校验 `endsWith('.chaoxing.com')`（或归属当前站点 host），否则走 `quiz.el.click()` 兜底。

---

### L1【低-中危·健壮性】配置加载 `JSON.parse` 无异常兜底
- **位置**：`ecosystem/src/chaoxing-force-play/takeover/foundation/storage/storage.js:113`
  ```js
  var o = JSON.parse(s) || {};   // s = localStorage.getItem(CX_KEYS.PANEL_CFG)
  ```
- **影响**：若 `localStorage` 中 `cx_panel_cfg` 被外部扩展/手动写入损坏（非 JSON），`JSON.parse` 抛异常，`loadPanelCfg()` 中断，面板配置（速率、扫描间隔、礼貌模式等）无法加载，甚至波及初始化调用链。与同文件 `savePanelCfg`（`try/catch` + `swallow`）及全仓 `safeGet(JSON.parse...)` 风格不一致。
- **建议**：
  ```js
  var o = safeGet(function(){ return JSON.parse(s); }, {});
  if (!o || typeof o !== 'object') return;
  ```

---

### L2【低危·逻辑/准确性】题库查找为子串匹配，题干互含会误匹配
- **位置**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js:308`
  ```js
  for (var k = 0; k < keys.length; k++) { if (stem && stem.indexOf(keys[k]) >= 0) return bank[keys[k]]; }
  ```
- **影响**：用 `stem.indexOf(keys[k]) >= 0` 做子串包含匹配。当一道题的题干包含另一道题的「题干片段」时，会返回错误的题库答案（答非所问）。命中即 `return`，无置信阈值。
- **建议**：对题干/键做归一化后采用更稳健的匹配（如去除标点空格后比对、词边界或相似度阈值），并在严格模式下对低置信匹配不自动化作答而转交人工/AI。

---

### P1【中危·性能/内存】`_quizAIProblems` 只增不删，长会话累积
- **位置**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js:62` 定义、`quiz.js:84` 写入
  ```js
  var _quizAIProblems = {};          // :62
  _quizAIProblems[fp] = { fp: fp, msg: _tag + msg, ts: Date.now() };  // :84
  ```
- **影响**：该对象仅 `set` 从未 `delete`，考试结束/页面切换后仍持续累积（同一 `fp` 会因重试被覆盖，但不同题数量随使用无上限增长），在长时间多场考试场景下形成内存占用与面板诊断噪声。
- **建议**：在考试/作答状态机进入 `DONE` 或页面 `beforeunload` 时清空；或加 LRU/上限（如仅保留最近 N 条）。

---

### P2【低危·性能/内存】`_quizReviewItems` 保留 live DOM 节点引用
- **位置**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`（审阅项 `opts` 为实时 DOM 节点数组，`_quizReviewItems` 长生命周期保留）
- **影响**：即使题目已滚出视口或被平台重渲染，仍持有整棵选项子树引用，延长 DOM 存活、增加 GC 压力（在长试卷/无限滚动场景下更明显）。
- **建议**：仅保存 `textContent`/必要元数据（`qid`、`qtype`、选项文本），避免长生命周期保留 DOM 引用；图片/富媒体可降采样或丢弃。

---

### M1【信息·可维护性】`core.js` 故意未闭合，CI 需对构建产物校验
- **位置**：`ecosystem/src/chaoxing-force-play/takeover/bootstrap/core.js`（末行无闭合大括号）
- **说明**：`node --check` 单独对其报 `Unexpected end of input` 是**预期内**（构建脚本 `build-force-play.ps1` 将各模块拼接为单一 IIFE）。构建产物已通过语法校验。
- **建议**：CI 中对**构建产物** `chaoxing-force-play.user.js` 跑 `node --check`（而非单个源码模块），避免误报；并在 `core.js` 顶部用注释标明「本文件由构建器拼接，不单独闭合」。

---

### M2【信息·可维护性】lint 配置统一化与 CI 固化
- **位置**：当前 git 状态显示 `ecosystem/.eslintrc.cjs` 被修改、`ecosystem/.eslintrc.json` 被删除。
- **建议**：确认 ESLint 配置唯一来源；在 CI 固定 `node` 版本（当前用 `node_home/node-v24.19.0-win-x64`）并执行 `eslint`，将「构建产物语法检查 + lint」作为合并门禁，防止回归（如 S1 这类 host 校验模式可用自定义 eslint 规则约束）。

---

## 三、已落地的优秀实践（建议关注而非改动）

- **XSS 面控制**：`escapeHTML()` 全覆盖注入点（`presentation/panel-template.js`、`dashboard.js`、`panel-ds-console.js:54`、`panel-controls.js:248`）。
- **定时器治理**：`TimerRegistry`（`bootstrap/core.js:24-46`）统一登记 `setInterval/setTimeout`，卸载 `clearAll`，`vision-deepseek-web.js` 跨标签定时器亦登记（`vision-deepseek-web.js:156/168`）。
- **postMessage 源校验**：`state.js`、`vision-deepseek-web.js` 严格比对 `event.origin` 与 `source`，并校验白名单（非 `chaoxing.com` 直接忽略）。
- **隐私/第三方**：`quiz-vision.js` 截图发 DeepSeek 前做离线兜底与隐私开关；endpoint 模式不发送任何页面文本。
- **网络健壮性**：`fetchWithTimeout`（`utils.js:121-133`）统一超时；`safeCall/safeGet/swallow` 全局错误吞除；`JSON.parse` 多处 `try/catch`。
- **导航/endpoint 白名单**：`quiz.js:217-223` 用 `new URL(ep, _base)` + `endsWith('.' + h)` 校验 endpoint host。

---

## 四、优先级行动建议

1. **立即修复（中危）**：S1 host 正则绕过 —— 抽共享 `_isChaoxingHost()` 并全仓替换（含 `site-router.js:13`、`bridge.js:152`）。
2. **尽快修复（低-中危）**：L1 配置 `JSON.parse` 加 `safeGet`；P1 `_quizAIProblems` 加清空/上限。
3. **计划内（低危）**：S2 导航白名单复用；L2 题库匹配加固；P2 去 DOM 引用。
4. **工程化（信息）**：M1/M2 —— 构建产物语法门禁 + ESLint 固化 + 自定 host 校验规则。
