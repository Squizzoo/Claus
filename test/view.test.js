'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PetView = require('../src/renderer/view');
const { buildView, firstJumpable, wantedHeight, PINNED_KEY } = PetView;
const { PRIORITY, SessionStore } = require('../src/state');
const { DEFAULTS, sanitize } = require('../src/prefs');

const row = (id, folder, state, since, extra = {}) => ({
  id,
  name: `chat ${id}`,
  folder,
  project: `c:/sites/${folder.toLowerCase()}`,
  state,
  since,
  overdue: false,
  muted: false,
  jumpable: true,
  ...extra,
});
const sessions = [
  row('a', 'Shop', 'idle', 100),
  row('b', 'Shop', 'approval', 200),
  row('c', 'Blog', 'done', 300),
  row('d', 'Blog', 'working', 400),
  row('e', 'Docs', 'question', 50),
];
const prefs = (extra) => sanitize({ ...DEFAULTS, ...extra });
const ids = (view) => view.items.filter((i) => i.type === 'row').map((i) => i.id);
const labels = (view) => view.items.filter((i) => i.type === 'group').map((i) => `${i.label}:${i.count}`);

test('the priority table matches the state machine', () => {
  assert.deepEqual(PetView.PRIORITY, PRIORITY);
});

test('grouped by project, most urgent project first, urgent chats first inside it', () => {
  const v = buildView(sessions, prefs(), '');
  assert.deepEqual(labels(v), ['Shop:2', 'Docs:1', 'Blog:2']);
  assert.deepEqual(ids(v), ['b', 'a', 'e', 'c', 'd']);
  assert.equal(v.items[0].state, 'approval');
});

test('"recent" sorts groups and rows by last change', () => {
  const v = buildView(sessions, prefs({ sort: 'recent' }), '');
  assert.deepEqual(labels(v), ['Blog:2', 'Shop:2', 'Docs:1']);
  assert.deepEqual(ids(v), ['d', 'c', 'b', 'a', 'e']);
});

test('ungrouped is one flat list', () => {
  const v = buildView(sessions, prefs({ groupBy: 'none' }), '');
  assert.equal(v.groups, 0);
  assert.deepEqual(ids(v), ['b', 'e', 'c', 'd', 'a']);
});

test('search matches chat name and project, every word, any case', () => {
  assert.deepEqual(ids(buildView(sessions, prefs(), 'BLOG')), ['c', 'd']);
  assert.deepEqual(ids(buildView(sessions, prefs(), 'chat e')), ['e']);
  assert.deepEqual(ids(buildView(sessions, prefs(), 'shop chat')), ['b', 'a']);
  assert.deepEqual(ids(buildView(sessions, prefs(), 'nothing')), []);
  assert.equal(buildView(sessions, prefs(), '  ').shown, 5);
});

test('pinned chats sit on top, in a Pinned group when grouped', () => {
  const v = buildView(sessions, prefs({ pinned: ['a'] }), '');
  assert.deepEqual(labels(v), ['Pinned:1', 'Shop:1', 'Docs:1', 'Blog:2']);
  assert.equal(ids(v)[0], 'a');
  assert.equal(v.items[0].key, PINNED_KEY);
  const flat = buildView(sessions, prefs({ pinned: ['a'], groupBy: 'none' }), '');
  assert.equal(ids(flat)[0], 'a');
});

test('a collapsed group keeps its header, count and urgency but hides its rows', () => {
  const v = buildView(sessions, prefs({ collapsed: ['c:/sites/shop'] }), '');
  assert.deepEqual(ids(v), ['e', 'c', 'd']);
  const shop = v.items.find((i) => i.label === 'Shop');
  assert.equal(shop.collapsed, true);
  assert.equal(shop.count, 2);
  assert.equal(shop.state, 'approval');
});

test('searching opens collapsed groups so matches are not hidden', () => {
  const v = buildView(sessions, prefs({ collapsed: ['c:/sites/shop'] }), 'shop');
  assert.deepEqual(ids(v), ['b', 'a']);
});

test('muted chats do not colour their group; muted projects and chats are flagged', () => {
  const quiet = [row('x', 'Loud', 'approval', 1, { muted: true }), row('y', 'Loud', 'done', 2)];
  const v = buildView(quiet, prefs({ mutedChats: ['x'], mutedProjects: ['c:/sites/loud'] }), '');
  assert.equal(v.items[0].state, 'done');
  assert.equal(v.items[0].muted, true);
  assert.equal(v.items.find((i) => i.id === 'x').mutedChat, true);
  assert.equal(v.items.find((i) => i.id === 'y').mutedChat, false);
});

test('chats without a folder go into "Other"', () => {
  const v = buildView([row('z', '', 'idle', 1, { project: '' })], prefs(), '');
  assert.deepEqual(labels(v), ['Other:1']);
});

test('Enter in the search box opens the first chat that can be opened', () => {
  const v = buildView([row('n', 'A', 'approval', 5, { jumpable: false }), row('j', 'A', 'idle', 1)], prefs(), '');
  assert.equal(firstJumpable(v).id, 'j');
  assert.equal(firstJumpable(buildView([], prefs(), '')), null);
});

