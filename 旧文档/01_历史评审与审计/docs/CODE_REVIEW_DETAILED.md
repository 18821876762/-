# 工作空间代码审查报告

> 审查范围：`ecosystem/src/chaoxing-force-play/`（核心运行时，约 57 个 JS）、`ecosystem/chaoxing-force-play.user.js`（打包产物，8183 行）、`build-force-play.ps1` + `package.json` + `_sim/`（构建与门禁）、`perception/`（Python 爬虫 + 独立用户脚本）、`scripts/`。
> 审查方式：静态分析 + 多代理分系统审查 + `node --check` 语法校验（产物退出码 0，语法有效）。
> 严重度分级：**P0**（致命/会导致崩溃或功能整块失效）、**P1**（高危运行时异常/逻辑错误）、**P2**（中等：性能/健壮性/可维护性）、**P3**（低：可读性/风格）。

---

## 一、执行摘要（整体评价）

| 维度 | 评级 | 说明 |
|---|---|---|
| 功能完整性 | **中高** | 覆盖超星/学银/智慧树/人卫/中国大学 MOOC 等多平台，含强制续播、随堂题/考试自动作答、弹窗拦截、DeepSeek 应答端联动、FAB 场景自适应面板。但 `renwei`（人卫慕课）因元数据 bug 实际是死代码；大量选择器为 best-effort，需真实站点校准。 |
| 健壮性 | **中等** | `bestEffort` 包装普遍吞掉异常（利于页面稳定但隐藏 bug）；存在死循环风险、异步重入、`var` 闭包捕获、指纹碰撞、未授权的 `GM_*` 调用等真实缺口。Python 侧重试/限速/原子写较完善。 |
| 工程实践 | **中等偏下** | 测试门禁（`_sim`）覆盖广是亮点；但构建门禁存在"假绿灯"（jsdom 未声明、ESLint 配置冲突、门禁漏判关键校验、不可重现构建）、`npm test` 路径失效、重复代码与魔法字符串偏多。 |

**最应优先修复的 5 项**：①`meta.js:18` 的 `@match` 行内注释使 renwei 整站失效；②`_sim` 依赖 `jsdom` 未声明导致门禁假绿/构建失败；③`.eslintrc` 双配置冲突致 lint 门禁形同虚设；④缺 `@grant` 声明（`GM_getValue` 等被用却未授权）运行时 `ReferenceError`；⑤`dedup.js` 祖先遍历存在死循环/性能热点风险。

---

## 二、P0 — 致命 / 整块失效问题

> **整改状态（2026-08-10 复核）：P0 全部关闭。** 验证方式：`build-force-play.ps1` 完整构建退出码 0，9 道门禁全绿
> （`node --check` / `_sim 44/44` / `eslint` / `contract verify` / `contract doc` / `contract semantics` + `SELFTEST` / `metadata` + `SELFTEST`）。
>
> | 编号 | 结论 | 落地内容 |
> |---|---|---|
> | P0-1 | ✅ 已修复 | `meta.js` 说明文字移到独立整行；新增门禁 ⑦ 断言 `@match/@include/@exclude/@connect/@grant/@require/@run-at` 取值必须为单 token |
> | P0-2 | ⚠️ 原判过重，已加防线 | 实测产物只调用 `GM_setValue`/`GM_addValueChangeListener`（均已 `@grant`），`GM_info` 唯一用点被 `typeof` 完全守卫 → **无真实 `ReferenceError` 风险**；仍按建议加了 `@grant` 双向差集门禁防将来回归 |
> | P0-3 | ✅ 已修复 | 删除被静默忽略的 `.eslintrc.json`；`.eslintrc.cjs` 补 `extends:'eslint:recommended'`（已 `--print-config` 验证生效）；门禁 ③ 前置断言「同目录只允许一份 `.eslintrc.*`」 |
> | P0-4 | ✅ 已修复 | `jsdom` 加入 `devDependencies`（`^29.1.1`） |
> | P0-5 | ✅ 已修复 | `dedup.js` 与 `targeting.js` 两处祖先遍历均加 `CONST.MAX_SCAN_DEPTH` 深度守卫 |
>
> **附带修复（复核中新发现，非原报告条目）**：`build-force-play.ps1` 与 `check-module-size.ps1` 为**无 BOM 的 UTF-8 且含中文**，
> Windows PowerShell 5.1 会按 GBK 解码，导致 `build-force-play.ps1` 直接**解析失败无法运行**（HEAD 版本实测 2 个语法错误）。已补 UTF-8 BOM，解析恢复 0 错误。
>
> **勘误**：执行摘要中"`npm test` 路径失效"不成立——`ecosystem/tests/pure.test.js` 实际存在。

