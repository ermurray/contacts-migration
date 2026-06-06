'use strict';
const fs = require('fs');
const path = require('path');

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function joinLabeled(pairs) {
  return (pairs || []).map((p) => `${p.label}:${p.value}`).join('; ');
}

const FIELDS = ['full_name', 'org', 'title', 'phones', 'emails',
  'addresses', 'birthday', 'note'];

function toCsv(contacts) {
  const rows = [FIELDS.join(',')];
  for (const c of contacts) {
    rows.push([
      c.fullName, c.org, c.title,
      joinLabeled(c.phones), joinLabeled(c.emails),
      (c.addresses || []).join(' | '),
      c.birthday, String(c.note || '').replace(/\n/g, ' '),
    ].map(csvCell).join(','));
  }
  return rows.join('\n') + '\n';
}

// Writes a human-readable CSV + a lossless copy of the source vcf into outDir.
function writeBackup(contacts, srcPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ts = timestamp();
  const csvPath = path.join(outDir, `contacts_backup_${ts}.csv`);
  const vcfPath = path.join(outDir, `old_contacts_${ts}.vcf`);
  fs.writeFileSync(csvPath, toCsv(contacts), 'utf8');
  fs.copyFileSync(srcPath, vcfPath);
  return { csvPath, vcfPath, count: contacts.length };
}

// Back up a combined set of contacts (from one or more files): CSV + a single
// concatenated .vcf of every contact.
function writeBackupCombined(contacts, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ts = timestamp();
  const csvPath = path.join(outDir, `contacts_backup_${ts}.csv`);
  const vcfPath = path.join(outDir, `all_contacts_${ts}.vcf`);
  fs.writeFileSync(csvPath, toCsv(contacts), 'utf8');
  fs.writeFileSync(vcfPath, contacts.map((c) => String(c.raw).trim()).join('\r\n') + '\n', 'utf8');
  return { csvPath, vcfPath, count: contacts.length };
}

module.exports = { writeBackup, writeBackupCombined, toCsv, joinLabeled, timestamp, csvCell };
