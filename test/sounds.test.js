'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PACKS, PACK_ORDER, DEFAULT_PACK, VOLUMES, DEFAULT_VOLUME, KINDS, topKind, plan } = require('../src/renderer/sounds');

test('the pack registry lists every pack once, and the default is the first', () => {
  assert.deepEqual([...PACK_ORDER].sort(), Object.keys(PACKS).sort());
  assert.equal(PACK_ORDER[0], DEFAULT_PACK);
  assert.equal(DEFAULT_VOLUME, 100);
  assert.ok(VOLUMES.includes(DEFAULT_VOLUME));
});

for (const id of PACK_ORDER) {
  test(`${id}: has a tune for every kind of notification`, () => {
    const pack = PACKS[id];
    assert.ok(['sine', 'square', 'triangle', 'sawtooth'].includes(pack.wave));
    for (const kind of KINDS) {
      const tune = pack.kinds[kind];
      assert.ok(tune && tune.notes.length >= 2, `${id} ${kind}`);
      assert.ok(tune.notes.every((f) => f >= 100 && f <= 4000), `${id} ${kind} frequencies`);
      assert.ok(tune.step > 0);
    }
  });
}

test('the default pack at 100 % plays the original chimes', () => {
  assert.deepEqual(plan('chime', 'done', 100).map((n) => n.freq), [660, 880]);
  assert.deepEqual(plan('chime', 'question', 100).map((n) => n.freq), [587, 740, 880]);
  assert.deepEqual(plan('chime', 'approval', 100).map((n) => n.freq), [880, 698, 880]);
  assert.deepEqual(plan('chime', 'overdue', 100).map((n) => n.freq), [523, 440, 523, 440]);
  const [first, second] = plan('chime', 'done', 100);
  assert.equal(first.gain, 0.12);
  assert.equal(first.wave, 'sine');
  assert.equal(first.len, 0.28);
  assert.ok(Math.abs(second.start - 0.13) < 1e-9);
  assert.equal(plan('chime', 'overdue', 100)[0].wave, 'triangle');
});

test('volume scales the gain, 0 is silent, out-of-range values are clamped', () => {
  assert.equal(plan('chime', 'done', 50)[0].gain, 0.06);
  assert.deepEqual(plan('chime', 'done', 0), []);
  assert.deepEqual(plan('chime', 'done', 'loud').length, 0);
  assert.equal(plan('chime', 'done', 500)[0].gain, 0.12);
  assert.deepEqual(plan('chime', 'done', -5), []);
});

test('an unknown pack or kind still plays something sensible', () => {
  assert.ok(plan('nope', 'done').length > 0);
  assert.ok(plan('chime', 'nope').length > 0);
});

test('when several kinds arrive together the most urgent one is played', () => {
  assert.equal(topKind(['done', 'question']), 'question');
  assert.equal(topKind(['done', 'approval', 'question']), 'approval');
  assert.equal(topKind(['done', 'overdue']), 'overdue');
  assert.equal(topKind(['done']), 'done');
  assert.equal(topKind([]), 'done');
});
