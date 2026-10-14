# 网课强制续播 · 代码性能优化建议

> 范围：`ecosystem/src/chaoxing-force-play/`（用户脚本核心）。
> 结论先讲：调度/轮询/视频遍历/容错层已做了扎实优化，**不建议推翻**。下面是按"真实热点 → 次要累积开销"排序、仍可进一步抠的点。每条含 `文件:行号`、现状、改法、预期收益。均为**建议**，未实际改码。

---

## 0. 已落地、无需重复造的优化（先确认，避免返工）

- 主循环脏检查短路、后台标签页降频、MutationObserver 帧合并、`TimerRegistry` 统一托管（`takeover/bootstrap/main-loop.js`）。
- 视频列表记忆化（`allVideos` 150ms TTL + `isConnected` 校验 + 容器选择器缓存 + `keyRe` 正则缓存，`dom/dom.js`）。
- 答题指纹脏代际缓存（`WeakMap` + `_quizDirtyGen`，`engine/quiz.js:35`、`_quizFingerprint` 115-136）、MO 防抖 800ms、`_quizTickCount % 30` 全量安全刷新、inline 计数替代 `_quizCountAnswered` 二次遍历。
- `throttle`/`bestEffort`(纯 try/catch，异常路径才进 `swallow` 建 Error)/`swallow` 环形缓冲（50 条，无泄漏）、`dbg`/`swallow` 在 `DEBUG` 关闭时早已退、字符串拼接仅在 DEBUG 开启时发生（`utils/utils.js:16-37`）—— **热路径调用 `bestEffort` 常态极廉价，不要因此恐慌**。

---

## 1. 高优先级（真实 CPU / 交互延迟热点）

### P0-1 答题题目列表每 tick 全量重扫 —— 最大的稳态开销
- 位置：`engine/quiz.js:501` `var qs = _pqQueryAll(root, sels.questionSels);`
- 现状：每轮 `quizTick` 对整棵 `document.documentElement` 跑 ~7 个**宽属性选择器**（`[class*="question"]`、`[class*="quiz-item"]` 等，`quiz.js:22`）。每个 `querySelectorAll` 是 O(全文档节点) 匹配，7 个叠加 → 每 tick 约 `7 × n`。视频侧早已记忆化+增量，答题侧却仍是每 tick 全量（仅"指纹重算"被缓存，题目**发现**本身没缓存）。
- 改法（仿 `allVideos` 记忆化，成本最低）：
  - 把题目列表缓存到模块级变量 + `WeakRef`/指纹 TTL，仅在 `_quizDirtyGen` 变化或 `_QUIZ_FULL_REFRESH_TICKS` 全量刷新 tick 时才重扫 `_pqQueryAll`。
  - 或先缩小根范围：作业/考试页通常有一个稳定做题容器（如 `.examPaper`/`.questionLi` 的祖先），先 `document.querySelector` 定位它，再在其内 `querySelectorAll`，把 O(全文档) 降到 O(题区)。
- 预期：大题量/长会话页稳态每 tick 省掉 7×n 次全文档选择器匹配，CPU 占用明显下降。

### P0-2 CDN 串行重试 → 首屏加载最坏 `超时×N`
- 位置：`engine/quiz-vision.js:113-134` `_quizLoadByMirror`；超时默认 15s（`_quizLoadScript`）。
- 现状：`_try(i)` 递归，**顺序**尝试每个镜像，前一个失败/超时（默认 15s）才试下一个。`quizSnapshot`/`quizOcr` 调用时未传 `timeout`，即走默认 15s。浏览器常按域名只拦其中 1~2 个 CDN，最坏情况要等 `15s × 7` 才能命中可达源。
- 改法：改为 **`Promise.any` 竞速** —— 同时发起所有镜像加载，第一个 `resolve` 即采用；保留"隐私开关未开启 → 立即 reject 且不重试"的语义（隐私早退分支不变）。注意 `USE_CORS`/全局校验仍需在 `onload` 里做。
- 预期：html2canvas 首屏可用时间从 O(Σ超时) 降到 O(最快一个源)，视觉识别路径卡顿基本消除。

### P0-3 截图 `scale:2` 过度采样
- 位置：`engine/quiz-vision.js:144` `h2c(el, { ... scale: 2 })`
- 现状：固定 2 倍像素，渲染像素量 4×。题目区节点通常不大，2 倍既多吃 CPU/内存，又让后续 `toDataURL`/OCR/上传的负载翻倍。
- 改法：按节点尺寸动态 scale —— 节点包围盒短边 < 某阈值（如 800px）用 `1`，否则 `1.5`/`2`；或直接默认 `1` 并保留 `CONFIG` 覆盖。
- 预期：截图渲染与下游处理成本显著下降，长截图内存压力降低。

---

## 2. 中优先级（每题 / 每 tick 累积开销）

### P1-1 `dsAvailable()` 在循环内每题重复调用
- 位置：`engine/quiz.js:586` 与 `590`（`_dsWebMode` 分支下，对每道未作答的题目各调一次）。
- 现状：若 `dsAvailable()` 实现内含 DOM 查询（登录态/应答端探测），则每题一次重复查询——同一 tick 内登录态不可能变。
- 改法：提到 `for` 循环外缓存一次：`var _dsOk = _dsWebMode ? dsAvailable() : false;`，循环内只读 `_dsOk`。
- 预期：deepseek-web 模式下每 tick 省掉 `未答题数` 次重复探测。

