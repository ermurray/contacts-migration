'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { parseVcards } = require('./src/core/vcard');
const { writeBackup } = require('./src/core/backup');
const { verify, reportCsv } = require('./src/core/verify');
const del = require('./src/core/deleteMac');

// Per-user output dir for backups/reports (outside the app bundle).
function backupDir() {
  const dir = path.join(app.getPath('documents'), 'ContactsMigration', 'backup');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 760,
    title: 'Contacts Migration',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

// ----- IPC handlers (all logic stays in the main process) -----

ipcMain.handle('platform', () => ({
  platform: process.platform,
  isMac: process.platform === 'darwin',
  backupDir: backupDir(),
}));

ipcMain.handle('pick-vcf', async (_e, title) => {
  const res = await dialog.showOpenDialog({
    title: title || 'Choose a vCard (.vcf) file',
    properties: ['openFile'],
    filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('backup', async (_e, vcfPath) => {
  const contacts = parseVcards(fs.readFileSync(vcfPath, 'utf8'));
  if (!contacts.length) throw new Error('No contacts parsed from that file.');
  const res = writeBackup(contacts, vcfPath, backupDir());
  return res;
});

ipcMain.handle('snapshot', async (_e, vcfPath) => {
  if (!del.isMac()) {
    return { supported: false, manual: del.MANUAL_STEPS };
  }
  let people;
  try {
    people = await del.listPeople();
  } catch (err) {
    if (err instanceof del.PermissionError) {
      return { supported: true, permission: del.PERMISSION_HELP };
    }
    throw err;
  }
  const snapPath = path.join(backupDir(), `preimport_snapshot_${Date.now()}.json`);
  fs.writeFileSync(snapPath, JSON.stringify(people, null, 2), 'utf8');
  let present = 0;
  if (vcfPath) {
    const old = parseVcards(fs.readFileSync(vcfPath, 'utf8'));
    present = del.computeDeletable(old, people).length;
  }
  return { supported: true, snapPath, total: people.length, present };
});

ipcMain.handle('verify', async (_e, oldPath, newPath) => {
  const oldC = parseVcards(fs.readFileSync(oldPath, 'utf8'));
  const newC = parseVcards(fs.readFileSync(newPath, 'utf8'));
  const r = verify(oldC, newC);
  const reportPath = path.join(backupDir(), `verify_report_${Date.now()}.csv`);
  fs.writeFileSync(reportPath, reportCsv(r.rows), 'utf8');
  return { ...r, reportPath };
});

// Compute what would be deleted (no changes) — drives the confirm dialog.
ipcMain.handle('delete-plan', async (_e, oldPath, snapPath) => {
  if (!del.isMac()) return { mode: 'manual', manual: del.MANUAL_STEPS };
  if (!snapPath || !fs.existsSync(snapPath)) {
    return { mode: 'manual', manual: del.MANUAL_STEPS,
      note: 'No pre-import snapshot found; cannot script-delete.' };
  }
  const old = parseVcards(fs.readFileSync(oldPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const targets = del.computeDeletable(old, snapshot);
  if (!targets.length) return { mode: 'manual', manual: del.MANUAL_STEPS };
  return { mode: 'script', targets };
});

// Actually delete (called only after the renderer confirms).
ipcMain.handle('delete-apply', async (_e, ids) => {
  try {
    const removed = await del.deletePeopleById(ids);
    return { removed };
  } catch (err) {
    if (err instanceof del.PermissionError) {
      return { permission: del.PERMISSION_HELP };
    }
    throw err;
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
