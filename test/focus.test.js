'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { focusArgs } = require('../src/focus');

test('the helper is only ever given a plain positive process id', () => {
  const args = focusArgs(4321);
  assert.deepEqual(args.slice(-2), ['-FromPid', '4321']);
  assert.ok(args.includes('-NoProfile') && args.includes('-File'));
  for (const bad of [0, -1, 1.5, NaN, '123', '1; calc', null, undefined, 2 ** 31]) assert.equal(focusArgs(bad), null, String(bad));
});
