param(
    [Parameter(Mandatory = $true)][ValidateSet('preview', 'forwarder')][string]$Service,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{32}$')][string]$RequestId,
    [Parameter(Mandatory = $true)][string]$NodePath
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $root '.tools\qoe-local-server'
$resultPath = Join-Path $runtime ($Service + '.' + $RequestId + '.started.json')
$temporary = $resultPath + '.tmp'
$utf8 = New-Object Text.UTF8Encoding($false)
$scriptName = if ($Service -eq 'preview') { 'serve-local-preview.cjs' } else { 'qoe-local-forwarder.cjs' }

# Windows starts this short-lived helper, independently of the invoking terminal.
# Keep the normal node command line, ownership checks, and redirected log files.
try {
    $child = Start-Process -FilePath $NodePath `
        -ArgumentList ('"' + (Join-Path $PSScriptRoot $scriptName) + '"') `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtime ($Service + '.out.log')) `
        -RedirectStandardError (Join-Path $runtime ($Service + '.err.log'))
    $result = @{ pid = $child.Id; requestId = $RequestId }
} catch {
    $result = @{ error = $_.Exception.Message; requestId = $RequestId }
}
[IO.File]::WriteAllText($temporary, ($result | ConvertTo-Json -Compress), $utf8)
[IO.File]::Move($temporary, $resultPath)
if ($result.error) { exit 1 }
