# Contacts Migration

Move iCloud contacts from an **old** account (e.g. one whose contacts came from a
dead Exchange server) into a **new** iCloud account — with a verified backup and a
safe, gated deletion of the old copies.

It is **file-based and offline**: you do the export/import on your iPhone and in
macOS **Contacts.app**, and this tool handles the backup, verification, and
deletion. No passwords, no servers, nothing leaves your Mac.

There are two front-ends sharing the same logic:
- a **command-line tool** (`migrate_contacts.py`, Python) — documented below;
- a **cross-platform desktop GUI** (Electron, in [`gui/`](gui/)) for macOS,
  Windows, and Linux — see [gui/README.md](gui/README.md).

> Why file-based? The old Exchange server no longer exists, so there's no live
> account to sync. And macOS Contacts scripting can't pick *which account* a
> contact lives in — so we move data as vCard files and identify the old copies
> by snapshotting your contacts **before** the import.

## Desktop GUI (macOS / Windows / Linux)

A cross-platform Electron app that walks you through the whole migration as a
guided stepper — **Prepare → Select → Migrate → Finish** — with backup,
duplicate review/merge, verification, and a gated delete. Full details:
[gui/README.md](gui/README.md).

**What the GUI adds over the CLI**
- Combine **multiple** export files (e.g. one per phone list/account).
- **Auto-suggested duplicate detection** with per-group review: merge (union of
  fields — editable, and you can exclude members) or keep separate, plus
  ignore/soft-delete. Nameless contacts are matched by company/address/email.
- A live **progress bar** while reading Contacts, an **import confirmation**
  gate, and **post-delete** phone-sync guidance with backup warnings.
- Theme follows your OS light/dark preference.

### Download (no build needed)

Grab the latest installer from the repo's **Releases** (built by CI):
`.dmg` (macOS, arm64 or x64) · `.exe` (Windows) · `.AppImage` (Linux).

> macOS builds are unsigned — on first launch **right‑click the app ▸ Open**, or
> `xattr -dr com.apple.quarantine "/Applications/Contacts Migration.app"`.

### Run from source

```bash
cd gui
npm install
npm start
```

### Build installers

```bash
cd gui
npm run dist:mac     # .dmg (arm64 + x64)
npm run dist:win     # .exe  (run on Windows)
npm run dist:linux   # .AppImage (run on Linux)
```

Output lands in `gui/dist/`. Windows/Linux can't be built from macOS locally —
push a `vX.Y.Z` tag to run the **GitHub Actions release workflow**
(`.github/workflows/release.yml`), which builds all three and attaches them to a
GitHub Release.

---

## Command-line tool (Python)

The rest of this document covers the Python CLI (`migrate_contacts.py`).

## Requirements

- macOS (uses the built-in `Contacts.app` and `osascript`)
- Python 3.9+
- Both the old contacts (as a `.vcf` you export) and the new iCloud account
  available on this Mac for the import/verify steps

## Setup (clone-and-run)

```bash
cd contacts-migration
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# One-time: enable the guard that blocks committing real contact data
git config core.hooksPath hooks
```

## Quick start — the guided wizard

```bash
python3 migrate_contacts.py guide
```

It walks you through all six steps below, validating each one. You can also run
the steps individually (handy to resume or redo a step).

## The steps

### 1. Export the old contacts → `old.vcf`
- **iPhone:** Contacts → select the old contacts (or share the old account's
  list) → Share/Export → save or AirDrop a single `.vcf` to this Mac.
- **or Mac:** Contacts.app → select the old contacts → **File ▸ Export ▸ vCard…**

### 2. Back up
```bash
python3 migrate_contacts.py backup --input old.vcf
```
Writes to `backup/`:
- `contacts_backup_<ts>.csv` — human-readable spreadsheet of every contact
- `old_contacts_<ts>.vcf` — exact lossless copy of your export

### 3. Snapshot the current Contacts.app state
```bash
python3 migrate_contacts.py snapshot --old old.vcf
```
Records every contact currently on this Mac (so the old copies can be precisely
identified later). It reports whether the old contacts are visible on this Mac
(script-delete possible) or are phone-only (manual removal).

> **First run asks for permission.** If you see *error -1743*, grant it under
> **System Settings ▸ Privacy & Security ▸ Automation** (and/or *Contacts*), then
> re-run.

### 4. Import into the NEW account
1. **System Settings ▸ Contacts ▸ Default Account** → your **new iCloud account**.
2. **Contacts.app ▸ File ▸ Import…** → choose `old.vcf` → **Import**.
3. Wait for it to sync to iCloud.

> Setting the default account first is what makes the imported contacts land in
> the new account.

### 5. Verify
Export the **new** account's contacts to `new_export.vcf` (Contacts.app ▸ File ▸
Export ▸ vCard), then:
```bash
python3 migrate_contacts.py verify --old old.vcf --new new_export.vcf
```
Prints `X/Y found …` and writes `backup/verify_report_<ts>.csv`. It **exits
non-zero if any contact is missing**, which blocks deletion. *Low-confidence*
matches are name-only — eyeball those in the report.

### 6. Delete the old copies (gated)
```bash
python3 migrate_contacts.py delete --old old.vcf
```
Refuses unless a backup CSV exists **and** the latest verify report has zero
missing. Then:
- **If the old contacts are on this Mac:** shows exactly which old (pre-import)
  copies it will remove, asks you to type `delete`, then removes only those via
  Contacts.app — the freshly imported copies are never touched.
- **If they're phone-only:** prints the exact steps to remove the old Exchange
  account from your iPhone (which clears the cached old contacts).

Useful flags: `--dry-run` (show what would happen, change nothing), `--yes` (skip
the typed confirmation), `--report PATH` / `--snapshot PATH` (pin specific files).

## Safety notes

- Nothing is deleted until you have a backup **and** a passing verification.
- Deletion targets only the contacts that existed **before** your import, so
  re-running import/verify is safe.
- `backup/` and all contact-bearing files (`*.vcf`, `*.csv`, `*.json`, `*.ics`,
  `*.vcards`, `*.abbu`) are git-ignored so personal contact data is never
  committed. Only the synthetic `sample/sample_*.vcf` fixtures are tracked.
- A **pre-commit hook** (`hooks/pre-commit`, enabled via
  `git config core.hooksPath hooks`) is a hard backstop: it blocks any commit
  that includes a contact-data file type, or any file whose contents contain
  `BEGIN:VCARD`/`BEGIN:VCALENDAR`, unless it is a `sample/sample_*.vcf` fixture.

## Try it without real data

The `sample/` folder has synthetic vCards:
```bash
python3 migrate_contacts.py backup --input sample/sample_old.vcf
python3 migrate_contacts.py verify --old sample/sample_old.vcf --new sample/sample_new_full.vcf      # passes
python3 migrate_contacts.py verify --old sample/sample_old.vcf --new sample/sample_new_missing.vcf   # 1 missing, exits non-zero
```

## Files

| File | Purpose |
|------|---------|
| `migrate_contacts.py` | CLI: `guide`, `backup`, `snapshot`, `verify`, `delete` |
| `contacts_lib.py` | vCard parsing/matching + Contacts.app (`osascript`) helpers |
| `requirements.txt` | `vobject` (vCard parsing) |
| `sample/` | synthetic vCards for testing |
| `backup/` | run output (git-ignored) |
