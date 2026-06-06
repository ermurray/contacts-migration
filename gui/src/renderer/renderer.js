'use strict';
/* global window, document */

const state = {
  files: [],          // added .vcf paths
  records: [],        // combined contacts {uid, fullName, org, emails, phones, raw}
  dupGroups: [],      // duplicate groups from main
  decisions: {},      // groupId -> 'merge' | 'separate'
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
  $('useSelection').disabled = !(state.items.length && state.selected.size > 0);
  $('backup').disabled = !state.files.length;
  $('snapshot').disabled = !(state.isMac && state.importPath);
  $('verify').disabled = !(state.importPath && state.newPath && state.imported);
  $('delete').disabled = !(state.hasBackup && state.verifyPassed);
  updateProgress();
}

// ---- combine / dedupe / select data model ----
function computeItems() {
  const absorbed = new Set();
  const items = [];
  for (const g of state.dupGroups) {
    if ((state.decisions[g.id] || 'merge') === 'merge') {
      g.memberUids.forEach((u) => absorbed.add(u));
      items.push({
        itemId: 'm' + g.id, kind: 'merged', mergedCount: g.memberUids.length,
        display: { fullName: g.merged.fullName, org: g.merged.org, emails: g.merged.emails, phones: g.merged.phones },
        raw: g.merged.raw,
      });
    }
  }
  for (const r of state.records) {
    if (absorbed.has(r.uid)) continue;
    items.push({
      itemId: r.uid, kind: 'single',
      display: { fullName: r.fullName, org: r.org, emails: r.emails, phones: r.phones },
      raw: r.raw,
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
  // any change to the file set invalidates downstream steps
  state.importPath = null; state.imported = false; state.verifyPassed = false;
  if (!state.files.length) {
    state.records = []; state.dupGroups = []; state.items = [];
    state.selected.clear();
    renderFileList(); renderDupes(); renderSelectionList(); refresh();
    return;
  }
  const lf = await window.api.loadFiles(state.files);
  state.records = lf.records;
  const fd = await window.api.findDuplicates(state.files);
  state.dupGroups = fd.groups;
  const dec = {};
  for (const g of state.dupGroups) dec[g.id] = state.decisions[g.id] || 'merge';
  state.decisions = dec;
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

function renderDupes() {
  const el = $('dupList');
  el.innerHTML = '';
  const n = state.dupGroups.length;
  $('dupSummary').textContent = !state.files.length
    ? 'Add files to scan for duplicates.'
    : n ? `${n} possible duplicate group(s). Default action: merge — confirm or change each below.`
      : 'No duplicates found — nothing to merge.';
  for (const g of state.dupGroups) {
    const dec = state.decisions[g.id] || 'merge';
    const block = document.createElement('div');
    block.className = 'dup-group';
    const members = g.members.map((m) => {
      const meta = [...m.emails, ...m.phones].filter(Boolean).join(', ');
      return `<li>${escapeHtml(m.fullName || '(no name)')}${meta ? ' — ' + escapeHtml(meta) : ''}</li>`;
    }).join('');
    const mergedMeta = [g.merged.org, ...g.merged.emails, ...g.merged.phones].filter(Boolean).join(' · ');
    block.innerHTML =
      `<div class="dup-title">Possible duplicate · ${g.members.length} contacts</div>` +
      `<ul class="dup-members">${members}</ul>` +
      `<div class="dup-merged"><b>Merged →</b> ${escapeHtml(g.merged.fullName || '(no name)')}` +
      `${mergedMeta ? ' — ' + escapeHtml(mergedMeta) : ''}</div>` +
      `<div class="dup-actions">` +
      `<label><input type="radio" name="dup-${g.id}" value="merge" ${dec === 'merge' ? 'checked' : ''}> Merge into one</label>` +
      `<label><input type="radio" name="dup-${g.id}" value="separate" ${dec === 'separate' ? 'checked' : ''}> Keep separate</label>` +
      `</div>`;
    el.appendChild(block);
    block.querySelectorAll(`input[name="dup-${g.id}"]`).forEach((r) => {
      r.onchange = () => {
        state.decisions[g.id] = r.value;
        state.importPath = null; state.imported = false; state.verifyPassed = false;
        rebuildSelection(); refresh();
      };
    });
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
    const n = state.dupGroups.length;
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
    const r = await window.api.writeImportRaw(chosen.map((it) => it.raw));
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
