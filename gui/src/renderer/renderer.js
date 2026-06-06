'use strict';
/* global window, document */

const state = {
  files: [],          // added .vcf paths
  records: [],        // combined contacts {uid, fullName, org, emails, phones, raw}
  recordByUid: new Map(),
  groups: [],         // duplicate groups (rich members) from main
  gstate: {},         // groupId -> { decision, included:Set(uid), merged }
  ignored: new Set(), // itemIds the user ignored (soft-deleted)
  selected: new Set(),// itemIds selected to migrate
  items: [],          // resolved selectable items (merged + singles)
  importPath: null,   // curated import file
  newPath: null,
  snapPath: null,
  hasBackup: false,
  imported: false,
  verifyPassed: false,
  deleted: false,
  isMac: false,
};

let activeOut = null;
const $ = (id) => document.getElementById(id);

// ---- stepper navigation ----
const PHASES = ['phase-prepare', 'phase-select', 'phase-migrate', 'phase-finish'];
const PHASE_TITLES = ['Prepare', 'Select', 'Migrate', 'Finish'];
let phaseIndex = 0;

function showPhase(i) {
  phaseIndex = Math.max(0, Math.min(PHASES.length - 1, i));
  PHASES.forEach((id, idx) => $(id).classList.toggle('hidden', idx !== phaseIndex));
  document.querySelectorAll('.phase-link').forEach((el, idx) =>
    el.classList.toggle('active', idx === phaseIndex));
  $('backBtn').disabled = phaseIndex === 0;
  $('nextBtn').classList.toggle('hidden', phaseIndex === PHASES.length - 1);
  $('navProgress').textContent =
    `Step ${phaseIndex + 1} of ${PHASES.length} · ${PHASE_TITLES[phaseIndex]}`;
  $('content').scrollTop = 0;
}

function updateProgress() {
  const done = {
    source: state.files.length > 0,
    import: !!state.importPath,
    backup: state.hasBackup,
    snapshot: !!state.snapPath,
    imported: state.imported,
    verify: state.verifyPassed,
    delete: state.deleted,
  };
  document.querySelectorAll('.tick').forEach((t) =>
    t.classList.toggle('done', !!done[t.dataset.when]));
  const phaseDone = [
    state.files.length > 0,
    !!state.importPath,
    state.hasBackup && state.verifyPassed,
    state.deleted,
  ];
  document.querySelectorAll('.phase-link').forEach((el, i) =>
    el.classList.toggle('done', phaseDone[i]));
}

