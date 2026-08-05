<#
  .SYNOPSIS
  Zero-dependency build: assemble ecosystem/src/chaoxing-force-play/ back into the
  single ecosystem/chaoxing-force-play.user.js (still one installable file, no runtime deps).

  Concatenation order: meta.js + bootstrap/core.js + 各域模块 domain files + `})();`
  All modules share one IIFE closure (opened in bootstrap/core.js as `(function () {`);
  function declarations hoist, so split/join behavior is identical to the original single file.

  分层结构（基础 → 业务 → 接管引擎 → 界面 → 自启动），文件按依赖/执行顺序显式列出（no fragile globs）：
    ⑦ utils → state → state/metrics → ① meta-config → ⑧ storage → ③ site
    → biz/{bridge,targeting,dedup,playback,stats,foreground}  （业务域：本地桥/定向/去重/播放原语/统计/前台）
    → dom                                                  （接管引擎 + 视频枚举 + 用户暂停 + 计时器 + MO 自启动）
    → ui/{addons,panel,panel-template,panel-core,panel-drag,diagnostics,dashboard,commands}  （界面域：副脚本/面板编排/模板/装配/拖拽/诊断/仪表盘/命令）
    → bootstrap/main-loop                                  （自启动 + 主循环）

  .PARAMETER SrcDir
    源目录（含 meta.js / bootstrap / 各域模块）。默认 ./src/chaoxing-force-play。CI 或本地可用备用路径。

  .PARAMETER OutFile
    输出产物路径。默认 ./chaoxing-force-play.user.js。

  .PARAMETER Minify
    可选紧凑产物：折叠连续空行（不去 // 注释，避免误伤 https:// 等）。生产级 minify 仍需 terser。

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
if (-not (Test-Path (Join-Path $srcDir 'meta.js')))            { $missing += 'meta.js' }
if (-not (Test-Path (Join-Path $srcDir 'bootstrap\core.js')))  { $missing += 'bootstrap/core.js' }

