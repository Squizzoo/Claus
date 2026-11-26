'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { SessionStore } = require('./state');
const { readRegistry } = require('./registry');
const { createServer, DEFAULT_PORT } = require('./server');
const { jumpUrl } = require('./jump');
const { focusClaude } = require('./focus');
const { createOpenChatWatcher } = require('./open-chat');
const prefsLib = require('./prefs');
const lookLib = require('./look');
const PetArt = require('./renderer/pets');
const PetSounds = require('./renderer/sounds');
const celebrateLib = require('./celebrate');
const notifyLib = require('./notify');
const { showToast } = require('./toast');
const { createTranscriptReader } = require('./transcript');

const PORT = Number(process.env.CLAUDE_PET_PORT) || DEFAULT_PORT;
const PET = 150; // collapsed window: the pet only
const PANEL_W = 300; // expanded window width
const MAX_PANEL = 480; // tallest list the window will grow to
const MARGIN = 16;

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.claus.pet'); // gives the Windows toasts a stable identity

const store = new SessionStore();
const openChat = createOpenChatWatcher();
const transcripts = createTranscriptReader();
let win = null; // the pet: always PET x PET, never resized (resizing a transparent window blinks it)
let panelWin = null; // the chat list: its own window next to the pet, shown and hidden
let settingsWin = null; // the settings window (a normal window, opened by double-clicking the pet or from the tray)
let rebuildTray = () => {}; // set by buildTray; called when a setting changes elsewhere so the tray checkmarks stay right
let tray = null;
let server = null;
let settings = { x: null, y: null, muted: false, impatientMin: 2, prefs: prefsLib.DEFAULTS, look: lookLib.DEFAULTS, notify: notifyLib.DEFAULTS, streak: celebrateLib.EMPTY }; // impatientMin 0 = never angry
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
  settings.look = lookLib.sanitize(settings.look);
  settings.notify = notifyLib.sanitize(settings.notify);
  settings.streak = celebrateLib.sanitizeStreak(settings.streak);
  Object.assign(settings, lookLib.sanitizeBehaviour(settings, lookLib.BEHAVIOUR_DEFAULTS));
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

function petBounds() {
  return { x: petPos.x, y: petPos.y, width: PET, height: PET };
}
/** The list window sits beside the pet, on the side with room. Also settles `layout` for the renderer. */
function panelBounds() {
  const a = displayFor(petPos.x, petPos.y, PET, PET).workArea;
  const side = petPos.x - (PANEL_W - PET) >= a.x ? 'right' : 'left'; // the side of the list the pet is on
  const vertical = petPos.y - panelH >= a.y ? 'up' : 'down';
  layout = { side, vertical };
  const height = Math.max(60, Math.min(panelH, a.height - PET));
  return {
    x: side === 'right' ? petPos.x - (PANEL_W - PET) : petPos.x,
    y: vertical === 'up' ? petPos.y - height : petPos.y + PET,
    width: PANEL_W,
    height,
  };
}
// Moves the windows. Callers that change what the renderer should draw (the panel or its side)
// call push() themselves: pushing from here is what made the list redraw in a loop.
function applyBounds() {
  if (win && !win.isDestroyed()) win.setBounds(petBounds());
  if (panelH > 0 && panelWin && !panelWin.isDestroyed()) panelWin.setBounds(panelBounds());
}

// ---------- window ----------
function makeWindow(role, bounds, extra) {
  const w = new BrowserWindow({
    ...bounds,
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
    ...extra,
  });
  w.setAlwaysOnTop(true, 'floating');
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { role } });
  // webContents never navigates away or opens windows
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}

