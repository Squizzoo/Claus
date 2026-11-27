'use strict';
// Streams whether Ctrl is held down, from ctrl-watch.ps1. Unlike the question-and-answer helpers this one pushes: a line on every change and
// a heartbeat each second, so a press is seen within about 30 ms and a dead or stuck helper is noticed and restarted.
// Parsing and the restart rules are pure; only start() touches a process. Windows only.
const { spawn } = require('child_process');
const { helperScript } = require('./paths');

const STALE_MS = 3000; // no line for this long: the helper is stuck
const STARTUP_MS = 15_000; // PowerShell and its Add-Type can take several seconds on a cold start: the first line gets this long
const HEALTHY_MS = 10_000; // a helper that lived this long was healthy: its end does not count towards the restart backoff
const MAX_BACKOFF_MS = 30_000;

/** `ctrl=1` -> true, `ctrl=0` -> false, anything else -> null. */
function parseCtrl(line) {
  const m = /^ctrl=([01])$/.exec(String(line || '').trim());
  return m ? m[1] === '1' : null;
}

/** No line for STALE_MS (and it has been started at all): the helper must be restarted. */
function isStale(lastLineAt, now, staleMs = STALE_MS) {
  return Boolean(lastLineAt) && now - lastLineAt >= staleMs;
}

/** Wait before the next restart: 0.5 s, 1 s, 2 s ... at most 30 s. */
function backoffMs(failures) {
  return Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.max(0, Math.min(failures, 10)));
}

/**
 * onChange(held) is called whenever the answer changes (and with false when the helper is lost, so a dead helper can never leave Ctrl "held").
 * check() is cheap: call it from a regular tick, it restarts a dead or stale helper when its backoff allows.
 */
function createCtrlWatcher({ onChange, petPid = process.pid, log = () => {} }) {
  let child = null;
  let held = false;
  let lastLineAt = 0;
  let startedAt = 0;
  let gotLine = false; // has this helper printed anything yet?
  let failures = 0;
  let nextStartAt = 0;
  let wanted = false;

  function set(value) {
    if (value === held) return;
    held = value;
    try { onChange(held); } catch { /* the listener must not kill the stream */ }
  }

  function kill() {
    const c = child;
    child = null;
    lastLineAt = 0;
    set(false);
    try { c && c.kill(); } catch { /* already gone */ }
  }

  function start() {
    if (child || process.platform !== 'win32') return;
    let buffer = '';
    const mine = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperScript('ctrl-watch.ps1'), '-PetPid', String(petPid)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    child = mine;
    startedAt = Date.now();
    lastLineAt = startedAt; // stale only counts from here
    gotLine = false;
    mine.stdout.setEncoding('utf8');
    mine.stdout.on('data', (chunk) => {
      if (child !== mine) return;
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const value = parseCtrl(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (value === null) continue;
        lastLineAt = Date.now();
        gotLine = true;
        set(value);
      }
    });
    const gone = () => {
      if (child !== mine) return; // killed on purpose
      log('ctrl helper ended');
      child = null;
      lastLineAt = 0;
      set(false);
      if (Date.now() - startedAt >= HEALTHY_MS) failures = 0; // it ran fine for a while: start over with a short wait
      failures += 1;
      nextStartAt = Date.now() + backoffMs(failures);
    };
    mine.on('exit', gone);
    mine.on('error', gone);
  }

  return {
    /** Start (or keep) the helper; stop it again with setWanted(false). */
    setWanted(value) {
      wanted = Boolean(value);
      if (!wanted) kill();
      else this.check();
    },
    check(now = Date.now()) {
      if (!wanted) return;
      if (child && isStale(lastLineAt, now, gotLine ? STALE_MS : STARTUP_MS)) {
        log('ctrl helper stale, restarting');
        if (gotLine && now - startedAt >= HEALTHY_MS) failures = 0;
        kill();
        failures += 1;
        nextStartAt = now + backoffMs(failures);
      }
      if (!child && now >= nextStartAt) start();
    },
    isHeld: () => held,
    stop: () => { wanted = false; kill(); },
  };
}

module.exports = { createCtrlWatcher, parseCtrl, isStale, backoffMs, STALE_MS, STARTUP_MS };
