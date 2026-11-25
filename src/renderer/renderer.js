'use strict';
(() => {
  const root = document.getElementById('root');
  const petEl = document.getElementById('pet');
  const panel = document.getElementById('panel');
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const badge = document.getElementById('badge');
  const bubbleText = document.getElementById('bubble-text');
  const chips = document.getElementById('chips');

  const ROW_H = 54;
  const HEADER_H = 40;
  const MAX_PANEL = 420;
  const LABEL = { approval: 'needs approval', question: 'has a question', done: 'finished', working: 'working', idle: 'idle' };
  const BUBBLE = { sleep: 'z z', idle: '', working: '…', done: '✓', question: '?', approval: '!' };

  let last = { sessions: [], mood: 'idle', attention: 0, overdue: false, types: { approval: 0, question: 0, done: 0 }, expanded: false };
  let audio = null;

  function wantedHeight(n) {
    return Math.min(HEADER_H + Math.max(n, 1) * ROW_H + 8, MAX_PANEL);
  }

  // ---------- rendering ----------
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    return Math.floor(s / 3600) + ' h ago';
  }

  function dur(ms) {
    const m = Math.floor(ms / 60000);
    return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // One chip per kind of notification, kept between renders so they don't replay their pop-in.
  const chipEls = new Map();
  const CHIP = { approval: '!', question: '?', done: '✓' };
  function renderChips(state) {
    const kinds = ['approval', 'question', 'done'].filter((k) => state.types[k] > 0);
    const multi = kinds.length >= 2;
    const late = new Set(state.sessions.filter((s) => s.overdue).map((s) => s.state));
    for (const [k, el] of chipEls) {
      if (!multi || !kinds.includes(k)) { el.remove(); chipEls.delete(k); }
    }
    if (multi) {
      kinds.forEach((k, i) => {
        let el = chipEls.get(k);
        if (!el) {
          el = document.createElement('div');
          el.append(document.createTextNode(CHIP[k]), document.createElement('small'));
          chipEls.set(k, el);
        }
        el.className = `chip k-${k}${late.has(k) ? ' late' : ''}`;
        el.style.setProperty('--i', String(i));
        el.querySelector('small').textContent = String(state.types[k]);
        el.querySelector('small').hidden = state.types[k] < 2;
        chips.append(el); // append keeps urgent-first order: approval, question, done
      });
    }
    return multi;
  }

  function render(state) {
    last = state;
    const mood = state.sessions.length === 0 ? 'sleep' : state.mood;
    root.className = `side-${state.layout.side} ${state.layout.vertical} mood-${mood}${state.overdue ? ' angry' : ''}`;
    const multi = renderChips(state);
    const text = state.overdue && !multi ? (mood === 'question' ? '?!' : '!!') : BUBBLE[mood] ?? '';
    bubbleText.textContent = text;
    document.getElementById('bubble').style.visibility = text && !multi ? 'visible' : 'hidden';

    badge.hidden = state.attention === 0;
    badge.textContent = String(state.attention);
    badge.className = state.attention ? `s-${state.mood}` : '';

    panel.hidden = !state.expanded;
    count.textContent = state.sessions.length ? `${state.attention} waiting · ${state.sessions.length} open` : '';
    empty.hidden = state.sessions.length > 0;
    list.hidden = state.sessions.length === 0;

    list.textContent = '';
    for (const s of state.sessions) {
      const li = document.createElement('li');
      li.className = `row s-${s.state}${s.jumpable ? '' : ' nojump'}${s.overdue ? ' late' : ''}`;
      li.tabIndex = 0;
      li.title = s.jumpable ? 'Open this chat' : 'This chat is not in Claude Desktop, so it cannot be opened from here';

      const dot = document.createElement('span');
      dot.className = 'dot';
      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = s.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      const showFolder = s.folder && s.folder.toLowerCase() !== s.name.toLowerCase();
      const when = s.overdue ? `waiting ${dur(Date.now() - s.since)}!` : ago(s.since);
      sub.textContent = `${LABEL[s.state]} · ${when}${showFolder ? ' · ' + s.folder : ''}`;
      text.append(name, sub);
      li.append(dot, text);

      if (s.state === 'done') {
        const x = document.createElement('button');
        x.className = 'x';
        x.textContent = '×';
        x.title = 'Dismiss';
        x.addEventListener('click', (e) => { e.stopPropagation(); window.pet.dismiss(s.id); });
        li.append(x);
      } else {
        li.append(document.createElement('span'));
      }
      const open = () => s.jumpable && window.pet.jump(s.id);
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      list.append(li);
    }
    if (state.expanded) window.pet.panelHeight(wantedHeight(state.sessions.length));
  }

  // ---------- sound ----------
  function chime(states) {
    try {
      audio = audio || new AudioContext();
      const top = states.includes('overdue') ? 'overdue' : states.includes('approval') ? 'approval' : states.includes('question') ? 'question' : 'done';
      const notes = { done: [660, 880], question: [587, 740, 880], approval: [880, 698, 880], overdue: [523, 440, 523, 440] }[top];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const t = audio.currentTime + i * 0.13;
        o.type = top === 'overdue' ? 'triangle' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + 0.3);
      });
    } catch { /* no audio device */ }
  }

  // ---------- drag vs click on the pet ----------
  let down = null;
  petEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    petEl.setPointerCapture(e.pointerId);
    down = { x: e.screenX, y: e.screenY, dragging: false };
  });
  petEl.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down.dragging = true;
      window.pet.dragStart();
    }
    if (down.dragging) window.pet.dragMove();
  });
  const finish = (e) => {
    if (!down) return;
    const wasDrag = down.dragging;
    down = null;
    if (wasDrag) window.pet.dragEnd();
    else if (e.type === 'pointerup') window.pet.togglePanel(wantedHeight(last.sessions.length));
  };
  petEl.addEventListener('pointerup', finish);
  petEl.addEventListener('pointercancel', finish);
  petEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') window.pet.togglePanel(wantedHeight(last.sessions.length));
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.pet.collapse(); });

  window.pet.onState(render);
  window.pet.onAlert(chime);
  setInterval(() => last.expanded && render(last), 30_000); // refresh "x min ago"
  render({ ...last, layout: { side: 'right', vertical: 'up' } });
})();
