'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rowMenuTemplate, vscodeUrl, terminalCommand } = require('../src/row-menu');

const ids = (items) => items.filter((i) => i.id).map((i) => i.id);
const base = { sessionId: 's1', cwd: 'C:\\sites\\shop', hostSessionId: null, focusable: false, entrypoint: 'cli' };

test('a Desktop chat can be opened; a terminal chat can be brought forward; neither only offers the rest', () => {
  assert.deepEqual(ids(rowMenuTemplate({ ...base, hostSessionId: 'local_x' }, {})), ['open', 'copy-id', 'folder', 'vscode', 'terminal', 'pin', 'mute']);
  const t = rowMenuTemplate({ ...base, focusable: true }, {});
  assert.deepEqual(ids(t), ['focus', 'copy-id', 'folder', 'vscode', 'terminal', 'pin', 'mute']);
  assert.equal(t[0].label, 'Bring its terminal forward');
  assert.equal(rowMenuTemplate({ ...base, focusable: true, entrypoint: 'claude-vscode' }, {})[0].label, 'Bring VS Code forward');
  assert.deepEqual(ids(rowMenuTemplate(base, {})), ['copy-id', 'folder', 'vscode', 'terminal', 'pin', 'mute']);
  assert.equal(rowMenuTemplate(base, {})[0].type, undefined); // no separator before the first item
});

test('a chat without a folder has no folder actions, and unknown chats have no menu', () => {
  assert.deepEqual(ids(rowMenuTemplate({ ...base, cwd: '' }, {})), ['copy-id', 'pin', 'mute']);
  assert.deepEqual(rowMenuTemplate(null, {}), []);
});

test('pin and mute say what clicking them will do', () => {
  const on = rowMenuTemplate(base, { pinned: ['s1'], mutedChats: ['s1'] });
  assert.equal(on.find((i) => i.id === 'pin').label, 'Unpin');
  assert.equal(on.find((i) => i.id === 'mute').label, 'Unmute this chat');
  const off = rowMenuTemplate(base, { pinned: ['other'], mutedChats: [] });
  assert.equal(off.find((i) => i.id === 'pin').label, 'Pin to the top');
});

test('the VS Code link keeps the drive colon and escapes characters that would end the path', () => {
  assert.equal(vscodeUrl('C:\\Users\\Pat\\my site'), 'vscode://file/C:/Users/Pat/my%20site');
  assert.equal(vscodeUrl('C:\\a#b?c'), 'vscode://file/C:/a%23b%3Fc');
  assert.equal(vscodeUrl('/home/x'), 'vscode://file//home/x');
  assert.equal(vscodeUrl('relative\\path'), null);
  assert.equal(vscodeUrl(''), null);
});

test('the terminal command escapes semicolons and refuses relative paths', () => {
  assert.deepEqual(terminalCommand('C:\\sites\\shop'), { cmd: 'wt.exe', args: ['-d', 'C:\\sites\\shop'] });
  assert.deepEqual(terminalCommand('C:\\a;b').args, ['-d', 'C:\\a\\;b']);
  assert.equal(terminalCommand('sites'), null);
  assert.equal(terminalCommand(undefined), null);
});