// ---- bottom terminal ----
function log(msg) {
  const el = $('log');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

// ---- per-step panel helpers ----
function head(out, stateName, msg) {
  out.classList.remove('hidden', 'ok', 'bad', 'warn', 'running');
  out.classList.add(stateName);
  out.querySelector('.st-msg').textContent = msg;
  if (stateName !== 'running') hideProgress(out);
}
function setProgress(out, pct, msg) {
  let p = out.querySelector('.st-progress');
  if (!p) {
    p = document.createElement('div');
    p.className = 'st-progress';
    p.innerHTML = '<div class="bar"></div>';
    out.querySelector('.st-head').after(p);
  }
  p.classList.remove('hidden');
  p.querySelector('.bar').style.width = Math.round(Math.min(1, Math.max(0, pct)) * 100) + '%';
  if (msg) out.querySelector('.st-msg').textContent = msg;
}
function hideProgress(out) {
  const p = out.querySelector('.st-progress');
  if (p) { p.classList.add('hidden'); p.querySelector('.bar').style.width = '0%'; }
}
function addLine(out, msg) {
  const lines = out.querySelector('.st-lines');
  const div = document.createElement('div');
  div.className = 'ln';
  div.textContent = msg;
  lines.appendChild(div);
  lines.scrollTop = lines.scrollHeight;
}
function clearLines(out) { out.querySelector('.st-lines').textContent = ''; }
function clearActions(out) { out.querySelector('.st-actions').textContent = ''; }
function addAction(out, label, onClick) {
  const b = document.createElement('button');
  b.className = 'secondary tiny';
  b.textContent = label;
  b.onclick = onClick;
  out.querySelector('.st-actions').appendChild(b);
  return b;
}

async function run(btnId, outId, fn) {
  const btn = $(btnId);
  const out = $(outId);
  btn.classList.add('busy');
  btn.disabled = true;
  clearLines(out);
  clearActions(out);
  hideProgress(out);
  head(out, 'running', 'Working…');
  activeOut = out;
  const ctx = {
    line: (m) => { addLine(out, m); log(m); },
    done: (s, m) => head(out, s, m),
    button: (label, onClick) => addAction(out, label, onClick),
  };
  try {
    await fn(ctx);
  } catch (err) {
    head(out, 'bad', `Failed: ${err.message || err}`);
    log(`ERROR: ${err.message || err}`);
  } finally {
    btn.classList.remove('busy');
    activeOut = null;
    refresh();
  }
}

function refresh() {
  // Always-available actions (re-enabled after a run() disables them, even if
  // the file dialog was cancelled).
  $('addFile').disabled = false;
  $('pickNew').disabled = false;
  $('confirmImport').disabled = !state.importPath;
  // Gated actions.
  $('useSelection').disabled = !(state.items.length && state.selected.size > 0);
  $('backup').disabled = !state.files.length;
  $('snapshot').disabled = !(state.isMac && state.importPath);
  $('verify').disabled = !(state.importPath && state.newPath && state.imported);
  $('delete').disabled = !(state.hasBackup && state.verifyPassed);
  updateProgress();
}

// ---- combine / dedupe / select data model ----
function invalidateDownstream() {
  // changing the merge plan/selection invalidates the prepared import + verify
  state.importPath = null; state.imported = false; state.verifyPassed = false;
}

// Local union-merge mirroring core/dedupe.mergeContacts (renderer can't require it).
function mergeLocal(members) {
  const m = { fullName: '', org: '', title: '', phones: [], emails: [], addresses: [], birthday: '', note: '' };
  const sp = new Set(), se = new Set(), sa = new Set();
  for (const c of members) {
    if ((c.fullName || '').length > m.fullName.length) m.fullName = c.fullName || m.fullName;
    if (!m.org && c.org) m.org = c.org;
    if (!m.title && c.title) m.title = c.title;
    if (!m.birthday && c.birthday) m.birthday = c.birthday;
    if (c.note && !m.note.includes(c.note)) m.note = [m.note, c.note].filter(Boolean).join(' / ');
    for (const p of c.phones || []) {
      const k = (p.value || '').replace(/\D/g, '').slice(-10);
      if (!k) { m.phones.push({ label: p.label || 'other', value: p.value }); continue; }
      if (!sp.has(k)) { sp.add(k); m.phones.push({ label: p.label || 'other', value: p.value }); }
    }
    for (const e of c.emails || []) {
      const k = (e.value || '').trim().toLowerCase();
      if (k && !se.has(k)) { se.add(k); m.emails.push({ label: e.label || 'other', value: e.value }); }
    }
    for (const a of c.addresses || []) { if (!sa.has(a)) { sa.add(a); m.addresses.push(a); } }
  }
  return m;
}

function computeItems() {
  const absorbed = new Set();
  const items = [];
  for (const g of state.groups) {
    const gs = state.gstate[g.id];
    if (gs.decision !== 'merge') continue;
    const incl = g.members.filter((m) => gs.included.has(m.uid));
    if (incl.length < 2) continue; // not enough to merge -> members stay singles
    incl.forEach((m) => absorbed.add(m.uid));
    const md = gs.merged;
    items.push({
      itemId: 'm' + g.id, kind: 'merged', mergedCount: incl.length, contact: md,
      display: { fullName: md.fullName, org: md.org, emails: (md.emails || []).map((e) => e.value), phones: (md.phones || []).map((p) => p.value) },
    });
  }
  for (const r of state.records) {
    if (absorbed.has(r.uid)) continue;
    items.push({
      itemId: r.uid, kind: 'single', raw: r.raw,
      display: { fullName: r.fullName, org: r.org, emails: r.emails, phones: r.phones },
    });
  }
  return items;
}

function rebuildSelection() {
  state.items = computeItems();
  state.selected = new Set(state.items.filter((it) => !state.ignored.has(it.itemId)).map((it) => it.itemId));
  renderSelectionList();
}

async function reloadData() {
  invalidateDownstream();
  if (!state.files.length) {
    state.records = []; state.recordByUid = new Map();
    state.groups = []; state.gstate = {}; state.items = [];
    state.selected.clear();
    renderFileList(); renderDupes(); renderSelectionList(); refresh();
    return;
  }
  const lf = await window.api.loadFiles(state.files);
  state.records = lf.records;
  state.recordByUid = new Map(lf.records.map((r) => [r.uid, r]));
  const fd = await window.api.findDuplicates(state.files);
  state.groups = fd.groups;
  state.gstate = {};
  for (const g of state.groups) {
    state.gstate[g.id] = {
      decision: 'merge',
      included: new Set(g.members.map((m) => m.uid)),
      merged: mergeLocal(g.members),
    };
  }
  renderFileList(); renderDupes(); rebuildSelection(); refresh();
}

function renderFileList() {
  const el = $('fileList');
  $('fileCount').textContent = state.files.length
    ? `${state.files.length} file(s) · ${state.records.length} contacts`
    : 'No files added yet.';
  el.innerHTML = '';
  state.files.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    const name = document.createElement('span');
    name.className = 'fr-name';
    name.textContent = p;
    const rm = document.createElement('button');
    rm.className = 'tiny secondary';
    rm.textContent = 'Remove';
    rm.onclick = async () => { state.files.splice(i, 1); await reloadData(); };
    row.appendChild(name); row.appendChild(rm);
    el.appendChild(row);
  });
}

