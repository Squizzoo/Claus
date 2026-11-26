'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseState, parseForeground } = require('../src/claude-running');
const { unpacked, helperScript } = require('../src/paths');

test('parseState: running with a version, not running, or no answer', () => {
  assert.deepEqual(parseState('claude=C:\\Program Files\\WindowsApps\\Claude_6.28899.6.0_x64__abc\\app\\Claude.exe'), { running: true, version: '6.28899.6.0' });
  assert.deepEqual(parseState('claude=C:\\somewhere\\else\\Claude.exe'), { running: true, version: '' });
  assert.deepEqual(parseState('claude=none'), { running: false, version: '' });
  for (const bad of ['', null, undefined, 'unknown', 'fg=1,2,3,4', 'claude=']) assert.equal(parseState(bad), null, String(bad));
});

test('parseForeground: a rectangle in screen pixels', () => {
  assert.deepEqual(parseForeground('fg=100,50,1100,850'), { x: 100, y: 50, width: 1000, height: 800 });
  assert.deepEqual(parseForeground('fg=-1920,0,0,1080'), { x: -1920, y: 0, width: 1920, height: 1080 }); // a monitor left of the primary one
  for (const bad of ['', null, 'fg=none', 'fg=1,2,3', 'fg=5,5,5,9', 'fg=a,b,c,d', 'claude=none']) assert.equal(parseForeground(bad), null, String(bad));
});

test('unpacked points at the asar.unpacked copy and leaves a dev path alone', () => {
  assert.equal(unpacked('C:\\App\\resources\\app.asar\\src\\x.ps1'), 'C:\\App\\resources\\app.asar.unpacked\\src\\x.ps1');
  assert.equal(unpacked('/opt/app/resources/app.asar/src/x.ps1'), '/opt/app/resources/app.asar.unpacked/src/x.ps1');
  assert.equal(unpacked('C:\\Users\\me\\claude-pet\\src\\x.ps1'), 'C:\\Users\\me\\claude-pet\\src\\x.ps1');
  assert.equal(unpacked('C:\\app.asar.unpacked\\src\\x.ps1'), 'C:\\app.asar.unpacked\\src\\x.ps1'); // already unpacked
  assert.ok(helperScript('claude-running.ps1').endsWith('claude-running.ps1'));
});
