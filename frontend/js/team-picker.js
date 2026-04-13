// ── Team Picker ───────────────────────────────────────────────────────────────

let _tpAllPlayers = [];
let _tpSelected   = new Set();
let _tpCustomSeq  = 0;
let _tpProposals  = [];
let _tpActiveTab  = 0;

async function renderTeamPicker() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const lb = await fetch('/leaderboard').then(r => r.json());
    _tpAllPlayers = [...(lb.players ?? []), ...(lb.guests ?? [])];
    _tpSelected   = new Set();
    _tpCustomSeq  = 0;
    app.innerHTML = buildTeamPickerHTML();
  } catch (e) {
    app.innerHTML = `<div class="error">Could not reach server: ${e.message}</div>`;
  }
}

function buildTeamPickerHTML() {
  const count = _tpSelected.size;

  const sortedPlayers = [..._tpAllPlayers].sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));
  const rows = sortedPlayers.map(p => {
    const sel = _tpSelected.has(p.steamid);
    const removeBtn = p._custom
      ? `<span class="tp-row-remove" onclick="event.stopPropagation();tpRemoveCustom('${p.steamid}')" title="Remove">✕</span>`
      : '';
    const mapsLabel = p._custom
      ? `<span class="tp-row-maps">new</span>`
      : `<span class="tp-row-maps">${p.matches_played} maps</span>`;
    return `<div class="tp-row${sel ? ' selected' : ''}" onclick="tpToggle('${p.steamid}')">
      <span class="tp-row-check">✓</span>
      <span class="tp-row-name">${esc(p.name || p.steamid)}</span>
      ${mapsLabel}
      <span class="tp-row-rating">${fmtRating(p.avg_rating)}</span>
      ${removeBtn}
    </div>`;
  }).join('');

  return `<div class="card">
    <div class="card-title">Team Picker</div>
    <p style="font-size:0.82rem;color:var(--muted);margin:0 0 0.75rem">Select exactly 10 players to generate balanced teams.</p>
    <div class="tp-counter">Selected: <span>${count}</span> / 10</div>
    <div class="tp-player-list">${rows}</div>

    <div class="tp-add-guest">
      <div class="tp-add-title">Player not in the system? <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.6">Add manually with estimated rating</span></div>
      <div class="tp-add-row">
        <input id="tp-guest-name" type="text" placeholder="Name" maxlength="40" />
        <div class="tp-slider-wrap">
          <input id="tp-guest-rating" type="range" min="0.4" max="2.0" step="0.01" value="1.00"
            oninput="document.getElementById('tp-guest-rating-val').textContent = parseFloat(this.value).toFixed(2)" />
          <span id="tp-guest-rating-val">1.00</span>
        </div>
        <button class="tp-add-btn" onclick="tpAddCustom()">Add</button>
      </div>
    </div>

    <button class="tp-generate-btn" ${count !== 10 ? 'disabled' : ''} onclick="tpGenerate()">
      Generate Teams
    </button>
    <div id="tp-result"></div>
  </div>`;
}

function tpRefresh() {
  _tpProposals = [];
  const card = document.querySelector('#app .card');
  if (card) card.outerHTML = buildTeamPickerHTML();
}

function tpToggle(steamid) {
  if (_tpSelected.has(steamid)) {
    _tpSelected.delete(steamid);
  } else {
    if (_tpSelected.size >= 10) return;
    _tpSelected.add(steamid);
  }
  tpRefresh();
}

function tpAddCustom() {
  const nameEl   = document.getElementById('tp-guest-name');
  const ratingEl = document.getElementById('tp-guest-rating');
  const name     = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  const rating = parseFloat(ratingEl.value);
  const id     = `__custom_${++_tpCustomSeq}`;
  _tpAllPlayers.push({ steamid: id, name, avg_rating: rating, matches_played: 0, _custom: true });
  if (_tpSelected.size < 10) _tpSelected.add(id);
  tpRefresh();
}

function tpRemoveCustom(id) {
  _tpAllPlayers = _tpAllPlayers.filter(p => p.steamid !== id);
  _tpSelected.delete(id);
  tpRefresh();
}

function tpGenerate() {
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  if (pool.length !== 10) return;

  const splits = [];
  for (let mask = 1; mask < (1 << 10); mask++) {
    if (popcount(mask) !== 5) continue;
    const mirror = ((1 << 10) - 1) ^ mask;
    if (mask > mirror) continue;
    const sumA = pool.reduce((s, p, i) => mask & (1 << i) ? s + (p.avg_rating ?? 0) : s, 0);
    const sumB = pool.reduce((s, p, i) => mask & (1 << i) ? s : s + (p.avg_rating ?? 0), 0);
    splits.push({ mask, diff: Math.abs(sumA - sumB) });
  }
  splits.sort((a, b) => a.diff - b.diff);

  _tpProposals = splits.slice(0, 6);
  _tpActiveTab = 0;
  document.getElementById('tp-result').innerHTML = buildTeamsHTML(pool);
}

function tpSwitchTab(idx) {
  _tpActiveTab = idx;
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  document.getElementById('tp-result').innerHTML = buildTeamsHTML(pool);
}

function buildTeamsHTML(pool) {
  if (!_tpProposals.length || pool.length !== 10) return '';

  const { mask, diff } = _tpProposals[_tpActiveTab];
  const teamA = pool.filter((_, i) =>  (mask & (1 << i)));
  const teamB = pool.filter((_, i) => !(mask & (1 << i)));
  const avgA  = (teamA.reduce((s, p) => s + (p.avg_rating ?? 0), 0) / 5).toFixed(4);
  const avgB  = (teamB.reduce((s, p) => s + (p.avg_rating ?? 0), 0) / 5).toFixed(4);

  const teamRows = (list) => [...list]
    .sort((a, b) => b.avg_rating - a.avg_rating)
    .map(p => `<div class="tp-team-row">
      <span>${esc(p.name || p.steamid)}</span>
      <span class="${rClass(p.avg_rating)}">${fmtRating(p.avg_rating)}</span>
    </div>`).join('');

  const tabs = _tpProposals.map((s, i) => `
    <button class="tp-tab${i === _tpActiveTab ? ' active' : ''}" onclick="tpSwitchTab(${i})">
      ${i === 0 ? 'Best' : `#${i + 1}`}
      <span class="tp-tab-diff">${s.diff.toFixed(3)}</span>
    </button>`).join('');

  return `<div class="tp-tabs">${tabs}</div>
  <div class="tp-teams">
    <div class="tp-team tp-team-a">
      <div class="tp-team-title">Team A</div>
      ${teamRows(teamA)}
      <div class="tp-team-avg">Avg rating: <strong>${avgA}</strong></div>
    </div>
    <div class="tp-team tp-team-b">
      <div class="tp-team-title">Team B</div>
      ${teamRows(teamB)}
      <div class="tp-team-avg">Avg rating: <strong>${avgB}</strong></div>
    </div>
  </div>
  <div class="tp-diff">Rating difference: <strong>${diff.toFixed(4)}</strong></div>`;
}
