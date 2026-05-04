// ── Seasons list ──────────────────────────────────────────────────────────────

async function renderSeasonsList() {
  app.innerHTML = '<div class="loading">Loading seasons…</div>';

  let seasons;
  try {
    seasons = await fetch('/seasons').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }

  if (!seasons.length) {
    app.innerHTML = `<div class="card"><div class="card-title">Seasons</div><p class="empty-state">No seasons yet.</p></div>`;
    return;
  }

  const cards = seasons.map(s => {
    const start  = fmtDate(s.start_date);
    const end    = s.end_date ? fmtDate(s.end_date) : 'Ongoing';
    const badge  = s.is_active
      ? `<span class="seasons-list-live">LIVE</span>`
      : '';
    return `<div class="seasons-list-card" onclick="navigate('season/${s.id}')">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.4rem">
        <span style="font-size:1rem;font-weight:700;color:var(--text)">${esc(s.name)}</span>
        ${badge}
      </div>
      <div style="font-size:.8rem;color:var(--text-dim)">${start} — ${end}</div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="card-title">Seasons</div>
      <div class="seasons-list">${cards}</div>
    </div>`;
}

// ── Season Summary ─────────────────────────────────────────────────────────────

async function renderSeasonSummary(seasonId) {
  app.innerHTML = '<div class="loading">Loading season…</div>';

  let data;
  try {
    const res = await fetch(`/seasons/${seasonId}/summary`);
    if (!res.ok) { app.innerHTML = '<div class="error">Season not found.</div>'; return; }
    data = await res.json();
  } catch (e) {
    app.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }

  const { season, top_players = [], awards = [], stats } = data;
  const startDate = fmtDate(season.start_date);
  const endDate   = season.end_date ? fmtDate(season.end_date) : 'Ongoing';
  const statusTag = season.is_active
    ? `<span style="font-size:.72rem;background:#1a3a1f;color:var(--green);border:1px solid var(--green);border-radius:4px;padding:.1rem .5rem;margin-left:.6rem">LIVE</span>`
    : '';

  const awardCards = awards.map(a => `
    <div class="award-card">
      <div class="award-label">${esc(a.award_label)}</div>
      <div class="award-player" onclick="navigate('player/${a.steamid}')">${esc(a.player_name || a.steamid)}</div>
      <div class="award-flavor">${esc(a.flavor_text || '')}</div>
      ${a.stat_value ? `<div class="award-stat">${esc(a.stat_value)}</div>` : ''}
    </div>`).join('');

  const topRows = top_players.map((p, i) => {
    const kd = p.total_deaths ? (p.total_kills / p.total_deaths).toFixed(2) : '—';
    return `<tr>
      <td class="rank">#${i + 1}</td>
      <td class="player-name" style="cursor:pointer;color:var(--accent)" onclick="navigate('player/${p.steamid}')">
        ${esc(p.name || p.steamid)}
      </td>
      <td>${fmtRating(p.avg_rating)}</td>
      <td>${p.avg_adr ?? '—'}</td>
      <td>${p.avg_kast != null ? p.avg_kast + '%' : '—'}</td>
      <td class="kd">${kd}</td>
      <td class="matches-count">${p.matches_played}</td>
    </tr>`;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="season-hero">
        <div>
          <div class="card-title" style="font-size:1rem;letter-spacing:.04em;margin-bottom:.25rem">
            ${esc(season.name)}${statusTag}
          </div>
          <div class="season-hero-meta">${startDate} — ${endDate}</div>
        </div>
        <div class="season-hero-stats">
          <div>
            <div class="season-hero-stat-num">${stats.total_matches}</div>
            <div class="season-hero-stat-lbl">Matches</div>
          </div>
          <div>
            <div class="season-hero-stat-num">${stats.total_players}</div>
            <div class="season-hero-stat-lbl">Players</div>
          </div>
        </div>
      </div>
    </div>

    ${awards.length ? `
    <div class="card">
      <div class="card-title">Hall of Fame</div>
      <div class="awards-grid">${awardCards}</div>
    </div>` : (season.is_active ? '' : '<div class="card"><p class="empty-state">No awards for this season.</p></div>')}

    ${top_players.length ? `
    <div class="card">
      <div class="card-title">Top Players</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Player</th><th>Rating</th><th>ADR</th><th>KAST</th><th>K/D</th><th>Maps</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table>
      </div>
    </div>` : '<div class="card"><p class="empty-state">No matches in this season yet.</p></div>'}
  `;
}
