'use strict';
const { matches } = require('./match');
const { joinLabeled } = require('./backup');

// Diff old contacts against the new account export.
// Returns { rows, counts } where each row has { fullName, status, phones, emails }
// and status is 'matched' | 'low-confidence' | 'missing'.
function verify(oldContacts, newContacts) {
  const rows = [];
  const counts = { matched: 0, 'low-confidence': 0, missing: 0 };

  for (const o of oldContacts) {
    let status = 'missing';
    let low = false;
    for (const cand of newContacts) {
      const m = matches(o, cand);
      if (m.matched && !m.lowConfidence) { status = 'matched'; low = false; break; }
      if (m.matched && m.lowConfidence) { low = true; }
    }
    if (status !== 'matched' && low) status = 'low-confidence';
    counts[status] += 1;
    rows.push({
      fullName: o.fullName,
      status,
      phones: joinLabeled(o.phones),
      emails: joinLabeled(o.emails),
    });
  }

  const total = oldContacts.length;
  const verified = counts.matched + counts['low-confidence'];
  return { rows, counts, total, verified, passed: counts.missing === 0 };
}

function reportCsv(rows) {
  const head = 'full_name,status,phones,emails';
  const esc = (s) => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
  const body = rows.map((r) => [r.fullName, r.status, r.phones, r.emails].map(esc).join(','));
  return [head, ...body].join('\n') + '\n';
}

module.exports = { verify, reportCsv };
