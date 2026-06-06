'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { parseVcards, serialize } = require('./src/core/vcard');
const { writeBackupCombined } = require('./src/core/backup');
const { verify, reportCsv } = require('./src/core/verify');
const { groupDuplicates, mergeContacts } = require('./src/core/dedupe');
const del = require('./src/core/deleteMac');

// Parse one or more .vcf files into flat records with stable uids (fileIdx:idx).
function parseAll(paths) {
  const all = [];
  paths.forEach((p, fi) => {
    parseVcards(fs.readFileSync(p, 'utf8')).forEach((c, i) => {
      all.push({ uid: `${fi}:${i}`, contact: c });
    });
  });
  return all;
}

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

// Parse one or more .vcf files into a combined record list for the UI.
ipcMain.handle('load-files', async (e, paths) => {
  const all = parseAll(paths);
  progress(e, `Loaded ${all.length} contacts from ${paths.length} file(s).`);
  return {
    count: all.length,
    records: all.map((r) => ({
      uid: r.uid,
      fullName: r.contact.fullName || '(no name)',
      org: r.contact.org,
      emails: r.contact.emails.map((x) => x.value),
      phones: r.contact.phones.map((x) => x.value),
      raw: r.contact.raw,
    })),
  };
});

// Find duplicate groups across the combined set and propose a merged contact.
ipcMain.handle('find-duplicates', async (e, paths) => {
  const all = parseAll(paths);
  const { groups } = groupDuplicates(all.map((r) => r.contact));
  progress(e, `Found ${groups.length} possible duplicate group(s).`);
  return {
    groups: groups.map((idxs, gid) => {
      const members = idxs.map((i) => all[i]);
      const merged = mergeContacts(members.map((m) => m.contact));
      return {
        id: gid,
        memberUids: members.map((m) => m.uid),
        members: members.map((m) => ({
          uid: m.uid,
          fullName: m.contact.fullName,
          emails: m.contact.emails.map((x) => x.value),
          phones: m.contact.phones.map((x) => x.value),
        })),
        merged: {
          fullName: merged.fullName,
          org: merged.org,
          emails: merged.emails.map((x) => x.value),
          phones: merged.phones.map((x) => x.value),
          raw: serialize(merged),
        },
      };
    }),
  };
});

// Write the chosen vCards (originals' raw or merged vCards) to an import file.
ipcMain.handle('write-import-raw', async (e, rawList) => {
  if (!rawList || !rawList.length) throw new Error('No contacts selected.');
  const body = rawList.map((r) => String(r).trim()).join('\r\n') + '\n';
  const outPath = path.join(backupDir(), `to_import_${Date.now()}.vcf`);
  fs.writeFileSync(outPath, body, 'utf8');
  progress(e, `Prepared ${rawList.length} contacts for import.`);
  return { importPath: outPath, count: rawList.length };
});

// Back up ALL contacts across the chosen files (CSV + combined vcf).
ipcMain.handle('backup-files', async (e, paths) => {
  const all = parseAll(paths);
  const contacts = all.map((r) => r.contact);
  if (!contacts.length) throw new Error('No contacts to back up.');
  progress(e, `Backing up ${contacts.length} contacts…`);
  return writeBackupCombined(contacts, backupDir());
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
