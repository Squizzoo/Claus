'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnswer } = require('../src/open-chat');

test('parseAnswer reads the Desktop session id and nothing else', () => {
  assert.equal(parseAnswer('chat=local_9a404a4d-21a9-4128-90f6-40efc8338b0b\r'), 'local_9a404a4d-21a9-4128-90f6-40efc8338b0b');
  assert.equal(parseAnswer('none'), null);
  assert.equal(parseAnswer(''), null);
  assert.equal(parseAnswer(undefined), null);
  assert.equal(parseAnswer('chat=https://evil.example/local_1234abcd'), null);
  assert.equal(parseAnswer('chat=local_x; calc'), null);
});
