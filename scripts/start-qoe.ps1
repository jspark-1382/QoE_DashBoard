param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$url = 'http://localhost:3001/qoe/overview-proposal-4'
$previewScript = Join-Path $PSScriptRoot 'serve-local-preview.cjs'
$forwardScript = Join-Path $PSScriptRoot 'qoe-local-forwarder.cjs'
$runtime = Join-Path $root '.tools\qoe-local-server'
$legacyStatus = $null
$mutex = $null
$locked = $false

function Get-Listeners([int]$Port) {
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Assert-OurListeners([int]$Port, [string]$ScriptPath, [string]$LegacyScript, [int]$LegacyPid) {
    $listeners = @(Get-Listeners $Port)
    foreach ($listener in $listeners) {
        if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
            throw "Port $Port has a non-local listener. Close that service yourself, then try again."
        }
        $owner = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $listener.OwningProcess)
        $command = if ($owner) { ([string]$owner.CommandLine).Replace('/', '\') } else { '' }
        $absolutePattern = '(?i)(?:^|\s)"?' + [regex]::Escape($ScriptPath) + '"?(?:\s|$)'
        $legacyPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($LegacyScript) + '"?(?:\s|$)'
        $matchesAbsolute = $command -match $absolutePattern
        $matchesLegacy = $LegacyPid -eq $listener.OwningProcess -and $command -match $legacyPattern
        if (!$owner -or $owner.Name -ne 'node.exe' -or !($matchesAbsolute -or $matchesLegacy)) {
            throw "Port $Port is used by another process (PID $($listener.OwningProcess)). Nothing was stopped. Close it yourself, then try again."
        }
    }
    return $listeners
}

function Wait-Ready([string]$Address, $StartedProcess, [string]$LogPath) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 60) {
        if ($StartedProcess) {
            $StartedProcess.Refresh()
            if ($StartedProcess.HasExited) {
                throw "The local service exited. See $LogPath"
            }
        }
        try {
            $response = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return }
        } catch {
            # A service can take a moment to bind its port and load the built page.
        }
        Start-Sleep -Milliseconds 500
    }
    throw "The local page did not become ready within 60 seconds. See $LogPath"
}

function Start-LocalService([string]$ScriptPath, [string]$Name) {
    $stdout = Join-Path $runtime ($Name + '.out.log')
    $stderr = Join-Path $runtime ($Name + '.err.log')
    Start-Process -FilePath $node.Source -ArgumentList ('"' + $ScriptPath + '"') `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

try {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (!$node) {
        throw 'Node.js was not found. Install Node.js 22.13 or newer, reopen this folder, and try again.'
    }
    $nodeVersion = (& $node.Source --version).Trim().TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.13.0') {
        throw 'Node.js 22.13 or newer is required. Update Node.js and try again.'
    }
    $required = @(
        (Join-Path $root 'dist\server\index.js'),
        (Join-Path $root 'dist\client\qoe\_next\static'),
        (Join-Path $root 'node_modules\vinext\dist\server\prod-server.js'),
        $previewScript,
        $forwardScript
    )
    foreach ($item in $required) {
        if (!(Test-Path -LiteralPath $item)) {
            throw "A required built file is missing: $item`nRestore the prepared project/build before launching. This launcher does not rebuild or regenerate data."
        }
    }

    # Serialize double-clicks for this folder without preventing another copy from launching.
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-', '')
    } finally { $sha.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\QoE-Launcher-' + $key))
    try { $locked = $mutex.WaitOne(90000) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Another QoE launch is still in progress. Wait a moment and try again.' }

    $statusPath = Join-Path $runtime 'status.json'
    if (Test-Path -LiteralPath $statusPath) {
        try { $legacyStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $legacyStatus = $null }
    }
    $upstreamPid = if ($legacyStatus) { [int]$legacyStatus.upstreamPid } else { 0 }
    $forwardPid = if ($legacyStatus) { [int]$legacyStatus.pid } else { 0 }

    # Inspect both ports before starting anything; never stop an existing port owner.
    $previewListeners = @(Assert-OurListeners 3014 $previewScript 'scripts\serve-local-preview.cjs' $upstreamPid)
    $forwardListeners = @(Assert-OurListeners 3001 $forwardScript '.tools\qoe-local-server\forward-preview.cjs' $forwardPid)
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null

    $previewProcess = $null
    if ($previewListeners.Count -eq 0) {
        Write-Host 'Starting the prepared QoE dashboard...'
        $previewProcess = Start-LocalService $previewScript 'preview'
    }
    Wait-Ready 'http://127.0.0.1:3014/qoe/overview-proposal-4' $previewProcess (Join-Path $runtime 'preview.err.log')

    $forwardProcess = $null
    if ($forwardListeners.Count -eq 0) {
        $forwardProcess = Start-LocalService $forwardScript 'forwarder'
    }
    Wait-Ready 'http://127.0.0.1:3001/qoe/overview-proposal-4' $forwardProcess (Join-Path $runtime 'forwarder.err.log')
    Wait-Ready 'http://[::1]:3001/qoe/overview-proposal-4' $forwardProcess (Join-Path $runtime 'forwarder.err.log')
    $previewListeners = @(Assert-OurListeners 3014 $previewScript 'scripts\serve-local-preview.cjs' $upstreamPid)
    $forwardListeners = @(Assert-OurListeners 3001 $forwardScript '.tools\qoe-local-server\forward-preview.cjs' $forwardPid)
    if ($previewListeners.Count -ne 1 -or $previewListeners[0].LocalAddress -ne '127.0.0.1' -or
        $forwardListeners.Count -ne 2 -or @($forwardListeners | Select-Object -ExpandProperty OwningProcess -Unique).Count -ne 1) {
        throw 'The local service listeners are incomplete. Check the logs in .tools\qoe-local-server.'
    }
    Write-Host "QoE is ready: $url"
    if (!$NoBrowser) { Start-Process $url }
} catch {
    [Console]::Error.WriteLine('QoE could not start: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
