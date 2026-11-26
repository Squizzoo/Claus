# Long-lived helper: tells the pet which Chat tab conversations Claude Desktop shows and whether Claude is answering in them.
# Reads one line from stdin per question and answers with one line on stdout:
#   c  ->  chats=<id>:<w|i>:<f|b>[,...]   w = a reply is streaming (the "Stop response" button exists), i = idle ("Send message")
#                                         f = that window is the foreground window, b = it is not (or it is minimised)
#          chats=                          no Chat tab conversation is on screen
# Only the conversation a window currently shows can be seen: another tab (Code, Cowork) replaces the page in the accessibility tree.
# Privacy: only the page address (the conversation id) and the existence of one button are looked at. No message text is read.
param(
  [string]$PathLike = '*\WindowsApps\Claude_*\app\Claude.exe',
  [int]$ProcessId = 0   # testing only: treat this process as Claude Desktop
)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PetChatFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$rootWebArea = New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'RootWebArea')
$stopButton = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
  (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'Stop response'))
)
$pidCache = @{ at = [DateTime]::MinValue; ids = @() }

function Get-ClaudePids {
  if (([DateTime]::UtcNow - $pidCache.at).TotalSeconds -lt 5) { return $pidCache.ids }
  $ids = @()
  foreach ($p in (Get-Process -Name claude -ErrorAction SilentlyContinue)) {
    if ($ProcessId) { if ($p.Id -eq $ProcessId) { $ids += $p.Id } }
    elseif ($p.Path -like $PathLike) { $ids += $p.Id }
  }
  $pidCache.at = [DateTime]::UtcNow
  $pidCache.ids = $ids
  return $ids
}

function Get-Chats {
  $ids = @(Get-ClaudePids)
  if ($ids.Count -eq 0) { return 'chats=' }
  $conds = @($ids | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$_) })
  $cond = if ($conds.Count -eq 1) { $conds[0] } else { New-Object System.Windows.Automation.OrCondition([System.Windows.Automation.Condition[]]$conds) }
  $fg = [PetChatFg]::GetForegroundWindow().ToInt64()
  $found = @{}   # id -> 'w'/'i' and 'f'/'b'; the same conversation in two windows is one chat
  foreach ($w in $AE::RootElement.FindAll($TS::Children, $cond)) {
    $minimised = $false
    try { $minimised = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Current.WindowVisualState -eq 'Minimized' } catch { }
    $front = (-not $minimised) -and ([int64]$w.Current.NativeWindowHandle -eq $fg)
    foreach ($doc in $w.FindAll($TS::Descendants, $rootWebArea)) {
      try {
        $url = $doc.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
        if ($url -notmatch '^https://claude\.ai/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[/?#]|$)') { continue }
        $id = $Matches[1].ToLower()
        $working = $null -ne $doc.FindFirst($TS::Descendants, $stopButton)
        $prev = $found[$id]
        $found[$id] = @{ w = ($working -or ($prev -and $prev.w)); f = ($front -or ($prev -and $prev.f)) }
      } catch { }
    }
  }
  $parts = foreach ($id in $found.Keys) { '{0}:{1}:{2}' -f $id, $(if ($found[$id].w) { 'w' } else { 'i' }), $(if ($found[$id].f) { 'f' } else { 'b' }) }
  return 'chats=' + (@($parts) -join ',')
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $answer = switch ($line.Trim()) {
    'c' { try { Get-Chats } catch { 'unknown' } }
    default { 'unknown' }
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
