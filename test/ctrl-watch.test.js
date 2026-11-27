'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCtrl, isStale, backoffMs, STALE_MS, STARTUP_MS } = require('../src/ctrl-watch');

test('parseCtrl reads the streamed lines', () => {
  assert.equal(parseCtrl('ctrl=1'), true);
  assert.equal(parseCtrl(' ctrl=0 \r'), false);
  assert.equal(parseCtrl('ctrl=2'), null);
  assert.equal(parseCtrl('fg=1,2,3,4'), null);
  assert.equal(parseCtrl(null), null);
});

test('a helper that stays silent is stale after STALE_MS', () => {
  assert.equal(isStale(0, 10_000), false); // not started
  assert.equal(isStale(10_000, 10_000 + STALE_MS - 1), false);
  assert.equal(isStale(10_000, 10_000 + STALE_MS), true);
});

test('a helper that has not printed yet gets the longer start-up time', () => {
  assert.ok(STARTUP_MS > STALE_MS);
  assert.equal(isStale(10_000, 10_000 + STALE_MS, STARTUP_MS), false); // cold PowerShell start: not stuck yet
  assert.equal(isStale(10_000, 10_000 + STARTUP_MS, STARTUP_MS), true);
});

test('restarts back off but never wait more than 30 s', () => {
  assert.equal(backoffMs(0), 500);
  assert.equal(backoffMs(1), 1000);
  assert.equal(backoffMs(3), 4000);
  assert.equal(backoffMs(50), 30_000);
});
