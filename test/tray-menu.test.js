'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { trayMenuTemplate } = require('../src/tray-menu');

const ids = (items) => items.map((i) => i.id || '-');
const SNOOZE = [{ min: 15, label: '15 minutes' }, { min: 60, label: '1 hour' }];

test('the menu stays minimal: exactly these items, in this order', () => {
  assert.deepEqual(ids(trayMenuTemplate({ snoozeOptions: SNOOZE })), ['settings', 'show-pet', 'snooze', 'mute', 'clear-finished', 'reset-position', '-', 'quit']);
  assert.deepEqual(ids(trayMenuTemplate()), ['settings', 'show-pet', 'snooze', 'mute', 'clear-finished', 'reset-position', '-', 'quit']);
});

test('snooze is a submenu of the given options, or a resume line while snoozed', () => {
  const t = trayMenuTemplate({ snoozeOptions: SNOOZE });
  assert.deepEqual(t.find((i) => i.id === 'snooze').submenu, [{ id: 'snooze-set', min: 15, label: '15 minutes' }, { id: 'snooze-set', min: 60, label: '1 hour' }]);
  const s = trayMenuTemplate({ snoozeLabel: 'Snoozed until 14:30', snoozeOptions: SNOOZE });
  assert.equal(s.find((i) => i.id === 'snooze'), undefined);
  assert.equal(s.find((i) => i.id === 'snooze-resume').label, 'Snoozed until 14:30 - Resume');
});

test('mute is a checkbox that follows the setting', () => {
  assert.equal(trayMenuTemplate({ muted: true }).find((i) => i.id === 'mute').checked, true);
  assert.equal(trayMenuTemplate({ muted: false }).find((i) => i.id === 'mute').checked, false);
});

test('a jump warning and a pending update only appear when there is one', () => {
  const warn = trayMenuTemplate({ warning: 'Jump broke' });
  assert.deepEqual(ids(warn).slice(0, 3), ['warning', '-', 'settings']);
  assert.equal(warn[0].label, '⚠ Jump broke');
  assert.deepEqual(ids(trayMenuTemplate({ update: { line: 'Update 1.2 available', action: 'download' } })).slice(0, 4), ['update-line', 'update-download', '-', 'settings']);
  assert.deepEqual(ids(trayMenuTemplate({ update: { action: 'install' } })).slice(0, 3), ['update-install', '-', 'settings']);
  assert.equal(trayMenuTemplate({ update: { line: 'Checking', action: undefined } })[0].enabled, false);
  // never an always-on "Check for updates"
  assert.equal(trayMenuTemplate({ update: {} }).some((i) => /check for updates/i.test(i.label || '')), false);
});
