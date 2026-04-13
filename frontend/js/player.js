// ── Player Profile ────────────────────────────────────────────────────────────

async function renderPlayerProfile(steamid) {
  app.innerHTML = '<div class="loading">Loading player…</div>';

  let data;
  try {
    const res = await fetch(`/players/${encodeURIComponent(steamid)}`);
    if (!res.ok) { app.innerHTML = `<div class="error">Player not found.</div>`; return; }
    data = await res.json();
  } catch (e) {
    app.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }

  const fav = (data.map_stats || [])[0];
  const kd  = data.total_deaths ? (data.total_kills / data.total_deaths).toFixed(2) : '—';
  const openPct = data.total_opening_attempts
    ? Math.round(data.total_opening_kills / data.total_opening_attempts * 100) + '%'
    : '—';
  const clutchPct = data.total_clutch_total
    ? `${data.total_clutch_won}/${data.total_clutch_total} (${Math.round(data.total_clutch_won / data.total_clutch_total * 100)}%)`
    : '—';
  const avgFlash = data.total_flash_enemies != null
    ? (data.total_flash_enemies / (data.matches_played || 1)).toFixed(1)
    : '—';

  const statCards = [
    ['Rating',       fmtRating(data.avg_rating)],
    ['ADR',          data.avg_adr ?? '—'],
    ['KAST',         data.avg_kast != null ? data.avg_kast + '%' : '—'],
    ['HS%',          data.avg_hs_pct != null ? data.avg_hs_pct + '%' : '—'],
    ['K/D',          kd],
    ['Opening%',     openPct],
    ['Clutch',       clutchPct],
    ['Avg Flashed',  avgFlash + '/match'],
    ['🔪 Knife',     data.total_knife_kills || 0],
    ['⚡ Zeus',      data.total_zeus_kills  || 0],
    ['Maps played',  data.matches_played ?? 0],
    ['Total rounds', data.total_rounds ?? 0],
  ].map(([lbl, val]) => `<div class="stat"><div class="num">${val}</div><div class="lbl">${lbl}</div></div>`).join('');

  const favSection = fav ? `<div class="card">
    <div class="card-title">Favourite Map</div>
    <div style="display:flex;align-items:center;gap:2rem;flex-wrap:wrap">
      <span style="font-size:1.4rem;font-weight:700;color:var(--accent)">${esc(fav.map_name || '—').replace('de_', '')}</span>
      <div class="stat-row" style="gap:1.5rem;margin:0">
        <div class="stat"><div class="num">${fmtRating(fav.avg_rating)}</div><div class="lbl">Rating</div></div>
        <div class="stat"><div class="num">${fav.avg_adr ?? '—'}</div><div class="lbl">ADR</div></div>
        <div class="stat"><div class="num">${fav.avg_kast != null ? fav.avg_kast + '%' : '—'}</div><div class="lbl">KAST</div></div>
        <div class="stat"><div class="num">${fav.avg_hs_pct != null ? fav.avg_hs_pct + '%' : '—'}</div><div class="lbl">HS%</div></div>
        <div class="stat"><div class="num">${fav.matches ?? 0}</div><div class="lbl">Matches</div></div>
      </div>
    </div>
  </div>` : '';

  const mapRows = (data.map_stats || []).map(m => {
    const mkd = m.total_deaths ? (m.total_kills / m.total_deaths).toFixed(2) : '—';
    return `<tr>
      <td>${esc(m.map_name || '—')}</td>
      <td>${m.matches}</td>
      <td>${fmtRating(m.avg_rating)}</td>
      <td>${m.avg_adr ?? '—'}</td>
      <td>${m.avg_kast != null ? m.avg_kast + '%' : '—'}</td>
      <td>${m.avg_hs_pct != null ? m.avg_hs_pct + '%' : '—'}</td>
      <td class="kd">${m.total_kills}/${m.total_deaths}</td>
      <td>${m.total_flash_enemies ?? '—'}</td>
    </tr>`;
  }).join('');

  const matchRows = (data.matches || []).slice().reverse().map(m => {
    const mk  = typeof m.multi_kills === 'string' ? JSON.parse(m.multi_kills || '{}') : (m.multi_kills || {});
    const ctR = m.ct_rounds > 0 ? `<span class="${rClass(m.ct_rating)}" style="font-size:.72rem">CT ${m.ct_rating?.toFixed(2) ?? '—'}</span>` : '';
    const tR  = m.t_rounds  > 0 ? `<span class="${rClass(m.t_rating)}"  style="font-size:.72rem">T ${m.t_rating?.toFixed(2) ?? '—'}</span>`  : '';
    return `<tr onclick="navigate('match/${m.match_id}')" style="cursor:pointer">
      <td>${fmtDate(m.uploaded_at)}</td>
      <td>${esc(m.map_name || '—')}</td>
      <td>${fmtRating(m.rating)}</td>
      <td>${ctR} ${tR}</td>
      <td class="kd">${m.kills}/${m.deaths}</td>
      <td>${m.adr ?? '—'}</td>
      <td>${m.kast != null ? m.kast + '%' : '—'}</td>
      <td>${m.hs_pct != null ? m.hs_pct + '%' : '—'}</td>
      <td>${m.flash_enemies || '—'}</td>
      <td>${m.clutch_total ? `${m.clutch_won}/${m.clutch_total}` : '—'}</td>
      <td>${mkBadges(mk)}</td>
    </tr>`;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="card-title" style="font-size:.9rem">${esc(data.name || steamid)}</div>
      <div class="stat-row" style="flex-wrap:wrap;gap:.75rem">${statCards}</div>
    </div>
    ${favSection}
    ${mapRows ? `<div class="card">
      <div class="card-title">Map Breakdown</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Map</th><th>Matches</th><th>Rating</th><th>ADR</th><th>KAST</th><th>HS%</th><th>K/D</th><th>Flashes</th></tr></thead>
        <tbody>${mapRows}</tbody>
      </table></div>
    </div>` : ''}
    <div class="card">
      <div class="card-title">Match History (newest first)</div>
      <div class="chart-wrap"><canvas id="chartPlayerRating" height="200"></canvas></div>
    </div>
    ${matchRows ? `<div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Map</th><th>Rating</th><th>CT/T</th><th>K/D</th><th>ADR</th><th>KAST</th><th>HS%</th><th>Flash</th><th>Clutch</th><th>MK</th></tr></thead>
        <tbody>${matchRows}</tbody>
      </table></div>
    </div>` : '<div class="card"><p class="empty-state">No match history.</p></div>'}
  `;

  const mHistory = (data.matches || []);
  if (mHistory.length > 0) {
    const labels  = mHistory.map(m => `${(m.map_name || '?').replace('de_', '')} #${m.match_id}`);
    const ratings = mHistory.map(m => m.rating);
    if (_charts.playerRating) _charts.playerRating.destroy();
    const ctx = document.getElementById('chartPlayerRating');
    if (ctx) {
      _charts.playerRating = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: data.name || steamid,
            data: ratings,
            borderColor: '#f0a500',
            backgroundColor: '#f0a50022',
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7,
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1a1c24', borderColor: '#2a2d38', borderWidth: 1,
              titleColor: '#f0a500', bodyColor: '#ccc',
              callbacks: { label: ctx => ` Rating: ${ctx.parsed.y?.toFixed(2) ?? '—'}` },
            },
          },
          scales: {
            x: { ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1e2030' } },
            y: { min: 0, ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1e2030' } },
          },
        },
      });
    }
  }
}
