'use strict';
// Where the pet lives on screen and how it behaves there, kept in pet-settings.json (settings.place):
// snapping, staying above fullscreen apps, following the active monitor and click-through while idle.
// Pure (no Electron, no I/O): validates whatever is loaded or sent and holds the geometry main.js acts on, so it can be unit tested.

const SNAP = [
  { id: 'off', label: 'Off' },
  { id: 'edges', label: 'Screen edges' },
  { id: 'corners', label: 'Corners' },
];
const MONITOR = [
  { id: 'stay', label: 'Stay where I put it' },
  { id: 'follow', label: 'Follow the window I work in' },
];

const DEFAULTS = { snap: 'off', fullscreen: false, monitor: 'stay', clickThrough: false };

const SNAP_THRESHOLD = 24; // px from an edge within which `edges` pulls the pet in
const FOLLOW_AFTER_MS = 3000; // a new monitor must stay the active one this long before the pet moves
const GRAB_HOLD_MS = 1500; // Ctrl-hover keeps click-through off this long after the last forwarded mouse move

function choices() {
  return {
    snap: SNAP.map((s) => s.id),
    monitor: MONITOR.map((m) => m.id),
    fullscreen: [true, false],
    clickThrough: [true, false],
  };
}

/** Returns the settings with every field valid; unknown keys are dropped. */
function sanitize(input, base = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, allowed] of Object.entries(choices())) {
    out[key] = allowed.includes(src[key]) ? src[key] : base[key];
  }
  return out;
}

/** Applies a partial change on top of the current settings. */
function merge(current, patch) {
  return sanitize({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) }, current);
}

const clampNumber = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Keeps a pet of `size` fully inside the work area (`{x, y, width, height}`). */
function clampTo(pos, workArea, size) {
  return {
    x: Math.round(clampNumber(pos.x, workArea.x, workArea.x + workArea.width - size)),
    y: Math.round(clampNumber(pos.y, workArea.y, workArea.y + workArea.height - size)),
  };
}

/**
 * Pulls a dropped pet onto an edge or a corner of the work area, `margin` px from it.
 * `edges`: each axis snaps on its own, only when within `threshold` of that edge. `corners`: always the nearest corner.
 */
function snapPosition(pos, workArea, size, mode, margin = 16, threshold = SNAP_THRESHOLD) {
  const p = clampTo(pos, workArea, size);
  if (mode !== 'edges' && mode !== 'corners') return p;
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - size - margin;
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - size - margin;
  if (mode === 'corners') {
    return {
      x: Math.abs(p.x - left) <= Math.abs(p.x - right) ? left : right,
      y: Math.abs(p.y - top) <= Math.abs(p.y - bottom) ? top : bottom,
    };
  }
  const axis = (v, lo, hi) => {
    if (Math.abs(v - lo) <= threshold + margin) return lo;
    if (Math.abs(v - hi) <= threshold + margin) return hi;
    return v;
  };
  return { x: axis(p.x, left, right), y: axis(p.y, top, bottom) };
}

/** Where the pet is inside the free room of a work area, as fractions (0 = left/top edge, 1 = right/bottom edge). */
function relativeOf(pos, workArea, size) {
  const room = (total) => Math.max(1, total - size);
  return {
    fx: clampNumber((pos.x - workArea.x) / room(workArea.width), 0, 1),
    fy: clampNumber((pos.y - workArea.y) / room(workArea.height), 0, 1),
  };
}

/** The same relative spot on another work area: a pet in the bottom-right corner stays in the bottom-right corner. */
function followTarget(rel, workArea, size) {
  return clampTo(
    {
      x: workArea.x + rel.fx * Math.max(0, workArea.width - size),
      y: workArea.y + rel.fy * Math.max(0, workArea.height - size),
    },
    workArea,
    size
  );
}

/** A pet that changes size keeps its centre where it was. */
function resizeAnchor(pos, oldSize, newSize) {
  const d = (oldSize - newSize) / 2;
  return { x: Math.round(pos.x + d), y: Math.round(pos.y + d) };
}

/**
 * Should the pet move to another monitor? `activeDisplayId` is the monitor of the window the user works in,
 * `candidateSince` is when it became the active one (0 = unknown). Never while the user is busy with the pet.
 */
function shouldFollow({ monitor, activeDisplayId, currentDisplayId, candidateSince, now, dragging, panelOpen, settingsOpen }) {
  if (monitor !== 'follow') return false;
  if (activeDisplayId == null || activeDisplayId === currentDisplayId) return false;
  if (dragging || panelOpen || settingsOpen) return false;
  return Boolean(candidateSince) && now - candidateSince >= FOLLOW_AFTER_MS;
}

/**
 * Should the pet window ignore the mouse (clicks fall through to what is below it)? Only while click-through is on and
 * there is nothing to click: no chat needs you, the list is closed, the pet is not being dragged and the user is not holding Ctrl over it.
 */
function clickThroughDecision({ enabled, attention, panelOpen, dragging, settingsOpen, grabbedAt = 0, cursorInside = false, now }) {
  if (!enabled) return false;
  if (attention > 0 || panelOpen || dragging || settingsOpen) return false;
  // A grab (Ctrl over the pet, or a click on it) lasts GRAB_HOLD_MS, and as long as the cursor stays on the pet: a slow double-click must still land.
  const grabbed = Boolean(grabbedAt) && (now - grabbedAt < GRAB_HOLD_MS || cursorInside);
  return !grabbed;
}

/** Is the cursor on the pet window? (`bounds` = { x, y, width, height } in the same units as `cursor`.) */
function cursorOver(cursor, bounds) {
  return cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height;
}

module.exports = {
  DEFAULTS, SNAP, MONITOR, SNAP_THRESHOLD, FOLLOW_AFTER_MS, GRAB_HOLD_MS,
  choices, sanitize, merge, clampTo, snapPosition, relativeOf, followTarget, resizeAnchor, shouldFollow, clickThroughDecision, cursorOver,
};
