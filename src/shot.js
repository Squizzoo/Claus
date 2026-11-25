'use strict';
// Dev aid: renders every mood and the popover to PNGs, then quits.
//   npx electron . --shot=out/mood
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win, prefix, { store, setPanel, push }) {
  store.syncRegistry = () => false; // keep the real registry out of the pictures
  store.sessions.clear();
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));

  const hook = (id, name, event, extra = {}) => {
    store.applyHook({ session_id: id, cwd: `C:\\xampp\\htdocs\\${name}`, hook_event_name: event, ...extra });
    store.sessions.get(id).name = name;
  };
  const snap = async (name) => {
    push();
    await wait(450);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(`${prefix}-${name}.png`, img.toPNG());
  };

  await snap('1-sleep');
  hook('s-idle', 'printuploader.com', 'SessionStart');
  await snap('2-idle');
  hook('s-idle', 'printuploader.com', 'UserPromptSubmit');
  await snap('3-working');
  hook('s-idle', 'printuploader.com', 'Stop');
  await snap('4-done');
  hook('s-q', 'delijstenfabriek.nl', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  await snap('5-question');
  hook('s-a', 'bonnebella.nl', 'PermissionRequest', { tool_name: 'Bash' });
  await snap('6-approval');
  hook('s-w', 'fundamental.ittica.nl', 'UserPromptSubmit');
  setPanel(260);
  await snap('7-panel');
  setPanel(0);

  // angry: one chat has waited far longer than the patience
  store.sessions.clear();
  hook('s-a', 'bonnebella.nl', 'PermissionRequest', { tool_name: 'Bash' });
  store.sessions.get('s-a').since = Date.now() - 9 * 60_000;
  await snap('8-angry');
  store.sessions.clear();
  hook('s-q', 'delijstenfabriek.nl', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  store.sessions.get('s-q').since = Date.now() - 9 * 60_000;
  await snap('9-angry-question');

  // several kinds at once: one chip per kind
  store.sessions.clear();
  hook('s-q', 'delijstenfabriek.nl', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  hook('s-d', 'printuploader.com', 'Stop');
  await snap('10-chips-2');
  hook('s-a', 'bonnebella.nl', 'PermissionRequest', { tool_name: 'Bash' });
  hook('s-d2', 'snijdersenvandijk.nl', 'Stop');
  await snap('11-chips-3');
  store.sessions.get('s-a').since = Date.now() - 9 * 60_000;
  await snap('12-chips-3-angry');
  setPanel(300);
  await snap('13-panel-angry');

  app.quit();
}

module.exports = { run };
