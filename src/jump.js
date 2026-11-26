'use strict';
// Opens a specific chat in Claude Desktop through its own claude:// handler.
//
// Verified in the installed app (6.28899.6.0): the router accepts
//   claude://code/continue?session=local_<id>      -> that exact session
//   claude://code/needs-input?session=local_<id>   -> that session if it is waiting, else the first waiting one
// where local_<id> is the `hostSessionId` in ~/.claude/sessions/<pid>.json.
// These routes are an app internal, not a documented API, so keep this module
// small: if a Claude update changes them, this is the only place to fix.

const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/;

// Test aid for the self-check (jump-health.js): on a test instance (CLAUDE_PET_PORT set) CLAUDE_PET_JUMP_ROUTE replaces the route
// name, so a route that does not exist can be tried without touching Claude Desktop. Ignored in a normal run.
const ROUTE_OVERRIDE = /^[a-z][a-z-]{0,29}$/;

function jumpUrl(hostSessionId, strategy = process.env.CLAUDE_PET_JUMP || 'continue') {
  if (typeof hostSessionId !== 'string' || !HOST_ID.test(hostSessionId)) return null;
  let route = strategy === 'needs-input' ? 'needs-input' : 'continue';
  const forced = process.env.CLAUDE_PET_JUMP_ROUTE;
  if (process.env.CLAUDE_PET_PORT && forced && ROUTE_OVERRIDE.test(forced)) route = forced;
  return `claude://code/${route}?session=${encodeURIComponent(hostSessionId)}`;
}

module.exports = { jumpUrl, HOST_ID };