function createWindow() {
  loadSettings();
  store.impatientMs = Math.max(0, Number(settings.impatientMin) || 0) * 60_000;
  petPos = settings.x == null ? defaultPos() : clampToDisplays(settings.x, settings.y);
  win = makeWindow('pet', petBounds());
  win.once('ready-to-show', () => win.showInactive());
  // The renderer starts with the default cat; send the saved look as soon as the page is there.
  win.webContents.once('did-finish-load', () => push());
  panelWin = makeWindow('panel', { x: petPos.x, y: petPos.y, width: PANEL_W, height: 100 });
  // The list closes when focus goes somewhere else. Clicking the pet moves focus between our own
  // two windows, so wait a moment and look: the pet's own click (toggle-panel) decides in that case.
  const closeWhenAway = () => setTimeout(() => {
    if (panelH > 0 && !drag && !win.isFocused() && !panelWin.isFocused()) {
      debugLog('focus left the pet: closing the list');
      setPanel(0);
    }
  }, 60);
  win.on('blur', closeWhenAway);
  panelWin.on('blur', closeWhenAway);
}

// The pet window always gets expanded:false (it never shows the list); the list window gets the
// real flag. opts.paintId asks the list window to answer ('painted') once the state is on screen.
const snoozed = () => notifyLib.isSnoozed(settings.notify.snoozeUntil, Date.now());
// The sound to play now ({pack, volume}), or null while sounds are muted, snoozed or it is quiet hours.
function currentSound() {
  if (settings.muted || snoozed() || lookLib.isQuiet(new Date(), settings.look.quiet)) return null;
  return { pack: settings.look.pack, volume: settings.look.volume };
}

const celebrator = celebrateLib.createCelebrator();
/** Counts the chats that just finished (the day counter) and says how many finished together, if that is a celebration. */
function collectFinished() {
  let together = 0;
  const finished = store.takeFinished();
  for (const e of finished) {
    settings.streak = celebrateLib.bumpStreak(settings.streak, new Date(e.at));
    if (!e.muted) together = Math.max(together, celebrator.record(e.at));
  }
  if (finished.length) saveSettings();
  return together;
}
function celebrate(count) {
  if (win && !win.isDestroyed()) win.webContents.send('celebrate', { count, sound: currentSound() });
}

// A tool that ran or a registry tick changes no state, only "active 8s ago": refresh the rows at most this often.
const ACTIVITY_PUSH_MS = 5000;
let lastPushAt = 0;
let activityTimer = null;
function pushActivity() {
  if (activityTimer) return;
  activityTimer = setTimeout(() => {
    activityTimer = null;
    push();
  }, Math.max(0, ACTIVITY_PUSH_MS - (Date.now() - lastPushAt)));
}

function push(opts = {}) {
  if (!win || win.isDestroyed()) return;
  lastPushAt = Date.now();
  store.takeActivity(); // this push shows it
  const together = collectFinished();
  const snap = {
    ...store.snapshot(),
    muted: settings.muted,
    prefs: settings.prefs,
    look: settings.look,
    finishedToday: celebrateLib.finishedToday(settings.streak, new Date()),
    snoozeUntil: snoozed() ? settings.notify.snoozeUntil : 0,
    idleActions: !SHOT_RUN, // screenshots must not catch the pet half-way through a random yawn
    layout,
  };
  win.webContents.send('state', { ...snap, expanded: false, paintId: opts.petPaintId });
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('state', { ...snap, expanded: panelH > 0, paintId: opts.paintId });
  sendSettings();
  dispatchAlerts(store.takeAlerts(), together, petShown && win.isVisible()); // before updateAutoHide below may show the pet
  if (together && !SHOT_RUN) celebrate(together); // shot runs trigger it themselves, so it does not land in other pictures
  updateAutoHide(snap);
}

// ---------- token totals ----------
// Reads only what was appended to each chat's transcript since the last time, and keeps the counters (never the text).
let refreshingTokens = false;
async function refreshTokens(only) {
  if (refreshingTokens) return;
  refreshingTokens = true;
  try {
    const ids = only || [...store.ids()];
    if (!only) transcripts.keepOnly(store.ids());
    let changed = false;
    for (const id of ids) {
      if (await transcripts.refresh(id)) changed = store.setUsage(id, transcripts.totals(id)) || changed;
    }
    if (changed) push();
  } finally {
    refreshingTokens = false;
  }
}

