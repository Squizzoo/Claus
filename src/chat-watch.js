'use strict';
// The Chat tab of Claude Desktop fires no hooks. Its conversation page (claude.ai/chat/<id>) shows a "Stop response" button while a
// reply streams and "Send message" when idle; chat-watch.ps1 reads that through UI Automation, and this turns its answer into data.
// Only the conversation each window shows right now can be seen. Parsing is pure; the helper starts when first asked.
const { createHelper } = require('./ps-helper');

const ENTRY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([wi]):([fb])$/;

/**
 * `chats=<id>:<w|i>:<f|b>,...` -> [{ id, working, foreground }] (`chats=` is an empty list: nothing on screen).
 * Anything else, or a malformed entry, is null (no usable answer): the caller must not read it as "no chat open".
 */
function parseChats(line) {
  const m = /^chats=(.*)$/.exec(String(line || '').trim());
  if (!m) return null;
  if (m[1] === '') return [];
  const out = [];
  for (const part of m[1].split(',')) {
    const e = ENTRY.exec(part);
    if (!e) return null;
    out.push({ id: e[1], working: e[2] === 'w', foreground: e[3] === 'f' });
  }
  return out;
}

function createChatWatcher() {
  // idleMs 0: the loop in main.js keeps asking, and stop() ends the helper when the setting is turned off
  const helper = createHelper('chat-watch.ps1', { timeoutMs: 6000, idleMs: 0 });
  return {
    /** [{ id, working, foreground }] (empty: no Chat tab conversation on screen), or null when the helper gave no usable answer. */
    read: async () => parseChats(await helper.ask('c')),
    stop: helper.stop,
  };
}

module.exports = { createChatWatcher, parseChats };
