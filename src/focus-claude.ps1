# Brings the Claude Desktop window to the front (restoring it if minimised).
# Windows normally refuses to let a background program steal focus, so this
# attaches to the foreground thread's input queue first, the usual workaround.
# Prints "focused", "not-foreground" or "no-window". Exit code is always 0.
param([int]$WaitMs = 2500)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PetWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@

function Find-ClaudeWindow {
  Get-Process -Name claude -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -like '*\WindowsApps\Claude_*\app\Claude.exe' } |
    Select-Object -First 1
}

$deadline = (Get-Date).AddMilliseconds($WaitMs)
$proc = $null
do {
  $proc = Find-ClaudeWindow
  if ($proc) { break }
  Start-Sleep -Milliseconds 150
} while ((Get-Date) -lt $deadline)

if (-not $proc) { 'no-window'; exit 0 }

$h = [IntPtr]$proc.MainWindowHandle
if ([PetWin]::IsIconic($h)) { [void][PetWin]::ShowWindow($h, 9) }   # SW_RESTORE

$fg = [PetWin]::GetForegroundWindow()
$fgPid = 0
$fgThread = [PetWin]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$me = [PetWin]::GetCurrentThreadId()
$attached = $false
if ($fgThread -ne 0 -and $fgThread -ne $me) { $attached = [PetWin]::AttachThreadInput($me, $fgThread, $true) }
[PetWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)      # Alt down: lets SetForegroundWindow through
[void][PetWin]::BringWindowToTop($h)
[void][PetWin]::SetForegroundWindow($h)
[PetWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)      # Alt up
if ($attached) { [void][PetWin]::AttachThreadInput($me, $fgThread, $false) }

Start-Sleep -Milliseconds 80
if ([PetWin]::GetForegroundWindow() -eq $h) { 'focused' } else { 'not-foreground' }
