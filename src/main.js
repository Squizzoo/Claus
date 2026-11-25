'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { SessionStore } = require('./state');
const { readRegistry } = require('./registry');
const { createServer, DEFAULT_PORT } = require('./server');
const { jumpUrl } = require('./jump');
const { focusClaude } = require('./focus');
const prefsLib = require('./prefs');

const PORT = Number(process.env.CLAUDE_PET_PORT) || DEFAULT_PORT;
const PET = 150; // collapsed window: the pet only
const PANEL_W = 300; // expanded window width
const MAX_PANEL = 480; // tallest list the window will grow to
const MARGIN = 16;

if (!app.requestSingleInstanceLock()) app.quit();

const store = new SessionStore();
let win = null;
let tray = null;
let server = null;
let settings = { x: null, y: null, muted: false, impatientMin: 2, prefs: prefsLib.DEFAULTS }; // impatientMin 0 = never angry
let petPos = { x: 0, y: 0 }; // top-left of the pet, the source of truth for position
let panelH = 0; // extra height wanted by the list (0 = collapsed)
let layout = { side: 'right', vertical: 'up' };
let drag = null;

// ---------- persistence ----------
const settingsFile = () => path.join(app.getPath('userData'), 'pet-settings.json');
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    /* first run */
  }
  settings.prefs = prefsLib.sanitize(settings.prefs);
  applyPrefs();
}
/** Muted chats and projects live in the list preferences; the store needs them to stay quiet. */
function applyPrefs() {
  store.setMuted({ ids: settings.prefs.mutedChats, projects: settings.prefs.mutedProjects });
}
let saveTimer = null;
const SHOT_RUN = process.argv.some((a) => a.startsWith('--shot=')); // screenshots must never touch the real settings
function saveSettings() {
  if (SHOT_RUN) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify(settings));
    } catch {
      /* not fatal */
    }
  }, 300);
}

// Opt-in (CLAUDE_PET_LOG=1): one line per hook event, event name and short ids only.
function debugLog(text) {
  if (!process.env.CLAUDE_PET_LOG) return;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'pet-events.log'), `${new Date().toISOString()} ${text}\n`);
  } catch {
    /* logging must never break the pet */
  }
}
function logEvent(p) {
  debugLog(`${p.hook_event_name} ${(p.session_id || '').slice(0, 8)}${p.tool_name ? ' ' + p.tool_name : ''}${p.notification_type ? ' ' + p.notification_type : ''}`);
}

// ---------- geometry ----------
function displayFor(x, y, w, h) {
  return screen.getDisplayMatching({ x, y, width: w, height: h });
}
/** Keeps the pet fully on some display (handles unplugged monitors). */
function clampToDisplays(x, y) {
  const all = screen.getAllDisplays();
  const cx = x + PET / 2;
  const cy = y + PET / 2;
  let d = all.find((d) => cx >= d.workArea.x && cx < d.workArea.x + d.workArea.width && cy >= d.workArea.y && cy < d.workArea.y + d.workArea.height);
  if (!d) d = screen.getPrimaryDisplay();
  const a = d.workArea;
  return {
    x: Math.min(Math.max(x, a.x), a.x + a.width - PET),
    y: Math.min(Math.max(y, a.y), a.y + a.height - PET),
  };
}
function defaultPos() {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - PET - MARGIN, y: a.y + a.height - PET - MARGIN };
}

function computeBounds() {
  if (panelH <= 0) return { x: petPos.x, y: petPos.y, width: PET, height: PET };
  const a = displayFor(petPos.x, petPos.y, PET, PET).workArea;
  const side = petPos.x - (PANEL_W - PET) >= a.x ? 'right' : 'left'; // pet's side of the window
  const vertical = petPos.y - panelH >= a.y ? 'up' : 'down';
  layout = { side, vertical };
  const height = PET + panelH;
  return {
    x: side === 'right' ? petPos.x - (PANEL_W - PET) : petPos.x,
    y: vertical === 'up' ? petPos.y - panelH : petPos.y,
    width: PANEL_W,
    height: Math.min(height, a.height),
  };
}
// Moves/resizes the window. Callers that change what the renderer should draw (the panel or
// its side) call push() themselves: pushing from here is what made the list redraw in a loop.
function applyBounds() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(computeBounds());
}

