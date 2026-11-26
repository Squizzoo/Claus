'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCelebrator, dayKey, sanitizeStreak, bumpStreak, finishedToday } = require('../src/celebrate');

test('three finishes within a minute make a celebration of three', () => {
  const c = createCelebrator();
  assert.equal(c.record(0), 0);
  assert.equal(c.record(20_000), 0);
  assert.equal(c.record(40_000), 3);
});

test('finishes that are too far apart do not add up', () => {
  const c = createCelebrator();
  assert.equal(c.record(0), 0);
  assert.equal(c.record(50_000), 0);
  assert.equal(c.record(100_000), 0); // the first one is a minute old by now
  assert.equal(c.record(110_000), 0); // and the one at 50 s is exactly a minute old: only two left
  assert.equal(c.record(120_000), 3); // 100 s, 110 s, 120 s
});

test('after a celebration there is a cooldown, then the next burst counts again', () => {
  const c = createCelebrator();
  for (const t of [0, 1000]) c.record(t);
  assert.equal(c.record(2000), 3);
  for (const t of [3000, 4000, 5000]) assert.equal(c.record(t), 0, 'inside the cooldown');
  assert.equal(c.record(70_000), 0);
  assert.equal(c.record(71_000), 0);
  assert.equal(c.record(72_000), 3);
});

test('the thresholds can be changed', () => {
  const c = createCelebrator({ min: 2, windowMs: 1000 });
  assert.equal(c.record(0), 0);
  assert.equal(c.record(500), 2);
});

test('dayKey is the local calendar day', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});

test('the day counter counts up, starts again on a new day and is 0 for a stale day', () => {
  let s = bumpStreak({ day: '', count: 0 }, new Date(2026, 4, 1, 9));
  assert.deepEqual(s, { day: '2026-05-01', count: 1 });
  s = bumpStreak(s, new Date(2026, 4, 1, 17));
  assert.equal(s.count, 2);
  assert.equal(finishedToday(s, new Date(2026, 4, 1, 23, 59)), 2);
  assert.equal(finishedToday(s, new Date(2026, 4, 2, 0, 1)), 0, 'the next morning it reads 0 before anything finishes');
  s = bumpStreak(s, new Date(2026, 4, 2, 8));
  assert.deepEqual(s, { day: '2026-05-02', count: 1 });
});

test('a damaged streak in the settings file becomes an empty one', () => {
  for (const bad of [null, undefined, 3, 'x', {}, { day: 'yesterday', count: 4 }, { day: '2026-05-01', count: -3 }, { day: '2026-05-01', count: 'many' }, { day: 5, count: 1 }]) {
    const s = sanitizeStreak(bad);
    assert.equal(typeof s.day, 'string');
    assert.ok(Number.isInteger(s.count) && s.count >= 0);
  }
  assert.deepEqual(sanitizeStreak({ day: 'yesterday', count: 4 }), { day: '', count: 0 });
  assert.deepEqual(sanitizeStreak({ day: '2026-05-01', count: 1e9 }), { day: '2026-05-01', count: 99_999 });
  assert.deepEqual(sanitizeStreak({ day: '2026-05-01', count: 4, extra: 1 }), { day: '2026-05-01', count: 4 });
});
