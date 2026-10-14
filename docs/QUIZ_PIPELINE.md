# 自动答题链路

> 核对基线：4.20.3；核对日期：2026-10-14。
> 本页说明现行流程、状态和排查入口。版本演进及旧修复矩阵见[归档原文](../旧文档/07_补充归档/2026-10-03/02_版本说明备查/docs/QUIZ_PIPELINE.md)；其中历史版本与测试数量不代表当前验证结果。

## 实现入口与总览

源码根目录为 [用户脚本源码](../apps/userscript/src/chaoxing-force-play)。

| 模块 | 职责 |
| --- | --- |
| [sites/chaoxing-exam.js](../apps/userscript/src/chaoxing-force-play/sites/chaoxing-exam.js) | 超星题目、题干、选项、填空与提交选择器；站点调度注册 |
| [takeover/engine/quiz.js](../apps/userscript/src/chaoxing-force-play/takeover/engine/quiz.js) 逻辑组 | 状态与请求生命周期入口；续段分别负责信号灯、题目读取、答案解析/来源、回填/提交、调度及公开接口 |
| [takeover/engine/quiz-vision.js](../apps/userscript/src/chaoxing-force-play/takeover/engine/quiz-vision.js) 逻辑组 | 视觉状态入口；续段负责字体恢复、截图、答案置信、端点及恢复流程 |
| [takeover/engine/vision-deepseek-web.js](../apps/userscript/src/chaoxing-force-play/takeover/engine/vision-deepseek-web.js) 逻辑组 | 通道入口；续段负责消息、提问、回复解析、应答队列、状态与启动 |
| [takeover/foundation/storage/data-governance.js](../apps/userscript/src/chaoxing-force-play/takeover/foundation/storage/data-governance.js) | 数据桶注册、快照与出清 |
| [takeover/foundation/storage/credentials.js](../apps/userscript/src/chaoxing-force-play/takeover/foundation/storage/credentials.js) | 闭包内凭据、私有 Origin 授权、持久化队列及配置凭据过滤 |

上述逻辑组用 `@source-group` 标记，完整片段顺序以 [build-manifest.txt](../apps/userscript/build-manifest.txt)为准；职责拆分保留原闭包与初始化顺序，不能只加载入口片段后断言整个答题引擎已装配。

```text
站点选择器 → 题目扫描与信号灯登记 → 开关/挂起/通道门控
  → 本地题库或文本 AI → 必要时视觉求解 → 解析与置信决策
  → 点选或填空回填 → 自动提交/待确认/人工复核
  → 提交态检测、跨帧同步与运行时出清
```

## 检测与调度

题目来自站点 tick、观察器挂载后的补扫、MutationObserver 动态扫描及子帧待答重扫。顶层调度受“有效顶层帧”判定约束，不能把所有嵌套页面都视为无主循环。超星选择器以题块 `div.TiMu`、题干 `div.Zy_TItle` 等为线索；选项限定在 li 层级，避免内层文字节点重复计数。

| localStorage 键 | 当前语义 |
| --- | --- |
| `cx_quiz_auto` | 置 `0` 禁用自动答题流程 |
| `cx_quiz_auto_start` | 默认开启；关闭后检测并挂起，手动开始走站点调度 |
| `cx_quiz_autosubmit` | 默认开启；关闭后常规点选进入待确认提交 |
| `cx_quiz_fill_enabled` | 默认关闭；开启后可从题库或文本 AI 回填，回填成功仍待确认 |
| `cx_quiz_source` | `random` / `bank` / `ai` |
| `cx_quiz_bank` | 本地题库 JSON |

随机作答是无可靠答案时的兜底，不代表答案正确。是否实际使用兜底还受严格 AI 策略和求解分支约束。

## 信号灯：8 个状态、7 种颜色

| 状态 | 颜色 | 含义 |
| --- | --- | --- |
| `fail` | 红 | 未作答且失败登记或冷却有效；通道宽限内可让位于紫 |
| `busy` | 黄 | `answering` 在途求解、`confirm` 待确认提交、`review` 待人工复核 |
| `fill` | 蓝 | 填空题待回填 |
| `missing` | 橙 | 无可用选项或题目结构、信息异常 |
| `blocked` | 紫 | DeepSeek 通道建立宽限中，暂时受阻 |
| `special` | 蓝 | 自动启动关闭，处于手动挂起 |
| `done` | 绿 | 已处理；待确认或复核仍优先显示黄灯 |
| `idle` | 黑 | 未开始处理 |

