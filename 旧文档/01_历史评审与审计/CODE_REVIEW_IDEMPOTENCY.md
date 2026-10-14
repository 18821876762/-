# 幂等性专项审查报告 · 网课强制续播（chaoxing-force-play）

- 审查日期：2026-08-17
- 审查范围：`ecosystem/src/chaoxing-force-play/**`（58 源模块 + 构建产物）+ 构建链（`build-force-play.ps1` / `scripts/` / `tests/` / `_sim/`）+ 感知层（`perception/cx_crawler/**`）
- 审查方式：核心模块本人精读（core/main-loop/dom/lifecycle/session/dedup/storage/state/panel-core/registry/config/quiz/vision-deepseek/bridge 等）+ 3 个并行子代理逐文件深审（分别产出 `_idempotency_audit/engine-foundation.md`、`presentation-plugins.md`、`build-perception.md`）+ **实证验证**（双窗口跨帧探针、两次构建 SHA256 对比、bridge 双实例启动、RunLock 崩溃模拟、53+1 仿真回归、纯函数单测、Python 单测）。
- 幂等性定义口径：**同一操作重复执行（重复注入/重复渲染/重复调用/重复构建/重复启动）应产生相同结果、不累积副作用、不留下脏状态**。

---

## 总体结论

**未发现致命级幂等性缺陷**。脚本的幂等骨架非常扎实：`core.js` 的 `window.__CX_FORCE_PLAY.started` 全局守卫（同帧重复注入整体跳过，`core.js:14`）、TimerRegistry 集中定时器登记（`core.js:21-47`）、`cleanupListeners` 的 `_cleaned` 幂等锁（`lifecycle.js:59`）、ensurePanel 三重防重复创建（`panel-core.js:39/49-50/36-38`）、6 个 addon 的 `__cxXxxStarted` 守卫、以及各指纹/队列的全量上限淘汰——这些构成了「重复执行不翻倍」的底线。

**发现 6 个严重、15 个一般、若干建议级问题**，集中在三类：
1. **卸载后在途副作用**（在途答题/DeepSeek 问答的裸定时器在 uninstall 后仍会真实点选/提交；visibilitychange 匿名监听卸载后会复活主循环定时器；GM 值变更监听无卸载入口）；
2. **跨帧单例锁名不副实**（DS 角色锁挂在各帧本地命名空间，多帧页面每帧一份 4s 心跳 + 通道监听，注释宣称的「window.top 共享标志」未实现）；
3. **构建/爬虫重复执行不可复现**（产物内嵌时间戳、构建必需输入未纳入 git、pure.test 确定性红、bridge 重复启动静默双绑、RunLock 陈旧锁永久阻塞）。

**本次已修复 19 处缺陷并全部验证**（构建门禁全绿 / sim 54/54 / pure.test 52/52 / 两次构建逐字节相同 / Python 33/33），详见「二、已修复清单」。其余为核验后「设计内/低风险不改」或「建议级」，见「四、未修复项」。

---

## 一、严重（6 条，全部已修复）

### S-1　卸载后在途答题/DeepSeek 问答的裸定时器不受 TimerRegistry 管辖，uninstall 后仍会触发真实作答副作用 ✅ 已修复
- **位置**：`takeover/engine/quiz.js:509-513`（`_quizVisionAnswer` 的 45s 超时 race）、`quiz.js:299`（MO 防抖 800ms）、`takeover/engine/vision-deepseek-web.js:575-577`（`_dsAskOnce` 60s 超时）、`vision-deepseek-web.js:601`（重试延迟 2500ms）
- **原因**：`cleanupListeners` 只清理 TimerRegistry 登记项；上述四处为裸 `setTimeout`，卸载后照常 settle——`.then/.catch` 会执行 `_quizClick`+`_quizSubmit`（对页面真实点选随机选项并提交）；MO 防抖在 `quizDisconnect` 后仍触发一次 `quizTick`。
- **修复（已落地）**：
  - `_quizVisionAnswer` 的 `.then/.catch` 回调首行加卸载守卫（`window.__CX_FORCE_PLAY` 已删即 return，不点选/不提交）；
  - `_quizMOHandle` 的 800ms 防抖句柄保存到 `_quizMOTimer`，`quizDisconnect` 时 clearTimeout（`quiz.js:296-315`）；
  - `_dsAskOnce` 超时与重试延迟改经 `_dsRegTimer` 登记（owner `'deepseek'`，`quizVisionDeepSeekStop` 可取消在途）；`_dsAskOnce` executor 与重试链 `run()` 首行加卸载守卫（卸载后悬挂、不再重发 ds-ask）；
  - `_emitChannel` 首行加卸载守卫（卸载后不再派发通道消息，阻断 responder/徽标残留重建）。

