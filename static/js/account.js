/**
 * static/js/account.js
 * Account page: profile, password, API keys, GDPR.
 */

function showMsg(id, text, type = 'success') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `account-msg ${type}`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

async function apiPost(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({}))};
}

// ── Profile ──────────────────────────────────────────────────────────────────
document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('save-profile-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const {ok, data} = await apiPost('/api/account/profile', {
    display_name: document.getElementById('display_name')?.value || '',
    institution:  document.getElementById('institution')?.value  || '',
    role:         document.getElementById('role_field')?.value   || '',
  });
  btn.disabled = false; btn.textContent = 'Save profile';
  if (ok) showMsg('profile-msg', 'Profile saved.', 'success');
  else    showMsg('profile-msg', data.message || 'Save failed.', 'error');
});

// ── Password ──────────────────────────────────────────────────────────────────
document.getElementById('change-password-btn')?.addEventListener('click', async () => {
  const btn   = document.getElementById('change-password-btn');
  const newPw = document.getElementById('new_password')?.value || '';
  if (newPw.length < 8) { showMsg('password-msg', 'New password must be at least 8 characters.', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Changing…';
  const {ok, data} = await apiPost('/api/account/password', {
    current_password: document.getElementById('current_password')?.value || '',
    new_password:     newPw,
  });
  btn.disabled = false; btn.textContent = 'Change password';
  if (ok) {
    showMsg('password-msg', 'Password changed.', 'success');
    document.getElementById('current_password').value = '';
    document.getElementById('new_password').value = '';
  } else {
    const msgs = {wrong_current_password: 'Current password is incorrect.', password_too_short: 'Password must be at least 8 characters.'};
    showMsg('password-msg', msgs[data.error] || data.message || 'Change failed.', 'error');
  }
});

// Billing section removed — all features free (ADR-016).

// ── API Keys ────────────────────────────────────────────────────────────────────
async function loadApiKeys() {
  const list = document.getElementById('api-keys-list');
  if (!list) return;
  try {
    const resp = await fetch('/api/account/api-keys');
    if (!resp.ok) { list.innerHTML = '<p class="loading-text">Could not load keys.</p>'; return; }
    const {keys} = await resp.json();
    if (!keys || keys.length === 0) { list.innerHTML = '<p class="loading-text">No API keys yet.</p>'; return; }
    list.innerHTML = keys.map(k => `
      <div class="api-key-row" data-key-id="${k.key_id}">
        <span class="api-key-prefix">${k.key_prefix}${'•'.repeat(12)}</span>
        <span class="api-key-label">${k.label || 'Unlabelled'}</span>
        <span class="api-key-label" style="color:#475569">${k.last_used_at ? 'Last used ' + new Date(k.last_used_at).toLocaleDateString() : 'Never used'}</span>
        <button class="btn-danger btn-sm" onclick="revokeKey('${k.key_id}')">Revoke</button>
      </div>
    `).join('');
  } catch { list.innerHTML = '<p class="loading-text">Error loading keys.</p>'; }
}

window.revokeKey = async function(keyId) {
  if (!confirm('Revoke this API key? It will stop working immediately.')) return;
  const resp = await fetch(`/api/account/api-keys/${keyId}`, {method: 'DELETE'});
  if (resp.ok) { await loadApiKeys(); }
  else { showMsg('api-key-msg', 'Could not revoke key.', 'error'); }
};

document.getElementById('create-key-btn')?.addEventListener('click', async () => {
  const btn   = document.getElementById('create-key-btn');
  const label = document.getElementById('key_label')?.value || '';
  btn.disabled = true; btn.textContent = 'Creating…';
  const {ok, data} = await apiPost('/api/account/api-keys', {label});
  btn.disabled = false; btn.textContent = 'Create API key';
  if (ok && data.key) {
    document.getElementById('new-key-value').textContent = data.key;
    document.getElementById('new-key-reveal').hidden = false;
    document.getElementById('key_label').value = '';
    await loadApiKeys();
  } else {
    showMsg('api-key-msg', data.message || 'Could not create key.', 'error');
  }
});

// ── GDPR ───────────────────────────────────────────────────────────────────────
document.getElementById('export-data-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('export-data-btn');
  btn.disabled = true; btn.textContent = 'Requesting…';
  const {ok, data} = await apiPost('/api/account/export-data', {});
  btn.disabled = false; btn.textContent = 'Request data export';
  if (ok) showMsg('gdpr-msg', "Export requested. You'll receive an email with a download link shortly.", 'success');
  else    showMsg('gdpr-msg', data.message || 'Export failed.', 'error');
});

document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
  const confirmed = confirm(
    'Delete your account permanently?\n\n' +
    'Your email, profile, and session history will be erased.\n' +
    'Graphs you built will remain (they contain no personal data).\n\n' +
    'This cannot be undone.'
  );
  if (!confirmed) return;

  const password = prompt('Enter your password to confirm:');
  if (!password) return;

  const btn = document.getElementById('delete-account-btn');
  btn.disabled = true; btn.textContent = 'Deleting…';

  const {ok, data} = await apiPost('/api/account/delete', {
    confirmation: 'DELETE MY ACCOUNT',
    password,
  });
  if (ok && data.success) { window.location.href = data.redirect || '/'; }
  else {
    btn.disabled = false; btn.textContent = 'Delete my account';
    showMsg('gdpr-msg', data.error || 'Deletion failed. Try again or contact privacy@arivu.app.', 'error');
  }
});

// ── Init ────────────────────────────────────────────────────────────────────────
(function init() { loadApiKeys(); })();
