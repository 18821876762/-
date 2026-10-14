# 自动答题链路（QUIZ_PIPELINE）

> 权威细颗粒度说明：从「题目出现在页面上」到「答案被点选、作业被识别为已提交」的完整链路。
> 配套阅读：`docs/CHANGELOG.md`（v4.19.x 十连修记录）、`docs/CONTRACT.md`、`docs/CROSS_MODULE_CONTRACT.md`。
> 适用版本：4.19.10+。

## 0. 链路总览

```
站点适配(chaoxing-exam.js CHAOXING_EXAM 选择器)
  → 题目检测(quiz.js quizTick / quizScanOnce / MO / 子帧待答重扫)
  → 信号灯登记+同步(quiz.js _quizLights / 跨帧 postMessage / GM 跨页镜像)
  → 作答调度(自动启动开关 / 手动开始 / 挂起)
  → 答案求解(文本路径 bank/ai/random → 视觉路径 quiz-vision.js)
  → DS 通道(vision-deepseek-web.js GM 桥 / 子帧懒通道 / ds-state)
  → 混淆字体解码(quiz-vision.js _quizDecodeSecretText)
  → 回复解析(vision-deepseek-web.js _dsParseAnswer)
  → 点选+提交(quiz.js _quizClick / _quizMaybeSubmit)
  → 提交态识别(quiz.js _quizPageSubmitted) → 全灯绿、停止作答
```

## 1. 站点适配

| 项 | 值 | 说明 |
|---|---|---|
| 站点模块 | `sites/chaoxing-exam.js` | `registerSiteTick('chaoxing', chaoxingTickQuiz)` 注册表驱动 |
| questionSels | `div.TiMu` 等 | 2026-08-14 真实页校准；仿真复现 `sim-quiz-chaoxing.js` |
| stemSels | `div.Zy_TItle` / `span.newZy_TItle` | 题干容器 |
| optionSels | `ul.Zy_ulTop > li` 等 | 真实页选项 `li.font-cxsecret.before-after`（`role=radio`，`onclick=addChoice`） |
| submitSels | `a.btnSubmit.workBtnIndex` 等 | 提交按钮（提交识别信号③依赖其消失） |

## 2. 题目检测（四路互补）

| 路径 | 触发 | 作用域 | 备注 |
|---|---|---|---|
| 主循环站点 tick | 顶层 2s `runSiteTick('chaoxing')` | 仅顶层帧 | v4.19 起顶层帧唯一主循环 |
| 一次性补扫 `quizScanOnce` | MO 挂载 +1200ms 后立即一次 | 每帧 | v4.19.1：静态题在挂载前已渲染时 MO 永不触发，补扫对齐 v4.18 检测语义 |
| MO 动态防抖 | MutationObserver，题目线索 800ms / 无关变更 5s | 每帧 | `quizObserveDispatch` 经 `runSiteTick` 走站点选择器（D10） |
| 子帧待答重扫 `_quizRetryTimer` | 有待答题时 2s 一次（仅子帧） | 子帧 | v4.19.5：子帧无主循环、静态页无 MO 事件 → DS 就绪后无人重判，重扫推动门控→视觉→作答 |

节流：无题稳态 2s（`_quizLastScanAt`）；`_quizMOForced` 强制扫描免节流；置脏节流 2s（`_quizBumpDirty`）；全量安全刷新每 30 tick 强制脏代际 +1。

## 3. 信号灯（七态七色，v4.19.13 起）

- **语义**（推导优先级从高到低）：
  - **红=完全失败**（`_quizAIFailed` 冷却 / `_quizAIProblems` 严格失败登记）；
  - **黄=作答中/待确认/待复核**（busy，`kind` 细分：`answering`=`_quizVisTimers`/`_quizAIPending` · `confirm`=`_quizPendingSubmit` 待确认提交 · `review`=`_quizReviewItems` 待人工复核）；
  - **橙=信息缺失**（`_quizInfoMissing[fp]`：无选项/题干无法识别，且未作答；有选项后 `delete` 解除）；
  - **紫=暂时受阻**（`_quizDsGraceUntil`：DS 通道建立宽限窗口内，仅非手动挂起题）；
  - **蓝=特殊情况**（`_quizManualHold`：自动启动关闭·挂起不作答）；
  - **绿=已完成**（`_quizHandled`）· **黑=未进行**（idle）。
  - 已作答态恒覆盖新增三态避免误显（橙/紫/蓝推导均带 `!_quizHandled[fp]` 守卫）。
