'use strict';
// Adds / removes the pet's hooks in ~/.claude/settings.json. Used by the first-run dialog, the settings window and scripts/hooks.js.
//
// Existing hooks (tokensave, rtk, ...) are never touched. A pet entry is any hook whose url is http://127.0.0.1:<port>/hook.
// Nothing is written without apply: plan() only describes the change. A backup (settings.json.pet-bak) is made before every write.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = 47821;

// event -> optional matcher
const EVENTS = {
  UserPromptSubmit: undefined,
  PreToolUse: 'AskUserQuestion', // only the "Claude asks you" tool, not every call
  PermissionRequest: undefined,
  PostToolUse: undefined, // clears approval/question once you answered and the tool ran
  Stop: undefined,
  StopFailure: undefined,
  Notification: undefined,
  SessionEnd: undefined,
};

const defaultFile = () => process.env.CLAUDE_SETTINGS_FILE || path.join(os.homedir(), '.claude', 'settings.json');
const hookUrl = (port) => `http://127.0.0.1:${port}/hook`;

const entry = (port) => ({ type: 'http', url: hookUrl(port), timeout: 3 });
const isPet = (h, port) => Boolean(h) && h.type === 'http' && typeof h.url === 'string' && h.url === hookUrl(port);

function load(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { text, json: JSON.parse(text) };
}

function withoutPet(json, port) {
  const out = structuredClone(json);
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = out.hooks[ev]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isPet(h, port)) }))
      .filter((g) => g.hooks.length > 0);
    if (out.hooks[ev].length === 0) delete out.hooks[ev];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

function withPet(json, port) {
  const out = withoutPet(json, port); // idempotent: re-install never duplicates
  out.hooks = out.hooks || {};
  for (const [ev, matcher] of Object.entries(EVENTS)) {
    const group = { ...(matcher ? { matcher } : {}), hooks: [entry(port)] };
    out.hooks[ev] = [...(out.hooks[ev] || []), group];
  }
  return out;
}

const countPet = (json, port) =>
  Object.values(json.hooks || {}).reduce((n, groups) => n + groups.reduce((m, g) => m + (g.hooks || []).filter((h) => isPet(h, port)).length, 0), 0);

function indentOf(text) {
  const m = /^\{\r?\n([ \t]+)"/.exec(text);
  return m ? m[1] : 2;
}

/** What is installed now (read only). Never throws: a missing or unreadable file is `{ exists: false }`. */
function status({ file = defaultFile(), port = DEFAULT_PORT } = {}) {
  try {
    const { json } = load(file);
    const events = Object.keys(json.hooks || {}).map((ev) => ({
      event: ev,
      total: json.hooks[ev].reduce((m, g) => m + (g.hooks || []).length, 0),
      mine: json.hooks[ev].reduce((m, g) => m + (g.hooks || []).filter((h) => isPet(h, port)).length, 0),
    }));
    const installed = countPet(json, port);
    return { file, exists: true, installed, complete: installed === Object.keys(EVENTS).length, events };
  } catch (err) {
    // `missing`: there is no settings file yet but Claude Code's folder exists, so the file can simply be created
    const missing = err.code === 'ENOENT' && fs.existsSync(path.dirname(file));
    return { file, exists: false, missing, installed: 0, complete: false, events: [], error: err.code === 'ENOENT' ? 'not found' : 'unreadable' };
  }
}

/** The file's text and data; a file that does not exist yet reads as an empty settings object (`missing: true`). Other errors throw. */
function loadOrEmpty(file) {
  try {
    return { ...load(file), missing: false };
  } catch (err) {
    if (err.code === 'ENOENT' && fs.existsSync(path.dirname(file))) return { text: '', json: {}, missing: true };
    throw err;
  }
}

/**
 * Describes `install` or `uninstall` without writing anything. Throws when the file cannot be read or when the change
 * would touch anything outside "hooks".
 */
function plan({ action, file = defaultFile(), port = DEFAULT_PORT }) {
  if (action !== 'install' && action !== 'uninstall') throw new Error('action must be install or uninstall');
  const { text, json, missing } = loadOrEmpty(file);
  const next = action === 'install' ? withPet(json, port) : withoutPet(json, port);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(next, null, indentOf(text)).replace(/\n/g, eol) + (missing || /\r?\n$/.test(text) ? eol : '');
  // Sanity: everything outside "hooks" must be the same data.
  const strip = (j) => { const c = structuredClone(j); delete c.hooks; return JSON.stringify(c); };
  if (strip(json) !== strip(next)) throw new Error('refusing: non-hook settings would change');
  return {
    action,
    file,
    port,
    body,
    missing,
    changed: missing ? action === 'install' : body !== text, // removing hooks from a file that does not exist changes nothing
    petEntriesBefore: countPet(json, port),
    petEntriesAfter: countPet(next, port),
    eventsBefore: Object.keys(json.hooks || {}),
    eventsAfter: Object.keys(next.hooks || {}),
    petEvents: Object.keys(EVENTS),
  };
}

/** Writes a planned change: backup first, then the file, which must still parse. Returns { written, backup }. */
function apply(p) {
  if (!p.changed) return { written: false, backup: null };
  if (p.missing) {
    fs.writeFileSync(p.file, p.body); // a new file: nothing to back up
    JSON.parse(fs.readFileSync(p.file, 'utf8'));
    return { written: true, backup: null };
  }
  const backup = `${p.file}.pet-bak`;
  fs.copyFileSync(p.file, backup);
  fs.writeFileSync(p.file, p.body);
  JSON.parse(fs.readFileSync(p.file, 'utf8')); // must still be valid JSON
  return { written: true, backup };
}

module.exports = { EVENTS, DEFAULT_PORT, defaultFile, hookUrl, status, plan, apply, withPet, withoutPet, countPet };
