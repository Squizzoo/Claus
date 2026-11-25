# Runs the Claude watcher (watch-claude.ps1) hidden at every Windows login.
#
#   .\scripts\autostart.ps1 status      show whether it is set up / running
#   .\scripts\autostart.ps1 install     add it to your Startup folder and start it now
#   .\scripts\autostart.ps1 uninstall   remove it and stop the watcher
param([Parameter(Position = 0)][ValidateSet('status', 'install', 'uninstall')][string]$Action = 'status')

$root = Split-Path -Parent $PSScriptRoot
$watcher = Join-Path $PSScriptRoot 'watch-claude.ps1'
$launcher = Join-Path ([Environment]::GetFolderPath('Startup')) 'ClaudePetWatcher.vbs'

function Get-Watcher {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*watch-claude.ps1*' }
}

switch ($Action) {
  'status' {
    "startup entry : $(if (Test-Path $launcher) { $launcher } else { 'not installed' })"
    "watcher       : $(if (Get-Watcher) { 'running' } else { 'not running' })"
  }
  'install' {
    # A .vbs window style of 0 runs PowerShell with no console window at all.
    $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """"$watcher"""""
    Set-Content -Path $launcher -Encoding ASCII -Value @(
      "' Starts the Clause watcher without a window. Remove with: scripts\autostart.ps1 uninstall",
      "CreateObject(""WScript.Shell"").Run ""$cmd"", 0, False"
    )
    if (-not (Get-Watcher)) { & wscript.exe $launcher }
    Start-Sleep -Seconds 1
    "installed: $launcher"
    "watcher  : $(if (Get-Watcher) { 'running' } else { 'not running' })"
  }
  'uninstall' {
    if (Test-Path $launcher) { Remove-Item $launcher -Force }
    Get-Watcher | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    "removed the startup entry and stopped the watcher (the pet itself keeps running if it is open)"
  }
}
