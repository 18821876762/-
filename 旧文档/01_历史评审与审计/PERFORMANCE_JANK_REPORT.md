# 脚本使用卡顿原因排查报告 · 网课强制续播（chaoxing-force-play）

- 审查日期：2026-08-17
- 排查方式：热路径代码精读 + **性能探针实测**（jsdom 注入产物，包装 DOM API 统计查询/事件耗时；3000 节点课程页 + 播放事件 + 面板 + 高频 DOM 变更 + 500 键白名单五类负载）
- 注意：jsdom 无真实布局引擎，**QSA 比 Chrome 慢 10~30 倍**，下列绝对毫秒仅用于热点相对比较；真实浏览器请按「大页面节点数」同比折算。

---

## 一、结论摘要

**卡顿根因集中在两条稳态热路径 + 两个峰值场景**，其中两条稳态热路径已在本轮修复：

| 热点 | 机制 | 触发频率 | 影响 | 状态 |
|---|---|---|---|---|
| **① 播放中视频事件链 → 全树遍历** | timeupdate（~250ms）→ `foregroundVideo()`（150ms 缓存频繁失效）→ `allVideos()` → `walkVideos` 全树（container/iframe QSA + 全视频枚举） | 播放中 ~4 次/秒 | 大页面每次 10-30ms，**播放中持续掉帧** | ✅ 已修复（缓存窗口 150→1000ms，实测 qsa 27→17 次、事件成本减半） |
| **② 大白名单逐键正则匹配** | `videoBelongsToTask`/`videoIframeSrcsOf` 对每个候选 URL × 每个白名单键做边界正则 test（O(键数×URL×祖先深度)）；`_ovDriftGuard` 每 2s 每视频调用 | 每 2s × 每视频 | 500 键 × 4 URL ≈ 2000 次 test/视频；2000+ 键大章节时显著 | ✅ 已修复（合并组合正则一次 test，实测 qsa 减半） |
| **③ 每 2s 全量扫描** | 脏检查短路在「视频活动/弹幕 DOM 变更」下恒真 → 每 2s walkVideos 全树（增量模式跳过稳态视频的 overrideVideo，但枚举不可省） | 每 2s | 大页面每 2s 5-30ms | 设计内（P0 脏检查语义），保持 |
| **④ 面板可见时每 2s 全量刷新** | videos:scanned → refreshPanelState（150ms 节流）+ renderInvasionReport（1500ms）+ renderFeatureSelfTest（2000ms），各调 allVideos（150ms 缓存窗口内复用） | 面板可见时每 2s | 单次 60ms（jsdom）/ 5-15ms（真实） | 已节流，保持 |
| **⑤ MO 高频变更（弹幕/动态列表）** | 回调置脏 + 遍历 addedNodes 找 video（每节点 QSA）；rAF 帧合并 + 队列上限 1024 | 弹幕每帧 | 弹幕页每 2s 必扫（脏检查恒真） | 设计内，保持 |

**确认无瓶颈的面**：无题页 `quizTick` 已短路（实测 0 次 QSA）；`cxState` 为 WeakMap 无泄漏；`safePlay` 单例监听守卫；面板打开 177 次 `getElementById`（单次 <0.01ms，可忽略）；原型拦截每调用 ~0.1µs 级；`_dsIsLoggedIn` 5s 一次（精确选择器短路）；各内存队列全部有上限（上轮幂等审查已覆盖）。

---

## 二、热点 ① 播放中视频事件链 → 全树遍历（已修复）

### 机制链

```
video timeupdate (~250ms) / play / pause / ended
  → 视频监听器（_ovEnforce 挂 9 个 capture 监听，置 _videoActivity）
  → 主循环 tick 消费脏检查 → scanVideos（全量 walkVideos，增量跳过稳态视频）
  → 任意路径调用 foregroundVideo()（150ms 缓存）→ 失效时 allVideos()（150ms 缓存）
  → 失效时 walkVideos 全树：querySelectorAll(containerSel) + querySelectorAll('iframe') + getElementsByTagName('video') + shadow DOM 容器内扫描
```

