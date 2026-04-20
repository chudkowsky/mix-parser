// ── Charts ───────────────────────────────────────────────────────────────────

const _charts = {};

function chartsSection(stats, leaderboard) {
  if (!stats.player_history.length) return '';
  return `<div class="charts-row">
    <div class="card" style="margin-bottom:0">
      <div class="card-title">Player Rating History</div>
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

  // ── Rating history line chart ─────────────────────────────────────────────
  const matchOrder = [];
  const seen = new Set();
  for (const r of stats.player_history) {
    if (!seen.has(r.match_id)) {
      seen.add(r.match_id);
      matchOrder.push({ id: r.match_id, map: r.map_name, date: r.uploaded_at });
    }
  }

  const topPlayers = leaderboard.slice(0, 8).map(p => p.steamid);

  const ratingMap = {};
  for (const r of stats.player_history) {
    if (!topPlayers.includes(r.steamid)) continue;
    if (!ratingMap[r.steamid]) ratingMap[r.steamid] = { name: r.name, ratings: {} };
    ratingMap[r.steamid].ratings[r.match_id] = r.rating;
  }

  const lineLabels = matchOrder.map(m => `${m.map.replace('de_', '')} #${m.id}`);

  const lineDatasets = topPlayers
    .filter(sid => ratingMap[sid])
    .map((sid, i) => {
      const { name, ratings } = ratingMap[sid];
      return {
        label: name,
        data: matchOrder.map(m => ratings[m.id] ?? null),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length] + '22',
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        spanGaps: true,
        borderWidth: 2,
      };
    });

  if (_charts.rating) _charts.rating.destroy();
  const ctxR = document.getElementById('chartRating');
  if (!ctxR) return;
  _charts.rating = new Chart(ctxR, {
    type: 'line',
    data: { labels: lineLabels, datasets: lineDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
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
        x: { ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1e2030' } },
        y: { min: 0, ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1e2030' } },
      },
    },
  });

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
