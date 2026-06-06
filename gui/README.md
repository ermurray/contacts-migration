# Contacts Migration — Desktop GUI

A cross-platform (macOS / Windows / Linux) Electron app that guides the whole
migration as a 4-phase stepper — **Prepare → Select → Migrate → Finish** —
fully offline. It does everything the Python CLI does, plus combining multiple
exports and an interactive duplicate merge.

The vCard parsing, matching, backup, dedupe, and verification logic is
implemented in Node (no Python required); it mirrors the CLI's `contacts_lib.py`
so both front-ends agree on what counts as "the same contact".

## Run (development)

```bash
cd gui
npm install
npm start
```

## Build installers

```bash
npm run dist        # current OS
npm run dist:mac    # dmg, arm64 + x64
npm run dist:win    # nsis .exe (needs Windows or Wine)
npm run dist:linux  # AppImage
```

Output lands in `gui/dist/`. macOS builds are unsigned/ad-hoc (`identity: null`),
so other Macs will show a Gatekeeper warning — right‑click ▸ Open, or
`xattr -dr com.apple.quarantine "/Applications/Contacts Migration.app"`.

### Cross-platform releases (CI)

`.github/workflows/release.yml` builds **macOS (arm64+x64 dmg)**, **Windows
(exe)**, and **Linux (AppImage)** natively:

- Push a tag `vX.Y.Z` → builds all three and attaches them to a GitHub Release.
- Run the workflow manually (workflow_dispatch) → uploads them as artifacts.

Windows and Linux installers can't be built from macOS locally — use the CI.

## What it does, phase by phase

**Prepare**
1. **Connect your iPhone** (only needed for AirDrop) and **export your contacts**
   — guided for the on‑device export, iCloud.com, or Mac Contacts.app.

**Select**
2. **Add export file(s)** — add one `.vcf`, or several (e.g. one per phone
   list/account); they're combined into a single working set.
3. **Review duplicates** — auto‑suggested duplicate groups. Per group: **Merge**
   (union of phones/emails/addresses) or **Keep separate**. Each member is an
   expandable card you can inspect; uncheck a member to exclude it from the merge,
   and edit the merged result before it's used. Nameless contacts are matched by
   company / address / email / notes.
4. **Select which to migrate** — merged contacts show a badge; **Ignore** greys a
   contact out and excludes it. The chosen set is written to an import file.

**Migrate**
5. **Back up** — CSV + a lossless combined `.vcf` of **all** contacts to
   `~/Documents/ContactsMigration/backup/`.
6. **Snapshot** *(macOS only)* — records the contacts currently in Contacts.app,
   with a progress bar, so old copies can later be deleted precisely. Prompts for
   Automation permission the first time (a button opens the right Settings pane).
7. **Import** — set the new iCloud account as the default and import the prepared
   file in Contacts.app, then click **I've imported them** to unlock verify.
8. **Verify** — choose a fresh export of the **new** account; the app confirms
   every selected contact is present and writes a report CSV. Delete stays
   **locked** until this passes.

**Finish**
9. **Delete old copies** —
   - **macOS:** shows exactly which pre-import originals will be removed, requires
     you to type `delete`, then removes only those via Contacts.app (imported
     copies are never touched).
   - **Windows / Linux:** no scriptable system contacts database, so it shows
     guided manual-removal steps (backup + verification are still done for you).
   - Followed by **post-delete guidance**: sync the new contacts to your iPhone
     (and an optional "make the phone match the desktop" flow), with warnings to
     back up every phone list first.

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
    vcard.js           dependency-free vCard 3.0 parse + serialize
    match.js           normalizers + contact matching (incl. nameless)
    dedupe.js          duplicate grouping + union merge
    backup.js          CSV + combined vcf backup
    verify.js          old-vs-new diff
    deleteMac.js       Contacts.app bridge (osascript) — macOS only
  src/renderer/        UI (index.html, styles.css, renderer.js)
  test/selftest.js     core-logic tests:  npm test
```

## Test

```bash
npm test   # runs the core-logic self-test against ../sample/*.vcf
```
