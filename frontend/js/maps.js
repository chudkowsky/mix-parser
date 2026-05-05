// ── Maps page ─────────────────────────────────────────────────────────────────

async function renderMapsPage() {
  app.innerHTML = '<div class="loading">Ładowanie…</div>';
  let maps = [];
  try {
    maps = await fetch('/maps').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">Nie można połączyć z serwerem: ${e.message}</div>`;
    return;
  }

  const cards = maps.map(m => {
    const ctPct = m.ct_round_pct ?? 50;
    const tPct  = m.t_round_pct  ?? 50;

    const kingHtml = m.king
      ? `<div class="map-stat-row">
           <span class="map-stat-label">Król</span>
           <span class="map-stat-value map-king" onclick="event.stopPropagation(); navigate('player/${m.king.steamid}')"
             title="${esc(m.king.name)}">${esc(m.king.name)}</span>
           <span class="map-stat-aside">${fmtRating(m.king.avg_rating)}</span>
         </div>`
      : '';

    const mostHtml = m.most_played
      ? `<div class="map-stat-row">
           <span class="map-stat-label">Najczęściej grane przez: </span>
           <span class="map-stat-value" onclick="event.stopPropagation(); navigate('player/${m.most_played.steamid}')"
             style="cursor:pointer;color:var(--accent)" title="${esc(m.most_played.name)}">${esc(m.most_played.name)}</span>
           <span class="map-stat-aside">${m.most_played.matches_on_map}×</span>
         </div>`
      : '';

    return `<div class="map-card" style="cursor:pointer" onclick="navigate('maps/${encodeURIComponent(m.map_name)}')">
      <div class="map-card-img-wrap">
        <img class="map-card-img" src="/static/maps/${encodeURIComponent(m.map_name)}.png" alt=""
          onerror="this.parentElement.style.display='none'">
      </div>
      <div class="map-card-body">
        <div class="map-card-name">${esc(m.map_name)}</div>
        <div class="map-stat-row">
          <span class="map-stat-label">Gry</span>
          <span class="map-stat-value">${m.games_played}</span>
        </div>
        <div class="map-stat-row">
          <span class="map-stat-label">Rundy</span>
          <span class="map-stat-value">${m.total_rounds ?? '—'}</span>
        </div>
        ${kingHtml}
        ${mostHtml}
        <div class="map-side-bar" title="CT ${ctPct}% · T ${tPct}%">
          <div class="map-side-ct" style="width:${ctPct}%"></div>
          <div class="map-side-t"  style="width:${tPct}%"></div>
        </div>
        <div class="map-side-labels">
          <span class="map-side-label ct">CT ${ctPct}%</span>
          <span class="map-side-label t">T ${tPct}%</span>
        </div>
      </div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Rozegrane mapy</div>
      <div class="chart-wrap"><canvas id="chartMaps" height="220"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">Mapy</div>
      <div class="card-body">
        <div class="maps-grid">${cards}</div>
      </div>
    </div>`;

  const PALETTE = [
    '#F5C542','#7EB8D4','#4ADE80','#F87171','#b47fe8',
    '#FB923C','#00c9c8','#f06292','#aed581','#90a4ae',
  ];
  const mapNames  = maps.map(m => m.map_name.replace('de_', '').replace('cs_', ''));
  const mapCounts = maps.map(m => m.games_played);
  const mapColors = maps.map((_, i) => PALETTE[i % PALETTE.length]);

  if (_charts.maps) _charts.maps.destroy();
  _charts.maps = new Chart(document.getElementById('chartMaps'), {
    type: 'doughnut',
    data: {
      labels: mapNames,
      datasets: [{ data: mapCounts, backgroundColor: mapColors, borderColor: '#181e2c', borderWidth: 3, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#7a8aaa', font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: {
          backgroundColor: '#131824', borderColor: '#2e3850', borderWidth: 1,
          titleColor: '#F5C542', bodyColor: '#dde3f0',
          callbacks: { label: ctx => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return ` ${ctx.parsed} ${gamesWord(ctx.parsed)} (${Math.round(ctx.parsed / total * 100)}%)`;
          }},
        },
      },
    },
  });
}

function gamesWord(n) {
  const count = Number(n) || 0;
  if (count === 1) return 'gra';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'gry';
  return 'gier';
}

function meczWord(n) {
  const count = Number(n) || 0;
  if (count === 1) return 'mecz';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'mecze';
  return 'meczów';
}

async function renderMapDetail(mapName) {
  app.innerHTML = '<div class="loading">Ładowanie…</div>';
  let matches = [];
  try {
    matches = await fetch('/matches').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">Nie można połączyć z serwerem: ${e.message}</div>`;
    return;
  }

  const filtered = matches.filter(m => m.map_name === mapName);

  window._matchesAll = filtered;

  const img = `<img src="/static/maps/${encodeURIComponent(mapName)}.png" alt=""
    onerror="this.style.display='none'"
    style="width:100%;height:140px;object-fit:cover;display:block;opacity:0.7">`;

  const header = `<div class="grid-header">
    <span class="section-title">${esc(mapName)} <span style="font-weight:400;opacity:0.5">${filtered.length} ${gamesWord(filtered.length)}</span></span>
  </div>`;

  if (!filtered.length) {
    app.innerHTML = `<div class="card">${img}<div class="card-body">${header}<p class="empty-state">Brak meczów na tej mapie.</p></div></div>`;
    return;
  }

  const groupMap = new Map();
  for (const m of filtered) {
    const key = m.uploaded_at ? new Date(m.uploaded_at).toLocaleDateString('sv') : 'unknown';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(m);
  }

  const groupsHtml = [...groupMap.entries()].map(([key, items]) => `
    <div class="matches-day-group">
      <div class="matches-day-label">
        <span class="matches-day-name">${esc(dayLabel(key))}</span>
        <span class="matches-day-count">${items.length} ${meczWord(items.length)}</span>
      </div>
      <div class="matches-grid">${items.map(matchTile).join('')}</div>
    </div>`
  ).join('');

  app.innerHTML = `<div class="card">${img}<div class="card-body">${header}${groupsHtml}</div></div>`;
}
