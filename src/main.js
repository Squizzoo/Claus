'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage, clipboard, dialog, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SessionStore, projectKey, basename } = require('./state');
const { readRegistry } = require('./registry');
const { createServer, DEFAULT_PORT } = require('./server');
const { jumpUrl } = require('./jump');
const { focusClaude, focusWindowOf } = require('./focus');
const { createOpenChatWatcher } = require('./open-chat');
const prefsLib = require('./prefs');
const lookLib = require('./look');
const PetArt = require('./renderer/pets');
const PetSounds = require('./renderer/sounds');
const PetView = require('./renderer/view');
const celebrateLib = require('./celebrate');
const dailyLib = require('./daily');
const notifyLib = require('./notify');
const placeLib = require('./placement');
const jumpHealthLib = require('./jump-health');
const systemLib = require('./system');
const hooksLib = require('./hooks-install');
const updaterLib = require('./updater');
const releasesLib = require('./releases');
const { createClaudeWatcher } = require('./claude-running');
const wslLib = require('./wsl');
const { createChatWatcher } = require('./chat-watch');
const { showToast } = require('./toast');
const { createTranscriptReader } = require('./transcript');
const { rowMenuTemplate, vscodeUrl, terminalCommand } = require('./row-menu');
const { trayMenuTemplate } = require('./tray-menu');

const PORT = Number(process.env.CLAUDE_PET_PORT) || DEFAULT_PORT;
let PET = lookLib.sizePx(lookLib.DEFAULTS.size); // collapsed window: the pet only; the pixel size of the chosen look.size (set in createWindow)
const PANEL_W = 300; // expanded window width
const MAX_PANEL = 480; // tallest list the window will grow to
const MARGIN = 16;

// The settings folder is always %APPDATA%\claude-pet, whatever the app is called when packaged (a productName would otherwise move it to
// %APPDATA%\Claus and lose position, look, pins and stats). A test run with --user-data-dir keeps its own folder.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'claude-pet'));
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
let settings = { x: null, y: null, muted: false, impatientMin: 2, prefs: prefsLib.DEFAULTS, look: lookLib.DEFAULTS, notify: notifyLib.DEFAULTS, place: placeLib.DEFAULTS, system: systemLib.DEFAULTS, jumpHealth: jumpHealthLib.EMPTY, streak: celebrateLib.EMPTY, daily: dailyLib.EMPTY }; // impatientMin 0 = never angry
let petPos = { x: 0, y: 0 }; // top-left of the pet, the source of truth for position
let panelH = 0; // extra height wanted by the list (0 = collapsed)
let layout = { side: 'right', vertical: 'up' };
let drag = null;
let followState = { displayId: null, since: 0 }; // the monitor the user's window is on, and since when

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
  settings.projectLooks = lookLib.sanitizeProjectLooks(settings.projectLooks);
  settings.notify = notifyLib.sanitize(settings.notify);
  settings.place = placeLib.sanitize(settings.place);
  PET = lookLib.sizePx(settings.look.size);
  settings.system = systemLib.sanitize(settings.system);
  settings.jumpHealth = jumpHealthLib.sanitize(settings.jumpHealth);
  jumpHealth = settings.jumpHealth;
  settings.streak = celebrateLib.sanitizeStreak(settings.streak);
  settings.daily = dailyLib.sanitize(settings.daily);
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
/** The opacity of the pet window (the chosen look.opacity); the list window always stays fully opaque. */
const petOpacity = () => settings.look.opacity / 100;
/** Always on top. `screen-saver` is the level that also stays above fullscreen apps (not above exclusive-fullscreen games). */
function raise(w) {
  if (w && !w.isDestroyed()) w.setAlwaysOnTop(true, settings.place.fullscreen ? 'screen-saver' : 'floating');
}
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
    opacity: role === 'pet' ? petOpacity() : 1,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...extra,
  });
  raise(w);
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
    if (panelH > 0 && !drag && !rowMenuOpen && !win.isFocused() && !panelWin.isFocused()) {
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
/** Today's finished chats, waits and work for the settings window, the tray and the header tooltip. */
const todaySummary = () => dailyLib.summary(settings.daily, celebrateLib.finishedToday(settings.streak, new Date()), new Date());
/** A length for the tray: `6m`, `1h 05m`. */
const clockLength = (ms) => (ms < 60_000 ? PetView.formatDuration(ms) :PetView.formatDuration(Math.floor(ms / 60_000) * 60_000).replace(/ \d\d?s$/, ''));
/** Counts the chats that just finished (the day counter) and says how many finished together, if that is a celebration. */
function collectFinished() {
  let together = 0;
  const finished = store.takeFinished();
  for (const e of finished) {
    settings.streak = celebrateLib.bumpStreak(settings.streak, new Date(e.at));
    if (!e.muted) together = Math.max(together, celebrator.record(e.at));
  }
  const times = store.takeTimes();
  for (const ms of times.waits) settings.daily = dailyLib.recordWait(settings.daily, ms, new Date());
  for (const ms of times.work) settings.daily = dailyLib.recordWork(settings.daily, ms, new Date());
  if (finished.length || times.waits.length || times.work.length) {
    saveSettings();
    rebuildTray(); // the tray shows today's numbers
  }
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
  const base = store.snapshot();
  const snap = {
    ...base,
    muted: settings.muted,
    prefs: settings.prefs,
    look: lookLib.effectiveLook(base.sessions, settings.look, settings.projectLooks), // a chat that needs you can bring its project's own pet
    finishedToday: celebrateLib.finishedToday(settings.streak, new Date()),
    daily: todaySummary(),
    snoozeUntil: snoozed() ? settings.notify.snoozeUntil : 0,
    idleActions: !SHOT_RUN, // screenshots must not catch the pet half-way through a random yawn
    layout,
    petSize: PET,
  };
  win.webContents.send('state', { ...snap, expanded: false, paintId: opts.petPaintId });
  if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('state', { ...snap, expanded: panelH > 0, paintId: opts.paintId });
  sendSettings();
  dispatchAlerts(filterNestedAlerts(store.takeAlerts()), together, petShown && win.isVisible()); // before updateAutoHide below may show the pet
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
    const ids = (only || [...store.ids()]).filter((id) => !id.startsWith('chat_')); // Chat tab rows have no transcript
    if (!only) transcripts.keepOnly(store.ids());
    let changed = false;
    for (const id of ids) {
      if (await transcripts.refresh(id)) {
        changed = store.setUsage(id, transcripts.totals(id)) || changed;
        changed = store.setChildren(id, transcripts.children(id)) || changed; // which chats this one started, for the nested rows and the alert filter
      }
    }
    if (changed) push();
  } finally {
    refreshingTokens = false;
  }
}

