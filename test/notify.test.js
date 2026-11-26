'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/notify');

const NOW = 1_000_000;

test('defaults are valid and unknown or bad values fall back', () => {
  assert.deepEqual(N.sanitize({}, N.DEFAULTS, NOW), N.DEFAULTS);
  assert.deepEqual(N.sanitize(null, N.DEFAULTS, NOW), N.DEFAULTS);
  const bad = N.sanitize({ toast: 'loud', remindMin: 7, autoHide: 'x', extra: 1 }, N.DEFAULTS, NOW);
  assert.deepEqual(bad, N.DEFAULTS);
  assert.equal('extra' in bad, false);
});

test('merge applies valid changes and keeps the rest', () => {
  const a = N.merge(N.DEFAULTS, { toast: 'always', remindMin: 5 }, NOW);
  assert.equal(a.toast, 'always');
  assert.equal(a.remindMin, 5);
  assert.equal(a.autoHide, 'off');
  const b = N.merge(a, { remindMin: 99, autoHide: 'peek' }, NOW);
  assert.equal(b.remindMin, 5); // invalid value ignored
  assert.equal(b.autoHide, 'peek');
});

test('snoozeUntil must be a finite future time within a day', () => {
  assert.equal(N.sanitizeSnooze(NOW + 60_000, NOW), NOW + 60_000);
  assert.equal(N.sanitizeSnooze(NOW - 1, NOW), 0);
  assert.equal(N.sanitizeSnooze(NOW + N.MAX_SNOOZE_MS + 1, NOW), 0);
  assert.equal(N.sanitizeSnooze(NaN, NOW), 0);
  assert.equal(N.sanitizeSnooze(Infinity, NOW), 0);
  assert.equal(N.sanitizeSnooze('soon', NOW), 0);
  // a saved snooze that already ended is dropped on load, one still running is kept
  assert.equal(N.sanitize({ snoozeUntil: NOW - 5 }, N.DEFAULTS, NOW).snoozeUntil, 0);
  assert.equal(N.sanitize({ snoozeUntil: NOW + 5 }, N.DEFAULTS, NOW).snoozeUntil, NOW + 5);
  // a patch without snoozeUntil keeps the running snooze; an explicit 0 ends it
  const on = N.merge(N.DEFAULTS, { snoozeUntil: NOW + 9000 }, NOW);
  assert.equal(N.merge(on, { toast: 'off' }, NOW).snoozeUntil, NOW + 9000);
  assert.equal(N.merge(on, { snoozeUntil: 0 }, NOW).snoozeUntil, 0);
});

test('isSnoozed and snoozeEnd', () => {
  assert.equal(N.isSnoozed(NOW + 1, NOW), true);
  assert.equal(N.isSnoozed(NOW, NOW), false);
  assert.equal(N.isSnoozed(0, NOW), false);
  assert.equal(N.snoozeEnd(15, NOW), NOW + 15 * 60_000);
  assert.equal(N.snoozeEnd(60, NOW), NOW + 3600_000);
  assert.equal(N.snoozeEnd(7, NOW), 0); // only the presets
  assert.equal(N.snoozeEnd(0, NOW), 0);
});

test('shouldToast follows the mode, the snooze and where the pet is', () => {
  const base = { snoozed: false, petVisible: true, cursorOnPetDisplay: true };
  assert.equal(N.shouldToast({ ...base, mode: 'away' }), false); // pet is right there
  assert.equal(N.shouldToast({ ...base, mode: 'away', petVisible: false }), true);
  assert.equal(N.shouldToast({ ...base, mode: 'away', cursorOnPetDisplay: false }), true);
  assert.equal(N.shouldToast({ ...base, mode: 'always' }), true);
  assert.equal(N.shouldToast({ ...base, mode: 'off', petVisible: false }), false);
  assert.equal(N.shouldToast({ ...base, mode: 'always', snoozed: true }), false);
});

test('filterFocused drops only the chat open in front', () => {
  const host = { a: 'local_1', b: 'local_2', c: null };
  const hostIdOf = (id) => host[id] ?? null;
  const alerts = [{ id: 'a', state: 'done' }, { id: 'b', state: 'question' }, { id: 'c', state: 'done' }];
  assert.deepEqual(N.filterFocused(alerts, hostIdOf, 'local_1').map((x) => x.id), ['b', 'c']);
  assert.deepEqual(N.filterFocused(alerts, hostIdOf, null), alerts);
  assert.deepEqual(N.filterFocused(alerts, hostIdOf, 'local_9'), alerts);
});

test('autoHideDecision: off never hides, and shows a hidden pet', () => {
  assert.equal(N.autoHideDecision({ mode: 'off', visible: true, sessions: 0, attention: 0, now: NOW }), 'keep');
  assert.equal(N.autoHideDecision({ mode: 'off', visible: false, sessions: 0, attention: 0, now: NOW }), 'show');
});

