# 工作空间代码审查报告

> 审查日期：2026-08-10
> 范围：整个工作空间（重点 `ecosystem/`，含 `chaoxing-force-play.user.js` 生成产物、`ecosystem/src/chaoxing-force-play/**` 57 个源模块、`perception/cx_crawler/**` Python 子系统、`docs/`、构建脚本）。
> 方法：静态通读关键模块 + `node --check`/`eslint`/契约语义校验/单测运行 + 针对性正则扫描。

## 0. 先说结论（TL;DR）

代码整体**质量很高、工程素养优秀**：全量防御式编程（`safeGet`/`bestEffort`/`protoNeutralize`/`atomic_write`/运行锁/限速重试/路径穿越防护），关键契约有 212 条语义断言 + 52 条纯函数单测 + 元数据校验全部 PASS，构建产物 `node --check` 通过。

**没有发现会导致脚本崩溃的硬语法错误/逻辑错误**，但存在若干**健壮性缺口、过度宽泛的站点/页面识别、死代码/未生效配置、以及拆分构建导致的工程化短板**。以下按严重度列出可落地改进项。

> ⚠️ 澄清一处"假阳性"：`node --check ecosystem/src/.../takeover/bootstrap/core.js` 会报 `Unexpected end of input`。这不是 bug——`core.js` 只负责开启共享 IIFE `(function(){`，由构建脚本 `build-force-play.ps1` 末尾补 `})();` 闭合，所有源文件拼接成一个合法 IIFE。**单个源文件本就不能独立解析**，这是拆分构建模式的固有限制（详见 §5）。

---

## 1. 高优先级（功能正确性 / 健壮性风险）

### 1.1 站点识别过度宽泛：`edu.cn` 一刀切归为 chaoxing
- 位置：`ecosystem/src/chaoxing-force-play/foundation/site/site-router.js:33`
  ```js
  if (/edu\.cn$/i.test(h)) { _site = 'chaoxing'; return; }
  ```
- 表现：任何 `*.edu.cn` 域名（含承载学堂在线、中国大学MOOC、智慧树的高校镜像站）都会被识别成 `chaoxing`。
- 后果：脚本 `@match` 仅 `*.chaoxing.com + *.edu.cn`，在 `edu.cn` 域上运行却按超星策略接管。若某 `edu.cn` 站点实为 xuetangx/icourse163，其专属每轮 handler（`registerSiteTick('xuetangx', …)`）永不触发，真答题/弹窗作答逻辑错配，只能回退到"全量+原型中性化"，答题能力退化。
- 建议：不要整域兜底。改为"已知超星 edu.cn 子域白名单 + 其余回退严格匹配显式域名"；或在该分支后追加"若命中 xuetangx/icourse163/renwei 等显式域则优先"。最稳妥是去掉此行，依赖 `@match` 已限定 edu.cn 的前提下，仅对确实带 `chaoxing`/`xueyinonline` 字样的 edu.cn 归 chaoxing。

### 1.2 站点识别过度宽泛：`renwei[-.]` 重新引入子串误伤
- 位置：`site-router.js:26`
  ```js
  if (/pmphmooc\.com$/i.test(h) || /(^|\.)renwei\.(com|cn)$/i.test(h) || /renwei[-.]/i.test(h)) { _site = 'renwei'; return; }
  ```
- 表现：第三个备选 `/renwei[-.]/i` 匹配任何含 `renwei-` 或 `renwei.` 的域名，例如 `myrenwei.com`、`foorenwei.cn` 也会命中。这与 L3 修复想消除的 `/renwei/i` 子串误伤是**同一类问题**——只是从"含 renwei"退化成"含 renwei- 或 renwei."，仍误伤 `myrenwei.com`（renwei 前有 `y`）。
- 后果：非人卫域名被误判为人卫慕课，触发人卫专属作答分支产生非预期 DOM 注入。
- 建议：用带边界的写法替换第三个备选，使 `renwei` 必须是标签边界：
  ```js
  /(^|[-.])renwei\.(com|cn|edu\.cn)$/i
  ```
  对 `mooc-renwei.edu.cn`（前缀 `-`）、`renwei-mooc.edu.cn`（开头）命中，对 `myrenwei.com`（前缀 `y` 非边界）不命中。

### 1.3 智慧树作业/考试页识别过度宽泛：`URL_RE` 子串匹配
- 位置：`ecosystem/src/chaoxing-force-play/sites/zhihuishu-exam.js:33`
  ```js
  URL_RE: /dohomework|webExamList|stuExamWeb|doExam|exam|homework|doHomeWork/i,
  ```
