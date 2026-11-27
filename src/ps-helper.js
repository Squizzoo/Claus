'use strict';
// A long-lived PowerShell helper that answers one line per question (Windows only).
// Starting PowerShell for every question would be far too heavy, so the helper stays alive; it is started on the first
// question and restarted if it dies or hangs. Questions are answered one after the other, in order.
const { spawn } = require('child_process');
const { helperScript } = require('./paths');

/**
 * `script` is a file name next to the sources; `extraArgs` go after -File <script>.
 * ask(line) resolves with the helper's answer line (trimmed), or null when it died, hung or this is not Windows. Never rejects.
 */
function createHelper(script, { extraArgs = [], timeoutMs = 4000, idleMs = 60_000 } = {}) {
  let child = null;
  let buffer = '';
  let current = null; // { resolve, timer } for the question in flight
  let idleTimer = null;
  let chain = Promise.resolve();

  const settle = (value) => {
    if (!current) return;
    clearTimeout(current.timer);
    const { resolve } = current;
    current = null;
    resolve(value);
    // a helper nobody asks for stops, so a PowerShell process is not left running for the rare question
    clearTimeout(idleTimer);
    if (idleMs > 0) {
      idleTimer = setTimeout(reset, idleMs);
      if (idleTimer.unref) idleTimer.unref();
    }
  };
  function reset() {
    clearTimeout(idleTimer);
    try { child && child.kill(); } catch { /* already gone */ }
    child = null;
    buffer = '';
  }

  function start() {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript(script), ...extraArgs],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const mine = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (child !== mine) return; // a late line of a helper that was killed must not answer the next question
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        settle(line);
      }
    });
    const gone = () => {
      if (child !== mine) return; // an old helper that was killed on purpose: it must not answer a newer question
      child = null;
      buffer = '';
      settle(null);
    };
    child.on('exit', gone);
    child.on('error', gone);
    child.stdin.on('error', () => {}); // the helper died between two questions
  }

  function once(line) {
    return new Promise((resolve) => {
      try {
        clearTimeout(idleTimer);
        if (!child) start();
        current = {
          resolve,
          timer: setTimeout(() => {
            reset(); // a stuck helper is killed; the next question starts a fresh one
            settle(null);
          }, timeoutMs),
        };
        child.stdin.write(`${line}\n`);
      } catch {
        settle(null);
        resolve(null);
      }
    });
  }

  function ask(line) {
    if (process.platform !== 'win32') return Promise.resolve(null);
    const result = chain.then(() => once(String(line).replace(/[\r\n]/g, '')));
    chain = result.catch(() => {});
    return result;
  }

  return { ask, stop: reset };
}

module.exports = { createHelper };
