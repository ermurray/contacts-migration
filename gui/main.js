'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// Open the relevant macOS privacy pane directly (no-op label elsewhere).
ipcMain.handle('open-settings', async (_e, which) => {
  if (process.platform === 'darwin') {
    const urls = {
      automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
      contacts: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts',
    };
    await shell.openExternal(urls[which] || urls.automation);
    return { opened: true };
  }
  return { opened: false };
});

ipcMain.handle('pick-vcf', async (_e, title) => {
  const res = await dialog.showOpenDialog({
    title: title || 'Choose a vCard (.vcf) file',
    properties: ['openFile'],
    filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

// Emit a live progress line to the renderer that made the request.
function progress(e, msg) {
  if (e && e.sender && !e.sender.isDestroyed()) e.sender.send('progress', { msg });
}

// Parse a .vcf into a lightweight list for the selection UI.
ipcMain.handle('load-contacts', async (e, vcfPath) => {
  progress(e, `Reading ${path.basename(vcfPath)}…`);
  const contacts = parseVcards(fs.readFileSync(vcfPath, 'utf8'));
  progress(e, `Parsed ${contacts.length} contacts.`);
  return contacts.map((c, i) => ({
    index: i,
    fullName: c.fullName || '(no name)',
    org: c.org,
    emails: c.emails.map((x) => x.value),
    phones: c.phones.map((x) => x.value),
  }));
});

// Write only the selected contacts to a curated import file (lossless vCards).
ipcMain.handle('write-selection', async (e, vcfPath, indices) => {
  const contacts = parseVcards(fs.readFileSync(vcfPath, 'utf8'));
  const chosen = indices.map((i) => contacts[i]).filter(Boolean);
  if (!chosen.length) throw new Error('No contacts selected.');
  const body = chosen.map((c) => c.raw.trim()).join('\r\n') + '\r\n';
  const outPath = path.join(backupDir(), `to_import_${Date.now()}.vcf`);
  fs.writeFileSync(outPath, body, 'utf8');
  progress(e, `Prepared ${chosen.length} contacts for import.`);
  return { importPath: outPath, count: chosen.length };
});

ipcMain.handle('backup', async (e, vcfPath) => {
  progress(e, `Reading ${path.basename(vcfPath)}…`);
  const contacts = parseVcards(fs.readFileSync(vcfPath, 'utf8'));
  if (!contacts.length) throw new Error('No contacts parsed from that file.');
  progress(e, `Parsed ${contacts.length} contacts.`);
  progress(e, 'Writing CSV + lossless vCard copy…');
  const res = writeBackup(contacts, vcfPath, backupDir());
  return res;
});

ipcMain.handle('snapshot', async (e, vcfPath) => {
  if (!del.isMac()) {
    return { supported: false, manual: del.MANUAL_STEPS };
  }
  progress(e, 'Querying Contacts.app… (may prompt for permission)');
  let people;
  try {
    people = await del.listPeople((p) => {
      if (e && e.sender && !e.sender.isDestroyed()) e.sender.send('progress', p);
    });
  } catch (err) {
    if (err instanceof del.PermissionError) {
      return { supported: true, permission: del.PERMISSION_HELP };
    }
    throw err;
  }
  progress(e, `Read ${people.length} contacts from Contacts.app.`);
  const snapPath = path.join(backupDir(), `preimport_snapshot_${Date.now()}.json`);
  fs.writeFileSync(snapPath, JSON.stringify(people, null, 2), 'utf8');
  let present = 0;
  if (vcfPath) {
    progress(e, 'Checking which old contacts exist here…');
    const old = parseVcards(fs.readFileSync(vcfPath, 'utf8'));
    present = del.computeDeletable(old, people).length;
  }
  return { supported: true, snapPath, total: people.length, present };
});

ipcMain.handle('verify', async (e, oldPath, newPath) => {
  progress(e, 'Parsing old export…');
  const oldC = parseVcards(fs.readFileSync(oldPath, 'utf8'));
  progress(e, 'Parsing new account export…');
  const newC = parseVcards(fs.readFileSync(newPath, 'utf8'));
  progress(e, `Matching ${oldC.length} contacts against ${newC.length}…`);
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
ipcMain.handle('delete-apply', async (e, ids) => {
  try {
    progress(e, `Deleting ${ids.length} old contact(s) via Contacts.app…`);
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
