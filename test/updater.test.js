'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/updater');

const run = (events, from = U.EMPTY) => events.reduce((s, e) => U.reduce(s, e), from);

test('check -> available -> downloading -> ready', () => {
  let s = run([{ type: 'checking' }]);
  assert.equal(s.status, 'checking');
  s = run([{ type: 'available', version: '0.2.0' }], s);
  assert.deepEqual([s.status, s.version], ['available', '0.2.0']);
  s = run([{ type: 'downloading', percent: 41.6 }], s);
  assert.deepEqual([s.status, s.percent, s.version], ['downloading', 42, '0.2.0']);
  s = run([{ type: 'ready', version: '0.2.0' }], s);
  assert.deepEqual([s.status, s.percent], ['ready', 100]);
});

test('no update means up to date', () => {
  assert.equal(run([{ type: 'checking' }, { type: 'none' }]).status, 'current');
});

test('a later check never throws away a download in progress or a ready update', () => {
  const downloading = run([{ type: 'available', version: '0.2.0' }, { type: 'downloading', percent: 10 }]);
  assert.equal(U.reduce(downloading, { type: 'checking' }), downloading);
  assert.equal(U.reduce(downloading, { type: 'none' }), downloading);
  assert.equal(U.reduce(downloading, { type: 'available', version: '0.3.0' }), downloading);
  const ready = U.reduce(downloading, { type: 'ready', version: '0.2.0' });
  assert.equal(U.reduce(ready, { type: 'checking' }), ready);
});

test('odd input is cleaned: bad versions are dropped, percent is clamped, errors are shortened', () => {
  assert.equal(run([{ type: 'available', version: '<script>' }]).version, '');
  assert.equal(run([{ type: 'downloading', percent: 900 }]).percent, 100);
  assert.equal(run([{ type: 'downloading', percent: -3 }]).percent, 0);
  assert.equal(run([{ type: 'downloading', percent: 'x' }]).percent, 0);
  const e = run([{ type: 'error', message: 'x'.repeat(500) }]);
  assert.equal(e.status, 'error');
  assert.equal(e.error.length, 200);
  assert.equal(run([{ type: 'error' }]).error, 'unknown error');
  assert.equal(U.reduce(U.EMPTY, { type: 'nonsense' }), U.EMPTY);
});

test('describe gives a line for every status', () => {
  for (const status of ['unsupported', 'checking', 'current', 'available', 'downloading', 'ready', 'error']) {
    assert.ok(U.describe({ ...U.EMPTY, status, version: '1.0.0', error: 'boom' }).length > 0, status);
  }
  assert.equal(U.describe(U.EMPTY), '');
});

test('an unsupported updater never loads electron-updater and never changes state', async () => {
  const seen = [];
  const u = U.createUpdater({ supported: false, onChange: (s) => seen.push(s.status) });
  assert.equal(u.state().status, 'unsupported');
  assert.equal((await u.check()).status, 'unsupported');
  assert.equal((await u.download()).status, 'unsupported');
  assert.equal(u.install(), false);
  assert.deepEqual(seen, []);
});