// ---------- alerts: sound, toast, focus and snooze ----------
const FOCUS_RACE_MS = 300; // how long an alert waits to learn which chat you are looking at
const TOAST_ALLOWED = !SHOT_RUN && (PORT === DEFAULT_PORT || process.env.CLAUDE_PET_TOAST === '1'); // test instances must not fill the Action Center

/** Sound, toast and peek for alerts that passed snooze and focus. */
function deliver(alerts, together, petWasVisible) {
  if (!alerts.length || !win || win.isDestroyed()) return;
  const states = alerts.map((a) => a.state);
  const sound = currentSound();
  // the celebration brings its own fanfare, so the plain finished-chime is skipped when only finishes caused it
  if (sound && !(together && states.every((s) => s === 'done'))) win.webContents.send('alert', { states, sound });
  for (const a of alerts) if (a.reminder) debugLog(`reminder ${a.id.slice(0, 8)} ${a.state}`);
  const fresh = alerts.filter((a) => !a.reminder && a.state !== 'overdue');
  if (!fresh.length || !TOAST_ALLOWED) return;
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const where = {
    mode: settings.notify.toast,
    snoozed: snoozed(),
    petVisible: petWasVisible,
    cursorOnPetDisplay: cursorDisplay.id === displayFor(petPos.x, petPos.y, PET, PET).id,
    kinds: settings.notify.toastKinds,
  };
  const rows = store.snapshot().sessions;
  for (const a of fresh) {
    if (!notifyLib.shouldToast({ ...where, state: a.state })) continue;
    const row = rows.find((r) => r.id === a.id);
    if (!row) continue;
    try {
      showToast(
        { name: row.name, folder: row.folder, state: a.state },
        () => openFromToast(a.id),
        () => debugLog(`toast shown ${a.id.slice(0, 8)} ${a.state}`)
      );
    } catch (err) {
      debugLog(`toast failed: ${err.message}`);
    }
  }
}

/** A toast was clicked: open the chat, or for a chat that cannot be opened (terminal) bring up the pet and its list. */
function openFromToast(id) {
  debugLog(`toast clicked ${id.slice(0, 8)}`);
  if (store.hostIdOf(id)) {
    jumpTo(id);
    return;
  }
  showPet(true, 30_000);
  setPanel(120); // the list window then asks for its real height
}

/** Applies snooze, then focus awareness, then delivers. Never blocks push(). */
function dispatchAlerts(alerts, together, petWasVisible) {
  if (!alerts.length) return;
  if (snoozed()) {
    debugLog(`suppressed snoozed ${alerts.length}`);
    return;
  }
  if (!alerts.some((a) => store.hostIdOf(a.id))) return deliver(alerts, together, petWasVisible);
  // The chat open in front is only known after asking the helper; an answer that is late or missing means notify as usual.
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), FOCUS_RACE_MS); });
  Promise.race([openChat.query(), timeout])
    .catch(() => null)
    .then((openHostId) => {
      clearTimeout(timer);
      const kept = notifyLib.filterFocused(alerts, (id) => store.hostIdOf(id), openHostId);
      for (const a of alerts) if (!kept.includes(a)) debugLog(`suppressed focused ${a.id.slice(0, 8)} ${a.state}`);
      deliver(kept, together, petWasVisible);
    })
    .catch((err) => debugLog(`deliver failed: ${err.message}`)); // notifying is never allowed to break the pet
}

// ---------- auto-hide and peek ----------
// The pet window itself never changes size. Hiding is win.hide(); showing slides it in from the screen edge nearest to it.
// The position it slides to is always petPos, and the temporary slide positions are never saved.
let petShown = true; // false while auto-hidden
let manualShowUntil = 0; // the tray or a toast showed the pet by hand: leave it up for a while
let lastNeedAt = 0;
let slideTimer = null;
const stopSlide = () => {
  clearInterval(slideTimer);
  slideTimer = null;
};
function slide(from, to, done) {
  stopSlide();
  const t0 = Date.now();
  slideTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return stopSlide();
    const t = (Date.now() - t0) / notifyLib.SLIDE_MS;
    const p = notifyLib.slideAt(from, to, t);
    win.setBounds({ x: p.x, y: p.y, width: PET, height: PET }); // same size every tick
    if (t >= 1) {
      stopSlide();
      if (done) done();
    }
  }, 16);
}
const edgeOf = () => notifyLib.edgeStart(petPos, displayFor(petPos.x, petPos.y, PET, PET).workArea, PET);

