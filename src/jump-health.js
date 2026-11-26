'use strict';
// Self-check for the claude://code/continue route (see jump.js). Claude Desktop can change that undocumented route in an update.
// After a jump the pet looks at which chat the foreground Claude window shows; two misses in a row mean the route probably broke.
// Pure: main.js does the looking and keeps this state (settings.jumpHealth, numbers and short strings only).

const BROKEN_AFTER = 2; // misses in a row

const EMPTY = { failures: 0, lastOk: 0, okVersion: '', version: '' };

const VERSION_PATH = /\\Claude_([0-9][0-9.]*)_[^\\]*\\app\\Claude\.exe$/i;
const VERSION = /^[0-9][0-9.]{0,30}$/;

/** `6.28899.6.0` out of `...\WindowsApps\Claude_6.28899.6.0_x64__abc\app\Claude.exe`, or '' (the version is only read from a process path, never by listing WindowsApps). */
function parseVersion(exePath) {
  const m = VERSION_PATH.exec(String(exePath || ''));
  return m && VERSION.test(m[1]) ? m[1] : '';
}

/** Returns the state with every field valid; unknown keys are dropped. */
function sanitize(input) {
  const src = input && typeof input === 'object' ? input : {};
  const count = (v) => (Number.isInteger(v) && v >= 0 && v < 1000 ? v : 0);
  const ver = (v) => (typeof v === 'string' && (v === '' || VERSION.test(v)) ? v : '');
  return {
    failures: count(src.failures),
    lastOk: Number.isFinite(src.lastOk) && src.lastOk > 0 ? Math.round(src.lastOk) : 0,
    okVersion: ver(src.okVersion),
    version: ver(src.version),
  };
}

/** The Claude Desktop version that is running now (an empty string means "not known": nothing changes). */
function seenVersion(state, version) {
  const v = VERSION.test(String(version)) ? String(version) : '';
  return v && v !== state.version ? { ...state, version: v } : state;
}

/** Records the outcome of one jump. A success resets the miss counter and remembers which version worked. */
function record(state, { ok, now = Date.now() }) {
  if (ok) return { ...state, failures: 0, lastOk: now, okVersion: state.version || state.okVersion };
  return { ...state, failures: Math.min(state.failures + 1, 999) };
}

/**
 * `broken`: the last jumps missed; `unverified`: Claude was updated since the last jump that worked; `ok` otherwise
 * (also before any jump, since there is nothing to warn about yet).
 */
function status(state) {
  if (state.failures >= BROKEN_AFTER) return 'broken';
  if (state.okVersion && state.version && state.okVersion !== state.version) return 'unverified';
  return 'ok';
}

/**
 * Should this outcome of a jump count at all? Only a real answer that does not match counts as a miss.
 * `canRead` says the helper has already read a chat id from Claude at least once: right after Claude starts, its accessibility tree
 * is still being built and "none" is a normal answer, so a "none" before that proves nothing.
 */
function outcome({ focused, openHostId, wanted, canRead = true }) {
  if (openHostId === undefined) return null; // the helper was busy: no answer, no verdict
  if (openHostId === wanted) return { ok: true };
  if (!focused) return null; // Windows may simply have refused to raise the window
  if (openHostId === null && !canRead) return null; // cannot see inside Claude yet
  return { ok: false };
}

module.exports = { EMPTY, BROKEN_AFTER, parseVersion, sanitize, seenVersion, record, status, outcome };
