"""Shared helpers for the contacts migration tool.

Pure helpers for parsing/normalizing vCards plus thin wrappers around
macOS `osascript` for reading and deleting entries in Contacts.app.

No state is kept here; everything is file- or argument-driven so the tool
stays portable (clone-and-run on any Mac).
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    import vobject
except ImportError:  # pragma: no cover - guidance path
    sys.stderr.write(
        "Missing dependency 'vobject'. Set up the venv first:\n"
        "  python3 -m venv .venv && . .venv/bin/activate && "
        "pip install -r requirements.txt\n"
    )
    raise


# --------------------------------------------------------------------------
# Normalizers (used for matching contacts across exports)
# --------------------------------------------------------------------------

def normalize_phone(value: str) -> str:
    """Reduce a phone number to comparable digits (last 10, US-friendly)."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).lower()


# --------------------------------------------------------------------------
# vCard parsing / flattening
# --------------------------------------------------------------------------

@dataclass
class Contact:
    full_name: str = ""
    org: str = ""
    title: str = ""
    phones: list[tuple[str, str]] = field(default_factory=list)  # (label, value)
    emails: list[tuple[str, str]] = field(default_factory=list)
    addresses: list[str] = field(default_factory=list)
    birthday: str = ""
    note: str = ""
    raw: str = ""  # original serialized vCard

    # --- comparison helpers ---
    @property
    def name_key(self) -> str:
        return normalize_name(self.full_name)

    @property
    def phone_keys(self) -> set[str]:
        return {normalize_phone(v) for _, v in self.phones if normalize_phone(v)}

    @property
    def email_keys(self) -> set[str]:
        return {normalize_email(v) for _, v in self.emails if normalize_email(v)}

    def matches(self, other: "Contact") -> tuple[bool, bool]:
        """Return (matched, low_confidence).

        A confident match needs the same name AND a shared phone or email.
        A name-only match (when one side has no phone/email) is allowed but
        flagged low-confidence so the operator can eyeball it.
        """
        if self.name_key != other.name_key:
            return (False, False)
        shared = bool(
            (self.phone_keys & other.phone_keys)
            or (self.email_keys & other.email_keys)
        )
        if shared:
            return (True, False)
        # name matches; if either side lacks contact points, allow but flag
        if not (self.phone_keys or self.email_keys) or not (
            other.phone_keys or other.email_keys
        ):
            return (True, True)
        return (False, False)


def _label_of(child) -> str:
    """Best-effort human label for a TEL/EMAIL/ADR line."""
    types = child.params.get("TYPE", []) if hasattr(child, "params") else []
    types = [t for t in types if t.lower() not in ("pref", "internet", "voice")]
    return ",".join(types).lower() if types else "other"


def flatten(card) -> Contact:
    """Convert a vobject vCard component into a Contact."""
    c = Contact(raw=card.serialize())

    if hasattr(card, "fn"):
        c.full_name = (card.fn.value or "").strip()
    elif hasattr(card, "n"):
        c.full_name = str(card.n.value).strip()

    if hasattr(card, "org"):
        org = card.org.value
        c.org = " ".join(org) if isinstance(org, list) else str(org)
    if hasattr(card, "title"):
        c.title = str(card.title.value)
    if hasattr(card, "bday"):
        c.birthday = str(card.bday.value)
    if hasattr(card, "note"):
        c.note = str(card.note.value)

    for tel in card.contents.get("tel", []):
        c.phones.append((_label_of(tel), str(tel.value)))
    for email in card.contents.get("email", []):
        c.emails.append((_label_of(email), str(email.value)))
    for adr in card.contents.get("adr", []):
        parts = [p for p in (adr.value.street, adr.value.city, adr.value.region,
                             adr.value.code, adr.value.country) if p]
        if parts:
            c.addresses.append(", ".join(parts))

    return c


def load_contacts(path: str | Path) -> list[Contact]:
    """Parse a .vcf file (possibly many cards) into Contact objects."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    contacts: list[Contact] = []
    for card in vobject.readComponents(text):
        if card.name.upper() == "VCARD":
            contacts.append(flatten(card))
    return contacts


def join_labeled(pairs: Iterable[tuple[str, str]]) -> str:
    return "; ".join(f"{label}:{value}" for label, value in pairs)


# --------------------------------------------------------------------------
# macOS Contacts.app via osascript
# --------------------------------------------------------------------------

class ContactsPermissionError(RuntimeError):
    """Raised when Contacts automation is blocked by TCC (error -1743)."""


def _run_osascript(script: str) -> str:
    proc = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        err = proc.stderr.strip()
        if "-1743" in err or "Not authorized" in err:
            raise ContactsPermissionError(err)
        raise RuntimeError(f"osascript failed: {err}")
    return proc.stdout.strip()


# Unit/record separators keep us safe from names containing commas/newlines.
_RS = "\x1e"  # between records
_US = "\x1f"  # between fields


def list_people() -> list[dict]:
    """Return every person currently in Contacts.app.

    Each dict: {id, name, phones: [str], emails: [str]}.
    Raises ContactsPermissionError if automation is not authorized.
    """
    script = f'''
    set out to ""
    tell application "Contacts"
        repeat with p in people
            set pid to id of p
            set pname to (name of p)
            if pname is missing value then set pname to ""
            set phs to ""
            repeat with ph in phones of p
                set phs to phs & (value of ph) & "{_US}"
            end repeat
            set ems to ""
            repeat with em in emails of p
                set ems to ems & (value of em) & "{_US}"
            end repeat
            set out to out & pid & "{_US}" & pname & "{_US}" & phs & "{_US}" & ems & "{_RS}"
        end repeat
    end tell
    return out
    '''
    raw = _run_osascript(script)
    people = []
    for rec in raw.split(_RS):
        if not rec.strip():
            continue
        fields = rec.split(_US)
        # layout: id, name, <phones...>, <us>, <emails...>, <trailing us>
        pid = fields[0] if len(fields) > 0 else ""
        name = fields[1] if len(fields) > 1 else ""
        # phones and emails are the remaining US-separated chunks; rebuild
        rest = fields[2:]
        # rest is [phone, phone, ..., '', email, email, ..., ''] — split on first empty
        phones, emails, seen_gap = [], [], False
        for chunk in rest:
            if chunk == "" and not seen_gap:
                seen_gap = True
                continue
            if not chunk:
                continue
            (emails if seen_gap else phones).append(chunk)
        people.append({"id": pid, "name": name, "phones": phones, "emails": emails})
    return people


def delete_people_by_id(ids: list[str]) -> int:
    """Delete the Contacts.app people whose `id` is in `ids`. Returns count."""
    if not ids:
        return 0
    # Build an AppleScript list literal of quoted ids.
    quoted = ", ".join('"' + i.replace('"', '\\"') + '"' for i in ids)
    script = f'''
    set targetIds to {{{quoted}}}
    set removed to 0
    tell application "Contacts"
        repeat with tid in targetIds
            try
                set matches to (every person whose id is (tid as text))
                repeat with m in matches
                    delete m
                    set removed to removed + 1
                end repeat
            end try
        end repeat
        save
    end tell
    return removed
    '''
    return int(_run_osascript(script) or "0")


PERMISSION_HELP = (
    "Contacts automation is blocked (error -1743).\n"
    "Grant access on this Mac, then retry:\n"
    "  System Settings > Privacy & Security > Automation >\n"
    "    [your Terminal] > enable 'Contacts'\n"
    "  (and/or System Settings > Privacy & Security > Contacts)\n"
)
