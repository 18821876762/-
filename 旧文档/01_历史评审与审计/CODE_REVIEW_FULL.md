# 全工作空间代码审查报告

- **审查日期**：2026-08-11
- **审查范围**：`ecosystem/src/chaoxing-force-play/`（~60 个 JS 模块，用户脚本核心）、`perception/`（Python 爬虫 + 进度面板）、`scripts/`、`docs/`、根目录脚本与配置文件。
- **方法**：全量 `node --check` 语法校验 + 逐模块通读核心实现（main-loop / site-router / quiz / quiz-vision / targeting / session / lifecycle / panel-* / 各 sites 引擎 / Python crawler）。
- **结论摘要**：整体工程质量很高——分层清晰、防御式 `bestEffort/safeGet` 包裹、`uninstall` 还原清单 12 项、跨 iframe 面板治理、状态机 + 硬闸门齐备。未发现致命语法错误；`del` 严重 bug 已基本修复（见下）。剩余问题以**中低危 + 待真机校准**为主。

---

## 1. 语法错误

**结论：未发现语法错误。**

对 `ecosystem/src/chaoxing-force-play/` 全部 `*.js` 执行 `node --check`，全部通过（含所有 sites / takeover / presentation / plugins 子模块）。`perception/*.py` 经语法轮廓检查亦无括号/缩进错位。

> 注：本仓库此前已多次 `node --check SRC_OK/BUNDLE_OK` 回归，构建脚本 `build-force-play.ps1` 也把 `quiz-vision.js` 等登记进产物，语法层面可信。

---

## 2. 逻辑错误

### 2.1 [低] 视觉识别在「默认 endpoint 模式 + 端点未配置」下退化为 no-op（本地 Tesseract 兜底仍在，但非默认且受隐私开关门控）
- **文件**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz-vision.js`（`quizRecover` 约 111–132 行、`quizVisionAsk` 约 82–107 行、`quizOcr` 约 72–78 行）
- **描述**：本地 OCR 兜底**并未被禁用**——`quizRecover` 在 `mode==='tesseract'`（约 115 行）时仍走 `quizOcr` 加载 Tesseract.js CDN 并还原文本；还原文本经 `_quizBankLookup(res.text)` 可命中本地题库（约 340 行），实测可用。但有两点限制：
  ① 默认模式是 `'endpoint'`（`CONFIG.QUIZ_VISION_OCR || 'endpoint'`，约 114 行），本地 OCR 需用户显式切到 `tesseract` 才生效；
  ② Tesseract CDN 的加载受隐私开关 `QUIZ_VISION_PRIVACY_OK` 门控（约 31–37 行 `_quizLoadScript` 内 `if (_remote && !_privacyOk) reject`），未开启则本地 OCR 同样不可用。
  因此**在默认 endpoint 模式且 `QUIZ_VISION_ENDPOINT` 留空**时，`quizVisionAsk` 直接 `Promise.reject`（约 84 行），视觉层对该题实质 no-op（由 quiz.js 退回随机兜底），这构成配置盲区。
- **后果**：用户若不知需切 `tesseract` + 开隐私开关，端点缺失时视觉层完全不工作，真答题引擎只处理 DOM 可解析题目（抗混淆题目漏答）。
- **建议**：① 面板/控制台对「endpoint 模式但端点为空」显式告警；② 考虑「端点空 + 已开隐私」时自动回退到 `tesseract` 本地 OCR，而非静默 reject。

### 2.2 [低] 题库答案以“选项索引”存储，重渲染后索引漂移风险
- **文件**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`（约 255 行 `_quizBankWrite`、340/343 行 `_quizBankLookup`/回填）
- **描述**：本地题库把题目指纹映射到**选项序号** `idx`。题目选项顺序在平台重渲染/翻页时可能改变，按索引回填会把旧答案勾到新选项上。
- **后果**：已录入题库的题目在选项乱序时可能选错。
- **建议**：题库存储**答案文本/指纹**而非索引，回填时按选项文本匹配；或记录选项的稳定 `data-*` 标识。

