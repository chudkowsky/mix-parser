// ── Leaderboard ───────────────────────────────────────────────────────────────

let _lbData = { players: [], guests: [] };
let _lbSort  = { key: 'avg_rating', dir: 1 }; // 1 = desc, -1 = asc

function lbSort(key) {
  if (_lbSort.key === key) {
    _lbSort.dir *= -1;
  } else {
    _lbSort.key = key;
    _lbSort.dir = 1;
  }
  const card = document.getElementById('leaderboard-card');
  if (card) card.outerHTML = leaderboardCard(_lbData);
}

function leaderboardCard(lb) {
  _lbData = lb;
  const { players = [], guests = [] } = lb;
  if (!players.length && !guests.length) {
    return `<div class="card" id="leaderboard-card"><div class="card-title">Overall Leaderboard</div><p class="empty-state">No data yet — upload some demos.</p></div>`;
  }

  const openPct = p => p.total_opening_attempts
    ? Math.round(p.total_opening_kills / p.total_opening_attempts * 100)
    : null;
  const kdRatio = p => p.total_deaths
    ? (p.total_kills / p.total_deaths).toFixed(2)
    : null;
  const clutchDisplay = p => p.total_clutch_total
    ? `${Math.round(p.total_clutch_won / p.total_clutch_total * 100)}% <span class="stat-sub">(${p.total_clutch_won}/${p.total_clutch_total})</span>`
    : '—';

  const sortVal = {
    avg_rating:           p => p.avg_rating ?? -Infinity,
    avg_adr:              p => p.avg_adr ?? -Infinity,
    avg_kast:             p => p.avg_kast ?? -Infinity,
    avg_hs_pct:           p => p.avg_hs_pct ?? -Infinity,
    kd:                   p => p.total_deaths ? p.total_kills / p.total_deaths : -Infinity,
    opening_pct:          p => p.total_opening_attempts ? p.total_opening_kills / p.total_opening_attempts : -Infinity,
    clutch:               p => p.total_clutch_total ? p.total_clutch_won / p.total_clutch_total : -Infinity,
    total_flash_enemies:  p => p.total_flash_enemies ?? -Infinity,
    total_knife_kills:    p => p.total_knife_kills ?? -Infinity,
    total_zeus_kills:     p => p.total_zeus_kills ?? -Infinity,
    matches_played:       p => p.matches_played ?? -Infinity,
  };

  const sorted = (list) => [...list].sort((a, b) =>
    _lbSort.dir * (sortVal[_lbSort.key](b) - sortVal[_lbSort.key](a))
  );

  const arrow = (key) => {
    if (_lbSort.key !== key) return '';
    return `<span class="lb-sort-arrow">${_lbSort.dir === -1 ? '▼' : '▲'}</span>`;
  };

  const th = (label, key) =>
    `<th class="sortable${_lbSort.key === key ? ' sort-active' : ''}" onclick="lbSort('${key}')">${label}${arrow(key)}</th>`;

  const thead = `<thead><tr>
    <th></th><th>Player</th>
    ${th('Rating',   'avg_rating')}
    ${th('ADR',      'avg_adr')}
    ${th('KAST',     'avg_kast')}
    ${th('HS%',      'avg_hs_pct')}
    ${th('K/D',      'kd')}
    ${th('Opening%', 'opening_pct')}
    ${th('Clutch',   'clutch')}
    ${th('Flashes',  'total_flash_enemies')}
    ${th('🔪',       'total_knife_kills')}
    ${th('⚡',       'total_zeus_kills')}
    ${th('Maps',     'matches_played')}
  </tr></thead>`;

  const buildRows = (list) => sorted(list).map((p, i) => `<tr>
    <td class="rank">#${i + 1}</td>
    <td class="player-name" style="cursor:pointer;color:var(--accent)" onclick="navigate('player/${p.steamid}')">${esc(p.name || p.steamid)}</td>
    <td>${fmtRating(p.avg_rating)}</td>
    <td>${p.avg_adr ?? '—'}</td>
    <td>${p.avg_kast != null ? p.avg_kast + '%' : '—'}</td>
    <td>${p.avg_hs_pct != null ? p.avg_hs_pct + '%' : '—'}</td>
    <td class="kd">${kdRatio(p) != null ? `${kdRatio(p)} <span class="stat-sub">(${p.total_kills}/${p.total_deaths})</span>` : '—'}</td>
    <td>${openPct(p) != null ? openPct(p) + '%' : '—'}</td>
    <td>${clutchDisplay(p)}</td>
    <td>${p.total_flash_enemies ?? '—'}</td>
    <td>${p.total_knife_kills || '—'}</td>
    <td>${p.total_zeus_kills  || '—'}</td>
    <td class="matches-count">${p.matches_played}</td>
  </tr>`).join('');

  const playersTable = players.length ? `
    <div class="table-wrap">
      <table class="lb-table">
        ${thead}
        <tbody>${buildRows(players)}</tbody>
      </table>
    </div>` : `<p class="empty-state">No regulars yet.</p>`;

  const guestsSection = guests.length ? `
    <div class="card-title" style="margin-top:1.5rem">Guests <span style="font-size:0.75rem;font-weight:normal;opacity:0.6">(fewer than 5 maps)</span></div>
    <div class="table-wrap">
      <table class="lb-table">
        ${thead}
        <tbody>${buildRows(guests)}</tbody>
      </table>
    </div>` : '';

  return `<div class="card" id="leaderboard-card">
    <div class="card-title">Leaderboard</div>
    ${playersTable}
    ${guestsSection}
  </div>`;
}