# 各域模块：按依赖/执行顺序显式列出（同处一个 IIFE 闭包，函数声明 hoist，顺序仅影响极少顶层即时语句）
# 分层：基础(⑦utils/state/config/storage/site) → 业务(biz/*) → 接管引擎(dom) → 界面(ui/*) → 自启动(bootstrap/main-loop)
$domainRel = @(
  'utils/utils.js',          # ⑦ 工具库：dbg / swallow / cxState
  'utils/url.js',            # ⑦ URL 解析工具：topHref / urlParam（被 biz/targeting、biz/bridge 复用）
  'state/state.js',          # 状态集中层（P1）：Store 单例 + get/set/on/emit
  'state/metrics.js',        # 可观测性状态层：仪表盘指标 _moHistory/_safePlay*/_targetHit* + 黑匣子 _bxBuffer/_bxLog
  'meta-config/config.js',   # ① 元信息与配置区：CONFIG / DEBUG / 原型 neutralize / 倍速循环（STYLES 已迁至 ui/styles.js）
  'ui/styles.js',            # 界面·样式/设计令牌：STYLES（面板/移动/Ninja/动效/按钮样式）+ window.__cxUI 导出（在 ui 模块与 dom.js 读取前定义）
  'storage/storage.js',      # ⑧ 存储：面板配置持久化 savePanelCfg/loadPanelCfg/clampCfg
  'site/site-router.js',     # ③ 站点适配 / 页面路由（含智慧树网骨架）
  'biz/policy.js',           # 业务·策略开关：forcePlayEnabled（页面级 opt-out）/ cxVideoOptOut（元素级 opt-out）
  'biz/bridge.js',           # 业务·本地桥客户端：BRIDGE / resolveBridgeBase / probeBridgeBase / bridgeFetch / bridgeInit / restoreNativePause
  'biz/targeting.js',        # 业务·定向：白名单 / 附件钩子 / refreshTargets / videoBelongsToTask（桥与 URL 解析已迁出）
  'biz/dedup.js',            # 业务·去重：重播加固 ENDED_SRCS / signatureOf / isRebuildFinished
  'biz/playback.js',         # 业务·播放原语：pauseNoop / safePlay / releaseVideo / nearEnd
  'biz/stats.js',            # 业务·看播统计：_watchStats / loadWatchStats / recordWatchMs
  'biz/foreground.js',       # 业务·前台判定：foregroundVideo / escapeHTML / shortSrc
  'dom/dom.js',              # 接管引擎：overrideVideo / 视频枚举 walkVideos / neutralizeGlobalPause / MO 自启动（会话·toast·卸载还原已迁出）
  'biz/session.js',          # 业务·观看会话：userPause / userResume / autoStopTick / resumeTick（用户意图覆盖接管引擎）
  'ui/toast.js',             # 界面·轻提示组件：toast（反馈分级）；经 Store.emit('ui:toast') 触发，订阅在 ui/panel.js
  'dom/lifecycle.js',        # DOM·卸载还原：_ananasNeutralized / _playWatchDocs / cleanupListeners / uninstall 导出（须在 dom.js 之后：引用其 _mo 与 visibilityHandler）
  'ui/addons.js',            # 界面·副脚本注册中心：renderAddons / drainAddonQueue
  'ui/panel.js',             # 界面·悬浮面板编排：共享状态 / 输入回填 / 显隐 / 热键 / 事件订阅
  'ui/panel-template.js',    # 界面·面板 HTML 模板（视图层）：buildPanelHTML
  'ui/panel-core.js',        # 界面·面板装配与事件绑定：ensurePanel（含导航 switchTab）
  'ui/panel-drag.js',        # 界面·面板拖拽（合成层优化）与 Ninja 窄条贴边判定
  'ui/diagnostics.js',       # 界面·诊断与黑匣子：buildDiagnostics / copyDiagnostics / fallbackCopy
  'ui/dashboard.js',         # 界面·状态刷新：refreshPanelState / updateBadge / renderDashboard / renderVideoList
  'ui/commands.js',          # 界面·命令面板：registerCommand / executeRawCmd / 下拉交互
  'bootstrap/main-loop.js'   # 自启动：play 即时接管 / 首次安装 / _loopTick 主循环 / Store.state 镜像
)

$domainFiles = $domainRel | ForEach-Object { Join-Path $srcDir $_ }
foreach ($f in $domainFiles) { if (-not (Test-Path $f)) { $missing += $f } }
if ($missing.Count -gt 0) {
  $list = $missing | ForEach-Object { '  - ' + $_ }
  throw ("Build aborted: '$srcDir' is missing required file(s):`n" + ($list -join "`n"))
}

# 反向校验（防"代码拆分后无人维护"的静默漂移）：源树里任何 .js 必须属于以下三类之一，
#   (a) 强制入口 meta.js / bootstrap/core.js
#   (b) $domainRel 中的已构建模块
#   (c) $deprecated 中已知废弃、显式排除的文件
# 任何不在此三类的 .js 都会被当作"漏列的真孤儿"直接报错，避免新增模块被静默排除出产物。
# 注：deprecated 与 check-module-size.ps1 的 $deprecated 保持同步。
$deprecated = @()
$allowedRel = @('meta.js', 'bootstrap/core.js') + $domainRel + $deprecated
Get-ChildItem -Path $srcDir -Recurse -Filter *.js | ForEach-Object {
  $rel = $_.FullName.Substring($srcDir.Length + 1).Replace('\', '/')
  if ($allowedRel -notcontains $rel) {
    throw "unexpected source file not in build list (nor deprecated): $rel — 要么加入 `$domainRel 参与构建，要么加入 `$deprecated 显式废弃"
  }
}

$meta = [IO.File]::ReadAllText((Join-Path $srcDir 'meta.js'))
$core = [IO.File]::ReadAllText((Join-Path $srcDir 'bootstrap\core.js'))

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

# 可选 Minify：安全压缩（折叠连续空行；不去 // 注释以免误伤 https:// 等）。生产 minify 需 terser。
if ($minify) {
  $body = (($body -split "`n") | Where-Object { $_.Trim().Length -gt 0 }) -join "`n" + "`n"
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
