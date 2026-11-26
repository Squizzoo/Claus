'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../src/state');
const { parseChats } = require('../src/chat-watch');

const A = '11111111-aaaa-bbbb-cccc-222222222222';
const B = '33333333-aaaa-bbbb-cccc-444444444444';
const read = (id, working, foreground = false) => ({ id, working, foreground });
const row = (st, id) => st.snapshot().sessions.find((r) => r.id === `chat_${id}`);

test('parseChats reads the helper answer and refuses anything else', () => {
  assert.deepEqual(parseChats('chats='), []);
  assert.deepEqual(parseChats(`chats=${A}:w:f`), [read(A, true, true)]);
  assert.deepEqual(parseChats(`chats=${A}:i:b,${B}:w:b`), [read(A, false, false), read(B, true, false)]);
  for (const bad of [null, '', 'none', 'unknown', `chats=${A}`, `chats=${A}:x:f`, 'chats=not-an-id:w:f', `chats=${A}:w:f,oops`]) assert.equal(parseChats(bad), null, String(bad));
});

test('an open page alone makes no row; a streaming reply does, and it is a plain "Claude chat"', () => {
  const st = new SessionStore();
  assert.equal(st.applyChats([read(A, false, true)]), false);
  assert.equal(st.snapshot().sessions.length, 0);
  assert.equal(st.applyChats([read(A, true)]), true);
  const r = row(st, A);
  assert.equal(r.state, 'working');
  assert.equal(r.name, 'Claude chat');
  assert.equal(r.chat, true);
  assert.equal(r.jumpable, true); // clicking raises Claude Desktop
  assert.equal(st.infoOf(`chat_${A}`).chat, true);
  assert.equal(st.snapshot().mood, 'working');
});

test('the reply is finished after two reads without the Stop button, with one chime and one finish', () => {
  const st = new SessionStore();
  st.applyChats([read(A, true)]);
  assert.equal(st.applyChats([read(A, false)]), false); // one blip is not the end
  assert.equal(row(st, A).state, 'working');
  assert.equal(st.applyChats([read(A, true)]), false); // ... and a streaming read starts the count again
  st.applyChats([read(A, false)]);
  assert.equal(st.applyChats([read(A, false)]), true);
  assert.equal(row(st, A).state, 'done');
  assert.deepEqual(st.takeAlerts(), [{ id: `chat_${A}`, state: 'done' }]);
  assert.equal(st.takeFinished().length, 1);
  assert.equal(st.takeTimes().work.length, 1);
});

test('a finished chat that stays in front of you counts as seen; in the background it stays finished', () => {
  const st = new SessionStore();
  st.applyChats([read(A, true)]);
  st.applyChats([read(A, false)]);
  st.applyChats([read(A, false)]);
  st.applyChats([read(A, false, false)]);
  st.applyChats([read(A, false, false)]);
  assert.equal(row(st, A).state, 'done');
  st.applyChats([read(A, false, true)]);
  assert.equal(row(st, A).state, 'done');
  st.applyChats([read(A, false, true)]);
  assert.equal(row(st, A).state, 'idle');
  assert.equal(st.takeAlerts().length, 1); // only the finish chimed
  // a new question in the same conversation starts it again
  assert.equal(st.applyChats([read(A, true, true)]), true);
  assert.equal(row(st, A).state, 'working');
});

test('a streaming chat whose page goes away is dropped quietly after a few reads; a blip is ridden out', () => {
  const st = new SessionStore();
  st.applyChats([read(A, true)]);
  st.applyChats([]);
  st.applyChats([]);
  assert.equal(row(st, A).state, 'working'); // still there: two reads without the page
  st.applyChats([read(A, true)]); // it came back
  st.applyChats([]);
  st.applyChats([]);
  assert.ok(row(st, A));
  assert.equal(st.applyChats([]), true);
  assert.equal(row(st, A), undefined);
  assert.deepEqual(st.takeAlerts(), []);
  assert.equal(st.takeFinished().length, 0);
});

test('a finished chat that is not on screen stays until you see or clear it; an idle one goes', () => {
  const st = new SessionStore();
  st.applyChats([read(A, true)]);
  st.applyChats([read(A, false)]);
  st.applyChats([read(A, false)]);
  for (let i = 0; i < 10; i++) st.applyChats([]);
  assert.equal(row(st, A).state, 'done');
  st.dismissAllDone();
  assert.equal(row(st, A).state, 'idle');
  st.applyChats([]);
  assert.equal(row(st, A), undefined);
});

test('"no usable answer" changes nothing, and the registry never removes chat rows', () => {
  const st = new SessionStore();
  st.applyChats([read(A, true)]);
  assert.equal(st.applyChats(null), false);
  assert.equal(row(st, A).state, 'working');
  const c = { t: 1_000_000 };
  const st2 = new SessionStore({ now: () => c.t });
  st2.syncRegistry([]);
  st2.applyChats([read(A, true)]);
  c.t += 10 * 60_000;
  st2.syncRegistry([]);
  assert.ok(row(st2, A));
});

test('two conversations are two rows, and turning the watch off forgets them', () => {
  const st = new SessionStore();
  st.applyChats([read(A, true), read(B, true)]);
  assert.equal(st.snapshot().sessions.length, 2);
  assert.equal(st.clearChats(), true);
  assert.equal(st.snapshot().sessions.length, 0);
  assert.equal(st.clearChats(), false);
});

test('chat ids that are not uuids are ignored', () => {
  const st = new SessionStore();
  assert.equal(st.applyChats([read('../../etc/passwd', true), read('', true), null]), false);
  assert.equal(st.snapshot().sessions.length, 0);
});

test('finishing in front of you counts but does not chime; finishing in the background does', () => {
  const front = new SessionStore();
  front.applyChats([read(A, true, true)]);
  front.applyChats([read(A, false, true)]);
  front.applyChats([read(A, false, true)]);
  assert.equal(row(front, A).state, 'done');
  assert.deepEqual(front.takeAlerts(), []);
  assert.equal(front.takeFinished().length, 1);
  const back = new SessionStore();
  back.applyChats([read(B, true, false)]);
  back.applyChats([read(B, false, false)]);
  back.applyChats([read(B, false, false)]);
  assert.equal(back.takeAlerts().length, 1);
  assert.equal(back.takeFinished().length, 1);
});
