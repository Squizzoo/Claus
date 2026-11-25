'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer, pick } = require('../src/server');
const { SessionStore } = require('../src/state');

const PORT = 47990;

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('pick keeps only the whitelisted fields', () => {
  const p = pick({
    session_id: 's1',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'cat ~/.ssh/id_rsa' },
    prompt: 'secret prompt',
    transcript_path: 'C:\\x.jsonl',
    cwd: 'C:\\proj',
  });
  assert.deepEqual(Object.keys(p).sort(), ['cwd', 'hook_event_name', 'notification_type', 'session_id', 'tool_name']);
  assert.equal(JSON.stringify(p).includes('id_rsa'), false);
  assert.equal(JSON.stringify(p).includes('secret'), false);
  assert.equal(pick(null), null);
});

test('receiver: hooks drive the store, and every answer is an empty "no opinion" {}', async () => {
  const store = new SessionStore();
  const srv = createServer({ port: PORT, onHook: (p) => store.applyHook(p) });
  await srv.listen();
  try {
    const health = await request('GET', '/health');
    assert.equal(health.status, 200);

    const hookBody = (o) => JSON.stringify({ session_id: 'abc-1', cwd: 'C:\\p', ...o });
    const r1 = await request('POST', '/hook', { body: hookBody({ hook_event_name: 'UserPromptSubmit' }), headers: { 'content-type': 'application/json' } });
    assert.equal(r1.status, 200);
    assert.equal(r1.body, '{}');
    const r2 = await request('POST', '/hook', {
      body: hookBody({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(r2.body, '{}');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(store.snapshot().mood, 'approval');

    // a web page in a browser always sends Origin: refused, and nothing changes
    const bad = await request('POST', '/hook', {
      body: hookBody({ hook_event_name: 'Stop' }),
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
    });
    assert.equal(bad.status, 403);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(store.snapshot().mood, 'approval');

    assert.equal((await request('GET', '/hook')).status, 404);
    assert.equal((await request('POST', '/nope', { body: '{}' })).status, 404);

    // garbage body: still answers, never crashes
    const junk = await request('POST', '/hook', { body: '{not json' });
    assert.equal(junk.status, 200);

    // a large permission payload (big tool input) goes through
    const big = await request('POST', '/hook', {
      body: hookBody({ hook_event_name: 'Stop', tool_input: { content: 'x'.repeat(1_500_000) } }),
    });
    assert.equal(big.status, 200);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(store.snapshot().mood, 'done');
  } finally {
    await srv.close();
  }
});

test('receiver only listens on loopback', async () => {
  const srv = createServer({ port: PORT, onHook: () => {} });
  await srv.listen();
  try {
    assert.equal(srv.server.address().address, '127.0.0.1');
  } finally {
    await srv.close();
  }
});
