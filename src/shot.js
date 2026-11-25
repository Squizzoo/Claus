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

  app.quit();
}

module.exports = { run };
