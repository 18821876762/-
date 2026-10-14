# 架构文档复核意见 — `docs/ARCHITECTURE.md`

> 复核基准：实际读取 `ecosystem/src/chaoxing-force-play/` 全部 58 个 `.js`、`build-manifest.txt`、`build-force-play.ps1`、`ecosystem/perception/cx_crawler/` 与 `site-router.js` 站点登记。
> 结论：文档**结构清晰、数据流图总体可用**，但**模块清单与真实源码存在系统性偏差**——多处文件名/路径不存在、整层模块被严重低估、构建顺序描述有误。最严重的是 `sites/`、`engine/`、`presentation/` 三层的文件映射。

---

## 🔴 严重不准确（会误导定位/理解）

### 1. `sites/` 章节（§3.2）与真实文件严重不符
文档写：`chaoxing.js`(超星/学银)、`mooc.js`(中国大学 MOOC)、`ilabx.js`(ICVE)、`ilabx.js`(实验空间)。
真实 `sites/` 文件清单（12 个）：`chaoxing-exam.js`、`icourse163.js`、`icve.js`、`ilabx.js`、`popup-quiz.js`、`quiz-selectors.js`、`renwei.js`、`ucampus.js`、`unipus.js`、`xuetangx.js`、`zhihuishu-exam.js`、`zhihuishu.js`。

| 文档所述 | 实际 | 说明 |
|---|---|---|
| `chaoxing.js` | `chaoxing-exam.js` | 文件名错；学银在线已并入 chaoxing（site-router rev2），非独立文件 |
| `mooc.js`(中国大学 MOOC) | `icourse163.js` | **mooc.js 不存在**；中国大学 MOOC/爱课程 = `icourse163.js`（site-router 行20） |
| `ilabx.js`(ICVE) + `ilabx.js`(实验空间) | `icve.js` + `ilabx.js` | 是两个**不同文件**，并非都叫 ilabx |
| （未提及） | `quiz-selectors.js` | 选择器并集模块，漏写 |
| （放进 engine） | `popup-quiz.js`（在 sites） | 见第 2 条 |

### 2. `engine/` 章节（§3.1）严重低估：只列 5/11 个
文档列：bridge / quiz / quiz-vision / vision-deepseek-web / popup-quiz。
真实 `engine/` 共 **11 个**：`bridge.js`、`dedup.js`、`foreground.js`、`playback.js`、`policy.js`、`quiz-merge.js`、`quiz-vision.js`、`quiz.js`、`stats.js`、`targeting.js`、`vision-deepseek-web.js`。

- **漏写 6 个关键引擎模块**（均为续播/答题核心，非边缘）：
  - `playback.js`（播放/续播引擎，即"强制续播"本体）
  - `policy.js`（反挂机中和策略：静音/暂停/倍速/水印）
  - `foreground.js`（currentVideo/foregroundVideo 当前视频选取）
  - `targeting.js`（题目/视频目标筛选）
  - `stats.js`（统计）
  - `quiz-merge.js`
- **`dedup.js` 是独立模块**：文档把"_quizHandled 指纹去重"误归到 `quiz.js`，实际去重逻辑在 `engine/dedup.js`。
- **`popup-quiz.js` 不在 engine**（见第 1 条，它在 `sites/`）。

### 3. `presentation/` 章节（§3.4）严重低估：只列 4/13 个
文档列：panel-core / panel-template / panel-toast-feed / panel-ds-console。
真实 `presentation/` 共 **13 个**：`commands.js`、`dashboard.js`、`diagnostics.js`、`panel-controls.js`、`panel-core.js`、`panel-drag.js`、`panel-ds-console.js`、`panel-template.js`、`panel-toast-feed.js`、`panel.js`、`styles.js`、`toast.js`、`zhihuishu-fab.js`。

- 漏写 9 个：`panel.js`(面板总装)、`panel-controls.js`、`panel-drag.js`、`dashboard.js`、`diagnostics.js`、`commands.js`、`styles.js`、`toast.js`、`zhihuishu-fab.js`。
- **功能归属错**：文档称"Ninja FAB 拖拽（含 lostpointercapture/blur 自愈）"在 `panel-core.js`，实际拖拽逻辑在独立模块 **`panel-drag.js`**；智慧树专属 FAB 在 `zhihuishu-fab.js`。

### 4. `foundation/` 两处文件**不存在**
文档写：`foundation/env/env.js`（运行环境探测）、`foundation/dom/observers.js`。
- **`env.js` 不存在**。环境探测（isTopFrame / iframe / `@grant` 等）实际在 `foundation/utils/utils.js`（含 `isTopFrame` 等）。
- **`observers.js` 不存在**。MutationObserver 封装在 `foundation/dom/dom.js`（同目录另有 `lifecycle.js`、`session.js`），无独立 observers 文件。

