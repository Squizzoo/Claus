'use strict';
// Finds each chat's transcript and keeps its token totals up to date by reading only what was appended.
// The file is located from the (already validated) session id, never from a path a hook sent.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUsage } = require('./usage');

const DIR = process.env.CLAUDE_PET_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SLICE = 4 * 1024 * 1024; // read this much at a time
const MAX_SLICE = 64 * 1024 * 1024; // a single line longer than this is skipped
const RETRY_MS = 30_000; // how long to wait before looking again for a transcript that was not there

/** The transcript of a session: <dir>/<project folder>/<sessionId>.jsonl, or null. */
function findTranscript(sessionId, dir = DIR) {
  if (!SESSION_ID.test(String(sessionId))) return null;
  let folders;
  try {
    folders = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of folders) {
    const file = path.join(dir, f, `${sessionId}.jsonl`);
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      /* not in this folder */
    }
  }
  return null;
}

function createTranscriptReader({ dir = DIR, now = Date.now } = {}) {
  const files = new Map(); // sessionId -> { file, offset, usage, missAt }

  /** Reads what was appended since the last call. Resolves true when the totals changed. Never rejects. */
  async function refresh(sessionId) {
    try {
      let e = files.get(sessionId);
      if (!e) {
        e = { file: null, offset: 0, usage: createUsage(), missAt: 0 };
        files.set(sessionId, e);
      }
      if (!e.file) {
        if (e.missAt && now() - e.missAt < RETRY_MS) return false;
        e.file = findTranscript(sessionId, dir);
        if (!e.file) {
          e.missAt = now();
          return false;
        }
      }
      let size;
      try {
        size = (await fs.promises.stat(e.file)).size;
      } catch {
        e.file = null; // gone: look again later
        e.missAt = now();
        return false;
      }
      if (size < e.offset) { // rewritten smaller: start over
        e.offset = 0;
        e.usage = createUsage();
      }
      let changed = false;
      const fh = await fs.promises.open(e.file, 'r');
      try {
        while (e.offset < size) {
          let len = Math.min(SLICE, size - e.offset);
          let buf;
          let cut;
          for (;;) { // grow the slice until it holds a whole line
            buf = Buffer.alloc(len);
            const { bytesRead } = await fh.read(buf, 0, len, e.offset);
            buf = buf.subarray(0, bytesRead);
            cut = buf.lastIndexOf(10);
            if (cut >= 0 || e.offset + bytesRead >= size || len >= MAX_SLICE) break;
            len = Math.min(len * 2, MAX_SLICE, size - e.offset);
          }
          if (cut < 0) {
            if (e.offset + buf.length >= size && buf.length < MAX_SLICE) break; // a half-written last line: wait for the rest
            cut = buf.length - 1; // an absurdly long line: drop it
          }
          if (e.usage.ingest(buf.subarray(0, cut + 1).toString('utf8'))) changed = true;
          e.offset += cut + 1;
        }
      } finally {
        await fh.close();
      }
      return changed;
    } catch {
      return false; // reading is best effort; the badge just stays as it was
    }
  }

  return {
    refresh,
    totals: (sessionId) => (files.has(sessionId) ? files.get(sessionId).usage.totals() : null),
    /** Forgets chats that no longer exist. */
    keepOnly(ids) {
      for (const id of [...files.keys()]) if (!ids.has(id)) files.delete(id);
    },
  };
}

module.exports = { createTranscriptReader, findTranscript, DIR };
