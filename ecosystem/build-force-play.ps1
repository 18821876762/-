<#
  .SYNOPSIS
  Zero-dependency build: assemble ecosystem/src/chaoxing-force-play/ back into the
  single ecosystem/chaoxing-force-play.user.js (still one installable file, no runtime deps).

  Concatenation order: takeover/meta.js + takeover/bootstrap/core.js + 各能力域模块 domain files + `})();`
  All modules share one IIFE closure (opened in takeover/bootstrap/core.js as `(function () {`);
  function declarations hoist, so split/join behavior is identical to the original single file.

  能力域结构（接管/takeover · 站点/sites · 插件/plugins · 呈现/presentation），文件按依赖/执行顺序显式列出（no fragile globs）：
    ■ takeover 接管域：
      - meta.js（全局入口/元信息）
      - foundation/{utils,state,meta-config,storage,site}（基础层）
      - engine/{policy,bridge,targeting,dedup,playback,stats,foreground,quiz,quiz-vision,vision-deepseek-web}（通用接管原语·站点无关）
      - dom/{dom,lifecycle,session}（接管引擎 + 视频枚举 + 用户暂停闸门/意图）
      - bootstrap/{core,main-loop}（自启动 + 主循环）
    ■ sites 站点域：{zhihuishu,zhihuishu-exam,icourse163,xuetangx,icve,renwei,unipus,ucampus,ilabx,popup-quiz}（各平台专属逻辑，含共享骨架 popup-quiz）
    ■ plugins 插件域：addons/{auto-next,zhihuishu-auto-next,keyboard-shortcuts,tamper-guard,video-ended-notify}（工具库项实现）+ registry.js（注册中心）
    ■ presentation 呈现域：{styles,toast,panel,panel-template,panel-core,panel-ds-console,panel-controls,panel-drag,diagnostics,dashboard,commands,zhihuishu-fab}

  .PARAMETER SrcDir
    源目录（含 meta.js / bootstrap / 各能力域模块）。默认 ./src/chaoxing-force-play。CI 或本地可用备用路径。

  .PARAMETER OutFile
    输出产物路径。默认 ./chaoxing-force-play.user.js。

  .PARAMETER Minify
    可选紧凑产物：删除所有空行（保留 // 注释，避免误伤 https:// 等）。生产级 minify 仍需 terser。

  .PARAMETER DryRun
    只打印将写入的字符数，不落盘。

  .EXAMPLE
  powershell -ExecutionPolicy Bypass -File build-force-play.ps1
  powershell -ExecutionPolicy Bypass -File build-force-play.ps1 -Minify -OutFile .\dist\chaoxing-force-play.min.user.js
#>
[CmdletBinding()]
param(
  [string]$srcDir,
  [string]$outFile,
  [switch]$minify,
  [switch]$dryRun
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $srcDir)  { $srcDir  = Join-Path $root 'src\chaoxing-force-play' }
if (-not $outFile) { $outFile = Join-Path $root 'chaoxing-force-play.user.js' }
$out = $outFile

# 入口 + 域模块缺失文件聚合检查：一次性列出全部缺失，避免逐个 throw 反复重试
$missing = @()
if (-not (Test-Path (Join-Path $srcDir 'takeover\meta.js')))            { $missing += 'takeover/meta.js' }
if (-not (Test-Path (Join-Path $srcDir 'takeover\bootstrap\core.js')))  { $missing += 'takeover/bootstrap/core.js' }

