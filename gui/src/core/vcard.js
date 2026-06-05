'use strict';
// Minimal, dependency-free vCard 3.0 parser (the format Contacts.app exports).
// Handles line folding, property parameters (TYPE), and value un-escaping for
// the fields we care about. Mirrors flatten() in contacts_lib.py.

function unfold(text) {
  // RFC 6350 line folding: a CRLF followed by space/tab continues the line.
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescape(value) {
  return String(value)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// Split on a delimiter that is not backslash-escaped.
function splitUnescaped(value, delim) {
  const out = [];
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\' && i + 1 < value.length) {
      cur += c + value[i + 1];
      i++;
    } else if (c === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const namePart = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = namePart.split(';');
  const name = segs[0].toUpperCase();
  const params = {};
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf('=');
    if (eq === -1) {
      (params.TYPE = params.TYPE || []).push(seg.toUpperCase());
    } else {
      const k = seg.slice(0, eq).toUpperCase();
      const v = seg.slice(eq + 1);
      (params[k] = params[k] || []).push(...v.split(',').map((s) => s.toUpperCase()));
    }
  }
  return { name, params, value };
}

function labelOf(params) {
  const types = (params.TYPE || []).filter(
    (t) => !['PREF', 'INTERNET', 'VOICE'].includes(t)
  );
  return types.length ? types.join(',').toLowerCase() : 'other';
}

function emptyContact(raw) {
  return {
    fullName: '', org: '', title: '',
    phones: [], emails: [], addresses: [],
    birthday: '', note: '', raw,
  };
}

function parseVcards(text) {
  const lines = unfold(text).split('\n');
  const contacts = [];
  let cur = null;
  let rawLines = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^BEGIN:VCARD$/i.test(line.trim())) {
      cur = emptyContact('');
      rawLines = [line];
      continue;
    }
    if (cur === null) continue;
    rawLines.push(line);
    if (/^END:VCARD$/i.test(line.trim())) {
      cur.raw = rawLines.join('\n');
      contacts.push(cur);
      cur = null;
      continue;
    }
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'FN':
        cur.fullName = unescape(p.value).trim();
        break;
      case 'N':
        if (!cur.fullName) {
          const parts = splitUnescaped(p.value, ';').map((s) => unescape(s).trim());
          // N = Family;Given;Additional;Prefix;Suffix
          cur.fullName = [parts[1], parts[0]].filter(Boolean).join(' ').trim();
        }
        break;
      case 'ORG':
        cur.org = splitUnescaped(p.value, ';').map((s) => unescape(s).trim())
          .filter(Boolean).join(' ');
        break;
      case 'TITLE':
        cur.title = unescape(p.value).trim();
        break;
      case 'TEL':
        cur.phones.push({ label: labelOf(p.params), value: unescape(p.value).trim() });
        break;
      case 'EMAIL':
        cur.emails.push({ label: labelOf(p.params), value: unescape(p.value).trim() });
        break;
      case 'ADR': {
        const a = splitUnescaped(p.value, ';').map((s) => unescape(s).trim());
        // ADR = POBox;Ext;Street;City;Region;Postal;Country
        const joined = [a[2], a[3], a[4], a[5], a[6]].filter(Boolean).join(', ');
        if (joined) cur.addresses.push(joined);
        break;
      }
      case 'BDAY':
        cur.birthday = unescape(p.value).trim();
        break;
      case 'NOTE':
        cur.note = unescape(p.value).trim();
        break;
      default:
        break;
    }
  }
  return contacts;
}

module.exports = { parseVcards };
