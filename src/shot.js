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

  // What the chats are doing: a working pet with the class of each activity on #root (the page never gets them from state in a shot run).
  const PetProps = require('./renderer/props');
  const rootJs = (code) => win.webContents.executeJavaScript(`(() => { const r = document.getElementById('root'); ${code} })()`);
  const propCells = [];
  store.sessions.clear();
  store.applyHook({ session_id: 's-pet', cwd: 'C:\\p\\demo', hook_event_name: 'UserPromptSubmit' });
  const moreProps = ['busy', 'marathon', 'hover hover-happy'];
  for (const id of ['cat', 'dog', 'bird', 'robot', 'car', 'ghost', 'sun', 'cloud', 'ant']) {
    setLook({ pet: id, skin: 'default', accessory: 'none' });
    push();
    await wait(320);
    for (const cls of [...PetProps.DOING.map((d) => `doing-${d}`), ...moreProps]) {
      await rootJs(`r.classList.add(...${JSON.stringify(cls.split(' '))});`);
      await wait(260);
      propCells.push({ png: (await win.webContents.capturePage()).toPNG(), label: `${id} · ${cls}` });
      await rootJs(`r.classList.remove(...${JSON.stringify(cls.split(' '))});`);
    }
  }
  await sheet(`${prefix}-props.png`, propCells, PetProps.DOING.length + moreProps.length);
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
  await click('#tab-btn-window');
  await snap('6-window');
  await click('#tab-btn-system');
  await snap('7-system');
  await click('#tab-btn-today');
  await snap('8-today');
  setLook({ pet: 'cat', skin: 'default', accessory: 'none', mustache: 'none' });
  w.destroy();
}

