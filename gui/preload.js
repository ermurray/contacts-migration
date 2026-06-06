'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit API surface exposed to the renderer.
contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('platform'),
  pickVcf: (title) => ipcRenderer.invoke('pick-vcf', title),
  loadContacts: (vcfPath) => ipcRenderer.invoke('load-contacts', vcfPath),
  writeSelection: (vcfPath, indices) => ipcRenderer.invoke('write-selection', vcfPath, indices),
  backup: (vcfPath) => ipcRenderer.invoke('backup', vcfPath),
  snapshot: (vcfPath) => ipcRenderer.invoke('snapshot', vcfPath),
  verify: (oldPath, newPath) => ipcRenderer.invoke('verify', oldPath, newPath),
  deletePlan: (oldPath, snapPath) => ipcRenderer.invoke('delete-plan', oldPath, snapPath),
  deleteApply: (ids) => ipcRenderer.invoke('delete-apply', ids),
  openSettings: (which) => ipcRenderer.invoke('open-settings', which),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
});