test('autoHideDecision: empty hides the pet when there are no chats, after the grace', () => {
  const s = { mode: 'empty', visible: true, sessions: 0, attention: 0, panelOpen: false, dragging: false, hovering: false, settingsOpen: false };
  assert.equal(N.autoHideDecision({ ...s, lastNeedAt: NOW - 1000, now: NOW }), 'keep'); // still inside the grace
  assert.equal(N.autoHideDecision({ ...s, lastNeedAt: NOW - N.HIDE_GRACE_MS, now: NOW }), 'hide');
  assert.equal(N.autoHideDecision({ ...s, visible: false, now: NOW }), 'keep');
  assert.equal(N.autoHideDecision({ ...s, visible: false, sessions: 1, now: NOW }), 'show');
  assert.equal(N.autoHideDecision({ ...s, sessions: 1, now: NOW }), 'keep');
});

test('autoHideDecision: peek shows only while a chat needs you', () => {
  const s = { mode: 'peek', visible: false, sessions: 3, attention: 0, panelOpen: false, dragging: false, hovering: false, settingsOpen: false, lastNeedAt: 0, now: NOW };
  assert.equal(N.autoHideDecision(s), 'keep'); // chats working, nothing needs you
  assert.equal(N.autoHideDecision({ ...s, attention: 1 }), 'show');
  assert.equal(N.autoHideDecision({ ...s, visible: true, attention: 1 }), 'keep');
  assert.equal(N.autoHideDecision({ ...s, visible: true, lastNeedAt: NOW - N.HIDE_GRACE_MS }), 'hide');
});

test('autoHideDecision: never hides while in use or just shown by hand', () => {
  const s = { mode: 'peek', visible: true, sessions: 0, attention: 0, lastNeedAt: 0, now: NOW, panelOpen: false, dragging: false, hovering: false, settingsOpen: false };
  assert.equal(N.autoHideDecision(s), 'hide');
  for (const key of ['panelOpen', 'dragging', 'hovering', 'settingsOpen']) {
    assert.equal(N.autoHideDecision({ ...s, [key]: true }), 'keep', key);
  }
  assert.equal(N.autoHideDecision({ ...s, manualShowUntil: NOW + 1 }), 'keep');
  assert.equal(N.autoHideDecision({ ...s, manualShowUntil: NOW }), 'hide');
});

test('edgeStart handles each edge, ties and a second monitor', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(N.edgeStart({ x: 1754, y: 874 }, wa, 150), { x: 1920, y: 874 }); // the default corner: 16 px from right and bottom, ties go left, right, top, bottom
  assert.deepEqual(N.edgeStart({ x: 5, y: 400 }, wa, 150), { x: -150, y: 400 });
  assert.deepEqual(N.edgeStart({ x: 1760, y: 400 }, wa, 150), { x: 1920, y: 400 });
  assert.deepEqual(N.edgeStart({ x: 800, y: 5 }, wa, 150), { x: 800, y: -150 });
  assert.deepEqual(N.edgeStart({ x: 800, y: 880 }, wa, 150), { x: 800, y: 1040 });
  const second = { x: 1920, y: 0, width: 1280, height: 1000 };
  assert.deepEqual(N.edgeStart({ x: 1930, y: 300 }, second, 150), { x: 1770, y: 300 });
});

test('slideAt eases from start to end and clamps', () => {
  const from = { x: 0, y: 100 };
  const to = { x: 100, y: 100 };
  assert.deepEqual(N.slideAt(from, to, 0), from);
  assert.deepEqual(N.slideAt(from, to, 1), to);
  assert.deepEqual(N.slideAt(from, to, 2), to);
  assert.ok(N.slideAt(from, to, 0.5).x > 50); // fast at the start, slow at the end
});

test('toast kinds: default on, partial patches only change the kinds they name, bad values are ignored', () => {
  assert.deepEqual(N.DEFAULTS.toastKinds, { question: true, approval: true, done: true });
  const a = N.merge(N.DEFAULTS, { toastKinds: { done: false } }, NOW);
  assert.deepEqual(a.toastKinds, { question: true, approval: true, done: false });
  const b = N.merge(a, { toastKinds: { question: false, done: 'yes', other: false } }, NOW);
  assert.deepEqual(b.toastKinds, { question: false, approval: true, done: false });
  assert.deepEqual(N.merge(b, { toast: 'always' }, NOW).toastKinds, b.toastKinds); // other patches keep them
  assert.deepEqual(N.sanitize({ toastKinds: 5 }, N.DEFAULTS, NOW).toastKinds, N.DEFAULTS.toastKinds);
});

test('shouldToast skips kinds that are switched off', () => {
  const base = { mode: 'always', snoozed: false, petVisible: true, cursorOnPetDisplay: true, kinds: { question: true, approval: true, done: false } };
  assert.equal(N.shouldToast({ ...base, state: 'question' }), true);
  assert.equal(N.shouldToast({ ...base, state: 'done' }), false);
  assert.equal(N.shouldToast({ ...base, state: 'approval' }), true);
});