// ---------- window ----------
function createWindow() {
  loadSettings();
  store.impatientMs = Math.max(0, Number(settings.impatientMin) || 0) * 60_000;
  petPos = settings.x == null ? defaultPos() : clampToDisplays(settings.x, settings.y);
  win = new BrowserWindow({
    ...computeBounds(),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('blur', () => {
    debugLog(`blur (panel ${panelH > 0 ? 'open' : 'closed'})`);
    if (panelH > 0 && !drag) setPanel(0);
  });
  // webContents never navigates away or opens windows
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function push() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', { ...store.snapshot(), muted: settings.muted, prefs: settings.prefs, layout, expanded: panelH > 0 });
  const alerts = store.takeAlerts();
  if (alerts.length && !settings.muted) win.webContents.send('alert', alerts.map((a) => a.state));
}

function setPanel(extra) {
  const next = Math.max(0, Math.round(extra));
  if (next === panelH) return; // nothing changed: do not resize, push or steal focus again
  const opening = panelH === 0 && next > 0;
  panelH = next;
  applyBounds();
  push();
  if (opening && win) win.focus();
}

// ---------- IPC ----------
ipcMain.on('panel-height', (_e, h) => {
  if (typeof h !== 'number' || !Number.isFinite(h)) return;
  if (panelH > 0) setPanel(Math.min(h, MAX_PANEL));
});
ipcMain.on('toggle-panel', (_e, wantedHeight) => {
  debugLog(`ipc toggle-panel (panel ${panelH > 0 ? 'open' : 'closed'})`);
  if (panelH > 0) setPanel(0);
  else setPanel(Math.min(Number(wantedHeight) || 120, MAX_PANEL));
});
ipcMain.on('collapse', () => setPanel(0));

ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint();
  drag = { cx: c.x, cy: c.y, px: petPos.x, py: petPos.y };
  if (panelH > 0) setPanel(0);
});
ipcMain.on('drag-move', () => {
  if (!drag) return;
  const c = screen.getCursorScreenPoint();
  petPos = { x: Math.round(drag.px + c.x - drag.cx), y: Math.round(drag.py + c.y - drag.cy) };
  // Same size every tick: avoids the window growing when crossing monitors with different scaling.
  win.setBounds({ x: petPos.x, y: petPos.y, width: PET, height: PET });
});
ipcMain.on('drag-end', () => {
  if (!drag) return;
  drag = null;
  petPos = clampToDisplays(petPos.x, petPos.y);
  settings.x = petPos.x;
  settings.y = petPos.y;
  saveSettings();
  applyBounds();
  push();
});

/** Opens a chat in Claude Desktop and raises the window above whatever covers it. */
async function jumpTo(id) {
  const url = jumpUrl(store.hostIdOf(id));
  if (!url) {
    debugLog(`jump ${id.slice(0, 8)} refused: no desktop session id`);
    return false;
  }
  store.dismiss(id);
  setPanel(0);
  push();
  // Raise first (it waits for a hidden/minimised window to appear), open the chat at the same time.
  const raised = focusClaude();
  try {
    await shell.openExternal(url);
    debugLog(`jump ${id.slice(0, 8)} opened`);
  } catch (err) {
    debugLog(`jump ${id.slice(0, 8)} openExternal failed: ${err.message}`);
  }
  debugLog(`jump ${id.slice(0, 8)} focus: ${await raised}`);
  return true;
}
ipcMain.on('jump', (_e, id) => {
  debugLog(`ipc jump ${String(id).slice(0, 8)}`);
  jumpTo(String(id));
});
// The x on a row: finished -> idle, idle -> hidden. Both can be undone.
ipcMain.on('dismiss', (_e, id) => {
  debugLog(`ipc dismiss ${String(id).slice(0, 8)}`);
  if (store.dismissRow(String(id))) push();
});
ipcMain.on('clear-finished', () => {
  debugLog('ipc clear-finished');
  if (store.dismissAllDone()) push();
});
ipcMain.on('clear-idle', () => {
  debugLog('ipc clear-idle');
  if (store.dismissAllIdle()) push();
});
ipcMain.on('undo', () => {
  debugLog('ipc undo');
  if (store.undo()) push();
});
ipcMain.on('unhide', () => {
  debugLog('ipc unhide');
  if (store.unhideAll()) push();
});
// List preferences (grouping, sort, density, collapsed groups, pins, mutes): validated, then saved.
function updatePrefs(patch) {
  settings.prefs = prefsLib.merge(settings.prefs, patch);
  applyPrefs();
  saveSettings();
  push();
}
ipcMain.on('set-prefs', (_e, patch) => updatePrefs(patch));