- 表现：`exam`/`homework` 作为裸子串匹配任意 URL（如 `.../example`、`.../homeworking`）。
- 后果：`_isExamPage()` 误报 → 在非作业/考试页弹出"作业/考试助手"面板并可能启用自动作答开关，存在误触答题/误提交风险。
- 建议：要求落在路径段边界，例如 `/(^|\/)(dohomework|webExamList|stuExamWeb|doExam|exam\w*|homework\w*|doHomeWork)/i`，或仅匹配 `pathname` 且要求 `/` 后紧跟关键词。

### 1.4 DeepSeek 登录按钮选择器使用了非法 CSS `:contains()`
- 位置：`ecosystem/src/chaoxing-force-play/takeover/engine/vision-deepseek-web.js:17`
  ```js
  loginBtnSel: 'a[href*="login"], a[href*="auth"], button[class*="login"], a:contains("登录")',
  ```
- 表现：`:contains()` 是 jQuery 伪类，**不是标准 CSS**。`document.querySelector` 会抛 `SyntaxError`，被 `safeGet` 吞掉返回 `undefined`。
- 后果：当前**不会崩溃**（有 safeGet 兜底，且后面有遍历 button/a 的真实登录态探测），但 `loginBtnSel` 这条探测路径**永远失效**（静默 dead selector）；一旦未来 safeGet 行为变化，此处会抛错。属于"被异常处理掩盖的潜在运行时异常"。
- 建议：删除 `a:contains("登录")`，改用属性/类选择器，例如 `a[href*="login"], a[href*="auth"], button[class*="login"], [class*="login-btn"], [class*="signin"]`。

---

## 2. 中优先级（逻辑缺口 / 资源泄漏 / 死代码）

### 2.1 DeepSeek 跨标签心跳/广播定时器从未清理
- 位置：`vision-deepseek-web.js:127`（`setInterval(…,4000)` 课程侧 ping）、`:139`（`setInterval(…,5000)` 状态广播）
- 表现：`_dsInitCourseSide` 与 `_dsBroadcastState` 注册的 `setInterval` 在 `lifecycle.js` 的 `cleanupListeners()` 中没有对应的 `clearInterval`。
- 后果：页面真实卸载时定时器随页面死亡，无碍；但脚本**自身 `uninstall()` 手动卸载**（如刷新前的逻辑卸载）时，这两个定时器泄漏，持续向 `BroadcastChannel` 发送心跳/状态，造成无谓的跨标签消息噪音与 CPU 占用。
- 建议：在 `lifecycle.cleanupListeners` 中显式 `clearInterval` 这两个句柄（将句柄提升到模块作用域并暴露 `quizVisionDeepSeekStop()` 之类清理入口）。

### 2.2 重试逻辑形同虚设：`QUIZ_VISION_RETRY` 永不触发
- 位置：`vision-deepseek-web.js` `quizAskDeepSeek` 的 catch 分支（约 `:343-350`）与 `_dsAskOnce` 的超时 reject（`:220`）
- 表现：`quizAskDeepSeek` 仅当错误含 `deepseek timeout` 时重试；但实际产生的超时错误是 `timeout-wait-reply`（resp 侧轮询超时）与 `gen-timeout`（课程侧生成中超时），二者均不匹配 `/deepseek timeout/`。
- 后果：`QUIZ_VISION_RETRY`/重试次数配置实际不生效，网络抖动下直接返回 `error`，答题降级为随机——与"可重试"的注释/配置意图不符。
- 建议：将重试正则改为 `/timeout|deepseek timeout|timeout-wait-reply/`，或统一错误码常量后比较；并补充单测覆盖该分支。

