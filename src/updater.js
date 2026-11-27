'use strict';
// Updates from the GitHub releases of the repository (electron-updater). Nothing is downloaded without a click:
// a check only reports that a newer version exists. Dev checkouts and the portable exe never update themselves.
//
// The state machine is pure (`reduce`) and unit tested; `createUpdater` wires it to electron-updater, which is only required
// when an update is actually checked.

const { feedUrl } = require('./releases');

const EMPTY = { status: 'idle', version: '', percent: 0, error: '' };

/** `unsupported` (dev, portable), `idle`, `checking`, `current`, `available`, `downloading`, `ready`, `error`. */
function reduce(state, event) {
  switch (event.type) {
    case 'unsupported':
      return { ...EMPTY, status: 'unsupported' };
    case 'checking':
      return state.status === 'downloading' || state.status === 'ready' ? state : { ...EMPTY, status: 'checking' };
    case 'none':
      return state.status === 'downloading' || state.status === 'ready' ? state : { ...EMPTY, status: 'current' };
    case 'available':
      return state.status === 'downloading' || state.status === 'ready' ? state : { ...EMPTY, status: 'available', version: cleanVersion(event.version) };
    case 'downloading':
      return { ...state, status: 'downloading', percent: clampPercent(event.percent) };
    case 'ready':
      return { ...state, status: 'ready', percent: 100, version: cleanVersion(event.version) || state.version };
    case 'reset':
      return state.status === 'downloading' ? state : { ...EMPTY };
    case 'error':
      // an error during a check goes back to what was known; an error while downloading is shown
      return { ...state, status: 'error', error: String(event.message || 'unknown error').slice(0, 200) };
    default:
      return state;
  }
}

const cleanVersion = (v) => (/^[0-9][0-9A-Za-z.+-]{0,30}$/.test(String(v || '')) ? String(v) : '');
const clampPercent = (p) => (Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : 0);

/** A short line for the tray and the settings window. */
function describe(state) {
  switch (state.status) {
    case 'unsupported': return 'Updates work in the installed version only';
    case 'checking': return 'Checking for updates...';
    case 'current': return 'Claus is up to date';
    case 'available': return `Version ${state.version} is available`;
    case 'downloading': return `Downloading version ${state.version}... ${state.percent}%`;
    case 'ready': return `Version ${state.version} is ready to install`;
    case 'error': return `Update check failed: ${state.error}`;
    default: return '';
  }
}

/**
 * repo: { owner, repo } of the GitHub releases. `useVersion` points the updater at ONE release (a generic feed on its download folder) and
 * allows going down, so a user can always go back to an older version; the next normal check puts the usual feed back.
 */
function createUpdater({ supported, onChange, log = () => {}, repo = null, loadUpdater = () => require('electron-updater').autoUpdater }) {
  let pinned = false; // a chosen version is the feed right now
  let state = supported ? EMPTY : reduce(EMPTY, { type: 'unsupported' });
  let au = null;
  const set = (event) => {
    const next = reduce(state, event);
    if (next !== state) {
      state = next;
      onChange(state);
    }
  };
  function load() {
    if (au) return au;
    au = loadUpdater();
    au.autoDownload = false; // nothing is downloaded until the user asks
    au.autoInstallOnAppQuit = false;
    au.logger = null;
    au.on('checking-for-update', () => set({ type: 'checking' }));
    au.on('update-not-available', () => set({ type: 'none' }));
    au.on('update-available', (info) => set({ type: 'available', version: info && info.version }));
    au.on('download-progress', (p) => set({ type: 'downloading', percent: p && p.percent }));
    au.on('update-downloaded', (info) => set({ type: 'ready', version: info && info.version }));
    au.on('error', (err) => { log(`update error: ${err && err.message}`); set({ type: 'error', message: err && err.message }); });
    return au;
  }
  return {
    state: () => state,
    /** `auto` is the timer: it leaves a chosen older version alone while that is waiting to be installed. */
    check({ auto = false } = {}) {
      if (!supported) return Promise.resolve(state);
      if (auto && pinned && ['available', 'downloading', 'ready'].includes(state.status)) return Promise.resolve(state);
      return Promise.resolve().then(() => {
        const u = load();
        if (pinned && repo) {
          u.allowDowngrade = false;
          u.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo });
          pinned = false;
        }
        return u.checkForUpdates();
      }).then(() => state, () => state);
    },
    /** Looks for one specific version (newer or older than this one). A click on Download and then Install follows, as for any update. */
    useVersion(version) {
      const url = repo && feedUrl(repo.owner, repo.repo, version);
      if (!supported || !url) return Promise.resolve(state);
      return Promise.resolve().then(() => {
        const u = load();
        set({ type: 'reset' }); // an update that is ready for another version must not hide the chosen one (the reducer ignores a new check then)
        u.allowDowngrade = true;
        u.setFeedURL({ provider: 'generic', url });
        pinned = true;
        return u.checkForUpdates();
      }).then(() => state, () => state);
    },
    download() {
      if (!supported || state.status !== 'available') return Promise.resolve(state);
      set({ type: 'downloading', percent: 0 });
      return Promise.resolve().then(() => load().downloadUpdate()).then(() => state, () => state);
    },
    install() {
      if (!supported || state.status !== 'ready') return false;
      load().quitAndInstall(false, true);
      return true;
    },
  };
}

module.exports = { EMPTY, reduce, describe, createUpdater };