### 2.3 [低] 同指纹题目被去重跳过，可能漏答
- **文件**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`（约 368 行 `if (_quizHandled[_quizFingerprint(q)]) { n++; continue; }`）
- **描述**：`_quizFingerprint(q)` 基于题干指纹；若两道不同题目指纹碰撞（题干极相似），第二道直接 `continue` 视为已处理，`answered++` 但并未真正作答。
- **后果**：理论漏答；实际题干指纹碰撞概率低。
- **建议**：指纹可纳入“选项集合哈希”做二次区分，降低碰撞面。

---

## 3. 潜在的运行时异常

### 3.1 [低] 卸载清理对未定义监听器的 `removeEventListener` 容错
- **文件**：`ecosystem/src/chaoxing-force-play/takeover/dom/lifecycle.js`（约 66/115/121 行）
- **描述**：`keydownHandler`、`playWatchHandler`、`visibilityHandler`、`globalErrorHandler` 在清理时被 `removeEventListener`。若面板从未构建（如纯题目页未进视频面板），这些引用可能 `undefined`，`document.removeEventListener('keydown', undefined)` 为 no-op，不抛错，但说明“清理清单”依赖若干跨模块的隐式存在性。
- **后果**：无崩溃，仅清理略不彻底，影响面仅限卸载残留。
- **建议**：清理前统一 `typeof x === 'function'` 守卫（与 `panelNinjaOutsideClick`/`syncNinjaGlyph` 的处理方式保持一致）。

### 3.3 [低] `html2canvas` / Tesseract CDN 动态加载的外部依赖
- **文件**：`quiz-vision.js`（约 12–13 行 `html2canvasCdn` / `tesseractCdn`）
- **描述**：视觉层运行时从 `cdn.jsdelivr.net` 拉取脚本。若用户处于无外网/被墙环境，`import`/注入失败后 promise 被 reject，由 `bestEffort` 容错，不会拖垮主循环。
- **后果**：离线时视觉识别不可用（预期内降级）。
- **建议**：可在面板显示“视觉依赖加载失败”提示，并提供自托管 CDN 的回退地址配置项。

> 其余运行时路径（`safeGet`/`bestEffort`/`cxState` 懒初始化、`_mo` MutationObserver 守卫、`ranOnce` 幂等、`siteAttachmentsKey()===''` 提前 return 防 `defineProperty('')` 抛错）均已妥善防护，未发现问题。

---

## 4. 性能瓶颈

### 4.1 [低] `videoBelongsToTask` 的 O(keys × urls) 正则扫描
- **文件**：`ecosystem/src/chaoxing-force-play/takeover/engine/targeting.js`（约 172–202 行 `videoBelongsToTask`）
- **描述**：对每帧视频，遍历 `TARGET.keys`（任务点 id）并对每个 url 运行 `keyRe().test()`。keys 数通常为个位数、urls 数受 `MAX_SCAN_DEPTH` 限制，整体开销可控。但**定向未启用**时该函数在 `walkVideos` 热路径每轮对所有 video 调用，短路返回 `true`（约 173 行 `if (!TARGET.enabled || !TARGET.ids) return true;`），已优化。
- **量化影响**：实测算力可忽略（≤ 数十次正则/轮/视频）。
- **建议**：当前可接受，保持现状即可；若未来白名单 id 规模增大，可改为把 urls 拼成单字符串做一次 `RegExp` 匹配。

### 4.2 [低] 面板 `innerHTML` 全量重建
- **文件**：`presentation/panel.js`（约 81 行）、`dashboard.js`（约 318 行）、`commands.js`（约 172 行）
- **描述**：面板/仪表盘/命令列表每次刷新整体 `innerHTML` 重建。DOM 规模小（面板 < 1KB），刷新频率低（用户主动或事件驱动），无明显卡顿。
- **建议**：高刷新场景（如进度条每秒）已用局部文本节点更新（`dashboard.js` 73 行 `heroTime.innerHTML` 小段），保持即可。

### 4.3 [信息] 内存
- `_quizHandled` / `_quizReviewItems` / `_quizPendingSubmit` / `__cxQsHandled` 均有 `_quizPrune*` 上限裁剪与 `TTL` 过期，未见无界增长。

---

## 5. 可读性与可维护性缺陷

### 5.1 [信息-正面] 模块化与文档
- 仓库已按 `foundation / engine / dom / presentation / plugins / sites / takeover/bootstrap` 清晰分层，每个模块顶部有“内聚性收敛/职责边界/跨模块引用”注释，函数级 `safeEffort` 标签利于黑匣子定位。这是强项。
- **小建议**：部分文件头部注释篇幅（30–50 行）超过实现代码，存在一定“过度注释”信号噪声；新成员可优先依赖 `docs/code-annotation-history.md` 索引，模块内注释可适度精简为“变更理由 + 跨模块契约”两类。

### 5.2 [低] 魔法数字已大量集中，但散落点仍存
- 已集中：`RESCAN_INTERVAL`、`AUTO_STOP_MIN`、`RESUME_AFTER_MIN`、`MAX_SCAN_DEPTH`（统一走 `CONST`）。
- 散落示例：`quiz.js` 421 行 `Math.floor(Math.random() * opts.length)`、lifecycle 187 行 `window.top !== window`、各种 `60000` 毫秒换算（autoStopTick 75 行已用 `CONFIG.AUTO_STOP_MIN * 60000`，但 `resumeAt = Date.now() + CONFIG.RESUME_AFTER_MIN * 60000` 同样写法重复出现，建议抽 `MIN2MS` 常量）。

### 5.3 [低] 跨脚本隐式契约以裸字段名传递
- **文件**：`targeting.js`（约 85–87 行 `v.__cxAN_hold`）、`lifecycle.js` 还原清单
- **描述**：与 auto-next 工具库项以 `v.__cxAN_hold` 等裸字段名作为隐式契约。注释已说明“刻意不提常量”，但新人易误改一端造成契约断裂。
- **建议**：在 `docs/` 维护一份“跨脚本字段契约清单”（全局名 + 字段名 + 读写方），目前 `__cxRegisterAddon` 等全局名已文档化，实例字段契约可补录。

### 5.4 [信息] 测试覆盖
- `ecosystem/_sim/` 提供 `sim-quiz`、`sim-quiz-vision`、`sim-multiframe`、`sim-zh-exam`、`sim-ds-console` 等沙箱，回归项 14/14、31 测试 0 失败，覆盖主要引擎与跨帧场景——工程实践规范度良好。

---

## 6. 安全问题

### 6.1 [中] 明文 cookie 落盘，`cookies.json` 在 Windows 上权限收紧失效
- **文件**：`perception/cx_crawler/session.py`（约 18–27 行 `_tighten_perms`、143 行 `save_cookies`）
- **描述**：爬虫把登录态 `cookies.json` 以明文落盘。`_tighten_perms` 用 `os.chmod(path, 0o600)` 收紧，但 **Windows 上 `chmod` 基本无效果**（仅只读位部分生效），任何本地进程/其他用户均可读取该文件。经核验仓库 `.gitignore` 已含 `cookies.json`（误提交风险已缓解），残余风险是**本机明文可读**。
- **后果**：共享机器/被中毒环境下，超星账号会话凭证可被本地任意进程读取并盗用。
- **建议**：① Windows 改用 `icacls` 限制 ACL（如仅当前用户 `icacls cookies.json /inheritance:r /grant:%USERNAME%:R`），或改为凭据管理器 / 环境变量注入；② 文档明确要求“共享机器及时删除 cookies.json”。

### 6.2 [低] 视觉端点允许明文 `http`，远程端点存在泄露面
- **文件**：`quiz-vision.js`（约 87–88 行协议校验）
- **描述**：协议校验仅拒绝非 `http/https` 的协议，`http://` 仍被允许。若 `QUIZ_VISION_ENDPOINT` 指向**远程 http** 服务，题目截图（可能含个人信息）与返回答案以明文传输，且端点本身可能未鉴权。
- **后果**：中间人可截获题目/答案内容。
- **建议**：默认只允许 `https:`（或 `http://127.0.0.1` / `http://localhost` 本地回环白名单），远程端点强制 https；并对端点加 Bearer 鉴权。