### P0-1 `@match` 元数据行内注释使 renwei 整站不注入
- **位置**：`src/chaoxing-force-play/takeover/meta.js:18`（产物 `chaoxing-force-play.user.js:18`）
- **表现**：元数据行写成 `// @match *://*.pmphmooc.com/*   // 人卫慕课(renwei)：补全…`。UserScript 元数据块**无行内注释语法**，`@match` 的取值是该行 `@key` 后的整段文本，解析到的 pattern 含空格与中文，属非法模式，被 Tampermonkey 静默丢弃。
- **后果**：注释声称要修复的 bug 反而被固化——`sites/renwei.js` 在 pmphmooc.com 上仍是死代码。而 `_sim/sim-kvs.js` 用 jsdom 直接 eval 产物、不解析 `@match`，**仿真门禁永远发现不了**。
- **建议**：元数据行只保留纯 pattern，说明移到 `==/UserScript==` 之后的独立注释；构建冒烟校验增加规则——元数据块内 `@match/@include/@require` 行的取值部分不得再出现 `//`。

### P0-2 缺 `@grant` 声明（`GM_getValue` 等被使用却未授权）
- **位置**：`meta.js:21-22`（仅声明 `GM_setValue`/`GM_addValueChangeListener`）；对照 `.eslintrc.cjs/.json` 却把 `GM_getValue`/`GM_deleteValue`/`GM_xmlhttpRequest`/`GM_registerMenuCommand`/`GM_addStyle`/`GM_info`/`unsafeWindow` 列为 globals。
- **表现**：ESLint 的 `no-undef` 被这些 globals 声明"消音"，但运行时未 grant 的 `GM_*` 不会被注入。
- **后果**：若代码路径真正调用到未 grant 的 API，Tampermonkey 下直接 `ReferenceError`。只 grant `GM_setValue` 却不 grant `GM_getValue` 本身就是可疑的不对称组合。
- **建议**：扫描产物中实际出现的 `GM_\w+` 标识符，与 `@grant` 做双向差集校验，缺失即构建失败；ESLint globals 由该清单生成而非手写。

### P0-3 两份 ESLint 配置共存且规则冲突，lint 门禁给出虚假安全感
- **位置**：`ecosystem/.eslintrc.cjs`（74 行）与 `ecosystem/.eslintrc.json`（33 行），二者均设 `root: true`。
- **表现**：ESLint 级联查找优先级 `.js>.cjs>.yaml>.json`，实际生效的是 `.cjs`，`.json` 被完全忽略。更严重的是 `.cjs` **没有 `extends:'eslint:recommended'`**，意味着 `no-dupe-case`/`no-unreachable`/`no-func-assign` 等一大批默认红线未启用；而 `.json` 里 `no-unused-vars:warn`、`.cjs` 里是 `off`，维护者改 `.json` 毫无效果。
- **建议**：删除其中一份（保留 `.cjs`）并补 `extends:'eslint:recommended'`；构建脚本断言同目录 `.eslintrc.*` 只允许存在一个。

### P0-4 `_sim` 门禁依赖 `jsdom` 但未声明，且存在"假绿灯"
- **位置**：`ecosystem/package.json:16-18`（devDependencies 仅 `eslint`）；`build-force-play.ps1:199-222`；40 个 `_sim/sim-*.js`。
- **表现**：40 个仿真脚本 `require('jsdom')`。部分做了容错降级（`sim-kvs.js`/`sim-audit.js` 用 try/catch 后 `console.log('SKIP')` + `process.exit(0)`），但另一些是**硬 require**（如 `sim-addon-cleanup.js:15` 无 try/catch）。
- **后果**：① 干净环境 `npm install` 后跑 build，硬 require 脚本抛 `MODULE_NOT_FOUND`、门禁失败；② 软降级那批以**退出码 0 静默 SKIP**，于是 `BUILD GATE: _sim PASSED (47/47)` 照常打印，而大量断言根本没执行——绿灯是假的。
- **建议**：把 `jsdom` 加入 `devDependencies`；统一 SKIP 语义，汇总时区分 PASS/SKIP/FAIL 三态并显示 skipped 数量，SKIP>0 时不允许打印 "PASSED"。

