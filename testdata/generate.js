'use strict';
// Generates FAKE contact data for testing the GUI / CLI end-to-end.
// All names/numbers/emails are invented; phone numbers use the 555-01xx range
// reserved for fiction. Run: node testdata/generate.js
const fs = require('fs');
const path = require('path');

const OUT = __dirname;

// label, full name, org, title, phone, email, city, note
const PEOPLE = [
  ['Maria Hernandez', 'Northwind Traders', 'Account Manager', '+1 (415) 555-0110', 'maria.hernandez@example.com', 'San Francisco', 'Met at 2019 conference'],
  ['James Okafor', 'Contoso Ltd', 'Engineer', '+1 (415) 555-0111', 'james.okafor@example.com', 'Oakland', ''],
  ['Priya Nair', '', '', '+1 (628) 555-0112', 'priya.nair@example.com', 'Berkeley', 'Yoga class'],
  ['Liam O\'Brien', 'Fabrikam Inc', 'Designer', '+1 (415) 555-0113', 'liam.obrien@example.com', '', ''],
  ['Sofia Rossi', 'Tailspin Toys', 'Owner', '+1 (510) 555-0114', 'sofia@example.com', 'San Jose', 'Supplier; net-30 terms'],
  ['Chen Wei', '', '', '+1 (415) 555-0115', 'chen.wei@example.com', '', ''],
  ['Amara Diallo', 'Adventure Works', 'VP Sales', '+1 (650) 555-0116', 'amara.diallo@example.com', 'Palo Alto', ''],
  ['Noah Schmidt', '', 'Plumber', '+1 (415) 555-0117', '', 'Daly City', 'Recommended by Sofia'],
  ['Yuki Tanaka', 'Wingtip Toys', 'Buyer', '+1 (415) 555-0118', 'yuki.tanaka@example.com', '', ''],
  ['Grace Mbeki', '', '', '+1 (415) 555-0119', 'grace.mbeki@example.com', 'Richmond', 'Dentist'],
  ['Oliver Novak', 'Proseware', 'CTO', '+1 (415) 555-0120', 'oliver.novak@example.com', 'San Francisco', ''],
  ['Fatima Al-Sayed', '', '', '+1 (415) 555-0121', 'fatima.alsayed@example.com', 'Fremont', 'Book club'],
];

// Extra contacts that already exist in the NEW account (should be ignored by verify).
const EXTRAS = [
  ['Existing Person One', '', '', '+1 (212) 555-0190', 'existing1@example.com', 'New York', ''],
  ['Existing Person Two', '', '', '+1 (212) 555-0191', 'existing2@example.com', 'Boston', ''],
];

function esc(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function vcard(p) {
  const [name, org, title, phone, email, city, note] = p;
  const parts = name.split(' ');
  const given = parts[0];
  const family = parts.slice(1).join(' ');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(family)};${esc(given)};;;`, `FN:${esc(name)}`];
  if (org) lines.push(`ORG:${esc(org)}`);
  if (title) lines.push(`TITLE:${esc(title)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${esc(phone)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${esc(email)}`);
  if (city) lines.push(`ADR;TYPE=HOME:;;;${esc(city)};CA;;USA`);
  if (note) lines.push(`NOTE:${esc(note)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

function writeVcf(file, people) {
  const body = people.map(vcard).join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(OUT, file), body, 'utf8');
  return people.length;
}

// A second "list" with overlap (duplicates of Maria + James, slightly different
// data) plus two new people — for testing combine + dedupe.
const LIST2 = [
  ['Maria Hernandez', 'Northwind Traders', 'Senior Account Manager', '+1 (415) 555-0110', 'maria.h@work.example.com', 'San Francisco', 'dup of list 1'],
  ['James Okafor', '', '', '+1 (415) 555-0111', 'james.okafor@example.com', '', ''],
  ['Helena Vogt', 'Litware', 'Analyst', '+1 (415) 555-0130', 'helena.vogt@example.com', 'San Mateo', ''],
  ['Diego Castro', '', '', '+1 (415) 555-0131', 'diego.castro@example.com', '', ''],
];

const nOld = writeVcf('old_contacts.vcf', PEOPLE);
const nL2 = writeVcf('old_list2.vcf', LIST2);
console.log(`old_list2.vcf            : ${nL2} contacts (2 dup Maria/James + 2 new)`);
// Full new-account export: all old contacts migrated + pre-existing extras.
const nFull = writeVcf('new_export_full.vcf', [...PEOPLE, ...EXTRAS]);
// Incomplete export: one old contact failed to migrate (drop Chen Wei, index 5).
const missing = PEOPLE.filter((_, i) => i !== 5);
const nMiss = writeVcf('new_export_missing.vcf', [...missing, ...EXTRAS]);

console.log(`old_contacts.vcf        : ${nOld} contacts`);
console.log(`new_export_full.vcf     : ${nFull} contacts (all migrated + 2 extras)`);
console.log(`new_export_missing.vcf  : ${nMiss} contacts (Chen Wei missing)`);
console.log(`\nGenerated in ${OUT}`);