播放中 timeupdate 每 ~250ms 一次 → foregroundVideo 缓存（150ms）在两次事件间必然失效 → **每 ~250ms 一次 allVideos 全树遍历**。3000 节点 jsdom 实测单次 walkVideos ≈ 13-18ms；真实浏览器 5 万节点页面 ≈ 10-30ms → 播放中每秒 4 次 × 10-30ms = **持续掉帧**。

### 实证（探针 B：16 次视频事件/2s）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| qsa 次数/耗时 | 27 次 / 362ms | **17 次 / 213ms** |
| 事件派发总耗时 | 330ms | **163ms** |

### 修复

`takeover/engine/foreground.js`：`_FG_TTL_MS` 150 → **1000ms**（附注释）。失效条件不变（缓存视频脱离文档立即失效；新视频最迟 1s 参与前台竞争——前台归属在秒级内变化极罕见，语义损失可忽略）。

---

## 三、热点 ② 大白名单逐键正则匹配（已修复）

### 机制链

```
videoBelongsToTask(v) / videoIframeSrcsOf(v)
  → 收集候选 URL（currentSrc/src/iframe 祖先链签名 × MAX_SCAN_DEPTH=16）
  → 对每个 URL × 每个白名单键 keyRe(key).test(url)   ← O(键数 × URL × 深度)
```

`_ovDriftGuard` 每 2s 对**每个视频**调用 `_ovDriftGuard` → `videoIframeSrcsOf`（祖先链遍历 + 逐键匹配）——稳态热路径。attachments 大章节白名单可达数百~数千键：500 键 × 4 URL × 深度 8 ≈ 1.6 万次正则 test/视频。

### 实证（探针 E：500 键白名单 + 全量重扫）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| qsa 次数/耗时 | 4 次 / 91ms | **2 次 / 50ms** |
| 事件派发耗时 | 114ms | **68ms** |

### 修复

- `takeover/engine/targeting.js`：新增 `keyReAll(idKeys)`——把全部白名单键合并为**单次交替正则**（每个键仍带 `(?:^|[^A-Za-z0-9])...` 边界包裹，逐键语义等价），一次 `test` 扫描整串 URL；按 idKeys 序列签名缓存（白名单重建时才重编译）；键串总长 > 20000 字符时回退逐键（正则爆炸保护）。`videoBelongsToTask` 优先走组合正则。
- `takeover/engine/dedup.js`：`videoIframeSrcsOf` 三处逐键循环统一收敛到共享 `_sigHits`（组合正则优先，回退逐键）——同一热链（drift guard 每 tick 每视频）同步受益。

---

## 四、保持现状的热点（设计内/已节流，附说明）

### ③ 每 2s 全量扫描（脏检查短路在活动期恒真）
视频播放（`_videoActivity`）或弹幕 DOM 变更（`_domDirty`）使 `consumeScanNeeded()` 恒真 → 每 2s walkVideos 全树。**这是「任意位置动态插入视频都能被捕获」的产品语义**（P0 脏检查），增量参数已跳过稳态视频的重复接管，枚举本身不可省。可选优化（未做）：把「全量枚举」从定时驱动改为「MO 信号驱动 + 节流」，改动面大、回归风险高，收益仅在大页面挂机场景（每 2s 5-30ms），留待后续评估。

### ④ 面板可见时每 2s 全量刷新
videos:scanned → 三个节流渲染器（150ms/1500ms/2000ms），各自 allVideos 在 150ms 缓存窗口内复用（实测同一 tick 内不重复全树遍历）。单次刷新 jsdom 60ms / 真实 5-15ms。可选优化（未做）：hero 区按内容指纹跳过 innerHTML 重写——收益低。

### ⑤ 弹幕类高频 DOM 变更
MO 回调对新增节点逐一 `querySelectorAll('video')`（rAF 帧合并 + 队列上限 + 后台 setTimeout 排空）。弹幕页每 2s 必扫（脏检查恒真）属语义内。可选优化（未做）：对新增节点先按 tagName/类名快速筛除明显非视频容器——收益低（真实浏览器 QSA 快）。

### 其他已确认无问题
- 无题页 quizTick 已短路（探针 F：10 次调用 0 次 QSA）
- `cxState` WeakMap（无节点状态泄漏）、各内存队列全上限（上轮幂等审查）
- 面板 177 次 getElementById（单次 <0.01ms）、`_cxPanelDefrostCheck` 400ms 节流、Ninja 拖拽 rAF 合并
- `_dsIsLoggedIn` 每 5s（精确选择器短路）、html2canvas/tesseract 懒加载 + 缓存

