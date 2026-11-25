'use strict';
// Dev aid: renders every mood and the popover to PNGs, then quits.
//   npx electron . --shot=out/mood
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(win, prefix, { store, setPanel, push, setPrefs }) {
  store.syncRegistry = () => false; // keep the real registry out of the pictures
  store.sessions.clear();
  setPrefs(require('./prefs').DEFAULTS); // and the real list preferences (nothing is saved in a shot run)
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

  // ---- list ergonomics: many chats, grouped, searched, collapsed, compact, pinned and muted ----
  setPanel(0);
  store.sessions.clear();
  const chat = (id, project, name, event, extra = {}) => {
    hook(id, project, event, extra);
    const s = store.sessions.get(id);
    s.name = name;
    s.hostSessionId = `local_${id}`;
  };
  chat('c1', 'bonnebella.nl', 'Fix checkout rounding', 'PermissionRequest', { tool_name: 'Bash' });
  chat('c2', 'bonnebella.nl', 'Add invoice export', 'Stop');
  chat('c3', 'bonnebella.nl', 'Review mollie webhook', 'SessionStart');
  chat('c4', 'delijstenfabriek.nl', 'Which shipping options?', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  chat('c5', 'delijstenfabriek.nl', 'Translate the FAQ page', 'UserPromptSubmit');
  chat('c6', 'printuploader.com', 'Upload progress bar', 'Stop');
  chat('c7', 'printuploader.com', 'Resize images in the queue', 'SessionStart');
  chat('c8', 'fundamental.ittica.nl', 'Cluster health check', 'UserPromptSubmit');
  for (const [id, mins] of [['c1', 6], ['c4', 3], ['c2', 12], ['c6', 1]]) store.sessions.get(id).since = Date.now() - mins * 60_000;
  const evalIn = (code) => win.webContents.executeJavaScript(code);
  const typeQuery = (q) => evalIn(`(() => { const i = document.getElementById('search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
  setPanel(480);
  await snap('14-list-grouped');
  await typeQuery('bonne');
  await snap('15-list-search');
  await typeQuery('');
  setPrefs({ collapsed: ['c:/xampp/htdocs/bonnebella.nl'] });
  await snap('16-list-collapsed');
  setPrefs({ collapsed: [], density: 'compact' });
  await snap('17-list-compact');
  setPrefs({ density: 'comfortable', pinned: ['c8'], mutedChats: ['c2'], mutedProjects: ['c:/xampp/htdocs/printuploader.com'] });
  await snap('18-list-pinned-muted');
  setPrefs({ groupBy: 'none' });
  await snap('19-list-flat');
  setPrefs({ groupBy: 'project' });
  store.dismissAllDone();
  await evalIn(`document.getElementById('opts-toggle').click()`);
  await snap('20-list-options-undo');

  app.quit();
}

module.exports = { run };
