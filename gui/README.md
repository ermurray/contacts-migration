# Contacts Migration — Desktop GUI

A cross-platform (macOS / Windows / Linux) Electron app for the same workflow as
the Python CLI: **back up → verify → delete the old copies**, fully offline.

The vCard parsing, backup, and verification logic is reimplemented in Node (no
Python required); it mirrors `contacts_lib.py` so both front-ends agree on what
counts as "the same contact".

## Run (development)

```bash
cd gui
npm install
npm start
```

## Build installers

```bash
npm run dist   # uses electron-builder -> dmg (mac) / nsis (win) / AppImage (linux)
```

> `electron-builder` is invoked on demand; add it as a dev dependency
> (`npm i -D electron-builder`) on the machine where you cut releases.

## What it does, step by step

1. **Choose old `.vcf`** — the export of your old contacts (from the iPhone or
   Contacts.app).
2. **Back up** — writes a human-readable CSV + a lossless copy of the export to
   `~/Documents/ContactsMigration/backup/`.
3. **Snapshot** *(macOS only)* — records the contacts currently in Contacts.app
   so the old copies can later be deleted precisely. Prompts for Automation
   permission the first time.
4. **Import** — guidance: set the new iCloud account as the default, then import
   your old `.vcf` in Contacts.app.
5. **Verify** — choose a fresh export of the **new** account; the app confirms
   every old contact is present and writes a report CSV. The Delete button stays
   **locked** until this passes.
6. **Delete old copies** —
   - **macOS:** shows exactly which pre-import originals will be removed, requires
     you to type `delete`, then removes only those via Contacts.app (imported
     copies are never touched).
   - **Windows / Linux:** there is no scriptable system contacts database, so the
     app shows guided manual-removal steps instead (the backup + verification are
     still done for you).

## Platform notes

- **Deletion automation is macOS-only** by design — Windows/Linux have no
  Contacts.app to script. All other steps work on every OS.
- Security posture: `contextIsolation: true`, `nodeIntegration: false`, a strict
  renderer CSP, and a minimal `preload` API surface. All filesystem and
  `osascript` work happens in the main process.

## Architecture

```
gui/
  main.js              Electron main process + IPC handlers
  preload.js           contextBridge API exposed to the renderer
  src/core/            shared, framework-free logic (unit-tested)
    vcard.js           dependency-free vCard 3.0 parser
    match.js           normalizers + contact matching
    backup.js          CSV + vcf backup
    verify.js          old-vs-new diff
    deleteMac.js       Contacts.app bridge (osascript) — macOS only
  src/renderer/        UI (index.html, styles.css, renderer.js)
  test/selftest.js     core-logic tests:  npm test
```

## Test

```bash
npm test   # runs the core-logic self-test against ../sample/*.vcf
```
