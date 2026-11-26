'use strict';
// Windows toast notifications: thin Electron wiring around `Notification`. The decision whether to show one lives in notify.js.
// Only the chat name, the kind of alert and the project folder go into a toast; never prompts or tool content.
const { Notification } = require('electron');

const BODY = { done: 'Finished', question: 'Asked a question', approval: 'Needs approval', overdue: 'Still waiting for you' };
const live = new Set(); // a Notification that is not referenced can be garbage collected before its click arrives

/**
 * Shows a toast for one chat. `onClick` runs when the toast is clicked. Returns true when it was shown.
 * Toasts are silent: the pet already plays its own sound.
 */
function showToast({ name, folder, state }, onClick, onShown) {
  if (!Notification.isSupported()) return false;
  const body = [BODY[state] || 'Needs you', folder && folder !== name ? folder : ''].filter(Boolean).join(' · ');
  const n = new Notification({ title: name || '(untitled)', body, silent: true, timeoutType: state === 'done' ? 'default' : 'never' });
  live.add(n);
  const release = () => live.delete(n);
  n.on('show', () => onShown && onShown());
  n.on('click', () => {
    release();
    onClick();
  });
  n.on('close', release);
  n.on('failed', release);
  n.show();
  return true;
}

module.exports = { showToast };
