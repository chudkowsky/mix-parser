// ── Team Picker ───────────────────────────────────────────────────────────────

let _tpAllPlayers  = [];
let _tpSelected    = new Set();
let _tpCustomSeq   = 0;
let _tpProposals   = [];
let _tpActiveTab   = 0;
let _tpManualTeamA = null; // null = use proposal mask; otherwise Set of steamids
let _tpManualTeamB = null;

// Captain draft state
let _tpCaptainA   = null; // steamid of captain A
let _tpCaptainB   = null; // steamid of captain B
let _tpDraftTeamA = [];   // steamids assigned to team A (includes captainA)
let _tpDraftTeamB = [];   // steamids assigned to team B (includes captainB)

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

  const ready = count === 10;
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

    <div class="tp-action-row">
      <button class="tp-generate-btn" ${ready ? '' : 'disabled'} onclick="tpGenerate()">Generate Teams</button>
      <button class="tp-captain-btn" ${ready ? '' : 'disabled'} onclick="tpStartCaptainMode()">Captain Draft</button>
    </div>
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

// ── Generate mode ─────────────────────────────────────────────────────────────

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

  _tpProposals   = splits.slice(0, 6);
  _tpActiveTab   = 0;
  _tpManualTeamA = null;
  _tpManualTeamB = null;
  document.getElementById('tp-result').innerHTML = buildTeamsHTML(pool);
}

function tpSwitchTab(idx) {
  _tpActiveTab   = idx;
  _tpManualTeamA = null;
  _tpManualTeamB = null;
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  document.getElementById('tp-result').innerHTML = buildTeamsHTML(pool);
}

function tpMovePlayer(steamid) {
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  if (!_tpProposals.length || pool.length !== 10) return;

  if (!_tpManualTeamA) {
    const { mask } = _tpProposals[_tpActiveTab];
    _tpManualTeamA = new Set(pool.filter((_, i) =>  (mask & (1 << i))).map(p => p.steamid));
    _tpManualTeamB = new Set(pool.filter((_, i) => !(mask & (1 << i))).map(p => p.steamid));
  }

  if (_tpManualTeamA.has(steamid)) {
    _tpManualTeamA.delete(steamid);
    _tpManualTeamB.add(steamid);
  } else {
    _tpManualTeamB.delete(steamid);
    _tpManualTeamA.add(steamid);
  }

  document.getElementById('tp-result').innerHTML = buildTeamsHTML(pool);
}

function tpResetManual() {
  _tpManualTeamA = null;
  _tpManualTeamB = null;
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  document.getElementById('tp-result').innerHTML = buildTeamsHTML(pool);
}

