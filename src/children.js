'use strict';
// Which chats a chat has started. Claude Code keeps no parent id for a chat that another chat started (with the start_session tool), but the
// parent's own transcript records the answer of that tool call, and the answer holds the child's Claude Desktop id (local_<uuid>).
// Pure: text in, ids out. A line is parsed in memory only when it mentions start_session or carries a tool result; only the ids are kept,
// the text is dropped at once and never stored or logged (same rule as usage.js).

const HOST_ID = /local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const MAX_PENDING = 200; // tool calls that have not been answered yet
const MAX_CHILDREN = 500;

function createChildren() {
  const pending = new Set(); // ids of start_session calls whose answer has not been read yet
  const ids = new Set();

  return {
    /** Reads transcript text (whole lines). Returns true when a new child id was found. */
    ingest(text) {
      let changed = false;
      for (const line of String(text).split('\n')) {
        const isCall = line.includes('start_session');
        if (!isCall && pending.size === 0) continue; // nothing to watch for: skip the JSON parse
        if (!isCall && !line.includes('tool_result')) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        const content = j && j.message && j.message.content;
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'tool_use' && typeof b.name === 'string' && /start_session$/.test(b.name) && typeof b.id === 'string') {
            if (pending.size >= MAX_PENDING) pending.delete(pending.values().next().value); // never stop watching because old calls got no answer
            pending.add(b.id);
          } else if (b.type === 'tool_result' && pending.has(b.tool_use_id)) {
            pending.delete(b.tool_use_id);
            const body = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            for (const id of new Set(String(body).match(HOST_ID) || [])) {
              if (!ids.has(id) && ids.size < MAX_CHILDREN) {
                ids.add(id);
                changed = true;
              }
            }
          }
        }
      }
      return changed;
    },
    /** The Desktop ids of the chats this chat started. */
    ids: () => new Set(ids),
  };
}

module.exports = { createChildren, HOST_ID };
