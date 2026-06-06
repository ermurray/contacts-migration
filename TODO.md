# Contacts Migration — TODO / Roadmap

Status of remaining work for the CLI + the cross-platform Electron GUI.

## In progress / just added
- [x] Snapshot **progress bar** + chunked `listPeople` (fixes the "hangs while
      querying existing contacts" issue on large address books).
- [x] **Confirm-import** button on the Import step that unlocks Verify.
- [x] **Post-delete** guidance card: sync phone from iCloud, optional
      "desktop overwrites phone" flow, and back-up-every-list warnings.

## High priority — features
- [x] **Combine multiple export files** (Select sub-step 1). Repeatable; merges
      several `.vcf` exports into one working set with a running total.
- [x] **Smart dedupe / merge** (Select sub-step 2): auto-suggested duplicate
      groups (transitive grouping), per-group **Merge** (union phones/emails/
      addresses, most-complete name/org) or **Keep separate**, plus
      **Ignore/Restore** (soft-delete, greyed out) in the selection list.

## Packaging / distribution
- [x] **x64 macOS** dmg (built locally; `mac` target now `arch: [arm64, x64]`).
- [x] **GitHub Actions release workflow** (`.github/workflows/release.yml`):
      builds macOS (arm64+x64 dmg), Windows (exe), Linux (AppImage) on each `v*`
      tag and attaches to a GitHub Release; manual run uploads artifacts.
- [ ] **First tagged release** — push a `v1.0.0` tag to produce the full matrix
      (Windows/Linux come from CI, not buildable locally on macOS).
- [ ] **Universal macOS** dmg (single Intel+Apple-Silicon binary) — optional.
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
