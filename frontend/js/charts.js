// ── Charts ───────────────────────────────────────────────────────────────────

const _charts = {};

function chartsSection(stats, leaderboard) {
  if (!stats.player_history.length) return '';
  const rangeBtns = [10,20,50,0].map(n =>
    `<button onclick="setDashboardRange(${n})" data-range="${n}" style="padding:4px 11px;border-radius:5px;border:1px solid #444;background:transparent;color:#888;font-weight:normal;font-size:.78rem;cursor:pointer">${n === 0 ? 'All' : 'Last '+n}</button>`
  ).join('');
  return `<div class="charts-row">
    <div class="card" style="margin-bottom:0">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div>Player Rating History</div>
          <div style="font-size:.75rem;font-weight:normal;color:#555;margin-top:2px">Hover a line or legend to isolate a player</div>
        </div>
        <div id="dashRangeBtns" style="display:flex;gap:4px">${rangeBtns}</div>
      </div>
      <div style="display:flex;gap:16px;align-items:flex-start">
        <div style="flex:1;min-width:0"><canvas id="chartRating" height="240"></canvas></div>
        <div id="dashLegend" style="display:flex;flex-direction:column;gap:6px;padding-top:4px;min-width:120px"></div>
      </div>
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


  // precompute full cumulative avg per player (all matches)
  const playerCumul = {};
  for (const [sid, { name, matches }] of Object.entries(playerMatches)) {
    playerCumul[sid] = {
      name,
      cumul: matches.map((_, j) =>
        matches.slice(0, j + 1).reduce((s, m) => s + m.rating, 0) / (j + 1)
      ),
      matches,
    };
  }

  let _hoveredIdx = null;

  function setHover(idx) {
    if (!_charts.rating) return;
    _hoveredIdx = idx;
    _charts.rating.data.datasets.forEach((ds, i) => {
      const active = idx === null || i === idx;
      ds.borderWidth        = active ? 2.5 : 0.5;
      ds.borderColor        = active ? PALETTE[i % PALETTE.length] : PALETTE[i % PALETTE.length] + '30';
      ds.pointRadius        = active ? 5   : 3;
      ds.pointBackgroundColor = active ? PALETTE[i % PALETTE.length] : PALETTE[i % PALETTE.length] + '50';
    });
    _charts.rating.update('none');

    document.querySelectorAll('#dashLegend [data-li]').forEach(el => {
      const i = parseInt(el.dataset.li);
      el.style.opacity = (idx === null || i === idx) ? '1' : '0.3';
    });
  }

  function buildRatingChart(n) {
    document.querySelectorAll('#dashRangeBtns button').forEach(btn => {
      const active = parseInt(btn.dataset.range) === n;
      btn.style.background  = active ? '#f0a500' : 'transparent';
      btn.style.color       = active ? '#000'    : '#888';
      btn.style.borderColor = active ? '#f0a500' : '#444';
      btn.style.fontWeight  = active ? '700'     : 'normal';
    });

    const activeSids = topPlayers.filter(sid => playerCumul[sid]);

    const lineDatasets = activeSids.map((sid, i) => {
      const { cumul, matches } = playerCumul[sid];
      const start = n === 0 ? 0 : Math.max(0, matches.length - n);
      const slicedCumul = cumul.slice(start);
      const color = PALETTE[i % PALETTE.length];
      return {
        label: playerCumul[sid].name,
        data: slicedCumul.map((a, j) => ({ x: j + 1, y: a })),
        borderColor: color,
        borderWidth: 0.5,
          pointBackgroundColor: color,
        pointBorderColor: 'transparent',
        pointRadius: 3,
        pointHoverRadius: 7,
        tension: 0.35,
        fill: false,
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
        animation: { duration: 400 },
        interaction: { mode: 'index', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1c24', borderColor: '#2a2d38', borderWidth: 1,
            titleColor: '#f0a500', bodyColor: '#ccc',
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2) ?? '—'}` },
          },
        },
        scales: {
          x: {
            type: 'linear', min: 0.5,
            title: { display: true, text: 'Match #', color: '#555', font: { size: 10 } },
            ticks: { color: '#666', font: { size: 11 }, precision: 0 },
            grid: { color: '#1e2030' },
          },
          y: (() => {
            const allVals = lineDatasets.flatMap(ds => ds.data.map(p => p.y));
            const lo = Math.min(...allVals);
            const hi = Math.max(...allVals);
            const pad = (hi - lo) * 0.15 || 0.1;
            return {
              min: Math.max(0, +(lo - pad).toFixed(2)),
              max: +(hi + pad).toFixed(2),
              ticks: { color: '#666', font: { size: 11 }, stepSize: 0.1, callback: v => v.toFixed(1) },
              grid: { color: '#1e2030' },
            };
          })(),
        },
        onHover(evt, _items, chart) {
          if (!evt.native) { setHover(null); return; }
          const nearest = chart.getElementsAtEventForMode(evt.native, 'nearest', { intersect: false }, false);
          setHover(nearest.length ? nearest[0].datasetIndex : null);
        },
      },
    });

    if (_charts._leaveFn) ctxR.removeEventListener('mouseleave', _charts._leaveFn);
    _charts._leaveFn = () => setHover(null);
    ctxR.addEventListener('mouseleave', _charts._leaveFn);

    // build right-side legend with trend deltas
    const legend = document.getElementById('dashLegend');
    if (!legend) return;
    legend.innerHTML = activeSids.map((sid, i) => {
      const { name, cumul, matches } = playerCumul[sid];
      const start = n === 0 ? 0 : Math.max(0, matches.length - n);
      const sc = cumul.slice(start);
      const trend = sc.length > 1 ? sc[sc.length - 1] - sc[0] : 0;
      const trendStr = (trend >= 0 ? '+' : '') + trend.toFixed(2);
      const trendCol = trend >= 0 ? '#4caf7d' : '#e05555';
      const color = PALETTE[i % PALETTE.length];
      const dashStyle = `border-top: 2px solid ${color}; width:22px; height:0`;
      return `<div data-li="${i}" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px"
          onmouseenter="window._dashHover(${i})" onmouseleave="window._dashHover(null)">
          <span style="${dashStyle}"></span>
          <span style="color:#aaa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
          <span style="color:${trendCol};font-weight:600;min-width:36px;text-align:right">${trendStr}</span>
        </div>`;
    }).join('');
  }

  window._dashHover       = (idx) => setHover(idx);
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