function buildTeamsHTML(pool) {
  if (!_tpProposals.length || pool.length !== 10) return '';

  const isManual = !!_tpManualTeamA;
  let teamA, teamB, diff;

  if (isManual) {
    teamA = pool.filter(p => _tpManualTeamA.has(p.steamid));
    teamB = pool.filter(p => _tpManualTeamB.has(p.steamid));
    const sumA = teamA.reduce((s, p) => s + (p.avg_rating ?? 0), 0);
    const sumB = teamB.reduce((s, p) => s + (p.avg_rating ?? 0), 0);
    diff  = Math.abs(sumA - sumB);
  } else {
    const { mask } = _tpProposals[_tpActiveTab];
    diff  = _tpProposals[_tpActiveTab].diff;
    teamA = pool.filter((_, i) =>  (mask & (1 << i)));
    teamB = pool.filter((_, i) => !(mask & (1 << i)));
  }

  const avgA = (teamA.reduce((s, p) => s + (p.avg_rating ?? 0), 0) / (teamA.length || 1)).toFixed(4);
  const avgB = (teamB.reduce((s, p) => s + (p.avg_rating ?? 0), 0) / (teamB.length || 1)).toFixed(4);

  const teamRows = (list, targetLabel) => [...list]
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
    .map(p => `<div class="tp-team-row tp-team-row-movable" onclick="tpMovePlayer('${p.steamid}')" title="Move to ${targetLabel}">
      <span>${esc(p.name || p.steamid)}</span>
      <span class="${rClass(p.avg_rating)}">${fmtRating(p.avg_rating)}</span>
      <span class="tp-move-arrow">${targetLabel === 'Team B' ? '→' : '←'}</span>
    </div>`).join('');

  const tabs = _tpProposals.map((s, i) => `
    <button class="tp-tab${i === _tpActiveTab ? ' active' : ''}" onclick="tpSwitchTab(${i})">
      ${i === 0 ? 'Best' : `#${i + 1}`}
      <span class="tp-tab-diff">${s.diff.toFixed(3)}</span>
    </button>`).join('');

  const manualBadge = isManual
    ? `<button class="tp-reset-btn" onclick="tpResetManual()">↺ Reset</button>`
    : '';

  return `<div class="tp-tabs">${tabs}${manualBadge}</div>
  <div class="tp-teams">
    <div class="tp-team tp-team-a">
      <div class="tp-team-title">Team A</div>
      ${teamRows(teamA, 'Team B')}
      <div class="tp-team-avg">Avg rating: <strong>${avgA}</strong></div>
    </div>
    <div class="tp-team tp-team-b">
      <div class="tp-team-title">Team B</div>
      ${teamRows(teamB, 'Team A')}
      <div class="tp-team-avg">Avg rating: <strong>${avgB}</strong></div>
    </div>
  </div>
  <div class="tp-diff">Rating difference: <strong>${diff.toFixed(4)}</strong>${isManual ? ' <span class="tp-manual-tag">adjusted</span>' : ''}</div>`;
}

// ── Captain draft mode ────────────────────────────────────────────────────────

function tpStartCaptainMode() {
  _tpCaptainA   = null;
  _tpCaptainB   = null;
  _tpDraftTeamA = [];
  _tpDraftTeamB = [];
  _tpProposals  = [];
  renderCaptainPicker();
}

function tpExitCaptainMode() {
  _tpCaptainA   = null;
  _tpCaptainB   = null;
  _tpDraftTeamA = [];
  _tpDraftTeamB = [];
  document.getElementById('tp-result').innerHTML = '';
}

function renderCaptainPicker() {
  const pool = [..._tpAllPlayers]
    .filter(p => _tpSelected.has(p.steamid))
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));

  const rows = pool.map(p => {
    const isA = _tpCaptainA === p.steamid;
    const isB = _tpCaptainB === p.steamid;
    return `<div class="tp-cap-row${isA ? ' cap-a' : isB ? ' cap-b' : ''}" onclick="tpPickCaptain('${p.steamid}')">
      <span class="tp-cap-badge">${isA ? 'A' : isB ? 'B' : ''}</span>
      <span class="tp-cap-name">${esc(p.name || p.steamid)}</span>
      <span class="${rClass(p.avg_rating)}">${fmtRating(p.avg_rating)}</span>
    </div>`;
  }).join('');

  const bothPicked = _tpCaptainA && _tpCaptainB;

  document.getElementById('tp-result').innerHTML = `
    <div class="tp-cap-header">
      <span class="tp-cap-header-label">Pick 2 captains</span>
      <button class="tp-reset-btn" onclick="tpExitCaptainMode()">✕ Cancel</button>
    </div>
    <div class="tp-cap-list">${rows}</div>
    ${bothPicked ? `<button class="tp-generate-btn" style="margin-top:0.75rem" onclick="tpStartDraft()">Start Draft →</button>` : ''}`;
}

function tpPickCaptain(steamid) {
  if (_tpCaptainA === steamid)      { _tpCaptainA = null; }
  else if (_tpCaptainB === steamid) { _tpCaptainB = null; }
  else if (!_tpCaptainA)            { _tpCaptainA = steamid; }
  else if (!_tpCaptainB)            { _tpCaptainB = steamid; }
  renderCaptainPicker();
}

function tpStartDraft() {
  _tpDraftTeamA = [_tpCaptainA];
  _tpDraftTeamB = [_tpCaptainB];
  renderDraftBoard();
}

function tpDraftDragStart(ev, steamid) {
  ev.dataTransfer.setData('text/plain', steamid);
  ev.dataTransfer.effectAllowed = 'move';
}

function tpDraftDragOver(ev) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('drag-over');
}

function tpDraftDragLeave(ev) {
  ev.currentTarget.classList.remove('drag-over');
}

function tpDraftDrop(ev, target) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  const steamid = ev.dataTransfer.getData('text/plain');
  if (!steamid) return;

  // Captains cannot leave their team
  if (steamid === _tpCaptainA && target !== 'A') return;
  if (steamid === _tpCaptainB && target !== 'B') return;

  _tpDraftTeamA = _tpDraftTeamA.filter(id => id !== steamid);
  _tpDraftTeamB = _tpDraftTeamB.filter(id => id !== steamid);

  if (target === 'A') _tpDraftTeamA.push(steamid);
  else if (target === 'B') _tpDraftTeamB.push(steamid);
  // target === 'pool' → player just returns to undrafted

  renderDraftBoard();
}

function renderDraftBoard() {
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  const allDrafted = new Set([..._tpDraftTeamA, ..._tpDraftTeamB]);
  const undrafted  = pool
    .filter(p => !allDrafted.has(p.steamid))
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));

  const playerCard = (p, draggable) => {
    const isCap = p.steamid === _tpCaptainA || p.steamid === _tpCaptainB;
    const drag  = draggable && !isCap;
    return `<div class="tp-draft-card${isCap ? ' tp-draft-captain' : ''}"
      ${drag ? `draggable="true" ondragstart="tpDraftDragStart(event,'${p.steamid}')"` : ''}>
      ${isCap ? '<span class="tp-cap-label">CAP</span>' : ''}
      <span class="tp-draft-name">${esc(p.name || p.steamid)}</span>
      <span class="${rClass(p.avg_rating)}">${fmtRating(p.avg_rating)}</span>
    </div>`;
  };

  const sortTeam = ids => ids
    .map(id => pool.find(p => p.steamid === id))
    .filter(Boolean)
    .sort((a, b) => {
      const aIsCap = a.steamid === _tpCaptainA || a.steamid === _tpCaptainB;
      const bIsCap = b.steamid === _tpCaptainA || b.steamid === _tpCaptainB;
      if (aIsCap && !bIsCap) return -1;
      if (!aIsCap && bIsCap) return  1;
      return (b.avg_rating ?? 0) - (a.avg_rating ?? 0);
    });

  const avgOf = ids => {
    const players = ids.map(id => pool.find(p => p.steamid === id)).filter(Boolean);
    if (!players.length) return '—';
    return (players.reduce((s, p) => s + (p.avg_rating ?? 0), 0) / players.length).toFixed(3);
  };

  const remaining = 10 - _tpDraftTeamA.length - _tpDraftTeamB.length;
  const done = remaining === 0;

  let diffHTML = '';
  if (done) {
    const playersA = _tpDraftTeamA.map(id => pool.find(p => p.steamid === id)).filter(Boolean);
    const playersB = _tpDraftTeamB.map(id => pool.find(p => p.steamid === id)).filter(Boolean);
    const diff = Math.abs(
      playersA.reduce((s, p) => s + (p.avg_rating ?? 0), 0) -
      playersB.reduce((s, p) => s + (p.avg_rating ?? 0), 0)
    );
    diffHTML = `<div class="tp-diff">Rating difference: <strong>${diff.toFixed(4)}</strong></div>`;
  }

  document.getElementById('tp-result').innerHTML = `
    <div class="tp-cap-header">
      <span class="tp-cap-header-label">${done ? 'Draft complete' : `${remaining} player${remaining !== 1 ? 's' : ''} remaining — drag to a team`}</span>
      <button class="tp-reset-btn" onclick="tpStartCaptainMode()">↺ Repick captains</button>
      <button class="tp-reset-btn" onclick="tpExitCaptainMode()">✕ Cancel</button>
    </div>
    <div class="tp-draft-board">
      <div class="tp-draft-zone tp-draft-zone-a"
        ondragover="tpDraftDragOver(event)" ondragleave="tpDraftDragLeave(event)" ondrop="tpDraftDrop(event,'A')">
        <div class="tp-team-title" style="color:#5baeff">Team A <span class="tp-draft-count">${_tpDraftTeamA.length}/5</span></div>
        ${sortTeam(_tpDraftTeamA).map(p => playerCard(p, true)).join('')}
        <div class="tp-team-avg">Avg: <strong>${avgOf(_tpDraftTeamA)}</strong></div>
      </div>

      <div class="tp-draft-pool"
        ondragover="tpDraftDragOver(event)" ondragleave="tpDraftDragLeave(event)" ondrop="tpDraftDrop(event,'pool')">
        <div class="tp-draft-pool-header">
          <div class="tp-team-title" style="color:var(--muted)">Undrafted</div>
          ${undrafted.length >= 2 ? `<button class="tp-spin-btn" onclick="tpShowDraftWheel()">🎡 Spin</button>` : ''}
        </div>
        ${undrafted.length
          ? undrafted.map(p => playerCard(p, true)).join('')
          : `<div class="tp-draft-empty">All players drafted</div>`}
      </div>

      <div class="tp-draft-zone tp-draft-zone-b"
        ondragover="tpDraftDragOver(event)" ondragleave="tpDraftDragLeave(event)" ondrop="tpDraftDrop(event,'B')">
        <div class="tp-team-title" style="color:#f0a500">Team B <span class="tp-draft-count">${_tpDraftTeamB.length}/5</span></div>
        ${sortTeam(_tpDraftTeamB).map(p => playerCard(p, true)).join('')}
        <div class="tp-team-avg">Avg: <strong>${avgOf(_tpDraftTeamB)}</strong></div>
      </div>
    </div>
    ${diffHTML}`;
}

// ── Spinning wheel ────────────────────────────────────────────────────────────

const WHEEL_COLORS = [
  '#5baeff','#f0a500','#4caf7d','#e05555',
  '#9b59b6','#1abc9c','#e67e22','#e91e63',
  '#00bcd4','#8bc34a',
];

let _tpWheelPlayers  = [];
let _tpWheelAngle    = 0;
let _tpWheelSpinning = false;
let _tpWheelRafId    = null;

function tpShowDraftWheel() {
  const pool = _tpAllPlayers.filter(p => _tpSelected.has(p.steamid));
  const allDrafted = new Set([..._tpDraftTeamA, ..._tpDraftTeamB]);
  const undrafted  = pool.filter(p => !allDrafted.has(p.steamid));
  if (undrafted.length < 2) return;
  tpShowWheel(undrafted);
}

function tpShowWheel(players) {
  _tpWheelPlayers  = players;
  _tpWheelAngle    = 0;
  _tpWheelSpinning = false;
  if (_tpWheelRafId) { cancelAnimationFrame(_tpWheelRafId); _tpWheelRafId = null; }

  const modal = document.createElement('div');
  modal.id = 'tp-wheel-modal';
  modal.innerHTML = `
    <div class="tp-wheel-backdrop" onclick="tpCloseWheel()"></div>
    <div class="tp-wheel-dialog">
      <div class="tp-wheel-header">
        <span>Spin the Wheel</span>
        <button class="tp-reset-btn" onclick="tpCloseWheel()">✕ Close</button>
      </div>
      <div class="tp-wheel-wrap">
        <div class="tp-wheel-pointer"></div>
        <canvas id="tp-wheel-canvas" width="320" height="320"></canvas>
      </div>
      <div id="tp-wheel-result" class="tp-wheel-result"></div>
      <button class="tp-generate-btn" id="tp-wheel-spin-btn" onclick="tpSpinWheel()" style="width:100%">Spin!</button>
    </div>`;
  document.body.appendChild(modal);
  tpDrawWheel();
}

function tpCloseWheel() {
  if (_tpWheelRafId) { cancelAnimationFrame(_tpWheelRafId); _tpWheelRafId = null; }
  _tpWheelSpinning = false;
  const modal = document.getElementById('tp-wheel-modal');
  if (modal) modal.remove();
}

function tpDrawWheel() {
  const canvas = document.getElementById('tp-wheel-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const n   = _tpWheelPlayers.length;
  const cx  = canvas.width  / 2;
  const cy  = canvas.height / 2;
  const r   = cx - 8;
  const seg = (2 * Math.PI) / n;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < n; i++) {
    const start = _tpWheelAngle + i * seg - Math.PI / 2;
    const end   = start + seg;

    // Segment
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#0d0f14';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    const mid = start + seg / 2;
    const tx  = cx + Math.cos(mid) * r * 0.64;
    const ty  = cy + Math.sin(mid) * r * 0.64;
    const name = _tpWheelPlayers[i].name || _tpWheelPlayers[i].steamid;
    const label = name.length > 11 ? name.slice(0, 10) + '…' : name;

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${n > 6 ? 10 : 12}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  // Center cap
  ctx.beginPath();
  ctx.arc(cx, cy, 16, 0, 2 * Math.PI);
  ctx.fillStyle = '#0d0f14';
  ctx.fill();
  ctx.strokeStyle = '#2a2d3e';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function tpSpinWheel() {
  if (_tpWheelSpinning) return;
  _tpWheelSpinning = true;

  const n          = _tpWheelPlayers.length;
  const seg        = (2 * Math.PI) / n;
  const winnerIdx  = Math.floor(Math.random() * n);

  // Calculate target angle so the center of the winner's segment lands at the top pointer
  // Segment i center is at top when: _tpWheelAngle + i*seg + seg/2 ≡ 0 (mod 2π)
  const desired     = -(winnerIdx * seg + seg / 2);
  const currentMod  = ((  _tpWheelAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const desiredMod  = ((desired          % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const delta       = ((desiredMod - currentMod) + 2 * Math.PI) % (2 * Math.PI);
  const spins       = 6 + Math.floor(Math.random() * 5);
  const targetAngle = _tpWheelAngle + 2 * Math.PI * spins + delta;

  const startAngle  = _tpWheelAngle;
  const startTime   = performance.now();
  const duration    = 4000 + Math.random() * 2000;

  document.getElementById('tp-wheel-result').innerHTML = '';
  document.getElementById('tp-wheel-spin-btn').disabled = true;

  const animate = now => {
    const t      = Math.min((now - startTime) / duration, 1);
    const eased  = 1 - Math.pow(1 - t, 4); // ease-out quartic
    _tpWheelAngle = startAngle + (targetAngle - startAngle) * eased;
    tpDrawWheel();

    if (t < 1) {
      _tpWheelRafId = requestAnimationFrame(animate);
    } else {
      _tpWheelSpinning = false;
      const winner = _tpWheelPlayers[winnerIdx];
      document.getElementById('tp-wheel-result').innerHTML =
        `<div class="tp-wheel-winner">🎉 ${esc(winner.name || winner.steamid)}!</div>`;
      document.getElementById('tp-wheel-spin-btn').disabled = false;
      document.getElementById('tp-wheel-spin-btn').textContent = 'Spin again';
    }
  };

  _tpWheelRafId = requestAnimationFrame(animate);
}
