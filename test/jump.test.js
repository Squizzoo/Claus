'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jumpUrl } = require('../src/jump');

const ID = 'local_0123abcd-4567-89ef-0123-456789abcdef';

test('the route is continue, or needs-input when asked for', () => {
  delete process.env.CLAUDE_PET_JUMP_ROUTE;
  assert.equal(jumpUrl(ID, 'continue'), `claude://code/continue?session=${ID}`);
  assert.equal(jumpUrl(ID, 'needs-input'), `claude://code/needs-input?session=${ID}`);
  assert.equal(jumpUrl(ID, 'whatever'), `claude://code/continue?session=${ID}`);
});

test('a bad id gives no url', () => {
  for (const bad of [null, undefined, '', 'x', 'local_', 'local_a b', 5]) assert.equal(jumpUrl(bad), null);
});

test('the route override only works on a test instance and only for a plain route name', () => {
  const keep = { port: process.env.CLAUDE_PET_PORT, route: process.env.CLAUDE_PET_JUMP_ROUTE };
  try {
    process.env.CLAUDE_PET_JUMP_ROUTE = 'no-such-route';
    delete process.env.CLAUDE_PET_PORT;
    assert.equal(jumpUrl(ID, 'continue'), `claude://code/continue?session=${ID}`); // ignored in a normal run
    process.env.CLAUDE_PET_PORT = '47999';
    assert.equal(jumpUrl(ID, 'continue'), `claude://code/no-such-route?session=${ID}`);
    process.env.CLAUDE_PET_JUMP_ROUTE = '../evil?x=1';
    assert.equal(jumpUrl(ID, 'continue'), `claude://code/continue?session=${ID}`); // not a plain name
  } finally {
    for (const [k, v] of [['CLAUDE_PET_PORT', keep.port], ['CLAUDE_PET_JUMP_ROUTE', keep.route]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
