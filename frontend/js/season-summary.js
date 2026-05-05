// ── Seasons list ──────────────────────────────────────────────────────────────

async function renderSeasonsList() {
  app.innerHTML = '<div class="loading">Ładowanie sezonów…</div>';

  let seasons;
  try {
    seasons = await fetch('/seasons').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }

  if (!seasons.length) {
    app.innerHTML = `<div class="card"><div class="card-title">Sezony</div><p class="empty-state">Brak sezonów.</p></div>`;
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
      <div class="card-title">Sezony</div>
      <div class="card-body"><div class="seasons-list">${cards}</div></div>
    </div>`;
}

// ── Season Summary ─────────────────────────────────────────────────────────────

async function renderSeasonSummary(seasonId) {
  app.innerHTML = '<div class="loading">Ładowanie sezonu…</div>';

  let data;
  try {
    const res = await fetch(`/seasons/${seasonId}/summary`);
    if (!res.ok) { app.innerHTML = '<div class="error">Sezon nie znaleziony.</div>'; return; }
    data = await res.json();
  } catch (e) {
    app.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }

  const { season, top_players = [], awards = [], stats } = data;
  const startDate = fmtDate(season.start_date);
  const endDate   = season.end_date ? fmtDate(season.end_date) : 'Trwa';
  const statusTag = season.is_active
    ? `<span class="seasons-list-live" style="margin-left:.6rem">NA ŻYWO</span>`
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
      <div class="card-title" style="justify-content:space-between">
        <span>${esc(season.name)}${statusTag}</span>
        <div class="season-hero-stats" style="font-size:inherit">
          <div style="text-align:right">
            <div class="season-hero-stat-num">${stats.total_matches}</div>
            <div class="season-hero-stat-lbl">Mecze</div>
          </div>
          <div style="text-align:right">
            <div class="season-hero-stat-num">${stats.total_players}</div>
            <div class="season-hero-stat-lbl">Gracze</div>
          </div>
        </div>
      </div>
      <div class="card-body" style="padding-top:8px">
        <div class="season-hero-meta">${startDate} — ${endDate}</div>
      </div>
    </div>

    ${awards.length ? `
    <div class="card">
      <div class="card-title">Galeria Sławy</div>
      <div class="card-body"><div class="awards-grid">${awardCards}</div></div>
    </div>` : (season.is_active ? '' : '<div class="card"><p class="empty-state">Brak nagród dla tego sezonu.</p></div>')}

    ${top_players.length ? `
    <div class="card">
      <div class="card-title">Najlepsi gracze</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th></th><th>Gracz</th><th>Ocena</th><th>ADR</th><th>KAST</th><th>K/D</th><th>Mapy</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table>
      </div>
    </div>` : '<div class="card"><p class="empty-state">Brak meczów w tym sezonie.</p></div>'}
  `;
}
