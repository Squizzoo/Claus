'use strict';
const http = require('http');

const DEFAULT_PORT = 47821;
const MAX_BODY = 2_000_000; // PermissionRequest payloads can carry big tool inputs

/**
 * Keeps only the fields the pet needs. Tool inputs, prompts and messages are
 * dropped on purpose: they are never stored, logged or forwarded.
 */
function pick(p) {
  if (!p || typeof p !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.slice(0, 300) : undefined);
  return {
    session_id: str(p.session_id),
    hook_event_name: str(p.hook_event_name),
    tool_name: str(p.tool_name),
    notification_type: str(p.notification_type),
    cwd: str(p.cwd),
  };
}

/**
 * Localhost-only receiver for Claude Code `http` hooks. It always answers `{}`
 * immediately, which every hook event treats as "no opinion", so the pet can
 * never block or change what Claude does.
 */
function createServer({ onHook, port = DEFAULT_PORT }) {
  const server = http.createServer((req, res) => {
    const reply = (code, body = '{}') => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    };
    // Browsers always send Origin on cross-site requests; hooks never do.
    if (req.headers.origin) return reply(403);
    if (req.method === 'GET' && req.url === '/health') return reply(200, '{"ok":true,"app":"claude-pet"}');
    if (req.method !== 'POST' || req.url !== '/hook') return reply(404);

    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      reply(200); // answer first, think after
      try {
        const payload = pick(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (payload) onHook(payload);
      } catch {
        /* malformed body: ignore */
      }
    });
    req.on('error', () => {});
  });
  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { createServer, pick, DEFAULT_PORT };