### S-2　vision-deepseek-web 跨帧单例锁名不副实：`_dsTopDoc` 为死变量，锁挂各帧本地命名空间，每个匹配 iframe 各起 4s 心跳与空转监听 ✅ 已修复
- **位置**：`takeover/engine/vision-deepseek-web.js:615-630`（自初始化）、`:153-169`（`_dsInitCourseSide`）、`:164-166`（4s 心跳）
- **原因**：注释声称「用 window.top 共享标志确保全页只初始化一份」，但 `_dsNs()` 返回**本帧**命名空间，`_dsTopDoc` 计算后从未使用；顶层置位对 iframe 不可见。**实证**（双窗口 jsdom 探针）：修复前 child 帧有 2 个 setInterval（tamper-guard 2s + DS 4s 心跳）、`dsRoleInited=true`。
- **修复（已落地）**：
  - 锁读写改走 `_dsLockNs()`：同源顶层命名空间已存在（顶层 bundle 已跑）则挂 `window.top.__CX_FORCE_PLAY`，否则回退本帧（跨域不可达场景与原设计一致）；
  - `_dsInitCourseSide` 首行加 `_dsNeedChannel` 门控（无跨页通道的帧不再启动心跳/监听）；
  - 删除死变量 `_dsTopDoc`。
- **实证（修复后）**：child 帧 setInterval 2→1（仅剩设计内每帧独立的 tamper-guard）、`dsRoleInited=false`、跨帧锁生效。探针已转正为回归用例 **`_sim/sim-ds-role-lock.js`**（新增，防回归）。

### A1（构建·严重）产物内嵌 `Built:` 时间戳 → 同一源码两次构建产物字节不同 ✅ 已修复
- **位置**：`ecosystem/build-force-play.ps1:146-149`
- **实证**：修复前间隔 2s 两次构建 SHA256 不同，diff 仅 `// Built:` 行（含时区偏移）。
- **修复（已落地）**：默认产物仅含**确定性元数据**（commit sha + minify 标志——同一 commit 两次构建逐字节相同）；确需审计构建时间时显式设 `$env:CX_BUILD_META=1` 注入时间戳。**实证**：修复后两次构建 SHA256 完全一致（`3C9F3CDA…`）。

### A2（构建·严重）构建必需输入未纳入版本控制 → 全新 checkout 无法构建 ✅ 已处理（git add 暂存）
- **位置**：`ecosystem/build-manifest.txt`、`ecosystem/scripts/`（11 个门禁脚本）、`sites/quiz-selectors.js`、`error-guard/guard.js`、`storage/keys.js`
- **实证**：`git ls-files` 全空、`git status` 显示 `??`；`build-force-play.ps1:90/95-99` 对这些缺失直接 throw → CI 全新 checkout 必失败。
- **处理（已落地）**：上述 16 个构建必需输入已 `git add` 暂存（含本次重新生成的 `docs/CROSS_MODULE_CONTRACT.md`），待提交后即可复现构建。

### A9（测试·严重）pure.test.js 确定性红（CX_KEYS 未定义）——纯函数门禁长期失效 ✅ 已修复
- **位置**：`ecosystem/tests/pure.test.js:47-58`；`utils.js:182`（`var LS_NS = CX_KEYS.FP_NS;` 顶层语句）
- **实证**：`node tests/pure.test.js` 两次均 exit 1（ReferenceError）；CI 不跑它故未被发现。
- **修复（已落地）**：`load()` 把 `keys.js` 源码预拼到目标模块前执行（CX_KEYS 桩与源码永远同步）。**实证**：`node tests/pure.test.js` → **ALL PASS（52 断言）**。

