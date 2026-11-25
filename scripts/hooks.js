'use strict';
// Adds / removes the pet's hooks in ~/.claude/settings.json.
//
//   node scripts/hooks.js status              what is installed now (read only)
//   node scripts/hooks.js install             dry run: shows the change, writes nothing
//   node scripts/hooks.js install --apply     backs the file up, then writes
//   node scripts/hooks.js uninstall [--apply] removes only the pet's entries
//
// Existing hooks (tokensave, rtk, ...) are never touched. A pet entry is any
// hook whose url points at http://127.0.0.1:<port>/hook.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLAUDE_PET_PORT) || 47821;
const URL_ = `http://127.0.0.1:${PORT}/hook`;
const FILE = process.env.CLAUDE_SETTINGS_FILE || path.join(os.homedir(), '.claude', 'settings.json');

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

const entry = () => ({ type: 'http', url: URL_, timeout: 3 });
const isPet = (h) => h && h.type === 'http' && typeof h.url === 'string' && h.url === URL_;

function load() {
  const text = fs.readFileSync(FILE, 'utf8');
  return { text, json: JSON.parse(text) };
}

function withoutPet(json) {
  const out = structuredClone(json);
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = out.hooks[ev]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isPet(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (out.hooks[ev].length === 0) delete out.hooks[ev];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

function withPet(json) {
  const out = withoutPet(json); // idempotent: re-install never duplicates
  out.hooks = out.hooks || {};
  for (const [ev, matcher] of Object.entries(EVENTS)) {
    const group = { ...(matcher ? { matcher } : {}), hooks: [entry()] };
    out.hooks[ev] = [...(out.hooks[ev] || []), group];
  }
  return out;
}

const countPet = (json) =>
  Object.values(json.hooks || {}).reduce((n, groups) => n + groups.reduce((m, g) => m + (g.hooks || []).filter(isPet).length, 0), 0);

function indentOf(text) {
  const m = /^\{\r?\n([ \t]+)"/.exec(text);
  return m ? m[1] : 2;
}

function main() {
  const [cmd = 'status', ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');
  const { text, json } = load();

  if (cmd === 'status') {
    const n = countPet(json);
    console.log(`${FILE}\n${n ? `pet hooks installed (${n} entries)` : 'pet hooks NOT installed'}`);
    for (const ev of Object.keys(json.hooks || {})) {
      const total = json.hooks[ev].reduce((m, g) => m + (g.hooks || []).length, 0);
      const mine = json.hooks[ev].reduce((m, g) => m + (g.hooks || []).filter(isPet).length, 0);
      console.log(`  ${ev}: ${total} hook(s)${mine ? `, ${mine} from the pet` : ''}`);
    }
    return;
  }
  if (cmd !== 'install' && cmd !== 'uninstall') {
    console.error('usage: hooks.js status | install [--apply] | uninstall [--apply]');
    process.exit(2);
  }

  const next = cmd === 'install' ? withPet(json) : withoutPet(json);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(next, null, indentOf(text)).replace(/\n/g, eol) + (/\r?\n$/.test(text) ? eol : '');

  const before = Object.keys(json.hooks || {});
  const after = Object.keys(next.hooks || {});
  console.log(`${cmd}: ${FILE}`);
  console.log(`  pet entries: ${countPet(json)} -> ${countPet(next)}`);
  console.log(`  hook events: ${before.length} -> ${after.length}  [${after.join(', ')}]`);
  // Sanity: everything outside "hooks" must be byte-for-byte the same data.
  const strip = (j) => { const c = structuredClone(j); delete c.hooks; return JSON.stringify(c); };
  if (strip(json) !== strip(next)) throw new Error('refusing: non-hook settings would change');

  if (!apply) {
    console.log('  dry run, nothing written. Add --apply to write.');
    return;
  }
  if (body === text) {
    console.log('  already up to date.');
    return;
  }
  const bak = `${FILE}.pet-bak`;
  fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, body);
  JSON.parse(fs.readFileSync(FILE, 'utf8')); // must still be valid JSON
  console.log(`  written. backup: ${bak}`);
}

main();