function showPet(animate = false, holdMs = 0) {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  if (holdMs) manualShowUntil = now + holdMs;
  lastNeedAt = now;
  if (petShown && win.isVisible()) return;
  petShown = true;
  stopSlide();
  if (!animate) {
    win.setOpacity(1);
    win.setBounds(petBounds());
    win.showInactive();
    win.setAlwaysOnTop(true, 'floating');
    return;
  }
  // Shown off screen at opacity 0 first, so the old mood never flashes; it slides in once the new state is painted.
  const from = edgeOf();
  win.setOpacity(0);
  win.setBounds({ x: from.x, y: from.y, width: PET, height: PET });
  win.showInactive();
  win.setAlwaysOnTop(true, 'floating');
  push({ petPaintId: afterPaint(() => {
    if (!petShown || !win || win.isDestroyed()) return;
    win.setOpacity(1);
    slide(from, { x: petPos.x, y: petPos.y });
  }) });
}

function hidePet() {
  if (!petShown || !win || win.isDestroyed()) return;
  petShown = false;
  slide({ x: petPos.x, y: petPos.y }, edgeOf(), () => {
    if (!petShown && win && !win.isDestroyed()) win.hide();
  });
}

/** Called after every push and once a second (the grace before hiding runs on time, not on events). */
function updateAutoHide(snap) {
  if (!win || win.isDestroyed() || SHOT_RUN) return;
  const mode = settings.notify.autoHide;
  const now = Date.now();
  const sessions = snap.sessions.length;
  if (notifyLib.needsPet(mode, sessions, snap.attention)) lastNeedAt = now;
  const c = screen.getCursorScreenPoint();
  const b = petBounds();
  const decision = notifyLib.autoHideDecision({
    mode,
    visible: petShown,
    sessions,
    attention: snap.attention,
    panelOpen: panelH > 0,
    dragging: Boolean(drag),
    hovering: c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height,
    settingsOpen: Boolean(settingsWin && !settingsWin.isDestroyed()),
    manualShowUntil,
    lastNeedAt,
    now,
  });
  if (decision === 'show') {
    debugLog(`autohide show (${mode})`);
    showPet(true);
  } else if (decision === 'hide') {
    debugLog(`autohide hide (${mode})`);
    hidePet();
  }
}

// ---------- snooze ----------
let snoozeTimer = null;
/** One timer for the end of the snooze, so the tray label, the list and the settings window do not go stale. */
function armSnooze() {
  clearTimeout(snoozeTimer);
  snoozeTimer = null;
  if (!snoozed()) {
    settings.notify.snoozeUntil = 0;
    return;
  }
  snoozeTimer = setTimeout(() => {
    debugLog('snooze ended');
    settings.notify.snoozeUntil = 0;
    saveSettings();
    rebuildTray();
    push();
    sendSettings(true);
  }, Math.max(0, settings.notify.snoozeUntil - Date.now()) + 50);
}
function updateNotify(patch) {
  settings.notify = notifyLib.merge(settings.notify, patch);
  armSnooze();
  saveSettings();
  rebuildTray();
  push();
}
/** minutes: one of the presets, or 0 to end the snooze. */
function setSnooze(minutes) {
  debugLog(`snooze ${minutes || 'off'}`);
  updateNotify({ snoozeUntil: notifyLib.snoozeEnd(Number(minutes)) });
}

