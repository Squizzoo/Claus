# Brings the Claude Desktop window to the front (restoring it if minimised).
# Windows normally refuses to let a background program steal focus, so this
# attaches to the foreground thread's input queue first, the usual workaround.
# Prints "focused", "not-foreground" or "no-window". Exit code is always 0.
#
# With -FromPid it raises the window a chat runs in instead (a terminal, VS Code): it walks up the parent processes of
# that pid to the first one that owns a window. The walk stops at explorer.exe (a terminal opened through the default
# terminal hand-off has no such ancestor and must not raise a File Explorer window), and at a parent that started later
# than its child (its real parent is gone and the pid was reused).
param(
  [int]$WaitMs = 2500,
  [int]$ProcessId = 0,  # testing only: raise the window of this process instead of Claude's
  [int]$FromPid = 0
)
if ($FromPid) { $WaitMs = 0 }   # one look is enough: the window of a running chat is already there

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

function Find-AncestorWindow([int]$start) {
  $all = @{}
  foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) { $all[[int]$p.ProcessId] = $p }
  $cur = $all[$start]
  for ($depth = 0; $cur -and $depth -lt 12; $depth++) {
    $parent = $all[[int]$cur.ParentProcessId]
    if (-not $parent) { return $null }
    if ($parent.Name -ieq 'explorer.exe') { return $null }
    if ($parent.CreationDate -and $cur.CreationDate -and $parent.CreationDate -ge $cur.CreationDate) { return $null }
    $proc = Get-Process -Id ([int]$parent.ProcessId) -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne 0) { return $proc }
    $cur = $parent
  }
  return $null
}

function Find-ClaudeWindow {
  if ($FromPid) { return Find-AncestorWindow $FromPid }
  if ($ProcessId) { return Get-Process -Id $ProcessId -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } }
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
[void][PetWin]::BringWindowToTop($h)
[void][PetWin]::SetForegroundWindow($h)
if ($attached) { [void][PetWin]::AttachThreadInput($me, $fgThread, $false) }

Start-Sleep -Milliseconds 80
if ([PetWin]::GetForegroundWindow() -eq $h) { 'focused' } else { 'not-foreground' }
