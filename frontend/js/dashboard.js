// ── Dashboard ─────────────────────────────────────────────────────────────────

async function renderDashboard() {
  app.innerHTML = '<div class="loading">Ładowanie…</div>';

  let leaderboard = { players: [], guests: [] }, stats = { player_history: [], map_distribution: {} };
  try {
    const safeJson = (url, fallback) => fetch(url).then(r => r.json()).catch(() => fallback);
    [leaderboard, stats, _seasons, _allTitles] = await Promise.all([
      fetch('/leaderboard').then(r => r.json()),
      fetch('/stats').then(r => r.json()),
      safeJson('/seasons', []),
      safeJson('/titles', {}),
    ]);
    _currentSeasonId = null;
  } catch (e) {
    app.innerHTML = `<div class="error">Nie można połączyć z serwerem: ${e.message}</div>`;
    return;
  }

  app.innerHTML = `
    ${uploadCard()}
    ${isAdmin() ? adminSeasonCard() : ''}
    ${leaderboardCard(leaderboard)}
    ${chartsSection(stats, leaderboard.players)}
  `;

  initUpload();
  renderCharts(stats, leaderboard.players);
}

function uploadCard() {
  return `<div class="card">
  <div class="card-title accent-blue">Dodaj demko</div>
    <div class="upload-area">
      <div class="drop-zone" id="dropzone">
        <input type="file" id="fileInput" accept=".dem,.bz2,.gz" />
        <span id="drop-label">Dodaj .dem / .dem.bz2 / .dem.gz tutaj — albo kliknij by wybrać plik</span>
      </div>
      <button class="parse-btn" id="parseBtn" disabled>Rozpocznij analizę</button>
    </div>
    <div id="upload-status"></div>
  </div>`;
}

// ── Upload logic ──────────────────────────────────────────────────────────────

function initUpload() {
  const dz       = document.getElementById('dropzone');
  const input    = document.getElementById('fileInput');
  const btn      = document.getElementById('parseBtn');
  const statusEl = document.getElementById('upload-status');
  const label    = document.getElementById('drop-label');

  if (!dz) return;
  let file = null;

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) pick(input.files[0]); });

  function pick(f) {
    file = f;
    label.textContent = `${f.name}  (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
    btn.disabled = false;
    statusEl.textContent = '';
  }

  btn.addEventListener('click', async () => {
    if (!file) return;
    btn.disabled = true;
    statusEl.style.color = 'var(--text-dim)';
    statusEl.textContent = 'Wysyłanie i analiza…';

    const form = new FormData();
    form.append('file', file);
    const name = getUserName();
    if (name) form.append('uploaded_by', name);

    try {
      const res  = await fetch('/parse', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.statusText);
      if (data.already_parsed) {
        statusEl.style.color = 'var(--accent)';
        statusEl.textContent = `To demo było już przeanalizowane (mecz #${data.id}). Wyświetlam istniejące wyniki.`;
      } else {
        statusEl.style.color = 'var(--green)';
        statusEl.textContent = `Przeanalizowano! Mecz #${data.match_id} zapisany.`;
      }
      setTimeout(() => renderDashboard(), 800);
    } catch (e) {
      btn.disabled = false;
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = `Błąd: ${e.message}`;
    }
  });
}

// ── Delete match ──────────────────────────────────────────────────────────────

async function deleteMatch(id, btn, redirect = false) {
  const answer = prompt(`Type DELETE to confirm removing match #${id}.\nThis will revert its impact on all stats and cannot be undone.`);
  if (answer !== 'DELETE') return;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/matches/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    if (redirect) {
      navigate('');
    } else {
      const tile = btn.closest('.match-tile');
      tile.style.transition = 'opacity .25s';
      tile.style.opacity = '0';
      const onMatches = location.hash.replace('#', '').split('/')[0] === 'matches';
      setTimeout(() => { tile.remove(); if (!onMatches) refreshLeaderboard(); }, 260);
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '✕';
    alert(`Delete failed: ${e.message}`);
  }
}

async function refreshLeaderboard() {
  try {
    await fetch('/leaderboard').then(r => r.json());
    renderDashboard();
  } catch (_) {}
}

// ── Admin: Season Management ──────────────────────────────────────────────────

