'use strict';
// Dev aid: renders every mood and the popover to PNGs, then quits.
//   npx electron . --shot=out/mood
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lays pictures out in a grid (cols wide) and saves that as one PNG, so every pet can be judged at a glance. */
async function sheet(file, cells, cols) {
  const rows = Math.ceil(cells.length / cols);
  const html = `<body style="margin:0;background:#dfe5ec;font:11px sans-serif"><div style="display:grid;grid-template-columns:repeat(${cols},112px)">${cells
    .map((c) => `<div style="position:relative;width:112px;height:112px">${c.png.length ? `<img width="112" height="112" src="data:image/png;base64,${c.png.toString('base64')}">` : ''}<span style="position:absolute;left:3px;top:2px;color:#456">${c.label}</span></div>`)
    .join('')}</div></body>`;
  const w = new BrowserWindow({ show: false, width: cols * 112, height: rows * 112, useContentSize: true });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await wait(400);
  fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
  w.destroy();
}

// Every pet in every mood, 6 pets per sheet: `npx electron . --shot=out/m --pets` writes out/m-pets-1.png and so on.
async function petSheets(win, prefix, { store, push, setLook }) {
  const PetArt = require('./renderer/pets');
  const MOODS = {
    sleep: () => {},
    idle: (hook) => hook('SessionStart'),
    working: (hook) => hook('UserPromptSubmit'),
    done: (hook) => hook('Stop'),
    question: (hook) => hook('PreToolUse', { tool_name: 'AskUserQuestion' }),
    approval: (hook) => hook('PermissionRequest', { tool_name: 'Bash' }),
    angry: (hook, s) => { hook('PermissionRequest', { tool_name: 'Bash' }); s().since = Date.now() - 9 * 60_000; },
  };
  const cells = [];
  for (const id of PetArt.ORDER) {
    setLook({ pet: id });
    for (const [mood, set] of Object.entries(MOODS)) {
      store.sessions.clear();
      set((event, extra = {}) => { store.applyHook({ session_id: 's-pet', cwd: 'C:\p\demo', hook_event_name: event, ...extra }); }, () => store.sessions.get('s-pet'));
      push();
      await wait(320);
      cells.push({ png: (await win.webContents.capturePage()).toPNG(), label: `${id} · ${mood}` });
    }
  }
  const per = 6 * Object.keys(MOODS).length;
  for (let i = 0; i * per < cells.length; i++) await sheet(`${prefix}-pets-${i + 1}.png`, cells.slice(i * per, (i + 1) * per), Object.keys(MOODS).length);

  // Colours: a few pets in every skin; accessories: every pet with every accessory (all calm).
  store.sessions.clear();
  store.applyHook({ session_id: 's-pet', cwd: 'C:\\p\\demo', hook_event_name: 'SessionStart' });
  const look = async (patch, label) => {
    setLook(patch);
    push();
    await wait(320);
    return { png: (await win.webContents.capturePage()).toPNG(), label };
  };
  const skinCells = [];
  for (const id of ['cat', 'dog', 'penguin', 'robot', 'car', 'ghost']) {
    for (const skin of PetArt.SKIN_ORDER) skinCells.push(await look({ pet: id, skin, accessory: 'none' }, `${id} · ${skin}`));
  }
  await sheet(`${prefix}-skins.png`, skinCells, PetArt.SKIN_ORDER.length);
  const accs = PetArt.ACCESSORY_ORDER.filter((a) => a !== 'none');
  for (let half = 0; half < 2; half++) {
    const ids = PetArt.ORDER.slice(half * 8, half * 8 + 8);
    const accCells = [];
    for (const accessory of accs) for (const id of ids) accCells.push(await look({ pet: id, skin: 'default', accessory }, `${id} · ${accessory}`));
    await sheet(`${prefix}-acc-${half + 1}.png`, accCells, ids.length);
  }

  // Idle actions, caught part-way through (each one is a class on #root for a moment).
  const actCells = [];
  for (const id of ['cat', 'dog', 'bird', 'robot', 'ghost', 'sun']) {
    setLook({ pet: id, skin: 'default', accessory: 'none' });
    push();
    await wait(300);
    for (const [name, act] of Object.entries(PetArt.IDLE_ACTIONS)) {
      if (act.needsTail && !PetArt.buildPet(id).hasTail) { actCells.push({ png: Buffer.alloc(0), label: `${id} · ${name} (no tail)` }); continue; }
      await win.webContents.executeJavaScript(`document.getElementById('root').classList.add('act-${name}')`);
      await wait(name === 'wag' ? 120 : name === 'yawn' ? 520 : 480);
      actCells.push({ png: (await win.webContents.capturePage()).toPNG(), label: `${id} · ${name}` });
      await win.webContents.executeJavaScript(`document.getElementById('root').classList.remove('act-${name}')`);
      await wait(150);
    }
  }
  await sheet(`${prefix}-idle-acts.png`, actCells, Object.keys(PetArt.IDLE_ACTIONS).length);
  await stacheSheets(win, prefix, { store, push, setLook });
  setLook({ pet: 'cat', skin: 'default', accessory: 'none', mustache: 'none' });
}