---

## 五、验证证据（全部实测）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | Fast 构建门禁（node --check / contract ×5 / metadata / cross-module + selftest） | 全绿 PASSED |
| 2 | 全量 `_sim` 回归 | **55/55 passed, 0 failed** |
| 3 | `node tests/pure.test.js` | ALL PASS（52 断言） |
| 4 | 探针 B（播放中视频事件链）：qsa 27→17 次、事件 330→163ms | 修复生效 |
| 5 | 探针 E（500 键白名单）：qsa 4→2 次、事件 114→68ms | 修复生效 |
| 6 | 探针 A/C/D/F（稳态/面板/弹幕/无题页） | 无行为回归、无错误 |

---

## 六、改动清单

- `takeover/engine/foreground.js`：`_FG_TTL_MS` 150→1000（播放中全树遍历频率降 ~4 倍）
- `takeover/engine/targeting.js`：新增 `keyReAll` 组合正则 + `videoBelongsToTask` 接入（超长回退逐键）
- `takeover/engine/dedup.js`：`videoIframeSrcsOf` 三处循环收敛到组合正则（drift guard 热链同步优化）
- `docs/CROSS_MODULE_CONTRACT.md`：按流程重新生成（keyReAll 跨模块符号登记）
- 产物 `ecosystem/chaoxing-force-play.user.js` 已重建

> 探针留存：`_ninja_test/perf-probe.js`、`_ninja_test/perf-probe2.js`（可复跑对比）。

---

## 七、追加修复（2026-08-17 用户反馈「学习通视频页/答题页一进入就卡顿」）

针对真实站点反馈复现的两条**持续卡顿**路径（区别于前述的周期性开销）：

### 7.1 视频页：`_ovDriftGuard` 换源误判 → 每 tick seek 循环（已修复）

- **机制**：`_ovDriftGuard` 的进度记录键为 `[currentSrc, ...iframe 签名]`（`dom.js`）。**同一 iframe 换新视频**（学习通切章节/换课，src 变但 iframe id/签名不变）→ 旧 iframe 签名的 `_srcMaxTime` 残留 → 新视频 `t=0 < max-1.5` 被误判为「平台回拨」→ 每 2s tick 对新视频 `currentTime = 旧进度（甚至 d-0.5 末尾）`——**每次 seek 触发播放器重定位（100-500ms 卡顿），且新视频进度被反复跳到旧位置，表现为「一进入就卡顿 + 进度乱跳」**。
- **修复**（`dom.js`）：
  1. **换源重置**：记录每视频最近 keys（`cxState(v).driftSrc/driftKeys`），currentSrc 变化时删除旧 keys 的进度/stall 记录——换源后从 0 重新计（同 src 重建去重语义不受影响）；
  2. **回拨冷却**：`v.__cxDriftAt`（原已写未读）生效——回补后 5s 内不再重复 seek（学习通防挂机高频回拨时，seek 频率从每 2s 降到每 5s；单次回拨场景零影响）；
  3. **键上限**：`_srcMaxTime` 5000 键淘汰（防超长会话换源累积）。
- **实证**（`_sim/sim-jank-guards.js` 场景 A，双窗口 jsdom 复现同 iframe 换源）：修复后换源+回拨 2 tick 内 seek = **0 次**（修复前每 tick ≥2 次）。

### 7.2 答题页：MO 高频触发 → 全题缓存持续失效 + 扫描交错（已修复）

- **机制**：答题页倒计时/动态元素每秒变更 DOM → 题目 MO 每 800ms 防抖触发一次 → 每次 `_quizDirtyGen++`（**全部题目缓存失效**）→ quizTick 全文档扫描 + 全题 textContent 重读；与主循环 2s 扫描交错后 **≈ 每秒一次全题重读**（大题库页持续卡顿）。
- **修复**（`quiz.js`）：
  1. **MO 防抖 800→1500ms**：MO 驱动扫描频率降至 ~2.5s 一次（主循环 2s 兜底，题目出现最迟 ~1.5s 触发）；
  2. **置脏节流 2000ms**：`_quizBumpDirty()`——倒计时等高频变更不再每次失效全部缓存（缓存陈旧上限 2s，与主循环安全刷新节奏一致）。
