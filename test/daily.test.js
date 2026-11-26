'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const daily = require('../src/daily');

const MIN = 60_000;
const monday = new Date(2026, 10, 23, 10, 0);
const tuesday = new Date(2026, 10, 24, 9, 0);

test('waits add up and the longest one is remembered', () => {
  let d = daily.EMPTY;
  d = daily.recordWait(d, 2 * MIN, monday);
  d = daily.recordWait(d, 6 * MIN, monday);
  d = daily.recordWait(d, 1 * MIN, monday);
  assert.deepEqual(daily.summary(d, 3, monday), { finished: 3, waits: 3, waitMs: 9 * MIN, longestMs: 6 * MIN, workMs: 0 });
});

test('work time adds up, and one absurd turn is capped', () => {
  let d = daily.recordWork(daily.EMPTY, 10 * MIN, monday);
  d = daily.recordWork(d, 5 * MIN, monday);
  d = daily.recordWork(d, 0, monday);
  d = daily.recordWork(d, -3, monday);
  assert.equal(daily.summary(d, 0, monday).workMs, 15 * MIN);
  assert.equal(daily.recordWork(daily.EMPTY, 40 * 3_600_000, monday).workMs, daily.WORK_CAP_MS);
});

test('a wait longer than the cap is an abandoned chat and does not count', () => {
  const d = daily.recordWait(daily.EMPTY, daily.WAIT_CAP_MS + 1, monday);
  assert.equal(d.waits, 0);
  assert.equal(daily.recordWait(daily.EMPTY, daily.WAIT_CAP_MS, monday).waits, 1);
  assert.equal(daily.recordWait(daily.EMPTY, -1, monday).waits, 0);
});

test('a new day starts from zero, and an old day shows as zero', () => {
  const d = daily.recordWait(daily.EMPTY, 5 * MIN, monday);
  assert.equal(daily.summary(d, 4, tuesday).waits, 0);
  assert.equal(daily.recordWait(d, 1 * MIN, tuesday).waits, 1);
  assert.equal(daily.recordWait(d, 1 * MIN, tuesday).day, '2026-11-24');
});

test('sanitize accepts a good summary and repairs a bad one', () => {
  const good = { day: '2026-11-23', waits: 2, waitMs: 5000, longestMs: 4000, workMs: 9000 };
  assert.deepEqual(daily.sanitize(good), good);
  assert.deepEqual(daily.sanitize(null), daily.EMPTY);
  assert.deepEqual(daily.sanitize({ ...good, day: 'yesterday' }), daily.EMPTY);
  assert.deepEqual(daily.sanitize({ day: '2026-11-23', waits: 'many', waitMs: -5, longestMs: NaN, workMs: Infinity, extra: 1 }), { day: '2026-11-23', waits: 0, waitMs: 0, longestMs: 0, workMs: 0 });
});