- **登记**：按发现顺序，`_quizLightFp[fp] = 下标+1`（v4.19.1：首灯下标 0 为假值导致重复登记，改为 +1 且守卫用 `in`）。
- **指纹 fp**：`quiz:<seq>:<len>:<stem480>#<optN>:<opt480>`（题号+加长题干+选项全量签名；混淆文本下数字题号可信）。
- **跨帧同步**（子帧→顶层面板）：全量快照 postMessage（目标 origin 收窄、仅同源）；**按源帧（e.source）替换**——空快照=清该源陈旧灯（v4.19.3，SPA 重建 iframe 后旧灯残留的根因）；快照携带 `kind` 与失败 `msg`（v4.19.12/4.19.1）。
- **跨页镜像**（课程页→DeepSeek 应答端面板）：顶层帧经 GM 键 `cx_quiz_lights_v1` 广播（签名去重、空态不覆盖）；DS 页监听写入 `quizLightsRemote` 并触发 `quiz:lights`（v4.19.9）。
- **上限**：`_QUIZ_LIGHTS_CAP=200`，淘汰最旧非 busy 灯。
- **面板配色**：done #10b981 / fail #ef4444 / busy #f59e0b / blocked #a855f7（紫）/ special #3b82f6（蓝）/ missing #f97316（橙）/ idle #374151。

## 4. 作答调度

| 开关 | 键 | 语义 |
|---|---|---|
| 总开关 | `cx_quiz_auto` | `'0'` 完全禁用（toast 提示） |
| 自动启动 | `cx_quiz_auto_start`（默认开） | 关 → 只扫描登记灯（黑），不发起请求/点选/提交 |
| 手动开始 | 面板「▶ 手动开始答题」 | `quizManualStart` → 置 `_quizManualArmed` → 经 `runSiteTick(detectSite())` 走站点选择器（v4.19.1：旧实现裸 `quizTick()` 用通用选择器，超星扫不到） |
| 自动提交 | `cx_quiz_autosubmit` | 答完是否点提交 |

跳过计数（遥测 `跳过[已答/冷却/弹窗/挂起/无选项/门控]`）：每轮 tick 记录每题被哪条路径跳过，随跨帧广播上报顶层诊断。

## 5. 答案求解

1. **文本路径** `_quizResolveAnswer`：`bank`（本地题库 `cx_quiz_bank`，题干子串匹配）/ `ai`（自建端点，异步回填）/ 默认 `random`（仅兜底，置信度低）。
2. **视觉路径**（`CONFIG.QUIZ_VISION_ENABLED` + `QUIZ_VISION_OCR=deepseek-web`）：
   - `quizSnapshot`：html2canvas（CDN 多镜像；scale 默认 1.5、MAX_DIM 1280、小图 2x；视口内化 + 串行队列）。
   - **混淆字体解码** `_quizDecodeSecretText`（v4.19.8）：超星 font-cxsecret 用「自定义字体+透明色/text-shadow」混淆，截图对 shadow/透明文本渲染为空（实测只剩 ABCD）→ canvas 按页面字体渲染字形，与常用汉字字形库（64 位 FNV-1a 指纹，分片 ≤40ms，按字体族缓存 10 分钟）比对还原真实题干/选项。
   - **提示词演进**：v4.19.19 硬格式约束（仅字母连写）→ v4.19.25 后果式约束（「逐字解析，非字母即判错」）→ **v4.19.31 重写**（去掉恐吓句；题型判断+简短内部推理+few-shot；多选明确「可能只有 1 个正确字母」；判断强制输出选项字母；**已还原文本提升为主要作答依据**「若与截图不一致以文本为准」）→ **v4.19.32 反思核对**（作答前逐项比对选项与限定词 不/除了/错误的是；强制结构化输出 `答案：<字母>｜置信：高/中/低`）。
   - **置信分级落点**（v4.19.32）：`_dsReadConfidence(text)` 抽取确定性（显式格式/隐式犹豫词/自相矛盾降级，默认 high）；`_quizVisConfAction(conf)` 单一决策源——high→点选+可提交 / mid→点选但强制挂起待确认 / low→不盲选、随机兜底+入人工复核队列（修复旧实现恒 conf=1.0 无条件点选甚至直交）。
   - 视觉超时 `_quizVisTimers`：deepseek-web 默认 90s 预算（v4.19.21 对齐 DS 问答链，晚到答案仍采纳），其余模式 45s。