---

## 🟠 中等不准确

### 5. 模块计数 "56" 不精确
实际源码树 **58 个 `.js`**。`build-manifest.txt` 登记 56 条，但 `takeover/meta.js` 与 `takeover/bootstrap/core.js` 由 `build-force-play.ps1` 作为 **IIFE 入口/引导独立前置注入**（`meta.js` + `core.js` 开 `(function () {`，末位 `})();`），不计入 manifest。建议表述为"build-manifest 登记 56 个模块，外加 meta.js/core.js 由构建脚本注入"。

### 6. `foundation/meta-config/{config,keys,constants}.js` 路径错
实际 `meta-config/` 仅 `config.js`。`CX_KEYS` 键名在 `foundation/storage/keys.js`（不是 meta-config/keys.js）；`constants` 无独立文件（在 config.js 内）。

### 7. `plugins/addons/` 漏 2 个
文档列 4 个（auto-next / keyboard-shortcuts / tamper-guard / video-ended-notify），真实 **6 个**。漏：`quiet-popups.js`（静默弹窗）、`zhihuishu-auto-next.js`（智慧树自动下一节）。

### 8. 构建顺序"main-loop 末位"有误（§7 / §6）
`build-force-play.ps1` 拼接顺序：`meta.js + core.js(IIFE 开) + manifest 顺序 + '})();'`。
`main-loop.js` 在 `build-manifest.txt` **第 24 行（sites 之前）**，是 takeover 域内的末位文件，**并非整体末位**（整体末位是 `})();`）。建议改为"main-loop 为 takeover 域末位，其后跟 sites → plugins → presentation"。

---

## 🟡 轻微不准确

### 9. EventBus 事件命名（§5）
文档写 `cx:*` 命名空间事件——**实际不存在**。真实事件：`ui:toast`、`ui:status`、`videos:scanned`、`targets:updated`、`zhExam:diag`、`zh-exam:state`、`ds-ask`/`ds-answer`/`ds-state` 等。建议去掉 `cx:*` 或补真实清单。

### 10. 数据流 §4.3 瑕疵
- 未体现 `ai` 源"异步回填 quizBank 后由 bank 命中"的闭环（quiz.js 行14-17 注释明确：ai 是预留，POST 到 `QUIZ_AI_ENDPOINT`，经 `quizBank` 闭环）。
- `deepseek-web` 实为 `QUIZ_VISION_OCR` 视觉选择器（截图 OCR 模式），与 random/bank/ai 三源不是并列关系，图中宜区分。

### 11. `perception/` 位置与遗漏（§3.5 / §4.5）
- `perception/` 在**仓库根目录**（与 `ecosystem/` 平级：`c:/Users/.../perception/cx_crawler/`），若文档写成 `ecosystem/perception/` 则路径错。
- `cx_crawler/` 实际含 10 个 `.py`：api_client / bridge / chapters / config / courses / dump / heartbeat / quizzes / render / session。文档列了 9 个，漏 `config.py`。

### 12. `foundation/` 漏子目录
文档未提及 `foundation/utils/`(url.js, utils.js) 与 `foundation/error-guard/`(guard.js) 两个子目录。

---

## ✅ 已验证准确（无需改）
- **分层总体方向正确**：takeover(foundation/engine/dom/bootstrap) + sites + plugins + presentation + perception(Python) + build/_sim。
- **文本混淆对抗流 §4.3**：html2canvas 按"渲染后视觉"截图、`tesseract`/`endpoint`/`deepseek-web` 三后端（tesseract 在 quiz-vision.js 真实存在，行9/228 起 `quizLocalOCR`），准确。
- **站点隔离** `detectSite()`（含 `deepseek` 分支）、**答案源可插拔**（random/bank/ai/deepseek-web），准确。
- **构建门禁链**（`build-force-play.ps1` 多门禁 + `_sim` 沙箱），准确。
- **跨进程桥接 §4.5**（bridge.py 收 HTTP → `output/` 写 JSON → 注入 `quizBank`/`CX_KEYS.QUIZ_BANK`），准确。

---

## 建议修正优先级
1. 先修 🔴 第 1–4 条（文件名/路径硬错误，直接误导）。
2. 再修 🟠 第 5–8 条（计数、键名路径、漏模块、构建顺序）。
3. 顺手收 🟡 第 9–12 条。

如需，我可直接据本复核把 `docs/ARCHITECTURE.md` 的 §3 模块职责表、§2 架构图节点、§7 构建顺序逐项改对。
