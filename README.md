# Contacts Migration

Move iCloud contacts from an **old** account (e.g. one whose contacts came from a
dead Exchange server) into a **new** iCloud account — with a verified backup and a
safe, gated deletion of the old copies.

It is **file-based and offline**: you do the export/import on your iPhone and in
macOS **Contacts.app**, and this tool handles the backup, verification, and
deletion. No passwords, no servers, nothing leaves your Mac.

> Why file-based? The old Exchange server no longer exists, so there's no live
> account to sync. And macOS Contacts scripting can't pick *which account* a
> contact lives in — so we move data as vCard files and identify the old copies
> by snapshotting your contacts **before** the import.

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
- `backup/` and all `*.vcf` / `*.csv` files are git-ignored so personal contact
  data is never committed.

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
