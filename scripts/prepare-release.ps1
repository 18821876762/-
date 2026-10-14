<# Creates a reviewable local package. It never commits, pushes, or publishes. #>
[CmdletBinding()]
param([switch]$Draft, [string]$OutDir)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$localNode=Join-Path $projectRoot 'tools/runtime/node_home/node-v24.19.0-win-x64/node.exe'
$nodeExe=if(Test-Path -LiteralPath $localNode){$localNode}else{(Get-Command node -ErrorAction Stop).Source}
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'apps/userscript/package.json') -Raw | ConvertFrom-Json).version
if(-not $OutDir){
    $label=if($Draft){'draft'}else{'release'}
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutDir=Join-Path $projectRoot "backups/releases/$version/$label-$stamp"
}
$target=[IO.Path]::GetFullPath($OutDir)
$arguments=@((Join-Path $PSScriptRoot 'release-assets.cjs'),'prepare','--out',$target)
if($Draft){$arguments+='--draft'}
& $nodeExe @arguments
if($LASTEXITCODE -ne 0){throw 'Release preflight blocked package creation; review reported blockers.'}
Compress-Archive -LiteralPath $target -DestinationPath ($target+'.zip') -CompressionLevel Optimal
Write-Output "Local review package: $target.zip"