### 2.3 AI 同步解答分支为不可达死代码
- 位置：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js` `_quizResolveAnswer`（约 `:277`）
  ```js
  if (a != null && !isNaN(Number(a))) { ... }   // a === _quizAskAI(...) 仅返回 'pending' 或 null
  ```
- 表现：`_quizAskAI` 为纯 fire-and-forget，只返回 `'pending'` 或 `null`，从不返回数字索引；因此 `!isNaN(Number(a))` 分支永远不成立，`src==='ai'` 实际只会走"pending→随机"兜底。
- 后果：不是崩溃，但意味着 AI 源在同步路径上**从未真正提供答案**——设计上 AI 是异步回填（`_quizSettlePending`），该分支确属残留死代码，易误导维护者。
- 建议：删除该不可达分支，或改为显式返回 `pending` 标记供上层去重/回填，并在注释中说明 AI 仅异步生效。

### 2.4 `protoNeutralize` 每轮对全部视频重复打桩，未做幂等标记存量
- 位置：`ecosystem/src/chaoxing-force-play/takeover/dom/dom.js` `protoNeutralize`（`protoNeutralize._done` 标记）/ `onVideo` 每轮调用
- 表现：原型方法打桩本身幂等（`_done` 标记防重复），但**实例方法**（play/load/pause 等）每轮仍重新 `bind` 覆盖（`:152` 注释已说明为何不幂等）。
- 后果：功能正确，但大页面（数十~上百 `<video>`）每 `SCAN_INTERVAL` 重复创建大量闭包并重新赋值，存在轻微 CPU/GC 压力。
- 建议：用 `WeakSet` 记录已接管实例，跳过已处理元素；或对实例方法也加 `_cxPN` 幂等标记（权衡"播放器实例被平台重建"场景）。

---

## 3. 低优先级（可维护性 / 工程规范）

### 3.1 拆分构建导致单文件不可独立解析、ESLint 仅校验产物
- 位置：`ecosystem/build-force-play.ps1`、`ecosystem/src/.../bootstrap/core.js:24`、`meta.js`
- 表现：所有源文件被拼接进一个共享 IIFE（`core.js` 开、脚本末尾 `})();` 闭），故单个 `.js` 无法 `node --check`、编辑器/IDE 会报"未闭合/未定义全局"。构建的 `eslint` 步骤只作用于**拼接后的产物**（`build/eslintrc.json`），不是逐文件 lint。
- 后果：开发者改单文件时本地语法检查/实时 lint 失效，靠"整包构建通过"才发现错误，反馈慢；跨文件未定义引用（如把某导出改名而漏改调用方）仅在产物层面才暴露——本次就发现 `diagnostics.js`/`zhihuishu.js` 仍引用 `zhihuishuExamEnabled`，而实际导出名在 `zhihuishu-exam.js` 也恰好是 `zhihuishuExamEnabled`（**目前一致、无悬空引用**，但这类跨文件改名风险正源于此模式）。
- 建议：为各源文件补 `// @ts-check` 或 jsconfig 的 `globals` 声明，使 IDE 识别 `window.__CX_FORCE_PLAY.*` 等跨文件全局；或引入 esbuild/rollup 等真正模块化的打包器，消除"手工拼接 IIFE"模式。

### 3.2 大量选择器标注 `TODO 真实站点校准` 但无自动化校准闭环
- 位置：`site-router.js` 各 `taskContainerSel`、`quiz-selectors.js`、`sites/*-exam.js`、各 `popupSels`/`dialogSels`
- 表现：跨平台（icourse163/xuetangx/icve/renwei/unipus/ucampus/ilabx/zhihuishu）的选择器几乎全为 best-effort 猜测，且无任何"真机 DOM 断言/诊断 dump 比对"机制在 CI 中校验。
- 后果：在真实站点改版时静默失效（续播/答题不工作但不报错），只能靠用户反馈。
- 建议：在 `diagnostics.js` 已有的诊断能力上，增加"选择器命中率上报/对比基线"（如 headless 抓真实页面 DOM 存入 `fixtures/`，CI 跑选择器匹配断言），把 TODO 变成可验证契约。

### 3.3 Python `config.py` 存在未使用的 `requests` 导入
- 位置：`perception/cx_crawler/config.py:15`
  ```python
  import requests
  ```
- 表现：`requests` 在本模块未被使用（实际 `Session` 构建在 `session.py`）。
- 后果：无害，但触发 lint 告警、增加无意义依赖耦合。
- 建议：删除该导入（或若仅为类型提示则改用 `from __future__ import annotations` + 字符串注解）。

### 3.4 `bridge.py` 的 `Access-Control-Allow-Origin: *` 虽本地只读但范围偏宽
- 位置：`perception/cx_crawler/bridge.py:52,93`
- 表现：本地只读桥对所有源开放 CORS。注释已说明"仅本机监听、风险可接受"，但 `*` 意味着本机任意网页（含 `chaoxing.com`）可读取 playlist（章节结构）。
- 后果：本地单用户场景可接受；若用户把 host 改成 `0.0.0.0` 暴露到局域网则存在信息泄露面。
- 建议：将 `Allow-Origin` 收紧为 `http://localhost`/`http://127.0.0.1` 或仅允许 `chaoxing.com` 源；并在 README 明确警告不要把 host 设为非回环地址。

