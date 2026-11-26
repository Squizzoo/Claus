'use strict';
// Asks a small PowerShell helper which chat is open in Claude Desktop (Windows only).
// The helper stays alive between questions: starting PowerShell every second would be far too heavy.
// Only the Desktop session id (local_<uuid>) crosses this boundary; it is never logged in full.
const { spawn } = require('child_process');
const { helperScript } = require('./paths');

const ANSWER_TIMEOUT_MS = 4000;

/** One line from the helper -> the Desktop session id, or null for "none" and anything unexpected. */
function parseAnswer(line) {
  const m = /^chat=(local_[0-9A-Fa-f-]{8,64})$/.exec(String(line || '').trim());
  return m ? m[1] : null;
}

function createOpenChatWatcher() {
  let child = null;
  let buffer = '';
  let waiting = null; // { resolve, timer } for the question in flight

  const settle = (value) => {
    if (!waiting) return;
    clearTimeout(waiting.timer);
    const { resolve } = waiting;
    waiting = null;
    resolve(value);
  };

  function start() {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript('open-chat.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        settle(parseAnswer(line));
      }
    });
    const gone = () => {
      child = null;
      buffer = '';
      settle(null);
    };
    child.on('exit', gone);
    child.on('error', gone);
    child.stdin.on('error', () => {}); // the helper died between two questions
  }

  /** Resolves with the open chat's Desktop session id, null for none, or undefined when the helper is busy with another question. Never rejects. */
  function query() {
    if (process.platform !== 'win32') return Promise.resolve(null);
    if (waiting) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      try {
        if (!child) start();
        waiting = {
          resolve,
          timer: setTimeout(() => {
            // A stuck helper is killed; the next question starts a fresh one.
            try { child && child.kill(); } catch { /* already gone */ }
            child = null;
            buffer = '';
            settle(null);
          }, ANSWER_TIMEOUT_MS),
        };
        child.stdin.write('q\n');
      } catch {
        settle(null);
        resolve(null);
      }
    });
  }

  function stop() {
    try { child && child.kill(); } catch { /* already gone */ }
    child = null;
  }

  return { query, stop };
}

module.exports = { createOpenChatWatcher, parseAnswer };