function memberDetailsHtml(m) {
  const rows = [];
  if (m.org) rows.push(`Company: ${escapeHtml(m.org)}`);
  if (m.title) rows.push(`Title: ${escapeHtml(m.title)}`);
  for (const p of m.phones || []) rows.push(`Phone (${escapeHtml(p.label || '')}): ${escapeHtml(p.value)}`);
  for (const e of m.emails || []) rows.push(`Email (${escapeHtml(e.label || '')}): ${escapeHtml(e.value)}`);
  for (const a of m.addresses || []) rows.push(`Address: ${escapeHtml(a)}`);
  if (m.birthday) rows.push(`Birthday: ${escapeHtml(m.birthday)}`);
  if (m.note) rows.push(`Note: ${escapeHtml(m.note)}`);
  return rows.length ? rows.map((r) => `<div>${r}</div>`).join('') : '<div class="muted">(no other details)</div>';
}

// Editable form bound to gs.merged. Edits update in place; selection refreshes
// without re-rendering the form (so the input keeps focus).
function buildMergeEditor(g, gs) {
  const wrap = document.createElement('div');
  wrap.className = 'merge-edit';
  const t = document.createElement('div');
  t.className = 'me-title';
  t.textContent = 'Merged result (editable)';
  wrap.appendChild(t);

  const m = gs.merged;
  const field = (label, value, multi) => {
    const row = document.createElement('label');
    row.className = 'me-field';
    const span = document.createElement('span');
    span.textContent = label;
    const inp = multi ? document.createElement('textarea') : document.createElement('input');
    if (multi) inp.rows = Math.max(1, String(value).split('\n').filter(Boolean).length);
    inp.value = value;
    row.appendChild(span); row.appendChild(inp);
    wrap.appendChild(row);
    return inp;
  };
  const iName = field('Name', m.fullName || '');
  const iOrg = field('Company', m.org || '');
  const iTitle = field('Title', m.title || '');
  const iPhones = field('Phones (one per line)', (m.phones || []).map((p) => p.value).join('\n'), true);
  const iEmails = field('Emails (one per line)', (m.emails || []).map((e) => e.value).join('\n'), true);
  const iAddr = field('Addresses (one per line)', (m.addresses || []).join('\n'), true);
  const iNote = field('Note', m.note || '', true);

  const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
  const commit = () => {
    m.fullName = iName.value.trim();
    m.org = iOrg.value.trim();
    m.title = iTitle.value.trim();
    m.phones = lines(iPhones.value).map((v) => ({ label: 'other', value: v }));
    m.emails = lines(iEmails.value).map((v) => ({ label: 'other', value: v }));
    m.addresses = lines(iAddr.value);
    m.note = iNote.value.trim();
    invalidateDownstream();
    state.items = computeItems();
    renderSelectionList();
    refresh();
  };
  [iName, iOrg, iTitle, iPhones, iEmails, iAddr, iNote].forEach((el) => { el.oninput = commit; });
  return wrap;
}

