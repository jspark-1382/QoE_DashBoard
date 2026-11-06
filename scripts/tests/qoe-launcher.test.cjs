/* eslint-disable @typescript-eslint/no-require-imports -- Windows launcher integration. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
test('service launch uses a hidden Windows broker and returns its reported node PID',{skip:process.platform!=='win32'},()=>{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'qoe-launcher-'));
 try{
  const probe=String.raw`
$ErrorActionPreference='Stop'
$root=$env:QOE_TEST_ROOT
$runtime=$env:QOE_TEST_RUNTIME
$node=Get-Command node.exe
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/start-qoe.ps1'),[ref]$tokens,[ref]$errors)
$functionAst=$ast.Find({param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] -and $part.Name -eq 'Start-LocalService'},$true)
Invoke-Expression $functionAst.Extent.Text
function Start-Process {throw 'Direct child launch is tied to the caller lifetime'}
function Invoke-CimMethod {
 param($ClassName,$MethodName,$Arguments)
 if($ClassName -ne 'Win32_Process' -or $MethodName -ne 'Create'){throw 'Wrong broker'}
 if($Arguments.ProcessStartupInformation.ShowWindow -ne 0){throw 'Worker must be hidden'}
 if($Arguments.CommandLine -notmatch '-RequestId "([a-f0-9]{32})"'){throw 'Missing launch identity'}
 $request=$Matches[1]
 if($Arguments.CommandLine -notmatch '-Service "preview"'){throw 'Wrong service argument'}
 $result=Join-Path $runtime ('preview.'+$request+'.started.json')
 [IO.File]::WriteAllText($result,(@{pid=$PID;requestId=$request}|ConvertTo-Json))
 return @{ReturnValue=0;ProcessId=$PID}
}
$process=Start-LocalService (Join-Path $root 'scripts/serve-local-preview.cjs') 'preview'
if($process.Id -ne $PID){throw 'Wrong reported child PID'}
Write-Output 'BROKER_TEST_OK'
`;
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',probe],{
   env:{...process.env,QOE_TEST_ROOT:root,QOE_TEST_RUNTIME:runtime},encoding:'utf8',timeout:30000,
  });
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/BROKER_TEST_OK/);
 }finally{fs.rmSync(runtime,{recursive:true,force:true});}
});
test('node remains alive after the launch caller and Windows helper exit',{skip:process.platform!=='win32',timeout:45000},()=>{
 const fixtureParent=path.join(root,'outputs');
 fs.mkdirSync(fixtureParent,{recursive:true});
 const fixture=fs.mkdtempSync(path.join(fixtureParent,'qoe-lifecycle-'));
 let childPid=0;
 try{
  fs.mkdirSync(path.join(fixture,'scripts'));
  fs.mkdirSync(path.join(fixture,'.tools','qoe-local-server'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/start-qoe-service.ps1'),path.join(fixture,'scripts/start-qoe-service.ps1'));
  fs.writeFileSync(path.join(fixture,'scripts/serve-local-preview.cjs'),"console.log('QOE_LIFECYCLE_READY');setInterval(()=>{},1000);\n");
  const probe=String.raw`
$ErrorActionPreference='Stop'
$root=$env:QOE_TEST_FIXTURE
$runtime=Join-Path $root '.tools/qoe-local-server'
$node=Get-Command node.exe
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $env:QOE_TEST_ROOT 'scripts/start-qoe.ps1'),[ref]$tokens,[ref]$errors)
$functionAst=$ast.Find({param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] -and $part.Name -eq 'Start-LocalService'},$true)
Invoke-Expression $functionAst.Extent.Text
$child=Start-LocalService (Join-Path $root 'scripts/serve-local-preview.cjs') 'preview'
$owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$child.Id)
$parent=Get-Process -Id $owner.ParentProcessId -ErrorAction SilentlyContinue
if($parent){$null=$parent.WaitForExit(5000)}
@{childPid=$child.Id;brokerPid=$owner.ParentProcessId;brokerExited=!(Get-Process -Id $owner.ParentProcessId -ErrorAction SilentlyContinue)}|ConvertTo-Json -Compress
`;
  const env={...process.env,QOE_TEST_ROOT:root,QOE_TEST_FIXTURE:fixture};
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',probe],{env,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const state=JSON.parse(result.stdout.trim());childPid=state.childPid;
  assert.equal(state.brokerExited,true,'Windows helper must have exited');
  assert.doesNotThrow(()=>process.kill(childPid,0),'node must outlive the launch caller');
  assert.match(fs.readFileSync(path.join(fixture,'.tools/qoe-local-server/preview.out.log'),'utf8'),/QOE_LIFECYCLE_READY/);
 }finally{
  // The PID is verified against the unique fixture path before stopping it.
  const stop=String.raw`
$fixture=$env:QOE_TEST_FIXTURE
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($fixture)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}
`;
  const cleanup=spawnSync('powershell.exe',['-NoProfile','-Command',stop],{env:{...process.env,QOE_TEST_FIXTURE:fixture},encoding:'utf8',timeout:15000});
  assert.equal(cleanup.status,0,cleanup.stderr);
  assert.equal(path.dirname(fixture),fixtureParent);
  fs.rmSync(fixture,{recursive:true,force:true});
 }
});
