'use strict';
// The right-click menu of the tray icon and of the pet, as data. Minimal on purpose: everything else is in the settings window.
// Pure (no Electron), so a test can pin the exact list; main.js turns the ids into actions.

/**
 * state: {warning: string, update: {line?: string, action?: 'download'|'install'}, snoozeLabel: string|null, snoozeOptions: [{min, label}], muted: bool}
 * (snoozeLabel is the "Snoozed until ..." text while a snooze runs, else null.) Items are {id, label, ...} or {type: 'separator'}.
 */
function trayMenuTemplate(state) {
  const s = state || {};
  const items = [];
  // Only while something needs action: the jump warning and a pending update.
  if (s.warning) items.push({ id: 'warning', label: `⚠ ${s.warning}` }, { type: 'separator' });
  const u = s.update || {};
  if (u.line) items.push({ id: 'update-line', label: u.line, enabled: false });
  if (u.action === 'download') items.push({ id: 'update-download', label: 'Download the update' });
  else if (u.action === 'install') items.push({ id: 'update-install', label: 'Restart to update' });
  if (u.line || u.action) items.push({ type: 'separator' });

  items.push({ id: 'settings', label: 'Settings...' }, { id: 'show-pet', label: 'Show pet' });
  if (s.snoozeLabel) items.push({ id: 'snooze-resume', label: `${s.snoozeLabel} - Resume` });
  else items.push({ id: 'snooze', label: 'Snooze', submenu: (s.snoozeOptions || []).map(({ min, label }) => ({ id: 'snooze-set', min, label })) });
  items.push(
    { id: 'mute', label: 'Mute sounds', type: 'checkbox', checked: Boolean(s.muted) },
    { id: 'clear-finished', label: 'Clear finished' },
    { id: 'reset-position', label: 'Reset position' },
    { type: 'separator' },
    { id: 'quit', label: 'Quit' }
  );
  return items;
}

module.exports = { trayMenuTemplate };
