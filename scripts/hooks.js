'use strict';
// Adds / removes the pet's hooks in ~/.claude/settings.json (the logic lives in src/hooks-install.js).
//
//   node scripts/hooks.js status              what is installed now (read only)
//   node scripts/hooks.js install             dry run: shows the change, writes nothing
//   node scripts/hooks.js install --apply     backs the file up, then writes
//   node scripts/hooks.js uninstall [--apply] removes only the pet's entries
//
// Existing hooks (tokensave, rtk, ...) are never touched. A pet entry is any
// hook whose url points at http://127.0.0.1:<port>/hook.

const hooks = require('../src/hooks-install');

const port = Number(process.env.CLAUDE_PET_PORT) || hooks.DEFAULT_PORT;
const file = hooks.defaultFile();

function main() {
  const [cmd = 'status', ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');

  if (cmd === 'status') {
    const s = hooks.status({ file, port });
    if (!s.exists) {
      console.error(`${file}: ${s.error}`);
      process.exit(1);
    }
    console.log(`${file}\n${s.installed ? `pet hooks installed (${s.installed} entries)` : 'pet hooks NOT installed'}`);
    for (const e of s.events) console.log(`  ${e.event}: ${e.total} hook(s)${e.mine ? `, ${e.mine} from the pet` : ''}`);
    return;
  }
  if (cmd !== 'install' && cmd !== 'uninstall') {
    console.error('usage: hooks.js status | install [--apply] | uninstall [--apply]');
    process.exit(2);
  }

  const p = hooks.plan({ action: cmd, file, port });
  console.log(`${cmd}: ${file}`);
  console.log(`  pet entries: ${p.petEntriesBefore} -> ${p.petEntriesAfter}`);
  console.log(`  hook events: ${p.eventsBefore.length} -> ${p.eventsAfter.length}  [${p.eventsAfter.join(', ')}]`);
  if (!apply) {
    console.log('  dry run, nothing written. Add --apply to write.');
    return;
  }
  const r = hooks.apply(p);
  console.log(r.written ? `  written. backup: ${r.backup}` : '  already up to date.');
}

main();