- **实证**（`_sim/sim-jank-guards.js` 场景 B，倒计时页 7s）：MO 驱动 quizTick **3 次**（修复前 ~4-5 次）、全文档 qsa 16 次/3.5ms。
- **回归适配**：`_sim/sim-quiz-incremental.js` 的 C 场景等待窗口 1000→2000ms（对齐新防抖/节流语义，注释说明；新题识别不依赖缓存，语义零损失）。

### 验证

| # | 验证项 | 结果 |
|---|---|---|
| 1 | 复现探针（换源 seek / 答题页扫描频率） | 3/3 PASS |
| 2 | 全量 `_sim` 回归（新增 sim-jank-guards；sim-quiz-incremental 适配后） | **56/56 passed** |
| 3 | 构建门禁（node --check / contract ×5 / metadata / cross-module + selftest） | 全绿 |
| 4 | `node tests/pure.test.js` | ALL PASS（52 断言） |

### 本轮新增改动

- `takeover/dom/dom.js`：`_ovDriftGuard` 换源重置 + 回拨冷却 + 键上限
- `takeover/engine/quiz.js`：MO 防抖 1500ms + 置脏节流 2000ms（`_quizBumpDirty`）
- `_sim/sim-jank-guards.js`（新回归）、`_sim/sim-quiz-incremental.js`（等待适配）
- 产物已重建

---

## 八、真机复测（2026-08-17 晚，用户反馈「依然卡顿、两道题就卡、面板打不开」）

用户反馈升级后，用 **Playwright + 完整 Chromium 渲染管线**做了真机级复测，并引入**真实学习通页面结构**（仓库内 `学习通视频元素.txt` 顶层 dump：1681 节点 + 8 iframe 骨架 + 合成播放器 iframe 高频 UI/平台 pause/rate 对抗）：

| 测量（CDP Performance.getMetrics） | 结果 |
|---|---|
| 真实结构 + 平台对抗下，脚本增量开销 | **34ms / 15s = 0.23% 主线程**（基线对比法） |
| 模拟答题页（两道题+倒计时+动画）20s | JS 81ms = 0.4% 占用，0 错误，堆稳定 |
| 模拟视频页 20s | JS 84ms = 0.4% 占用，0 错误 |
| 脚本注入同步耗时（真实结构） | **27ms** |
| 按 P 打开面板同步耗时（真实结构） | **41ms**（面板在注入时即构建完成） |
| 平台 pause/rate 对抗下的响应频率 | play 0 次/s、ratechange 0 次/s（原型中性化拦截），quizTick 0.5 次/s |

**结论：在可模拟的范围内（含真实 DOM 结构、平台对抗、高频 DOM 变更），脚本本体主线程占用 <0.5%，注入与面板操作均为几十毫秒级——脚本稳态开销不是「两道题就卡到打不开面板」的原因。** 真实环境卡顿更可能来自：页面自身 JS 负载 × 脚本的特定交互、用户环境（脚本管理器多实例/旧版残留/其他脚本或扩展冲突）、或真实页面的动态行为形态与模拟不同。

**定位手段（已交付）**：`_ninja_test/chaoxing-diag.js` —— 在真实卡顿页面控制台粘贴运行（12s），输出帧结构（每帧节点数/脚本注入状态）、长任务分布、rAF 掉帧、页面错误，据此精确定位。配套排除法：① 禁用脚本后对比（确认是否脚本引起）；② 只开一个脚本管理器；③ 检查是否存在旧版本脚本残留（脚本更新后旧实例未清除）；④ 查看控制台红色报错（多为页面自身代码）。

---

## 九、真机定位闭环（2026-08-17 深夜，用户实跑诊断 + 「关 DeepSeek 页即不卡」）

用户实跑诊断 v2 并给出决定性线索「**关闭 DeepSeek 网页时就停止卡顿**」：

### 真机数据（学习通作业页 doHomeWorkNew，506 节点，位于 work iframe 内）

