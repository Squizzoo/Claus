'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { SessionStore } = require('./state');
const { readRegistry } = require('./registry');
const { createServer, DEFAULT_PORT } = require('./server');
const { jumpUrl } = require('./jump');

const PORT = Number(process.env.CLAUDE_PET_PORT) || DEFAULT_PORT;
const PET = 150; // collapsed window: the pet only
const PANEL_W = 300; // expanded window width
const MARGIN = 16;

if (!app.requestSingleInstanceLock()) app.quit();

const store = new SessionStore();
let win = null;
let tray = null;
let server = null;
let settings = { x: null, y: null, muted: false };
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
}
let saveTimer = null;
function saveSettings() {
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
function logEvent(p) {
  try {
    const line = `${new Date().toISOString()} ${p.hook_event_name} ${(p.session_id || '').slice(0, 8)}${p.tool_name ? ' ' + p.tool_name : ''}${p.notification_type ? ' ' + p.notification_type : ''}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'pet-events.log'), line);
  } catch {
    /* logging must never break the pet */
  }
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
function applyBounds() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(computeBounds());
  push();
}

// ---------- window ----------
function createWindow() {
  loadSettings();
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
    if (panelH > 0 && !drag) setPanel(0);
  });
  // webContents never navigates away or opens windows
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function push() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', { ...store.snapshot(), muted: settings.muted, layout, expanded: panelH > 0 });
  const alerts = store.takeAlerts();
  if (alerts.length && !settings.muted) win.webContents.send('alert', alerts.map((a) => a.state));
}

function setPanel(extra) {
  panelH = Math.max(0, Math.round(extra));
  applyBounds();
  if (panelH > 0 && win) win.focus();
}

// ---------- IPC ----------
ipcMain.on('panel-height', (_e, h) => {
  if (typeof h !== 'number' || !Number.isFinite(h)) return;
  if (panelH > 0) setPanel(Math.min(h, 420));
});
ipcMain.on('toggle-panel', (_e, wantedHeight) => {
  if (panelH > 0) setPanel(0);
  else setPanel(Math.min(Number(wantedHeight) || 120, 420));
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
});

ipcMain.on('jump', (_e, id) => {
  const url = jumpUrl(store.hostIdOf(String(id)));
  if (!url) return;
  shell.openExternal(url).catch(() => {});
  store.dismiss(String(id));
  setPanel(0);
  push();
});
ipcMain.on('dismiss', (_e, id) => {
  if (store.dismiss(String(id))) push();
});

// ---------- tray ----------
function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Claude Pet');
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show pet', click: () => win && (win.showInactive(), win.setAlwaysOnTop(true, 'floating')) },
        { label: 'Reset position', click: () => { petPos = defaultPos(); settings.x = petPos.x; settings.y = petPos.y; saveSettings(); applyBounds(); } },
        { label: 'Mute sounds', type: 'checkbox', checked: settings.muted, click: (i) => { settings.muted = i.checked; saveSettings(); push(); } },
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
    console.error(`claude-pet: cannot listen on 127.0.0.1:${PORT} (${err.code}). Is another pet running?`);
    app.quit();
    return;
  }

  const poll = () => {
    if (store.syncRegistry(readRegistry())) push();
  };
  poll();
  setInterval(poll, 2000);

  screen.on('display-removed', () => { petPos = clampToDisplays(petPos.x, petPos.y); applyBounds(); });
  screen.on('display-metrics-changed', () => { petPos = clampToDisplays(petPos.x, petPos.y); applyBounds(); });
  // Dev aid: `electron . --shot=out.png` renders the current state to a PNG, then quits.
  const shot = process.argv.find((a) => a.startsWith('--shot='));
  if (shot) require('./shot').run(win, shot.slice(7), { store, setPanel, push });
});

app.on('second-instance', () => win && win.showInactive());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server && server.close());
