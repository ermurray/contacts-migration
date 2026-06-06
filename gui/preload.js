'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit API surface exposed to the renderer.
contextBridge.exposeInMainWorld('api', {
  platform: () => ipcRenderer.invoke('platform'),
  pickVcf: (title) => ipcRenderer.invoke('pick-vcf', title),
  loadFiles: (paths) => ipcRenderer.invoke('load-files', paths),
  findDuplicates: (paths) => ipcRenderer.invoke('find-duplicates', paths),
  writeImport: (items) => ipcRenderer.invoke('write-import', items),
  backupFiles: (paths) => ipcRenderer.invoke('backup-files', paths),
  snapshot: (vcfPath) => ipcRenderer.invoke('snapshot', vcfPath),
  verify: (oldPath, newPath) => ipcRenderer.invoke('verify', oldPath, newPath),
  deletePlan: (oldPath, snapPath) => ipcRenderer.invoke('delete-plan', oldPath, snapPath),
  deleteApply: (ids) => ipcRenderer.invoke('delete-apply', ids),
  openSettings: (which) => ipcRenderer.invoke('open-settings', which),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
});
