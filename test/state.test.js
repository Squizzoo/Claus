'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore, nextState, projectKey } = require('../src/state');

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

test('a chat waiting on you too long makes the pet angry, once', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now, impatientMs: 60_000 });
  st.applyHook(hook('PermissionRequest', { tool_name: 'Bash' }));
  st.takeAlerts();
  c.advance(59_000);
  assert.equal(st.tickOverdue(), false);
  assert.equal(st.snapshot().overdue, false);
  c.advance(2_000);
  assert.equal(st.tickOverdue(), true);
  assert.equal(st.snapshot().overdue, true);
  assert.equal(st.snapshot().sessions[0].overdue, true);
  assert.deepEqual(st.takeAlerts(), [{ id: SID, state: 'overdue' }]);
  assert.equal(st.tickOverdue(), false); // no repeat chime
  st.applyHook(hook('PostToolUse', { tool_name: 'Bash' })); // you answered
  assert.equal(st.snapshot().overdue, false);
});

test('only questions and approvals can go overdue; 0 means never', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now, impatientMs: 1000 });
  st.applyHook(hook('Stop'));
  c.advance(10_000);
  assert.equal(st.tickOverdue(), false);
  assert.equal(st.snapshot().overdue, false);

  const calm = new SessionStore({ now: c.now, impatientMs: 0 });
  calm.applyHook(hook('PreToolUse', { tool_name: 'AskUserQuestion' }));
  c.advance(999_999);
  assert.equal(calm.tickOverdue(), false);
  assert.equal(calm.snapshot().overdue, false);
});

test('snapshot counts each kind of notification', () => {
  const st = new SessionStore();
  st.applyHook({ ...hook('Stop'), session_id: 'a' });
  st.applyHook({ ...hook('Stop'), session_id: 'b' });
  st.applyHook({ ...hook('PreToolUse', { tool_name: 'AskUserQuestion' }), session_id: 'c' });
  st.applyHook({ ...hook('PermissionRequest', { tool_name: 'Bash' }), session_id: 'd' });
  st.applyHook({ ...hook('UserPromptSubmit'), session_id: 'e' });
  assert.deepEqual(st.snapshot().types, { approval: 1, question: 1, done: 2 });
});

const at = (id, cwd, event, extra) => ({ session_id: id, cwd, hook_event_name: event, ...extra });

test('projectKey is one key for case, slash style and trailing slash', () => {
  assert.equal(projectKey('C:\\Xampp\\htdocs\\Site\\'), 'c:/xampp/htdocs/site');
  assert.equal(projectKey('c:/xampp/htdocs/site'), 'c:/xampp/htdocs/site');
  assert.equal(projectKey(''), '');
  assert.equal(projectKey(undefined), '');
});

test('muted chats and projects never alert, count as waiting or move the pet', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now, impatientMs: 1000 });
  st.setMuted({ ids: ['a'], projects: ['C:\\Sites\\Loud'] });
  st.applyHook(at('a', 'C:\\x\\one', 'PermissionRequest', { tool_name: 'Bash' }));
  st.applyHook(at('b', 'c:/sites/loud/', 'Stop'));
  st.applyHook(at('c', 'C:\\x\\three', 'UserPromptSubmit'));
  assert.deepEqual(st.takeAlerts(), []);
  c.advance(5000);
  assert.equal(st.tickOverdue(), false);
  const snap = st.snapshot();
  assert.equal(snap.sessions.length, 3); // still listed
  assert.deepEqual(snap.sessions.filter((s) => s.muted).map((s) => s.id).sort(), ['a', 'b']);
  assert.equal(snap.attention, 0);
  assert.deepEqual(snap.types, { approval: 0, question: 0, done: 0 });
  assert.equal(snap.overdue, false);
  assert.equal(snap.mood, 'working');
  // un-muting makes the chat count again
  st.setMuted({});
  assert.equal(st.snapshot().mood, 'approval');
});

test('x on a row: finished goes idle, idle is hidden, a busy chat is untouched', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now });
  st.applyHook(at('done', 'C:\\x\\a', 'Stop'));
  st.applyHook(at('idle', 'C:\\x\\b', 'SessionStart'));
  st.applyHook(at('busy', 'C:\\x\\c', 'UserPromptSubmit'));
  assert.equal(st.dismissRow('busy'), false);
  assert.equal(st.dismissRow('done'), true);
  assert.equal(st.snapshot().sessions.find((s) => s.id === 'done').state, 'idle');
  assert.equal(st.dismissRow('idle'), true);
  const snap = st.snapshot();
  assert.deepEqual(snap.sessions.map((s) => s.id).sort(), ['busy', 'done']);
  assert.equal(snap.hiddenCount, 1);
  // doing anything brings a hidden chat back
  st.applyHook(at('idle', 'C:\\x\\b', 'UserPromptSubmit'));
  assert.equal(st.snapshot().hiddenCount, 0);
  assert.equal(st.snapshot().sessions.length, 3);
});

test('jumping to a chat never hides it and leaves no undo', () => {
  const st = new SessionStore();
  st.applyHook(at('i', 'C:\\x\\a', 'SessionStart'));
  assert.equal(st.dismiss('i'), false);
  assert.equal(st.snapshot().sessions.length, 1);
  assert.equal(st.snapshot().undoable, false);
  st.applyHook(at('d', 'C:\\x\\b', 'Stop'));
  assert.equal(st.dismiss('d'), true);
  assert.equal(st.snapshot().undoable, false);
});

