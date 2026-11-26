'use strict';
// How the pet fits into the computer, kept in pet-settings.json (settings.system): starting with Windows, following Claude Desktop,
// and whether the first-run question about the Claude Code hooks has been asked. Pure: validates whatever is loaded or sent.

const DEFAULTS = {
  setupAsked: false, // the first-run dialog has been shown (whatever was answered): it never nags twice
  login: false, // start with Windows
  followClaude: false, // hide while Claude Desktop is not running, show again when it is
};

const KEYS = Object.keys(DEFAULTS);

/** Returns the settings with every field valid; unknown keys are dropped. */
function sanitize(input, base = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of KEYS) out[key] = typeof src[key] === 'boolean' ? src[key] : base[key];
  return out;
}

/** Applies a partial change on top of the current settings. */
function merge(current, patch) {
  return sanitize({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) }, current);
}

/**
 * What this build can do. Starting with Windows needs an installed build (a dev checkout or a portable exe has no stable path),
 * the first-run question is only asked from a packaged build (or when forced with --setup).
 */
function capabilities({ packaged, portable }) {
  return { login: Boolean(packaged) && !portable, updates: Boolean(packaged) && !portable, firstRun: Boolean(packaged) };
}

/** Should the first-run dialog about the hooks come up now? */
function shouldAskSetup({ settings, firstRun, forced, hooksComplete, hooksFileExists }) {
  if (!forced && !firstRun) return false;
  if (!forced && settings.setupAsked) return false;
  if (hooksComplete) return false;
  return hooksFileExists !== false; // no Claude Code settings file at all: nothing to add the hooks to
}

/** The running Claude Desktop is gone for good only after this many answers in a row (rides out an app restart). */
const GONE_AFTER_POLLS = 2;

/** Folds one answer of the "is Claude Desktop running" helper into the count of misses; `null` (no usable answer) changes nothing. */
function missesAfter(misses, answer) {
  if (!answer) return misses;
  return answer.running ? 0 : Math.min(misses + 1, GONE_AFTER_POLLS);
}

const claudeGone = (misses) => misses >= GONE_AFTER_POLLS;

module.exports = { DEFAULTS, sanitize, merge, capabilities, shouldAskSetup, missesAfter, claudeGone, GONE_AFTER_POLLS };
