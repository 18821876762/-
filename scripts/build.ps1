<# Root entrypoint; the application builder owns module order and validation. #>
[CmdletBinding()]
param(
    [ValidateSet('personal','open')][string]$Variant='personal',
    [switch]$Fast,
    [switch]$Minify,
    [switch]$DryRun,
    [switch]$SkipSim,
    [string]$OutFile,
    [string]$SrcDir
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$builder=Join-Path $projectRoot 'apps\userscript\build-force-play.ps1'
if(-not(Test-Path -LiteralPath $builder)){throw "Application builder missing: $builder"}
& $builder @PSBoundParameters
if(-not $?){throw 'Application build failed'}
if(-not $DryRun -and $Variant -eq 'personal' -and -not $OutFile){
    $product=Join-Path $projectRoot 'dist\chaoxing-force-play.user.js'
    $installProduct=Join-Path $projectRoot 'dist\chaoxing-force-play-latest.user.js'
    Copy-Item -LiteralPath $product -Destination $installProduct -Force
    Write-Output 'Installable latest product synchronized.'
}