// ---------- alerts: sound, toast, focus and snooze ----------
/** A chat that started other chats and the chats it started both say "done": the setting decides which of the two alerts goes out. */
function filterNestedAlerts(alerts) {
  return alerts.filter((a) => {
    const keep = notifyLib.nestedAlertDecision({ mode: settings.notify.nested, state: a.state, ctx: store.nestedContext(a.id) });
    if (!keep) debugLog(`alert held back (nested, ${settings.notify.nested}) ${a.id.slice(0, 8)}`);
    return keep;
  });
}
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

/** A toast was clicked: open the chat or raise its terminal window; for a chat that can do neither, bring up the pet and its list. */
function openFromToast(id) {
  debugLog(`toast clicked ${id.slice(0, 8)}`);
  const info = store.infoOf(id);
  if (info && (info.hostSessionId || info.focusable || info.chat)) {
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
    win.setOpacity(petOpacity());
    win.setBounds(petBounds());
    win.showInactive();
    raise(win);
    return;
  }
  // Shown off screen at opacity 0 first, so the old mood never flashes; it slides in once the new state is painted.
  const from = edgeOf();
  win.setOpacity(0);
  win.setBounds({ x: from.x, y: from.y, width: PET, height: PET });
  win.showInactive();
  raise(win);
  push({ petPaintId: afterPaint(() => {
    if (!petShown || !win || win.isDestroyed()) return;
    win.setOpacity(petOpacity());
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

// ---------- click-through ----------
// While nothing needs you the pet window lets clicks fall through to what is below it. Holding Ctrl over the pet grabs it.
// Ctrl is read from the real keyboard state (the helper's `c` question): the mouse moves that a click-through window still gets do not carry the Ctrl flag.
// A grab lasts while the cursor stays on the pet and a moment after, so a slow click or a double-click always lands.
let clickThrough = false;
let grabbedAt = 0;
const cursorOnPet = () => placeLib.cursorOver(screen.getCursorScreenPoint(), petBounds());
function updateClickThrough(snap) {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  const inside = cursorOnPet();
  if (grabbedAt && !inside && now - grabbedAt >= placeLib.GRAB_HOLD_MS) grabbedAt = 0; // the grab is over
  const want = placeLib.clickThroughDecision({
    enabled: settings.place.clickThrough && petShown,
    attention: snap.attention,
    panelOpen: panelH > 0,
    dragging: Boolean(drag),
    settingsOpen: Boolean(settingsWin && !settingsWin.isDestroyed()),
    grabbedAt,
    cursorInside: inside,
    now,
  });
  if (want === clickThrough) return;
  clickThrough = want;
  debugLog(`click-through ${want ? 'on' : 'off'}`);
  win.setIgnoreMouseEvents(want, want ? { forward: true } : undefined);
}
function grab() {
  grabbedAt = Date.now();
  updateClickThrough(store.snapshot());
}
ipcMain.on('pet-grab', grab);
let askingCtrl = false;
/** Every 150 ms while click-through is on: is Ctrl held with the cursor on the pet? Then the pet becomes clickable. */
async function pollClickThrough() {
  if (!settings.place.clickThrough || !petShown) return;
  const onPet = cursorOnPet();
  if (!onPet && !grabbedAt) return; // nothing to decide while the cursor is elsewhere (the 1 s tick keeps the rest right)
  updateClickThrough(store.snapshot()); // ends a grab as soon as the cursor has left
  if (!clickThrough || askingCtrl || !onPet) return;
  askingCtrl = true;
  try {
    if (await claudeWatcher().ctrl()) grab();
  } catch {
    /* no answer: the renderer's own Ctrl check still works */
  } finally {
    askingCtrl = false;
  }
}

/** Called after every push and once a second (the grace before hiding runs on time, not on events). */
function updateAutoHide(snap) {
  if (!win || win.isDestroyed() || SHOT_RUN) return;
  updateClickThrough(snap);
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
    forceHide: settings.system.followClaude && claudeIsGone,
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

// ---------- follow the active monitor ----------
// "Active" is the monitor of the window the user works in (the foreground window, asked from the PowerShell helper), not the one the mouse is on.
// The pet keeps its relative place (bottom right stays bottom right) and only moves once the new monitor has been the active one for a few seconds.
let following = false;
async function followActiveMonitor() {
  if (following || SHOT_RUN || settings.place.monitor !== 'follow' || !win || win.isDestroyed() || !petShown) return;
  following = true;
  try {
    const rect = await claudeWatcher().foreground();
    if (!rect || settings.place.monitor !== 'follow') return;
    const dip = screen.screenToDipRect(null, rect);
    const display = screen.getDisplayNearestPoint({ x: Math.round(dip.x + dip.width / 2), y: Math.round(dip.y + dip.height / 2) });
    const now = Date.now();
    if (display.id !== followState.displayId) followState = { displayId: display.id, since: now };
    const here = displayFor(petPos.x, petPos.y, PET, PET);
    if (!placeLib.shouldFollow({
      monitor: settings.place.monitor,
      activeDisplayId: followState.displayId,
      currentDisplayId: here.id,
      candidateSince: followState.since,
      now,
      dragging: Boolean(drag),
      panelOpen: panelH > 0,
      settingsOpen: Boolean(settingsWin && !settingsWin.isDestroyed()),
    })) return;
    const from = { x: petPos.x, y: petPos.y };
    const to = placeLib.followTarget(placeLib.relativeOf(from, here.workArea, PET), display.workArea, PET);
    debugLog(`follow: moving to display ${display.id}`);
    petPos = to;
    settings.x = to.x;
    settings.y = to.y;
    saveSettings();
    slide(from, to, () => applyBounds());
  } catch (err) {
    debugLog(`follow failed: ${err.message}`);
  } finally {
    following = false;
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

// ---------- system: hooks, start with Windows, follow Claude Desktop, updates ----------
const FORCE_SETUP = process.argv.includes('--setup'); // ask the first-run question even from a dev checkout
const IS_PORTABLE = Boolean(process.env.PORTABLE_EXECUTABLE_DIR); // set by the portable exe
const caps = () => systemLib.capabilities({ packaged: app.isPackaged, portable: IS_PORTABLE });

let hooksCache = { at: 0, value: null };
/** The state of the pet's hooks in Claude Code's settings file; read at most every few seconds (it is part of every settings push). */
function hooksStatus(fresh = false) {
  const now = Date.now();
  if (fresh || !hooksCache.value || now - hooksCache.at > 5000) hooksCache = { at: now, value: hooksLib.status({ port: PORT }) };
  return hooksCache.value;
}

/**
 * Adds or removes the pet's hooks in ~/.claude/settings.json, after the user has seen what changes and said yes in a dialog.
 * Resolves with 'done', 'cancelled', 'unchanged' or 'failed'. The file is backed up first; other hooks are never touched.
 */
async function changeHooks(action, parent) {
  const box = (options) => {
    const p = parent && !parent.isDestroyed() ? parent : null;
    return p ? dialog.showMessageBox(p, options) : dialog.showMessageBox(options);
  };
  let plan;
  try {
    plan = hooksLib.plan({ action, port: PORT });
  } catch (err) {
    debugLog(`hooks ${action} not possible: ${err.message}`);
    await box({ type: 'error', title: 'Claus', message: 'Claude Code settings could not be changed', detail: `${hooksLib.defaultFile()}\n\n${err.message}` });
    return 'failed';
  }
  if (!plan.changed) return 'unchanged';
  const installing = action === 'install';
  const { response } = await box({
    type: 'question',
    title: 'Claus',
    buttons: [installing ? 'Install hooks' : 'Remove hooks', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: installing ? 'Let Claus hear from Claude Code?' : 'Remove the Claus hooks from Claude Code?',
    detail: installing
      ? `Claus needs a few hooks in Claude Code's settings file to know when a chat finishes or asks something:\n\n${plan.file}\n\n` +
        `It adds ${plan.petEvents.length} entries (${plan.petEvents.join(', ')}) that only POST to this computer (127.0.0.1:${plan.port}). ` +
        `Your own hooks stay as they are, and a backup is saved next to the file as settings.json.pet-bak.\n\n` +
        `Claus keeps only the chat id, the event name, the tool name and the folder; prompts and tool input are dropped.`
      : `This removes only the Claus entries from:\n\n${plan.file}\n\nYour other hooks stay, and a backup is saved as settings.json.pet-bak. The pet will stop hearing from Claude Code until you install them again.`,
  });
  if (response !== 0) return 'cancelled';
  try {
    hooksLib.apply(plan);
    debugLog(`hooks ${action} done`);
  } catch (err) {
    debugLog(`hooks ${action} failed: ${err.message}`);
    await box({ type: 'error', title: 'Claus', message: 'Claude Code settings could not be changed', detail: err.message });
    return 'failed';
  }
  hooksStatus(true);
  sendSettings(true);
  return 'done';
}

/** The very first start of an installed build: offer the hooks once (never nags again, whatever the answer was). */
async function firstRun() {
  const st = hooksStatus(true);
  if (!systemLib.shouldAskSetup({ settings: settings.system, firstRun: caps().firstRun, forced: FORCE_SETUP, hooksComplete: st.complete, hooksFileExists: st.exists || st.missing })) return;
  settings.system = systemLib.merge(settings.system, { setupAsked: true });
  saveSettings();
  debugLog('first run: offering the hooks');
  await changeHooks('install', null);
}

// ---------- WSL ----------
// Chats of Claude Code inside WSL (opt-in). Their hooks reach the pet through the Windows curl (see wsl.js); this adds their registry,
// read only from distros that are running right now, because looking into a stopped one would start its VM.
let wslState = { running: 0, hooks: '', entries: [] };
const wslHome = new Map(); // distro -> home, asked once
let wslBusy = false;
const realDistro = (d) => !/^docker-desktop/i.test(d); // Docker's own distros are no Claude Code machines
async function pollWsl() {
  if (SHOT_RUN || wslBusy) return;
  if (!settings.system.wsl) {
    if (wslState.entries.length || wslState.running) {
      wslState = { running: 0, hooks: '', entries: [] };
      if (store.syncRegistry([...readRegistry()])) push();
    }
    return;
  }
  wslBusy = true;
  try {
    const running = (await wslLib.runningDistros()).filter(realDistro);
    const entries = [];
    let withHooks = 0;
    for (const distro of running) {
      if (!wslHome.get(distro)) {
        const found = await wslLib.homeOf(distro); // a failed answer is not remembered: the distro may just have been starting
        if (found) wslHome.set(distro, found);
      }
      const home = wslHome.get(distro);
      if (!home) continue;
      // Look at the files first. Starting a process inside a distro (the pid check) keeps it from shutting down when idle, so it is only
      // done while the distro has chats at all.
      const dir = wslLib.wslPath(distro, home, '.claude/sessions');
      const domain = `wsl:${distro}`;
      if (readRegistry(dir, { alive: () => true, domain }).length) {
        const pids = await wslLib.livePids(distro);
        if (pids) entries.push(...readRegistry(dir, { alive: (pid) => pids.has(pid), domain }));
      }
      if (hooksLib.status({ file: wslLib.wslPath(distro, home, '.claude/settings.json'), port: PORT }).complete) withHooks++;
    }
    const hooks = running.length ? `${withHooks} of ${running.length} running distro${running.length === 1 ? '' : 's'} have the hooks` : '';
    const changed = JSON.stringify(entries) !== JSON.stringify(wslState.entries) || wslState.running !== running.length || wslState.hooks !== hooks;
    wslState = { running: running.length, hooks, entries };
    if (changed) {
      debugLog(`wsl: ${running.length} running, ${entries.length} chats`);
      store.syncRegistry([...readRegistry(), ...entries]);
      push();
      sendSettings();
    }
  } catch (err) {
    debugLog(`wsl poll failed: ${err.message}`);
  } finally {
    wslBusy = false;
  }
}

/** Adds or removes the hooks inside every WSL distro (the settings file of its default user), after a dialog that lists the files. */
async function changeWslHooks(action, parent) {
  const box = (options) => {
    const p = parent && !parent.isDestroyed() ? parent : null;
    return p ? dialog.showMessageBox(p, options) : dialog.showMessageBox(options);
  };
  const installing = action === 'install';
  const plans = [];
  for (const distro of (await wslLib.allDistros()).filter(realDistro)) {
    const home = await wslLib.homeOf(distro); // starts the distro if it is stopped: the user just asked for this
    const file = home && wslLib.wslPath(distro, home, '.claude/settings.json');
    if (!file) continue;
    try {
      const plan = hooksLib.plan({ action, file, port: PORT, wsl: true });
      if (plan.changed) plans.push(plan);
    } catch (err) {
      debugLog(`wsl hooks ${action} skipped for ${distro}: ${err.message}`);
    }
  }
  if (!plans.length) {
    await box({ type: 'info', title: 'Claus', message: installing ? 'Nothing to install: no WSL distro has a Claude Code settings file that needs the hooks.' : 'There are no Claus hooks in WSL to remove.' });
    return 'unchanged';
  }
  const { response } = await box({
    type: 'question',
    title: 'Claus',
    buttons: [installing ? 'Install WSL hooks' : 'Remove WSL hooks', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: installing ? 'Let Claus hear from Claude Code inside WSL?' : 'Remove the Claus hooks from WSL?',
    detail: `${installing ? 'Adds' : 'Removes'} the Claus entries in:\n\n${plans.map((p) => p.file).join('\n')}\n\n` +
      (installing ? `Each entry runs the Windows curl (${wslLib.hookCommand(PORT).split(' ')[0]}) to POST the event to 127.0.0.1:${PORT} on this computer, nothing else. ` : '') +
      'Other hooks stay as they are and a backup is saved next to each file as settings.json.pet-bak.',
  });
  if (response !== 0) return 'cancelled';
  for (const plan of plans) {
    try {
      hooksLib.apply(plan);
      debugLog(`wsl hooks ${action} done`);
    } catch (err) {
      debugLog(`wsl hooks ${action} failed: ${err.message}`);
      await box({ type: 'error', title: 'Claus', message: 'WSL settings could not be changed', detail: `${plan.file}\n\n${err.message}` });
      return 'failed';
    }
  }
  pollWsl();
  return 'done';
}

function updateSystem(patch) {
  const before = settings.system;
  settings.system = systemLib.merge(settings.system, patch);
  if (settings.system.wsl !== before.wsl) pollWsl();
  if (settings.system.login !== before.login && caps().login) {
    try {
      app.setLoginItemSettings({ openAtLogin: settings.system.login });
      loginCache = { at: 0, value: false }; // read it again
    } catch (err) {
      debugLog(`login item failed: ${err.message}`);
    }
  }
  if (settings.system.followClaude !== before.followClaude) {
    claudeMisses = 0;
    claudeIsGone = false;
    if (settings.system.followClaude) pollClaude();
  }
  if (settings.system.watchChat !== before.watchChat) {
    if (settings.system.watchChat) pollChats();
    else {
      if (chatWatcherInstance) chatWatcherInstance.stop(); // no PowerShell helper (and no Chromium accessibility request) while it is off
      lastChatLog = '';
      store.clearChats();
    }
  }
  saveSettings();
  rebuildTray();
  push();
}

// Follow Claude Desktop: while it is not running the pet hides (the app and the tray stay), and it comes back with Claude.
let claudeMisses = 0;
let claudeIsGone = false;
let pollingClaude = false;
async function pollClaude() {
  if (!settings.system.followClaude || pollingClaude || SHOT_RUN) return;
  pollingClaude = true;
  try {
    claudeMisses = systemLib.missesAfter(claudeMisses, await claudeWatcher().state());
    const gone = systemLib.claudeGone(claudeMisses);
    if (gone !== claudeIsGone) {
      claudeIsGone = gone;
      debugLog(`claude desktop ${gone ? 'gone: hiding the pet' : 'is back'}`);
      updateAutoHide(store.snapshot());
    }
  } finally {
    pollingClaude = false;
  }
}

// Chat tab of Claude Desktop (no hooks there): its Stop button is watched while "watch chat" is on. See chat-watch.js.
let chatWatcherInstance = null;
const chatWatcher = () => chatWatcherInstance || (chatWatcherInstance = createChatWatcher());
let pollingChats = false;
let lastChatLog = '';
async function pollChats() {
  if (!settings.system.watchChat || pollingChats || SHOT_RUN) return;
  pollingChats = true;
  try {
    const chats = await chatWatcher().read();
    if (!settings.system.watchChat || !chats) return; // turned off meanwhile, or no usable answer
    const log = `${chats.length} on screen, ${chats.filter((c) => c.working).length} answering`;
    if (log !== lastChatLog) {
      lastChatLog = log;
      debugLog(`chat tab: ${log}`); // counts only, never ids or text
    }
    if (store.applyChats(chats)) push();
  } finally {
    pollingChats = false;
  }
}

// The GitHub repository the releases live in (from the build settings in package.json).
const publishCfg = (require('../package.json').build || {}).publish;
const releaseRepo = Array.isArray(publishCfg) && publishCfg[0] && publishCfg[0].provider === 'github' ? { owner: publishCfg[0].owner, repo: publishCfg[0].repo } : null;
const updater = updaterLib.createUpdater({
  repo: releaseRepo,
  supported: app.isPackaged && !IS_PORTABLE && !SHOT_RUN,
  onChange: () => {
    rebuildTray();
    sendSettings(true);
  },
  log: debugLog,
});
// The list of versions to choose from. Only fetched when you ask for it (Settings > System > Updates): one request to api.github.com.
let versions = { status: 'idle', list: [], error: '' };
async function loadVersions() {
  if (!releaseRepo || versions.status === 'loading') return;
  versions = { status: 'loading', list: [], error: '' };
  sendSettings(true);
  try {
    const res = await net.fetch(`https://api.github.com/repos/${releaseRepo.owner}/${releaseRepo.repo}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Claus' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    versions = { status: 'ready', list: releasesLib.parseReleases(await res.json(), app.getVersion()), error: '' };
  } catch (err) {
    versions = { status: 'error', list: [], error: String(err && err.message || 'failed').slice(0, 100) };
  }
  sendSettings(true);
}
/** Install a version from the list (older ones too), after a dialog that says what happens. Only versions that were in the list count. */
async function chooseVersion(version, parent) {
  const entry = versions.list.find((v) => v.version === version);
  if (!entry || entry.relation === 'same' || !caps().updates) return;
  const older = entry.relation === 'older';
  const p = parent && !parent.isDestroyed() ? parent : null;
  if (updater.state().status === 'downloading') {
    const busy = { type: 'info', title: 'Claus', message: 'An update is downloading right now', detail: 'Wait until it is done, then choose the version again.' };
    await (p ? dialog.showMessageBox(p, busy) : dialog.showMessageBox(busy));
    return;
  }
  const options = {
    type: 'question',
    title: 'Claus',
    buttons: [older ? `Go back to ${version}` : `Update to ${version}`, 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: older ? `Go back to version ${version}?` : `Update to version ${version}?`,
    detail: `Claus looks for version ${version} on GitHub. Nothing is downloaded until you click Download, and nothing is installed until you click Install. Your settings stay as they are.`,
  };
  const { response } = await (p ? dialog.showMessageBox(p, options) : dialog.showMessageBox(options));
  if (response === 0) updater.useVersion(version);
}
function updateAction(what) {
  if (what === 'check') updater.check();
  else if (what === 'versions') loadVersions();
  else if (what === 'download') updater.download();
  else if (what === 'install') updater.install();
}

let loginCache = { at: 0, value: false }; // reading the login item is a registry lookup; it is part of every settings push
function systemSnapshot() {
  const c = caps();
  const u = updater.state();
  const h = hooksStatus();
  let login = false;
  if (c.login) {
    const now = Date.now();
    if (now - loginCache.at > 5000) {
      try {
        loginCache = { at: now, value: app.getLoginItemSettings().openAtLogin };
      } catch {
        loginCache = { at: now, value: false }; // not available
      }
    }
    login = loginCache.value;
  }
  return {
    followClaude: settings.system.followClaude,
    watchChat: settings.system.watchChat,
    wsl: { enabled: settings.system.wsl, running: wslState.running, hooks: wslState.hooks },
    login,
    loginAvailable: c.login,
    updatesAvailable: c.updates,
    version: app.getVersion(),
    portable: IS_PORTABLE,
    packaged: app.isPackaged,
    hooks: { exists: h.exists, missing: Boolean(h.missing), installed: h.installed, total: Object.keys(hooksLib.EVENTS).length, complete: h.complete, file: h.file, error: h.error || '' },
    update: { status: u.status, version: u.version, percent: u.percent, text: updaterLib.describe(u) },
    updateCheck: settings.system.updateCheck,
    versions: { ...versions, current: app.getVersion(), available: Boolean(releaseRepo) },
  };
}

// ---------- settings window ----------
/** What the settings window shows: the look, the other settings and the choices it offers for them. */
function settingsSnapshot() {
  return {
    look: settings.look,
    muted: settings.muted,
    impatientMin: settings.impatientMin,
    finishedToday: celebrateLib.finishedToday(settings.streak, new Date()),
    daily: todaySummary(),
    quietNow: lookLib.isQuiet(new Date(), settings.look.quiet),
    notify: { ...settings.notify, snoozeUntil: snoozed() ? settings.notify.snoozeUntil : 0 },
    notifyChoices: { toast: notifyLib.TOAST, kinds: notifyLib.KINDS, remind: notifyLib.REMIND, autoHide: notifyLib.AUTO_HIDE, snooze: notifyLib.SNOOZE, nested: notifyLib.NESTED },
    quiet: lookLib.QUIET_ORDER.map((id) => ({ id, label: lookLib.QUIET[id].label })),
    patience: lookLib.PATIENCE,
    sizes: lookLib.SIZE_ORDER.map((id) => ({ id, label: lookLib.SIZES[id].label, px: lookLib.SIZES[id].px })),
    opacities: lookLib.OPACITIES,
    place: settings.place,
    placeChoices: { snap: placeLib.SNAP, monitor: placeLib.MONITOR },
    jump: { status: jumpHealthLib.status(jumpHealth), version: jumpHealth.version, okVersion: jumpHealth.okVersion },
    system: systemSnapshot(),
    projectPets: Object.entries(settings.projectLooks || {}).map(([key, v]) => ({ key, folder: basename(key), pet: v.pet, label: PetArt.PETS[v.pet].label })),
  };
}
ipcMain.on('clear-project-look', (_e, key) => {
  if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(settings.projectLooks || {}, key)) return;
  settings.projectLooks = lookLib.setProjectLook(settings.projectLooks, key, null);
  saveSettings();
  push();
});
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
    win.setOpacity(petOpacity());
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
  petPos = placeLib.snapPosition(petPos, displayFor(petPos.x, petPos.y, PET, PET).workArea, PET, settings.place.snap, MARGIN);
  settings.x = petPos.x;
  settings.y = petPos.y;
  saveSettings();
  applyBounds();
  push();
});

/** Opens a chat in Claude Desktop and raises the window above whatever covers it. */
async function jumpTo(id) {
  const info = store.infoOf(id);
  if (info && info.chat) {
    // a Chat tab conversation has no address to open: raise Claude Desktop, which shows it if it is still the open tab
    store.dismiss(id);
    setPanel(0);
    push();
    debugLog(`jump ${id.slice(0, 8)} chat focus: ${await focusClaude()}`);
    return true;
  }
  const url = jumpUrl(store.hostIdOf(id));
  if (!url) return focusTerminal(id);
  store.dismiss(id);
  setPanel(0);
  push();
  // Raise first (it waits for a hidden/minimised window to appear), open the chat at the same time.
  const raised = focusClaude();
  let opened = false;
  try {
    await shell.openExternal(url);
    opened = true;
    debugLog(`jump ${id.slice(0, 8)} opened`);
  } catch (err) {
    debugLog(`jump ${id.slice(0, 8)} openExternal failed: ${err.message}`);
  }
  const focus = await raised;
  debugLog(`jump ${id.slice(0, 8)} focus: ${focus}`);
  if (opened) verifyJump(store.hostIdOf(id), focus === 'focused'); // not awaited: the self-check must never delay the jump
  return true;
}

// ---------- self-check of the jump route ----------
// Claude Desktop can change its claude://code/continue route in an update. After a jump, look at which chat the foreground Claude
// window shows: two misses in a row put a warning in the tray (jump-health.js decides, this only looks).
let jumpHealth = jumpHealthLib.EMPTY;
const JUMP_CHECK_TRIES = 8;
const JUMP_CHECK_GAP_MS = 500;
let jumpCheckSeq = 0;
async function verifyJump(wanted, focused) {
  if (!wanted || SHOT_RUN) return;
  const mine = ++jumpCheckSeq; // only the latest jump is checked: older ones would see the newer jump's chat and count one miss twice
  const version = await readClaudeVersion();
  let answer;
  const seen = [];
  for (let i = 0; i < JUMP_CHECK_TRIES; i++) {
    await new Promise((r) => setTimeout(r, JUMP_CHECK_GAP_MS));
    if (mine !== jumpCheckSeq) return;
    const got = await openChat.query();
    seen.push(got === undefined ? 'busy' : got ? got.slice(0, 14) : 'none');
    if (got === undefined) continue; // the helper was busy with the one-second loop: ask again
    answer = got;
    if (got === wanted) break;
  }
  if (mine !== jumpCheckSeq) return;
  const verdict = jumpHealthLib.outcome({ focused, openHostId: answer, wanted });
  debugLog(`jump check: ${verdict ? (verdict.ok ? 'ok' : 'miss') : 'no verdict'} (answers: ${seen.join(' ')})`);
  if (!verdict) return;
  const before = jumpHealthLib.status(jumpHealth);
  jumpHealth = jumpHealthLib.record(jumpHealthLib.seenVersion(jumpHealth, version), { ok: verdict.ok });
  settings.jumpHealth = jumpHealth;
  saveSettings();
  if (jumpHealthLib.status(jumpHealth) !== before) {
    debugLog(`jump route is now ${jumpHealthLib.status(jumpHealth)}`);
    rebuildTray();
    sendSettings();
  }
}
/** The running Claude Desktop version, '' when unknown. A change flips the self-check to "unverified" until a jump works again. */
async function readClaudeVersion() {
  const claude = await claudeWatcher().state();
  const version = claude ? claude.version : '';
  if (version) {
    const before = jumpHealthLib.status(jumpHealth);
    jumpHealth = jumpHealthLib.seenVersion(jumpHealth, version);
    if (jumpHealth !== settings.jumpHealth) {
      settings.jumpHealth = jumpHealth;
      saveSettings();
      if (jumpHealthLib.status(jumpHealth) !== before) {
        rebuildTray();
        sendSettings();
      }
    }
  }
  return version;
}
let claudeWatcherInstance = null;
/** The PowerShell helper for "is Claude running, which version, which window is in front"; only started when first asked. */
const claudeWatcher = () => claudeWatcherInstance || (claudeWatcherInstance = createClaudeWatcher());
/**
 * A chat that does not run in Claude Desktop (a terminal, VS Code): raise the window its process lives in.
 * A terminal with tabs comes forward as a whole window; the pet cannot pick the tab.
 */
async function focusTerminal(id) {
  const info = store.infoOf(id);
  if (!info || !info.focusable) {
    debugLog(`jump ${id.slice(0, 8)} refused: no desktop session id and no window to raise`);
    return false;
  }
  store.dismiss(id);
  setPanel(0);
  push();
  debugLog(`jump ${id.slice(0, 8)} terminal focus: ${await focusWindowOf(info.pid)}`);
  return true;
}
ipcMain.on('jump', (_e, id) => {
  debugLog(`ipc jump ${String(id).slice(0, 8)}`);
  jumpTo(String(id));
});
// ---------- right-click menu of a row ----------
let rowMenuOpen = false; // the list must not close just because the menu took focus

const isFolder = (p) => {
  try {
    return path.isAbsolute(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Windows Terminal in the folder, or plain PowerShell when it is not installed. Started without a shell, detached. */
function openTerminalIn(cwd) {
  const wt = terminalCommand(cwd);
  if (!wt) return;
  const start = (cmd, args, opts) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
    child.unref();
    return child;
  };
  const fallback = () => start('powershell.exe', ['-NoExit'], { cwd });
  try {
    start(wt.cmd, wt.args).on('error', fallback);
  } catch {
    fallback();
  }
}

/** What each menu item does. `info` comes from the store, never from the renderer: the renderer only says which chat. */
const rowActions = {
  open: (id) => jumpTo(id),
  focus: (id) => jumpTo(id),
  'copy-id': (id, info) => clipboard.writeText(info.sessionId),
  folder: (id, info) => isFolder(info.cwd) && shell.openPath(info.cwd),
  vscode: (id, info) => {
    const url = isFolder(info.cwd) && vscodeUrl(info.cwd);
    if (url) shell.openExternal(url).catch(() => {});
  },
  terminal: (id, info) => isFolder(info.cwd) && openTerminalIn(info.cwd),
  pin: (id) => updatePrefs({ pinned: toggled(settings.prefs.pinned, id) }),
  mute: (id) => updatePrefs({ mutedChats: toggled(settings.prefs.mutedChats, id) }),
};
/** 'ppet:dog' / 'ppet:' from the "Pet for this project" submenu: sets or clears the project's own pet. */
function setProjectPet(info, petId) {
  const key = projectKey(info.cwd);
  if (!key) return;
  settings.projectLooks = lookLib.setProjectLook(settings.projectLooks, key, petId, settings.look.skin);
  saveSettings();
  push();
}
const toggled = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

ipcMain.on('row-menu', (_e, id) => {
  id = String(id);
  const info = store.infoOf(id);
  if (!info || !panelWin || panelWin.isDestroyed()) return;
  debugLog(`ipc row-menu ${id.slice(0, 8)}`);
  const own = (settings.projectLooks || {})[projectKey(info.cwd)];
  const attach = (item) => {
    if (item.submenu) return { ...item, submenu: item.submenu.map(attach) };
    if (!item.id) return item;
    const entry = { ...item, click: () => {
      debugLog(`row-menu ${item.id.startsWith('ppet:') ? 'ppet' : item.id} ${id.slice(0, 8)}`);
      if (item.id.startsWith('ppet:')) setProjectPet(info, item.id.slice(5));
      else rowActions[item.id](id, info);
    } };
    delete entry.id;
    return entry;
  };
  const template = rowMenuTemplate(info, settings.prefs, own ? own.pet : '').map(attach);
  rowMenuOpen = true;
  Menu.buildFromTemplate(template).popup({ window: panelWin, callback: () => { rowMenuOpen = false; } });
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
  const before = settings.look;
  settings.look = lookLib.merge(settings.look, patch);
  if (settings.look.size !== before.size) resizePet(lookLib.sizePx(before.size));
  if (settings.look.opacity !== before.opacity && win && !win.isDestroyed() && petShown) win.setOpacity(petOpacity());
  saveSettings();
  rebuildTray();
  push();
}
/** A new pet size: the window is resized once (a single blink, only when the setting changes) around the pet's centre. */
function resizePet(oldPx) {
  stopSlide();
  PET = lookLib.sizePx(settings.look.size);
  const moved = placeLib.resizeAnchor(petPos, oldPx, PET);
  petPos = clampToDisplays(moved.x, moved.y);
  petPos = placeLib.snapPosition(petPos, displayFor(petPos.x, petPos.y, PET, PET).workArea, PET, settings.place.snap, MARGIN); // a pet snapped to a corner stays in it
  settings.x = petPos.x;
  settings.y = petPos.y;
  applyBounds();
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
  const { toast, toastKinds, remindMin, autoHide, nested } = patch && typeof patch === 'object' ? patch : {};
  updateNotify({ toast, toastKinds, remindMin, autoHide, nested }); // the snooze has its own message: only its presets are accepted
});
/** Placement settings (snap, above fullscreen, monitors, click-through): validated, applied, saved. */
function updatePlace(patch) {
  const before = settings.place;
  settings.place = placeLib.merge(settings.place, patch);
  if (settings.place.fullscreen !== before.fullscreen) {
    raise(win);
    raise(panelWin);
  }
  if (settings.place.snap !== before.snap && settings.place.snap !== 'off' && win && !win.isDestroyed() && !drag) {
    // switching snapping on pulls the pet in at once, so the effect is visible
    petPos = placeLib.snapPosition(petPos, displayFor(petPos.x, petPos.y, PET, PET).workArea, PET, settings.place.snap, MARGIN);
    settings.x = petPos.x;
    settings.y = petPos.y;
    applyBounds();
  }
  if (settings.place.monitor !== before.monitor) followState = { displayId: null, since: 0 };
  saveSettings();
  rebuildTray();
  push();
}
ipcMain.on('set-place', (_e, patch) => updatePlace(patch));
ipcMain.on('set-system', (_e, patch) => {
  const { login, followClaude, watchChat, wsl, updateCheck } = patch && typeof patch === 'object' ? patch : {};
  updateSystem({ login, followClaude, watchChat, wsl, updateCheck }); // setupAsked is the app's own business
});
ipcMain.on('hooks-action', (_e, action) => {
  if (action === 'install' || action === 'uninstall') changeHooks(action, settingsWin);
});
ipcMain.on('wsl-hooks-action', (_e, action) => {
  if (action === 'install' || action === 'uninstall') changeWslHooks(action, settingsWin);
});
ipcMain.on('update-action', (_e, what) => updateAction(what));
ipcMain.on('choose-version', (_e, version) => chooseVersion(String(version), settingsWin));
ipcMain.on('snooze', (_e, minutes) => setSnooze(minutes));
// right-click on the pet: the same minimal menu as the tray icon
ipcMain.on('pet-menu', () => {
  if (!win || win.isDestroyed()) return;
  buildTrayMenu().menu.popup({ window: win });
});
ipcMain.on('preview-sound', (_e, req) => previewSound(req));

// ---------- tray ----------
const JUMP_WARNING = 'Opening a chat from the list no longer seems to work (Claude Desktop may have changed)';
/** What the updater has to say in the menu: only a line while something is going on and a button when there is something to do. */
function updateMenuState() {
  if (!caps().updates) return {};
  const u = updater.state();
  const line = ['available', 'downloading', 'ready'].includes(u.status) ? updaterLib.describe(u) : undefined;
  return { line, action: u.status === 'available' ? 'download' : u.status === 'ready' ? 'install' : undefined };
}
/** The menu of the tray icon and of the pet: the template is pure (tray-menu.js), this attaches the actions. */
function buildTrayMenu() {
  const warning = jumpHealthLib.status(jumpHealth) === 'broken' ? JUMP_WARNING : '';
  const actions = {
    warning: () => openSettings(),
    settings: () => openSettings(),
    'show-pet': () => showPet(false, 30_000),
    'update-download': () => updater.download(),
    'update-install': () => updater.install(),
    'snooze-resume': () => setSnooze(0),
    'clear-finished': () => { store.dismissAllDone(); push(); },
    'reset-position': () => { petPos = defaultPos(); settings.x = petPos.x; settings.y = petPos.y; saveSettings(); applyBounds(); push(); },
    quit: () => app.quit(),
  };
  const attach = (item) => {
    if (item.type === 'separator') return item;
    const out = { label: item.label };
    if (item.enabled === false) out.enabled = false;
    if (item.submenu) out.submenu = item.submenu.map(attach);
    else if (item.id === 'snooze-set') out.click = () => setSnooze(item.min);
    else if (item.id === 'mute') Object.assign(out, { type: 'checkbox', checked: item.checked, click: (i) => applyBehaviour({ muted: i.checked }) });
    else if (actions[item.id]) out.click = actions[item.id];
    return out;
  };
  const template = trayMenuTemplate({
    warning,
    update: updateMenuState(),
    snoozeLabel: snoozed() ? `Snoozed until ${notifyLib.clock(settings.notify.snoozeUntil)}` : null,
    snoozeOptions: notifyLib.SNOOZE,
    muted: settings.muted,
  });
  return { menu: Menu.buildFromTemplate(template.map(attach)), warning };
}
function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Claus');
  rebuildTray = () => {
    // only a route that seems to be broken is worth a tray warning; "Claude was updated, not checked yet" is a note in the System tab
    const { menu, warning } = buildTrayMenu();
    tray.setToolTip(`${snoozed() ? `Claus (snoozed until ${notifyLib.clock(settings.notify.snoozeUntil)})` : 'Claus'}${warning ? `
${warning}` : ''}`);
    tray.setContextMenu(menu);
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
      if (p.hook_event_name === 'Stop' && store.sessions.has(p.session_id)) refreshTokens([p.session_id]); // a finished turn is when the total is worth knowing
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
    if (store.syncRegistry([...readRegistry(), ...wslState.entries])) push();
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
  if (!SHOT_RUN) {
    // which monitor the window the user works in is on (only asked while "follow" is on), and which Claude version runs (every few minutes)
    setInterval(followActiveMonitor, 1000);
    setInterval(pollClaude, 3000);
    setInterval(pollClickThrough, 150);
    setInterval(pollWsl, 5000);
    pollWsl();
    setInterval(pollChats, 1500);
    pollChats(); // a watch that was on at the last quit starts at once
    if (caps().updates) {
      // the automatic check is the one data transfer nobody asked for, so it can be switched off (Settings > System > Updates)
      const autoCheck = () => { if (settings.system.updateCheck) updater.check({ auto: true }); };
      setTimeout(autoCheck, 10_000);
      setInterval(autoCheck, 6 * 3600_000);
    }
    setTimeout(() => firstRun().catch((err) => debugLog(`first run failed: ${err.message}`)), 2500);
    setTimeout(() => readClaudeVersion().catch(() => {}), 5000);
    setInterval(() => readClaudeVersion().catch(() => {}), 5 * 60_000);
  }
  armSnooze(); // a snooze that survived a restart still has to end
  // the "finished today" number starts again at midnight even when nothing else happens
  let shownDay = celebrateLib.dayKey(new Date());
  setInterval(() => {
    const day = celebrateLib.dayKey(new Date());
    if (day !== shownDay) {
      shownDay = day;
      rebuildTray(); // its "Today" line starts again too
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
  if (claudeWatcherInstance) claudeWatcherInstance.stop();
  if (chatWatcherInstance) chatWatcherInstance.stop();
  if (server) server.close();
});
