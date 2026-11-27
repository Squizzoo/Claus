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

// a stand-in for electron-updater that records what it is told
function fakeAutoUpdater() {
  const calls = [];
  const handlers = {};
  return {
    calls,
    on: (name, fn) => { handlers[name] = fn; },
    emit: (name, arg) => handlers[name] && handlers[name](arg),
    setFeedURL(feed) { calls.push(['feed', feed]); },
    checkForUpdates() { calls.push(['check', this.allowDowngrade]); return Promise.resolve(); },
    downloadUpdate() { calls.push(['download']); return Promise.resolve(); },
    quitAndInstall() { calls.push(['install']); },
  };
}
const repo = { owner: 'Squizzoo', repo: 'Claus' };

test('choosing a version points the updater at that release and allows going down; the next normal check puts the usual feed back', async () => {
  const au = fakeAutoUpdater();
  const u = U.createUpdater({ supported: true, onChange: () => {}, repo, loadUpdater: () => au });
  await u.useVersion('0.1.0');
  assert.deepEqual(au.calls[0], ['feed', { provider: 'generic', url: 'https://github.com/Squizzoo/Claus/releases/download/v0.1.0' }]);
  assert.deepEqual(au.calls[1], ['check', true]);
  au.calls.length = 0;
  await u.check();
  assert.deepEqual(au.calls[0], ['feed', { provider: 'github', owner: 'Squizzoo', repo: 'Claus' }]);
  assert.deepEqual(au.calls[1], ['check', false]); // going down is off again
  au.calls.length = 0;
  await u.check(); // not pinned any more: no feed change
  assert.deepEqual(au.calls, [['check', false]]);
});

test('the timer leaves a chosen version alone while it waits to be installed, but a click on Check does not', async () => {
  const au = fakeAutoUpdater();
  const u = U.createUpdater({ supported: true, onChange: () => {}, repo, loadUpdater: () => au });
  await u.useVersion('0.1.0');
  au.emit('update-available', { version: '0.1.0' });
  assert.equal(u.state().status, 'available');
  au.calls.length = 0;
  await u.check({ auto: true });
  assert.deepEqual(au.calls, []); // the 6-hour timer does not swap the choice for the newest version
  await u.check();
  assert.equal(au.calls[0][0], 'feed'); // an explicit check does
});

test('useVersion refuses versions that are not plain numbers, and does nothing when updates are unsupported', async () => {
  const au = fakeAutoUpdater();
  const u = U.createUpdater({ supported: true, onChange: () => {}, repo, loadUpdater: () => au });
  await u.useVersion('0.1.0/../../evil');
  await u.useVersion('latest');
  assert.deepEqual(au.calls, []);
  const off = U.createUpdater({ supported: false, onChange: () => {}, repo, loadUpdater: () => { throw new Error('must not load'); } });
  assert.equal((await off.useVersion('0.1.0')).status, 'unsupported');
});
