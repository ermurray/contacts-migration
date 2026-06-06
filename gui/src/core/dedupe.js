'use strict';
// Group likely-duplicate contacts and merge a group into one union contact.
// Uses the same matching rules as verify/delete (match.js) so "duplicate" means
// the same thing everywhere.
const { matches, normalizePhone, normalizeEmail } = require('./match');

// Union-find grouping over pairwise matches (transitive: A~B, B~C => {A,B,C}).
function groupDuplicates(contacts) {
  const n = contacts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (matches(contacts[i], contacts[j]).matched) union(i, j);
    }
  }
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(i);
  }
  const groups = [];
  const singles = [];
  for (const arr of buckets.values()) {
    if (arr.length > 1) groups.push(arr); else singles.push(arr[0]);
  }
  return { groups, singles };
}

// Merge a list of contacts into one: longest name wins; first non-empty
// org/title/birthday; notes concatenated; phones/emails/addresses unioned.
function mergeContacts(list) {
  const merged = {
    fullName: '', org: '', title: '',
    phones: [], emails: [], addresses: [], birthday: '', note: '',
  };
  const seenP = new Set(), seenE = new Set(), seenA = new Set();
  for (const c of list) {
    if ((c.fullName || '').length > merged.fullName.length) merged.fullName = c.fullName || merged.fullName;
    if (!merged.org && c.org) merged.org = c.org;
    if (!merged.title && c.title) merged.title = c.title;
    if (!merged.birthday && c.birthday) merged.birthday = c.birthday;
    if (c.note && !merged.note.includes(c.note)) merged.note = [merged.note, c.note].filter(Boolean).join(' / ');
    for (const p of c.phones || []) {
      const k = normalizePhone(p.value);
      if (!k) { merged.phones.push(p); continue; }
      if (!seenP.has(k)) { seenP.add(k); merged.phones.push(p); }
    }
    for (const e of c.emails || []) {
      const k = normalizeEmail(e.value);
      if (k && !seenE.has(k)) { seenE.add(k); merged.emails.push(e); }
    }
    for (const a of c.addresses || []) {
      if (!seenA.has(a)) { seenA.add(a); merged.addresses.push(a); }
    }
  }
  return merged;
}

module.exports = { groupDuplicates, mergeContacts };
