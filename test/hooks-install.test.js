'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../src/hooks-install');

const PORT = 47999;
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claus-hooks-'));
  return { dir, file: path.join(dir, 'settings.json') };
};
const SETTINGS = {
  model: 'x',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk' }] }],
  },
};

test('status of a missing or broken file never throws', () => {
  const { dir, file } = tmp();
  assert.equal(H.status({ file, port: PORT }).exists, false);
  assert.equal(H.status({ file, port: PORT }).error, 'not found');
  fs.writeFileSync(file, '{ nope');
  assert.equal(H.status({ file, port: PORT }).error, 'unreadable');
  fs.rmSync(dir, { recursive: true });
});

test('plan does not write; apply backs up, writes, and keeps every other hook', () => {
  const { dir, file } = tmp();
  const text = JSON.stringify(SETTINGS, null, 2) + '\n';
  fs.writeFileSync(file, text);

  const p = H.plan({ action: 'install', file, port: PORT });
  assert.equal(p.changed, true);
  assert.equal(p.petEntriesBefore, 0);
  assert.equal(p.petEntriesAfter, Object.keys(H.EVENTS).length);
  assert.equal(fs.readFileSync(file, 'utf8'), text, 'a plan writes nothing');

  const r = H.apply(p);
  assert.equal(r.written, true);
  assert.equal(fs.readFileSync(r.backup, 'utf8'), text);
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(now.model, 'x');
  assert.equal(now.hooks.Stop[0].hooks[0].command, 'echo done');
  assert.equal(now.hooks.PreToolUse[0].hooks[0].command, 'rtk');
  const s = H.status({ file, port: PORT });
  assert.equal(s.installed, Object.keys(H.EVENTS).length);
  assert.equal(s.complete, true);
  assert.equal(s.events.find((e) => e.event === 'Stop').total, 2);
  fs.rmSync(dir, { recursive: true });
});

test('install twice changes nothing the second time; uninstall restores the other hooks', () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, JSON.stringify(SETTINGS, null, 4));
  H.apply(H.plan({ action: 'install', file, port: PORT }));
  assert.equal(H.plan({ action: 'install', file, port: PORT }).changed, false);
  assert.equal(H.apply(H.plan({ action: 'install', file, port: PORT })).written, false);
  H.apply(H.plan({ action: 'uninstall', file, port: PORT }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), SETTINGS);
  assert.equal(H.status({ file, port: PORT }).installed, 0);
  fs.rmSync(dir, { recursive: true });
});

test('indentation and line endings of the file are kept', () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, JSON.stringify(SETTINGS, null, '\t').replace(/\n/g, '\r\n') + '\r\n');
  const p = H.plan({ action: 'install', file, port: PORT });
  assert.ok(p.body.includes('\r\n\t"model"'));
  assert.ok(p.body.endsWith('}\r\n'));
  fs.rmSync(dir, { recursive: true });
});

test('only hooks on this port count as the pet\'s', () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'http', url: 'http://127.0.0.1:1234/hook' }] }] } }));
  assert.equal(H.status({ file, port: PORT }).installed, 0);
  const p = H.plan({ action: 'install', file, port: PORT });
  assert.equal(p.petEntriesAfter, Object.keys(H.EVENTS).length);
  assert.ok(p.body.includes(':1234/hook'), 'a hook for another port is left alone');
  fs.rmSync(dir, { recursive: true });
});

test('plan rejects an unknown action and an unreadable file', () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, '{}');
  assert.throws(() => H.plan({ action: 'drop', file, port: PORT }));
  assert.throws(() => H.plan({ action: 'install', file: path.join(dir, 'gone', 'missing.json'), port: PORT }));
  fs.rmSync(dir, { recursive: true });
});

test('a missing settings file is created by install (no backup), but only when its folder exists', () => {
  const { dir, file } = tmp();
  assert.equal(H.status({ file, port: PORT }).missing, true);
  const p = H.plan({ action: 'install', file, port: PORT });
  assert.equal(p.changed, true);
  assert.deepEqual(H.apply(p), { written: true, backup: null });
  assert.equal(H.status({ file, port: PORT }).complete, true);
  fs.rmSync(file);
  assert.equal(H.plan({ action: 'uninstall', file, port: PORT }).changed, false);
  const nowhere = path.join(dir, 'no-such-folder', 'settings.json');
  assert.equal(H.status({ file: nowhere, port: PORT }).missing, false);
  assert.throws(() => H.plan({ action: 'install', file: nowhere, port: PORT }));
  fs.rmSync(dir, { recursive: true });
});