// ---------- settings window ----------
/** What the settings window shows: the look, the other settings and the choices it offers for them. */
function settingsSnapshot() {
  return {
    look: settings.look,
    muted: settings.muted,
    impatientMin: settings.impatientMin,
    finishedToday: celebrateLib.finishedToday(settings.streak, new Date()),
    quietNow: lookLib.isQuiet(new Date(), settings.look.quiet),
    notify: { ...settings.notify, snoozeUntil: snoozed() ? settings.notify.snoozeUntil : 0 },
    notifyChoices: { toast: notifyLib.TOAST, kinds: notifyLib.KINDS, remind: notifyLib.REMIND, autoHide: notifyLib.AUTO_HIDE, snooze: notifyLib.SNOOZE },
    quiet: lookLib.QUIET_ORDER.map((id) => ({ id, label: lookLib.QUIET[id].label })),
    patience: lookLib.PATIENCE,
  };
}
let lastSettingsSent = '';
/** Tells the settings window what changed; skipped when nothing did (push() runs on every hook event and poll). */
function sendSettings(force = false) {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  const snap = settingsSnapshot();
  const json = JSON.stringify(snap);
  if (!force && json === lastSettingsSent) return;
  lastSettingsSent = json;
  settingsWin.webContents.send('settings-state', snap);
}
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  const w = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'Claus settings',
    backgroundColor: '#1e1e22',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin = w;
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.once('did-finish-load', () => sendSettings(true));
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { if (settingsWin === w) settingsWin = null; });
  return w;
}

// A window that is shown for the first time (or again) can flash its previous content for a frame.
// So it is shown at opacity 0 and only made visible once the renderer reports the new state drawn.
const paintWaiters = new Map();
let paintSeq = 0;
function afterPaint(fn) {
  const id = ++paintSeq;
  const run = () => {
    if (paintWaiters.delete(id)) fn();
  };
  paintWaiters.set(id, run);
  setTimeout(run, 150); // never leave the list invisible if an answer is lost
  return id;
}
ipcMain.on('painted', (_e, id) => paintWaiters.get(id)?.());

