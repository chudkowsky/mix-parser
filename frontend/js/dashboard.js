// ── Dashboard ─────────────────────────────────────────────────────────────────

async function renderDashboard() {
  app.innerHTML = '<div class="loading">Loading…</div>';

  let matches = [], leaderboard = { players: [], guests: [] }, stats = { player_history: [], map_distribution: {} };
  try {
    [matches, leaderboard, stats] = await Promise.all([
      fetch('/matches').then(r => r.json()),
      fetch('/leaderboard').then(r => r.json()),
      fetch('/stats').then(r => r.json()),
    ]);
  } catch (e) {
    app.innerHTML = `<div class="error">Could not reach server: ${e.message}</div>`;
    return;
  }

  app.innerHTML = `
    <div class="tp-nav-card" onclick="navigate('team-picker')">
      <span class="tp-nav-icon">🎲</span>
      <span class="tp-nav-label">Pick Teams</span>
    </div>
    ${uploadCard()}
    ${leaderboardCard(leaderboard)}
    ${chartsSection(stats, leaderboard.players)}
    ${matchesSection(matches)}
  `;

  initUpload();
  renderCharts(stats, leaderboard.players);
}

function uploadCard() {
  return `<div class="card">
    <div class="card-title">Upload Demo</div>
    <div class="upload-area">
      <div class="drop-zone" id="dropzone">
        <input type="file" id="fileInput" accept=".dem,.bz2,.gz" />
        <span id="drop-label">Drop .dem / .dem.bz2 / .dem.gz here — or click to browse</span>
      </div>
      <button class="parse-btn" id="parseBtn" disabled>Analyze</button>
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
    statusEl.textContent = 'Uploading & parsing…';

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
        statusEl.textContent = `This demo was already analyzed (match #${data.id}). Showing existing results.`;
      } else {
        statusEl.style.color = 'var(--green)';
        statusEl.textContent = `Parsed! Match #${data.match_id} saved.`;
      }
      setTimeout(() => renderDashboard(), 800);
    } catch (e) {
      btn.disabled = false;
      statusEl.style.color = 'var(--red)';
      statusEl.textContent = `Error: ${e.message}`;
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
      setTimeout(() => { tile.remove(); refreshLeaderboard(); }, 260);
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