### B1（爬虫·严重）bridge 重复启动在 Windows 上静默双绑同一端口 ✅ 已修复
- **位置**：`perception/cx_crawler/bridge.py:168-178`（main）
- **实证**：已有实例监听 7531 时再启 `python bridge.py`，第二实例同样打印「已启动」无任何报错（HTTPServer.allow_reuse_address 在 Windows SO_REUSEADDR 语义下允许双绑），连接分发不确定。
- **修复（已落地）**：`main()` 启动前 `_port_in_use()`（socket.connect_ex）预检，端口已占用即打印明确提示并 `sys.exit(1)`。**实证**：第二实例正确报「端口已被占用——疑似已有桥实例在运行」并退出。

---

## 二、一般（15 条：已修复 12 条，核验不改 3 条）

### 已修复（12 条）

| 编号 | 位置 | 问题 | 修复 |
|---|---|---|---|
| G-7 | `bootstrap/main-loop.js:116` | visibilitychange 为匿名监听，未列入 cleanup——手动 uninstall 后每次切前后台都会经 `restartLoopTimer` **复活主循环定时器**（clearAll 之后又 setInterval） | 具名 `visThrottleHandler` + `lifecycle.js` cleanup 移除（`cleanup.visThrottle`） |
| G-1 | `vision-deepseek-web.js:79` | `GM_addValueChangeListener` 返回值被丢弃、全树无 remove 调用——GM 监听是脚本级长驻资源，热禁用/手动卸载后仍持续响应跨标签变更 | 保存 `_dsGmListenerId`，`quizVisionDeepSeekStop` 中 `GM_removeValueChangeListener` 移除；`meta.js` 补 `@grant GM_removeValueChangeListener` |
| G-2 | `main-loop.js:76` + `config.js:107-130` | 主循环每 2s 无条件用新闭包重装 `prototype.pause`（顶掉第三方 patch + GC 抖动），且与 `probePauseNeutralized` 探测结果不联动 | 改为仅当探测到被还原（probe===false）才重装；温和模式语义零回归 |
| G-3 | `quiz.js:60/679-683` | `_quizAIPending` 仅超时路径删除，消失题（翻页/提交后不再被扫到）条目永久残留、单调增长——同文件其余队列均有 A2/A3/A4 护栏，唯独此 map 缺失 | 新增 `_quizPruneAIPending()`（TTL = QUIZ_AI_WAIT×2 + 上限 1000），与 `_quizPruneAIFailed` 同轮调用 |
| G-4 | `state.js:62-73` | 顶层帧 `message` 透传监听为匿名函数且未列入 cleanup 清单 | 具名 `_topFeedMessageHandler`（模块级，IIFE 外声明）+ lifecycle cleanup 移除（`cleanup.topFeed`） |
| G-5 | `bridge.js:171-200` | `bridgeFetch` 无请求级去重：`bridgeInit` 每调用一次（含 top+iframe 并发）都重复拉 `/playlist` + 重复 `restoreNativePause` 全树遍历 | 加 `_bridgeFetchInFlight` 在途去重（同步 return 分支与链尾统一复位） |
| G-6 | `lifecycle.js:76-83` + `targeting.js:54-71` | attachments 还原用注入前旧快照：会话期间平台重定义该属性后，cleanup 会 delete 平台新属性并写回过期快照 | `targeting.js` 保存安装的 getter 引用（`_attachGetter`）；cleanup 先比对 `_cur.get === _attachGetter`，非本脚本属性则原样交还不触碰 |
| G1-feed | `panel-toast-feed.js:47-61` | `_onToastForFeed` 既入缓冲又实时 append，面板重建（R11 自愈）时 `_flushToastFeed` 无条件重放全部缓冲 → 提示流重复条目 | 缓冲条目标记 `rendered`（容器存在即视为已实时渲染），flush 只回放未渲染项 |
| G2-notify | `video-ended-notify.js:163-168` | 唯一未注册 `__cxAddonCleanups` 的 addon：匿名 ended/play capture 监听在 uninstall 后残留、闭包持有 ns/TK，通知/静音副作用仍可触发 | 具名监听 + `window.__cxAddonCleanups.push` 成对 removeEventListener（与其余 5 个 addon 对齐） |
| G3-ticker | `panel-ds-console.js:31-33` | ticker 闭包捕获首次 `el`，面板重建后新面板不再 2s 自动刷新（陈旧） | ticker 回调内 `_dsFindPanelNode()` 现查节点再 `_dsUpdateConsole` |
| A3（构建） | `build-force-play.ps1:216-222` | 产物直接覆盖写，构建中断（Ctrl+C/断电）留下半截文件；门禁在写入之后跑保护不了已写出的半截产物 | 先写 `$out.tmp` 再 `[IO.File]::Move(tmp, out, $true)` 原子替换（旧 .NET 回退删旧+改名） |
| B3（爬虫） | `config.py:292-331` | RunLock 陈旧锁：崩溃/强杀时 atexit 不执行，`.runlock` 永久残留、后续运行永久阻塞（只写 pid 从不校验存活） | acquire 遇锁先读 pid 探测存活：`_pid_alive()` 跨平台实现（**Windows 禁用 os.kill(pid,0)**——它会真终止进程，改用 ctypes OpenProcess + GetExitCodeProcess(STILL_ACTIVE)），进程已死自动回收重试一次；存活/无法判定保守报错。**实证**：写死 pid 的锁被自动回收 |

