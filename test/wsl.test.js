'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/wsl');
const hooks = require('../src/hooks-install');

test('parseDistros reads the UTF-16 list of wsl.exe, with BOM, NULs and the (Default) marker', () => {
  const utf16 = Buffer.from('﻿Ubuntu (Default)\r\ndocker-desktop\r\nDebian\r\n', 'utf16le');
  assert.deepEqual(W.parseDistros(utf16), ['Ubuntu', 'docker-desktop', 'Debian']);
  assert.deepEqual(W.parseDistros('Ubuntu\nbad name!\n'), ['Ubuntu']); // only plain distro names pass
  assert.deepEqual(W.parseDistros(null), []);
  assert.deepEqual(W.parseDistros(Buffer.alloc(0)), []);
});

test('parseHome accepts only a plain absolute Linux path', () => {
  assert.equal(W.parseHome('/home/Patryk\n'), '/home/Patryk');
  assert.equal(W.parseHome('/root'), '/root');
  for (const bad of ['home/x', '/home/../etc', '/home/a b', '', null, '/home/$(x)']) assert.equal(W.parseHome(bad), null, String(bad));
});

test('wslPath builds the UNC path of a file inside a distro and refuses odd input', () => {
  const unc = (...parts) => ['', '', 'wsl.localhost', ...parts].join(String.fromCharCode(92)); // \\wsl.localhost\<parts>
  assert.equal(W.wslPath('Ubuntu', '/home/pat', '.claude/sessions'), unc('Ubuntu', 'home', 'pat', '.claude', 'sessions'));
  assert.equal(W.wslPath('Ubuntu', '/home/pat'), unc('Ubuntu', 'home', 'pat'));
  assert.equal(W.wslPath('Ubu ntu', '/home/pat', 'x'), null);
  assert.equal(W.wslPath('Ubuntu', '/home/../x', 'x'), null);
  assert.equal(W.wslPath('Ubuntu', '/home/pat', '../../etc'), unc('Ubuntu', 'home', 'pat', 'etc')); // .. is dropped, never followed
});

test('the WSL hook command goes through the Windows curl to loopback only and never fails the hook', () => {
  const c = W.hookCommand(47821);
  assert.match(c, /^\/mnt\/c\/Windows\/System32\/curl\.exe /);
  assert.match(c, /http:\/\/127\.0\.0\.1:47821\/hook/);
  assert.match(c, /\|\| exit 0$/);
  assert.doesNotMatch(W.hookCommand('47821; rm -rf /'), /rm/); // the port is a number, nothing else gets through
});

test('parsePids picks the numeric entries of /proc', () => {
  assert.deepEqual([...W.parsePids('1\n42\nself\nthread-self\n1337\ncpuinfo')].sort((a, b) => a - b), [1, 42, 1337]);
  assert.equal(W.parsePids(null).size, 0);
});

test('the WSL flavour installs command hooks, removes both flavours and leaves other hooks alone', () => {
  const base = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] }, theme: 'auto' };
  const wsl = hooks.withPet(base, 47821, true);
  assert.equal(hooks.countPet(wsl, 47821), Object.keys(hooks.EVENTS).length);
  const mine = Object.values(wsl.hooks).flat().flatMap((g) => g.hooks).filter((h) => h.command && h.command.includes('curl.exe'));
  assert.ok(mine.length > 0 && mine.every((h) => h.type === 'command'));
  assert.equal(wsl.theme, 'auto');
  assert.deepEqual(hooks.withoutPet(wsl, 47821), base); // clean uninstall
  assert.equal(hooks.countPet(hooks.withPet(wsl, 47821, true), 47821), Object.keys(hooks.EVENTS).length); // idempotent
  assert.equal(Object.values(hooks.withPet(base, 47821).hooks).flat().flatMap((g) => g.hooks).filter((h) => h.type === 'http').length, Object.keys(hooks.EVENTS).length); // Windows: http as before
});
