# Long-lived helper that streams the state of the Ctrl key to the pet (one line on stdout):
#   ctrl=1   a real Ctrl key is held down
#   ctrl=0   it is not
# A line is written whenever the state changes and at least once a second (the pet treats a silent helper as dead and restarts it).
# AltGr (Right Alt on many keyboards, for example Polish letters) is reported by Windows as Ctrl+Alt: it does not count as Ctrl.
# The helper ends by itself when the pet process is gone.
param([int]$PetPid = 0)

Add-Type @"
using System.Runtime.InteropServices;
public static class PetKeys {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@

function Test-Down([int]$vk) { return (([PetKeys]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) }

$last = ''
$lastWrite = [DateTime]::MinValue
$lastParentCheck = [DateTime]::UtcNow
while ($true) {
  $ctrl = (Test-Down 0xA2) -or (Test-Down 0xA3)
  if ($ctrl -and (Test-Down 0xA5)) { $ctrl = $false } # Left Ctrl + Right Alt is AltGr
  $line = if ($ctrl) { 'ctrl=1' } else { 'ctrl=0' }
  $now = [DateTime]::UtcNow
  if ($line -ne $last -or ($now - $lastWrite).TotalMilliseconds -ge 1000) {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $last = $line
    $lastWrite = $now
  }
  if ($PetPid -and ($now - $lastParentCheck).TotalSeconds -ge 3) {
    $lastParentCheck = $now
    if (-not (Get-Process -Id $PetPid -ErrorAction SilentlyContinue)) { exit }
  }
  Start-Sleep -Milliseconds 30
}