// Mustaches: every pet with every mustache, calm, happy (the widest mouth) and angry, and again on the black skin
// (a light mustache must not vanish on a pale face patch). `npx electron . --shot=out/m --stache` runs only this.
async function stacheSheets(win, prefix, { store, push, setLook }) {
  const PetArt = require('./renderer/pets');
  const look = async (patch, label) => {
    setLook(patch);
    push();
    await wait(320);
    return { png: (await win.webContents.capturePage()).toPNG(), label };
  };
  const moods = { idle: 'SessionStart', done: 'Stop', angry: 'PermissionRequest' };
  for (const skin of ['default', 'black']) {
    for (const [mood, event] of Object.entries(moods)) {
      if (skin === 'black' && mood === 'angry') continue;
      store.sessions.clear();
      store.applyHook({ session_id: 's-pet', cwd: 'C:\p\demo', hook_event_name: event, tool_name: 'Bash' });
      if (mood === 'angry') store.sessions.get('s-pet').since = Date.now() - 9 * 60_000;
      const cells = [];
      for (const mustache of PetArt.MUSTACHE_ORDER.filter((m) => m !== 'none')) {
        for (const id of PetArt.ORDER) cells.push(await look({ pet: id, skin, accessory: 'none', mustache }, `${id} · ${mustache}`));
      }
      await sheet(`${prefix}-stache-${skin === 'black' ? 'black-' : ''}${mood}.png`, cells, 8);
    }
  }
  setLook({ pet: 'cat', skin: 'default', accessory: 'none', mustache: 'none' });
}

// The settings window, each tab, and a few looks: `npx electron . --shot=out/s --settings`.
async function settingsShots(prefix, { openSettings, setLook, store, push }) {
  store.sessions.clear();
  push();
  const w = openSettings();
  await new Promise((r) => (w.webContents.isLoading() ? w.webContents.once('did-finish-load', r) : r()));
  await wait(600);
  const run = (js) => w.webContents.executeJavaScript(js);
  const click = (sel) => run(`document.querySelector('${sel}').click()`);
  const snap = async (name) => {
    await wait(350);
    fs.writeFileSync(`${prefix}-settings-${name}.png`, (await w.webContents.capturePage()).toPNG());
  };
  await snap('1-appearance');
  setLook({ pet: 'penguin', skin: 'blue', accessory: 'hat', mustache: 'handlebar' });
  await click('#moods [data-mood=approval]');
  await snap('2-penguin-approval');
  await click('#moods [data-mood=angry]');
  setLook({ pet: 'robot', skin: 'default', accessory: 'crown', mustache: 'classic' });
  await snap('3-robot-angry');
  await click('#tab-btn-sound');
  await snap('4-sound');
  await click('#tab-btn-behaviour');
  await snap('5-behaviour');
  setLook({ pet: 'cat', skin: 'default', accessory: 'none', mustache: 'none' });
  w.destroy();
}

async function run(win, prefix, { store, setPanel, push, setPrefs, setLook, celebrate, openSettings, panelWin }) {
  store.syncRegistry = () => false; // keep the real registry out of the pictures
  store.sessions.clear();
  setPrefs(require('./prefs').DEFAULTS); // and the real list preferences (nothing is saved in a shot run)
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));

  if (process.argv.includes('--settings')) {
    await settingsShots(prefix, { openSettings, setLook, store, push });
    app.quit();
    return;
  }
  if (process.argv.includes('--stache')) {
    await stacheSheets(win, prefix, { store, push, setLook });
    app.quit();
    return;
  }
  if (process.argv.includes('--pets')) {
    await petSheets(win, prefix, { store, push, setLook });
    app.quit();
    return;
  }

  const hook = (id, name, event, extra = {}) => {
    store.applyHook({ session_id: id, cwd: `C:\\xampp\\htdocs\\${name}`, hook_event_name: event, ...extra });
    store.sessions.get(id).name = name;
  };
  const snap = async (name) => {
    push();
    await wait(450);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(`${prefix}-${name}.png`, img.toPNG());
    // The list is its own window beside the pet: save it next to the pet's picture when it is open.
    const list = panelWin();
    if (list && list.isVisible()) fs.writeFileSync(`${prefix}-${name}-list.png`, (await list.webContents.capturePage()).toPNG());
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
  const evalIn = (code) => panelWin().webContents.executeJavaScript(code); // the search box lives in the list window
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

  // ---- celebration: confetti and sparkles when several chats finish together ----
  setPanel(0);
  store.sessions.clear();
  hook('p1', 'bonnebella.nl', 'Stop');
  hook('p2', 'printuploader.com', 'Stop');
  hook('p3', 'delijstenfabriek.nl', 'Stop');
  celebrate(3);
  await snap('21-celebrate');

  app.quit();
}

module.exports = { run };
