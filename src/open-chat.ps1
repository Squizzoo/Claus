# Long-lived helper: tells the pet which chat is open in Claude Desktop.
# Reads one line from stdin per question and answers with one line on stdout:
#   chat=local_<uuid>   Claude Desktop is the foreground window and this chat is open
#   none                Claude Desktop is not in front, or no chat is open
# The id is the page address Claude Desktop exposes through Windows UI Automation. That turns on
# Chromium accessibility inside Claude Desktop (until it restarts); the first answers after a
# restart can be "none" while its accessibility tree is built.
param(
  [int]$ProcessId = 0   # testing only: treat this process as Claude Desktop
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PetFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@

$AE = [System.Windows.Automation.AutomationElement]
$rootWebArea = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'RootWebArea')
$isClaude = @{} # pid -> bool, so the process path is looked up once per process

function Test-ClaudeProcess([uint32]$id) {
  if ($isClaude.ContainsKey($id)) { return $isClaude[$id] }
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  $ok = [bool]$p -and ($(if ($ProcessId) { $p.Id -eq $ProcessId } else { $p.Path -like '*\WindowsApps\Claude_*\app\Claude.exe' }))
  $isClaude[$id] = $ok
  return $ok
}

function Get-OpenChat {
  $h = [PetFg]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { return 'none' }
  $fgPid = 0
  [void][PetFg]::GetWindowThreadProcessId($h, [ref]$fgPid)
  if (-not (Test-ClaudeProcess $fgPid)) { return 'none' }
  try {
    $root = $AE::FromHandle($h)
    $doc = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $rootWebArea)
    if (-not $doc) { return 'none' }
    $url = $doc.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
    if ($url -match '/(local_[0-9a-fA-F-]{8,64})(?:[/?#]|$)') { return "chat=$($Matches[1])" }
  } catch { }
  return 'none'
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  [Console]::Out.WriteLine((Get-OpenChat))
  [Console]::Out.Flush()
}
