'use strict';
// How the pet notifies you, kept in pet-settings.json (settings.notify): toasts, repeat reminders, auto-hide and snooze.
// Pure (no Electron, no I/O): validates whatever is loaded or sent, and holds the decisions main.js acts on, so they can be unit tested.

const TOAST = [
  { id: 'away', label: 'When the pet is not visible' },
  { id: 'always', label: 'Always' },
  { id: 'off', label: 'Off' },
];
const REMIND = [
  { min: 0, label: 'Off' },
  { min: 2, label: '2 minutes' },
  { min: 5, label: '5 minutes' },
  { min: 10, label: '10 minutes' },
  { min: 15, label: '15 minutes' },
];
const AUTO_HIDE = [
  { id: 'off', label: 'Off' },
  { id: 'empty', label: 'When nothing is open' },
  { id: 'peek', label: 'Only when a chat needs me' },
];
const SNOOZE = [
  { min: 15, label: '15 minutes' },
  { min: 60, label: '1 hour' },
];

const MAX_SNOOZE_MS = 24 * 3600_000;
const HIDE_GRACE_MS = 4000; // a pet that no longer needs to be seen stays this long, so it does not flicker
const SLIDE_MS = 200;

const DEFAULTS = { toast: 'away', remindMin: 0, autoHide: 'off', snoozeUntil: 0 };

function choices() {
  return {
    toast: TOAST.map((t) => t.id),
    remindMin: REMIND.map((r) => r.min),
    autoHide: AUTO_HIDE.map((a) => a.id),
  };
}

/** A snooze end time that is a finite number in the future, at most a day ahead; anything else means "not snoozed" (0). */
function sanitizeSnooze(value, now = Date.now()) {
  return Number.isFinite(value) && value > now && value <= now + MAX_SNOOZE_MS ? Math.round(value) : 0;
}

/** Returns the settings with every field valid; unknown keys are dropped. */
function sanitize(input, base = DEFAULTS, now = Date.now()) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, allowed] of Object.entries(choices())) {
    out[key] = allowed.includes(src[key]) ? src[key] : base[key];
  }
  out.snoozeUntil = 'snoozeUntil' in src ? sanitizeSnooze(src.snoozeUntil, now) : sanitizeSnooze(base.snoozeUntil, now);
  return out;
}

/** Applies a partial change on top of the current settings. */
function merge(current, patch, now = Date.now()) {
  return sanitize({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) }, current, now);
}

function isSnoozed(until, now = Date.now()) {
  return Number.isFinite(until) && until > now;
}

/** The end time for "snooze for this many minutes" (only the presets are accepted), or 0 to end the snooze. */
function snoozeEnd(minutes, now = Date.now()) {
  return SNOOZE.some((s) => s.min === minutes) ? now + minutes * 60_000 : 0;
}

/** Should this alert also show a Windows toast? Muted chats never get here: the store drops their alerts. */
function shouldToast({ mode, snoozed, petVisible, cursorOnPetDisplay }) {
  if (snoozed || mode === 'off') return false;
  if (mode === 'always') return true;
  return !petVisible || !cursorOnPetDisplay;
}

/** Drops the alerts of the chat that is open in the foreground Claude window (the one you are looking at). */
function filterFocused(alerts, hostIdOf, openHostId) {
  if (!openHostId) return alerts;
  return alerts.filter((a) => hostIdOf(a.id) !== openHostId);
}

/**
 * Should the pet be on screen? `mode` is the auto-hide setting. Returns 'show', 'hide' or 'keep' (leave it as it is).
 * `needed` is true while the pet has a reason to be seen: any chat for `empty`, a chat that needs you for `peek`.
 * `lastNeedAt` is when that last was the case, so the pet only leaves after a short grace.
 */
function autoHideDecision({ mode, visible, sessions, attention, panelOpen, dragging, hovering, settingsOpen, manualShowUntil = 0, lastNeedAt = 0, now }) {
  if (mode !== 'empty' && mode !== 'peek') return visible ? 'keep' : 'show';
  const needed = mode === 'empty' ? sessions > 0 : attention > 0;
  if (needed) return visible ? 'keep' : 'show';
  if (!visible) return 'keep';
  if (panelOpen || dragging || hovering || settingsOpen || now < manualShowUntil) return 'keep';
  return now - lastNeedAt >= HIDE_GRACE_MS ? 'hide' : 'keep';
}

/**
 * Where the peek slide starts: the pet's position pushed off the screen edge nearest to it
 * (workArea = {x, y, width, height}), so it slides in from the side it lives on.
 */
function edgeStart(pos, workArea, size) {
  const left = pos.x - workArea.x;
  const right = workArea.x + workArea.width - (pos.x + size);
  const top = pos.y - workArea.y;
  const bottom = workArea.y + workArea.height - (pos.y + size);
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { x: workArea.x - size, y: pos.y };
  if (nearest === right) return { x: workArea.x + workArea.width, y: pos.y };
  if (nearest === top) return { x: pos.x, y: workArea.y - size };
  return { x: pos.x, y: workArea.y + workArea.height };
}

/** Position `t` (0..1) of the way from `from` to `to`, easing out. */
function slideAt(from, to, t) {
  const k = 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
  return { x: Math.round(from.x + (to.x - from.x) * k), y: Math.round(from.y + (to.y - from.y) * k) };
}

/** "14:30" in local time. */
function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

module.exports = {
  DEFAULTS, TOAST, REMIND, AUTO_HIDE, SNOOZE, MAX_SNOOZE_MS, HIDE_GRACE_MS, SLIDE_MS,
  choices, sanitize, merge, sanitizeSnooze, isSnoozed, snoozeEnd,
  shouldToast, filterFocused, autoHideDecision, edgeStart, slideAt, clock,
};