function setPanel(extra) {
  const next = Math.max(0, Math.round(extra));
  if (next === panelH) return; // nothing changed: do not resize, push or steal focus again
  const opening = panelH === 0;
  panelH = next;
  if (!panelWin || panelWin.isDestroyed()) return;
  if (next === 0) {
    push();
    panelWin.hide(); // the pet is never touched
  } else if (opening) {
    panelWin.setBounds(panelBounds());
    panelWin.setOpacity(0);
    push({ paintId: afterPaint(() => panelH > 0 && panelWin.setOpacity(1)) });
    panelWin.show();
    panelWin.focus();
  } else {
    panelWin.setBounds(panelBounds());
    push();
  }
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
// Double-click on the pet: the list that the first click opened goes away, the settings window comes up.
ipcMain.on('open-settings', () => {
  debugLog('ipc open-settings');
  setPanel(0);
  openSettings();
});

ipcMain.on('drag-start', () => {
  stopSlide();
  if (!petShown) {
    petShown = true; // grabbed while sliding out: it stays
    lastNeedAt = Date.now();
    win.setOpacity(1);
  }
  const c = screen.getCursorScreenPoint();
  drag = { cx: c.x, cy: c.y, px: petPos.x, py: petPos.y };
  if (panelH > 0) setPanel(0);
});
ipcMain.on('drag-move', () => {
  if (!drag) return;
  const c = screen.getCursorScreenPoint();
  petPos = { x: Math.round(drag.px + c.x - drag.cx), y: Math.round(drag.py + c.y - drag.cy) };
  // Same size every tick: avoids the window growing when crossing monitors with different scaling.
  win.setBounds(petBounds());
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
// The pet's look (pet, colour, accessory, sound): chosen from the tray.
function updateLook(patch) {
  settings.look = lookLib.merge(settings.look, patch);
  saveSettings();
  rebuildTray();
  push();
}
/** Mute and the patience live outside settings.look; only known keys with valid values are applied. */
function applyBehaviour(patch) {
  const next = lookLib.sanitizeBehaviour(patch, { muted: settings.muted, impatientMin: settings.impatientMin });
  settings.muted = next.muted;
  if (next.impatientMin !== settings.impatientMin) {
    settings.impatientMin = next.impatientMin;
    store.impatientMs = next.impatientMin * 60_000;
    store.tickOverdue();
  }
  saveSettings();
  rebuildTray();
  push();
}
/**
 * A short sample of a sound (nothing while muted). Without a request (tray) it is the chosen pack and volume and also
 * stays silent in quiet hours; the settings window asks for a specific pack and kind and, as an explicit click, plays in quiet hours too.
 */
const PREVIEW_KINDS = ['done', 'question', 'approval'];
function previewSound(req) {
  if (settings.muted || !win || win.isDestroyed()) return;
  let sound = currentSound();
  let kind = 'done';
  if (req && typeof req === 'object') {
    const l = lookLib.merge(settings.look, { pack: req.pack, volume: req.volume });
    sound = { pack: l.pack, volume: l.volume };
    if (PREVIEW_KINDS.includes(req.kind)) kind = req.kind;
  }
  if (sound) win.webContents.send('alert', { states: [kind], sound });
}
ipcMain.on('set-look', (_e, patch) => updateLook(patch));
ipcMain.on('set-behaviour', (_e, patch) => applyBehaviour(patch));
ipcMain.on('set-notify', (_e, patch) => {
  const { toast, toastKinds, remindMin, autoHide } = patch && typeof patch === 'object' ? patch : {};
  updateNotify({ toast, toastKinds, remindMin, autoHide }); // the snooze has its own message: only its presets are accepted
});
ipcMain.on('snooze', (_e, minutes) => setSnooze(minutes));
ipcMain.on('preview-sound', (_e, req) => previewSound(req));

// ---------- tray ----------
function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Claus');
  rebuildTray = () => {
    tray.setToolTip(snoozed() ? `Claus (snoozed until ${notifyLib.clock(settings.notify.snoozeUntil)})` : 'Claus');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Settings...', click: () => openSettings() },
        { label: 'Show pet', click: () => showPet(false, 30_000) },
        { label: 'Reset position', click: () => { petPos = defaultPos(); settings.x = petPos.x; settings.y = petPos.y; saveSettings(); applyBounds(); push(); } },
        { label: 'Pet', submenu: PetArt.ORDER.map((id) => ({ label: PetArt.PETS[id].label, type: 'radio', checked: settings.look.pet === id, click: () => updateLook({ pet: id }) })) },
        { label: 'Colour', submenu: PetArt.SKIN_ORDER.map((id) => ({ label: PetArt.SKINS[id].label, type: 'radio', checked: settings.look.skin === id, click: () => updateLook({ skin: id }) })) },
        { label: 'Accessory', submenu: PetArt.ACCESSORY_ORDER.map((id) => ({ label: PetArt.ACCESSORIES[id].label, type: 'radio', checked: settings.look.accessory === id, click: () => updateLook({ accessory: id }) })) },
        { label: 'Sound pack', submenu: PetSounds.PACK_ORDER.map((id) => ({ label: PetSounds.PACKS[id].label, type: 'radio', checked: settings.look.pack === id, click: () => { updateLook({ pack: id }); previewSound(); } })) },
        { label: 'Volume', submenu: PetSounds.VOLUMES.map((v) => ({ label: `${v}%`, type: 'radio', checked: settings.look.volume === v, click: () => { updateLook({ volume: v }); previewSound(); } })) },
        { label: 'Quiet hours (no sound)', submenu: lookLib.QUIET_ORDER.map((id) => ({ label: lookLib.QUIET[id].label, type: 'radio', checked: settings.look.quiet === id, click: () => updateLook({ quiet: id }) })) },
        { label: 'Mute sounds', type: 'checkbox', checked: settings.muted, click: (i) => applyBehaviour({ muted: i.checked }) },
        {
          label: 'Gets angry after waiting',
          submenu: lookLib.PATIENCE.map(({ min, label }) => ({ label, type: 'radio', checked: settings.impatientMin === min, click: () => applyBehaviour({ impatientMin: min }) })),
        },
        { label: 'Show chats finished today', type: 'checkbox', checked: settings.look.streak, click: (i) => updateLook({ streak: i.checked }) },
        {
          label: snoozed() ? `Snoozed until ${notifyLib.clock(settings.notify.snoozeUntil)} - Resume` : 'Snooze',
          ...(snoozed() ? { click: () => setSnooze(0) } : { submenu: notifyLib.SNOOZE.map(({ min, label }) => ({ label, click: () => setSnooze(min) })) }),
        },
        { label: 'Toasts', submenu: notifyLib.TOAST.map(({ id, label }) => ({ label, type: 'radio', checked: settings.notify.toast === id, click: () => updateNotify({ toast: id }) })) },
        { label: 'Toast for', submenu: notifyLib.KINDS.map(({ id, label }) => ({ label, type: 'checkbox', checked: settings.notify.toastKinds[id], click: (i) => updateNotify({ toastKinds: { [id]: i.checked } }) })) },
        { label: 'Repeat reminder', submenu: notifyLib.REMIND.map(({ min, label }) => ({ label, type: 'radio', checked: settings.notify.remindMin === min, click: () => updateNotify({ remindMin: min }) })) },
        { label: 'Auto-hide', submenu: notifyLib.AUTO_HIDE.map(({ id, label }) => ({ label, type: 'radio', checked: settings.notify.autoHide === id, click: () => updateNotify({ autoHide: id }) })) },
        { label: 'Clear finished', click: () => { store.dismissAllDone(); push(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ])
    );
  };
  rebuildTray();
  tray.on('click', () => showPet(false, 30_000));
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
      else if (store.takeActivity()) pushActivity();
      if (p.hook_event_name === 'Stop') refreshTokens([p.session_id]); // a finished turn is when the total is worth knowing
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
    else if (store.takeActivity()) pushActivity();
  };
  poll();
  setInterval(poll, 2000);
  setInterval(() => {
    const overdue = store.tickOverdue(); // the pet turns angry when you keep it waiting
    const reminded = !snoozed() && store.tickReminders(settings.notify.remindMin * 60_000); // and chimes again every few minutes
    if (overdue || reminded) push();
  }, 5000);
  if (!SHOT_RUN) {
    refreshTokens();
    setInterval(() => refreshTokens(), 10_000); // chats that are still running move their total between hooks
  }
  setInterval(() => updateAutoHide(store.snapshot()), 1000); // the grace before the pet hides runs on time, not on events
  armSnooze(); // a snooze that survived a restart still has to end
  // the "finished today" number starts again at midnight even when nothing else happens
  let shownDay = celebrateLib.dayKey(new Date());
  setInterval(() => {
    const day = celebrateLib.dayKey(new Date());
    if (day !== shownDay) {
      shownDay = day;
      push();
    }
  }, 30_000);

  // Opening a finished chat in Claude Desktop (not through the pet) counts as seeing it. Only asked
  // while a finished chat is waiting, so the helper is idle the rest of the time.
  if (!SHOT_RUN) {
    let checking = false;
    let lastSeen; // only changes are logged
    setInterval(async () => {
      if (checking) return;
      if (!store.hasOpenableDone()) {
        store.markViewing(null);
        return;
      }
      checking = true;
      try {
        const hostId = await openChat.query();
        if (hostId === undefined) return; // the helper was busy with another question: no answer, not "no chat open"
        if (hostId !== lastSeen) {
          lastSeen = hostId;
          debugLog(`open chat in Claude: ${hostId ? hostId.slice(0, 14) : 'none'}`);
        }
        if (store.markViewing(hostId)) {
          debugLog(`seen in Claude: ${hostId.slice(0, 14)}`);
          push();
        }
      } finally {
        checking = false;
      }
    }, 1000);
  }

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
  if (shot) require('./shot').run(win, shot.slice(7), { store, setPanel, push, setPrefs: updatePrefs, setLook: updateLook, celebrate, openSettings, panelWin: () => panelWin });
});

app.on('second-instance', () => showPet(false, 30_000));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  openChat.stop();
  if (server) server.close();
});