function renderDupes() {
  const el = $('dupList');
  el.innerHTML = '';
  const n = state.groups.length;
  $('dupSummary').textContent = !state.files.length
    ? 'Add files to scan for duplicates.'
    : n ? `${n} possible duplicate group(s). Confirm each: merge (tweak members/fields) or keep separate.`
      : 'No duplicates found — nothing to merge.';

  for (const g of state.groups) {
    const gs = state.gstate[g.id];
    const block = document.createElement('div');
    block.className = 'dup-group';

    const title = document.createElement('div');
    title.className = 'dup-title';
    title.textContent = `Possible duplicate · ${g.members.length} contacts`;
    block.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'dup-actions';
    [['merge', 'Merge into one'], ['separate', 'Keep separate']].forEach(([val, label]) => {
      const lab = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio'; r.name = `dup-${g.id}`; r.value = val; r.checked = gs.decision === val;
      r.onchange = () => { gs.decision = val; invalidateDownstream(); renderDupes(); rebuildSelection(); refresh(); };
      lab.appendChild(r); lab.appendChild(document.createTextNode(' ' + label));
      actions.appendChild(lab);
    });
    block.appendChild(actions);

    if (gs.decision === 'merge') {
      const mlist = document.createElement('div');
      mlist.className = 'dup-members2';
      for (const m of g.members) {
        const row = document.createElement('div');
        row.className = 'dup-member';
        const headr = document.createElement('div');
        headr.className = 'dm-head';

        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = gs.included.has(m.uid); cb.title = 'Include in merge';
        cb.onchange = () => {
          if (cb.checked) gs.included.add(m.uid); else gs.included.delete(m.uid);
          gs.merged = mergeLocal(g.members.filter((x) => gs.included.has(x.uid)));
          invalidateDownstream(); renderDupes(); rebuildSelection(); refresh();
        };
        const nm = document.createElement('span');
        nm.className = 'dm-name';
        const summary = [m.org, ...(m.emails || []).map((e) => e.value), ...(m.phones || []).map((p) => p.value)].filter(Boolean).join(' · ');
        nm.textContent = (m.fullName || '(no name)') + (summary ? ` — ${summary}` : '');

        const exp = document.createElement('button');
        exp.className = 'tiny secondary';
        exp.textContent = 'Details';
        const det = document.createElement('div');
        det.className = 'dm-details hidden';
        det.innerHTML = memberDetailsHtml(m);
        exp.onclick = () => {
          det.classList.toggle('hidden');
          exp.textContent = det.classList.contains('hidden') ? 'Details' : 'Hide';
        };

        headr.appendChild(cb); headr.appendChild(nm); headr.appendChild(exp);
        row.appendChild(headr); row.appendChild(det);
        mlist.appendChild(row);
      }
      block.appendChild(mlist);

      const inclCount = g.members.filter((m) => gs.included.has(m.uid)).length;
      if (inclCount >= 2) {
        block.appendChild(buildMergeEditor(g, gs));
      } else {
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = 'Fewer than 2 contacts included — these will be kept as separate contacts.';
        block.appendChild(note);
      }
    }
    el.appendChild(block);
  }
}

