'use strict';
/* global window, document */

const state = {
  sourcePath: null,   // the full exported .vcf the user picked
  contacts: [],       // lightweight list for the selection UI
  selected: new Set(),// indices currently selected
  importPath: null,   // curated subset written for import (selected only)
  newPath: null,
  snapPath: null,
  hasBackup: false,
  imported: false,
  verifyPassed: false,
  deleted: false,
  isMac: false,
};

let activeOut = null; // the .step-out currently receiving live progress lines

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
    source: !!state.sourcePath,
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
    !!state.sourcePath,
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
  const ts = new Date().toLocaleTimeString();
  el.textContent += `[${ts}] ${msg}\n`;
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

// Drive a button + its output panel through an async action with a spinner.
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
    done: (stateName, m) => head(out, stateName, m),
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
  $('useSelection').disabled = !(state.sourcePath && state.selected.size > 0);
  $('backup').disabled = !state.sourcePath;
  $('snapshot').disabled = !(state.isMac && state.importPath);
  $('verify').disabled = !(state.importPath && state.newPath && state.imported);
  $('delete').disabled = !(state.hasBackup && state.verifyPassed);
  updateProgress();
}

// ---- contact selection UI ----
function matchesFilters(c) {
  const text = $('filterText').value.trim().toLowerCase();
  const email = $('filterEmail').value.trim().toLowerCase();
  if (email) {
    if (!c.emails.some((e) => e.toLowerCase().includes(email))) return false;
  }
  if (text) {
    const hay = [c.fullName, c.org, ...c.emails, ...c.phones].join(' ').toLowerCase();
    if (!hay.includes(text)) return false;
  }
  return true;
}

function visibleIndices() {
  return state.contacts.filter(matchesFilters).map((c) => c.index);
}

function updateCount() {
  const total = state.contacts.length;
  const shown = visibleIndices().length;
  $('selCount').textContent =
    `${state.selected.size} of ${total} selected` +
    (shown !== total ? ` · ${shown} shown` : '');
}

function renderList() {
  const list = $('contactList');
  if (!state.contacts.length) {
    list.innerHTML = '<div class="cl-empty">Choose a .vcf in step 2 to list contacts here.</div>';
    updateCount();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of state.contacts) {
    const row = document.createElement('label');
    row.className = 'cl-row' + (matchesFilters(c) ? '' : ' hiddenrow');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(c.index);
    cb.onchange = () => {
      if (cb.checked) state.selected.add(c.index); else state.selected.delete(c.index);
      updateCount(); refresh();
    };
    const meta = [c.org, ...c.emails, ...c.phones].filter(Boolean).join(' · ');
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'cl-name';
    name.textContent = c.fullName;
    const sub = document.createElement('div');
    sub.className = 'cl-meta';
    sub.textContent = meta || '(no other details)';
    info.appendChild(name); info.appendChild(sub);
    row.appendChild(cb); row.appendChild(info);
    frag.appendChild(row);
  }
  list.innerHTML = '';
  list.appendChild(frag);
  updateCount();
}

async function loadContactsForSelection(ctx) {
  state.contacts = await window.api.loadContacts(state.sourcePath);
  state.selected = new Set(state.contacts.map((c) => c.index)); // default: all
  renderList();
  ctx.line(`Listed ${state.contacts.length} contacts (all selected by default).`);
  ctx.done('ok', `${state.contacts.length} contacts loaded — refine your selection in step 3.`);
}

window.addEventListener('DOMContentLoaded', async () => {
  window.api.onProgress((d) => {
    if (d.pct != null) {
      if (activeOut) setProgress(activeOut, d.pct, d.msg);
      return;
    }
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

  // Step 2: pick old export -> load list
  $('pickOld').onclick = () => run('pickOld', 'out-old', async (ctx) => {
    const p = await window.api.pickVcf('Choose the OLD contacts .vcf');
    if (!p) { ctx.done('warn', 'No file chosen.'); return; }
    state.sourcePath = p;
    state.importPath = null; state.hasBackup = false; state.imported = false; state.verifyPassed = false;
    $('oldPath').textContent = p;
    $('importFile').innerHTML = 'Import file: <i>(complete step 3 to generate it)</i>';
    ctx.line(`Selected: ${p}`);
    await loadContactsForSelection(ctx);
  });

  // Step 3: filters + selection
  $('filterText').oninput = renderList;
  $('filterEmail').oninput = renderList;
  $('selAll').onclick = () => {
    state.contacts.forEach((c) => state.selected.add(c.index));
    renderList(); refresh();
  };
  $('selNone').onclick = () => { state.selected.clear(); renderList(); refresh(); };
  $('selFiltered').onclick = () => {
    visibleIndices().forEach((i) => state.selected.add(i));
    renderList(); refresh();
  };

  $('useSelection').onclick = () => run('useSelection', 'out-select', async (ctx) => {
    const indices = [...state.selected].sort((a, b) => a - b);
    const r = await window.api.writeSelection(state.sourcePath, indices);
    state.importPath = r.importPath;
    state.imported = false;     // selection changed -> must re-import
    state.verifyPassed = false; // and re-verify
    $('importFile').innerHTML = `Import file: <code>${escapeHtml(r.importPath)}</code>`;
    ctx.line(`Import file: ${r.importPath}`);
    ctx.done('ok', `${r.count} contacts queued for import (steps 6–8 use this set).`);
  });

  // Step 4: backup (ALL exported contacts, for safety)
  $('backup').onclick = () => run('backup', 'out-backup', async (ctx) => {
    const r = await window.api.backup(state.sourcePath);
    state.hasBackup = true;
    ctx.line(`CSV: ${r.csvPath}`);
    ctx.line(`vCard copy: ${r.vcfPath}`);
    ctx.done('ok', `Backed up all ${r.count} contacts.`);
  });

  // Step 5: snapshot (matches the selected set)
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

  // Import confirmation — the import itself is manual; this unlocks verify.
  $('confirmImport').onclick = () => run('confirmImport', 'out-import', async (ctx) => {
    if (!state.importPath) {
      ctx.done('warn', 'Finish the Select step first, then import that file.');
      return;
    }
    state.imported = true;
    ctx.line('Marked as imported. You can now verify the migration below.');
    ctx.done('ok', 'Import confirmed — Verify is unlocked.');
  });

  // Step: verify (selected vs new export)
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

  // Step 8: delete (selected old copies)
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

  // ---- modal ----
  $('modalCancel').onclick = closeModal;
  $('confirmInput').oninput = (e) => {
    $('modalOk').disabled = e.target.value.trim() !== 'delete';
  };
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
