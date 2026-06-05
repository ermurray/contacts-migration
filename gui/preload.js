'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit API surface exposed to the renderer.
contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('platform'),
  pickVcf: (title) => ipcRenderer.invoke('pick-vcf', title),
  backup: (vcfPath) => ipcRenderer.invoke('backup', vcfPath),
  snapshot: (vcfPath) => ipcRenderer.invoke('snapshot', vcfPath),
  verify: (oldPath, newPath) => ipcRenderer.invoke('verify', oldPath, newPath),
  deletePlan: (oldPath, snapPath) => ipcRenderer.invoke('delete-plan', oldPath, snapPath),
  deleteApply: (ids) => ipcRenderer.invoke('delete-apply', ids),
});
