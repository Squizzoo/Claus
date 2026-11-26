'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/placement');

const AREA = { x: 0, y: 0, width: 1000, height: 800 };

test('defaults are valid and garbage falls back to them', () => {
  assert.deepEqual(P.sanitize(P.DEFAULTS), P.DEFAULTS);
  for (const bad of [null, undefined, 5, 'x', [], { snap: 'wall' }, { fullscreen: 'yes' }, { monitor: 1 }]) {
    assert.deepEqual(P.sanitize(bad), P.DEFAULTS);
  }
  assert.deepEqual(Object.keys(P.sanitize({ snap: 'edges', evil: 1 })).sort(), Object.keys(P.DEFAULTS).sort());
});

test('merge keeps the current value when the patch is bad', () => {
  const cur = P.sanitize({ snap: 'corners', clickThrough: true });
  assert.equal(P.merge(cur, { snap: 'nope' }).snap, 'corners');
  assert.equal(P.merge(cur, { snap: 'edges' }).snap, 'edges');
  assert.equal(P.merge(cur, { clickThrough: 'x' }).clickThrough, true);
  assert.equal(P.merge(cur, null).snap, 'corners');
});

test('clampTo keeps the pet inside, also when the area is smaller than the pet', () => {
  assert.deepEqual(P.clampTo({ x: -50, y: 900 }, AREA, 100), { x: 0, y: 700 });
  assert.deepEqual(P.clampTo({ x: 500, y: 300 }, AREA, 100), { x: 500, y: 300 });
  assert.deepEqual(P.clampTo({ x: 10, y: 10 }, { x: 5, y: 5, width: 50, height: 50 }, 100), { x: 5, y: 5 });
});

test('snap off only clamps', () => {
  assert.deepEqual(P.snapPosition({ x: 13, y: 22 }, AREA, 100, 'off'), { x: 13, y: 22 });
  assert.deepEqual(P.snapPosition({ x: -20, y: 22 }, AREA, 100, 'off'), { x: 0, y: 22 });
});

test('snap edges pulls close edges in, each axis on its own', () => {
  // right edge is at 1000-100-16 = 884, bottom at 800-100-16 = 684
  assert.deepEqual(P.snapPosition({ x: 880, y: 300 }, AREA, 100, 'edges'), { x: 884, y: 300 });
  assert.deepEqual(P.snapPosition({ x: 20, y: 690 }, AREA, 100, 'edges'), { x: 16, y: 684 });
  assert.deepEqual(P.snapPosition({ x: 500, y: 300 }, AREA, 100, 'edges'), { x: 500, y: 300 });
});

test('snap corners always lands on a corner', () => {
  assert.deepEqual(P.snapPosition({ x: 400, y: 200 }, AREA, 100, 'corners'), { x: 16, y: 16 });
  assert.deepEqual(P.snapPosition({ x: 600, y: 500 }, AREA, 100, 'corners'), { x: 884, y: 684 });
  assert.deepEqual(P.snapPosition({ x: 600, y: 100 }, AREA, 100, 'corners'), { x: 884, y: 16 });
  assert.deepEqual(P.snapPosition({ x: 100, y: 700 }, AREA, 100, 'corners'), { x: 16, y: 684 });
});

test('snap works on a work area that does not start at 0 (second monitor)', () => {
  const second = { x: 1920, y: -200, width: 1280, height: 1000 };
  assert.deepEqual(P.snapPosition({ x: 1930, y: -190 }, second, 150, 'corners'), { x: 1936, y: -184 });
});

test('relativeOf and followTarget keep the same spot on another monitor', () => {
  const rel = P.relativeOf({ x: 884, y: 684 }, AREA, 100); // bottom right, 16 from the edge
  assert.ok(rel.fx > 0.97 && rel.fy > 0.97);
  const other = { x: 1000, y: 0, width: 2000, height: 1000 };
  const pos = P.followTarget(P.relativeOf({ x: 900, y: 700 }, AREA, 100), other, 100);
  assert.ok(pos.x + 100 <= 3000 && pos.y + 100 <= 1000 && pos.x >= 1000);
  assert.deepEqual(P.followTarget({ fx: 0, fy: 0 }, other, 100), { x: 1000, y: 0 });
  assert.deepEqual(P.followTarget({ fx: 1, fy: 1 }, other, 100), { x: 2900, y: 900 });
});

test('relativeOf survives an area that is as small as the pet', () => {
  const r = P.relativeOf({ x: 0, y: 0 }, { x: 0, y: 0, width: 100, height: 100 }, 100);
  assert.deepEqual(r, { fx: 0, fy: 0 });
});

test('resizeAnchor keeps the centre', () => {
  assert.deepEqual(P.resizeAnchor({ x: 100, y: 100 }, 150, 250), { x: 50, y: 50 });
  assert.deepEqual(P.resizeAnchor({ x: 100, y: 100 }, 150, 100), { x: 125, y: 125 });
  assert.deepEqual(P.resizeAnchor({ x: 100, y: 100 }, 150, 150), { x: 100, y: 100 });
});

test('shouldFollow needs follow mode, another monitor, a calm pet and enough time', () => {
  const base = { monitor: 'follow', activeDisplayId: 2, currentDisplayId: 1, candidateSince: 1000, now: 5000, dragging: false, panelOpen: false, settingsOpen: false };
  assert.equal(P.shouldFollow(base), true);
  assert.equal(P.shouldFollow({ ...base, monitor: 'stay' }), false);
  assert.equal(P.shouldFollow({ ...base, activeDisplayId: 1 }), false);
  assert.equal(P.shouldFollow({ ...base, activeDisplayId: null }), false);
  assert.equal(P.shouldFollow({ ...base, now: 2000 }), false); // not long enough yet
  assert.equal(P.shouldFollow({ ...base, candidateSince: 0 }), false);
  for (const busy of ['dragging', 'panelOpen', 'settingsOpen']) assert.equal(P.shouldFollow({ ...base, [busy]: true }), false, busy);
});

test('click-through only while there is nothing to click', () => {
  const base = { enabled: true, attention: 0, panelOpen: false, dragging: false, settingsOpen: false, grabbedAt: 0, now: 10_000 };
  assert.equal(P.clickThroughDecision(base), true);
  assert.equal(P.clickThroughDecision({ ...base, enabled: false }), false);
  assert.equal(P.clickThroughDecision({ ...base, attention: 1 }), false); // done, question or approval: the pet must be clickable
  for (const busy of ['panelOpen', 'dragging', 'settingsOpen']) assert.equal(P.clickThroughDecision({ ...base, [busy]: true }), false, busy);
});

test('holding Ctrl over the pet switches click-through off for a moment', () => {
  const base = { enabled: true, attention: 0, panelOpen: false, dragging: false, settingsOpen: false, now: 10_000 };
  assert.equal(P.clickThroughDecision({ ...base, grabbedAt: 9_500 }), false);
  assert.equal(P.clickThroughDecision({ ...base, grabbedAt: 10_000 - P.GRAB_HOLD_MS - 1 }), true);
});
