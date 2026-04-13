// ── User name ─────────────────────────────────────────────────────────────────

function getUserName() { return localStorage.getItem('user_name') || ''; }

function submitName() {
  const val = document.getElementById('user-name-input').value.trim();
  if (!val) return;
  localStorage.setItem('user_name', val);
  document.getElementById('name-modal').classList.remove('open');
}

function maybeAskName() {
  if (!getUserName()) {
    document.getElementById('name-modal').classList.add('open');
    setTimeout(() => document.getElementById('user-name-input').focus(), 50);
  }
}

// ── Admin auth ────────────────────────────────────────────────────────────────

function getAdminToken() { return sessionStorage.getItem('admin_token'); }
function isAdmin() { return !!getAdminToken(); }

function updateAdminBtn() {
  const btn = document.getElementById('admin-btn');
  if (isAdmin()) {
    btn.textContent = 'Logout';
    btn.className = 'logged-in';
  } else {
    btn.textContent = 'Admin';
    btn.className = 'logged-out';
  }
}

function adminBtnClick() {
  if (isAdmin()) {
    adminLogout();
  } else {
    document.getElementById('login-modal').classList.add('open');
    document.getElementById('admin-pw').value = '';
    document.getElementById('login-error').textContent = '';
    setTimeout(() => document.getElementById('admin-pw').focus(), 50);
  }
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('open');
}

async function submitLogin() {
  const pw = document.getElementById('admin-pw').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) { errEl.textContent = 'Invalid password.'; return; }
    const data = await res.json();
    sessionStorage.setItem('admin_token', data.token);
    closeLoginModal();
    updateAdminBtn();
    router();
  } catch (e) {
    errEl.textContent = `Error: ${e.message}`;
  }
}

async function adminLogout() {
  const token = getAdminToken();
  if (token) {
    await fetch('/admin/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    sessionStorage.removeItem('admin_token');
  }
  updateAdminBtn();
  router();
}
