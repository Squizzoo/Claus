# Starts Claude Pet when Claude Desktop opens and stops it when Claude Desktop closes.
#
# It reacts to changes only, so the pet stays under your control:
#   Claude appears  -> start the pet (unless it is already running)
#   Claude is gone  -> stop the pet
# If you quit the pet from its tray menu while Claude stays open, it stays quit
# until the next time Claude opens.
#
# Only the desktop app counts. The Claude Code engines that also run as claude.exe
# live in a different folder and are ignored by the path filter.
param(
  [string]$ProcessName = 'claude',
  [string]$PathLike = '*\WindowsApps\Claude_*\app\Claude.exe',
  [int]$IntervalSec = 3,
  [int]$GoneAfterPolls = 2,   # polls in a row without Claude before the pet is stopped (rides out app restarts)
  [string]$PetDir = (Split-Path -Parent $PSScriptRoot),
  [string]$MutexName = 'Local\ClaudePetWatcher'
)

$created = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$created)
if (-not $created) { exit 0 }   # one watcher is enough

$electron = Join-Path $PetDir 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { exit 1 }

function Test-Target {
  [bool](Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like $PathLike } | Select-Object -First 1)
}
function Get-Pet {
  Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron }
}

$wasOpen = $false
$gone = 0
try {
  while ($true) {
    if (Test-Target) {
      $gone = 0
      if (-not $wasOpen) {
        $wasOpen = $true
        if (-not (Get-Pet)) {
          Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $PetDir
        }
      }
    } elseif ($wasOpen) {
      $gone++
      if ($gone -ge $GoneAfterPolls) {
        $wasOpen = $false
        Get-Pet | Stop-Process -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Seconds $IntervalSec
  }
} finally {
  $mutex.ReleaseMutex()
}
