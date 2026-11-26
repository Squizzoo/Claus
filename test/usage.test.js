'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUsage, badgeTokens } = require('../src/usage');
const { createTranscriptReader, findTranscript } = require('../src/transcript');

const line = (id, u, type = 'assistant') => JSON.stringify({ type, message: { id, usage: { input_tokens: 2, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, ...u } } }) + '\n';

test('a message written several times counts once, with the largest counters', () => {
  const u = createUsage();
  assert.equal(u.totals(), null);
  u.ingest(line('m1', { output_tokens: 5 }) + line('m1', { output_tokens: 244 }) + line('m1', { output_tokens: 100 }));
  u.ingest(line('m2', {}));
  assert.deepEqual(u.totals(), { input: 4, output: 254, cacheWrite: 200, cacheRead: 2000 });
  assert.equal(badgeTokens(u.totals()), 4 + 254 + 200); // cache reads are left out of the badge
  assert.equal(badgeTokens(null), 0);
});

test('lines that are not usage are skipped without being parsed into anything', () => {
  const u = createUsage();
  const changed = u.ingest('not json at all "usage"\n{"type":"user","message":{"content":"my secret prompt"}}\n' + line('m1', {}, 'user') + '{"type":"assistant","message":{"usage":{"output_tokens":3}}}\n');
  assert.equal(changed, false); // user entries, entries without an id and damaged lines add nothing
  assert.equal(u.totals(), null);
});

test('junk counters count as zero', () => {
  const u = createUsage();
  u.ingest(line('m1', { input_tokens: 'lots', output_tokens: -4, cache_creation_input_tokens: null, cache_read_input_tokens: 7.9 }));
  assert.deepEqual(u.totals(), { input: 0, output: 0, cacheWrite: 0, cacheRead: 7 });
});

test('the transcript is found by session id and read incrementally, whole lines only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claus-usage-'));
  try {
    fs.mkdirSync(path.join(dir, 'C--proj-a'));
    fs.mkdirSync(path.join(dir, 'C--proj-b'));
    const file = path.join(dir, 'C--proj-b', 'sess-1.jsonl');
    assert.equal(findTranscript('sess-1', dir), null);
    assert.equal(findTranscript('../evil', dir), null);
    fs.writeFileSync(file, line('m1', { output_tokens: 10 }));
    assert.equal(findTranscript('sess-1', dir), file);

    let t = 1_000;
    const reader = createTranscriptReader({ dir, now: () => t });
    assert.equal(await reader.refresh('sess-1'), true);
    assert.equal(reader.totals('sess-1').output, 10);
    assert.equal(await reader.refresh('sess-1'), false); // nothing new

    const half = line('m2', { output_tokens: 20 });
    fs.appendFileSync(file, half.slice(0, 30)); // half a line: wait for the rest
    assert.equal(await reader.refresh('sess-1'), false);
    fs.appendFileSync(file, half.slice(30));
    assert.equal(await reader.refresh('sess-1'), true);
    assert.equal(reader.totals('sess-1').output, 30);

    fs.writeFileSync(file, line('m9', { output_tokens: 1 })); // rewritten smaller: start over
    assert.equal(await reader.refresh('sess-1'), true);
    assert.equal(reader.totals('sess-1').output, 1);

    assert.equal(await reader.refresh('nope'), false); // no transcript: not an error
    t += 10_000;
    fs.writeFileSync(path.join(dir, 'C--proj-a', 'nope.jsonl'), line('m1', {}));
    assert.equal(await reader.refresh('nope'), false); // looked recently, so not yet
    t += 30_000;
    assert.equal(await reader.refresh('nope'), true);
    reader.keepOnly(new Set(['nope']));
    assert.equal(reader.totals('sess-1'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