### 6.3 [低] 桥接 token 经 URL 查询参数传递
- **文件**：`perception/cx_crawler/bridge.py`（约 55–58 行 `_check_auth`，支持 `?token=`）
- **描述**：为兼容 GM fetch 无法加自定义头，token 接受 `?token=` 查询参数。若桥以 HTTP 暴露，token 会出现在访问日志/代理中。
- **建议**：桥仅监听 `127.0.0.1`，不暴露到 `0.0.0.0`；文档建议配合本地回环使用。

### 6.4 [低] `innerHTML` 注入点需确认全部转义
- **文件**：`presentation/panel-core.js`（67 行）、`panel.js`（81 行）、`dashboard.js`（44/73/318 行）、`commands.js`（154/172/225 行）、`zhihuishu-fab.js`（232/248/253 行）、`plugins/registry.js`（23/24/91 行）等共 **14 处赋值**（`utils.js` 另有 2 处为注释说明，不计入）。
- **描述**：面板动态 HTML 使用 `innerHTML` 构造。已确认 `panel-template.js` / `dashboard.js` / `commands.js` 对用户派生数据（标题、area、detail、video src、命令描述）均调用 `toolkit.escapeHTML`。逐点核验结果：
  - **`zhihuishu-fab.js` 实测无 XSS 面**：`_zhsExamPopHTML` / `_zhsVideoPopHTML` / `_zhsHead` 仅用脚本内部常量（场景标签、`_zhsFabEnabled` 布尔）做**静态模板拼接**，不含题目文本；运行时动态字段（DS 连接态、作答进度、开关态）一律经 `textContent` 注入（如 `_zhsRefreshExam` 136/147/151 行、`_zhsRefreshVideo` 170/172 行），不进 `innerHTML`。原担心的题干注入在此处**不成立**。
  - 其余 `innerHTML` 点（panel 入侵报告、`registry` 子面板容器、`commands` 命令列表、`dashboard` 进度条小段）拼入内容均为内部状态/常量，未直接混入页面 DOM 文本。
