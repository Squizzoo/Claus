'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../src/jump-health');

test('parseVersion reads the version from the running Claude.exe path only', () => {
  assert.equal(J.parseVersion('C:\\Program Files\\WindowsApps\\Claude_6.28899.6.0_x64__pzs8sxrjxfjjc\\app\\Claude.exe'), '6.28899.6.0');
  assert.equal(J.parseVersion('C:\\Program Files\\WindowsApps\\Claude_6.1.0.0_x64__x\\app\\claude.exe'), '6.1.0.0');
  for (const bad of ['', null, undefined, 5, 'C:\\Users\\me\\.claude\\claude.exe', 'C:\\x\\Claude_evil;rm_x\\app\\Claude.exe']) assert.equal(J.parseVersion(bad), '');
});

test('sanitize drops junk and unknown keys', () => {
  assert.deepEqual(J.sanitize(null), J.EMPTY);
  assert.deepEqual(J.sanitize({ failures: -1, lastOk: 'x', okVersion: '<b>', version: 7, evil: 1 }), J.EMPTY);
  assert.deepEqual(J.sanitize({ failures: 2, lastOk: 99.4, okVersion: '1.2', version: '1.3' }), { failures: 2, lastOk: 99, okVersion: '1.2', version: '1.3' });
});

test('two misses in a row are broken, a success resets', () => {
  let s = J.EMPTY;
  assert.equal(J.status(s), 'ok');
  s = J.record(s, { ok: false });
  assert.equal(J.status(s), 'ok');
  s = J.record(s, { ok: false });
  assert.equal(J.status(s), 'broken');
  s = J.record(s, { ok: true, now: 5 });
  assert.equal(J.status(s), 'ok');
  assert.equal(s.lastOk, 5);
});

test('a version change is unverified until a jump works again', () => {
  let s = J.seenVersion(J.EMPTY, '6.1');
  s = J.record(s, { ok: true, now: 1 });
  assert.equal(s.okVersion, '6.1');
  s = J.seenVersion(s, '6.2');
  assert.equal(J.status(s), 'unverified');
  s = J.record(s, { ok: true, now: 2 });
  assert.equal(J.status(s), 'ok');
  assert.equal(s.okVersion, '6.2');
});

test('seenVersion ignores empty or invalid versions', () => {
  const s = J.seenVersion(J.EMPTY, '6.1');
  assert.equal(J.seenVersion(s, ''), s);
  assert.equal(J.seenVersion(s, 'x'), s);
});

test('outcome: only a different chat id after a successful raise is a miss', () => {
  assert.equal(J.outcome({ focused: true, openHostId: undefined, wanted: 'local_a' }), null); // helper busy
  assert.deepEqual(J.outcome({ focused: true, openHostId: 'local_a', wanted: 'local_a' }), { ok: true });
  assert.deepEqual(J.outcome({ focused: false, openHostId: 'local_a', wanted: 'local_a' }), { ok: true });
  assert.deepEqual(J.outcome({ focused: true, openHostId: 'local_b', wanted: 'local_a' }), { ok: false });
  assert.equal(J.outcome({ focused: false, openHostId: 'local_b', wanted: 'local_a' }), null); // focus was refused: not a route problem
});

test('outcome: "none" is never a miss (Claude may have just restarted and still be building its accessibility tree)', () => {
  assert.equal(J.outcome({ focused: true, openHostId: null, wanted: 'local_a' }), null);
  assert.equal(J.outcome({ focused: false, openHostId: null, wanted: 'local_a' }), null);
});