### 核验为设计内/低风险不改（3 条）

- **G-2'（原型每 2s 重装的其他影响面）**：已在 G-2 修复（probe 联动）；`installPrototypePauseNeutralize` 内部保留无条件赋值语义（被还原即抢回），属抗平台还原的设计意图。
- **B2（`dump.py` 的 `generatedAt` 时间戳）**：数据元数据字段，消费方（浏览器脚本）不依赖；如需字节级可复现可在 dump 侧加开关——不改（保持运行元数据可读性）。
- **B4（原子写中断残留 `.tmp`）**：仅进程被强杀于 replace 前的极小窗口存在，下次运行覆盖同名文件不累积——不改。

---

## 三、建议级（未修，随迭代关注）

- **A-2** `quiz-vision.js` 全部 CDN 失败无会话内记忆：N 题 = N×7 次脚本注入重试。建议加「已全失败」会话标志 + 失败冷却。
- **S4/S5** `auto-next.js` 守卫前置站点隔离 vs `keyboard-shortcuts.js` 守卫后置——跨文件守卫位置不一致（维护性约定）；当前单次注入语义下无重复风险。
- **S1（panel-controls）** 20+ 控件绑定无一次性标记（仅 `_zhBtn` 有守卫）——当前调用链安全（ensurePanel 每次绑定全新节点），建议函数入口加 el 级守卫固化契约。
- **S2/S3（panel-core）** `reclampSoon` 定时器与 `showFabMenu` 文档级 close 监听无句柄管理——一次性/自愈，影响可忽略。
- **A-5** `loadPanelCfg/loadWatchStats` 为模块加载期调用——当前 `started` 守卫下无热重载路径，仅提示保持。
- **A8** 仓库残留旧构建日志（build.log/build_r7.log/_sim_run.log 等）与一次性恢复脚本 `_recover_manifest.js`（硬编码绝对路径、可重写 build-manifest.txt）——建议清理/加「勿常规运行」注释。
- **A11** `sim-uninstall-instance.js` 未覆盖「uninstall → 重注入 → 再卸载」循环与卸载后 DOM 监听残留快照对比——建议补用例。

---

## 四、正向-良好实践（核实通过，幂等骨架）

