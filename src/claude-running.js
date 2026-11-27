'use strict';
// What the PowerShell helper (claude-running.ps1) can tell us: is Claude Desktop running (and which version),
// and which window is the user working in. Parsing is pure; the helper is only started when one of these is wanted.
const { createHelper } = require('./ps-helper');
const { parseVersion } = require('./jump-health');

/** `claude=<exe path>` -> { running: true, version }, `claude=none` -> { running: false, version: '' }, anything else -> null (no answer). */
function parseState(line) {
  const m = /^claude=(.+)$/.exec(String(line || '').trim());
  if (!m) return null;
  if (m[1] === 'none') return { running: false, version: '' };
  return { running: true, version: parseVersion(m[1]) };
}

/** `fg=l,t,r,b` -> { x, y, width, height } in screen pixels; `fg=none` or garbage -> null. */
function parseForeground(line) {
  const m = /^fg=(-?\d{1,6}),(-?\d{1,6}),(-?\d{1,6}),(-?\d{1,6})$/.exec(String(line || '').trim());
  if (!m) return null;
  const [l, t, r, b] = m.slice(1).map(Number);
  return r > l && b > t ? { x: l, y: t, width: r - l, height: b - t } : null;
}

/** `ctrl=1` -> true, `ctrl=0` -> false, anything else -> null (no answer). */
function parseCtrl(line) {
  const m = /^ctrl=([01])$/.exec(String(line || '').trim());
  return m ? m[1] === '1' : null;
}

function createClaudeWatcher({ petPid = process.pid } = {}) {
  const helper = createHelper('claude-running.ps1', { extraArgs: ['-PetPid', String(petPid)], timeoutMs: 6000 });
  return {
    /** { running, version } or null when the helper gave no usable answer. */
    state: async () => parseState(await helper.ask('s')),
    /** The foreground window's rectangle in screen pixels, or null. */
    foreground: async () => parseForeground(await helper.ask('f')),
    /** Is a Ctrl key held down right now (true/false), or null when the helper gave no usable answer. */
    ctrl: async () => parseCtrl(await helper.ask('c')),
    stop: helper.stop,
  };
}

module.exports = { createClaudeWatcher, parseState, parseForeground, parseCtrl };
