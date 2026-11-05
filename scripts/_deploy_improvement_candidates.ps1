$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=(Get-Location).Path
$staged=Join-Path $root '.tools/qoe-three-site-stage/dist'
$live=Join-Path $root 'dist'
$backup=Join-Path $root '.tools/qoe-local-server/dist-before-improvement-candidates-20261104'
$failed=Join-Path $root '.tools/qoe-local-server/dist-failed-improvement-candidates-20261104'
$out=Join-Path $root '.tools/qoe-local-server/improvement-candidates-preview.out.log'
$err=Join-Path $root '.tools/qoe-local-server/improvement-candidates-preview.err.log'
foreach($file in @('server/index.js','client/qoe/_next/static/css','client/improvement-candidates/2026-10-26_2026-10-30.json','client/three-site-rough/2026-10-30.json','client/voice-1030.json')){
 if(!(Test-Path -LiteralPath (Join-Path $staged $file))){throw "Staged file missing $file"}
}
if(Test-Path $backup){throw 'Backup exists. No overwrite.'}
if(Test-Path $failed){throw 'Failed artifact path exists. No overwrite.'}
$listener=Get-NetTCPConnection -LocalPort 3014 -State Listen -ErrorAction Stop |
 Where-Object {$_.LocalAddress -eq '127.0.0.1'}|Select-Object -First 1
if(!$listener){throw 'No expected localhost preview listener'}
$oldPid=[int]$listener.OwningProcess
$owner=Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid"
if(!$owner -or $owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch 'serve-local-preview[.]cjs'){
 throw "Unexpected preview owner $oldPid"
}
Write-Output "VERIFIED_OLD_PID=$oldPid"
Stop-Process -Id $oldPid -Force
Start-Sleep -Milliseconds 750
Move-Item -LiteralPath $live -Destination $backup -ErrorAction Stop
try{
 Move-Item -LiteralPath $staged -Destination $live -ErrorAction Stop
 $new=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'scripts/serve-local-preview.cjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
 Write-Output "NEW_PID=$($new.Id)"
 $okay=$false
 for($i=0;$i -lt 40;$i++){
  Start-Sleep -Milliseconds 700
  try{
   $home=Invoke-WebRequest 'http://127.0.0.1:3001/qoe/' -UseBasicParsing -TimeoutSec 4
   $candidate=Invoke-WebRequest 'http://127.0.0.1:3001/qoe/improvement-candidates/2026-10-26_2026-10-30.json' -UseBasicParsing -TimeoutSec 4
   $data=$candidate.Content|ConvertFrom-Json
   $mainCss=[regex]::Match($home.Content,'href="(/qoe/_next/static/css/[^"]+[.]css)"')
   if(!$mainCss.Success){continue}
   $css=Invoke-WebRequest ('http://127.0.0.1:3001'+$mainCss.Groups[1].Value) -Method Head -UseBasicParsing -TimeoutSec 4
   $legacy=Invoke-WebRequest 'http://127.0.0.1:3001/qoe/?view=contract&date=2026-10-30' -UseBasicParsing -TimeoutSec 4
   if($home.StatusCode -eq 200 -and $candidate.StatusCode -eq 200 -and $css.StatusCode -eq 200 -and $legacy.StatusCode -eq 200 -and $data.summary.candidateCount -eq 5 -and $data.summary.mappedCandidates -eq 4){
    Write-Output 'HEALTH=QUALITY_200,CANDIDATES_200,CSS_200,CONTRACT_200,COUNT_5_MAP_4'
    $okay=$true;break
   }
  }catch{}
 }
 if(!$okay){throw 'New UI health checks failed'}
 Write-Output "DEPLOY_SUCCESS_BACKUP=$backup"
}catch{
 Write-Output "DEPLOY_CHECK_FAILED=$($_.Exception.Message)"
 $now=Get-NetTCPConnection -LocalPort 3014 -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalAddress -eq '127.0.0.1'}|Select-Object -First 1
 if($now){
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId = $($now.OwningProcess)"
  if($proc -and $proc.CommandLine -match 'serve-local-preview[.]cjs'){
    Stop-Process -Id $now.OwningProcess -Force -ErrorAction SilentlyContinue
  }
 }
 if(Test-Path $backup){
  if(Test-Path $live){Move-Item -LiteralPath $live -Destination $failed -ErrorAction SilentlyContinue}
  Move-Item -LiteralPath $backup -Destination $live -ErrorAction Stop
  $restore=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'scripts/serve-local-preview.cjs' -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  Write-Output "ROLLBACK_STARTED_PID=$($restore.Id)"
 }
 throw
}
