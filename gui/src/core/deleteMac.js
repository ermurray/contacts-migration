'use strict';
// macOS-only bridge to Contacts.app via osascript. On other platforms these
// throw UnsupportedPlatform and the UI shows guided manual steps instead.
const { execFile } = require('child_process');
const { matches } = require('./match');

const RS = '\x1e'; // record separator
const US = '\x1f'; // unit separator

class UnsupportedPlatform extends Error {}
class PermissionError extends Error {}

function isMac() {
  return process.platform === 'darwin';
}

function runOsascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message);
          if (msg.includes('-1743') || /Not authorized/i.test(msg)) {
            return reject(new PermissionError(msg));
          }
          return reject(new Error(`osascript failed: ${msg.trim()}`));
        }
        resolve(String(stdout).trim());
      });
  });
}

async function listPeople() {
  if (!isMac()) throw new UnsupportedPlatform('listPeople is macOS-only');
  const script = `
    set out to ""
    tell application "Contacts"
      repeat with p in people
        set pid to id of p
        set pname to (name of p)
        if pname is missing value then set pname to ""
        set phs to ""
        repeat with ph in phones of p
          set phs to phs & (value of ph) & "${US}"
        end repeat
        set ems to ""
        repeat with em in emails of p
          set ems to ems & (value of em) & "${US}"
        end repeat
        set out to out & pid & "${US}" & pname & "${US}" & phs & "${US}" & ems & "${RS}"
      end repeat
    end tell
    return out`;
  const raw = await runOsascript(script);
  const people = [];
  for (const rec of raw.split(RS)) {
    if (!rec.trim()) continue;
    const fields = rec.split(US);
    const id = fields[0] || '';
    const name = fields[1] || '';
    const rest = fields.slice(2);
    const phones = [], emails = [];
    let gap = false;
    for (const chunk of rest) {
      if (chunk === '' && !gap) { gap = true; continue; }
      if (!chunk) continue;
      (gap ? emails : phones).push(chunk);
    }
    people.push({ id, name, phones, emails });
  }
  return people;
}

function personToContact(p) {
  return {
    fullName: p.name || '',
    phones: (p.phones || []).map((v) => ({ label: 'phone', value: v })),
    emails: (p.emails || []).map((v) => ({ label: 'email', value: v })),
  };
}

// Old copies present in Contacts.app = snapshot people that match an old contact.
function computeDeletable(oldContacts, snapshot) {
  const result = [];
  for (const o of oldContacts) {
    for (const p of snapshot) {
      if (matches(o, personToContact(p)).matched) {
        result.push({ id: p.id, name: p.name || o.fullName });
        break;
      }
    }
  }
  return result;
}

async function deletePeopleById(ids) {
  if (!isMac()) throw new UnsupportedPlatform('deletePeopleById is macOS-only');
  if (!ids.length) return 0;
  const quoted = ids.map((i) => '"' + String(i).replace(/"/g, '\\"') + '"').join(', ');
  const script = `
    set targetIds to {${quoted}}
    set removed to 0
    tell application "Contacts"
      repeat with tid in targetIds
        try
          set matchesList to (every person whose id is (tid as text))
          repeat with m in matchesList
            delete m
            set removed to removed + 1
          end repeat
        end try
      end repeat
      save
    end tell
    return removed`;
  return parseInt((await runOsascript(script)) || '0', 10);
}

const PERMISSION_HELP =
  'Contacts automation is blocked (error -1743).\n' +
  'Grant access, then retry:\n' +
  '  System Settings > Privacy & Security > Automation > [this app] > enable "Contacts"\n' +
  '  (and/or System Settings > Privacy & Security > Contacts)';

const MANUAL_STEPS =
  'This OS has no scriptable system contacts. The migration is verified and ' +
  'backed up — remove the old copies manually:\n' +
  '  iPhone: Settings > Contacts > Accounts > [old account] > Delete Account\n' +
  '  (removes the cached old contacts at once)';

module.exports = {
  isMac, listPeople, deletePeopleById, computeDeletable,
  UnsupportedPlatform, PermissionError, PERMISSION_HELP, MANUAL_STEPS,
};