test('window height follows rows, groups, density and the bars, and is capped', () => {
  const v = buildView(sessions, prefs(), '');
  const S = PetView.SIZES;
  const base = S.header + S.search + S.pad;
  assert.equal(wantedHeight(v, { density: 'comfortable' }, 999), base + 5 * S.rowComfortable + 3 * S.group);
  assert.equal(wantedHeight(v, { density: 'compact' }, 999), base + 5 * S.rowCompact + 3 * S.group);
  assert.equal(wantedHeight(v, { density: 'compact', footer: true, options: true }, 999), base + 5 * S.rowCompact + 3 * S.group + S.footer + S.options);
  assert.equal(wantedHeight(v, { density: 'comfortable' }, 200), 200);
  assert.equal(wantedHeight(buildView([], prefs(), ''), { density: 'compact' }, 999), base + S.rowComfortable); // room for the empty note
  const collapsed = buildView(sessions, prefs({ collapsed: ['c:/sites/shop'] }), '');
  assert.equal(wantedHeight(collapsed, { density: 'comfortable' }, 999), base + 3 * S.rowComfortable + 3 * S.group);
});

test('the real snapshot feeds the view', () => {
  const st = new SessionStore();
  st.applyHook({ session_id: 's1', cwd: 'C:\\Sites\\Shop', hook_event_name: 'Stop' });
  st.applyHook({ session_id: 's2', cwd: 'c:/sites/shop/', hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  const v = buildView(st.snapshot().sessions, prefs(), '');
  assert.equal(v.groups, 1); // both paths are the same project
  assert.deepEqual(ids(v), ['s2', 's1']);
});

test('formatDuration and formatAgo write times to the second', () => {
  const { formatDuration, formatAgo } = PetView;
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(42_900), '42s');
  assert.equal(formatDuration(252_000), '4m 12s');
  assert.equal(formatDuration(303_000), '5m 03s');
  assert.equal(formatDuration(3_900_000), '1h 05m');
  assert.equal(formatDuration(-5), '0s');
  assert.equal(formatAgo(2_000), 'just now');
  assert.equal(formatAgo(8_000), '8s ago');
});

test('formatTokens keeps the badge short', () => {
  const { formatTokens } = PetView;
  assert.deepEqual([0, 812, 1000, 4200, 9999, 48_300, 999_999, 1_200_000, 12_000_000].map(formatTokens), ['0', '812', '1k', '4.2k', '10k', '48k', '1M', '1.2M', '12M']);
});

test('chats another chat started are listed right under it, one step in', () => {
  const V = require('../src/renderer/view');
  const prefs = { groupBy: 'project', sort: 'priority', pinned: [], mutedChats: [], mutedProjects: [], collapsed: [], density: 'comfortable' };
  const s = (id, over = {}) => ({ id, name: id, folder: 'shop', project: 'c:/shop', state: 'idle', since: 100, parent: null, ...over });
  const view = V.buildView([s('kid-a', { parent: 'boss', state: 'done', since: 300 }), s('other', { since: 400 }), s('boss', { state: 'working', since: 200 }), s('kid-b', { parent: 'boss', since: 150 })], prefs, '');
  const rows = view.items.filter((i) => i.type === 'row');
  const at = (id) => rows.findIndex((r) => r.id === id);
  assert.equal(at('kid-a'), at('boss') + 1);
  assert.equal(at('kid-b'), at('boss') + 2); // both directly under their parent, in the list's own order
  assert.deepEqual([rows[at('boss')].depth, rows[at('kid-a')].depth, rows[at('other')].depth], [0, 1, 0]);
  assert.equal(rows[at('boss')].childCount, 2);
  assert.equal(rows.length, 4); // nothing is lost or repeated
});

test('a started chat whose parent is not in the same list stays where it is, and a loop of parents never hangs', () => {
  const V = require('../src/renderer/view');
  const prefs = { groupBy: 'none', sort: 'priority', pinned: [], mutedChats: [], mutedProjects: [], collapsed: [], density: 'comfortable' };
  const s = (id, over = {}) => ({ id, name: id, folder: 'x', project: 'p', state: 'idle', since: 1, parent: null, ...over });
  const lone = V.buildView([s('kid', { parent: 'gone' })], prefs, '').items;
  assert.equal(lone[0].depth, 0);
  const loop = V.buildView([s('a', { parent: 'b' }), s('b', { parent: 'a' }), s('c', { parent: 'c' })], prefs, '').items;
  assert.equal(loop.length, 3);
});

test('the panel height counts a started chat as a shorter row', () => {
  const V = require('../src/renderer/view');
  const prefs = { groupBy: 'none', sort: 'priority', pinned: [], mutedChats: [], mutedProjects: [], collapsed: [], density: 'comfortable' };
  const s = (id, over = {}) => ({ id, name: id, folder: 'x', project: 'p', state: 'idle', since: 1, parent: null, ...over });
  const flat = V.wantedHeight(V.buildView([s('a'), s('b')], prefs, ''), { density: 'comfortable', footer: false, options: false }, 2000);
  const nested = V.wantedHeight(V.buildView([s('a'), s('b', { parent: 'a' })], prefs, ''), { density: 'comfortable', footer: false, options: false }, 2000);
  assert.equal(flat - nested, V.SIZES.rowComfortable - V.SIZES.rowNested);
});
