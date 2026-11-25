'use strict';
// List preferences kept in pet-settings.json. Pure: validates whatever the renderer sends so a
// bad value can never end up in the settings file.

const DEFAULTS = {
  groupBy: 'project',
  sort: 'needs-me',
  density: 'comfortable',
  collapsed: [], // project keys of collapsed groups ('' = the "Other" group)
  pinned: [], // chat ids
  mutedChats: [], // chat ids
  mutedProjects: [], // project keys
};

const CHOICES = {
  groupBy: ['project', 'none'],
  sort: ['needs-me', 'recent'],
  density: ['comfortable', 'compact'],
};
const LISTS = ['collapsed', 'pinned', 'mutedChats', 'mutedProjects'];
const MAX_ITEMS = 200;
const MAX_LEN = 260;

function cleanList(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const v of value) {
    if (typeof v !== 'string' || v.length > MAX_LEN) continue;
    if (!out.includes(v)) out.push(v);
  }
  // New entries are added at the end, so when the list is too long keep the newest, never the oldest.
  return out.slice(-MAX_ITEMS);
}

/** Returns the preferences with every field valid; unknown keys are dropped. */
function sanitize(input, base = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [key, allowed] of Object.entries(CHOICES)) {
    out[key] = allowed.includes(src[key]) ? src[key] : base[key];
  }
  for (const key of LISTS) {
    out[key] = cleanList(src[key]) ?? [...base[key]];
  }
  return out;
}

/** Applies a partial update from the renderer on top of the current preferences. */
function merge(current, patch) {
  return sanitize({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) }, current);
}

module.exports = { DEFAULTS, sanitize, merge, MAX_ITEMS };
