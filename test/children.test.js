'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChildren } = require('../src/children');
const { SessionStore } = require('../src/state');
const N = require('../src/notify');

const ID_A = 'local_11111111-2222-3333-4444-555555555555';
const ID_B = 'local_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const line = (content) => JSON.stringify({ type: 'user', message: { content } });
const call = (id, name = 'mcp__ccd_session__start_session') => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = (id, text) => line([{ type: 'tool_result', tool_use_id: id, content: text }]);

test('the id in the answer of a start_session call is a child; other mentions are not', () => {
  const c = createChildren();
  const text = [
    call('t1'),
    result('t1', `Started ${ID_A}`),
    call('t2', 'mcp__ccd_session_mgmt__list_sessions'), // not a start call: its ids are only a listing
    result('t2', `${ID_B}`),
    line([{ type: 'text', text: `I mentioned ${ID_B} in passing` }]),
  ].join('\n');
  assert.equal(c.ingest(text), true);
  assert.deepEqual([...c.ids()], [ID_A]);
  assert.equal(c.ingest(text), false); // the same text again changes nothing
});

test('the call and its answer can arrive in different slices, and structured results work too', () => {
  const c = createChildren();
  assert.equal(c.ingest(call('t1') + '\n'), false);
  assert.equal(c.ingest(result('t1', [{ type: 'text', text: `ok ${ID_A} and ${ID_B}` }])), true);
  assert.deepEqual([...c.ids()].sort(), [ID_A, ID_B].sort());
});

test('damaged lines and plain text are skipped without throwing', () => {
  const c = createChildren();
  assert.equal(c.ingest('not json start_session\n{"type":\n\n'), false);
  assert.equal(c.ingest(''), false);
  assert.equal(c.ids().size, 0);
});

function store(now = { t: 1_000_000 }) {
  const s = new SessionStore({ now: () => now.t });
  const sid = (n) => `${String(n).repeat(8)}-0000-0000-0000-000000000000`;
  const add = (n, host) => s.syncRegistry([...[...s.sessions.values()].map((x) => ({ sessionId: x.id, hostSessionId: x.hostSessionId, cwd: x.cwd, name: x.name })), { sessionId: sid(n), hostSessionId: host, cwd: 'C:\shop', name: `chat ${n}` }]);
  return { s, sid, add, now };
}

test('a chat is the parent of the chats named in its transcript; the snapshot says so', () => {
  const { s, sid, add } = store();
  add(1, 'local_p');
  add(2, ID_A);
  add(3, ID_B);
  assert.equal(s.setChildren(sid(1), new Set([ID_A])), true);
  assert.equal(s.setChildren(sid(1), new Set([ID_A])), false);
  const rows = Object.fromEntries(s.snapshot().sessions.map((r) => [r.id, r.parent]));
  assert.deepEqual(rows, { [sid(1)]: null, [sid(2)]: sid(1), [sid(3)]: null });
  assert.equal(s.setChildren('missing', new Set([ID_A])), false);
});

test('nestedContext knows when a child finished and how long the parent turn was', () => {
  const clock = { t: 1_000_000 };
  const { s, sid, add } = store(clock);
  add(1, 'local_p');
  add(2, ID_A);
  s.setChildren(sid(1), new Set([ID_A]));
  s.applyHook({ session_id: sid(2), hook_event_name: 'UserPromptSubmit' });
  clock.t += 5000;
  s.applyHook({ session_id: sid(2), hook_event_name: 'Stop' }); // the child finishes
  const childDone = clock.t;
  clock.t += 3000;
  s.applyHook({ session_id: sid(1), hook_event_name: 'UserPromptSubmit' });
  clock.t += 4000;
  s.applyHook({ session_id: sid(1), hook_event_name: 'Stop' }); // the parent relays it
  const parent = s.nestedContext(sid(1));
  assert.equal(parent.hasChildren, true);
  assert.equal(parent.isChild, false);
  assert.equal(parent.lastChildDoneAt, childDone);
  assert.equal(parent.turnMs, 4000);
  assert.equal(s.nestedContext(sid(2)).isChild, true);
  assert.equal(s.nestedContext('missing'), null);
});

test('nestedAlertDecision: one alert for a child and the parent that relays it, as chosen', () => {
  const relay = { isChild: false, hasChildren: true, lastChildDoneAt: 100_000, doneAt: 110_000, turnMs: 4000 };
  const final = { ...relay, turnMs: 120_000 }; // a long turn is the parent's own report
  const late = { ...relay, lastChildDoneAt: 10_000 }; // the child finished long ago
  const child = { isChild: true, hasChildren: false, lastChildDoneAt: 0, doneAt: 100_000, turnMs: 60_000 };
  const d = (mode, ctx, state = 'done') => N.nestedAlertDecision({ mode, state, ctx });
  assert.equal(d('both', relay), true);
  assert.equal(d('child', relay), false); // the parent's short reply is silent
  assert.equal(d('child', final), true);
  assert.equal(d('child', late), true);
  assert.equal(d('child', child), true); // the finished chat always tells you
  assert.equal(d('parent', child), false); // started chats finish silently
  assert.equal(d('parent', relay), true);
  for (const mode of ['child', 'parent', 'both']) {
    assert.equal(d(mode, child, 'question'), true, `${mode}: questions always alert`);
    assert.equal(d(mode, child, 'approval'), true, `${mode}: approvals always alert`);
  }
  assert.equal(d('child', null), true);
  assert.equal(N.sanitize({ nested: 'nope' }).nested, 'child');
  assert.equal(N.DEFAULTS.nested, 'child');
});

test('calls that never got an answer do not stop the scanner from finding later children', () => {
  const c = createChildren();
  const orphans = Array.from({ length: 300 }, (_, i) => call(`orphan${i}`)).join('\n');
  c.ingest(orphans);
  c.ingest([call('late'), result('late', ID_A)].join('\n'));
  assert.deepEqual([...c.ids()], [ID_A]);
});