1. **全脚本注入守卫**（`core.js:13-15`）：`started` 置位即整体 return，同帧重复注入零副作用翻倍；`globalErrorHandler` 置于守卫后注册（防重装叠加 error 监听）。
2. **TimerRegistry 集中登记**（`core.js:21-47`）+ cleanup 统一 `clearAll()`（`lifecycle.js:67`）：主循环/DS 心跳/篡改检测/DS 控制台全部可追溯清理。
3. **cleanup 幂等锁**（`lifecycle.js:59`）+ `{once:true}` 双钩子 + 自摘除：pagehide/beforeunload 双触发只还原一次。
4. **ensurePanel 三重守卫**（`panel-core.js`）：`_cxPanel` 缓存 + `getElementById` 复用 + R11 脱离自愈；三个 style 均 getElementById 守卫；`_feedSubscribed`/`_switchSubscribed`/`_panelOutsideClickBound` 模块级一次性标记。
5. **6 个 addon 守卫全覆盖 setTimeout bootstrap 路径**；`registerCommand` 同名覆盖不累积；registry 按 id 去重；toast 单例 + clearTimeout 替换；tamper-guard clear-then-set。
6. **quizObserve 先 disconnect 再重建**（`quiz.js:301-311`）、`quizDisconnect` 幂等；`safePlay` 单例 playing 监听守卫（`playback.js`）；`_ovEnforce` 每视频监听仅装一次（`cxState(v).init`）；`neutralizeGlobalPause` no-op 引用比对 + 去重清单。
7. **EventBus 完整退订 API + cleanup `clearSubs`**；`registerSiteTick` 覆盖式注册不累积。
8. **模块状态全部有界**：`_bxBuffer` 200 / `_errBuf` 50 / `_moQueue` 1024 / `ENDED_SRCS` 2000 / `_pqHandled` 2000 / `_quizHandled` 4000 / `_quizReviewItems` 500 / `_quizPendingSubmit` TTL+1000 / `_quizAIFailed` 200（本轮起 `_quizAIPending` 亦 TTL+1000）。
9. **构建无源副作用**（三次构建前后 src 58 文件 hash 零变化）、门禁全只读、并行门禁无共享写可安全重入。
10. **dump 固定文件名覆盖写不追加**、session.cookies 合并覆盖不重复、bridge 只读无状态、Python 测试隔离在临时目录（33 用例双跑稳定）。

---

## 五、验证证据（全部实测）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | Fast 构建门禁（node --check / contract verify+doc+semantics / metadata / cross-module + 3 个 selftest） | 全绿 PASSED |
| 2 | `_sim` 全量回归（53 + 新增 sim-ds-role-lock） | **54/54 passed, 0 failed** |
| 3 | `node tests/pure.test.js` | **ALL PASS（52 断言）**（A9 修复后转绿） |
| 4 | 构建确定性：同一源码间隔 2s 两次构建 | **SHA256 逐字节相同**（A1 修复后） |
| 5 | DS 跨帧锁双窗口探针：child 帧 DS 定时器 / dsRoleInited | 修复前 2 个+true → 修复后 1 个（tamper-guard）+false（S-2 修复生效） |
| 6 | sim-idempotency 场景3 补强：同名命令注册 3 次命令表长度 | 24→25（首次 +1、后两次覆盖不增长），12/12 PASS（A10 补强） |
| 7 | Python 单测（test_crawler_units + test_modules_units） | **33/33 OK** |
| 8 | RunLock 陈旧锁（写死已死 pid）自动回收 | OK（B3 修复生效） |
| 9 | bridge 双启动检测 | 第二实例正确报「端口已被占用」并退出（B1 修复生效） |
| 10 | 构建必需输入 git 暂存（A2） | 16 个文件已 `git add` |

---

## 六、备注

- **编码说明**：仓库被 git 跟踪的文件历史为 UTF-16 LE；Node 门禁脚本按 UTF-8 读取源文件、Windows PowerShell 5.1 按 BOM 判定 .ps1 编码。本轮改动的源文件统一为 **UTF-8 无 BOM**、`build-force-play.ps1` 为 **UTF-8 带 BOM**（与 `check-module-size.ps1` 一致），保证 Node 门禁与 PS 5.1 双解析正确（期间曾因编码混用触发 PS 5.1 中文乱码解析失败，已定位并修正）。
- 详细子报告：`_idempotency_audit/engine-foundation.md`（2 严重/6 一般/5 建议）、`_idempotency_audit/presentation-plugins.md`（3 一般/5 建议）、`_idempotency_audit/build-perception.md`（4 严重/5 一般/3 建议）。
- 产物 `ecosystem/chaoxing-force-play.user.js` 已按修复后源码重建。
