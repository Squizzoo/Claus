'use strict';
// Token totals of one chat, from the usage counters in its transcript (a JSONL file Claude Code keeps).
// Pure: text in, numbers out. A line that carries usage is parsed in memory (it also holds the message text), but only the
// message id and the four counters are kept; everything else is dropped at once and never stored or logged.
//
// Claude Code writes the same assistant message several times while it streams (same `message.id`), so
// totals are kept per id, taking the largest value of each counter, and summed at the end.

const FIELDS = { input: 'input_tokens', output: 'output_tokens', cacheWrite: 'cache_creation_input_tokens', cacheRead: 'cache_read_input_tokens' };
const MAX_ID = 100;

const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function createUsage() {
  const byId = new Map();
  let sum = null; // cached totals, dropped whenever a counter moves

  return {
    /** Reads transcript text: whole lines only (the caller cuts at a newline). Returns true when the totals changed. */
    ingest(text) {
      let changed = false;
      for (const line of String(text).split('\n')) {
        if (!line.includes('"usage"')) continue; // most lines are not usage at all, so skip the JSON parse
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue; // a damaged line is not worth anything
        }
        const m = j && j.type === 'assistant' ? j.message : null;
        if (!m || typeof m.id !== 'string' || m.id.length > MAX_ID || !m.usage || typeof m.usage !== 'object') continue;
        const prev = byId.get(m.id) || { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
        const next = { ...prev };
        for (const [key, name] of Object.entries(FIELDS)) next[key] = Math.max(prev[key], count(m.usage[name]));
        if (Object.keys(FIELDS).some((k) => next[k] !== prev[k]) || !byId.has(m.id)) {
          byId.set(m.id, next);
          changed = true;
        }
      }
      if (changed) sum = null;
      return changed;
    },
    /** {input, output, cacheWrite, cacheRead} summed over every message, or null before the first one. */
    totals() {
      if (!byId.size) return null;
      if (!sum) {
        sum = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
        for (const u of byId.values()) for (const k of Object.keys(sum)) sum[k] += u[k];
      }
      return { ...sum };
    },
  };
}

/** What the badge counts: everything the chat sent and got back, without the cache reads (those repeat the context every turn and balloon). */
function badgeTokens(u) {
  return u ? u.input + u.output + u.cacheWrite : 0;
}

module.exports = { createUsage, badgeTokens, FIELDS };
