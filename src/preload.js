'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onAlert: (cb) => ipcRenderer.on('alert', (_e, a) => cb(a)),
  onCelebrate: (cb) => ipcRenderer.on('celebrate', (_e, c) => cb(c)),
  togglePanel: (wantedHeight) => ipcRenderer.send('toggle-panel', wantedHeight),
  panelHeight: (h) => ipcRenderer.send('panel-height', h),
  collapse: () => ipcRenderer.send('collapse'),
  painted: (id) => ipcRenderer.send('painted', id),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  jump: (id) => ipcRenderer.send('jump', id),
  dismiss: (id) => ipcRenderer.send('dismiss', id),
  clearFinished: () => ipcRenderer.send('clear-finished'),
  clearIdle: () => ipcRenderer.send('clear-idle'),
  undo: () => ipcRenderer.send('undo'),
  unhide: () => ipcRenderer.send('unhide'),
  setPrefs: (patch) => ipcRenderer.send('set-prefs', patch),
});
