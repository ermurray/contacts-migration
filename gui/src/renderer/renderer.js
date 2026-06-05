'use strict';
/* global window, document */

const state = {
  oldPath: null,
  newPath: null,
  snapPath: null,
  hasBackup: false,
  verifyPassed: false,
  isMac: false,
};

const $ = (id) => document.getElementById(id);
function log(msg) {
  const el = $('log');
  const ts = new Date().toLocaleTimeString();
  el.textContent += `[${ts}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function refresh() {
  $('backup').disabled = !state.oldPath;
  $('snapshot').disabled = !(state.isMac && state.oldPath);
  $('verify').disabled = !(state.oldPath && state.newPath);
  $('delete').disabled = !(state.hasBackup && state.verifyPassed);
}

async function guard(fn) {
  try { await fn(); }
  catch (err) { log(`ERROR: ${err.message || err}`); }
}

window.addEventListener('DOMContentLoaded', async () => {
  const info = await window.api.platform();
  state.isMac = info.isMac;
  $('platform').textContent = info.platform;
  if (!info.isMac) {
    // Hide the macOS-only snapshot step.
    $('snapSection').classList.add('hidden');
    document.querySelectorAll('.mac-only').forEach((e) => e.classList.add('hidden'));
  }
  log(`Ready. Backups will be saved to: ${info.backupDir}`);
  refresh();

  $('pickOld').onclick = () => guard(async () => {
    const p = await window.api.pickVcf('Choose the OLD contacts .vcf');
    if (!p) return;
    state.oldPath = p; state.hasBackup = false; state.verifyPassed = false;
    $('oldPath').textContent = p;
    log(`Old export: ${p}`);
    refresh();
  });

  $('pickNew').onclick = () => guard(async () => {
    const p = await window.api.pickVcf('Choose the NEW account export .vcf');
    if (!p) return;
    state.newPath = p; state.verifyPassed = false;
    $('newPath').textContent = p;
    log(`New export: ${p}`);
    refresh();
  });

  $('backup').onclick = () => guard(async () => {
    const r = await window.api.backup(state.oldPath);
    state.hasBackup = true;
    log(`Backed up ${r.count} contacts -> ${r.csvPath}`);
    refresh();
  });

  $('snapshot').onclick = () => guard(async () => {
    const r = await window.api.snapshot(state.oldPath);
    if (r.permission) { log(r.permission); return; }
    if (!r.supported) { log(r.manual); return; }
    state.snapPath = r.snapPath;
    log(`Snapshot: ${r.total} contacts on this Mac; ${r.present} old copies found here.`);
    if (r.present === 0) log('Old contacts look phone-only; delete will be guided-manual.');
  });

  $('verify').onclick = () => guard(async () => {
    const r = await window.api.verify(state.oldPath, state.newPath);
    state.verifyPassed = r.passed;
    const box = $('verifyResult');
    box.classList.remove('hidden', 'ok', 'bad', 'warn');
    box.classList.add(r.passed ? (r.counts['low-confidence'] ? 'warn' : 'ok') : 'bad');
    const missing = r.rows.filter((x) => x.status === 'missing').map((x) => x.fullName);
    box.textContent =
      `${r.verified}/${r.total} found ` +
      `(${r.counts.matched} confident, ${r.counts['low-confidence']} low-confidence, ` +
      `${r.counts.missing} missing)\nReport: ${r.reportPath}` +
      (missing.length ? `\nMissing: ${missing.join(', ')}` : '');
    log(r.passed ? 'Verify passed.' : `Verify FAILED: ${missing.length} missing.`);
    refresh();
  });

  $('delete').onclick = () => guard(async () => {
    const plan = await window.api.deletePlan(state.oldPath, state.snapPath);
    if (plan.mode === 'manual') {
      showManual(plan);
      return;
    }
    showConfirm(plan.targets);
  });

  // ---- modal wiring ----
  $('modalCancel').onclick = closeModal;
  $('confirmInput').oninput = (e) => {
    $('modalOk').disabled = e.target.value.trim() !== 'delete';
  };
});

function showManual(plan) {
  const box = $('deleteResult');
  box.classList.remove('hidden', 'ok', 'bad', 'warn');
  box.classList.add('warn');
  box.textContent = (plan.note ? plan.note + '\n' : '') + plan.manual;
  log('Delete: manual removal required on this platform.');
}

function showConfirm(targets) {
  const ids = targets.map((t) => t.id);
  $('modalBody').innerHTML =
    `<p>Will delete <b>${targets.length}</b> old copies from Contacts.app ` +
    `(pre-import originals only — imported copies are untouched):</p><ul>` +
    targets.map((t) => `<li>${escapeHtml(t.name)}</li>`).join('') + '</ul>';
  $('confirmInput').value = '';
  $('modalOk').disabled = true;
  $('modal').classList.remove('hidden');
  $('modalOk').onclick = () => guard(async () => {
    const r = await window.api.deleteApply(ids);
    closeModal();
    const box = $('deleteResult');
    box.classList.remove('hidden', 'ok', 'bad', 'warn');
    if (r.permission) { box.classList.add('bad'); box.textContent = r.permission; log('Delete blocked: permission needed.'); return; }
    box.classList.add('ok');
    box.textContent = `Deleted ${r.removed} old contact(s). Your backup is preserved.`;
    log(`Deleted ${r.removed} old contact(s).`);
  });
}

function closeModal() { $('modal').classList.add('hidden'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
