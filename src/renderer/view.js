'use strict';
// The chat list as data: filter, pin, group and sort, with no DOM, so it can be unit tested.
// Loaded as a plain script in the renderer (window.PetView) and with require() in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Keep in step with PRIORITY in src/state.js (test/view.test.js checks this).
  const PRIORITY = { idle: 0, working: 1, done: 2, question: 3, approval: 4 };
  const PINNED_KEY = '*pinned'; // cannot be a path, so it never collides with a project key
  const SIZES = { rowComfortable: 54, rowCompact: 34, group: 30, header: 40, search: 44, options: 64, footer: 40, pad: 8 };
  // options is two rows of pills at the 300 px panel width (wraps), not one.

  /** A length of time for a row: `42s`, `4m 12s`, `1h 05m`. */
  function formatDuration(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  /** A token count for a row: `812`, `4.2k`, `48k`, `1.2M`. */
  function formatTokens(n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    if (n < 1000) return String(n);
    if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    if (n < 999_500) return `${Math.round(n / 1000)}k`;
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  /** How long ago something happened, to the second: `just now` under 5 s, else `8s ago`, `2m 10s ago`. */
  function formatAgo(ms) {
    return ms < 5000 ? 'just now' : `${formatDuration(ms)} ago`;
  }

  const tokens = (query) => String(query || '').toLowerCase().split(/\s+/).filter(Boolean);

  function matches(session, words) {
    if (!words.length) return true;
    const hay = `${session.name} ${session.folder || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }

  function compare(sort) {
    if (sort === 'recent') return (a, b) => b.since - a.since;
    return (a, b) => PRIORITY[b.state] - PRIORITY[a.state] || b.since - a.since;
  }

  function topOf(rows) {
    // Muted chats do not count towards a group's colour, unless nothing else is left.
    const loud = rows.filter((r) => !r.muted);
    const pool = loud.length ? loud : rows;
    let state = 'idle';
    for (const r of pool) if (PRIORITY[r.state] > PRIORITY[state]) state = r.state;
    return state;
  }

  function group(key, label, rows, extra) {
    return {
      type: 'group',
      key,
      label,
      count: rows.length,
      state: topOf(rows),
      late: rows.some((r) => r.overdue && !r.muted),
      newest: Math.max(...rows.map((r) => r.since)),
      urgent: Math.max(...rows.map((r) => (r.muted ? 0 : PRIORITY[r.state]))),
      ...extra,
    };
  }

  /**
   * sessions: snapshot sessions; prefs: see src/prefs.js; query: the search box text.
   * Returns { items, rows, groups, total, shown } where items is the flat list to draw:
   * group headers (type 'group') followed by their rows (type 'row'), minus collapsed groups.
   */
  function buildView(sessions, prefs, query) {
    const words = tokens(query);
    const searching = words.length > 0;
    const pinned = new Set(prefs.pinned);
    const mutedChats = new Set(prefs.mutedChats);
    const mutedProjects = new Set(prefs.mutedProjects);
    const collapsed = new Set(prefs.collapsed);
    const cmp = compare(prefs.sort);

    const rows = sessions
      .filter((s) => matches(s, words))
      .map((s) => ({ type: 'row', ...s, pinned: pinned.has(s.id), mutedChat: mutedChats.has(s.id) }))
      .sort(cmp);

    const items = [];
    let groups = 0;
    const pushGroup = (g, members) => {
      groups++;
      items.push(g);
      if (!g.collapsed) items.push(...members);
    };

    if (prefs.groupBy === 'project') {
      const pins = rows.filter((r) => r.pinned);
      if (pins.length) {
        pushGroup(group(PINNED_KEY, 'Pinned', pins, { kind: 'pinned', collapsed: !searching && collapsed.has(PINNED_KEY) }), pins);
      }
      const byProject = new Map();
      for (const r of rows) {
        if (r.pinned) continue;
        if (!byProject.has(r.project)) byProject.set(r.project, []);
        byProject.get(r.project).push(r);
      }
      const made = [...byProject].map(([key, members]) => ({
        g: group(key, members[0].folder || 'Other', members, {
          kind: 'project',
          muted: mutedProjects.has(key),
          collapsed: !searching && collapsed.has(key),
        }),
        members,
      }));
      made.sort((a, b) => (prefs.sort === 'recent' ? b.g.newest - a.g.newest : b.g.urgent - a.g.urgent || b.g.newest - a.g.newest));
      for (const { g, members } of made) pushGroup(g, members);
    } else {
      const ordered = [...rows.filter((r) => r.pinned), ...rows.filter((r) => !r.pinned)];
      items.push(...ordered);
    }

    return { items, rows, groups, total: sessions.length, shown: rows.length };
  }

  /** The row Enter in the search box opens: the first visible chat that can be opened. */
  function firstJumpable(view) {
    return view.items.find((i) => i.type === 'row' && i.jumpable) || null;
  }

  /**
   * Window height the panel wants. Pass the view built WITHOUT a query so the window does not
   * jump while typing. `footer` and `options` say whether those bars are showing.
   */
  function wantedHeight(view, { density, footer, options }, max) {
    const rowH = density === 'compact' ? SIZES.rowCompact : SIZES.rowComfortable;
    const shownRows = view.items.filter((i) => i.type === 'row').length; // collapsed groups hide theirs
    const body = view.items.length === 0 ? SIZES.rowComfortable : shownRows * rowH + view.groups * SIZES.group;
    const h = SIZES.header + SIZES.search + (options ? SIZES.options : 0) + body + (footer ? SIZES.footer : 0) + SIZES.pad;
    return Math.min(h, max);
  }

  return { buildView, firstJumpable, wantedHeight, formatDuration, formatAgo, formatTokens, PRIORITY, PINNED_KEY, SIZES };
});
