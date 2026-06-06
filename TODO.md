# Contacts Migration — TODO / Roadmap

Status of remaining work for the CLI + the cross-platform Electron GUI.

## In progress / just added
- [x] Snapshot **progress bar** + chunked `listPeople` (fixes the "hangs while
      querying existing contacts" issue on large address books).
- [x] **Confirm-import** button on the Import step that unlocks Verify.
- [x] **Post-delete** guidance card: sync phone from iCloud, optional
      "desktop overwrites phone" flow, and back-up-every-list warnings.

## High priority — features still to build
- [ ] **Combine multiple export files** (new sub-step between "Choose file" and
      "Select"). Repeatable: add several `.vcf` exports (e.g. one per phone
      list/account) and merge them into one working set before selection.
      - Concatenate parsed contacts from N files; show running total.
      - De-dupe identical entries on merge (feeds the dedupe step below).
- [ ] **Smart dedupe / merge** (before selection):
      - Detect duplicate groups (same normalized name + shared phone/email; also
        fuzzy name match as a weaker signal).
      - Review UI: show each candidate group side-by-side; let the user
        **Merge** (union of fields, pick a primary), **Keep separate**, or
        **Ignore/soft-delete** one copy.
      - Merged/ignored contacts are greyed out / flagged in the Select list and
        excluded from the import file accordingly.
      - Merge logic: union phones/emails/addresses (dedupe values), prefer
        non-empty org/title/note; keep a record of what was merged.

## Packaging / distribution
- [ ] **x64 + universal macOS** build (current dmg is arm64 only — won't run on
      Intel Macs). Add `--mac --x64` / `--universal` targets.
- [ ] **x64 Linux** AppImage (current is arm64).
- [ ] **Windows** installer (`.exe`/NSIS) — needs Wine locally, or build via CI.
- [ ] **GitHub Actions release workflow**: build mac (dmg, x64+arm64), Windows
      (exe), Linux (AppImage) on each tag; attach to a GitHub Release.
- [ ] **App icon** (`.icns` / `.ico` / png) — currently the default Electron icon.
- [ ] **Code signing + notarization** (macOS Developer ID; Windows cert) so users
      don't hit Gatekeeper / SmartScreen warnings. Needs Apple Developer account.

## Testing / QA
- [ ] **Real-device end-to-end test** on a Mac with real Contacts.app:
      grant Automation permission, snapshot, import, verify, delete.
- [ ] **Sample-data run-through** of every GUI step using `testdata/` fixtures
      (old_contacts.vcf, new_export_full.vcf, new_export_missing.vcf).
- [ ] **Large address book** test (1000+ contacts) to confirm the chunked
      snapshot progress is smooth and not slow/hung.
- [ ] **Light/dark theme** visual pass in both OS appearances.
- [ ] **Windows/Linux** smoke test (no Contacts automation → guided-manual delete).
- [ ] Add automated tests for `gui/src/core` beyond the current selftest
      (vCard edge cases: folding, quoted-printable, vCard 2.1, emoji, big notes).

## Nice to have
- [ ] Remember last-used folder / recent files.
- [ ] "Selected only" view + sort in the contact list.
- [ ] Export the verify report / backup location shortcuts (reveal in Finder).
- [ ] Accent theme toggle (Discord blurple vs Spotify green).
- [ ] Persist progress so the wizard can resume after a restart.

## Housekeeping
- [ ] Commit + push packaging config (electron-builder) and these GUI updates.
- [ ] Update top-level README + `gui/README.md` for the new steps and packaging.
