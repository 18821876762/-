<#
  .SYNOPSIS
  Zero-dependency build: assemble apps/userscript/src/chaoxing-force-play/ back into the
  single dist/chaoxing-force-play.user.js (still one installable file, no runtime deps).

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
    ■ presentation 呈现域：{styles,toast,panel,panel-template,panel-toast-feed,panel-core,panel-ds-console,panel-controls,panel-drag,diagnostics,dashboard,commands,zhihuishu-fab}

  .PARAMETER SrcDir
    源目录（含 meta.js / bootstrap / 各能力域模块）。默认 ./src/chaoxing-force-play。CI 或本地可用备用路径。

  .PARAMETER OutFile
    输出产物路径。默认项目根 dist/chaoxing-force-play.user.js；-Variant open 时输出 dist/chaoxing-force-play.open.user.js。

  .PARAMETER Variant
    构建变体：'personal'（个人测试，默认，无首次预热）或 'open'（对外开源，注入 __CX_VARIANT='open' 并含首次预热阶段）。

  .PARAMETER Minify
    生产级压缩产物：优先用 esbuild 压缩「域模块体」（占体积 ~99%），
    保留顶部 // ==UserScript== 元数据块与尾部 })(); 不被删（esbuild legalComments
    默认会清除注释，故只压主体、不动头尾）。保守地【不开启 tree-shaking】：本工程大量
    跨模块引用经由字符串契约（__cxRegisterAddon / window.__CX_FORCE_PLAY.* 等）间接调用，
    激进摇树会误删被动态调用的函数。若 esbuild 不可用，回退到朴素空白行压缩。

  .PARAMETER DryRun
    只打印将写入的字符数，不落盘。

  .PARAMETER SkipSim
    跳过全部本地 _sim 仿真门禁（②）。Playwright 浏览器仿真原本由独立入口执行；
    节点语法 / eslint / 契约 / 元数据门禁仍照常运行。用于本地快速构建与 CI。

  .PARAMETER Fast
    开发快模式（P1-11）：跳过最耗时的 ②_sim 与 ③_整包 ESLint，仅跑 ① node --check
    + ④⑤⑥⑦⑧ 契约/元数据门禁（含 ⑥⑦⑧ 变异自检），本地「改→验」亚秒级反馈。
    无依赖门禁经 Start-Job 并行派发。CI 不应使用（仍须全量门禁）。

  .EXAMPLE
  powershell -ExecutionPolicy Bypass -File build-force-play.ps1
  powershell -ExecutionPolicy Bypass -File build-force-play.ps1 -Minify -OutFile .\dist\chaoxing-force-play.min.user.js
  powershell -ExecutionPolicy Bypass -File build-force-play.ps1 -Fast
#>
[CmdletBinding()]
param(
  [string]$srcDir,
  [string]$outFile,
  [string]$variant = 'personal',
  [switch]$minify,
  [switch]$dryRun,
  [switch]$skipSim,
  [switch]$fast
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$projectRoot = Split-Path (Split-Path $root -Parent) -Parent
$distRoot = Join-Path $projectRoot 'dist'
if (-not $srcDir)  { $srcDir  = Join-Path $root 'src\chaoxing-force-play' }
if (-not $outFile) {
  if ($variant -eq 'open') { $outFile = Join-Path $distRoot 'chaoxing-force-play.open.user.js' }
  else { $outFile = Join-Path $distRoot 'chaoxing-force-play.user.js' }
}
$out = $outFile

# 解析可用 node 可执行文件（供 -Minify 的 esbuild 封装与构建后门禁 ① 复用）
$nodeExe = $null
$nodeCandidates = @(
  (Join-Path $projectRoot 'tools\runtime\node_home\node-v24.19.0-win-x64\node.exe'),
  (Join-Path $projectRoot 'tools\runtime\node_home\node-v20.19.0-win-x64\node.exe'),
  (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
)
foreach ($c in $nodeCandidates) { if ($c -and (Test-Path $c)) { $nodeExe = $c; break } }

# 入口 + 域模块缺失文件聚合检查：一次性列出全部缺失，避免逐个 throw 反复重试
$missing = @()
if (-not (Test-Path (Join-Path $srcDir 'takeover\meta.js')))            { $missing += 'takeover/meta.js' }
if (-not (Test-Path (Join-Path $srcDir 'takeover\bootstrap\core.js')))  { $missing += 'takeover/bootstrap/core.js' }

# 各能力域模块：按依赖/执行顺序显式列出（同处一个 IIFE 闭包，函数声明 hoist，顺序仅影响极少顶层即时语句）
# 能力域：接管(takeover: foundation/engine/dom/bootstrap) → 站点(sites) → 插件(plugins) → 呈现(presentation)
# P3-1：构建模块清单外置为单一事实源 apps/userscript/build-manifest.txt（按依赖/执行顺序逐行列出，
#   由自动发现兜底校验，不再内联手写散落于本脚本）。新增模块只需加入 manifest 一行，
#   反向校验会确保其被纳入产物（防漏列），且 manifest 每项必须存在（防错列）。
$domainRel = @()
$manifestFile = Join-Path $root 'build-manifest.txt'
if (-not (Test-Path $manifestFile)) { throw "Build manifest missing: $manifestFile" }
$domainRel = @(Get-Content -Path $manifestFile | Where-Object { $_.Trim().Length -gt 0 -and -not $_.TrimStart().StartsWith('#') })


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
    throw "unexpected source file not in build manifest (nor deprecated): $rel — 加入 apps/userscript/build-manifest.txt 参与构建，或加入 `$deprecated 显式废弃"
  }
}