### P1-2 内存护栏 prune 每次都 `Object.keys(...)` 全量
- 位置：`engine/quiz.js:88-114`（`_quizPruneHandled`/`_quizPruneReviews`/`_quizPrunePending`），调用点遍布每题作答后（534/545/554/591/599 等）。
- 现状：每次 prune 都 `Object.keys(_quizHandled)` 收集键再判长度 → 即便未超 `CAP`，也是 O(n) 全量遍历；而每答一题就调用一次。
- 改法：用 `Map`（O(1) `.size`）替代 `{[fp]:true}` 普通对象；或维护 `_handledCount` 计数，仅在 `_handledCount > CAP` 时再 `Object.keys` 裁剪。
- 预期：大题库（几百题）每 tick 作答多题时，省掉重复的全量键收集。

### P1-3 `walkVideos` 每视频/每 iframe 都新建闭包 + `bestEffort`
- 位置：`dom/dom.js:352` `.bind(null, _vs[_vi], hostSigs)`、`368` iframe 递归分支。
- 现状：`walkVideos` 外层已 `try/catch` 包裹整个 `for`；内层却又对每个视频再 `bestEffort(function(v,hs){...}.bind(...), 'walk.eachVideo')`，并对每个 iframe 再建闭包。多 iframe / Shadow DOM 页面下每轮创建大量微闭包。
- 改法：移除内层 `bestEffort` 包裹（外层 try/catch 已兜底），直接 `onVideo(_vs[_vi], hostSigs)`；iframe 递归同理直接传参，不在循环里 `.bind` 新建闭包。
- 预期：多 iframe 页面每轮少量但稳定的闭包/函数对象分配减少，GC 压力略降（收益有限，属顺手优化）。

---

## 3. 低优先级 / 已知权衡（可不改或视场景）

### P2-1 Shadow DOM 全文档遍历
- 位置：`dom/dom.js:364` `Array.from(_ct.getElementsByTagName('*')).forEach(...)`，仅为找 shadowRoot。
- 现状：对每个容器收集其全部后代元素只为了定位 shadowRoot，O(全文档节点)。仅当某视频存在 `host`（`openOrClosedShadowRoot`）时才触发，影响面有限。
- 改法：先判容器是否真有 shadow 边界再遍历；或缓存已探测过的 shadow host，避免重复收集。
- 预期：含大量 Shadow DOM 的视频站略省；一般页面无感。

### P2-2 选项选择器每 tick 全量
- 位置：`engine/quiz.js:148-162` `_quizOptions`（每题每 tick 6 个 `querySelectorAll`）。
- 现状：选项节点与题目节点同生命周期，可随 P0-1 的题目列表记忆化一起缓存，避免每 tick 重查。
- 改法：在题目列表记忆化时顺带缓存每题的 `opts` 节点数组（dirty 代际失效时一起刷新）。
- 预期：与 P0-1 合并后，答题扫描的 DOM 查询量进一步下降。

### P2-3 指纹重算 `textContent` + `replace(/\s+/g)`
- 位置：`engine/quiz.js:124`、`129-130`。
- 现状：脏代际变化时对每题重读 `textContent` 并正则去空白。已截断到 120/200 字符，**安全且成本受控**，属有意权衡。
- 改法：暂不改；若实测长题干仍慢，可把 `replace(/\s+/g,'')` 换成按字符白名单遍历，但通常不值得。

---

## 4. 不建议改动（已是正确做法）
- `bestEffort` 纯 try/catch 包装、异常才建 Error —— 常态几乎零成本，不要为"性能"去掉容错。
- 主循环脏检查 / 后台降频 / MO 帧合并 —— 已是成熟设计。
- `swallow` 环形缓冲（50 条上限）—— 防内存泄漏，保留。
- 指纹 `WeakMap` 缓存 —— 节点回收自动清理，无泄漏，保留。

---

## 5. 验证方法（复用现有 `_sim` 测试，不新增临时脚本）
- 性能回归：在 `_sim/` 里新增轻量 sim（如 `sim-perf.js`）测量「稳态 tick 内 `querySelectorAll` 调用次数」与「首屏 html2canvas 加载耗时」，跑 `node_home/node-v24.19.0-win-x64/node.exe sim-perf.js`。
- 功能回归：改完跑现有 `sim-quiz-vision.js` / `sim-quiz.js` / `sim-width.js`，确认 0 失败。
- **严守仓库纪律**：临时校验脚手架放 `_ninja_test/`，绝不在仓库根创建 `.tmp_*.js` 后 `delete_file`（曾误删 `_sim/fixtures-dump-elements.js`，见 `CODE_REVIEW_RESULT.md:181`）。

---

## 优先级速览
| 项 | 文件:行 | 类型 | 优先级 |
|---|---|---|---|
| 答题题目列表每 tick 全量重扫 | quiz.js:501 | CPU(稳态) | P0 |
| CDN 串行重试改竞速 | quiz-vision.js:113 | 延迟 | P0 |
| 截图 scale:2 降采样 | quiz-vision.js:144 | CPU/内存 | P0 |
| `dsAvailable()` 循环外缓存 | quiz.js:586,590 | CPU(累积) | P1 |
| prune 的 `Object.keys` 全量 | quiz.js:88-114 | CPU(累积) | P1 |
| `walkVideos` 闭包冗余创建 | dom.js:352,368 | GC | P1 |
| Shadow DOM 全文档遍历 | dom.js:364 | CPU | P2 |
| 选项选择器每 tick 全量 | quiz.js:148 | CPU | P2（随 P0-1）|
| 指纹 textContent 重算 | quiz.js:124 | CPU | P2(不改) |
