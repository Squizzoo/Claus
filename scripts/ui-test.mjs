// Drives the running pet with REAL mouse events over the Chrome DevTools Protocol.
// Start the pet first:  electron.exe . --remote-debugging-port=9229
//
//   node scripts/ui-test.mjs open        click the cat, report how the list behaves
//   node scripts/ui-test.mjs row [n]     click row n (default 0) and report
//   node scripts/ui-test.mjs x [n]       click the x of row n
//
// Output is plain facts (mutation counts, rows, nojump rows) so a human can read it.
const PORT = Number(process.env.CDP_PORT) || 9229;
const [cmd = 'open', arg = '0'] = process.argv.slice(2);

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes('index.html'));
if (!page) throw new Error('pet page not found; is it running with --remote-debugging-port?');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => {
  const base = { x, y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...base });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...base });
};
const center = (sel, n = 0) => evaluate(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${n}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
const mutations = (ms) => evaluate(`new Promise((res) => { let n = 0; const o = new MutationObserver((l) => { n += l.length; }); o.observe(document.getElementById('list'), { childList: true, subtree: true }); setTimeout(() => { o.disconnect(); res(n); }, ${ms}); })`);
const facts = () => evaluate(`({ expanded: !document.getElementById('panel').hidden, rows: document.querySelectorAll('.row').length, nojump: document.querySelectorAll('.row.nojump').length, dismissButtons: document.querySelectorAll('.row .x').length, w: innerWidth, h: innerHeight })`);

if (cmd === 'open') {
  if (!(await facts()).expanded) {
    const c = await center('#pet');
    await click(c.x, c.y);
    await sleep(600);
  }
  console.log('after clicking the cat:', JSON.stringify(await facts()));
  console.log('list DOM mutations in 1 s :', await mutations(1000), '(a calm list is 0)');
} else if (cmd === 'row' || cmd === 'x') {
  const sel = cmd === 'row' ? '.row' : '.row .x';
  const c = await center(sel, Number(arg));
  if (!c) throw new Error(`no ${sel} #${arg}`);
  console.log(`clicking ${sel} #${arg} at ${Math.round(c.x)},${Math.round(c.y)}`);
  await click(c.x, c.y);
  await sleep(1500);
  console.log('after the click:', JSON.stringify(await facts()));
}
ws.close();
