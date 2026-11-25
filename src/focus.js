'use strict';
// Raises the Claude Desktop window above whatever covers it (Windows only).
const { execFile } = require('child_process');
const path = require('path');

function focusClaude() {
  if (process.platform !== 'win32') return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'focus-claude.ps1')],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => resolve(err ? 'error' : String(stdout).trim() || 'unknown')
    );
  });
}

module.exports = { focusClaude };