# 各能力域模块：按依赖/执行顺序显式列出（同处一个 IIFE 闭包，函数声明 hoist，顺序仅影响极少顶层即时语句）
# 能力域：接管(takeover: foundation/engine/dom/bootstrap) → 站点(sites) → 插件(plugins) → 呈现(presentation)
$domainRel = @(
  'takeover/foundation/utils/utils.js',          # ⑦ 基础·工具库：dbg / swallow / cxState
  'takeover/foundation/utils/url.js',            # ⑦ 基础·URL 解析：topHref / urlParam（被 engine/targeting、engine/bridge 复用）
  'takeover/foundation/state/state.js',          # 基础·状态集中层（P1）：Store 单例 + get/set/on/emit
  'takeover/foundation/state/metrics.js',        # 基础·可观测性：_moHistory/_safePlay*/_targetHit* + 黑匣子 _bxBuffer/_bxLog
  'takeover/foundation/meta-config/config.js',   # ① 元信息/配置：CONFIG / DEBUG / 原型 neutralize / 倍速循环（STYLES 已迁至 presentation/styles.js）
  'presentation/styles.js',                      # 呈现·样式令牌：STYLES（面板/移动/Ninja/动效/按钮）+ window.__cxUI（在 presentation/dom 读取前定义）
  'takeover/foundation/storage/storage.js',      # ⑧ 基础·存储：面板配置持久化 savePanelCfg/loadPanelCfg/clampCfg
  'takeover/foundation/site/site-router.js',     # ③ 基础·站点适配 / 页面路由（含智慧树网骨架）
  'takeover/engine/policy.js',                   # 接管·策略开关：forcePlayEnabled（页面级 opt-out）/ cxVideoOptOut（元素级 opt-out）
  'takeover/engine/bridge.js',                   # 接管·本地桥客户端：BRIDGE / resolveBridgeBase / probeBridgeBase / bridgeFetch / bridgeInit / restoreNativePause
  'takeover/engine/targeting.js',                # 接管·定向：白名单 / 附件钩子 / refreshTargets / videoBelongsToTask（桥与 URL 解析已迁出）
  'takeover/engine/dedup.js',                    # 接管·去重：重播加固 ENDED_SRCS / signatureOf / isRebuildFinished
  'takeover/engine/playback.js',                 # 接管·播放原语：pauseNoop / safePlay / releaseVideo / nearEnd
  'takeover/engine/stats.js',                    # 接管·看播统计：_watchStats / loadWatchStats / recordWatchMs
  'takeover/engine/foreground.js',               # 接管·前台判定：foregroundVideo / escapeHTML / shortSrc
  'sites/popup-quiz.js',                         # 站点·共享骨架：弹窗题目随机作答（随机选→答题→删），MOOC 类复用（能力域归站点域）
  'sites/zhihuishu.js',                          # 站点·智慧树：上课弹窗题目自动处理（复用 popup-quiz），仅 zhihuishu 激活
  'sites/zhihuishu-exam.js',                     # 站点·智慧树：作业/练习答题主体页自动勾选（只勾选不提交），仅 zhihuishu + dohomework 类 URL 激活
  'plugins/addons/auto-next.js',                 # 插件·工具库项：章节读完自动下一课(超星专属；UI 适配在 plugins/registry.js)
  'plugins/addons/zhihuishu-auto-next.js',       # 插件·工具库项：智慧树视频结束同页自动续播(站点隔离 + __cxAddonQueue；UI 适配在 plugins/registry.js)
  'plugins/addons/keyboard-shortcuts.js',        # 插件·工具库项：快捷键增强 Space/M(超星专属；UI 适配在 plugins/registry.js)
    'plugins/addons/tamper-guard.js',              # 插件·工具库项：原型篡改报警 ananas 接管检测(超星专属；UI 适配在 plugins/registry.js)
    'plugins/addons/video-ended-notify.js',        # 插件·工具库项：视频结束系统通知(超星专属：复用核心 bridge 多端联动；UI 适配在 plugins/registry.js)
    'plugins/addons/quiet-popups.js',              # 插件·工具库项：关闭脚本弹窗(静默模式)总开关(站点无关；UI 适配在 plugins/registry.js)
  'sites/icourse163.js',                         # 站点·中国大学MOOC：弹窗随机作答，仅 icourse163 激活
  'sites/xuetangx.js',                           # 站点·学堂在线：弹窗随机作答，仅 xuetangx 激活
  'sites/icve.js',                               # 站点·智慧职教：弹窗随机作答，仅 icve 激活
  'takeover/engine/quiz.js',                     # 接管·站点无关：真答题引擎（抓题+答案源 random/bank/ai 可插拔），答题平台复用
  'takeover/engine/quiz-vision.js',              # 接管·站点无关：抗题目文本混淆·图片化识别层，quiz 引擎在 QUIZ_VISION_ENABLED 时调用
  'takeover/engine/vision-deepseek-web.js',      # 接管·站点无关：DeepSeek 网页版视觉后端，QUIZ_VISION_OCR='deepseek-web' 时由 quiz-vision 调用
  'sites/renwei.js',                             # 站点·人卫慕课：真答题(quiz)，仅 renwei 激活
  'sites/unipus.js',                             # 站点·Unipus：真答题(quiz)，仅 unipus 激活
  'sites/ucampus.js',                            # 站点·U校园：真答题(quiz)，仅 ucampus 激活
  'sites/ilabx.js',                            # 站点·实验空间：真答题(quiz)，仅 ilabx 激活
  'sites/chaoxing-exam.js',                    # 站点·超星学习通：作业/考试真答题(quiz)，仅 chaoxing 激活
  'takeover/dom/dom.js',                         # 接管引擎：overrideVideo / walkVideos / neutralizeGlobalPause / MO 自启动
  'takeover/dom/session.js',                     # 接管·用户暂停意图状态机：userPause/userResume/autoStopTick/resumeTick（与 dom.js 执行闸门就近）
  'presentation/toast.js',                       # 呈现·轻提示组件：toast；经 Store.emit('ui:toast') 触发，订阅在 presentation/panel.js
  'takeover/dom/lifecycle.js',                   # 接管·卸载还原：_ananasNeutralized / _playWatchDocs / cleanupListeners / uninstall（须在 dom.js 之后）
  'plugins/registry.js',                         # 插件·注册中心：renderAddons / drainAddonQueue（原 ui/addons.js）
  'presentation/panel.js',                       # 呈现·面板编排：共享状态 / 输入回填 / 显隐 / 热键 / 事件订阅
  'presentation/panel-template.js',             # 呈现·面板 HTML 模板：buildPanelHTML
  'presentation/panel-core.js',                 # 呈现·面板装配与事件绑定：ensurePanel（含导航 switchTab）
  'presentation/panel-ds-console.js',            # 呈现·DeepSeek 应答端控制台：bindDSConsole/_dsUpdateConsole（由 ensurePanel 运行时调用）
  'presentation/panel-controls.js',             # 呈现·控制区事件绑定：bindPanelControlEvents（入侵/礼貌模式 + 黑匣子）
  'presentation/panel-drag.js',                  # 呈现·面板拖拽（合成层优化）与 Ninja 窄条贴边判定
  'presentation/diagnostics.js',                 # 呈现·诊断与黑匣子：buildDiagnostics / copyDiagnostics / fallbackCopy
  'presentation/dashboard.js',                   # 呈现·状态刷新：refreshPanelState / updateBadge / renderDashboard / renderVideoList
  'presentation/commands.js',                    # 呈现·命令面板：registerCommand / executeRawCmd / 下拉交互
  'presentation/zhihuishu-fab.js',               # 呈现·智慧树专属：右下角微型标志性图标 FAB（仅 zhihuishu 渲染）
  'takeover/bootstrap/main-loop.js'              # 自启动：play 即时接管 / 首次安装 / _loopTick 主循环 / Store.state 镜像
)