状态按运行时表推导，不能仅凭颜色判定原因，蓝灯需区分 `fill` 与 `special`。已作答题会清除旧失败登记；失败标签不应继续遮盖完成态。

信号灯按指纹去重，上限 200。子帧向顶层发送快照，接收端按来源帧替换，空快照清除该来源的旧灯。顶层经 GM 键 `cx_quiz_lights_v1` 镜像到 DeepSeek 页面，空灯也会写入以清理陈旧镜像；两条路径都做签名去重。跨帧接收端检查来源 origin，目标 origin 的解析失败存在 `*` 回退，因此不能描述成无例外的同源发送保证。

## 求解、置信与填空

文本路径先按配置使用题库或 AI，结果需映射为有效选项。文本 AI 外发还需通过离线键及端点白名单。

视觉路径需要启用视觉能力。截图可结合字体混淆解码文本；DeepSeek 请求可携带截图与已恢复文本，截图不可用时有文本兜底。回复先解析为答案令牌，再映射成选项下标，不把完整解释文字直接作为选项。

端点的 API Key 通道还需显式开启 `QUIZ_VISION_USE_API_KEY`。用户在专用密码框重新输入 Key 时，保存到管理器私有存储并绑定经过协议及白名单校验的完整 Origin；没有 GM 存储时仅本次会话有效。旧网页 Key 会读取一次并删除，旧格式私有记录或未绑定 Origin 的迁移值须重新输入授权。公开 `CONFIG.QUIZ_VISION_API_KEY` 始终为空，密码框保存后立即清空。

Key 只能发到私有授权的同一 Origin：换域名、协议或端口须重新输入 Key；仅修改网页 CONFIG 或 localStorage 白名单不能重绑。远程 Key 端点必须 HTTPS，本地回环可使用 HTTP，URL 不得含用户名或密码，凭据请求禁止重定向。网络错误使用固定反馈，成功回复中反射的当前 Key 会遮盖；这些规则不替代管理器真实环境验收。

视觉置信决策由 `_quizVisConfAction` 统一映射：

| 置信 | 行为 |
| --- | --- |
| high | 点选；按自动提交开关提交或待确认 |
| mid | 点选，强制进入待确认提交 |
| low | 随机占位并进入人工复核；视觉分支不自动提交 |

文本与视觉路径的低置信分支均登记人工复核和待确认提交，不由自动提交开关直接提交。待确认、待复核和 AI 在途不计入 `done`；详见 [核心状态机](CORE_STATE.md)。

填空默认仅识别登记。开启回填后，题库或文本 AI 命中可写入 input / textarea / contenteditable 并触发相应事件；成功后登记待确认提交，未找到输入或答案时保持待处理状态。该能力不等于通用主观题自动作答。

## DeepSeek 通道与超时

GM 双键分别承载请求与控制消息：

| 键 | 用途 |
| --- | --- |
| `cx_ds_ask_v1` | `ds-ask`，包含题目请求与可选截图 |
| `cx_ds_bridge_v1` | 状态、心跳、应答等控制消息 |
| `cx_quiz_lights_v1` | 题目状态镜像 |

需要 DeepSeek 的子帧按需建立通道。应答端串行处理请求并维护队列，页面是否打开、已登录、可输入及可发送都影响可用性。

超时存在多个层次，默认值不能合并成“整个 DeepSeek 请求保证等待 90 秒”：

- 课程端视觉看门狗：DeepSeek 模式固定 90 秒；其他模式使用 `CONFIG.QUIZ_VISION_TIMEOUT`，正常初始化后默认 60 秒，仅配置缺失时该处回退 45 秒。
- `_dsAskOnce` 请求定时器：同一配置，默认 60 秒。
- 应答端轮询预算：`min(90000, QUIZ_VISION_TIMEOUT - 1500)`，默认 58.5 秒，从轮询开始计。
- 应答端任务看门狗：90 秒，用于释放停滞的任务并继续队列。

因此默认配置下，回复轮询或请求层可能早于课程端看门狗超时。应结合错误码判断哪个层次结束了请求。

## 提交与完成识别

`_quizMaybeSubmit` 负责常规自动提交或挂起；`quizSubmitPending` 用于确认待提交题；`quizManualSubmit` 向可达帧下发手动提交命令，并有页面级按钮兜底。

页级手动提交及题内提交排除仅保存、暂存和草稿入口。`done` 表示脚本点击了提交入口或识别到了结果页；点击按钮本身不等于服务端确认成绩，仍需以平台状态验证。