- **后果**：当前逐点核验未见存储型 XSS 实例；残留风险仅在“未来新增把页面 DOM 文本原样拼入 `innerHTML` 的代码”时才出现。
- **建议**：保持现状即可，但加一条 lint 规则禁用裸 `${domText}` 进 `innerHTML`，并在 code-review 清单中固化“动态值优先 `textContent` / 经 `escapeHTML`”的约定，防止后续回归。

---

## 整体评价

### 功能完整性
- **核心完备**：强制续播（原型接管 + 播放闸门 + 自动停止/恢复）、定向白名单（含桥 objectids 兜底）、跨 iframe 面板、真答题引擎（超星/智慧树/多平台 best-effort）、视觉识别层、DeepSeek 应答端联动、人工复核闭环、完备的 `uninstall` 还原——功能面覆盖广。
- **缺失/边界**（多为已知待校准项）：
  - 各平台题目/选项/交卷选择器为 **best-effort 并集**，未做真机校准前可能“检测到 0 题”（已在各 sites 模块注释中明确标注，属预期）。
  - 视觉识别在端点缺失时实质不可用（见 2.1）。
  - 智慧树题目页“确认交卷”仍依赖用户手动点击（设计如此，非缺失）。

### 健壮性
- **强**：`bestEffort`/`safeGet`/`safePlay` 全链路包裹；`try/catch` 在定时器回调、事件处理、异步链均有；`uninstall` 幂等（`_cleaned` 守卫 + `once:true`）；休眠/时钟回拨的计时防护（`autoStopTick` 67 行）；深度遍历上限防死循环。
- **待加强**：异常多为静默吞掉（黑匣子记录），普通用户难感知“某项功能因异常未生效”，建议在面板增加“运行时告警”汇总（已有 `metrics`/`EventBus`，可接面板）。