$domainFiles = $domainRel | ForEach-Object { Join-Path $srcDir $_ }
foreach ($f in $domainFiles) { if (-not (Test-Path $f)) { $missing += $f } }
if ($missing.Count -gt 0) {
  $list = $missing | ForEach-Object { '  - ' + $_ }
  throw ("Build aborted: '$srcDir' is missing required file(s):`n" + ($list -join "`n"))
}

# 反向校验（防"代码拆分后无人维护"的静默漂移）：源树里任何 .js 必须属于以下三类之一，
#   (a) 强制入口 takeover/meta.js / takeover/bootstrap/core.js
#   (b) $domainRel 中的已构建模块
#   (c) $deprecated 中已知废弃、显式排除的文件
# 任何不在此三类的 .js 都会被当作"漏列的真孤儿"直接报错，避免新增模块被静默排除出产物。
# 注：deprecated 与 check-module-size.ps1 的 $deprecated 保持同步。
$deprecated = @()
$allowedRel = @('takeover/meta.js', 'takeover/bootstrap/core.js') + $domainRel + $deprecated
Get-ChildItem -Path $srcDir -Recurse -Filter *.js | ForEach-Object {
  $rel = $_.FullName.Substring($srcDir.Length + 1).Replace('\', '/')
  if ($allowedRel -notcontains $rel) {
    throw "unexpected source file not in build list (nor deprecated): $rel — 要么加入 `$domainRel 参与构建，要么加入 `$deprecated 显式废弃"
  }
}

$meta = [IO.File]::ReadAllText((Join-Path $srcDir 'takeover\meta.js'))
$core = [IO.File]::ReadAllText((Join-Path $srcDir 'takeover\bootstrap\core.js'))

# 规范化：统一为 LF 行尾并去除每行尾随空白（跨 OS 一致产物）
function Normalize-Chunk([string]$t) {
  return ((($t -replace "`r`n", "`n") -replace "`r", "`n") -split "`n" | ForEach-Object { $_.TrimEnd() }) -join "`n"
}
$meta = Normalize-Chunk $meta
$core = Normalize-Chunk $core

# 注入构建元数据（置于 // ==/UserScript== 之后，不影响 Tampermonkey 元数据块解析）
$gitSha = ''
try { $gitSha = (git rev-parse --short HEAD 2>$null).Trim() } catch {}
if (-not $gitSha) { $gitSha = 'unknown' }
$builtAt = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
$buildMeta = "// Built: $builtAt  commit: $gitSha  minify: $(if ($minify) { 'on' } else { 'off' })"

$chunks = @($meta, '', $buildMeta, '', $core)
foreach ($f in $domainFiles) { $chunks += Normalize-Chunk ([IO.File]::ReadAllText($f)) }

$body = ($chunks -join "`n").TrimEnd() + "`n`n})();`n"

# 可选 Minify：安全压缩（删除所有空行；保留 // 注释以免误伤 https:// 等）。生产 minify 需 terser。
if ($minify) {
  $body = ((($body -split "`n") | Where-Object { $_.Trim().Length -gt 0 }) -join "`n") + "`n"   # 显式括号：PowerShell 中 + 优先级高于 -join
}

# 构建后冒烟校验：元数据块 + IIFE 闭合必须存在，否则产物损坏直接失败
$smokeErr = $null
if ($body -notmatch '// ==UserScript==') { $smokeErr = 'metadata block (// ==UserScript==) missing at top' }
elseif ($body -notmatch '// ==/UserScript==') { $smokeErr = 'metadata block not closed (// ==/UserScript==) missing' }
elseif ($body.TrimEnd() -notmatch '\}\)\(\);\s*$') { $smokeErr = 'IIFE closing "})();" missing at end' }
if ($smokeErr) { throw ("Build smoke check FAILED: $smokeErr") }

if ($dryRun) {
  Write-Host "[DryRun] would write $($body.Length) chars to $out"
} else {
  [IO.File]::WriteAllText($out, $body, (New-Object Text.UTF8Encoding($false)))
  Write-Host "build done -> $out"
}
Write-Host ('domains (' + $domainFiles.Count + '): ' + ($domainRel -join '  '))