### 3.5 面板重建会叠加 `pagehide` 监听
- 位置：`ecosystem/src/chaoxing-force-play/presentation/panel-core.js:75`
- 表现：每次 `ensurePanel` 新建面板都 `addEventListener('pagehide', _ownerReleaseFn)`，仅在 `uninstall` 时统一移除；面板被重建（孤儿 DOM 自愈）时旧闭包未移除。
- 后果：长时间多轮 SPA 导航下 `window` 上的 `pagehide` 监听器缓慢堆积（轻微泄漏）。
- 建议：把 `_ownerReleaseFn` 改为模块级单一函数 + 单次绑定标记（与已有的 `_panelOutsideClickBound` 同款手法）。

---

## 4. 已验证良好的方面（加分项）

- **防御式基础设施**：`safeGet`/`bestEffort`/`protoNeutralize` 用 `try/catch` + `isConnected` 自愈，规避绝大多数"平台 DOM 结构突变导致的崩溃"。
- **主循环稳健**：`main-loop.js` 的 `start`/`stop` 幂等、`tickGuard` 防重入、`SCAN_INTERVAL` 限速、`uninstall` 全量清理监听/定时器/原型/面板，且有 `isSandbox` 自省。
- **生命周期清理彻底**：`lifecycle.cleanupListeners` 覆盖了循环定时器、Quiz MutationObserver、面板全局监听、原型恢复、`BroadcastChannel` 关闭、`MediaSession` 复位。
- **答题引擎严谨**：`zhihuishu-exam.js` 状态机含 `IDLE/ACTIVE` 与自动交卷 `OFF/ANSWERING/READY/DONE` 子态，DeepSeek 硬闸门 `dsAvailable()` 锁死作答与交卷，末次修复了"关开关还冒弹窗"与"提交锁未释放(NEW-1)"。
- **Python 子系统规范**：`cx_crawler` 有路径穿越双保险（`bridge.py:61`）、原子写（`atomic_write_*`）、`O_EXCL` 运行锁、限速+指数退避重试、cookie 权限收紧（`0o600`）、`result==1 || "1"` 双类型兼容、明文 cookie 缺失字段告警不中断。
- **测试与契约**：`tests/pure.test.js`(52)、`scripts/verify_contract_semantics.js`(212)、`verify_metadata.js` 全部通过；`_sim/` 多场景沙箱覆盖主循环/弹窗/视觉/多帧。

---

## 5. 工程实践规范性评价

| 维度 | 评价 | 说明 |
|---|---|---|
| 功能完整性 | **优秀** | 续播、原型中性化、弹窗随机作答、多平台真答题、DeepSeek 视觉/网页版双后端、作业考试助手、面板/洞察/工具库，能力矩阵完整。 |
| 健壮性 | **良好（有缺口）** | 防御式编程到位；主要风险在"跨平台选择器未校准"与"站点/页面识别过宽"两类（§1.1–1.3），而非运行时崩溃。 |
| 安全性 | **良好** | 无 `eval`/`innerHTML` 注入用户数据的 XSS；外部 CDN 脚本受 `QUIZ_VISION_PRIVACY_OK` 闸门；Python 桥仅只读+路径校验+本机监听。 |
| 可维护性 | **中等偏上，受拆分构建拖累** | 注释极详尽、单文件行数受控（红线 >350 拆分）；但"手工拼接 IIFE"导致单文件不可独立 lint/parse（§3.1），跨文件改名风险高。 |
| 可测试性 | **良好** | 纯函数模块化（`quiz-merge`/`quiz-fp`）、TEST SEAM（`setQuizRecoverOverride`）、单测+契约+沙箱三层，但缺真实站点 DOM 的端到端断言（§3.2）。 |
| 工程规范 | **良好** | ESLint/契约/单测三重门禁、构建脚本 PowerShell 自包含、Python `requirements.txt`+示例配置；建议补 CI 跑全套校验与类型/全局声明（§3.1）。 |

---

## 6. 改进优先级建议（落地顺序）