`_quizPageSubmitted` 检测结果 URL、结果页专属元素，或“自动提交开启且无提交按钮、题目均已选”的组合信号。普通 score / grade 子串不单独作为成功条件。命中后同步完成状态、清理在途及失败登记并停止继续作答；晚到视觉结果也再次检查页面是否已提交。

## 数据治理与外发边界

`quizHardReset(reason)` 清理答题运行时、定时器、跨帧灯及遥测等；兼容别名 `quizCacheEvict` 走相同重置。它不等于真实网页重载，也不删除用户题库与配置。

异步请求同时绑定 CoreState 作用域令牌、单调会话代次和请求 ID；旧结果不能在重置、停机或关闭答题后落地，也不能清除新请求的超时。面板开关调用 `quizSyncGate()`，跨文档通过 storage 事件同步；使用控制台直接写答题开关后，也应调用该接口，使快速关闭再开启成为明确取消边界。

视觉流程沿用调用时的任务上下文，截图完成、GM 凭据读取结束和网络发送前均复核原任务许可；题目被移除、当前代次失效或 AbortSignal 已取消时不再发送。端点 fetch 与流式 reader 接受取消信号，迟到响应不能重新启动旧任务。直接视觉入口及浏览器 Reverse API `answer` 也捕获独立上下文，不能等待凭据就绪后才取得新许可。

配置导出跳过凭据类字段、嵌套凭据及包含当前私有 Key 的字符串/键；导入发现这些内容时整批拒绝，避免部分写入。GM 尚未读取完成时导出和导入延后至读取结束，不能以“当前还不知道 Key”为由输出潜在凭据。清空或恢复默认会清理本次会话和私有记录；持久清理失败须明确提示用户在管理器删除旧值。

视频稳定键变化、去 hash 的课程 URL 变化以及可配置的空闲条件可触发答题出清。空闲出清默认关闭。

完整应用初始化后 DataGov 注册 6 桶：

| 桶 | 内容与出清 |
| --- | --- |
| `quiz-cache` | 答题运行时；委托 `quizHardReset` |
| `relay-gm` | 清请求和灯镜像键，保留控制心跳键 |
| `stats-ls` | 统计、命令收藏/近期项、面板位置及静默偏好 |
| `config-ls` | 用户配置与题库，受保护 |
| `kvs-idb` | IndexedDB 预留空间 |
| `fp-ls` | 指纹命名空间预留空间 |

`config-ls` 受保护不代表所有 `cx_*` 键都不能删除；`stats-ls` 维护的键有其独立清理行为。`DATA_GOV_PERIOD_MIN` 默认 0，周期巡检关闭。

`cx_quiz_offline` 默认阻止文本 AI 路径外发，并与端点白名单共同门控。视觉端点、DeepSeek 网页应答和外部库加载有各自配置及授权路径；该离线键不能用作全链路“完全不外发”的保证。外部截图/OCR 库加载还受 `QUIZ_VISION_PRIVACY_OK` 控制，配置键定义见 [storage/keys.js](../apps/userscript/src/chaoxing-force-play/takeover/foundation/storage/keys.js)。

## 排查与验证

| 现象 | 优先核对 |
| --- | --- |
| 没有题灯 | 题目实际所在帧、选择器、是否禁用总开关、观察器与补扫 |
| 蓝灯 | 区分手动挂起与填空待回填；核对开关及答案源 |
| 紫灯 | 应答端连接和通道建立宽限；查看帧 DS 状态 |
| 红灯 | 查看首错、失败原因、冷却及具体超时层次 |
| 黄灯长时间不变 | 区分求解在途、待确认、待人工复核 |
| 应答端残留旧灯 | 课程页是否发出空镜像、GM 监听与当前帧来源 |
| 点击后未显示完成 | 实际按钮是提交还是保存，结果 URL / 元素和二次确认状态 |

读取面板中的帧扫、帧答、帧 DS、跳过计数与帧错字段。修改实现后，在项目根运行 `scripts/build.ps1` 与 `scripts/test.ps1`，必要时运行对应浏览器场景。仿真脚本位于 [apps/userscript/_sim](../apps/userscript/_sim)；历史文档中的断言数量不作为当前通过证明。

配套阅读：[公开契约](CONTRACT.md)、[跨模块契约](CROSS_MODULE_CONTRACT.md)、[用户脚本开发](../apps/userscript/README.md)。

本轮 4.20.3 验证与发布状态见 [发布记录](releases/4.20.3.md)；4.20.2 的 [2026-10-10 拆分记录](../backups/refactor/2026-10-10/module-split/拆分说明.md)保留当时的结构和测试证据。