3. **截图与文本双保险**（v4.19.28）：`ds-ask` 恢复携带截图（渲染后的真实视觉为作答依据），解码文本作辅助；v4.19.15 的 text-only 兜底仍在截图空白/不可用时生效。

## 6. DeepSeek 通道（跨标签页/跨域）

- **传输**：GM 存储**双键路由**（v4.19.28，按 `msg.type` 分发）——`cx_ds_ask_v1` 承载 `ds-ask`（含多 MB 截图 base64），`cx_ds_bridge_v1` 承载心跳/回传（`ds-state`/`ds-answer`/`ds-ping`）——大值写入不再挤掉心跳键（修复 4.19.27 纯文本方案的 60s 超时根因）；`_dsClearBridge` 仅清 `cx_ds_ask_v1`；消息白名单 `ds-state/ds-ping/ds-ask/ds-answer`。
- **顶层帧编排**：通道只在顶层帧或 DS 页建立（v4.19 性能收敛）。
- **子帧懒通道** `_dsEnsureChannel`（v4.19.2/4）：子帧首次真正需要 DS 时按需注册 GM 监听（无题帧零开销）；补最小 ds-state 处理器 → 子帧 `DS_STATUS` 随心跳（5s）更新。
- **门控宽限**（v4.19.2）：`dsAvailable()` 恒 false 的子帧给 ≤10s 的 ds-state 到达窗口，窗口内不误判「应答端不可用」；`dsAvailable()` 同源时回读顶层 `DS_STATUS`。
- **应答端**（DeepSeek 页）：注入提示词+粘贴截图 → 轮询回复（v4.19.20 流式终态稳定性：同一文本连续两轮一致才为终态）→ `_dsParseAnswer` 解析 + `_dsReadConfidence` 置信 → 回包 `ds-answer`。

## 7. 回复解析与答案令牌（v4.19.7/4.19.14/4.19.16/4.19.19）

- **`_dsParseAnswer`**（应答端解析回复文本，v4.19.7）优先级：
  ① 多选字母簇（`AB`/`A、B`，簇后紧跟否定词则跳过）② 前缀+字母（答案/正确选项/应选/选择/选/应为/应该是/是/为，紧邻否定锚定 + 前缀前「不/非」检测）③ 孤立字母（前后空白/标点）④ 单字母兜底（全文唯一 A-D 字母且无否定词）⑤ 数字下标 ⑥ 判断/是非语义词（正确/错误，无字母时才走）。
- **`_quizAnswerParse`**（子帧把答案令牌映射为选项下标，v4.19.14 导出测试钩子）：散文判定仅当文本含选项范围外字母(I–Z)才视为散文（v4.19.16——纯选项字母串 ABCD/ABC 整体落在 A–H，不当散文、正常解析为多选下标）。
- **思考态前缀剥离**（v4.19.16）：`_dsLatestReply` 取回复文本后剥离「已思考/已深度思考（用时 N 秒）」前缀，避免污染诊断文本与误解析。
- **硬格式提示词**（v4.19.19）：`VISION_PROMPT` 只允许「单个大写字母 / 连续大写字母」，禁前缀/解释/标点/换行——短回复降低 responder 收敛时间、降低 45s `vision-timeout` 概率。
- 回归：`_sim/sim-ds-parse.js`（21 断言）、`_sim/sim-quiz-answer-parse.js`（5 断言）。

## 8. 提交态识别（v4.19.10/4.19.11）

`_quizPageSubmitted`（导出 `window.__CX_FORCE_PLAY.quizPageSubmitted` 供回归断言）任一信号命中即视为已提交：
- ① URL 结果页标记（showWorkResult/viewWorkResult/workResult/examresult/resultpage/scoreresult/markresult）；
- ② 结果/成绩类元素——v4.19.11 收窄：仅结果页专属 class（`markResult`/`workResult`/`mark-res`/`result-wrap`/`answerResult`/`submit-success`/`submitted`），**裸 `score`/`grade` 子串已删除**（普通作答页含 `score-*`/`grade-*` 元素会误判）；
- ③ 页面已无任何提交按钮 且 全部扫描题均已勾选/点选——v4.19.11 加 `_quizAutoSubmit()` 门控：二次确认模式（auto-submit OFF）下「占位答完但挂起待确认」是正常中间态，不误判。

行为：全部题目标记完成（灯绿）、清空失败/在途/待提交状态、停止作答（含在途视觉 settle 二次检测）、一次性 toast。