### P0-5 `videoIframeSrcsOf` 祖先遍历存在死循环/性能热点
- **位置**：`takeover/engine/dedup.js:60-72`（同模式在 `takeover/engine/targeting.js:182-191` 完全重复）
- **表现**：`while (el && el.parentElement)` 内遇到 `IFRAME` 仅做签名收集、**不 break 也不推进**。跨文档场景依赖 `parentElement` 为 `null` 终止；若平台 `parentElement` 被重写为返回自身（部分播放器 shell 有此行为），则 `el=el.parentElement` 恒等，永不退出。
- **后果**：轻则主循环每 2 秒每视频遍历整条祖先链致卡顿，重则标签页冻结需强杀。
- **建议**：加显式深度上限守卫，收集到签名后 `break`：
  ```js
  var el = v, _depth = 0;
  while (el && el.parentElement && _depth++ < CONST.MAX_SCAN_DEPTH) {
    el = el.parentElement;
    if (el.tagName === 'IFRAME') { /* 收集 */ break; }
  }
  ```

---

## 三、P1 — 高危运行时异常 / 逻辑错误

### 核心运行时
- **P1-1 循环内 `var` 闭包捕获（清理逻辑脆弱）** — `takeover/dom/lifecycle.js:89-92,108-113,151-156`。`_a`/`_di` 为 `var`，当前因 `bestEffort` 同步执行侥幸正确，但 `uninstall()` 语义失真风险高：一旦 `bestEffort` 改为异步（如加 `setTimeout` 重试），5 处清理静默失效且被吞错。建议统一改 `let` 或 IIFE（同文件 99-104 行 `cleanup.instVideos` 已用正确写法）。
- **P1-2 `quizTick` 异步重入 + 闭包引用 `_c`/`idxObj`** — `takeover/engine/quiz.js:395,406,417`。`bestEffort` 内闭包访问循环变量；若 `_quizMaybeSubmit` 触发 DOM 事件回调重入 `quizTick`，`idxObj` 被覆盖，且 406/417 行 `idxObj.source` 在 `idxObj` 为 `null` 时抛 `TypeError` 被吞。建议把 `idxObj`/`_c`/`fp` 通过参数传入闭包。
- **P1-3 选项收集循环闭包 + 非法选择器被静默跳过** — `takeover/engine/quiz.js:98`、`sites/popup-quiz.js:45`。`sels[i]` 在闭包中；若某个选择器非法，`querySelectorAll` 抛错被 `bestEffort` 吞掉，无法区分"没匹配到"还是"选择器非法"。建议预校验选择器合法性并打日志。
- **P1-4 变量遮蔽** — `presentation/panel-controls.js:189`。`var api = ...` 重新声明，遮蔽上方 L64 用于 FAB 调用的同名局部变量，后续回调若依赖该引用会静默取错值。
- **P1-5 定时器泄漏 / 无下限校验** — `presentation/panel-core.js:221`、`commands.js:78`。`__cxRescan` 滑块每次 `input` 都 `clearInterval`+`setInterval` 重建全局主循环，用户拖到 0 即 `setInterval(fn,0)` 空转；高频拖动会短时多定时器并存。建议加 `RESCAN_INTERVAL` 下限守卫（如 ≥300ms）。
- **P1-6 脏检查失效** — `presentation/dashboard.js:316`。`renderVideoList` 用 `wrap.__cxLastHTML !== html` 跳过重绘，但整段 HTML 每次轮询重建，多视频交替时可能巧合相等而跳过状态刷新，致显示滞后。
- **P1-7 指纹碰撞导致去重误判** — `takeover/engine/quiz.js:82`。`_quizFingerprint` 仅取题干 `textContent` 前 120 字符去空白，长题干前段相同的不同题目会生成相同 fp，使 `_quizHandled` 误判"已作答"而跳过真正未作答的新题。建议加入题目选项/长度哈希作为次级特征。

### 构建流程
- **P1-8 `git rev-parse` 失败分支形同虚设** — `build-force-play.ps1:148-150`。脚本顶部 `$ErrorActionPreference='Stop'`；当前目录非 git 仓库时 `git` 返回非 0 且 stdout 为空，`(...)` 求值为 `$null`，`.Trim()` 在 `$null` 上行为依赖版本，可能中断构建。建议显式 `if ($gitSha)` 守卫后再 `.Trim()`。
- **P1-9 门禁漏判关键修复校验** — `build-force-play.ps1:207`。`_sim` 门禁仅用 `sim-*.js` 通配，而 `verify_fixes.js`/`verify_patch.js`/`smoke-pw.js` 三个验证脚本未被匹配执行，修复落产检验（`ALL_FIXES_VERIFIED`/`PATCH_MISSING`）从不真正运行。
- **P1-10 真实浏览器冒烟被门禁绕过** — `_sim/smoke-pw.js:1-13`。依赖 `playwright`（仅 `_sim/package.json` 声明且需完整 chromium），既不在 `sim-*.js` 门禁内、又无 skip 处理，关键端到端验证永不进构建门禁。
- **P1-11 门禁顺序缺陷 / 损坏产物残留** — `build-force-play.ps1:174`。`node --check` 仅校验语法，契约/语义门禁在 `WriteAllText` 落盘之后运行；一旦契约校验失败 `exit 1`，已写出不一致产物残留在磁盘，无清理回滚。建议先全部校验通过再落盘。
- **P1-12 构建元数据污染产物（不可重现构建）** — `build-force-play.ps1:148`。`Built:` 行含本地 commit 与时间戳被拼入正式产物，同一源码每次构建字节不同，git diff 对产物无意义、难以判断逻辑变更。建议把构建元数据写入独立注释块或另行生成 manifest，不污染可比较的逻辑产物。

