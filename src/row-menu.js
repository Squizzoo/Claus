'use strict';
// The right-click menu of a chat row, as data: which items there are, what they say and whether they apply.
// Pure (no Electron), so it can be unit tested; main.js turns the ids into actions.
const PetArt = require('./renderer/pets');

/**
 * info: what store.infoOf() says about the chat ({sessionId, cwd, hostSessionId, focusable, entrypoint});
 * prefs: the list preferences ({pinned, mutedChats}). Items are {id, label} or {type: 'separator'}.
 */
function rowMenuTemplate(info, prefs, projectPet) {
  if (!info) return [];
  const p = prefs || {};
  if (info.chat) {
    // a Chat tab conversation: nothing to copy or open, only what the pet itself can do with it
    return [
      { id: 'open', label: 'Bring Claude forward' },
      { type: 'separator' },
      { id: 'pin', label: (p.pinned || []).includes(info.sessionId) ? 'Unpin' : 'Pin to the top' },
      { id: 'mute', label: (p.mutedChats || []).includes(info.sessionId) ? 'Unmute this chat' : 'Mute this chat' },
    ];
  }
  const items = [];
  if (info.hostSessionId) items.push({ id: 'open', label: 'Open in Claude' });
  if (info.focusable) items.push({ id: 'focus', label: String(info.entrypoint || '').includes('vscode') ? 'Bring VS Code forward' : 'Bring its terminal forward' });
  if (items.length) items.push({ type: 'separator' });
  items.push({ id: 'copy-id', label: 'Copy session id' });
  if (info.cwd) {
    items.push({ id: 'folder', label: 'Open project folder' }, { id: 'vscode', label: 'Open project in VS Code' }, { id: 'terminal', label: 'Open project in a terminal' });
  }
  items.push({ type: 'separator' });
  items.push({ id: 'pin', label: (p.pinned || []).includes(info.sessionId) ? 'Unpin' : 'Pin to the top' });
  items.push({ id: 'mute', label: (p.mutedChats || []).includes(info.sessionId) ? 'Unmute this chat' : 'Mute this chat' });
  // projectPet: the pet chosen for this chat's project ('' = none, undefined = the feature is not offered here)
  if (info.cwd && typeof projectPet === 'string') items.push({ type: 'separator' }, projectPetMenu(projectPet));
  return items;
}

/** The "Pet for this project" submenu: items carry ids like 'ppet:dog' (or 'ppet:' for "same as everywhere"). */
function projectPetMenu(current) {
  return {
    label: 'Pet for this project',
    submenu: [
      { id: 'ppet:', label: 'Same as everywhere', type: 'radio', checked: !current },
      ...PetArt.ORDER.map((id) => ({ id: `ppet:${id}`, label: PetArt.PETS[id].label, type: 'radio', checked: current === id })),
    ],
  };
}

/**
 * vscode://file/<path> opens a folder in VS Code without starting a process. The path is forward slashes; encodeURI keeps the
 * drive colon, and # and ? (legal in folder names) are escaped by hand so they do not end the path.
 */
function vscodeUrl(cwd) {
  const p = String(cwd || '').replace(/\\/g, '/');
  if (!/^([A-Za-z]:\/|\/)/.test(p)) return null; // only absolute paths
  return `vscode://file/${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

/**
 * Windows Terminal opened in a folder. wt treats an unescaped ; as the start of another command, so each one is escaped.
 * Returns null for a path that is not absolute. The caller starts it without a shell.
 */
function terminalCommand(cwd) {
  const p = String(cwd || '');
  if (!/^([A-Za-z]:[\\/]|\/)/.test(p)) return null;
  return { cmd: 'wt.exe', args: ['-d', p.replace(/;/g, '\\;')] };
}

module.exports = { rowMenuTemplate, vscodeUrl, terminalCommand };