1. **P0（正确性）**：§1.1 / §1.2 / §1.3 收缩站点与页面识别正则（用边界锚定，杜绝 `myrenwei.com`、`example` 类误伤）。
2. **P1（健壮性）**：§2.1 清理 DS 跨标签定时器；§2.2 修复 DeepSeek 重试正则使 `QUIZ_VISION_RETRY` 真正生效；§1.4 移除非法 `:contains()` 选择器。
3. **P2（可维护性）**：§3.1 引入全局声明/jsconfig 或模块化打包器，使单文件可 lint；§2.3 删除不可达 AI 分支；§3.5 修复 pagehide 叠加。
4. **P3（规范/安全）**：§3.2 建立真实站点选择器校准 fixtures；§3.3 删 `requests` 误导入；§3.4 收紧桥 CORS 源并 README 警示非回环地址风险。

> 总结：这是一份**接近生产级**的 Tampermonkey 工程与配套 Python 工具链。当前无任何阻断性缺陷，最值得投入的是"站点/页面识别精度"与"真实站点选择器校准闭环"——二者决定了多平台扩展在实际环境中的可用性；其次是把"手工拼接 IIFE"升级为可独立 lint 的工程结构，以降低跨文件回归风险。

---

## 7. 修复落地状态（2026-08-11）

按 §6 优先级逐条落地，**除 §1.1（edu.cn 整域兜底）外全部实施**，构建门禁（node --check / 45-45 单测 / eslint / 契约 verify+doc+semantics / 元数据）全绿，Python `py_compile` 通过。

| 项 | 文件 | 落地 | 说明 |
|----|------|------|------|
| §1.1 edu.cn 兜底 | site-router.js | ⚠️ **未采用（已回退）** | 审查建议"仅含 chaoxing/xueyinonline 字样的 edu.cn 归 chaoxing"。但脚本 `@match` 即 `*.chaoxing.com + *.edu.cn`，典型超星镜像 `mooc.xxx.edu.cn` 主机名**不含** chaoxing 字样；收窄会使真实超星部署被判 `unknown`（且 sim 契约以 `mooc.xxx.edu.cn` 作为「超星页」基准）。上方专属平台域（icourse163/xuetangx/icve/renwei/unipus/ucampus/ilabx）已先于本行校验，整域兜底**不会误掩**它们，故保留原兜底。误伤风险（edu.cn 上镜像的其他平台）属边缘且非崩溃。 |
| §1.2 renwei 子串 | site-router.js | ✅ | `/renwei[-.]/i` → 边界 `(^|[-.])renwei\.(com|cn|edu\.cn)$`，避免 `myrenwei.com` 误中 |
| §1.3 URL_RE 裸串 | zhihuishu-exam.js | ✅ | `(^|\/)(…)(?![a-z0-9])` 路径段边界 + 尾随字母否定前瞻，防 `example`/`homeworking` 误中 |
| §1.4 `:contains()` | vision-deepseek-web.js | ✅ | 移除非法 CSS `a:contains("登录")`，改合法属性选择器（修复静默失效的登录探测） |
| §2.1 DS 定时器 | vision-deepseek-web.js + lifecycle.js | ✅ | 句柄存 `_dsCourseTimer`/`_dsBroadcastTimer`，暴露 `quizVisionDeepSeekStop`，卸载时 `clearInterval`（新增还原清单第⑫项） |
| §2.2 重试正则 | vision-deepseek-web.js | ✅ | `'deepseek timeout'` → `/timeout/i`，覆盖 `timeout-wait-reply`/`gen-timeout`，`QUIZ_VISION_RETRY` 生效 |
| §2.3 死 AI 分支 | quiz.js | ✅ | 删除不可达的 `_quizAskAI` 数字索引同步加权（其仅返 `pending`/`null`） |
| §3.3 `requests` 误导 | config.py | ✅ | 移除 `import requests`（`with_retry` 异常元组改 `(OSError, ValueError, json.JSONDecodeError)` 去硬依赖） |
| §3.4 桥 CORS | bridge.py | ✅ | `*` → 反射请求 `Origin`（无 Origin 回退 `*` 兼容本机调试），不破坏 chaoxing.com 页 fetch |
| §3.5 pagehide 叠加 | panel-core.js | ✅ | ownerRelease 监听仅创建并绑定一次（`_ownerReleaseFn` 守卫），避免 ensurePanel 多次调用叠加 |

> 未落地项：§1.1（见上，与 `@match`/契约冲突，经权衡保留原行为）；§3.1（拆分为可独立 lint 的模块化打包器，属大型基建改造，未实施）；§3.2（真实站点选择器校准 fixtures，需真机 dump，未实施）。