### Python 感知模块
- **P1-13 `clazzid` 未归一化即使用** — `perception/cx_crawler/dump.py:180-182`。`clazzid = ch.get("clazzid")` 原始值（可能字符串/None）直接进 `API[...].format(clazzid=...)`，而 `courses.py` 已把 `clazzid` 归一化为 `int`。若返回非数字会拼入 `"None"` 污染 URL。建议对 `clazzid` 做 `_to_int` 守卫，为 `None` 时跳过。
- **P1-14 `429` 限流不处理** — `perception/cx_crawler/api_client.py:42-53`。`raise_for_status` 仅对 5xx 触发；429（限流）与 400/404 既不重试也不专门处理，被 429 时不会退避，可能加剧风控。建议对 429 单独处理（尊重 `Retry-After` 退避），其余 4xx 至少记 warning。

---

## 四、P2 — 中等（性能 / 健壮性 / 可维护性）

- **P2-1 键盘监听未解绑** — `presentation/panel.js:114`。`document.addEventListener('keydown', keydownHandler)` 注册但文件内无移除调用路径，多帧/重载下全局键盘监听会叠加。
- **P2-2 未缓存 DOM 查询（性能热点）** — `presentation/dashboard.js:260`。`refreshPanelState`/`updateBadge`/`renderVideoList`/`renderDashboard` 各自独立调用 `allVideos()` 4+ 次，每轮重新遍历 DOM 收集视频。
- **P2-3 选择器过宽误删题目区** — `takeover/engine/quiz.js:29-30`。`POPUP_BOX_SELS` 含 `[class*="mask"]`/`[class*="layer"]` 等通配属性选择器，`_quizClosePopup` 会把普通考试页中 class 含 "mask"/"layer" 的容器当弹窗 `removeChild` 删除，误删题目区。
- **P2-4 重复代码 / 样板** — `presentation/panel-core.js:168`（散落 5+ 处"遍历视频+bind"）、`presentation/diagnostics.js:151`（同构审计清单）。建议抽取 `forEachVideo(cb)` 工具 / 表驱动。
- **P2-5 魔法字符串三处硬编码** — `presentation/commands.js:144` 的 tab 映射与 `panel-template.js:77-80`、`switchTab` 各自硬编码，新增 tab 需同步改 3 处。
- **P2-6 闭包绑定冗余 + 嵌套过深** — `panel-core.js:330` `switchTab` 超 20 行混合 DOM 与持久化，建议拆 `applyTabVisibility`/`syncTabButtons`。
- **P2-7 `session.py:37` 用 `os.path.exists` 而非 `isfile`** — 若 `cookies.json` 是目录，`json.load` 抛 `IsADirectoryError` 绕过友好报错。
- **P2-8 `dump.py:340` 局部 `import time`** — 函数体内 import，风格不一致，建议提到模块顶层。
- **P2-9 `render.py:50` 闭包命名误导** — `on_resp(r, _j=jobids, _o=objectids)` 参数带下划线暗示未用，实际被引用。
- **P2-10 `quizzes.py` 等 `print` 与 `logger` 混用** — 输出无 `TRACE_ID`/日志级别，排错割裂。
- **P2-11 `media-collector.user.js:51` 信任边界过宽** — `trustedOrigin` 白名单含 `.edu.cn` 通配，与 `@match` 仅 `chaoxing.com`+`file://` 不一致，恶意教育子站可伪造 postMessage 注入本地记录。建议收紧为仅 `chaoxing.com`+`file://`。
- **P2-12 `scripts/calibrate-dump.js:35` NodeList.forEach 兼容性** — 旧 WebView 无 `forEach`，建议 `Array.prototype.forEach.call(boxes, ...)`。
- **P2-13 `verify_patch.js:1` 硬编码相对路径** — `readFileSync('chaoxing-force-play.user.js')` 裸相对名，非脚本目录运行即找不到产物，与 `verify_fixes.js` 的 `__dirname+'/../'` 风格不一致。
- **P2-14 `$deprecated` 恒空** — `build-force-play.ps1:128` 注释声称同步但从未填充，孤儿 `.js` 只能报错、deprecated 通道不可用。
- **P2-15 编码读写不一致** — `build-force-play.ps1:137-138,155`。`ReadAllText` 默认按系统编码读取各 chunk，写出强制 `UTF8Encoding($false)`，读/写编码假设不对称，任一源模块带 BOM 会污染产物首字节。
- **P2-16 门禁脚本静默跳过** — `build-force-play.ps1:243,261,281`。`verify_contracts.js` 等 4 个门禁脚本若不存在仅打印 yellow skip 不 `exit 1`，全新克隆时核心门禁静默失效。
- **P2-17 `package.json:9` `test` 路径缺失** — `"test":"node tests/pure.test.js"` 引用 `tests/` 但仓库无此目录（仅有 `_sim/`），`npm test` 直接失败，与门禁实际使用的 `_sim` 脱节。