// ---------- tray ----------
function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Claus');
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show pet', click: () => win && (win.showInactive(), win.setAlwaysOnTop(true, 'floating')) },
        { label: 'Reset position', click: () => { petPos = defaultPos(); settings.x = petPos.x; settings.y = petPos.y; saveSettings(); applyBounds(); push(); } },
        { label: 'Mute sounds', type: 'checkbox', checked: settings.muted, click: (i) => { settings.muted = i.checked; saveSettings(); push(); } },
        {
          label: 'Gets angry after waiting',
          submenu: [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [0, 'Never']].map(([min, label]) => ({
            label,
            type: 'radio',
            checked: settings.impatientMin === min,
            click: () => {
              settings.impatientMin = min;
              store.impatientMs = min * 60_000;
              saveSettings();
              store.tickOverdue();
              push();
            },
          })),
        },
        { label: 'Clear finished', click: () => { store.dismissAllDone(); push(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ])
    );
  rebuild();
  tray.on('click', () => win && win.showInactive());
}

// ---------- boot ----------
app.whenReady().then(async () => {
  createWindow();
  buildTray();

  server = createServer({
    port: PORT,
    onHook: (p) => {
      if (process.env.CLAUDE_PET_LOG) logEvent(p);
      if (store.applyHook(p)) push();
    },
  });
  try {
    await server.listen();
  } catch (err) {
    console.error(`claus: cannot listen on 127.0.0.1:${PORT} (${err.code}). Is another pet running?`);
    app.quit();
    return;
  }

  const poll = () => {
    if (store.syncRegistry(readRegistry())) push();
  };
  poll();
  setInterval(poll, 2000);
  setInterval(() => store.tickOverdue() && push(), 5000); // the pet turns angry when you keep it waiting

  // Dev aid: CLAUDE_PET_SELFTEST_JUMP=<part of a chat name> jumps to that chat 3 s after start,
  // exactly like clicking its row, and logs the result (needs CLAUDE_PET_LOG=1).
  if (process.env.CLAUDE_PET_SELFTEST_JUMP) {
    setTimeout(() => {
      const want = process.env.CLAUDE_PET_SELFTEST_JUMP.toLowerCase();
      const hit = store.snapshot().sessions.find((s) => s.name.toLowerCase().includes(want));
      if (hit) jumpTo(hit.id);
      else debugLog(`selftest: no chat matching "${want}"`);
    }, 3000);
  }

  screen.on('display-removed', () => { petPos = clampToDisplays(petPos.x, petPos.y); applyBounds(); push(); });
  screen.on('display-metrics-changed', () => { petPos = clampToDisplays(petPos.x, petPos.y); applyBounds(); push(); });
  // Dev aid: `electron . --shot=out.png` renders the current state to a PNG, then quits.
  const shot = process.argv.find((a) => a.startsWith('--shot='));
  if (shot) require('./shot').run(win, shot.slice(7), { store, setPanel, push, setPrefs: updatePrefs });
});

app.on('second-instance', () => win && win.showInactive());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server && server.close());