### 工程实践规范性
- **规范度高**：分层清晰、单一职责、DI 容器工厂（`createContainer`）、状态机 + 硬闸门、跨脚本契约全局名统一、丰富的沙箱回归测试、构建脚本登记完整。
- **小改进点**：过度注释信号噪声（5.1）、裸字段跨脚本契约需文档化（5.3）、魔法毫秒换算可抽常量（5.2）、Windows 下 cookie 明文（6.1）。

> **优先级建议**：先处理 6.1（Windows cookie 明文，中危可落地）与 6.2（远程 http 端点泄露，低-中危），其次 2.1（视觉端点缺失告警）与 6.4（innerHTML 转义全量核验），其余低危项可在日常迭代中消化。

---

## 9. 对照其他审查的交叉复核（增量发现与订正）

> 另收到一份**多智能体审查**（foundation/engine/dom/bootstrap/presentation/sites/测试/构建全覆盖，约 7400 行）。其总体结论与本报告一致：**语法 0 错、工程质量高、问题以中低危 + 待真机校准为主**。它在 UI 层细节、测试脚本、sites 选择器与构建产物一致性上更深入，并补充了若干本报告未覆盖的具体 bug。下面列出经代码实测核验后的增量结论，并订正其个别夸大/不实之处。

### 9.1 已修复的真实 bug（本报告/前序实现中引入，已落地）
| # | 文件:行 | 问题 | 修复 | 验证 |
|---|---|---|---|---|
| B1 | `presentation/zhihuishu-fab.js:284` | §1.1 可观测化用 `EventBus.on('zhExam:diag', …)` 订阅，但发射端 `sites/zhihuishu-exam.js:217` 用 `EventBus.emit(...)`（走 `__ev:` 事件通道），`on` 订阅的是**状态键**通道 → 诊断事件**永不触发**，FAB 不显示“等待 DeepSeek 登录”等。 | 改为 `EventBus.onEv('zhExam:diag', …)` | node --check PASS；sim-zh-fab PASS |
| B2 | `takeover/engine/quiz.js:569` | `quizReviewExport` 把 `it.opts`（DOM 元素数组）直接 `JSON.stringify` → 导出为 `{}`，人工复核导出失效。 | 改为导出 `(o.textContent \|\| o)` 文本 | node --check PASS；sim-quiz PASS |
| B3 | `takeover/dom/dom.js:43-52` | 单视频模式 `_ovForegroundGate` 仅在 `v[FLAGS.forcePaused]` 已为真时才 pause；而 `overrideVideo:17` 门控返回 `true` 即 skip 整条管线 → 未标记 `forcePaused` 的非前台视频持续播放，与 46 行“强制暂停所有非前台视频”注释矛盾。 | 无条件 `releaseVideo` + 原生 pause + 置 `forcePaused` | node --check PASS |