- 长任务：`55 / 971 / 983 / 966 / 1877 / 3457ms`（帧归属 `?` = 脚本自身主线程工作）；平台 API 请求长任务仅 125/131ms（`/mooc-ans/api/work`）
- rAF 掉帧间隙最大 **8154ms / 11431ms**；按 P 面板响应实测 **3276/3444ms**
- 作业页帧链：顶层 1652 → cards 248 → work 13 → **doHomeWorkNew 506 节点**

### 根因确认：视觉识别（DeepSeek 网页版）的 html2canvas 同步截图

- 答题路径：`答案来源=AI（视觉识别+DeepSeek）` 开启时，无题库命中的题目走 `_quizVisionAnswer` → **html2canvas 同步渲染截图**（主线程长任务）
- **html2canvas 截图耗时与画布面积成正比**：真实题块（数百 px 宽）在默认 `scale:2` 下每张截图 **1~3.4s 同步阻塞**——与诊断长任务 971~3457ms 精确吻合
- 两道题 = 两次 1-3s 卡顿 → 「两道题就卡到面板打不开」；**DeepSeek 页关闭 → 应答端不可用 → 答题改走随机兜底（不截图）→ 不卡**——与用户观察完全一致（视频页无截图路径，故正常）

### 修复（`quiz-vision.js` + 面板提示）

1. **默认 scale 2 → 1.5、MAX_DIM 1600 → 1280**：画布面积约 -60%，截图耗时同比例下降（保留 `cx_quiz_vision_scale` 手动覆盖：1 最快 / 2 最清晰）；
2. **按题块尺寸自适应**：长边 ≤500px 的小题保持 2 倍清晰度（识别优先），大图限 1.5 倍；
3. **面板提示**（`panel-template.js` 做题区）：明示「视觉识别需截图题目，大题目每张约 1~3s 阻塞主线程；卡顿时关闭本开关走题库/随机，或设 `cx_quiz_vision_scale=1`」。

### 验证

| # | 验证项 | 结果 |
|---|---|---|
| 1 | 构建门禁（含契约/metadata/cross-module + selftest） | 全绿 |
| 2 | 全量 `_sim` 回归（含 sim-quiz-vision 视觉闭环） | **56/56 passed** |
| 3 | 面积比验证 | scale 1.5/2 → 面积 56%，耗时理论 -44%；MAX_DIM 1280 再收口大图 |

> 本质说明：html2canvas 是同步渲染，**无法彻底消除截图长任务**（分片/Worker 不可行——需 DOM 访问）。已做的是「面积 -60% + 自适应保清晰 + 面板明示」；**答题页卡顿时最有效的操作是关闭「用 DeepSeek 网页版作答」**（走题库/随机，零截图）。

---

## 十、状态机优化（2026-08-18 晨，用户反馈「相比老版本依然非常卡顿」）

定位「老版本不卡、新版本卡」的结构性差异：**4.17+ 引入了「MO 驱动答题扫描」与「脏检查全量扫描」**——多 iframe 页面（学习通作业页 4 层帧链 + 播放器帧 + 6 个 about:blank，每帧都注入脚本）在**无题/播放稳态**下各自每 1.5~2s 做全文档扫描，累积为持续卡顿（老版本只有顶层 2s 轮询，无 MO 驱动）。按「调度状态机」思路优化三处：

### 1. 答题引擎 MO 防抖「按变更性质动态切换」（quiz.js）

- **题目相关变更**（变更节点/新增节点类名含 `question/quiz/timu/题/answer/option/stem/exam`）→ **1200ms 短防抖**：题目出现/更新即时作答，零检测延迟
- **无关变更**（倒计时/动画/进度刷新）→ **5000ms 长防抖**：无题帧（含播放器 iframe）的 MO 驱动扫描频率降 ~3 倍

### 2. quizTick「无题稳态节流」（quiz.js）

- 上次扫描 0 题且距上次扫描 <4s → 主循环驱动的全文档扫描直接跳过（2s → 4s）
- **MO 驱动豁免节流**（`_quizMOForced` 标记）：题目出现由 MO 短防抖即时接管，不被节流挡住

### 3. 主循环「播放稳态扫描降频」（main-loop.js + dom.js）

