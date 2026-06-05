#!/usr/bin/env python3
"""Migrate iCloud contacts from an old (dead-Exchange) account to a new one.

File-based and offline: you export/import via the iPhone and macOS Contacts.app,
this tool handles the backup, verification, and (gated) deletion of the old
copies. Run `python3 migrate_contacts.py guide` for the interactive walkthrough,
or use the individual subcommands.

See README.md for the full runbook.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

import contacts_lib as lib
from contacts_lib import Contact

HERE = Path(__file__).resolve().parent
BACKUP_DIR = HERE / "backup"


# --------------------------------------------------------------------------
# small utilities
# --------------------------------------------------------------------------

def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _ensure_backup_dir() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return BACKUP_DIR


def _latest(glob: str) -> Path | None:
    files = sorted(BACKUP_DIR.glob(glob))
    return files[-1] if files else None


def _person_to_contact(person: dict) -> Contact:
    c = Contact(full_name=person.get("name", ""))
    c.phones = [("phone", v) for v in person.get("phones", [])]
    c.emails = [("email", v) for v in person.get("emails", [])]
    return c


def _confirm(prompt: str, expect: str = "yes") -> bool:
    try:
        ans = input(f"{prompt} (type '{expect}' to proceed): ").strip()
    except EOFError:
        return False
    return ans == expect


# --------------------------------------------------------------------------
# backup
# --------------------------------------------------------------------------

CSV_FIELDS = ["full_name", "org", "title", "phones", "emails",
              "addresses", "birthday", "note"]


def write_csv(contacts: list[Contact], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        w.writeheader()
        for c in contacts:
            w.writerow({
                "full_name": c.full_name,
                "org": c.org,
                "title": c.title,
                "phones": lib.join_labeled(c.phones),
                "emails": lib.join_labeled(c.emails),
                "addresses": " | ".join(c.addresses),
                "birthday": c.birthday,
                "note": c.note.replace("\n", " "),
            })


def cmd_backup(args) -> int:
    src = Path(args.input)
    if not src.exists():
        print(f"error: input file not found: {src}", file=sys.stderr)
        return 2
    contacts = lib.load_contacts(src)
    if not contacts:
        print(f"error: no vCards parsed from {src}", file=sys.stderr)
        return 2
    _ensure_backup_dir()
    ts = _ts()
    csv_path = BACKUP_DIR / f"contacts_backup_{ts}.csv"
    vcf_path = BACKUP_DIR / f"old_contacts_{ts}.vcf"
    write_csv(contacts, csv_path)
    shutil.copy2(src, vcf_path)
    print(f"Backed up {len(contacts)} contacts")
    print(f"  CSV (human-readable): {csv_path}")
    print(f"  vCard (lossless):     {vcf_path}")
    return 0


# --------------------------------------------------------------------------
# snapshot (pre-import state of Contacts.app)
# --------------------------------------------------------------------------

def cmd_snapshot(args) -> int:
    try:
        people = lib.list_people()
    except lib.ContactsPermissionError:
        print(lib.PERMISSION_HELP, file=sys.stderr)
        return 3
    _ensure_backup_dir()
    ts = _ts()
    snap_path = BACKUP_DIR / f"preimport_snapshot_{ts}.json"
    snap_path.write_text(json.dumps(people, indent=2), encoding="utf-8")
    print(f"Snapshot: {len(people)} contacts currently in Contacts.app")
    print(f"  saved to {snap_path}")

    if args.old:
        old = lib.load_contacts(args.old)
        n_present = _count_present(old, people)
        print(f"\nOf {len(old)} old contacts, {n_present} are visible in this "
              f"Mac's Contacts.app.")
        if n_present == 0:
            print("=> Old contacts appear to be phone-only; the delete step "
                  "will guide manual account removal instead of script-delete.")
        else:
            print("=> Script-delete will be available after verification.")
    return 0


def _count_present(old: list[Contact], people: list[dict]) -> int:
    snap_contacts = [_person_to_contact(p) for p in people]
    n = 0
    for o in old:
        if any(o.matches(s)[0] for s in snap_contacts):
            n += 1
    return n


# --------------------------------------------------------------------------
# verify
# --------------------------------------------------------------------------

def _match_in(target: Contact, pool: list[Contact]) -> tuple[str, Contact | None]:
    """Return (status, matched) where status in matched/low-confidence/missing."""
    low = None
    for cand in pool:
        ok, lowconf = target.matches(cand)
        if ok and not lowconf:
            return ("matched", cand)
        if ok and lowconf:
            low = cand
    if low is not None:
        return ("low-confidence", low)
    return ("missing", None)


def cmd_verify(args) -> int:
    old = lib.load_contacts(args.old)
    new = lib.load_contacts(args.new)
    _ensure_backup_dir()
    report = Path(args.report) if args.report else (
        BACKUP_DIR / f"verify_report_{_ts()}.csv")

    rows = []
    counts = {"matched": 0, "low-confidence": 0, "missing": 0}
    for o in old:
        status, _ = _match_in(o, new)
        counts[status] += 1
        rows.append({
            "full_name": o.full_name,
            "status": status,
            "phones": lib.join_labeled(o.phones),
            "emails": lib.join_labeled(o.emails),
        })

    with report.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["full_name", "status",
                                           "phones", "emails"])
        w.writeheader()
        w.writerows(rows)

    total = len(old)
    verified = counts["matched"] + counts["low-confidence"]
    print(f"Verify: {verified}/{total} found in new export "
          f"({counts['matched']} confident, "
          f"{counts['low-confidence']} low-confidence, "
          f"{counts['missing']} MISSING)")
    print(f"  report: {report}")
    if counts["missing"]:
        print("\nMissing contacts (NOT safe to delete yet):", file=sys.stderr)
        for r in rows:
            if r["status"] == "missing":
                print(f"  - {r['full_name']}", file=sys.stderr)
        return 1
    if counts["low-confidence"]:
        print("\nNote: low-confidence matches were name-only; review the report "
              "before deleting.")
    return 0


def _verify_passed(report: Path) -> bool:
    with report.open(encoding="utf-8") as fh:
        return all(row["status"] != "missing" for row in csv.DictReader(fh))


# --------------------------------------------------------------------------
# delete
# --------------------------------------------------------------------------

def cmd_delete(args) -> int:
    # --- gate on backup + passing verify ---
    backup_csv = _latest("contacts_backup_*.csv")
    if backup_csv is None:
        print("refuse: no backup CSV found in backup/. Run `backup` first.",
              file=sys.stderr)
        return 2
    report = Path(args.report) if args.report else _latest("verify_report_*.csv")
    if report is None or not report.exists():
        print("refuse: no verify report found. Run `verify` first.",
              file=sys.stderr)
        return 2
    if not _verify_passed(report):
        print(f"refuse: verify report {report.name} has MISSING contacts. "
              "Re-import and re-verify before deleting.", file=sys.stderr)
        return 2

    old = lib.load_contacts(args.old)
    snap_path = Path(args.snapshot) if args.snapshot else _latest(
        "preimport_snapshot_*.json")

    # --- decide mode: script-delete vs manual ---
    snapshot = []
    if snap_path and snap_path.exists():
        snapshot = json.loads(snap_path.read_text(encoding="utf-8"))
    snap_contacts = [_person_to_contact(p) for p in snapshot]

    # old contacts that have a pre-import twin in Contacts.app -> deletable by id
    to_delete_ids: list[str] = []
    to_delete_names: list[str] = []
    for o in old:
        for p, sc in zip(snapshot, snap_contacts):
            if o.matches(sc)[0]:
                to_delete_ids.append(p["id"])
                to_delete_names.append(p.get("name") or o.full_name)
                break

    print(f"Backup CSV:    {backup_csv}")
    print(f"Verify report: {report.name} (passed)")

    if not to_delete_ids:
        # Manual fallback (phone-only Exchange contacts).
        print("\nNo old copies were found in this Mac's Contacts.app "
              "(they are likely phone-only Exchange contacts).")
        print("Manual removal (safe — migration is verified and backed up):")
        print("  iPhone: Settings > Contacts > Accounts > [old Exchange account]")
        print("          > Delete Account  (removes the cached old contacts)")
        print("  Mac:    System Settings > Internet Accounts > [old account] > "
              "remove, if present")
        print(f"\nYour backup is preserved at: {backup_csv}")
        return 0

    # --- script-delete path: show diff, confirm, delete ---
    print(f"\nWill DELETE {len(to_delete_ids)} old copies from Contacts.app "
          "(the pre-import originals only — imported copies are untouched):")
    for name in to_delete_names:
        print(f"  - {name}")

    if args.dry_run:
        print("\n[dry-run] No changes made.")
        return 0

    if not (args.yes or _confirm("\nProceed with deletion?", "delete")):
        print("Aborted; nothing deleted.")
        return 0

    try:
        removed = lib.delete_people_by_id(to_delete_ids)
    except lib.ContactsPermissionError:
        print(lib.PERMISSION_HELP, file=sys.stderr)
        return 3
    print(f"Deleted {removed} old contact(s). Backup preserved at {backup_csv}")
    return 0


# --------------------------------------------------------------------------
# guide (interactive wizard)
# --------------------------------------------------------------------------

STEP = "\n" + "=" * 64 + "\n"


def _pause(msg: str) -> None:
    try:
        input(msg)
    except EOFError:
        pass


def cmd_guide(args) -> int:
    print(STEP + "Contacts migration wizard" + STEP)
    print("This walks you through moving contacts from the OLD iCloud/Exchange\n"
          "account to the NEW iCloud account, with a verified backup.\n")

    # Step 1: export
    print(STEP + "Step 1/6  Export the OLD contacts")
    print("On your iPhone: open Contacts, select the old contacts (or the old\n"
          "account's group), Share/Export, and save/AirDrop a single .vcf file\n"
          "to this Mac. (Or in Contacts.app: select them > File > Export > vCard.)")
    old_path = input("\nPath to the exported old .vcf: ").strip()
    if not old_path or not Path(old_path).exists():
        print("File not found — re-run when ready.", file=sys.stderr)
        return 2
    n = len(lib.load_contacts(old_path))
    print(f"OK: parsed {n} contacts from {old_path}")

    # Step 2: backup
    print(STEP + "Step 2/6  Back up")
    cmd_backup(argparse.Namespace(input=old_path))

    # Step 3: snapshot
    print(STEP + "Step 3/6  Snapshot current Contacts.app state")
    print("This records what's already on this Mac so old copies can be safely\n"
          "removed later. It may ask for Automation permission.")
    rc = cmd_snapshot(argparse.Namespace(old=old_path))
    if rc == 3:
        print("Grant the permission above, then re-run `guide` (or `snapshot`).")
        return 3

    # Step 4: import
    print(STEP + "Step 4/6  Import into the NEW account")
    print("1) System Settings > Contacts > Default Account = your NEW iCloud.\n"
          "2) Contacts.app > File > Import… > choose your old .vcf > Import.\n"
          "3) Wait for it to sync to iCloud.")
    _pause("\nPress Enter once the import is done… ")

    # Step 5: verify
    print(STEP + "Step 5/6  Verify")
    print("Export the NEW iCloud account's contacts to a fresh .vcf:\n"
          "  Contacts.app > select the new account's contacts > "
          "File > Export > vCard.")
    new_path = input("\nPath to the NEW account export .vcf: ").strip()
    if not new_path or not Path(new_path).exists():
        print("File not found — run `verify` manually when ready.", file=sys.stderr)
        return 2
    rc = cmd_verify(argparse.Namespace(old=old_path, new=new_path, report=None))
    if rc != 0:
        print("\nVerification did not pass — fix the import, then re-run "
              "`verify` and `delete`. Nothing was deleted.")
        return rc

    # Step 6: delete
    print(STEP + "Step 6/6  Delete the old copies")
    if not _confirm("Verification passed. Delete the old copies now?", "yes"):
        print("Skipped. Run `delete` later when ready.")
        return 0
    return cmd_delete(argparse.Namespace(old=old_path, snapshot=None,
                                         report=None, dry_run=False, yes=False))


# --------------------------------------------------------------------------
# argparse
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("guide", help="interactive end-to-end wizard")
    g.set_defaults(func=cmd_guide)

    b = sub.add_parser("backup", help="write CSV + vcf backup of an export")
    b.add_argument("--input", required=True, help="old contacts .vcf")
    b.set_defaults(func=cmd_backup)

    s = sub.add_parser("snapshot", help="record current Contacts.app state")
    s.add_argument("--old", help="old .vcf to test presence on this Mac")
    s.set_defaults(func=cmd_snapshot)

    v = sub.add_parser("verify", help="diff old export vs new account export")
    v.add_argument("--old", required=True)
    v.add_argument("--new", required=True)
    v.add_argument("--report", help="output report path")
    v.set_defaults(func=cmd_verify)

    d = sub.add_parser("delete", help="delete old copies (gated on verify+backup)")
    d.add_argument("--old", required=True)
    d.add_argument("--snapshot", help="pre-import snapshot json")
    d.add_argument("--report", help="verify report to gate on")
    d.add_argument("--dry-run", action="store_true")
    d.add_argument("--yes", action="store_true", help="skip interactive confirm")
    d.set_defaults(func=cmd_delete)

    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
