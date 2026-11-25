'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore, nextState } = require('../src/state');

const SID = 'aaaaaaaa-1111-2222-3333-444444444444';
const hook = (hook_event_name, extra = {}) => ({ session_id: SID, cwd: 'C:\\x\\proj', hook_event_name, ...extra });

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}

test('nextState maps the hook events', () => {
  assert.equal(nextState({ hook_event_name: 'UserPromptSubmit' }, 'done'), 'working');
  assert.equal(nextState({ hook_event_name: 'Stop' }, 'working'), 'done');
  assert.equal(nextState({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, 'working'), 'approval');
  assert.equal(nextState({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion' }, 'working'), 'question');
  assert.equal(nextState({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'working'), 'question');
  assert.equal(nextState({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }, 'approval'), 'working');
  assert.equal(nextState({ hook_event_name: 'SessionEnd' }, 'done'), 'removed');
  assert.equal(nextState({ hook_event_name: 'Whatever' }, 'done'), null);
});

test('idle_prompt never downgrades a question or approval', () => {
  const n = (cur) => nextState({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }, cur);
  assert.equal(n('question'), null);
  assert.equal(n('approval'), null);
  assert.equal(n('working'), 'done');
});

test('a full turn: prompt, permission, answer, stop', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now });
  assert.ok(st.applyHook(hook('UserPromptSubmit')));
  assert.equal(st.snapshot().mood, 'working');
  st.applyHook(hook('PermissionRequest', { tool_name: 'Bash' }));
  assert.equal(st.snapshot().mood, 'approval');
  assert.equal(st.snapshot().attention, 1);
  st.applyHook(hook('PostToolUse', { tool_name: 'Bash' }));
  assert.equal(st.snapshot().mood, 'working');
  st.applyHook(hook('Stop'));
  assert.equal(st.snapshot().mood, 'done');
  assert.deepEqual(st.takeAlerts().map((a) => a.state), ['approval', 'done']);
  assert.deepEqual(st.takeAlerts(), []);
});

test('mood is the most urgent state across sessions', () => {
  const st = new SessionStore();
  st.applyHook({ ...hook('Stop'), session_id: 's1' });
  st.applyHook({ ...hook('PreToolUse', { tool_name: 'AskUserQuestion' }), session_id: 's2' });
  st.applyHook({ ...hook('UserPromptSubmit'), session_id: 's3' });
  const snap = st.snapshot();
  assert.equal(snap.mood, 'question');
  assert.equal(snap.attention, 2);
  assert.deepEqual(snap.sessions.map((s) => s.id), ['s2', 's1', 's3']);
});

test('rejects bad session ids', () => {
  const st = new SessionStore();
  assert.equal(st.applyHook({ session_id: '../../etc', hook_event_name: 'Stop' }), false);
  assert.equal(st.applyHook({ hook_event_name: 'Stop' }), false);
  assert.equal(st.snapshot().sessions.length, 0);
});

test('registry supplies names and host ids; dead sessions are dropped', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now });
  st.syncRegistry([{ sessionId: SID, name: 'My chat', cwd: 'C:\\x\\proj', status: 'idle', hostSessionId: 'local_abc-123' }]);
  let snap = st.snapshot();
  assert.equal(snap.sessions[0].name, 'My chat');
  assert.equal(snap.sessions[0].jumpable, true);
  assert.equal(st.hostIdOf(SID), 'local_abc-123');
  st.syncRegistry([]);
  assert.equal(st.snapshot().sessions.length, 0);
});

test('registry busy starts "working"; a stale "working" goes idle', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now });
  const entry = { sessionId: SID, name: 'x', status: 'busy', statusUpdatedAt: c.now() };
  st.syncRegistry([entry]);
  assert.equal(st.snapshot().mood, 'working');
  c.advance(60_000);
  st.syncRegistry([{ ...entry, status: 'idle', statusUpdatedAt: c.now() }]);
  assert.equal(st.snapshot().mood, 'idle');
});

test('an approval is cleared by the registry only once the chat runs again', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now });
  st.syncRegistry([{ sessionId: SID, name: 'x', status: 'idle' }]);
  st.applyHook(hook('PermissionRequest', { tool_name: 'Bash' }));
  c.advance(5_000);
  st.syncRegistry([{ sessionId: SID, name: 'x', status: 'idle', statusUpdatedAt: 0 }]);
  assert.equal(st.snapshot().mood, 'approval');
  c.advance(5_000);
  st.syncRegistry([{ sessionId: SID, name: 'x', status: 'busy', statusUpdatedAt: c.now() }]);
  assert.equal(st.snapshot().mood, 'working');
});

test('dismiss only clears "done"', () => {
  const st = new SessionStore();
  st.applyHook(hook('Stop'));
  assert.equal(st.dismiss(SID), true);
  assert.equal(st.snapshot().mood, 'idle');
  st.applyHook(hook('PermissionRequest', { tool_name: 'Bash' }));
  assert.equal(st.dismiss(SID), false);
  assert.equal(st.snapshot().mood, 'approval');
});