- 脏检查标志拆分为 `_domDirty`（结构变更，新视频必经）与 `_videoActivity`（播放事件）
- **结构变更 → 每轮全量扫描（零语义损失：新视频/重建元素仍由 MO 即时发现）**
- **播放活动 → 全量扫描每 2 轮一次（播放稳态 2s → 4s）**

### 验证

| # | 验证项 | 结果 |
|---|---|---|
| 1 | 构建门禁（契约/metadata/cross-module + selftest，映射表已重新生成） | 全绿 |
| 2 | 全量 `_sim` 回归（含 sim-quiz-incremental MO 失效、sim-quiz-vision、sim-jank-guards） | **56/56 passed** |
| 3 | 对抗负载探针（perf-probe4）：quizTick 驱动频率 | **0.5 → 0.2 次/秒（-55%）** |
| 4 | 有题响应性 | MO 有题线索 1.2s 防抖，无节流拦截（回归用例覆盖） |

---

## 十一、交互延迟回归定位与修复（2026-08-18 上午，用户反馈「整体反应慢（交互延迟）」）

用户澄清「老版本」同为 4.18（版本号未 bump）——即 **Release 4.18（commit 7e577a0 产物）**。用 Playwright A/B（同一真实结构页面分别注入 Release 4.18 与当前构建）实测交互响应：

### A/B 实测（20 次按键 + 点击，5s 窗口）

| 指标 | Release 4.18（老版本） | 当前构建（修复前） | 当前构建（修复后） |
|---|---|---|---|
| 按键平均响应 | 1.3ms | **4.6ms（3.5 倍）** | **1.0ms** |
| 按键最大响应 | 7ms | **41ms** | **9.4ms** |
| 按键 >30ms 次数 | 0 | 1 | **0** |
| 主线程占用 | 0.9% | 1.5% | 1.3% |

### 根因（Profiler 逐帧定位）

1. **`_cxPanelDefrostCheck` 的面板 `getBoundingClientRect`**：真实大页面单次 **~24ms**（面板子树布局）——旧实现在 `panel:refresh` **同步链内**执行，每次按键/切 tab 都触发（节流 400ms 且 rect 在节流检查之前读取）；
2. **`renderInvasionReport`/`renderFeatureSelfTest`**（8-17 新增的侵入点/自检渲染器）直接订阅 `panel:refresh`，每次按键全量重建（遍历所有帧 + 大段 HTML）；
3. 主循环 tick 的重扫描（scanVideos/runSiteTick）在同步段执行，与按键事件撞车时产生峰值。

### 修复（panel.js / main-loop.js）

1. **defrost 延迟调度**：`panel:refresh` 只置待办标记，`setTimeout(0)` 队尾执行——按键同步链不含 24ms rect（遮挡检测延迟 ~1 帧，语义无损）；窗口 400→3000ms；
2. **渲染器节流**：invasion/selfTest 的 `panel:refresh` 路径加 500ms 节流（videos:scanned 路径 1500/3000ms 错峰）；
3. **主循环重活队尾化**：scanVideos 与 runSiteTick 推迟到 `setTimeout(0)`——排队中的交互事件先处理，扫描延迟 ~0-50ms 无感知（新视频仍由 MO 即时发现）。

### 验证

| # | 验证项 | 结果 |
|---|---|---|
| 1 | A/B 交互探针（pw-ab-interact.js） | 按键 4.6→**1.0ms**，峰值 41→9.4ms，>30ms 归零 |
| 2 | 按键链 Profiler（pw-key-profiler.js） | getBoundingClientRect 28ms→0（同步链内） |
| 3 | 全量 `_sim` 回归 | **56/56 passed** |
| 4 | 构建门禁 | 全绿 |

---

## 十二、加载感知回归修复（2026-08-18 中午，用户反馈「视频和题目加载出来的速度减慢」）

降频优化把「检测延迟」拉长，针对三条感知路径逐一修正（省扫描收益保留，检测及时性恢复老版本水平）：

### 1. 题目出现→作答延迟（quiz.js）

- **MO 有题防抖 1.2s → 0.8s**：与老版本 MO 防抖一致——题目出现后最快 0.8s 作答（无关变更仍 5s 低频，倒计时/动画场景的省扫描收益由线索分类保留）；
- **quizTick 无题节流 4000 → 2000ms**：主循环兜底扫描恢复每 2s 一次（与老版本一致），题目检测兜底延迟上限回到 2s（无 MO 场景）。