$meta = [IO.File]::ReadAllText((Join-Path $srcDir 'takeover\meta.js'))
$core = [IO.File]::ReadAllText((Join-Path $srcDir 'takeover\bootstrap\core.js'))

# 规范化：统一为 LF 行尾并去除每行尾随空白（跨 OS 一致产物）
function Normalize-Chunk([string]$t) {
  return ((($t -replace "`r`n", "`n") -replace "`r", "`n") -split "`n" | ForEach-Object { $_.TrimEnd() }) -join "`n"
}
$meta = Normalize-Chunk $meta

# P1-5：单一事实源版本校验——package.json.version 必须与元数据块 @version 一致，防止版本漂移。以 @version 为准。
try {
  $pkgVer = ([IO.File]::ReadAllText((Join-Path $root 'package.json')) | ConvertFrom-Json).version
  $metaVer = [regex]::Match($meta, '//\s*@version\s+(\S+)').Groups[1].Value
  if ($pkgVer -and $metaVer -and $pkgVer -ne $metaVer) {
    throw ("VERSION MISMATCH: package.json version='$pkgVer' vs UserScript @version='$metaVer'. 请同步两者（以 @version 为准）")
  }
  Write-Host ('[build] version check -> package.json=' + $pkgVer + ' meta=@version ' + $metaVer) -ForegroundColor Green
} catch {
  Write-Host ('BUILD GATE: version check FAILED: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}

$core = Normalize-Chunk $core

# 变体注入（个人测试 / 对外开源）：开源版改 @name 并注入 __CX_VARIANT='open'，承载首次预热阶段
if ($variant -notin @('personal', 'open')) { Write-Host 'BUILD GATE: -Variant must be ''personal'' or ''open''' -ForegroundColor Red; exit 1 }
$core = $core -replace "  'use strict';", ("  'use strict';`n  var __CX_VARIANT = '$variant';")
if ($variant -eq 'open') {
  $meta = $meta -replace '(@name\s+网课强制续播)', '$1（开源版）'
  $meta = $meta -replace '(@description\s+网课强制续播 · 自动答题助手)', '$1（开源版：首次使用含预热阶段）'
}

# Deterministic source identity; generated dist/exports do not make source inputs dirty.
if (-not $nodeExe) { throw 'Node.js 24+ is required for source identity and build validation.' }
$provenanceTool = Join-Path $projectRoot 'scripts/release-assets.cjs'
$provenanceJson = & $nodeExe $provenanceTool provenance --src $srcDir
if ($LASTEXITCODE -ne 0) { throw 'Cannot calculate build source identity.' }
$sourceProvenance = ($provenanceJson -join "`n") | ConvertFrom-Json
$gitSha = $sourceProvenance.commit
$gitState = $sourceProvenance.gitState
$sourceSha256 = $sourceProvenance.sourceSha256
$buildMeta = "// Built: commit: $gitSha  git-state: $gitState  source-sha256: $sourceSha256  minify: $(if ($minify) { 'on' } else { 'off' })"
if ($env:CX_BUILD_META -eq '1') {
  $builtAt = Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'
  $buildMeta = "// Built: $builtAt  commit: $gitSha  git-state: $gitState  source-sha256: $sourceSha256  minify: $(if ($minify) { 'on' } else { 'off' })"
}

$headerChunks = @($meta, '', $buildMeta, '', $core)
$domainChunks = @()
foreach ($f in $domainFiles) { $domainChunks += Normalize-Chunk ([IO.File]::ReadAllText($f)) }
$header = ($headerChunks -join "`n")
$domainBody = ($domainChunks -join "`n").TrimEnd()

# 域分组体积报告（量化"按域分组打包"，便于后续评估 tree-shaking / 拆分）
$groups = @{}
foreach ($rel in $domainRel) {
  $grp = $rel.Split('/')[0]
  $fp = Join-Path $srcDir $rel
  if (Test-Path $fp) {
    $cur = if ($groups.ContainsKey($grp)) { $groups[$grp] } else { 0 }
    $groups[$grp] = $cur + (Get-Item $fp).Length
  }
}
$report = ($groups.GetEnumerator() | Sort-Object Name | ForEach-Object { ('{0}: {1:N0}B' -f $_.Name, $_.Value) }) -join '  |  '
Write-Host ('[build] domain sizes -> ' + $report)

# 域模块体占体积 ~99%；用 esbuild 压缩它，保留顶部元数据块与尾部 })();（esbuild 默认会清注释）。
$minifiedDomain = $null
if ($minify) {
  $minScript = Join-Path $root 'scripts/minify.js'
  if ((Test-Path $minScript) -and $nodeExe) {
    $tmpIn  = Join-Path $env:TEMP ('cx_fp_in_'  + [guid]::NewGuid().ToString('N') + '.js')
    $tmpOut = Join-Path $env:TEMP ('cx_fp_out_' + [guid]::NewGuid().ToString('N') + '.js')
    [IO.File]::WriteAllText($tmpIn, $domainBody, (New-Object Text.UTF8Encoding($false)))
    # 以"是否生成产物文件"判定成败：esbuild 缺失时 minify.js 退出 3 且不写文件。
    # try/catch 吞掉外部命令 stderr 在 $ErrorActionPreference='Stop' 下抛出的 NativeCommandError。
    try { & $nodeExe $minScript $tmpIn $tmpOut 2>&1 | Out-Null } catch { }
    if (Test-Path $tmpOut) {
      $minifiedDomain = [IO.File]::ReadAllText($tmpOut)
      Write-Host '[build] minified via esbuild' -ForegroundColor Green
    } else {
      Write-Host '[build] esbuild minify unavailable/failed; falling back to naive blank-line strip' -ForegroundColor Yellow
    }
    Remove-Item $tmpIn, $tmpOut -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host '[build] minify requested but node/esbuild unavailable; falling back to naive blank-line strip' -ForegroundColor Yellow
  }
}

if ($minifiedDomain) {
  $body = $header + "`n" + $minifiedDomain + "`n`n})();`n"
} else {
  # 朴素压缩：仅去空行，保留 // 注释（避免误伤 https:// 等）；元数据块与 IIFE 闭合原样保留
  if ($minify) {
    # 兜底仅压缩域模块，完整许可通知和元信息保持原字节布局。
    $compactDomain = (($domainBody -split "`n" | Where-Object { $_.Trim().Length -gt 0 }) -join "`n")
    $body = $header + "`n" + $compactDomain + "`n`n})();`n"
  } else {
    $body = $header + "`n" + $domainBody + "`n`n})();`n"
  }
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
  # 幂等性修复(审查 A3)：产物原子写——先写同目录 .tmp 再 Move 替换，构建中断不再留下半截产物
  # （旧实现直接覆盖写，Ctrl+C/断电可能留下损坏文件；门禁在写入之后跑，保护不了已写出的半截文件）。
  $outDir = Split-Path ([IO.Path]::GetFullPath($out)) -Parent
  if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
  $tmpOut = "$out.tmp"
  [IO.File]::WriteAllText($tmpOut, $body, (New-Object Text.UTF8Encoding($false)))
  try { [IO.File]::Move($tmpOut, $out, $true) } catch {
    # Move(overwrite) 在部分旧 .NET/PowerShell 上不可用：回退 删旧+改名（同目录 rename 仍为原子语义）
    Remove-Item $out -Force -ErrorAction SilentlyContinue
    [IO.File]::Move($tmpOut, $out)
  }
  Write-Host "build done -> $out"

  # ── 构建后门禁（P1-11：并行 + 开发快模式）──
  # -Fast：仅跑 ① node --check + ④⑤⑥⑦⑧ 契约/元数据门禁，跳过最耗时的 ②_sim 与 ③_整包 ESLint，
  #   给本地「改→验」亚秒级反馈；CI 仍跑全量（不带 -Fast）。
  # 并行：无依赖门禁（① node --check、③ eslint、④ contract verify、⑤ contract doc、
  #   ⑥ contract semantics、⑦ metadata、⑧ cross-module contract）经 Start-Job 并发派发、汇总失败；
  #   ⑥⑦ 的变异自检在其主门禁 PASSED 后串行补跑（防规则空转假绿灯）。

  if (-not $nodeExe) {
    Write-Host "BUILD GATE: node not found — 跳过所有需 node 的门禁" -ForegroundColor Yellow
  } else {
    $failed = @()

    # 门禁 ③ eslint 前置硬断言（整改 P0-3 防回归）：同目录只允许一份 .eslintrc.*，否则静默忽略致假绿灯。
    # 在并行派发前串行执行（秒级、且是 eslint 的前提）。
    if (-not $fast) {
      $eslintCfgs = @(Get-ChildItem -Path $root -Force -Filter '.eslintrc.*' -File -ErrorAction SilentlyContinue)
      if ($eslintCfgs.Count -gt 1) {
        Write-Host "BUILD GATE: eslint config CONFLICT - 同目录存在多份 ESLint 配置，仅第一份生效，其余被静默忽略：" -ForegroundColor Red
        $eslintCfgs | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Red }
        Write-Host "  请只保留 .eslintrc.cjs 一份。" -ForegroundColor Red
        exit 1
      }
    }

    # Required gates must exist; missing validation cannot produce a successful build.
    $eslintBin      = Join-Path $root 'node_modules\eslint\bin\eslint.js'
    $contractJs     = Join-Path $root 'scripts\verify_contracts.js'
    $contractDocJs  = Join-Path $root 'scripts\verify_contract_doc.js'
    $contractSemJs  = Join-Path $root 'scripts\verify_contract_semantics.js'
    $contractSelfJs = Join-Path $root 'scripts\selftest_contract_semantics.js'
    $metaJs         = Join-Path $root 'scripts\verify_metadata.js'
    $metaSelfJs     = Join-Path $root 'scripts\selftest_metadata.js'
    $xmcJs          = Join-Path $root 'scripts\verify_cross_module.js'

    foreach ($requiredGate in @($contractJs, $contractDocJs, $contractSemJs, $contractSelfJs, $metaJs, $metaSelfJs, $xmcJs)) {
      if (-not (Test-Path -LiteralPath $requiredGate)) { throw "Required build gate missing: $requiredGate" }
    }

    # 并行门禁规格：Name + 传给 node 的实参数组（Args[0] 即脚本/开关）
    $parallelSpecs = @( @{ Name = 'node --check'; Args = @('--check', $out) } )
    if (-not $fast -and -not (Test-Path $eslintBin)) { throw "ESLint missing; install locked app dependencies with npm ci." }
    if (-not $fast -and (Test-Path $eslintBin)) {
      $parallelSpecs += @{ Name = 'eslint'; Args = @($eslintBin, '--no-eslintrc', '--no-ignore', '--config', (Join-Path $root '.eslintrc.cjs'), $out) }
    }
    if (Test-Path $contractJs)    { $parallelSpecs += @{ Name = 'contract verify';    Args = @($contractJs) } }
    else { Write-Host "BUILD GATE: contract verify script not found (skipped)" -ForegroundColor Yellow }
    if (Test-Path $contractDocJs) { $parallelSpecs += @{ Name = 'contract doc';       Args = @($contractDocJs) } }
    else { Write-Host "BUILD GATE: contract doc script not found (skipped)" -ForegroundColor Yellow }
    if (Test-Path $contractSemJs) { $parallelSpecs += @{ Name = 'contract semantics'; Args = @($contractSemJs) } }
    else { Write-Host "BUILD GATE: contract semantics script not found (skipped)" -ForegroundColor Yellow }
    if (Test-Path $metaJs)        { $parallelSpecs += @{ Name = 'metadata';           Args = @($metaJs, $out) } }
    else { Write-Host "BUILD GATE: metadata script not found (skipped)" -ForegroundColor Yellow }
    if (Test-Path $xmcJs)         { $parallelSpecs += @{ Name = 'cross-module contract'; Args = @($xmcJs) } }
    else { Write-Host "BUILD GATE: cross-module contract script not found (skipped)" -ForegroundColor Yellow }

    if ($parallelSpecs.Count -gt 0) {
      $jobs = @()
      foreach ($spec in $parallelSpecs) {
        $jobs += Start-Job -ScriptBlock {
          param($nodeExe, $root, $name, $nodeArgs)
          Set-Location $root
          $res = & $nodeExe @nodeArgs 2>&1
          [pscustomobject]@{ Name = $name; Code = $LASTEXITCODE; Out = ($res -join "`n") }
        } -ArgumentList $nodeExe, $root, $spec.Name, $spec.Args
      }
      foreach ($job in $jobs) {
        $r = Receive-Job -Job $job -Wait -AutoRemoveJob
        if ($r.Code -ne 0) {
          $failed += $r.Name
          Write-Host "BUILD GATE: $($r.Name) FAILED" -ForegroundColor Red
          if ($r.Out) { Write-Host $r.Out }
        } else {
          Write-Host "BUILD GATE: $($r.Name) PASSED" -ForegroundColor Green
        }
      }

      # ⑥⑦ 变异自检：主门禁 PASSED 且自检脚本存在才补跑（防规则空转假绿灯）
      if ($failed -notcontains 'contract semantics' -and (Test-Path $contractSelfJs)) {
        $stOut = & $nodeExe $contractSelfJs 2>&1
        if ($LASTEXITCODE -ne 0) { $failed += 'contract semantics SELFTEST'; Write-Host "BUILD GATE: contract semantics SELFTEST FAILED (rules went vacuous)" -ForegroundColor Red; Write-Host $stOut }
        else { Write-Host "BUILD GATE: contract semantics SELFTEST PASSED" -ForegroundColor Green }
      }
      if ($failed -notcontains 'metadata' -and (Test-Path $metaSelfJs)) {
        $msOut = & $nodeExe $metaSelfJs 2>&1
        if ($LASTEXITCODE -ne 0) { $failed += 'metadata SELFTEST'; Write-Host "BUILD GATE: metadata SELFTEST FAILED (rules went vacuous)" -ForegroundColor Red; Write-Host $msOut }
        else { Write-Host "BUILD GATE: metadata SELFTEST PASSED" -ForegroundColor Green }
      }
      # ⑧ 跨模块契约自检：主门禁 PASSED 且脚本存在才补跑（防规则空转假绿灯）
      if ($failed -notcontains 'cross-module contract' -and (Test-Path $xmcJs)) {
        $xmcOut = & $nodeExe $xmcJs --selftest 2>&1
        if ($LASTEXITCODE -ne 0) { $failed += 'cross-module contract SELFTEST'; Write-Host "BUILD GATE: cross-module contract SELFTEST FAILED (rules went vacuous)" -ForegroundColor Red; Write-Host $xmcOut }
        else { Write-Host "BUILD GATE: cross-module contract SELFTEST PASSED" -ForegroundColor Green }
      }
    }

    # 门禁 ② _sim：跳过需 Playwright+浏览器的少数真机仿真；其余 jsdom 仿真由 CI 单独跑。
    # -Fast 或 -SkipSim 时跳过全量 _sim，本地亚秒级反馈。
    # P1:统一走 scripts/run-sim.js 聚合入口（内部自动排除 Playwright 用例；已迁移
    # node:test 的文件由 runner 聚合，未迁移的旧式文件仍逐文件 spawn），替代手搓
    # Get-ChildItem 循环，规避 PowerShell 逐文件 stderr 误判（NativeCommandError 中断）。
    if ($fast -or $skipSim) {
      Write-Host "BUILD GATE: _sim SKIPPED ($(if ($fast) { 'Fast mode' } else { 'SkipSim switch set' }))" -ForegroundColor Yellow
    } else {
      $simDir = Join-Path $root '_sim'
      if (Test-Path $simDir) {
        $simRunner = Join-Path $root 'scripts\run-sim.js'
        $simOut = & $nodeExe $simRunner 2>&1
        if ($LASTEXITCODE -ne 0) {
          Write-Host "BUILD GATE: _sim FAILED (see above)" -ForegroundColor Red
          exit 1
        }
        Write-Host "BUILD GATE: _sim PASSED (via run-sim.js)" -ForegroundColor Green
      } else {
        Write-Host "BUILD GATE: _sim dir not found (skipped)" -ForegroundColor Yellow
      }
    }

    if ($failed.Count -gt 0) { exit 1 }
  }
}

Write-Host ('domains (' + $domainFiles.Count + '): ' + ($domainRel -join '  '))

# P1-12：显式退出码——所有门禁失败时已 `exit 1`；此处显式 `exit 0`，
# 保证 CI/调用方拿到的是确定的进程退出码，而非依赖脚本自然结束的隐含 0。
exit 0