function matchesItem(it) {
  const text = $('filterText').value.trim().toLowerCase();
  const email = $('filterEmail').value.trim().toLowerCase();
  const d = it.display;
  if (email && !d.emails.some((e) => e.toLowerCase().includes(email))) return false;
  if (text) {
    const hay = [d.fullName, d.org, ...d.emails, ...d.phones].join(' ').toLowerCase();
    if (!hay.includes(text)) return false;
  }
  return true;
}

function updateSelCount() {
  const total = state.items.length;
  const shown = state.items.filter(matchesItem).length;
  $('selCount').textContent = total
    ? `${state.selected.size} of ${total} selected` + (shown !== total ? ` · ${shown} shown` : '')
    : 'No files loaded yet.';
}

function renderSelectionList() {
  const list = $('contactList');
  if (!state.items.length) {
    list.innerHTML = '<div class="cl-empty">Add a .vcf above to list contacts here.</div>';
    updateSelCount();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of state.items) {
    const ignored = state.ignored.has(it.itemId);
    const row = document.createElement('div');
    row.className = 'cl-row' + (matchesItem(it) ? '' : ' hiddenrow') + (ignored ? ' ignored' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(it.itemId) && !ignored;
    cb.disabled = ignored;
    cb.onchange = () => {
      if (cb.checked) state.selected.add(it.itemId); else state.selected.delete(it.itemId);
      updateSelCount(); refresh();
    };
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'cl-name';
    name.textContent = it.display.fullName || '(no name)';
    if (it.kind === 'merged') {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = `merged ${it.mergedCount}`;
      name.append(' ', b);
    }
    const sub = document.createElement('div');
    sub.className = 'cl-meta';
    sub.textContent = [it.display.org, ...it.display.emails, ...it.display.phones].filter(Boolean).join(' · ') || '(no other details)';
    info.appendChild(name); info.appendChild(sub);
    const ig = document.createElement('button');
    ig.className = 'tiny secondary';
    ig.textContent = ignored ? 'Restore' : 'Ignore';
    ig.onclick = () => {
      if (ignored) { state.ignored.delete(it.itemId); state.selected.add(it.itemId); }
      else { state.ignored.add(it.itemId); state.selected.delete(it.itemId); }
      renderSelectionList(); refresh();
    };
    row.appendChild(cb); row.appendChild(info); row.appendChild(ig);
    frag.appendChild(row);
  }
  list.innerHTML = '';
  list.appendChild(frag);
  updateSelCount();
}

window.addEventListener('DOMContentLoaded', async () => {
  window.api.onProgress((d) => {
    if (d.pct != null) { if (activeOut) setProgress(activeOut, d.pct, d.msg); return; }
    if (activeOut) addLine(activeOut, d.msg);
    log(d.msg);
  });

  const info = await window.api.platform();
  state.isMac = info.isMac;
  $('platform').textContent = info.platform;
  if (!info.isMac) {
    $('snapSection').classList.add('hidden');
    document.querySelectorAll('.mac-only').forEach((e) => e.classList.add('hidden'));
  }
  log(`Ready. Backups will be saved to: ${info.backupDir}`);
  showPhase(0);
  refresh();

  // nav
  $('backBtn').onclick = () => showPhase(phaseIndex - 1);
  $('nextBtn').onclick = () => showPhase(phaseIndex + 1);
  document.querySelectorAll('.phase-link').forEach((el) => {
    el.onclick = () => showPhase(parseInt(el.dataset.i, 10));
  });
  $('toggleLog').onclick = () => {
    const w = $('logWrap');
    w.classList.toggle('collapsed');
    $('toggleLog').textContent = w.classList.contains('collapsed') ? 'Show' : 'Hide';
  };
  $('clearLog').onclick = () => { $('log').textContent = ''; };

  // Select — sub-step 1: add/remove files
  $('addFile').onclick = () => run('addFile', 'out-files', async (ctx) => {
    const p = await window.api.pickVcf('Add an exported .vcf');
    if (!p) { ctx.done('warn', 'No file added.'); return; }
    if (state.files.includes(p)) { ctx.done('warn', 'That file is already added.'); return; }
    state.files.push(p);
    ctx.line(`Added: ${p}`);
    await reloadData();
    const n = state.groups.length;
    ctx.done('ok', `${state.files.length} file(s), ${state.records.length} contacts` +
      (n ? ` — ${n} duplicate group(s) to review.` : ' — no duplicates found.'));
  });

  // Select — sub-step 3: filters + bulk selection
  $('filterText').oninput = renderSelectionList;
  $('filterEmail').oninput = renderSelectionList;
  $('selAll').onclick = () => {
    state.items.forEach((it) => { if (!state.ignored.has(it.itemId)) state.selected.add(it.itemId); });
    renderSelectionList(); refresh();
  };
  $('selNone').onclick = () => { state.selected.clear(); renderSelectionList(); refresh(); };
  $('selFiltered').onclick = () => {
    state.items.filter(matchesItem).forEach((it) => { if (!state.ignored.has(it.itemId)) state.selected.add(it.itemId); });
    renderSelectionList(); refresh();
  };

  $('useSelection').onclick = () => run('useSelection', 'out-select', async (ctx) => {
    const chosen = state.items.filter((it) => state.selected.has(it.itemId) && !state.ignored.has(it.itemId));
    if (!chosen.length) { ctx.done('warn', 'Select at least one contact.'); return; }
    const payload = chosen.map((it) => (it.kind === 'merged' ? { contact: it.contact } : { raw: it.raw }));
    const r = await window.api.writeImport(payload);
    state.importPath = r.importPath; state.imported = false; state.verifyPassed = false;
    $('importFile').innerHTML = `Import file: <code>${escapeHtml(r.importPath)}</code>`;
    ctx.line(`Import file: ${r.importPath}`);
    ctx.done('ok', `${r.count} contacts queued for import (Migrate uses this set).`);
  });

  // Migrate — backup ALL contacts across files
  $('backup').onclick = () => run('backup', 'out-backup', async (ctx) => {
    const r = await window.api.backupFiles(state.files);
    state.hasBackup = true;
    ctx.line(`CSV: ${r.csvPath}`);
    ctx.line(`vCard: ${r.vcfPath}`);
    ctx.done('ok', `Backed up all ${r.count} contacts.`);
  });

  // Migrate — snapshot
  $('permHelp').onclick = () => window.api.openSettings('automation');
  $('snapshot').onclick = () => run('snapshot', 'out-snapshot', async (ctx) => {
    const r = await window.api.snapshot(state.importPath);
    if (r.permission) {
      ctx.line(r.permission);
      ctx.done('bad', 'Contacts access is blocked — grant it, then retry.');
      ctx.button('Open Contacts permission settings', () => window.api.openSettings('automation'));
      ctx.button('Retry snapshot', () => $('snapshot').click());
      return;
    }
    if (!r.supported) { ctx.line(r.manual); ctx.done('warn', 'Not supported on this OS.'); return; }
    state.snapPath = r.snapPath;
    ctx.line(`Snapshot saved: ${r.snapPath}`);
    ctx.line(`${r.present} of the selected contacts are present in this Mac's Contacts.app.`);
    if (r.present === 0) {
      ctx.done('warn', `${r.total} contacts captured; selected set looks phone-only (delete will be guided-manual).`);
    } else {
      ctx.done('ok', `${r.total} contacts captured; ${r.present} old copies removable later.`);
    }
  });

  // Migrate — import confirmation (manual import) -> unlocks verify
  $('confirmImport').onclick = () => run('confirmImport', 'out-import', async (ctx) => {
    if (!state.importPath) { ctx.done('warn', 'Finish the Select step first, then import that file.'); return; }
    state.imported = true;
    ctx.line('Marked as imported. You can now verify the migration below.');
    ctx.done('ok', 'Import confirmed — Verify is unlocked.');
  });

  // Migrate — verify
  $('pickNew').onclick = () => run('pickNew', 'out-verify', async (ctx) => {
    const p = await window.api.pickVcf('Choose the NEW account export .vcf');
    if (!p) { ctx.done('warn', 'No file chosen.'); return; }
    state.newPath = p; state.verifyPassed = false;
    $('newPath').textContent = p;
    ctx.line(`Selected: ${p}`);
    ctx.done('ok', 'New export selected — click Verify migration.');
  });

  $('verify').onclick = () => run('verify', 'out-verify', async (ctx) => {
    const r = await window.api.verify(state.importPath, state.newPath);
    state.verifyPassed = r.passed;
    const missing = r.rows.filter((x) => x.status === 'missing').map((x) => x.fullName);
    ctx.line(`Confident: ${r.counts.matched}  Low-confidence: ${r.counts['low-confidence']}  Missing: ${r.counts.missing}`);
    ctx.line(`Report: ${r.reportPath}`);
    if (missing.length) ctx.line(`Missing: ${missing.join(', ')}`);
    if (!r.passed) {
      ctx.done('bad', `${r.verified}/${r.total} found — ${r.counts.missing} missing. Delete stays locked.`);
    } else if (r.counts['low-confidence']) {
      ctx.done('warn', `${r.verified}/${r.total} found (some name-only — review report). Delete unlocked.`);
    } else {
      ctx.done('ok', `${r.verified}/${r.total} found. Delete unlocked.`);
    }
  });

  // Finish — delete
  $('delete').onclick = () => run('delete', 'out-delete', async (ctx) => {
    const plan = await window.api.deletePlan(state.importPath, state.snapPath);
    if (plan.mode === 'manual') {
      if (plan.note) ctx.line(plan.note);
      ctx.line(plan.manual);
      ctx.done('warn', 'Manual removal required (nothing deleted).');
      return;
    }
    ctx.line(`${plan.targets.length} old copies eligible for deletion.`);
    ctx.done('running', 'Awaiting your confirmation…');
    showConfirm(plan.targets, ctx);
  });

  $('modalCancel').onclick = closeModal;
  $('confirmInput').oninput = (e) => { $('modalOk').disabled = e.target.value.trim() !== 'delete'; };
});

function showConfirm(targets, ctx) {
  const ids = targets.map((t) => t.id);
  $('modalBody').innerHTML =
    `<p>Will delete <b>${targets.length}</b> old copies from Contacts.app ` +
    `(pre-import originals only — imported copies are untouched):</p><ul>` +
    targets.map((t) => `<li>${escapeHtml(t.name)}</li>`).join('') + '</ul>';
  $('confirmInput').value = '';
  $('modalOk').disabled = true;
  $('modal').classList.remove('hidden');

  $('modalOk').onclick = async () => {
    const ok = $('modalOk');
    ok.classList.add('busy'); ok.disabled = true;
    try {
      const r = await window.api.deleteApply(ids);
      closeModal();
      if (r.permission) {
        ctx.line(r.permission);
        ctx.done('bad', 'Blocked — Contacts permission needed.');
        ctx.button('Open Contacts permission settings', () => window.api.openSettings('automation'));
        return;
      }
      state.deleted = true;
      refresh();
      ctx.line(`Removed ${r.removed} contact(s). Backup preserved.`);
      ctx.done('ok', `Deleted ${r.removed} old contact(s).`);
    } catch (err) {
      closeModal();
      ctx.done('bad', `Failed: ${err.message || err}`);
    } finally {
      ok.classList.remove('busy');
    }
  };
}

function closeModal() { $('modal').classList.add('hidden'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