### 2. 视频 released 重接管延迟（dom.js + playback.js + bridge.js）

- 播放稳态扫描降频（2s→4s）会让「释放→重新归属」的视频重接管延迟到 4s——新增 **`markDomDirty()`** 状态变化触发：
  - `releaseVideo`（释放态变化）→ 置脏
  - `restoreNativePause`（桥 skipResume 释放视频）→ 置脏
  - 桥 `skipResume` 从 true 恢复 false（章节重新未完成）→ 置脏
- 效果：**重接管延迟上限回到主循环节奏 ≤2s**（与老版本一致），省扫描收益仅在稳态保留。

### 验证

| # | 验证项 | 结果 |
|---|---|---|
| 1 | 全量 `_sim` 回归（含 sim-drift-guard/sim-quiz-incremental/sim-bridge-validate） | **56/56 passed** |
| 2 | 构建门禁（cross-module 映射表已重新生成：markDomDirty 跨模块符号登记） | 全绿 |
| 3 | 交互 A/B 探针（回归确认未破坏） | 按键 ~1ms（前轮验证） |

> 性能对价说明：本轮三处均为「检测及时性 vs 省扫描」的平衡点修正——MO 动态防抖（无关 5s/有题 0.8s）+ 主循环 2s 兜底 + 状态变化置脏，与老版本（固定 2s 轮询 + 0.8s MO）的检测延迟持平，同时保留了多 iframe/播放稳态的省扫描收益。

---

## 十三、主控面板使用卡顿修复（2026-08-18 下午，用户反馈「使用主控模板也非常卡顿」）

用 Playwright 面板探针（pw-panel-probe.js）实测面板打开常驻开销与刷新链：

### 实测数据

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 面板 DOM 规模 | 539 节点 | 539 节点（模板本身，不改结构） |
| 面板打开常驻（8s） | JS +14ms（每 2s 刷新 ~3.5ms） | **+10ms（每 2s 刷新 ~2.5ms）**，布局/样式 0-2ms |
| 切 tab 刷新链 getBoundingClientRect | **40ms**（defrost 24ms + 布局抖动） | **0**（链内无显著耗时函数，Top 全 <2ms） |
| A/B 按键响应 | 4.6ms | **0.8ms**（老版本 1.4ms） |
| 主线程占用（5s 窗口） | 1.5% | **0.7%（低于老版本 0.9%）** |

### 修复（panel.js / dashboard.js / site-router.js）

1. **defrost 窗口 3000→10000ms**：遮挡检测是极低频事件，面板打开期间每 10s 检查一次（交互链零 rect 开销，遮挡恢复延迟可接受——重开面板即时恢复）；
2. **hero 区内容指纹**（dashboard.js）：播放中 currentTime 秒级变化，但 fmtTime 内容在秒内相同——指纹未变则**跳过全部 DOM 写**（每 2s 刷新触发布局的主要来源）；
3. **detectSite 结果缓存**（site-router.js）：URL（hostname+pathname）未变复用上次结果——该函数被 tick/事件/渲染高频调用（edu.cn 分支含运行时全局读取）；**edu.cn 域不缓存**（保留「ananas 就绪后延迟升级 chaoxing」的实时判定语义）。

### 验证

| # | 验证项 | 结果 |
|---|---|---|
| 1 | 面板探针（pw-panel-probe.js） | 刷新链 rect 40→0ms；常驻 +14→+10ms/8s |
| 2 | A/B 交互探针 | 按键 0.8ms（老版本 1.4ms）；>30ms 0 次 |
| 3 | 全量 `_sim` 回归 | **56/56 passed** |
| 4 | 构建门禁（cross-module 映射表已重新生成） | 全绿 |

---

## 十四、用户确认恢复（2026-08-18 晚）

用户安装最新产物（`chaoxing-force-play-latest.user.js`，含 §七~§十三全部修复）后确认：**视频页、答题页、交互响应、主控面板、加载速度均已恢复**。本轮性能链路闭环——最终状态：总主线程占用低于老版本（0.7% vs 0.9%）、交互响应快于老版本（0.8ms vs 1.4ms）、检测延迟与老版本持平、调度单元零残留。
