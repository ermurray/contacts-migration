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
// Confident match = same name AND a shared phone or email.
// Name-only match allowed (when one side lacks phone/email) but flagged.
function matches(a, b) {
  if (normalizeName(a.fullName) !== normalizeName(b.fullName)) {
    return { matched: false, lowConfidence: false };
  }
  const ap = phoneKeys(a), ae = emailKeys(a);
  const bp = phoneKeys(b), be = emailKeys(b);
  if (intersects(ap, bp) || intersects(ae, be)) {
    return { matched: true, lowConfidence: false };
  }
  const aHas = ap.size || ae.size;
  const bHas = bp.size || be.size;
  if (!aHas || !bHas) return { matched: true, lowConfidence: true };
  return { matched: false, lowConfidence: false };
}

module.exports = {
  normalizePhone, normalizeEmail, normalizeName,
  phoneKeys, emailKeys, matches,
};