---

## 五、P3 — 低风险（可读性 / 风格）

- `panel.js:8-11` 注释膨胀（单例契约靠注释约定，无运行时保障）。
- `commands.js:139` 命名混乱（`--cx-panel-w` / `/width` / `PANEL_W` / `#__cxPanelW` 四层混写）。
- `quiz.js:50` 内存护栏常量兜底值（`1800000`/`1000`）与 `CONST.QUIZ_*` 默认值散落两处。
- `build:80` 三行 `$domainRel` 多缩进两空格排版噪声。
- `chaoxing-force-play.user.js:30` 产物内 `// Built:` 注入行未在源码 meta.js 说明由脚本生成，易误导手改。
- `_sim/verify_fixes.js:9` 用 `'开'<'关'` 中文码点比较判断反转，依赖 Unicode 顺序，文案微调即假阴性。
- `build:310` 诊断输出打印完整 50+ 模块路径拼接串，CI 日志冗长。
- `verify_patch.js`/`verify_fixes.js` `require` 风格混用（单行 vs `var fs=`）。
- `perception/cx_crawler` 缺 `pyproject.toml`，无法作为可安装包分发；`cookies.json` Windows 下 `chmod 0o600` 不生效（已在注释说明）。
- `output/` 写满/磁盘空间（ENOSPC）未与"普通失败"区分告警。

---

## 六、横切关注点：被普遍采用的 `bestEffort` 模式的双刃剑

全代码库大量使用 `bestEffort(fn, tag)` 包裹 DOM 操作与回调。它在**页面稳定性**上收益明显（单个错误不破坏主循环），但带来两个系统性风险：

1. **错误被静默吞掉**：逻辑 bug（如非法选择器、null 访问、重入覆盖）不会暴露，只表现为"功能偶尔不工作"，极难排查。
2. **纵容 `var` 闭包脆弱性**：因为 `bestEffort` 当前是同步的，多处循环内 `var` 闭包"侥幸正确"，一旦改为异步即集体失效。

**建议**：`bestEffort` 内部增加按 `tag` 的失败计数与可选 `console.warn`（可在调试模式开启），避免完全静默；并将所有循环内 `var` 改为 `let`/IIFE 以根除脆弱性（P0-5/P1-1/P1-2/P1-3 同源）。

---

## 七、改进优先级路线图

1. **立即修（阻断功能）**：P0-1 `@match` 注释、P0-2 `@grant`、P0-3 双 ESLint、P0-5 死循环守卫、P1-13 `clazzid` 归一化。
2. **本迭代修（门禁可信度）**：P0-4 `jsdom` 依赖、P1-8~P1-12 构建门禁假绿/顺序/元数据污染、P2-17 `npm test` 路径。
3. **近期重构**：P1-1/P1-2/P1-3 `var`→`let`/IIFE、P1-5 定时器下限、P1-7 指纹碰撞、P2-2/P2-3 性能与选择器收窄、统一 `bestEffort` 日志。
4. **持续清理**：P2/P3 的魔法字符串、重复代码、命名、编码一致性、`print`→`logger`。

> 说明：本报告基于静态审查，凡标注"best-effort/待真实站点校准"的选择器问题，建议在真实平台 HTML 下做一轮回归以确认是否已实际触发。审查过程中未修改任何源文件。