test('bulk clears work on a whole kind and undo restores the batch', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now });
  st.applyHook(at('d1', 'C:\\x\\a', 'Stop'));
  c.advance(1000);
  st.applyHook(at('d2', 'C:\\x\\a', 'Stop'));
  st.applyHook(at('i1', 'C:\\x\\b', 'SessionStart'));
  st.applyHook(at('w', 'C:\\x\\c', 'UserPromptSubmit'));
  assert.deepEqual(st.snapshot().counts, { done: 2, idle: 1 });
  const since = st.snapshot().sessions.find((s) => s.id === 'd1').since;

  assert.equal(st.dismissAllDone(), true);
  let snap = st.snapshot();
  assert.deepEqual(snap.counts, { done: 0, idle: 3 });
  assert.equal(snap.undoable, true);
  assert.equal(snap.undoCount, 2);
  assert.equal(st.undo(), true);
  snap = st.snapshot();
  assert.deepEqual(snap.counts, { done: 2, idle: 1 });
  assert.equal(snap.sessions.find((s) => s.id === 'd1').since, since); // waiting time is kept
  assert.equal(snap.undoable, false);

  assert.equal(st.dismissAllIdle(), true);
  assert.equal(st.snapshot().hiddenCount, 1);
  assert.equal(st.undo(), true);
  assert.equal(st.snapshot().hiddenCount, 0);
  assert.equal(st.dismissAllIdle(), true);
  assert.equal(st.unhideAll(), true);
  assert.equal(st.snapshot().hiddenCount, 0);
});

test('undo expires, skips chats that changed and raises no alerts', () => {
  const c = clock();
  const st = new SessionStore({ now: c.now, undoMs: 10_000 });
  st.applyHook(at('d1', 'C:\\x\\a', 'Stop'));
  st.applyHook(at('d2', 'C:\\x\\b', 'Stop'));
  st.takeAlerts();
  st.dismissAllDone();
  st.applyHook(at('d1', 'C:\\x\\a', 'UserPromptSubmit')); // d1 is busy again
  st.takeAlerts();
  assert.equal(st.undo(), true);
  assert.deepEqual(st.takeAlerts(), []);
  const snap = st.snapshot();
  assert.equal(snap.sessions.find((s) => s.id === 'd1').state, 'working');
  assert.equal(snap.sessions.find((s) => s.id === 'd2').state, 'done');

  st.dismissAllDone();
  c.advance(10_001);
  assert.equal(st.snapshot().undoable, false);
  assert.equal(st.undo(), false);
  assert.equal(st.snapshot().sessions.find((s) => s.id === 'd2').state, 'idle');
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

// ---------- opening a finished chat in Claude Desktop ----------
const HOST = 'local_9a404a4d-21a9-4128-90f6-40efc8338b0b';
const registryEntry = (sessionId, hostSessionId, extra = {}) => ({ sessionId, name: sessionId, cwd: 'C:\\x\\proj', status: 'idle', hostSessionId, ...extra });
function finishedDesktopChat() {
  const st = new SessionStore();
  st.syncRegistry([registryEntry('s1', HOST), registryEntry('s2', 'local_other-chat-0000')]);
  st.applyHook({ ...hook('Stop'), session_id: 's1' });
  st.applyHook({ ...hook('Stop'), session_id: 's2' });
  return st;
}

test('a finished chat that stays open in Claude counts as seen', () => {
  const st = finishedDesktopChat();
  assert.ok(st.hasOpenableDone());
  assert.equal(st.markViewing(HOST), false); // one glance is not enough
  assert.equal(st.markViewing(HOST), true);
  const byId = Object.fromEntries(st.snapshot().sessions.map((s) => [s.id, s.state]));
  assert.deepEqual(byId, { s1: 'idle', s2: 'done' }); // only the open chat is cleared
  assert.equal(st.snapshot().hiddenCount, 0); // like jumping: cleared, never hidden, no undo
  assert.equal(st.snapshot().undoable, false);
});

test('switching chats or leaving Claude restarts the viewing count', () => {
  const st = finishedDesktopChat();
  st.markViewing(HOST);
  st.markViewing(null); // Claude is no longer in front
  assert.equal(st.markViewing(HOST), false);
  st.markViewing('local_other-chat-0000');
  assert.equal(st.markViewing(HOST), false);
  assert.equal(st.markViewing(HOST), true);
});

test('opening a chat does not answer a question or approval', () => {
  const st = new SessionStore();
  st.syncRegistry([registryEntry('s1', HOST)]);
  st.applyHook({ ...hook('PermissionRequest', { tool_name: 'Bash' }), session_id: 's1' });
  st.markViewing(HOST);
  assert.equal(st.markViewing(HOST), false);
  assert.equal(st.snapshot().sessions[0].state, 'approval');
});

test('chats without a Desktop id are never matched or watched for', () => {
  const st = new SessionStore();
  st.applyHook({ ...hook('Stop'), session_id: 's1' }); // e.g. a VS Code chat: no hostSessionId
  assert.equal(st.hasOpenableDone(), false);
  st.markViewing(HOST);
  assert.equal(st.markViewing(HOST), false);
  assert.equal(st.snapshot().sessions[0].state, 'done');
});

test('a chat that finishes while it is already open is cleared on the next report', () => {
  const st = new SessionStore();
  st.syncRegistry([registryEntry('s1', HOST, { status: 'busy' })]);
  st.markViewing(HOST);
  st.markViewing(HOST);
  st.applyHook({ ...hook('Stop'), session_id: 's1' });
  assert.equal(st.snapshot().sessions[0].state, 'done');
  assert.ok(st.markViewing(HOST));
  assert.equal(st.snapshot().sessions[0].state, 'idle');
});
