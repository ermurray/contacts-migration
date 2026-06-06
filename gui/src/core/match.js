'use strict';
// Normalizers + contact matching. Mirrors contacts_lib.py so the GUI and the
// Python CLI agree on what "the same contact" means.

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function phoneKeys(contact) {
  const set = new Set();
  for (const p of contact.phones || []) {
    const k = normalizePhone(p.value);
    if (k) set.add(k);
  }
  return set;
}

function emailKeys(contact) {
  const set = new Set();
  for (const e of contact.emails || []) {
    const k = normalizeEmail(e.value);
    if (k) set.add(k);
  }
  return set;
}

function intersects(a, b) {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

// Returns { matched: bool, lowConfidence: bool }.
// ----- secondary attributes (used mainly when a name is missing) -----
function orgKey(c) { return normalizeName(c.org || ''); }
function noteKey(c) { return normalizeName(c.note || ''); }
function addrKeys(c) {
  const set = new Set();
  for (const a of c.addresses || []) {
    const k = normalizeName(a);
    if (k) set.add(k);
  }
  return set;
}

const M = (matched, lowConfidence) => ({ matched, lowConfidence });

// Decide whether two contacts are the same person.
//
// Order of evidence:
//   1. A shared phone/email is the strongest signal. Confident when the names
//      are compatible (equal, or at least one is blank).
//   2. Same explicit name -> match (confident if org/address also agree, else a
//      flagged name-only match).
//   3. Different explicit names -> only a shared *phone* links them (flagged).
//   4. At least one contact has NO name -> compare secondary data (org, address,
//      note); two agreeing attributes make a flagged match. This lets nameless
//      contacts be told apart / merged by company, address, email, or notes
//      instead of all collapsing together on an empty name.
function matches(a, b) {
  const an = normalizeName(a.fullName);
  const bn = normalizeName(b.fullName);
  const sharedPhone = intersects(phoneKeys(a), phoneKeys(b));
  const sharedEmail = intersects(emailKeys(a), emailKeys(b));

  const bothNamed = !!(an && bn);
  const sameName = bothNamed && an === bn;
  const someNameMissing = !an || !bn;

  // 1) Strong identifier with compatible names.
  if ((sharedPhone || sharedEmail) && (sameName || someNameMissing)) return M(true, false);

  // 2) Same explicit name.
  if (sameName) {
    const sharedOrg = orgKey(a) !== '' && orgKey(a) === orgKey(b);
    const sharedAddr = intersects(addrKeys(a), addrKeys(b));
    if (sharedOrg || sharedAddr) return M(true, false);
    return M(true, true); // name-only
  }

  // 3) Both named but different names.
  if (bothNamed) return sharedPhone ? M(true, true) : M(false, false);

  // 4) At least one has no name — compare secondary attributes.
  const sharedOrg = orgKey(a) !== '' && orgKey(a) === orgKey(b);
  const sharedAddr = intersects(addrKeys(a), addrKeys(b));
  const sharedNote = noteKey(a) !== '' && noteKey(a) === noteKey(b);
  const secondary = (sharedOrg ? 1 : 0) + (sharedAddr ? 1 : 0) + (sharedNote ? 1 : 0);
  if (secondary >= 2) return M(true, true);
  return M(false, false);
}

module.exports = {
  normalizePhone, normalizeEmail, normalizeName,
  phoneKeys, emailKeys, orgKey, addrKeys, noteKey, matches,
};
