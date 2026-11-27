'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/releases');

const rel = (tag, over = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-11-26T12:30:30Z', assets: [{ name: 'latest.yml' }, { name: `Claus-Setup-${tag.replace(/^v/, '')}.exe` }], ...over });

test('versions parse and compare as numbers, not text', () => {
  assert.deepEqual(R.parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  for (const bad of ['1.2', '1.2.3-beta', 'latest', '', null, '1.2.3.4', '../1.2.3']) assert.equal(R.parseVersion(bad), null, String(bad));
  assert.equal(R.compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(R.compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(R.compareVersions('v1.0.0', '1.0.0'), 0);
});

test('feedUrl points at one release folder and refuses anything odd', () => {
  assert.equal(R.feedUrl('Squizzoo', 'Claus', '0.1.0'), 'https://github.com/Squizzoo/Claus/releases/download/v0.1.0');
  assert.equal(R.feedUrl('Squizzoo', 'Claus', 'v0.1.0'), 'https://github.com/Squizzoo/Claus/releases/download/v0.1.0');
  assert.equal(R.feedUrl('Squizzoo', 'Claus', '0.1.0/../x'), null);
  assert.equal(R.feedUrl('a/b', 'Claus', '0.1.0'), null);
  assert.equal(R.feedUrl('Squizzoo', 'Claus', null), null);
});

test('parseReleases keeps installable releases, newest first, and says how each compares to the current version', () => {
  const list = R.parseReleases([rel('v0.1.0'), rel('v0.2.0'), rel('v0.3.0')], '0.2.0');
  assert.deepEqual(list.map((r) => [r.version, r.relation]), [['0.3.0', 'newer'], ['0.2.0', 'same'], ['0.1.0', 'older']]);
  assert.equal(list[0].date, '2026-11-26');
});

test('drafts, pre-releases, releases without an installer or latest.yml, bad tags and duplicates are left out', () => {
  const list = R.parseReleases([
    rel('v0.4.0', { draft: true }),
    rel('v0.5.0', { prerelease: true }),
    rel('v0.6.0', { assets: [{ name: 'latest.yml' }] }),
    rel('v0.7.0', { assets: [{ name: 'Claus-Setup-0.7.0.exe' }] }),
    rel('nightly'),
    rel('v0.1.0'),
    rel('v0.1.0'),
    null,
    { tag_name: 'v0.9.0' },
  ], '0.1.0');
  assert.deepEqual(list.map((r) => r.version), ['0.1.0']);
  assert.deepEqual(R.parseReleases({ message: 'rate limited' }, '0.1.0'), []);
  assert.deepEqual(R.parseReleases(null, '0.1.0'), []);
});

test('the list is capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => rel(`v0.${i}.0`));
  assert.equal(R.parseReleases(many, '0.1.0').length, R.MAX_LIST);
});

test('the repository comes from the build settings, or from the homepage in the installed app', () => {
  const build = { publish: [{ provider: 'github', owner: 'Squizzoo', repo: 'Claus' }] };
  assert.deepEqual(R.repoFromPackage({ build }), { owner: 'Squizzoo', repo: 'Claus' });
  assert.deepEqual(R.repoFromPackage({ homepage: 'https://github.com/Squizzoo/Claus' }), { owner: 'Squizzoo', repo: 'Claus' });
  assert.deepEqual(R.repoFromPackage({ homepage: 'https://github.com/Squizzoo/Claus/' }), { owner: 'Squizzoo', repo: 'Claus' });
  assert.deepEqual(R.repoFromPackage({ build: { publish: [{ provider: 's3' }] }, homepage: 'https://github.com/a/b' }), { owner: 'a', repo: 'b' });
  for (const bad of [null, {}, { homepage: 'https://example.com/a/b' }, { homepage: 'https://github.com/a/b/issues' }, { homepage: 'https://github.com/../x' }, { build: { publish: [{ provider: 'github', owner: 'a b', repo: 'c' }] } }]) {
    assert.equal(R.repoFromPackage(bad), null, JSON.stringify(bad));
  }
});

test('package.json still gives the repository without its build section (what the installed app sees)', () => {
  const pkg = require('../package.json');
  assert.deepEqual(R.repoFromPackage({ ...pkg, build: undefined }), R.repoFromPackage(pkg));
  assert.ok(R.repoFromPackage({ ...pkg, build: undefined }));
});

test('an owner or repository of dots only never builds a feed address', () => {
  assert.equal(R.feedUrl('..', 'Claus', '0.1.0'), null);
  assert.equal(R.feedUrl('Squizzoo', '.', '0.1.0'), null);
  assert.ok(R.feedUrl('Squizzoo', 'Claus', '0.1.0'));
});
