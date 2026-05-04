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

  // Load titles if not already fetched (e.g. direct URL navigation)
  if (!Object.keys(_allTitles).length) {
    _allTitles = await fetch('/titles').then(r => r.json()).catch(() => ({}));
  }
  const playerTitles = _allTitles[steamid] || [];

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
    <div class="card-body" style="display:flex;align-items:center;gap:2rem;flex-wrap:wrap">
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

  const titlesHtml = playerTitles.length
    ? `<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.65rem">
        ${playerTitles.map(t => `<span class="player-title-badge" title="${esc(t.flavor_text || '')}">${esc(t.award_label)}<span class="player-title-season">${esc(t.season_name)}</span></span>`).join('')}
      </div>`
    : '';

  app.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div style="font-size:1.1rem;font-weight:700;color:var(--text);font-family:'Barlow Condensed',sans-serif;letter-spacing:.04em;text-transform:uppercase">${esc(data.name || steamid)}</div>
        ${titlesHtml}
        <div class="stat-row" style="flex-wrap:wrap;gap:.75rem;margin-top:1rem">${statCards}</div>
      </div>
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
        <div id="ratingRangeBtns" style="display:flex;gap:4px">
          ${[10,20,50,0].map((d,i) => `<button onclick="setRatingRange(${d})" data-range="${d}" style="padding:3px 10px;border:1px solid #2e3850;background:${i===0?'#F5C542':'transparent'};color:${i===0?'#000':'#7a8aaa'};font-weight:${i===0?'700':'normal'};font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:.08em;cursor:pointer">${d === 0 ? 'All' : 'Last '+d}</button>`).join('')}
        </div>
      </div>
      <div class="card-body" style="padding-bottom:0">
      <div style="display:flex;gap:18px;align-items:center;margin-bottom:12px">
        <span style="display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-sub)">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid #F5C542"></span>Rating
        </span>
        <span style="display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--text-sub)">
          <span style="display:inline-block;width:22px;height:0;border-top:2px dashed #4ADE80"></span>Threshold 1.2
        </span>
      </div>
      <div style="position:relative">
        <canvas id="chartPlayerRating" height="200"></canvas>
        <div id="playerRatingTooltip" style="position:absolute;pointer-events:none;background:#131824;border:1px solid #2e3850;padding:8px 12px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text);display:none;white-space:nowrap;z-index:10">
          <div id="prt-match" style="color:var(--text-muted);margin-bottom:2px"></div>
          <div id="prt-rating" style="color:#F5C542;font-weight:600;font-size:14px"></div>
        </div>
      </div>
      <div id="playerRatingStats" style="display:flex;gap:24px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border-sub);flex-wrap:wrap"></div>
      </div>
    </div>
    ${matchRows ? `<div class="card">
      <div class="card-title">Match History</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Map</th><th>Rating</th><th>CT/T</th><th>K/D</th><th>ADR</th><th>KAST</th><th>HS%</th><th>Flash</th><th>Clutch</th><th>MK</th></tr></thead>
        <tbody>${matchRows}</tbody>
      </table></div>
    </div>` : '<div class="card"><p class="empty-state" style="padding:2rem">No match history.</p></div>'}
  `;

  const mHistory = data.matches || [];
  if (mHistory.length > 0) {
    const THRESHOLD = 1.2;

    function updatePlayerStats(ratings) {
      const avg  = allCumulAvg[allCumulAvg.length - 1];
      const peak = Math.max(...ratings);
      const diff = avg - THRESHOLD;
      const trend = ratings[ratings.length - 1] - ratings[0];
      const el = document.getElementById('playerRatingStats');
      if (!el) return;
      el.innerHTML = [
        ['Current avg', avg.toFixed(2),  '#F5C542'],
        ['Peak',        peak.toFixed(2), '#dde3f0'],
        ['vs 1.2',      (diff >= 0 ? '+' : '') + diff.toFixed(2), diff >= 0 ? '#4ADE80' : '#F87171'],
        ['Trend',       (trend >= 0 ? '▲ ' : '▼ ') + Math.abs(trend).toFixed(2), trend >= 0 ? '#4ADE80' : '#F87171'],
      ].map(([lbl, val, col]) => `
        <div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#3e4e6a;margin-bottom:2px">${lbl}</div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;color:${col}">${val}</div>
        </div>`).join('');
    }

    const allRatings  = mHistory.map(m => parseFloat(m.rating) || 0);
    const allCumulAvg = allRatings.map((_, i) =>
      allRatings.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1)
    );

    function buildPlayerRatingChart(n) {
      const start   = (n === 0 || n >= mHistory.length) ? 0 : mHistory.length - n;
      const slice   = mHistory.slice(start);
      const ratings = allRatings.slice(start);
      const cumulAvg = allCumulAvg.slice(start);
      const M       = slice.length;

      document.querySelectorAll('#ratingRangeBtns button').forEach(btn => {
        const active = parseInt(btn.dataset.range) === n;
        btn.style.background  = active ? '#F5C542' : 'transparent';
        btn.style.color       = active ? '#000'    : '#7a8aaa';
        btn.style.borderColor = active ? '#F5C542' : '#2e3850';
        btn.style.fontWeight  = active ? '700'     : 'normal';
      });

      if (_charts.playerRating) _charts.playerRating.destroy();
      const canvas = document.getElementById('chartPlayerRating');
      if (!canvas) return;

      const gradFill = canvas.getContext('2d').createLinearGradient(0, 0, 0, 240);
      gradFill.addColorStop(0, 'rgba(245,197,66,0.18)');
      gradFill.addColorStop(1, 'rgba(245,197,66,0.00)');

      _charts.playerRating = new Chart(canvas, {
        type: 'line',
        data: {
          labels: cumulAvg.map((_, i) => i + 1),
          datasets: [
            {
              label: 'Overall avg',
              data: cumulAvg,
              borderColor: '#F5C542',
              borderWidth: 2.5,
              backgroundColor: gradFill,
              fill: true,
              tension: 0.45,
              pointBackgroundColor: cumulAvg.map(v => v >= THRESHOLD ? '#F5C542' : '#F87171'),
              pointBorderColor: '#131824',
              pointBorderWidth: 2,
              pointRadius: 5,
              pointHoverRadius: 8,
            },
            {
              label: 'Threshold',
              data: Array(M).fill(THRESHOLD),
              borderColor: '#4ADE80',
              borderWidth: 1.5,
              borderDash: [6, 4],
              pointRadius: 0,
              fill: false,
              tension: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 900, easing: 'easeInOutQuart' },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
          scales: {
            x: {
              grid: { color: 'rgba(255,255,255,0.04)' },
              ticks: { color: '#3e4e6a', font: { size: 11 } },
              title: { display: true, text: 'Match #', color: '#3e4e6a', font: { size: 11 } },
            },
            y: {
              min: 0.5,
              max: Math.max(2.0, Math.max(...cumulAvg) + 0.15),
              grid: { color: 'rgba(255,255,255,0.06)' },
              ticks: { color: '#3e4e6a', font: { size: 11 }, stepSize: 0.3, callback: v => v.toFixed(1) },
            },
          },
          onHover(evt, items) {
            const tt = document.getElementById('playerRatingTooltip');
            if (!items.length) { tt.style.display = 'none'; return; }
            const idx  = items[0].index;
            const meta = _charts.playerRating.getDatasetMeta(0).data[idx];
            const m    = slice[idx];
            const date = (m.uploaded_at || '').slice(0, 10);
            const map  = (m.map_name || '?').replace('de_', '');
            document.getElementById('prt-match').textContent  = `Match ${idx + 1}  ·  ${date}  ·  ${map}`;
            document.getElementById('prt-rating').textContent = `Avg: ${cumulAvg[idx].toFixed(2)}  (this match: ${ratings[idx].toFixed(2)})`;
            tt.style.display = 'block';
            tt.style.left    = (meta.x + 14) + 'px';
            tt.style.top     = Math.max(0, meta.y - 44) + 'px';
          },
        },
      });

      updatePlayerStats(cumulAvg);
    }

    window.setRatingRange = (n) => buildPlayerRatingChart(n);
    buildPlayerRatingChart(10);
  }
}