## 9. 出清与数据治理（v4.19.29/4.19.30/4.19.33）

- **答题缓存出清系统**（v4.19.29）：满足条件即清空全部自动答题缓存（`_quizHandled`/`_quizAIPending`/`_quizAIProblems`+`_quizAIFailed`/`_quizAiDiag`/`_quizPendingSubmit`/`_quizReviewItems`/`_quizInfoMissing`/`_quizLights`+`_quizLightFp`/`_quizVisTimers` 先 clearTimeout 再删；重置 `_quizDsGraceUntil`/`_quizManualArmed`/通知节流/答题活动时间戳）。触发（config 可关）：`QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE`（默认开，前台视频稳定键 `videoDriftStableKeys` 判定换视频=答题时段结束）/ `QUIZ_CACHE_EVICT_ON_URL_CHANGE`（默认开，课程/章节 URL 去 hash 变化）/ `QUIZ_CACHE_EVICT_ON_IDLE_MIN`（默认 0=禁用）。导出 `quizCacheEvict(reason)`；诊断「答题缓存出清=原因·Ns前·清除N项」；`quizStats.lastEvict/lastAnswerTs`。
- **统一数据治理注册表 DataGov**（v4.19.30）：`takeover/foundation/storage/data-governance.js`——`registerBucket/evict/evictAll/snapshot` + 内置 5 桶（quiz-cache / relay-gm 清 `cx_ds_ask_v1`/`cx_quiz_lights_v1` 保留心跳键 / stats-ls / config-ls **受保护永不自动清** / kvs-idb、fp-ls 预留）；`DATA_GOV_PERIOD_MIN` 周期巡检（默认 0=禁用）；`/evict` 升级为出清所有非受保护桶、新增 `/evict-all`、`/evict-session`；诊断「数据治理: N 桶」。
- **出清等同刷新网页**（v4.19.33）：`quizCacheEvict` 升级为 `quizHardReset`——全量运行时内存归零（含跨帧灯/遥测快照、跳过计数、待答重扫定时器、指纹代际、广播去重签名、`quizStats` 计数、DS 发起计数），**绝不删除 localStorage 用户配置（cx_\*）**；兼容别名统一走 `quizHardReset`。

## 10. 遥测与诊断字段

诊断「答题:」行（v4.19.2+ 逐版增强）：

| 字段 | 含义 |
|---|---|
| `信号灯=N (绿x 黄x 红x 黑x)` | 跨帧/跨页聚合（fp 去重） |
| `帧扫=N 答=M` | 子帧最近一轮 tick 扫描/已答数 |
| `帧DS=可用/不可用` | 子帧 dsAvailable 状态 |
| `跳过[…门控N]` | 跳过原因计数（已答/冷却/弹窗/挂起/无选项/门控） |
| `帧错=…` | 答题循环捕获的异常（try/catch 不再静默中断） |
| `首错=…` | 首个红灯的失败原因（跨帧/跨页广播自带，不依赖帧可达性） |

## 11. v4.19.x 修复矩阵（2026-08-18 起）

