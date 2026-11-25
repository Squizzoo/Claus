'use strict';
// Pure session-state logic: no Electron, no I/O, so it can be unit tested.
//
// States, from least to most urgent:
//   idle      nothing happening
//   working   Claude is running a turn
//   done      Claude finished its turn (you may want to look)
//   question  Claude asked you something (AskUserQuestion / elicitation)
//   approval  Claude needs a permission approval

const PRIORITY = { idle: 0, working: 1, done: 2, question: 3, approval: 4 };
const ATTENTION = new Set(['done', 'question', 'approval']);
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STALE_WORKING_MS = 30_000;
const REGISTRY_GRACE_MS = 60_000;

/**
 * Maps one hook payload to the session's next state.
 * Returns a state name, 'removed', or null for "no change".
 */
function nextState(payload, current) {
  const tool = payload.tool_name;
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return 'idle';
    case 'UserPromptSubmit':
      return 'working';
    case 'PreToolUse':
      return tool === 'AskUserQuestion' ? 'question' : 'working';
    case 'PermissionRequest':
      return tool === 'AskUserQuestion' ? 'question' : 'approval';
    case 'PostToolUse':
      return 'working';
    case 'Stop':
    case 'StopFailure':
      return 'done';
    case 'Notification':
      switch (payload.notification_type) {
        case 'permission_prompt':
          return current === 'question' ? null : 'approval';
        case 'elicitation_dialog':
        case 'agent_needs_input':
          return 'question';
        case 'idle_prompt':
          return current === 'question' || current === 'approval' ? null : 'done';
        default:
          return null;
      }
    case 'SessionEnd':
      return 'removed';
    default:
      return null;
  }
}

function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(p);
}

class SessionStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.sessions = new Map();
    this.registrySynced = false;
    this.alerts = []; // pending {id, state} for the UI to chime
  }

  _get(id) {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        name: '',
        cwd: '',
        state: 'idle',
        since: this.now(),
        lastHookAt: 0,
        hostSessionId: null,
        entrypoint: null,
        inRegistry: false,
        registryStatus: null,
        registryStatusAt: 0,
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  _set(s, state) {
    if (s.state === state) return false;
    s.state = state;
    s.since = this.now();
    if (ATTENTION.has(state)) this.alerts.push({ id: s.id, state });
    return true;
  }

  /** Applies a (sanitised) hook payload. Returns true when anything changed. */
  applyHook(payload) {
    const id = payload && payload.session_id;
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return false;
    const existing = this.sessions.get(id);
    const next = nextState(payload, existing ? existing.state : 'idle');
    if (next === null) return false;
    if (next === 'removed') return this.sessions.delete(id);
    const s = this._get(id);
    s.lastHookAt = this.now();
    if (payload.cwd && !s.cwd) s.cwd = String(payload.cwd);
    if (!s.name) s.name = basename(s.cwd);
    return this._set(s, next) || !existing;
  }

  /** Merges the session registry (~/.claude/sessions/*.json). Returns true when anything changed. */
  syncRegistry(entries) {
    let changed = false;
    const seen = new Set();
    const now = this.now();

    for (const e of entries) {
      if (!e || !SESSION_ID.test(String(e.sessionId))) continue;
      seen.add(e.sessionId);
      const isNew = !this.sessions.has(e.sessionId);
      const s = this._get(e.sessionId);
      if (isNew) changed = true;

      const name = e.name || basename(e.cwd);
      if (s.name !== name) { s.name = name; changed = true; }
      if (e.cwd && s.cwd !== e.cwd) { s.cwd = e.cwd; changed = true; }
      if (s.hostSessionId !== (e.hostSessionId || null)) { s.hostSessionId = e.hostSessionId || null; changed = true; }
      s.entrypoint = e.entrypoint || null;
      s.inRegistry = true;
      s.registryStatus = e.status || null;
      s.registryStatusAt = e.statusUpdatedAt || 0;

      // Reconcile with what the registry says. Attention states are only
      // left when the registry shows the chat running again after the alert.
      if (e.status === 'busy') {
        const resumed = (e.statusUpdatedAt || 0) > s.since + 1000;
        if (s.state === 'idle' || s.state === 'done') changed = this._set(s, 'working') || changed;
        else if ((s.state === 'question' || s.state === 'approval') && resumed) {
          changed = this._set(s, 'working') || changed;
        }
      } else if (e.status === 'idle') {
        if (s.state === 'working' && now - s.since > STALE_WORKING_MS) {
          changed = this._set(s, 'idle') || changed;
        }
      }
    }

    // Registry is authoritative for who exists, once we have seen it at least once.
    if (this.registrySynced) {
      for (const [id, s] of this.sessions) {
        if (!seen.has(id) && s.inRegistry) { this.sessions.delete(id); changed = true; }
        else if (!seen.has(id) && !s.inRegistry && now - s.lastHookAt > REGISTRY_GRACE_MS) {
          this.sessions.delete(id); changed = true;
        }
      }
    }
    this.registrySynced = true;
    return changed;
  }

  /** The user looked at / dismissed a finished chat. */
  dismiss(id) {
    const s = this.sessions.get(id);
    if (s && s.state === 'done') return this._set(s, 'idle');
    return false;
  }

  dismissAllDone() {
    let changed = false;
    for (const s of this.sessions.values()) if (s.state === 'done') changed = this._set(s, 'idle') || changed;
    return changed;
  }

  takeAlerts() {
    const a = this.alerts;
    this.alerts = [];
    return a;
  }

  snapshot() {
    const list = [...this.sessions.values()].sort(
      (a, b) => PRIORITY[b.state] - PRIORITY[a.state] || b.since - a.since
    );
    let mood = 'idle';
    let attention = 0;
    for (const s of list) {
      if (PRIORITY[s.state] > PRIORITY[mood]) mood = s.state;
      if (ATTENTION.has(s.state)) attention++;
    }
    return {
      mood,
      attention,
      sessions: list.map((s) => ({
        id: s.id,
        name: s.name || '(untitled)',
        folder: basename(s.cwd),
        state: s.state,
        since: s.since,
        jumpable: Boolean(s.hostSessionId),
      })),
    };
  }

  /** Registry data needed to open a chat; kept out of the UI snapshot. */
  hostIdOf(id) {
    const s = this.sessions.get(id);
    return s ? s.hostSessionId : null;
  }
}

module.exports = { SessionStore, nextState, PRIORITY, ATTENTION, SESSION_ID, basename };
