# check-module-size.ps1
# 单文件行数红线自检（参见 docs/ARCHITECTURE_GOVERNANCE.md §2/§5）
#   - > HARD 且不在白名单 -> RED，退出码 1
#   - SOFT..HARD          -> YELLOW（提示可拆分）
#   - <= SOFT             -> OK
$ErrorActionPreference = 'Stop'

$root = 'c:/Users/24033_1dhcyji/CodeBuddy/20260723173246/ecosystem/src/chaoxing-force-play'
$SOFT = 300
$HARD = 350

# whitelist: high-cohesion historical files pending refactor (do NOT add new entries; only dom/dom.js)
# dom/dom.js: 513 -> 368 after extracting biz/session.js + ui/toast.js + dom/lifecycle.js.
# Still 18 lines over HARD(350); remaining content is the cohesive takeover engine
# (overrideVideo / walkVideos / neutralizeGlobalPause / MO), which should not be split further
# without a clear seam. Keep whitelisted until a justified seam appears.
$whitelist = @('dom/dom.js')
# deprecated: old files superseded by the refactored domain modules; NOT built. Delete to comply.
$deprecated = @()

$files = Get-ChildItem -Path $root -Recurse -Filter *.js | Sort-Object FullName
$red = 0
Write-Output ('MODULE SIZE GATE  soft=' + $SOFT + '  hard=' + $HARD)
Write-Output '----------------------------------------'
foreach ($f in $files) {
  $t = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
  $n = ($t -split "`r?`n").Count
  $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
  $tag = 'OK '
  if ($deprecated -contains $rel) { $tag = 'DEP' }
  elseif ($n -gt $HARD) {
    if ($whitelist -contains $rel) { $tag = 'WHT' }
    else { $tag = 'RED'; $red++ }
  } elseif ($n -gt $SOFT) { $tag = 'YLW' }
  $line = '{0,-6} {1,5}  {2}' -f $tag, $n, $rel
  Write-Output $line
}
Write-Output '----------------------------------------'
if ($red -gt 0) {
  Write-Output ('FAIL: ' + $red + ' file(s) exceed hard limit ' + $HARD + ' (not whitelisted). Split or move content per governance doc.')
  exit 1
} else {
  Write-Output 'PASS: no non-whitelisted file exceeds hard limit.'
  $dep = Get-ChildItem -Path $root -Recurse -Filter *.js | Where-Object { $deprecated -contains $_.FullName.Substring($root.Length + 1).Replace('\', '/') }
  if ($dep.Count -gt 0) {
    Write-Output ('NOTE: ' + $dep.Count + ' deprecated file(s) still present (superseded by domain modules, not built). Delete to fully comply:')
    $dep | ForEach-Object { Write-Output ('  - ' + $_.FullName.Substring($root.Length + 1).Replace('\', '/')) }
  }
  exit 0
}
