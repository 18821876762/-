<#
  .SYNOPSIS
  将 apps/userscript/src/chaoxing-force-play/ 同步为 exports/chaoxing-force-play/ 源码镜像。
  原代码位置【不移动】；副本仅供 GitHub 开源阅读。编辑请改原处，本脚本使其保持同步。

  .PARAMETER SrcDir  源目录，默认 <repo>/apps/userscript/src/chaoxing-force-play
  .PARAMETER DstDir  目标目录，默认 <repo>/exports/chaoxing-force-play
  .PARAMETER Watch   监听模式：源目录 .js 变更即增量同步（实时），Ctrl+C 退出
#>
[CmdletBinding()]
param(
  [string]$SrcDir,
  [string]$DstDir,
  [switch]$Watch
)
$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$repoRoot   = Split-Path $scriptRoot -Parent
if (-not $SrcDir) { $SrcDir = Join-Path $repoRoot 'apps\userscript\src\chaoxing-force-play' }
if (-not $DstDir) { $DstDir = Join-Path $repoRoot 'exports\chaoxing-force-play' }
$SrcDir = (Resolve-Path -LiteralPath $SrcDir).ProviderPath.TrimEnd('\')
$DstDir = [IO.Path]::GetFullPath($DstDir).TrimEnd('\')
if ($DstDir.Equals($SrcDir,[StringComparison]::OrdinalIgnoreCase) -or
    $SrcDir.StartsWith($DstDir+'\',[StringComparison]::OrdinalIgnoreCase) -or
    $DstDir.StartsWith($SrcDir+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Source and mirror directories must not overlap.' }

function Assert-MirrorPath([string]$ItemPath) {
  $full = [IO.Path]::GetFullPath($ItemPath)
  if (-not $full.StartsWith($script:Dst+'\',[StringComparison]::OrdinalIgnoreCase)) { throw "Mirror path outside destination: $full" }
  $cursor = $full
  while ($cursor -and $cursor.Length -ge $script:Dst.Length) {
    if (Test-Path -LiteralPath $cursor) {
      if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Mirror contains a link: $cursor" }
    }
    $cursor = [IO.Path]::GetDirectoryName($cursor)
  }
  return $full
}

function Get-MirrorHash([string]$FilePath) {
  $algorithm=[Security.Cryptography.SHA256]::Create()
  $stream=[IO.File]::OpenRead($FilePath)
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)) }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}

# 脚本作用域变量，供文件监听事件回调复用
$script:Src = $SrcDir
$script:Dst = $DstDir

function Invoke-Mirror {
  if (-not (Test-Path $script:Src)) { throw "源目录不存在: $($script:Src)" }
  if (-not (Test-Path $script:Dst)) { New-Item -ItemType Directory -Path $script:Dst -Force | Out-Null }

  # 1) 增量拷贝/更新源树中所有 .js（保留相对路径）；README.md 等手写文档不在 *.js 范围，天然受保护
  $srcFiles = Get-ChildItem -Path $script:Src -Recurse -Filter *.js
  $relSet = @{}
  foreach ($f in $srcFiles) {
    $rel = $f.FullName.Substring($script:Src.Length + 1)
    $relSet[$rel] = $true
    $target = Assert-MirrorPath (Join-Path $script:Dst $rel)
    $need = $true
    if (Test-Path $target) {
      $dstItem = Get-Item $target
      if ($dstItem.Length -eq $f.Length -and (Get-MirrorHash $f.FullName) -eq (Get-MirrorHash $target)) { $need = $false }
    }
    if ($need) {
      New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $target -Force
    }
  }

  # 2) 删除目标树中源已不存在的 .js（保持 1:1 镜像）
  $dstFiles = Get-ChildItem -Path $script:Dst -Recurse -Filter *.js
  foreach ($f in $dstFiles) {
    $rel = $f.FullName.Substring($script:Dst.Length + 1)
    if (-not $relSet.ContainsKey($rel)) { $stalePath=Assert-MirrorPath $f.FullName; Remove-Item -LiteralPath $stalePath -Force }
  }

  # 3) 清理已空目录
  Get-ChildItem -Path $script:Dst -Recurse -Directory |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object { if (@(Get-ChildItem -LiteralPath $_.FullName -Force).Count -eq 0) { $emptyPath=Assert-MirrorPath $_.FullName; Remove-Item -LiteralPath $emptyPath -Force } }

  Write-Host ('[sync] ' + (Get-Date -Format 'HH:mm:ss') + ' mirrored ' + $srcFiles.Count + ' files -> ' + $script:Dst) -ForegroundColor Green
}

Invoke-Mirror

if ($Watch) {
  Write-Host '[sync] WATCH 模式已开启（源变更即同步，Ctrl+C 退出）...' -ForegroundColor Cyan
  $watcher = New-Object System.IO.FileSystemWatcher($script:Src, '*.js')
  $watcher.IncludeSubdirectories = $true
  $watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::FileName
  $watcher.EnableRaisingEvents = $true
  try {
    while ($true) {
      $change = $watcher.WaitForChanged([IO.WatcherChangeTypes]::All,1000)
      if (-not $change.TimedOut) { Invoke-Mirror }
    }
  }
  finally { $watcher.Dispose() }
}
