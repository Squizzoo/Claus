// Drives the running pet with REAL mouse events over the Chrome DevTools Protocol.
// Start the pet first:  electron.exe . --remote-debugging-port=9229
//
//   node scripts/ui-test.mjs open        click the cat, report how the list behaves
//   node scripts/ui-test.mjs row [n]     click row n (default 0) and report
//   node scripts/ui-test.mjs x [n]       click the x of row n
//   node scripts/ui-test.mjs view        print what the list shows (groups, rows, search box, footer, focus)
//   node scripts/ui-test.mjs keys <k>... press keys ('Slash' for /, plus letters, ArrowDown, Escape, Enter...)
//   node scripts/ui-test.mjs act <pin|mute|x> [row]   hover a row and click that button
//   node scripts/ui-test.mjs click <selector> [n]     click an element; hover <selector> [n] hovers it
//   node scripts/ui-test.mjs chain <selector>...      click several elements in one run (e.g. '#opts-toggle' then an option)
//   node scripts/ui-test.mjs dblclick                 double-click the pet: the settings window must open and the list close
//   node scripts/ui-test.mjs settings <selector>...   click things in the settings window ('[data-pet=dog]', '#tab-btn-sound'...), print what it shows
//     e.g. snooze for 15 min: settings '#tab-btn-notify' '#snooze button:nth-child(2)'  (tabs: look, sound, notify, behaviour)
// The panel closes when the window loses focus, so commands that click or type open it first.
//
// Output is plain facts (mutation counts, rows, nojump rows) so a human can read it.
const PORT = Number(process.env.CDP_PORT) || 9229;
const [cmd = 'open', arg = '0'] = process.argv.slice(2);

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
// The pet and its chat list are two windows showing the same page, told apart by ?role=pet|panel.
const connect = async (role) => {
  const page = pages.find((p) => p.type === 'page' && (role === 'settings' ? p.url.includes('settings.html') : p.url.includes('index.html') && p.url.includes(`role=${role}`)));
  if (!page) throw new Error(`${role} page not found; is the pet running with --remote-debugging-port?`);
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
  return { ws, send, evaluate };
};
const petPage = await connect('pet');
const panelPage = await connect('panel');
// Everything below talks to the list window; only the click on the cat goes to the pet window.
const { send, evaluate } = panelPage;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y, conn = panelPage) => {
  const { send } = conn;
  const base = { x, y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...base });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...base });
};
const center = (sel, n = 0) => evaluate(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${n}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
const clickPet = async () => {
  const c = await petPage.evaluate(`(() => { const r = document.getElementById('pet').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await click(c.x, c.y, petPage);
  await sleep(600);
};
const mutations = (ms) => evaluate(`new Promise((res) => { let n = 0; const o = new MutationObserver((l) => { n += l.length; }); o.observe(document.getElementById('list'), { childList: true, subtree: true }); setTimeout(() => { o.disconnect(); res(n); }, ${ms}); })`);
const facts = () => evaluate(`({ expanded: !document.getElementById('panel').hidden, rows: document.querySelectorAll('.row').length, nojump: document.querySelectorAll('.row.nojump').length, dismissButtons: document.querySelectorAll('.row .x').length, w: innerWidth, h: innerHeight })`);
// What the list shows right now, as plain text: group headers, rows, the search box, the footer, and what has focus.
const view = () => evaluate(`(() => {
  const $ = (id) => document.getElementById(id);
  const a = document.activeElement;
  return {
    expanded: !$('panel').hidden,
    query: $('search').value,
    count: $('count').textContent,
    items: [...document.querySelectorAll('#list .group, #list .row')].map((e) => e.classList.contains('group')
      ? '[' + e.querySelector('.label').textContent + ' ' + e.querySelector('.n').textContent + (e.getAttribute('aria-expanded') === 'false' ? ' collapsed' : '') + (e.classList.contains('muted') ? ' muted' : '') + ']'
      : e.querySelector('.name').textContent.trim() + ' | ' + e.querySelector('.sub').textContent + (e.querySelector('.x') ? ' | x' : '') + (e.classList.contains('muted') ? ' | muted' : '')),
    emptyNote: $('empty').hidden ? '' : $('empty').textContent,
    footer: $('footer').hidden ? '' : [...$('footer').querySelectorAll('button, #undo-text')].filter((b) => !b.closest('[hidden]') && !b.hidden).map((b) => b.textContent).join(' / '),
    focus: a ? (a.id || a.className || a.tagName) + (a.dataset && a.dataset.id ? ' ' + a.textContent.slice(0, 20) : '') : null,
    h: innerHeight,
  };
})()`);
const VK = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Delete: 46, '/': 191, ' ': 32 };
const CODE = { '/': 'Slash', ' ': 'Space' };
const press = async (name) => {
  const key = name === 'Slash' ? '/' : name; // 'Slash' because Git Bash rewrites a bare "/" argument into a path
  const vk = VK[key] ?? key.toUpperCase().charCodeAt(0);
  const code = CODE[key] ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key); // CDP needs the physical key too
  if (key.length === 1) await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: vk });
  else await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  await sleep(250);
};

// The list closes when focus leaves the pet's windows (like a real click elsewhere), so open it first.
const ensureOpen = async () => {
  if (!(await facts()).expanded) {
    await clickPet();
  }
};

if (cmd === 'open') {
  if (!(await facts()).expanded) {
    await clickPet();
  }
  console.log('after clicking the cat:', JSON.stringify(await facts()));
  console.log('list DOM mutations in 1 s :', await mutations(1000), '(a calm list is 0)');
} else if (cmd === 'view') {
  console.log(JSON.stringify(await view(), null, 1));
} else if (cmd === 'click') {
  // click <selector> [n]: a real click on any element, e.g. '#opts-toggle', '.group', '.row .act[data-act=pin]'
  const [, sel, n = '0'] = process.argv.slice(2);
  await ensureOpen();
  const c = await center(sel, Number(n));
  if (!c) throw new Error(`no ${sel} #${n}`);
  await click(c.x, c.y);
  await sleep(500);
  console.log(JSON.stringify(await view(), null, 1));
} else if (cmd === 'chain') {
  // chain <selector> [<selector> ...]: click each in turn within one run, e.g. '#opts-toggle' '[data-opt=density]'
  await ensureOpen();
  for (const sel of process.argv.slice(3)) {
    const c = await center(sel);
    if (!c || !c.w) throw new Error(`${sel} is not visible`);
    await click(c.x, c.y);
    await sleep(500);
  }
  console.log(JSON.stringify(await view(), null, 1));
  console.log('list class:', await evaluate(`document.getElementById('list').className || '(comfortable)'`), '| groups:', await evaluate(`document.querySelectorAll('.group').length`), '| first row height:', await evaluate(`Math.round(document.querySelector('.row').getBoundingClientRect().height)`));
} else if (cmd === 'hover') {
  // hover <selector> [n]: move the mouse over an element (shows the pin and mute buttons of a row)
  const [, sel, n = '0'] = process.argv.slice(2);
  await ensureOpen();
  const c = await center(sel, Number(n));
  if (!c) throw new Error(`no ${sel} #${n}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await sleep(300);
  console.log('visible hover buttons:', await evaluate(`[...document.querySelectorAll('.hover-acts')].filter((e) => getComputedStyle(e).display !== 'none').length`));
} else if (cmd === 'act') {
  // act <pin|mute|x> [row]: hover the row, then click that button on it (pin and mute only show on hover)
  const [, name, r = '0'] = process.argv.slice(2);
  await ensureOpen();
  const row = await center('.row', Number(r));
  if (!row) throw new Error(`no row #${r}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y });
  await sleep(250);
  const b = await evaluate(`(() => { const e = document.querySelectorAll('.row')[${Number(r)}].querySelector('[data-act=${JSON.stringify(name)}]'); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
  if (!b) throw new Error(`row #${r} has no ${name} button`);
  await click(b.x, b.y);
  await sleep(600);
  console.log(JSON.stringify(await view(), null, 1));
} else if (cmd === 'keys') {
  // keys <key> [<key> ...]: press real keys, e.g. '/' then 'b' 'o' 'n' 'ArrowDown' 'Escape'
  await ensureOpen();
  // start every run from a clean search box with nothing focused, so runs do not depend on each other
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input')); document.activeElement.blur(); })()`);
  for (const k of process.argv.slice(3)) await press(k);
  console.log(JSON.stringify(await view(), null, 1));
} else if (cmd === 'row' || cmd === 'x') {
  const sel = cmd === 'row' ? '.row' : '.row .x';
  const c = await center(sel, Number(arg));
  if (!c) throw new Error(`no ${sel} #${arg}`);
  console.log(`clicking ${sel} #${arg} at ${Math.round(c.x)},${Math.round(c.y)}`);
  await click(c.x, c.y);
  await sleep(1500);
  console.log('after the click:', JSON.stringify(await facts()));
}
else if (cmd === 'dblclick') {
  const c = await petPage.evaluate(`(() => { const r = document.getElementById('pet').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const tap = async (clickCount) => {
    const base = { x: c.x, y: c.y, button: 'left', clickCount };
    await petPage.send('Input.dispatchMouseEvent', { type: 'mousePressed', buttons: 1, ...base });
    await sleep(40);
    await petPage.send('Input.dispatchMouseEvent', { type: 'mouseReleased', buttons: 0, ...base });
  };
  await petPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await tap(1);
  await sleep(120);
  await tap(2);
  await sleep(1200);
  const now = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  console.log('settings window open:', now.some((p) => p.url.includes('settings.html')), '| list open:', JSON.stringify(await facts()));
} else if (cmd === 'settings') {
  const set = await connect('settings');
  for (const sel of process.argv.slice(3)) {
    const r = await set.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, w: q.width }; })()`);
    if (!r || !r.w) throw new Error(`${sel} is not visible in the settings window`);
    await click(r.x, r.y, set);
    await sleep(500);
  }
  console.log(JSON.stringify(await set.evaluate(`(() => {
    const on = (sel, attr = 'aria-checked') => [...document.querySelectorAll(sel)].filter((e) => e.getAttribute(attr) === 'true').map((e) => e.title || e.dataset.pet || e.dataset.pack || e.dataset.value || e.textContent.trim());
    return {
      tab: on('#tabs [role=tab]', 'aria-selected'), pet: on('.card'), skin: on('.swatch'), accessory: on('#accessories .tile'), mustache: on('#mustaches .tile'),
      pack: on('.pack').map((_, i) => document.querySelector('.pack[aria-checked=true]').dataset.pack), volume: on('#volume button'), quiet: on('#quiet button'), patience: on('#patience button'),
      muted: document.getElementById('muted').checked, streak: document.getElementById('streak').checked, mood: on('#moods button', 'aria-pressed'), stage: document.getElementById('stage').className,
    };
  })()`)));
  console.log('pet window root:', await petPage.evaluate(`document.getElementById('root').className + ' | fur=' + document.getElementById('root').style.getPropertyValue('--fur') + ' | stache=' + !!document.querySelector('#tilt .stache') + ' | accessory=' + !!document.querySelector('#tilt .accessory')`));
  set.ws.close();
}
petPage.ws.close();
panelPage.ws.close();
