// ── Charts ───────────────────────────────────────────────────────────────────

const _charts = {};

function chartsSection(stats, leaderboard) {
  if (!stats.player_history.length) return '';
  const rangeBtns = [10,20,50,0].map(n =>
    `<button onclick="setDashboardRange(${n})" data-range="${n}" style="padding:3px 10px;border-radius:4px;border:1px solid #2a2d38;background:#0d0d0d;color:#888;cursor:pointer;font-size:.78rem">${n === 0 ? 'All' : 'Last '+n}</button>`
  ).join('');
  return `<div class="charts-row">
    <div class="card" style="margin-bottom:0">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <span>Player Rating History</span>
        <div id="dashRangeBtns" style="display:flex;gap:4px">${rangeBtns}</div>
      </div>
      <div class="chart-wrap"><canvas id="chartRating" height="220"></canvas></div>
    </div>
    <div class="card" style="margin-bottom:0">
      <div class="card-title">Maps Played</div>
      <div class="chart-wrap"><canvas id="chartMaps" height="220"></canvas></div>
    </div>
  </div>`;
}

function renderCharts(stats, leaderboard) {
  if (!stats.player_history.length) return;

  const PALETTE = [
    '#f0a500','#5baeff','#4caf7d','#e05555','#b47fe8',
    '#ff8c42','#00c9c8','#f06292','#aed581','#90a4ae',
  ];

  // ── Rating history — cumulative avg per player ────────────────────────────
  const topPlayers = leaderboard.slice(0, 8).map(p => p.steamid);

  // group per-player matches in chronological order
  const playerMatches = {};
  for (const r of stats.player_history) {
    if (!topPlayers.includes(r.steamid)) continue;
    if (!playerMatches[r.steamid]) playerMatches[r.steamid] = { name: r.name, matches: [] };
    playerMatches[r.steamid].matches.push({ match_id: r.match_id, date: r.uploaded_at, rating: r.rating });
  }
  // ensure chronological order
  for (const sid of Object.keys(playerMatches)) {
    playerMatches[sid].matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  function buildRatingChart(n) {
    // slice each player to last n matches (0 = all)
    const sliced = {};
    for (const [sid, { name, matches }] of Object.entries(playerMatches)) {
      sliced[sid] = { name, matches: n === 0 ? matches : matches.slice(-n) };
    }

    // highlight active button
    document.querySelectorAll('#dashRangeBtns button').forEach(btn => {
      const active = parseInt(btn.dataset.range) === n;
      btn.style.background  = active ? '#f0a500' : '#0d0d0d';
      btn.style.color       = active ? '#000'    : '#888';
      btn.style.borderColor = active ? '#f0a500' : '#2a2d38';
      btn.style.fontWeight  = active ? '700'     : 'normal';
    });

    const lineDatasets = topPlayers
      .filter(sid => sliced[sid]?.matches.length)
      .map((sid, i) => {
        const { name, matches } = sliced[sid];
        const cumulAvg = matches.map((_, j) =>
          matches.slice(0, j + 1).reduce((s, m) => s + m.rating, 0) / (j + 1)
        );
        return {
          label: name,
          data: cumulAvg.map((a, j) => ({ x: j + 1, y: a })),
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length] + '22',
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          borderWidth: 2,
          type: 'line',
        };
      });

    if (_charts.rating) _charts.rating.destroy();
    const ctxR = document.getElementById('chartRating');
    if (!ctxR) return;
    _charts.rating = new Chart(ctxR, {
      type: 'scatter',
      data: { datasets: lineDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#888', font: { size: 11 }, boxWidth: 12, padding: 10 },
          },
          tooltip: {
            backgroundColor: '#1a1c24', borderColor: '#2a2d38', borderWidth: 1,
            titleColor: '#f0a500', bodyColor: '#ccc',
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? '—'}` },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: 0.5,
            title: { display: true, text: 'Match #', color: '#555', font: { size: 10 } },
            ticks: { color: '#666', font: { size: 11 }, precision: 0 },
            grid: { color: '#1e2030' },
          },
          y: {
            min: 0.5,
            max: 2.5,
            ticks: { color: '#666', font: { size: 11 }, stepSize: 0.25 },
            grid: { color: '#1e2030' },
          },
        },
      },
    });
  }

  window.setDashboardRange = (n) => buildRatingChart(n);
  buildRatingChart(10);

  // ── Map distribution donut ────────────────────────────────────────────────
  const mapNames  = Object.keys(stats.map_distribution);
  const mapCounts = Object.values(stats.map_distribution);
  const mapColors = mapNames.map((_, i) => PALETTE[i % PALETTE.length]);

  if (_charts.maps) _charts.maps.destroy();
  const ctxM = document.getElementById('chartMaps');
  if (!ctxM) return;
  _charts.maps = new Chart(ctxM, {
    type: 'doughnut',
    data: {
      labels: mapNames.map(n => n.replace('de_', '')),
      datasets: [{
        data: mapCounts,
        backgroundColor: mapColors,
        borderColor: '#0f1117',
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#888', font: { size: 11 }, boxWidth: 12, padding: 10 },
        },
        tooltip: {
          backgroundColor: '#1a1c24', borderColor: '#2a2d38', borderWidth: 1,
          titleColor: '#f0a500', bodyColor: '#ccc',
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = Math.round(ctx.parsed / total * 100);
              return ` ${ctx.parsed} match${ctx.parsed > 1 ? 'es' : ''} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}
