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

  const ROW_H = 54;
  const HEADER_H = 40;
  const MAX_PANEL = 420;
  const LABEL = { approval: 'needs approval', question: 'has a question', done: 'finished', working: 'working', idle: 'idle' };
  const BUBBLE = { sleep: 'z z', idle: '', working: '…', done: '✓', question: '?', approval: '!' };

  let last = { sessions: [], mood: 'idle', attention: 0, expanded: false };
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

  function render(state) {
    last = state;
    const mood = state.sessions.length === 0 ? 'sleep' : state.mood;
    root.className = `side-${state.layout.side} ${state.layout.vertical} mood-${mood}`;
    bubbleText.textContent = BUBBLE[mood] ?? '';
    document.getElementById('bubble').style.visibility = BUBBLE[mood] ? 'visible' : 'hidden';

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
      li.className = `row s-${s.state}${s.jumpable ? '' : ' nojump'}`;
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
      sub.textContent = `${LABEL[s.state]} · ${ago(s.since)}${showFolder ? ' · ' + s.folder : ''}`;
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
      const top = states.includes('approval') ? 'approval' : states.includes('question') ? 'question' : 'done';
      const notes = { done: [660, 880], question: [587, 740, 880], approval: [880, 698, 880] }[top];
      notes.forEach((f, i) => {
        const o = audio.createOscillator();
        const g = audio.createGain();
        const t = audio.currentTime + i * 0.13;
        o.type = 'sine';
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
