# chaoxing-force-play 幂等性专项审查报告（构建链 + Python 感知层）

- 审查范围 A：构建链（ecosystem/）——build-force-play.ps1、check-module-size.ps1、ecosystem/scripts/*、build-manifest.txt、_recover_manifest.js、tests/pure.test.js、ecosystem/_sim/*（幂等相关用例）、package.json
- 审查范围 B：Python 感知层（perception/cx_crawler/）——bridge.py、dump.py、api_client.py、session.py、config.py、courses.py、render.py、chapters.py、heartbeat.py、quizzes.py、tests/*
- 审查口径：只审幂等性——重复执行同一操作应产生相同结果、不累积副作用、不留下脏状态
- 审查方式：逐文件代码审查 + 实际执行验证（重复构建 hash 对比、构建前后源树 hash 对比、测试双跑、bridge 双实例、RunLock 陈旧锁模拟）
- 验证环境：Windows / PowerShell 7 / node v24.19.0 / Python 3.x；git 2.55.0
- 审查日期：2026-08-17

---

## 一、审查范围与结论摘要

**结论摘要（致命 0 / 严重 4 / 一般 5 / 建议 3 / 正向 8）：**

| 严重度 | 数量 | 关键点 |
|---|---|---|
| 致命 | 0 | — |
| 严重 | 4 | A1 产物内嵌 `Built:` 时间戳 → 两次构建字节不同；A2 构建必需输入（build-manifest.txt / scripts/ / 3 个源文件）未纳入 git → 全新 checkout 无法构建；A9 pure.test.js 确定性红（CX_KEYS 漂移）；B1 bridge 重复启动在 Windows 上静默双绑同一端口 |
| 一般 | 5 | A3 产物写入非原子（中断留半文件）；A4 -Minify 跨环境不可复现（esbuild 缺失静默回退）；B2 playlist 内嵌 generatedAt 时间戳；B3 RunLock 陈旧锁残留永久阻塞；B4 原子写中断残留 .tmp |
| 建议 | 3 | A8 仓库残留旧日志/一次性恢复脚本；A10 sim-idempotency 场景3 断言落空可空转；A11 uninstall 幂等覆盖缺口 |
| 正向-良好实践 | 8 | A5 构建不改源文件；A6 门禁全部只读；A7 并行门禁无共享写可安全重入；A12 sim 测试无文件写输出稳定；B5 dump 固定文件名覆盖不追加；B6 cookies 合并覆盖不重复追加；B7 无后台线程/进程残留；B8 Python 测试幂等稳定；B9 bridge 只读无状态 |

**关键实证（已验证，非臆测）：**

1. **构建确定性**：同一源码、间隔 2 秒连续构建两次 → 产物 SHA256 不同（`A1E74304…` vs `2839B1C6…`），逐行 diff 仅有 1 处差异：`// Built: <时间戳>` 行（含 `+08:00` 时区偏移）。其余 8992 行逐字节相同。
2. **构建无源副作用**：三次构建前后，src 树 58 个 .js 文件 SHA256 全部未变（changed=0）。
3. **构建可重入**：在连续 3 次 `-Fast` 构建之后，全量构建（含 eslint + 45 个 sim 门禁）重跑 exit 0 全绿灯，产物与 Fast 构建同样仅差 `Built:` 行。
4. **测试**：`node tests/pure.test.js` 连续两次均 exit 1（`ReferenceError: CX_KEYS is not defined`，tests/pure.test.js 加载 utils.js 顶层语句即抛）；`quiz-merge.test.js` 25/25 通过；7 个幂等相关 sim 用例全部 PASS，其中 sim-idempotency / sim-addon-cleanup 连跑 2 次输出逐字节一致；Python 33 个用例连跑 2 次均 OK（exit 0）。
5. **bridge 双实例**：端口 7531 已有一个 `python bridge.py` 监听时，第二个实例**同样打印「已启动」且无任何报错**（Windows SO_REUSEADDR 语义下静默双绑），`/ping` 正常。无 pid/锁文件、无「已在运行」检测。
6. **RunLock 陈旧锁**：模拟「获取锁后崩溃（不释放）」，后续两次 acquire 均抛 RuntimeError 永久阻塞，须人工删锁。
7. 审查结束后产物已恢复原始字节（SHA256 = `F3925A73…`，与审查前备份一致），未留审查临时文件。

---

## 二、发现明细（按严重度分组）

### 【严重】

#### A1（严重）构建产物非逐字节可复现：`Built:` 时间戳注入产物
- **文件:行号**：`ecosystem/build-force-play.ps1:146-147, 149, 152`
- **问题描述**：产物头部强制注入「构建时间 + git commit + minify 标志」行，时间戳为秒级 `Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'`（含时区偏移）。同一源码在任意两次（跨秒）构建中产物字节必然不同。
- **代码依据**：
  ```
  146: $builtAt = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
  147: $buildMeta = "// Built: $builtAt  commit: $gitSha  minify: ..."
  149: $headerChunks = @($meta, '', $buildMeta, '', $core)
  ```
  且 `$gitSha`（:141-145）依赖 git 环境，repo 外构建为 `unknown`。
- **实证**：两次构建（间隔 2s）SHA256 不同，diff 仅 `Built:` 行；全量 vs Fast 构建同样仅差该行。产物 `ecosystem/chaoxing-force-play.user.js` 被 git 跟踪 → 每次构建都产生 git diff 噪声。
- **影响**：破坏「同一源码两次构建逐字节相同」这一构建确定性核心指标；跨时区机器、repo 内外产物均不同；CI 产物与本地产物永远不同。
- **修复建议**：时间戳注入改为默认关闭或由显式开关/环境变量（如 `CX_BUILD_META=0`，参考 SOURCE_DATE_EPOCH 思路）控制；构建日志写时间戳不影响产物；如确需保留版本信息，建议用可复现的「版本号 + commit」且允许关掉时间部分。

#### A2（严重）构建必需输入未纳入版本控制 → 全新 checkout 无法构建 / 门禁被静默跳过
- **文件:行号**：`ecosystem/build-manifest.txt`（整体）、`ecosystem/scripts/`（整体）、`ecosystem/src/chaoxing-force-play/sites/quiz-selectors.js`、`.../takeover/foundation/error-guard/guard.js`、`.../takeover/foundation/storage/keys.js`；相关代码 `ecosystem/build-force-play.ps1:90, 95-99, 255-264`
- **问题描述**：构建的「单一事实源」清单与门禁脚本、3 个被清单引用的源文件均未被 git 跟踪。
- **代码依据**（实证）：
  - `git ls-files ecosystem/build-manifest.txt` → 空；`git status --porcelain` 显示 `?? ecosystem/build-manifest.txt`、`?? ecosystem/scripts/`、`?? .../sites/quiz-selectors.js`、`?? .../error-guard/`、`?? .../storage/keys.js`。
  - manifest 共 56 项（与 src 58 个 .js = meta + core + 56 完全一致），第 1/3/28 行正是上述 3 个未跟踪源文件。
  - build-force-play.ps1:90 `if (-not (Test-Path $manifestFile)) { throw "Build manifest missing" }`；:95-99 缺失源文件直接 throw。
- **影响**：CI（`.github/workflows/ci.yml:35` 每次全新 checkout 后直接构建）或任何新克隆将**无法构建**；即便个别文件侥幸存在，:255-264 对缺失门禁脚本是「Test-Path 检查 + 黄字 WARN 跳过」→ 契约/元数据门禁可能被静默跳过（假绿灯）。构建的可复现性在「跨环境」层面断裂（同一工作树内仍成立）。
- **修复建议**：将 build-manifest.txt、ecosystem/scripts/*、以及 3 个未跟踪源文件纳入 git；如属有意不跟踪，需在 CI 中显式生成并在构建脚本把「门禁脚本缺失」从 WARN 升为 ERROR。

#### A9（严重）pure.test.js 确定性失败——测试已随源码漂移（测试幂等保障失效）
- **文件:行号**：`ecosystem/tests/pure.test.js:47-58, 64`；`ecosystem/src/chaoxing-force-play/takeover/foundation/utils/utils.js:182`
- **问题描述**：`npm test`（package.json:9）两次运行均 exit 1：加载 utils.js 时顶层语句 `var LS_NS = CX_KEYS.FP_NS;` 在无 `CX_KEYS` 桩的 vm 沙箱中抛 `ReferenceError`。storage/keys.js 拆分出 `CX_KEYS` 裸全局后，pure.test.js 的 ctx 未补桩。
- **代码依据**：
  ```
  utils.js:182  var LS_NS = CX_KEYS.FP_NS;   // 模块顶层可执行语句，加载即执行
  pure.test.js:60  vm.runInContext(fs.readFileSync(file,'utf8'), ctx, ...)
  ```
- **实证**：连跑 2 次均同样失败（幂等意义上「稳定红」，但套件整体失效）；CI 不运行 pure.test.js（ci.yml 只跑 `npm run test:sim`），故不会被 CI 发现。
- **影响**：纯函数回归门禁长期空转；任何新缺陷都可能在 pure 层被漏检。
- **修复建议**：在 ctx 中补 `CX_KEYS: { FP_NS: 'cx_fp_' }` 桩（或按 keys.js 实际定义注入），并恢复双跑验证为绿。

#### B1（严重）bridge 重复启动：Windows 下「静默双绑」同一端口，无 pid/锁文件、无检测
- **文件:行号**：`perception/cx_crawler/bridge.py:33, 168, 173-178`；`perception/cx_crawler/run_bridge.bat:29`
- **问题描述**：已有一个实例监听 127.0.0.1:7531 时再次 `python bridge.py`，第二个实例**不报错、同样打印「已启动」**——`http.server.HTTPServer.allow_reuse_address = 1`（继承自 HTTPServer）在 Windows 的 SO_REUSEADDR 语义下允许第二个 socket 绑定同一端口，两个进程同时监听，连接被系统分发给谁不确定。类 Unix 上则会抛裸 `OSError: Address already in use` traceback（:168 无 try 包裹）后 exit 1。两种情形都无 pid 文件、无锁、无「已在运行」提示。
- **实证**：两个后台 job 分别启动 bridge，第二个同样输出「[bridge] 只读桥服务已启动: http://127.0.0.1:7531」且进程存活；`/ping` 正常返回。
- **影响**：重复执行产生「双实例并存」的非预期状态；若旧实例持有旧 playlist 数据而新实例已生成新数据，浏览器逐请求拿到新旧不一的数据（状态发散），且无法从任何日志/文件判断存在双实例。服务本身只读、无数据损坏，但「重复启动」这一操作的幂等性不成立。
- **修复建议**：启动前探测端口占用（如 `socket.connect_ex((host,port))`），已占用时打印「服务已在运行」并友好退出（exit 0 或明确报错）；Windows 下可显式 `SO_EXCLUSIVEADDRUSE` 防双绑；或引入 pid 文件 + 存活探测。

---

### 【一般】

#### A3（一般）产物写入非原子、先写后验——中断会留半个文件
- **文件:行号**：`ecosystem/build-force-play.ps1:210-213, 216`（写入在门禁之前）；`:173-174, 185`（minify 临时文件）
- **问题描述**：`[IO.File]::WriteAllText($out, ...)` 直接覆盖写目标；若构建在写入中途被中断（Ctrl+C/断电），产物是半截文件，且后续门禁（node --check 等）在写入之后才跑，不会保护已写出的半截文件。minify 临时文件用 GUID 命名（%TEMP%），成功路径会清理（:185），但进程被杀时残留（不影响后续构建，仅 %TEMP% 堆积）。
- **影响**：中断后「产物即脏」，部署方可能误用半截文件；不累积（下次构建完整覆盖），可重入性本身不受影响。
- **修复建议**：写 `$out.tmp` 后 `[IO.File]::Move(tmp, out, true)` 原子替换；或在 README/输出中强调「仅退出码 0 时产物可信」。

#### A4（一般）`-Minify` 产物跨环境不可复现：esbuild 缺失时静默回退朴素压缩
- **文件:行号**：`ecosystem/build-force-play.ps1:168-189, 194-201`；`ecosystem/package.json:20`（devDependencies 声明 esbuild ^0.25.0）
- **问题描述**：esbuild 可用 → esbuild 压缩域主体；不可用 → 去空行回退（:194-201）。回退仅黄字提示，不阻断。
- **实证**：本机 `ecosystem/node_modules` 无 esbuild（`npm ls esbuild` 空、`require('esbuild')` 失败）→ 本机 `-Minify` 走回退路径；CI 每次 `npm install` 会装上 esbuild → **同一 `-Minify` 命令在不同环境产出不同字节**（语义等价，字节不同）。
- **影响**：生产产物（CI 上传 artifact）与本地产物无法对拍；字节级复现性被环境依赖破坏。
- **修复建议**：esbuild 设为硬依赖（CI `npm ci` 后断言存在），回退时以非零退出或醒目 ERROR 提示；或本地也 `npm install` 保持环境一致。

#### B2（一般）playlist 输出内嵌 `generatedAt` 时间戳 → 重复运行字节不同
- **文件:行号**：`perception/cx_crawler/dump.py:354, 377-386, 391-392`
- **问题描述**：`gen_at = time.strftime("%Y-%m-%d %H:%M:%S")` 写入 `playlist_{cid}.json` 与 `playlist_index.json` 的 `generatedAt` 字段。同一数据重复 dump，文件字节不同（仅该字段）。
- **代码依据**：`:386 atomic_write_json(..., payload)` / `:392 atomic_write_json(..., {"generatedAt": gen_at, ...})`
- **影响**：字节级幂等被破坏；消费方（浏览器 userscript）不依赖该字段则无功能影响。
- **修复建议**：可接受则注明「generatedAt 为运行元数据」；如需字节级可复现，改为日级时间或由数据内容推导（如数据 hash），或移出文件。

#### B3（一般）RunLock 陈旧锁残留：进程被杀后永久阻塞后续运行
- **文件:行号**：`perception/cx_crawler/config.py:292-331`；使用点 `dump.py:116-122`
- **问题描述**：跨进程锁用 O_EXCL 占位文件（config.py:300）。崩溃/强杀（SIGKILL、断电、任务管理器结束）时 atexit（dump.py:122 注册的 `lock.release`）不会执行 → `.runlock` 永久残留 → 后续运行在 `dump.py:118-121` 直接 `logger.error` 返回。锁文件只写 pid（:307）但**从不校验 pid 存活**。
- **实证**：模拟「获取后不释放（崩溃）」，新 RunLock 连续两次 acquire 均抛 `RuntimeError: 已有 cx_crawler 实例在运行...请删除该锁文件`；release 后锁消失。
- **影响**：典型的「状态残留」+ 一次性阻塞，需人工删锁介入；正常 Ctrl+C 退出（KeyboardInterrupt → 正常退出路径 → atexit）不受影响。
- **修复建议**：acquire 时若锁存在，读 pid 并 `os.kill(pid, 0)` 探测存活（Windows 可用 `os.kill` 或 ctypes OpenProcess），进程已死则自动回收；可加 mtime 超时兜底防 pid 复用误判。

#### B4（一般）原子写中断残留 `.tmp` 文件
- **文件:行号**：`perception/cx_crawler/config.py:226-237`
- **问题描述**：`atomic_write_text` 用 `tempfile.mkstemp(dir=d, suffix=".tmp")` 写临时文件后 `os.replace`；若进程在 replace 前被杀，OUTPUT_DIR 残留 `.tmp` 文件（不会累积成重复内容，但留脏状态）。
- **实证**：当前 output/ 目录无残留（最近运行均正常结束），属潜在风险路径。
- **修复建议**：dump 启动时清理 OUTPUT_DIR 内 `*.tmp`（与 A3 同思路）。

---

### 【建议】

#### A8（建议）仓库残留旧构建日志与一次性恢复脚本
- **文件:行号**：`ecosystem/build.log`、`ecosystem/build_r7.log`、`ecosystem/_sim/out_sim-*.log`（15 个）、`ecosystem/_sim_run.log`、`ecosystem/_sim_run_idem.log`（0 字节）；`ecosystem/_recover_manifest.js:8`
- **问题描述**：上述日志为旧运行残留（扫描确认当前 build-force-play.ps1 与 _sim 用例均不写这些文件；`*.log` 已被 .gitignore:21 覆盖）；`_recover_manifest.js` 硬编码绝对路径 `c:/Users/24033_1dhcyji/...`，且会**重写 build-manifest.txt**（按目录遍历+字母序排序，可能与手工维护的依赖执行序不一致），属一次性恢复工具，误运行会改动构建输入。
- **影响**：残留日志与「本次构建输出」混淆；_recover_manifest.js 误跑可静默改变构建顺序（顺序影响产物中极少顶层即时语句的执行次序）。
- **修复建议**：清理残留日志；删除 _recover_manifest.js 或改为相对路径并加「勿常规运行」醒目注释。

#### A10（建议）sim-idempotency.js 场景3「命令重复注册不翻倍」断言落空，可能空转通过
- **文件:行号**：`ecosystem/_sim/sim-idempotency.js:101-123`
- **问题描述**：场景3 的 assert（:123）只检查 `cmdOk`（无异常），**并未统计命令表长度前后对比**；且 `if (window.__cxRegisterCommand)`（:116）分支在符号不存在时整段跳过、`cmdOk` 恒为 true → 即使注册逻辑不幂等也判 PASS；:111 `__cxCommandsProbe` 为死代码（算而不用）。测试名声称「不翻倍」但实际未验证翻倍。
- **代码依据**：`:111 const cmdCount1 = (... __cxCommandsProbe) || null;` 之后从未使用。
- **覆盖核实（本用例真实断言了什么）**：
  - 场景1「重复注入不产生双倍 setInterval」：真实断言 ✓（:59 setInterval 计数对比；:57/:61 无异常）
  - 场景2「重复 id addon 仅渲染 1 次 / 多次渲染不翻倍」：真实断言 ✓（:89/:99 label 计数）
  - 场景3「命令同名重复注册不翻倍」：仅断言无异常 ✗（不翻倍未验证；符号缺失时空转）
  - 场景4「全局无运行时错误」：✓（:126）
- **修复建议**：暴露命令表长度（或 `help` 输出行数）做前后对比；符号不存在时判 FAIL（防空转）。

#### A11（建议）uninstall 幂等覆盖缺口（重复卸载/重注入循环未覆盖）
- **文件:行号**：`ecosystem/_sim/sim-uninstall-instance.js:74-96`、`ecosystem/_sim/sim-lifecycle.js:42-50`
- **问题描述**：sim-uninstall-instance 只测「注入一次 → 卸载一次 → 实例 own 属性还原 + 行为级证明」，未测「二次 uninstall」（sim-addon-cleanup.js NEW-5-9 已覆盖二次卸载不抛异常 ✓）、「uninstall → 重注入 → 再卸载」循环、卸载后 document/window 级监听残留（sim-addon-cleanup NEW-5-5~7 已覆盖 keydown/ended/storage ✓）。sim-lifecycle 只断言命名空间/全局符号删除，不验 DOM 监听与原型还原（其头部注释自述局限）。
- **修复建议**：补「uninstall → re-inject → uninstall」与「pagehide 后重注入」用例；sim-lifecycle 增加监听计数快照对比。

---

### 【正向-良好实践】

#### A5（正向）构建不修改任何源文件（无副作用）
- **实证**：三次构建前后，src 树 58 个 .js 文件 SHA256 全部未变（changed=0）。构建仅读源、写产物与 stdout。
- **文件:行号**：`ecosystem/build-force-play.ps1:116-117, 151`（只读 `ReadAllText`）

#### A6（正向）manifest/门禁脚本全部只读，写模式不进入构建链
- verify_contracts.js / verify_metadata.js / verify_contract_semantics.js（仅经 `CX_CONTRACT_SRC` 指向副本）全只读；verify_contract_doc.js 与 verify_cross_module.js 的写模式（`--emit` / `--seed` / `--emit-doc`）由人显式触发，构建只传默认参数（build-force-play.ps1:255-264、:299-303 的 `--selftest`）；selftest_metadata.js / selftest_contract_semantics.js / verify_cross_module.js `--selftest` 均在 `os.tmpdir()` 副本上变异并事后删除（selftest_contract_semantics.js:137,172；selftest_metadata.js:30,76；verify_cross_module.js:570,618），运行中断仅留唯一命名临时目录，不影响后续构建。

#### A7（正向）并行门禁无共享写、可安全重入；全量构建复跑全绿
- Start-Job 并行门禁（node --check / eslint / 契约 / 元数据 / xmc）全部只读、无缓存文件（eslint 未带 --cache）；`Set-Location $root` 仅影响子进程 cwd。实证：连续 3 次 -Fast 构建后全量构建（45 sim + eslint）exit 0 全绿灯，产物与 Fast 仅差 Built 行。

#### A12（正向）_sim 测试无文件写、无共享状态、输出稳定；7 个幂等相关用例全部 PASS
- 扫描确认 _sim 全部用例无 `writeFileSync/appendFileSync` 等写操作（只读产物、内存断言）；sim-idempotency / sim-addon-cleanup 连跑 2 次输出逐字节一致；sim-idempotency 10/10、sim-uninstall-instance 15/15、sim-addon-cleanup 12/12、sim-ensurepanel-guards 12/12、sim-lifecycle PASS、sim-panel-owner 15/15、sim-loop-unlock 10/10。
- 小提醒：sim-lifecycle.js:10-14 在 jsdom 缺失时以 exit 0「SKIP」空转通过（幂等但假绿灯风险，建议 CI 保证 jsdom 必装）。

#### B5（正向）dump 输出为固定文件名覆盖写，不追加、不产生时间戳多文件
- 所有输出（01_courses_*、02_chapter_list_{cid}.html、03_tasks_{cid}.json、04_quiz_{jobid}_raw.json、playlist_{cid}.json、playlist_index.json、README.md）均为确定名 + 原子写（config.atomic_write_text/json），重复运行覆盖同名文件，不追加、不累积。`_load_done_tasks` 断点复用（dump.py:48-80, 178-194）是显式幂等设计——仅信任带 `__status__=complete` 标记且 tasks 非空的快照，旧格式/无标记自动重新抓取，不会因中断残留而静默漏抓。
- **文件:行号**：`config.py:220-242, 251-263`；`dump.py:48-80, 335-392`；`chapters.py:251, 301`

#### B6（正向）session.cookies 持久化为合并覆盖，重复登录不产生重复条目
- save_cookies（session.py:156-218）按 name 合并更新值、仅追加真正新增的 cookie（list/dict/str 三格式均保留原格式），`updated` 门控无变化不写盘（:213-218），原子写 + Windows icacls 收紧权限（:178, 215）。重复登录/重复运行不会导致 cookies.json 重复累积。
- 小注意：list 格式下新 cookie 追加顺序取决于 requests CookieJar 迭代序（服务端返回序），理论跨运行字节序可能不同，语义一致。

#### B7（正向）爬虫/桥无后台线程、进程、锁文件残留（正常退出路径）
- api_client / chapters / courses / quizzes / heartbeat 全部同步请求 + 原子写，无 daemon 线程；render.py 的 playwright 页面与 browser 在 finally 关闭（render.py:64, 103-107）；bridge 的 ThreadingHTTPServer 为 daemon 线程，KeyboardInterrupt 时 `httpd.server_close()`（bridge.py:173-178）正常清理；RunLock 在 atexit 释放（dump.py:122）。实证 output/ 目录当前无 `.runlock`/`.tmp` 残留。

#### B8（正向）Python 测试幂等稳定，全部隔离在临时目录
- test_crawler_units.py（163 行）+ test_modules_units.py（249 行）共 33 个用例连跑 2 次均 OK（exit 0），全部使用 `tempfile.TemporaryDirectory` 隔离、不写共享文件、不依赖网络；config 模块导入仅产生进程级 TRACE_ID（uuid，仅进日志，不进文件）。
- 小瑕疵：test_modules_units.py:205-211 TestThrottle 修改全局 `config.MIN_INTERVAL` 后手动还原，若断言中途失败则还原被跳过（建议 try/finally）。

#### B9（正向）bridge 只读、无状态写、无累积
- bridge 仅 GET + 读 output/playlist_*.json（白名单路由 + 文件名正则 + 路径穿越双保险 + 可选 token 鉴权），无任何写路径、无锁/pid 文件、无状态累积；重复请求幂等（同一文件返回同一 JSON）。

---

## 三、修复优先级建议

1. **P0（先做）**：A1 关闭产物时间戳注入（或改为可关闭）；A2 将 build-manifest.txt / scripts/ / 3 个未跟踪源文件纳入 git，门禁脚本缺失从 WARN 升 ERROR；A9 补 `CX_KEYS` 桩让 `npm test` 转绿。
2. **P1**：B1 bridge 端口占用检测 + Windows 防双绑；B3 RunLock 陈旧锁自动回收。
3. **P2**：A3 原子写产物；A4 固定 minify 依赖；B2/B4 元数据时间戳与 .tmp 清理。
4. **P3**：A10/A11 补强测试断言；A8 清理残留。

---

## 附：验证操作记录（可复现）

| # | 操作 | 结果 |
|---|---|---|
| 1 | `powershell -File build-force-play.ps1 -Fast` ×2（间隔 2s）→ Get-FileHash | 两次 SHA256 不同；diff 仅 `// Built:` 行 |
| 2 | 构建前后 src 58 文件 hash 对比 | 0 个变化 |
| 3 | 全量构建（无 -Fast，含 eslint + 45 sim） | exit 0 全绿灯；产物与 Fast 仅差 Built 行 |
| 4 | `node tests/pure.test.js` ×2 | 两次均 exit 1（CX_KEYS 未定义） |
| 5 | `node tests/quiz-merge.test.js` | exit 0（25/25） |
| 6 | 7 个 sim 用例 + 2 次重复运行对比 | 全 PASS；输出逐字节一致 |
| 7 | `python -m unittest discover -s perception/cx_crawler/tests` ×2 | 33/33 OK，exit 0 |
| 8 | bridge.py 双实例启动 + /ping | 第二实例静默双绑成功，无报错 |
| 9 | RunLock 崩溃模拟（不释放→再次 acquire ×2） | 均 RuntimeError 阻塞；release 后恢复 |
| 10 | 审查后恢复产物 + 清理临时文件 | 产物 SHA256 与审查前备份一致（F3925A73…） |