| 版本 | 问题 | 根因 | 修复 | 回归 |
|---|---|---|---|---|
| 4.19.1 | 检测不出题目 | 静态题在 MO 挂载前渲染（v4.19 顶层帧编排后子帧无轮询） | `quizScanOnce` 一次性补扫；手动开始改走站点路由；重复灯（下标 0 假值）修复 | sim-quiz-chaoxing S0/S1b/S6 |
| 4.19.2 | 5 题全红、DS 无请求 | 子帧无 DS 通道 → dsAvailable 恒 false → 立即严格失败 | 子帧懒 GM 通道 + ds-state 处理器 + 门控 10s 宽限；失败原因随灯跨帧携带 | S7e/S8 |
| 4.19.3 | 面板残留 5 黑灯（陈旧灯） | 空快照合并 no-op | 按源帧（e.source）全量替换；答题遥测（帧扫/答/跳过/帧错） | S7f/S7g |
| 4.19.4 | 帧DS=不可用卡死 | 角色锁跳过子帧 course-side 初始化 → 收到 ds-state 无人处理 | 懒通道内补最小 ds-state 处理器 | 帧DS 遥测 |
| 4.19.5 | 门控5 永久黑灯 | 子帧一次性补扫后再无 tick | 子帧待答重扫 2s（答完/离页即停） | — |
| 4.19.6 | 错误累计 JSON 解析噪音 | `_dsClearBridge` 写 `''` → 其他监听 JSON.parse('') | 空值跳过解析 | — |
| 4.19.7 | 答案回传却解析失败 | `_dsParseAnswer` 漏判「答案是D」等句式 | 前缀补「是/为」+ 单字母兜底 + 否定语义精确化 | sim-ds-parse |
| 4.19.8 | DS 收到的选项只有 ABCD | html2canvas 对透明色/text-shadow 混淆文本渲染为空 | 混淆字体字形指纹解码，真实文本随提示词发出 | sim-secret-decode |
| 4.19.9 | 应答端看不到答题进度 | 跨标签页/跨域无灯同步 | GM 键 `cx_quiz_lights_v1` 镜像 → DS 面板/诊断显示 | — |
| 4.19.10 | 手动提交后不识别 | 无提交态检测 | URL/结果元素/无按钮+全勾选 三信号；全灯绿+停答 | S9/S9b |
| 4.19.11 | 提交识别误判 | 信号② score/grade 过宽；信号③ 与二次确认模式冲突 | 收窄结果页专属 class；信号③ 加 `_quizAutoSubmit()` 门控；导出 `quizPageSubmitted` | sim-quiz-submitted-guard |
| 4.19.12 | 反馈用语不统一 | 失败/挂起类措辞三处各异 | 统一信号灯/状态文本/toast；黄灯 `kind` 细分 confirm/review/answering | — |
| 4.19.13 | 信号灯状态颗粒度不足 | 四态无法区分挂起/宽限/信息缺失 | 七态七色（新增紫=暂时受阻/蓝=特殊情况/橙=信息缺失），优先级 + 补丁 | sim-quiz-lights-colors |
| 4.19.15 | 空白截图整题失败、DS 收不到请求 | `quizRecover` 截图空白即整题 reject | deepseek-web 文本-only 兜底（解码文本单独发 DS），`imgSkipped` 透传 | sim-quiz-vision-textonly |
| 4.19.16 | ABCD 多选答案变红 | 散文保护把连续字母误判散文；思考态前缀污染 | 散文判定改「含 I–Z 才算」；剥离「已思考（用时 N 秒）」前缀 | sim-quiz-answer-parse |
| 4.19.17 | 视频反复跳回开头 | 漂移守卫无稳定键（blob src 易变 + 定向关闭无 iframe 键）→ 换源整组删 max | `videoDriftStableKeys` 稳定指纹；仅删易变 blob 键 | sim-drift-stable-key |
| 4.19.18 | LMS 跨域嵌入续播失效 | 主循环只在真顶层启动，嵌套帧永不启动 | `isEffectiveTopFrame`：上方无运行脚本同源帧即自起主循环 | sim-effective-top |
| 4.19.19 | vision-timeout 红灯 | 提示词约束过软 → DS 输出冗杂拖慢 responder | `VISION_PROMPT` 硬格式约束（仅字母连写，禁前缀/解释） | sim-ds-parse 追加 |
| 4.19.20 | 复合审查修复批次（P0 seeking 活锁 + 7 P1） | ended 锁解锁不拆 seeking 守卫等 | `_disarmSeekGuard` 三路径；二次确认/去重/否定词/监听注册表等 | sim-ds-stream 等 |
| 4.19.21 | DS 已作答但本地全红+一直重搜 | 45s 竞速 < DS 长文生成；超时重发重复上传 | 直挂 settle 晚到采纳 + 90s 预算 + 看门狗分层；遥测签名并入 DS 位 | — |
| 4.19.22 | 手动提交按钮（需求）+ 排版 | — | `quizManualSubmit` 跨帧下发 + 面板按钮；按钮行/输入框行排版修复 | S10 / 排版探针 |
| 4.19.23 | 提交误点保存按钮 | 保存混入 submitSels/文本兜底 | 提交选择器剔除保存；两轮制文本匹配；保存绝不代点 | S10 升级 |
| 4.19.24 | 提交确认弹窗未代点 / 翻页旧灯残留 / 遥测被覆盖 | 弹窗需点确定；本地灯无翻页清理；无题帧覆盖遥测 | `_quizConfirmDialog` 代点；扫描去重清理旧灯；遥测按来源帧取最新 | S11/S12 |
| 4.19.25 | DS 长篇分析无字母 | 提示词约束仍软 | 后果式提示词（逐字解析即判错 + 不完整时给最可能字母） | — |
| 4.19.26 | 解析器对齐新提示词规格 | — | 健壮 + 规格对齐（详见章节） | sim-ds-parse |
| 4.19.27 | DS 应答 60s 超时 | 单 GM 键承载多 MB 截图挤掉心跳 | GM 控制通道不再承载多 MB 截图（详见章节） | — |
| 4.19.28 | 纯文本方案导致乱答 | 解码回退假字 + 无截图可对照 | 恢复发截图；`ds-ask` 独立 GM 键 `cx_ds_ask_v1` 双键路由 | — |
| 4.19.29 | 换视频/换课缓存残留 | 无出清系统 | 答题缓存出清系统（视频稳定键/URL 变化/空闲三触发） | sim-quiz-cache-evict |
| 4.19.30 | 数据治理散落 | 无统一生命周期视图 | DataGov 注册表（5 桶，config 受保护） | sim-data-governance |
| 4.19.31 | 准确率太低 | 提示词引导弱；截图不可靠 | 提示词重写：文本为主截图辅助、题型判断、few-shot | sim-ds-parse |
| 4.19.32 | 错答直交 | confidence 恒 1.0 | 反思核对提示词 + `_dsReadConfidence` + `_quizVisConfAction` 分级 | sim-ds-confidence |
| 4.19.33 | /evict 清理不彻底 | 残留跨帧遥测/计数/签名等 | `quizHardReset` 全量归零（绝不删用户配置） | sim-quiz-hard-reset |
| 4.24 | 面板点击冻结 | Ninja FAB pointer 捕获残留（pointerup 丢失）→ 全局 click 被吞 | 五路清理（无条件 _nxEnd / lostpointercapture / pointercancel / 全局自愈 / blur）+ onFab 坐标校验 | sim-ninja |