function adminSeasonCard() {
  const activeSeason = _seasons.find(s => s.is_active);

  const seasonRows = _seasons.map(s => {
    const start = fmtDate(s.start_date);
    const end   = s.end_date ? fmtDate(s.end_date) : 'ongoing';
    const badge = s.is_active
      ? `<span style="font-family:'Barlow Condensed',sans-serif;font-size:.65rem;font-weight:700;letter-spacing:.08em;background:var(--green-dim);color:var(--green);border:1px solid var(--green);padding:.05rem .35rem;margin-left:.4rem">NA ŻYWO</span>`
      : `<span style="font-size:.65rem;color:var(--muted);margin-left:.4rem">zamknięty</span>`;
    const today = new Date().toISOString().slice(0, 10);
    const actions = s.is_active
      ? `<input type="date" id="close-date-${s.id}" value="${today}"
           style="padding:.28rem .5rem;background:var(--bg-deep);border:1px solid var(--border);color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:.78rem">
         <button class="admin-season-btn danger" onclick="adminCloseSeason(${s.id}, this)">Zamknij sezon</button>`
      : `<span class="season-summary-link" style="margin-left:0" onclick="navigate('season/${s.id}')">Podsumowanie →</span>
         <button class="admin-season-btn danger" style="margin-left:.5rem" onclick="adminDeleteSeason(${s.id}, this)">Usuń</button>`;
    return `<div class="admin-season-row">
      <div>
        <span style="font-weight:600">${esc(s.name)}</span>${badge}
        <span style="color:var(--muted);font-size:.78rem;margin-left:.75rem">${start} — ${end}</span>
      </div>
      <div style="display:flex;align-items:center;gap:.25rem">${actions}</div>
    </div>`;
  }).join('');

  const today = new Date().toISOString().slice(0, 10);

  return `<div class="card" id="admin-season-card">
    <div class="card-title accent-red">Admin — Zarządzanie sezonem</div>
    <div class="card-body">

    ${seasonRows || '<p class="empty-state" style="margin-bottom:1rem">Brak sezonów.</p>'}

    <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
      <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);margin-bottom:.65rem">Nowy sezon</div>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:.3rem">
          <label style="font-size:.72rem;color:var(--muted)">Nazwa</label>
          <input id="season-name-input" type="text" placeholder="e.g. Maj 2025" maxlength="40"
            style="padding:.4rem .7rem;background:var(--bg-deep);border:1px solid var(--border);color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:.85rem;width:160px"
            onkeydown="if(event.key==='Enter') adminCreateSeason()" />
        </div>
        <div style="display:flex;flex-direction:column;gap:.3rem">
          <label style="font-size:.72rem;color:var(--muted)">Data rozpoczęcia</label>
          <input id="season-start-input" type="date" value="${today}"
            style="padding:.4rem .7rem;background:var(--bg-deep);border:1px solid var(--border);color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:.85rem" />
        </div>
        <button class="admin-season-btn" onclick="adminCreateSeason()">Utwórz</button>
      </div>
      <div id="admin-season-status" style="font-size:.8rem;min-height:1.2em;margin-top:.5rem"></div>
    </div>
    </div>
  </div>`;
}

async function adminCreateSeason() {
  const nameEl  = document.getElementById('season-name-input');
  const startEl = document.getElementById('season-start-input');
  const statusEl = document.getElementById('admin-season-status');
  const name  = nameEl?.value.trim();
  const start = startEl?.value;

  if (!name)  { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Nazwa jest wymagana.'; return; }
  if (!start) { statusEl.style.color = 'var(--red)'; statusEl.textContent = 'Data rozpoczęcia jest wymagana.'; return; }

  statusEl.style.color = 'var(--text-dim)';
  statusEl.textContent = 'Tworzenie…';

  try {
    const res = await fetch('/admin/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ name, start_date: start + 'T00:00:00+00:00' }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    statusEl.style.color = 'var(--green)';
    statusEl.textContent = `Sezon "${name}" utworzony.`;
    setTimeout(() => renderDashboard(), 800);
  } catch (e) {
    statusEl.style.color = 'var(--red)';
    statusEl.textContent = `Błąd: ${e.message}`;
  }
}

async function adminDeleteSeason(seasonId, btn) {
  const season = _seasons.find(s => s.id === seasonId);
  const name   = season?.name || `Season #${seasonId}`;
  if (!confirm(`Usunąć "${name}"?\n\nTo na stałe usunie sezon i wszystkie przyznane tytuły. Operacji nie można cofnąć.`)) return;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/admin/seasons/${seasonId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
    renderDashboard();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Usuń';
    alert(`Błąd: ${e.message}`);
  }
}

async function adminCloseSeason(seasonId, btn) {
  const season  = _seasons.find(s => s.id === seasonId);
  const name    = season?.name || `Season #${seasonId}`;
  const dateVal = document.getElementById(`close-date-${seasonId}`)?.value;
  const endDate = dateVal ? dateVal + 'T23:59:59+00:00' : null;

  if (!confirm(`Zamknąć "${name}"?\nData zakończenia: ${dateVal || 'teraz'}\n\nTo zablokuje ranking i wygeneruje nagrody sezonowe. Operacji nie można cofnąć.`)) return;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await fetch(`/admin/seasons/${seasonId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ end_date: endDate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    alert(`Sezon zamknięty! Wygenerowano ${data.awards_given} nagród.`);
    renderDashboard();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Zamknij sezon';
    alert(`Błąd: ${e.message}`);
  }
}
