<# Offline project validation from any working directory. Browser checks are opt-in. #>
[CmdletBinding()]
param([switch]$SkipSim,[switch]$SkipPython,[switch]$Browser,[string]$PythonExe)
$ErrorActionPreference='Stop'
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
$projectRoot=Split-Path $PSScriptRoot -Parent
$appRoot=Join-Path $projectRoot 'apps\userscript'
$localNode=Join-Path $projectRoot 'tools\runtime\node_home\node-v24.19.0-win-x64\node.exe'
$nodeExe=if(Test-Path -LiteralPath $localNode){$localNode}else{(Get-Command node -ErrorAction Stop).Source}
function Invoke-Checked([string]$Program,[string[]]$Arguments){
    & $Program @Arguments
    if($LASTEXITCODE -ne 0){throw "Validation failed ($LASTEXITCODE): $Program $($Arguments -join ' ')"}
}
Invoke-Checked $nodeExe @('--check',(Join-Path $projectRoot 'dist\chaoxing-force-play.user.js'))
Invoke-Checked $nodeExe @((Join-Path $appRoot 'node_modules\eslint\bin\eslint.js'),'--no-eslintrc','--no-ignore','--config',(Join-Path $appRoot '.eslintrc.cjs'),(Join-Path $projectRoot 'dist\chaoxing-force-play.user.js'))
foreach($gate in @('verify_contracts.js','verify_contract_doc.js','verify_contract_semantics.js','verify_metadata.js','verify_cross_module.js')){
    Invoke-Checked $nodeExe @((Join-Path $appRoot ('scripts\'+$gate)))
}
foreach($unit in @('pure.test.js','quiz-merge.test.js')){
    Invoke-Checked $nodeExe @((Join-Path $appRoot ('tests\'+$unit)))
}
if(-not $SkipPython){
    if(-not $PythonExe){$PythonExe=(Get-Command python -ErrorAction Stop).Source}
    Invoke-Checked $PythonExe @('-B','-m','unittest','discover','-s',(Join-Path $projectRoot 'services\perception\cx_crawler\tests'),'-p','test_*.py')
}
if(-not $SkipSim){Invoke-Checked $nodeExe @((Join-Path $appRoot 'scripts\run-sim.js'))}
if($Browser){
    foreach($scenario in @('smoke-pw.js','sim-iframe-pw.js','sim-bridge-noise-pw.js','sim-panel-scroll-pw.js','sim-safety-visible-pw.js')){
        Invoke-Checked $nodeExe @((Join-Path $appRoot ('_sim\'+$scenario)))
    }
}
Write-Output 'Project validation: PASS'
