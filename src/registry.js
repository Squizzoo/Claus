'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = process.env.CLAUDE_PET_SESSIONS_DIR || path.join(os.homedir(), '.claude', 'sessions');

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, but not ours to signal
  }
}

/**
 * Reads the live-session registry Claude Code keeps in ~/.claude/sessions/<pid>.json.
 * Only metadata fields are read; the neighbouring *.key files are never touched.
 */
function readRegistry(dir = DIR) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue; // being rewritten right now; next poll gets it
    }
    if (!pidAlive(j.pid)) continue;
    if (j.kind && j.kind !== 'interactive') continue;
    out.push({
      sessionId: j.sessionId,
      name: j.name,
      cwd: j.cwd,
      status: j.status,
      statusUpdatedAt: j.statusUpdatedAt,
      hostSessionId: j.hostSessionId,
      entrypoint: j.entrypoint,
    });
  }
  return out;
}

module.exports = { readRegistry, DIR };