### 9.2 增量有效发现（建议纳入后续迭代，未在本轮修复）
- **[安全·低] 跨帧 toast 泄漏**：`foundation/state/state.js:34-36` `emit('ui:toast', …)` 向 `window.top.postMessage(..., '*')` 转发，目标用 `'*'` 且未校验来源 → 同站点任意父帧可接收含题目进度的提示内容。建议校验 `e.origin` 或收窄 target。
- **[安全·低-中] 视觉端点无白名单**（补充 6.2）：`quiz-vision.js:82-107` `quizVisionAsk` 仅校验协议为 http/https，未限制**目标主机**，`QUIZ_VISION_ENDPOINT` 可指向任意服务器接收题目截图。建议加允许主机白名单（或仅允许本地回环 + 用户显式登记域名）。
- **[逻辑·低] AI 源短路丢弃已知题库答案**：`quiz.js:282-287` `src==='ai'` 时若 `_quizAskAI` 返回 `'pending'`，直接 `return {pending:true}`，**丢弃本轮已收集的 bank 答案**，导致本可立即答对也要等 AI 回填（下一轮才命中）。影响：最坏多延迟一拍；若 AI 永不回则浪费已知答案。
- **[逻辑·低] 全局暂停接管还原 stale**：`dom.js` `neutralizeGlobalPause` 仅首次保存原生 `pause`；平台在脚本运行后**动态替换** `pause`（非首次接管时）则保存的是已污染引用，还原不彻底。
- **[逻辑·低] 倍速释放未尊重 `released`**：`config.js` `applyUserRateAll` 对全部视频下发倍速，未跳过 `cxState(v).released` 的视频（与 19 行 `released` 语义部分冲突）。
- **[逻辑·低] 临近结束守卫缺失**：`playback.js` `nearEnd` 未守卫 `CONFIG.END_RELEASE_SEC > v.duration` 的边界，超短视频可能误触发释放。
- **[逻辑·低] 空 key 误匹配**：`targeting.js` `keyRe('')` 生成 `.*` 匹配所有 URL（sim 已覆盖边界，建议显式拒绝空 key）。
- **[逻辑·低] bridge 还原兜底缺失**：`bridge.js` `restoreNativePause` 无 `NATIVE_PAUSE` 兜底，`_bridgeAllDead` 判定过激（单端点探测失败即全量禁用）。
- **[逻辑·低] `h()` 函数型 key 走 `setAttribute`**：`utils.js` `h(el, attrs)` 对 function 型 key 仍走 `setAttribute`（__`on*` 事件误当属性），理论 XSS-ish，实际调用点未触发。
- **[可维护·低] EventBus 名实不符**：`state.js` 当前实为**事件总线**，`EventBus.state` 仅镜像各域顶层 var 供诊断（只读快照），`get/set` 基本无人使用——注释已自陈，建议后续收敛或重命名以免误用。

### 9.3 对该审查的订正（不实/夸大）
- **`_quizAIPending` “无 prune / 内存无限增长”——不实**：实测 `quiz.js:458-459` 存在超时清理 `if (Date.now() - _quizAIPending[fp] > _wait) delete _quizAIPending[fp]`，并非完全无清理；仅缺**计数上限**，非“无 prune”。应为低危（建议加硬上限）而非内存泄漏。
- **`site-router.js` `.edu.cn` 兜底“误识别”——该审查最终自判为“非问题/预期”**：与本报告 5.3（裸字段契约待文档化，非功能 bug）一致；`.edu.cn` 回退属设计取舍。
- **innerHTML XSS“已确认漏洞”——夸大**：本报告 6.4 已逐点核验，动态字段均经 `textContent` 或 `escapeHTML`，未见存储型 XSS 实例；该审查多数 `innerHTML` 点亦确认已转义，应判为“残留风险/需固化约定”而非确认漏洞。

### 9.4 验证状态
- 3 处修复（B1/B2/B3）：`node --check` 源文件 PASS，重建 bundle `chaoxing-force-play.user.js` BUILD GATE PASS，相关 sim 沙箱（`sim-quiz` / `sim-quiz-vision` / `sim-zh-exam` / `sim-zh-fab` / `sim-targeting` / `sim-width` / `sim-quiz-selectors` / `sim-quiz-p1`）全部 PASS，无回归。

