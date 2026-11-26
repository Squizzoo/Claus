'use strict';
// Raises a window above whatever covers it (Windows only).
const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'focus-claude.ps1');
const BASE = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT];

/** The helper's arguments for the window a process runs in (a terminal, VS Code), or null when `pid` is not a usable process id. */
function focusArgs(pid) {
  return Number.isInteger(pid) && pid > 0 && pid < 2 ** 31 ? [...BASE, '-FromPid', String(pid)] : null;
}

function run(args) {
  if (process.platform !== 'win32' || !args) return Promise.resolve(args ? 'unsupported' : 'invalid');
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 12_000 }, (err, stdout) => resolve(err ? 'error' : String(stdout).trim() || 'unknown'));
  });
}

/** Brings the Claude Desktop window forward. Resolves with focused, not-foreground, no-window, error or unsupported. */
function focusClaude() {
  return run(BASE);
}

/** Brings forward the window a chat's process runs in (its terminal or editor), found by walking up from the process. Same answers. */
function focusWindowOf(pid) {
  return run(focusArgs(pid));
}

module.exports = { focusClaude, focusWindowOf, focusArgs };
