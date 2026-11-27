# Long-lived helper: tells the pet about Claude Desktop and about the window the user is working in.
# Reads one line from stdin per question and answers with one line on stdout:
#   s  ->  claude=<path of Claude.exe>   Claude Desktop is running (the path carries its version)
#          claude=none                   it is not
#   f  ->  fg=<left>,<top>,<right>,<bottom>   the foreground window, in screen pixels
#          fg=none                       nothing usable (a desktop, the taskbar, or a window of the pet itself)
# Only the Desktop app counts: the Claude Code engines that also run as claude.exe live in a different folder.
param(
  [string]$PathLike = '*\WindowsApps\Claude_*\app\Claude.exe',
  [int]$PetPid = 0   # the pet's own process: its windows are never "the window the user works in"
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PetWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
}
"@
[void][PetWin]::SetProcessDPIAware() # rectangles in real pixels; the pet converts them to its own units

$skipClasses = @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'NotifyIconOverflowWindow', 'XamlExplorerHostIslandWindow')

function Get-ClaudePath {
  $p = Get-Process -Name claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -like $PathLike } | Select-Object -First 1
  if ($p) { return "claude=$($p.Path)" }
  return 'claude=none'
}

function Get-Foreground {
  $h = [PetWin]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero -or [PetWin]::IsIconic($h)) { return 'fg=none' }
  $owner = 0
  [void][PetWin]::GetWindowThreadProcessId($h, [ref]$owner)
  if ($PetPid -and $owner -eq $PetPid) { return 'fg=none' }
  $name = New-Object System.Text.StringBuilder 256
  [void][PetWin]::GetClassName($h, $name, 256)
  if ($skipClasses -contains $name.ToString()) { return 'fg=none' }
  $r = New-Object PetWin+RECT
  if (-not [PetWin]::GetWindowRect($h, [ref]$r)) { return 'fg=none' }
  return "fg=$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $answer = switch ($line.Trim()) {
    's' { Get-ClaudePath }
    'f' { Get-Foreground }
    default { 'unknown' }
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
