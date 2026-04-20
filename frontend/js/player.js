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
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <span>Rating Trend</span>
        <div style="display:flex;align-items:center;gap:8px;font-size:.8rem;font-weight:normal;color:#888">
          <label for="ratingSmoothing">Smoothing:</label>
          <input type="range" id="ratingSmoothing" min="1" max="10" value="5" style="width:110px;accent-color:#f0a500;cursor:pointer">
          <span id="ratingSmoothingLabel" style="color:#f0a500;min-width:60px">5 matches</span>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartPlayerRating" height="200"></canvas></div>
    </div>
    ${matchRows ? `<div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Map</th><th>Rating</th><th>CT/T</th><th>K/D</th><th>ADR</th><th>KAST</th><th>HS%</th><th>Flash</th><th>Clutch</th><th>MK</th></tr></thead>
        <tbody>${matchRows}</tbody>
      </table></div>
    </div>` : '<div class="card"><p class="empty-state">No match history.</p></div>'}
  `;

  const mHistory = [...(data.matches || [])].reverse(); // oldest first
  if (mHistory.length > 0) {
    const ratings = mHistory.map(m => parseFloat(m.rating) || 0);
    const N = ratings.length;
    const refLine = Array.from({ length: N }, (_, i) => ({ x: i + 1, y: 1.2 }));

    function rollingAvg(arr, w) {
      return arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i - w + 1), i + 1);
        return slice.reduce((s, v) => s + v, 0) / slice.length;
      });
    }

    function buildPlayerRatingChart(w) {
      const avgs = rollingAvg(ratings, w);
      if (_charts.playerRating) _charts.playerRating.destroy();
      const canvas = document.getElementById('chartPlayerRating');
      if (!canvas) return;
      _charts.playerRating = new Chart(canvas, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: w === 1 ? 'Per-match' : `${w}-match avg`,
              data: avgs.map((a, i) => ({ x: i + 1, y: a })),
              type: 'line',
              borderColor: '#f0a500',
              backgroundColor: 'rgba(240,165,0,0.06)',
              borderWidth: 2.5,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: '#f0a500',
              tension: 0.35,
              fill: false,
              order: 1,
            },
            {
              label: 'Threshold 1.2',
              data: refLine,
              type: 'line',
              borderColor: 'rgba(100,200,100,0.45)',
              borderWidth: 1.5,
              borderDash: [6, 5],
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: false,
              order: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 180 },
          interaction: { mode: 'index', axis: 'x', intersect: false },
          plugins: {
            legend: {
              labels: { color: '#666', usePointStyle: true, pointStyleWidth: 10, font: { size: 11 } },
            },
            tooltip: {
              backgroundColor: '#1a1c24',
              borderColor: '#2a2d38',
              borderWidth: 1,
              titleColor: '#f0a500',
              bodyColor: '#aaa',
              callbacks: {
                title(items) {
                  const i = items[0].dataIndex;
                  const m = mHistory[i];
                  const date = (m.uploaded_at || '').slice(0, 10);
                  const map  = (m.map_name || '?').replace('de_', '');
                  return `#${i + 1}  ·  ${date}  ·  ${map}`;
                },
                label(item) {
                  if (item.datasetIndex === 0) return ` Avg (${w}m): ${item.parsed.y.toFixed(2)}`;
                  return null;
                },
                filter: item => item.datasetIndex !== 1,
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              min: 0.5,
              max: N + 0.5,
              title: { display: true, text: 'Match #', color: '#555', font: { size: 10 } },
              ticks: { color: '#555', font: { size: 10 }, stepSize: Math.max(1, Math.floor(N / 15)), precision: 0 },
              grid: { color: '#1e2030' },
            },
            y: {
              min: 0.5,
              max: 2.5,
              ticks: { color: '#555', font: { size: 10 }, stepSize: 0.25 },
              grid: { color: '#1e2030' },
            },
          },
        },
      });
    }

    const slider = document.getElementById('ratingSmoothing');
    const sliderLabel = document.getElementById('ratingSmoothingLabel');
    if (slider) {
      slider.max = Math.min(10, N);
      slider.oninput = () => {
        const w = parseInt(slider.value);
        sliderLabel.textContent = `${w} match${w !== 1 ? 'es' : ''}`;
        buildPlayerRatingChart(w);
      };
    }
    buildPlayerRatingChart(parseInt(slider?.value ?? 5));
  }
}