// The pet at every size, calm and with chips (badge and chips scale with the art), and with the list open: `npx electron . --shot=out/size --sizes`.
async function sizeSheets(win, prefix, { store, setPanel, push, setLook, panelWin }) {
  const hook = (id, name, event, extra = {}) => {
    store.applyHook({ session_id: id, cwd: `C:\\dev\\${name}`, hook_event_name: event, ...extra });
    store.sessions.get(id).name = name;
  };
  for (const size of ['s', 'm', 'l', 'xl']) {
    setLook({ size });
    store.sessions.clear();
    hook('a', 'webshop', 'Stop');
    await wait(500);
    push();
    await wait(450);
    fs.writeFileSync(`${prefix}-${size}-done.png`, (await win.webContents.capturePage()).toPNG());
    hook('b', 'docs-site', 'PreToolUse', { tool_name: 'AskUserQuestion' });
    hook('c', 'image-api', 'PermissionRequest', { tool_name: 'Bash' });
    push();
    await wait(450);
    fs.writeFileSync(`${prefix}-${size}-chips.png`, (await win.webContents.capturePage()).toPNG());
    setPanel(260);
    await wait(500);
    fs.writeFileSync(`${prefix}-${size}-pet.png`, (await win.webContents.capturePage()).toPNG());
    const list = panelWin();
    if (list && list.isVisible()) fs.writeFileSync(`${prefix}-${size}-list.png`, (await list.webContents.capturePage()).toPNG());
    setPanel(0);
  }
  setLook({ size: 'm' });
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
  if (process.argv.includes('--sizes')) {
    await sizeSheets(win, prefix, { store, setPanel, push, setLook, panelWin });
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
    store.applyHook({ session_id: id, cwd: `C:\\dev\\${name}`, hook_event_name: event, ...extra });
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
  hook('s-idle', 'image-api', 'SessionStart');
  await snap('2-idle');
  hook('s-idle', 'image-api', 'UserPromptSubmit');
  await snap('3-working');
  hook('s-idle', 'image-api', 'Stop');
  await snap('4-done');
  hook('s-q', 'docs-site', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  await snap('5-question');
  hook('s-a', 'webshop', 'PermissionRequest', { tool_name: 'Bash' });
  await snap('6-approval');
  hook('s-w', 'infra', 'UserPromptSubmit');
  setPanel(260);
  await snap('7-panel');
  setPanel(0);

  // angry: one chat has waited far longer than the patience
  store.sessions.clear();
  hook('s-a', 'webshop', 'PermissionRequest', { tool_name: 'Bash' });
  store.sessions.get('s-a').since = Date.now() - 9 * 60_000;
  await snap('8-angry');
  store.sessions.clear();
  hook('s-q', 'docs-site', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  store.sessions.get('s-q').since = Date.now() - 9 * 60_000;
  await snap('9-angry-question');

  // several kinds at once: one chip per kind
  store.sessions.clear();
  hook('s-q', 'docs-site', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  hook('s-d', 'image-api', 'Stop');
  await snap('10-chips-2');
  hook('s-a', 'webshop', 'PermissionRequest', { tool_name: 'Bash' });
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
  chat('c1', 'webshop', 'Fix checkout rounding', 'PermissionRequest', { tool_name: 'Bash' });
  chat('c2', 'webshop', 'Add invoice export', 'Stop');
  chat('c3', 'webshop', 'Review payment webhook', 'SessionStart');
  chat('c4', 'docs-site', 'Which shipping options?', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  chat('c5', 'docs-site', 'Translate the FAQ page', 'UserPromptSubmit');
  chat('c6', 'image-api', 'Upload progress bar', 'Stop');
  chat('c7', 'image-api', 'Resize images in the queue', 'SessionStart');
  chat('c8', 'infra', 'Cluster health check', 'UserPromptSubmit');
  for (const [id, mins] of [['c1', 6], ['c4', 3], ['c2', 12], ['c6', 1]]) store.sessions.get(id).since = Date.now() - mins * 60_000;
  const evalIn = (code) => panelWin().webContents.executeJavaScript(code); // the search box lives in the list window
  const typeQuery = (q) => evalIn(`(() => { const i = document.getElementById('search'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
  setPanel(480);
  await snap('14-list-grouped');
  await typeQuery('web');
  await snap('15-list-search');
  await typeQuery('');
  setPrefs({ collapsed: ['c:/dev/webshop'] });
  await snap('16-list-collapsed');
  setPrefs({ collapsed: [], density: 'compact' });
  await snap('17-list-compact');
  setPrefs({ density: 'comfortable', pinned: ['c8'], mutedChats: ['c2'], mutedProjects: ['c:/dev/image-api'] });
  await snap('18-list-pinned-muted');
  setPrefs({ groupBy: 'none' });
  await snap('19-list-flat');
  setPrefs({ groupBy: 'project' });
  store.dismissAllDone();
  await evalIn(`document.getElementById('opts-toggle').click()`);
  await snap('20-list-options-undo');

  // ---- more per chat: how long it has been working, token counts, and a chat that lives in a terminal ----
  await evalIn(`document.getElementById('opts-toggle').click()`);
  const now = Date.now();
  const c5 = store.sessions.get('c5');
  c5.turnStart = now - 252_000;
  c5.lastHookAt = now - 8_000;
  store.setUsage('c5', { input: 6, output: 1500, cacheWrite: 41_000, cacheRead: 900_000 });
  store.setUsage('c1', { input: 12, output: 800, cacheWrite: 3_100, cacheRead: 120_000 });
  chat('c9', 'image-api', 'Run the tests in a terminal', 'UserPromptSubmit');
  Object.assign(store.sessions.get('c9'), { hostSessionId: null, pid: 4321, entrypoint: 'cli', turnStart: now - 75_000 });
  await snap('22-list-details');

  // ---- celebration: confetti and sparkles when several chats finish together ----
  setPanel(0);
  store.sessions.clear();
  hook('p1', 'webshop', 'Stop');
  hook('p2', 'image-api', 'Stop');
  hook('p3', 'docs-site', 'Stop');
  celebrate(3);
  await snap('21-celebrate');

  app.quit();
}

module.exports = { run };