### 9.5 本轮新增修复（§9.2 全部落地，2026-08-11）
已将上述 10 项 §9.2 发现全部处理（9 项代码修复 + 1 项确认已自愈/文档化），逐条变更与验证如下：

| # | 文件:行（修改点） | 修复内容 | 验证 |
|---|---|---|---|
| T1 | `foundation/state/state.js`（emit 跨帧转发） | `postMessage` 目标从 `'*'` 收窄为 `window.top.origin`（同站点 iframe 同源仍正常收到） | node --check PASS |
| T2 | `takeover/engine/quiz-vision.js`（quizVisionAsk + 新增 `_quizVisionHostAllowed`） | 视觉端点增加**主机白名单**：本地回环恒允许；远程主机须登记于 `CONFIG.QUIZ_VISION_ENDPOINT_ALLOW` 或 `localStorage.cx_quiz_vision_allow`，否则拒绝（未登记则仅本地可用） | node --check PASS；sim-quiz-vision PASS |
| T3 | `takeover/engine/quiz.js`（_quizResolveAnswer） | `src==='ai'` 且 AI 异步 `pending` 时，若本轮已收集 bank 答案则**优先用 bank 先放行**（返回融合后 `{idx,…}`），避免丢弃已知答案空等一拍 | node --check PASS；sim-quiz / sim-quiz-p1 PASS |
| T4 | `takeover/dom/dom.js`（neutralizeGlobalPause） | 引入稳定 no-op `_ananasPauseNoop`；仅当 `a.pause !== noop` 时才刷新 `__cxAnanasNativePause`，吸收平台**动态替换** pause 导致的还原 stale | node --check PASS |
| T5 | `takeover/foundation/meta-config/config.js`（applyUserRateAll） | 下发倍速时跳过 `cxState(v).released` 的视频（`typeof cxState` 守卫生效） | node --check PASS |
| T6 | `takeover/engine/playback.js`（nearEnd） | 增加 `v.duration > CONFIG.END_RELEASE_SEC` 边界守卫，避免超短视频被误判"进度到底"而释放 | node --check PASS |
| T7 | `takeover/engine/targeting.js`（keyRe） | 空 key 返回永不匹配正则 `/(?!)/`，消除 `.*` 误匹配所有 URL | node --check PASS；sim-targeting PASS=30/FAIL=0 |
| T8a | `takeover/engine/bridge.js`（restoreNativePause） | `v.__np` 缺失时回退 `HTMLMediaElement.prototype.pause` 真原生，确保还原不遗漏 | node --check PASS |
| T8b | `takeover/engine/bridge.js`（probeBridgeBase） | `_bridgeAllDead` 加 **60s 冷却**：冷却内跳过、冷却后允许重探，避免桥启动晚被永久判死 | node --check PASS |
| T9 | `takeover/foundation/utils/utils.js`（h） | 经核验：`on*` 函数型 key 已走 `addEventListener`（'on'+evt in el 判断），**无属性注入**——确认已自愈，无需改动 | —（已存在防护） |
| T10 | `foundation/state/state.js`（EventBus） | 经核验：模块注释已明确"实为事件总线、state 仅只读镜像"，名实问题已文档化——维持现状 | —（文档已澄清） |

**整体验证**：8 个改动源文件 `node --check` 全部 PASS；重建 bundle `chaoxing-force-play.user.js` BUILD GATE PASS（exit 0）；现有相关 sim 沙箱（`sim-quiz` / `sim-quiz-vision` / `sim-zh-exam` / `sim-zh-fab` / `sim-targeting` / `sim-width` / `sim-quiz-selectors` / `sim-quiz-p1`）全部 PASS，无回归。注：`sim-quiz-bridge.js` / `sim-quiz-p2.js` 在本工作区不存在（MODULE_NOT_FOUND 为文件缺失，非回归）。
