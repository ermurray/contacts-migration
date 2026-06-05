'use strict';
// Core-logic self-test (no Electron needed): node test/selftest.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseVcards } = require('../src/core/vcard');
const { writeBackup } = require('../src/core/backup');
const { verify } = require('../src/core/verify');
const { computeDeletable } = require('../src/core/deleteMac');

const SAMPLE = path.join(__dirname, '..', '..', 'sample');
const read = (f) => fs.readFileSync(path.join(SAMPLE, f), 'utf8');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  - ${name}`); }
  catch (e) { failures++; console.error(`  FAIL- ${name}: ${e.message}`); }
}

const oldC = parseVcards(read('sample_old.vcf'));
const fullC = parseVcards(read('sample_new_full.vcf'));
const missC = parseVcards(read('sample_new_missing.vcf'));

check('parse old.vcf -> 3 contacts', () => assert.strictEqual(oldC.length, 3));
check('parse fields (Ada)', () => {
  const ada = oldC.find((c) => c.fullName === 'Ada Lovelace');
  assert.ok(ada, 'Ada present');
  assert.strictEqual(ada.org, 'Analytical Engines');
  assert.strictEqual(ada.phones[0].value, '+1 (415) 555-0101');
  assert.strictEqual(ada.emails[0].value, 'ada@example.com');
});

check('verify full -> 3/3, passed', () => {
  const r = verify(oldC, fullC);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.counts.matched, 3);
  assert.strictEqual(r.counts.missing, 0);
  assert.strictEqual(r.passed, true);
});

check('verify missing -> 1 missing, NOT passed', () => {
  const r = verify(oldC, missC);
  assert.strictEqual(r.counts.missing, 1);
  assert.strictEqual(r.passed, false);
  const grace = r.rows.find((x) => x.fullName === 'Grace Hopper');
  assert.strictEqual(grace.status, 'missing');
});

check('backup writes CSV + vcf copy', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-'));
  const res = writeBackup(oldC, path.join(SAMPLE, 'sample_old.vcf'), tmp);
  assert.ok(fs.existsSync(res.csvPath));
  assert.ok(fs.existsSync(res.vcfPath));
  assert.strictEqual(res.count, 3);
  const csv = fs.readFileSync(res.csvPath, 'utf8');
  assert.ok(csv.includes('Ada Lovelace'));
  assert.ok(csv.split('\n')[0].startsWith('full_name,org,title'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

check('computeDeletable matches snapshot, excludes unrelated', () => {
  const snapshot = [
    { id: 'ID-ADA', name: 'Ada Lovelace', phones: ['+1 (415) 555-0101'], emails: ['ada@example.com'] },
    { id: 'ID-ALAN', name: 'Alan Turing', phones: ['415-555-0102'], emails: ['alan@example.com'] },
    { id: 'ID-GRACE', name: 'Grace Hopper', phones: ['+1-415-555-0103'], emails: [] },
    { id: 'ID-OTHER', name: 'Some Unrelated Person', phones: ['212-555-9999'], emails: [] },
  ];
  const del = computeDeletable(oldC, snapshot);
  assert.strictEqual(del.length, 3);
  assert.ok(!del.some((d) => d.name === 'Some Unrelated Person'));
});

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