> 注：评级速览表另含「性能专项」行（优化点 1/5/6 落地：auto-next 选择器收窄、popup-quiz 合成查询、zhihuishu-exam 文本记忆化）。

## 12. 故障排查矩阵

| 现象 | 优先排查 | 诊断字段 |
|---|---|---|
| 无灯（题目页） | 题目是否在 iframe（检测靠子帧补扫/MO）；auto_start 是否关闭 | 帧扫、MO=已挂载 |
| 全黑灯 | 是否处于门控宽限（≤10s，灯应为紫=暂时受阻）；DS 未就绪 | 跳过[门控N]、帧DS |
| 蓝灯 | 自动启动开关已关闭（挂起态）——属预期 | 自动启动=关 |
| 橙灯 | 该题无选项/题干无法识别（信息缺失）——等待选项加载或检查选择器 | 跳过[无选项N] |
| 全红灯 | `首错=` 读原因：应答端不可用→DS 页未开/未登录；无可用答案→截图/解码/解析环节 | 首错、帧DS |
| 灯黄不绿 | DS 生成中（60s 内正常）；超时→red 重试 | 最近请求（DS 页） |
| 请求未达 DS 页 | 子帧通道未建（懒注册首次 ≤5s）；DS 页未开 | 帧DS、最近请求 |
| 提交后灯不变绿 | 提交态三信号是否命中（结果页/按钮消失+全勾选；auto-submit 关闭时信号③ 不生效） | 信号灯状态 |
| 面板点击冻结 | Ninja FAB 指针捕获残留（v4.24 已自愈，无需刷新） | — |
| 视频反复跳回开头 | 漂移守卫稳定键（v4.19.17）；主循环是否在有效顶层帧运行（v4.19.18） | 主循环轮次 |

## 13. 配置键速查

`cx_quiz_auto`（总开关）· `cx_quiz_auto_start`（自动启动）· `cx_quiz_autosubmit`（自动提交）· `cx_quiz_source`（答案源 random/bank/ai）· `cx_quiz_bank`（题库 JSON）· `cx_quiz_vision_enabled`（视觉开关）· `cx_quiz_vision_ocr`（deepseek-web/endpoint/tesseract）· `cx_quiz_vision_endpoint`（多模态端点）· `cx_quiz_vision_scale`/`cx_quiz_vision_maxdim`（截图参数）· `cx_quiz_vision_h2c`（html2canvas 自建地址）· `cx_quiz_offline`（隐私：不外发）· `cx_popup_quiz`（弹窗作答）。`n`n出清/治理：`QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE`（默认开）· `QUIZ_CACHE_EVICT_ON_URL_CHANGE`（默认开）· `QUIZ_CACHE_EVICT_ON_IDLE_MIN`（默认 0=禁用）· `DATA_GOV_PERIOD_MIN`（默认 0=禁用）。
