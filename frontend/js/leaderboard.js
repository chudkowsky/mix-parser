// ── Leaderboard ────────────────────────────────────────────────────────────────

let _lbData          = { players: [], guests: [] };
let _lbSort          = { key: 'avg_rating', dir: 1 }; // 1 = desc, -1 = asc
let _seasons         = [];
let _currentSeasonId = null;   // null = Overall
let _allTitles       = {};     // steamid → [title objects]

// ── Season tabs ───────────────────────────────────────────────────────────────

async function switchSeason(seasonId) {
  const url = seasonId === null ? '/leaderboard' : `/seasons/${seasonId}/leaderboard`;
  let lb;
  try {
    lb = await fetch(url).then(r => r.json());
  } catch (e) {
    return;
  }
  _currentSeasonId = seasonId;
  _lbData = lb;
  const card = document.getElementById('leaderboard-card');
  if (card) card.outerHTML = leaderboardCard(lb);
}

function seasonTabs() {
  if (!_seasons.length) return '';

  const activeSeason    = _seasons.find(s => s.id === _currentSeasonId);
  const showSummaryLink = _currentSeasonId !== null && activeSeason && !activeSeason.is_active;

  const tabs = [
    { id: null, label: 'Overall', active: _currentSeasonId === null, live: false },
    ..._seasons.map(s => ({
      id:     s.id,
      label:  s.name,
      active: _currentSeasonId === s.id,
      live:   !!s.is_active,
    })),
  ];

  const tabsHtml = tabs.map(t =>
    `<button class="season-tab${t.active ? ' active' : ''}${t.live ? ' live' : ''}"
      onclick="switchSeason(${t.id === null ? 'null' : t.id})">${esc(t.label)}</button>`
  ).join('');

  const summaryLink = showSummaryLink
    ? `<span class="season-summary-link" onclick="navigate('season/${_currentSeasonId}')">View Summary →</span>`
    : '';

  return `<div class="season-tabs">${tabsHtml}${summaryLink}</div>`;
}

// ── Title badges ──────────────────────────────────────────────────────────────

function titleEmoji(label) {
  // "👑 Season MVP" → "👑"
  return label.split(' ')[0] || label;
}

function titleBadges(steamid) {
  const titles = _allTitles[steamid] || [];
  if (!titles.length) return '';
  return titles.slice(0, 3).map(t =>
    `<span class="title-badge" title="${esc(t.season_name + ' · ' + t.award_label)}">${esc(titleEmoji(t.award_label))}</span>`
  ).join('');
}

// ── Leaderboard card ──────────────────────────────────────────────────────────

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

  const seasonThresholdNote = _currentSeasonId && lb.min_matches
    ? `<span style="font-size:.72rem;font-weight:normal;text-transform:none;letter-spacing:0;color:var(--muted);margin-left:.75rem">min. ${lb.min_matches} match${lb.min_matches !== 1 ? 'es' : ''} (${lb.total_matches} in season)</span>`
    : '';

  const header = `
    <div class="grid-header">
      <div class="section-title">Leaderboard${seasonThresholdNote}</div>
      <div class="rating-legend">
        <span><i class="dot r-elite"></i><span class="legend-name">Elite</span> <span class="legend-label">&ge;1.70</span></span>
        <span><i class="dot r-very-high"></i><span class="legend-name">Very High</span> <span class="legend-label">&ge;1.20</span></span>
        <span><i class="dot r-high"></i><span class="legend-name">High</span> <span class="legend-label">&ge;1.05</span></span>
        <span><i class="dot r-mid"></i><span class="legend-name">Mid</span> <span class="legend-label">&ge;0.95</span></span>
        <span><i class="dot r-low"></i><span class="legend-name">Low</span> <span class="legend-label">&ge;0.85</span></span>
        <span><i class="dot r-very-low"></i><span class="legend-name">Very Low</span> <span class="legend-label">&lt;0.85</span></span>
        <span><i class="dot r-extreme-low"></i><span class="legend-name">Extreme</span> <span class="legend-label">&lt;0.45</span></span>
      </div>
    </div>
  `;
  if (!players.length && !guests.length) {
    return `<div class="card" id="leaderboard-card">
      ${seasonTabs()}
      <div class="card-title">Leaderboard${seasonThresholdNote}</div>
      <p class="empty-state">No data yet — upload some demos.</p>
    </div>`;
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
    avg_rating:          p => p.avg_rating ?? -Infinity,
    avg_adr:             p => p.avg_adr ?? -Infinity,
    avg_kast:            p => p.avg_kast ?? -Infinity,
    avg_hs_pct:          p => p.avg_hs_pct ?? -Infinity,
    kd:                  p => p.total_deaths ? p.total_kills / p.total_deaths : -Infinity,
    opening_pct:         p => p.total_opening_attempts ? p.total_opening_kills / p.total_opening_attempts : -Infinity,
    clutch:              p => p.total_clutch_total ? p.total_clutch_won / p.total_clutch_total : -Infinity,
    total_flash_enemies: p => p.total_flash_enemies ?? -Infinity,
    total_knife_kills:   p => p.total_knife_kills ?? -Infinity,
    total_zeus_kills:    p => p.total_zeus_kills ?? -Infinity,
    matches_played:      p => p.matches_played ?? -Infinity,
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
    <td class="player-name" style="cursor:pointer;color:var(--accent)" onclick="navigate('player/${p.steamid}')">
      ${esc(p.name || p.steamid)}${titleBadges(p.steamid)}
    </td>
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

  const guestsSection = (!_currentSeasonId && guests.length) ? `
    <div class="card-title" style="margin-top:1.5rem">Guests <span style="font-size:0.75rem;font-weight:normal;opacity:0.6">(fewer than 5 maps)</span></div>
    <div class="table-wrap">
      <table class="lb-table">
        ${thead}
        <tbody>${buildRows(guests)}</tbody>
      </table>
    </div>` : '';

  return `<div class="card" id="leaderboard-card">
    ${seasonTabs()}
    ${header}
    ${playersTable}
    ${guestsSection}
  </div>`;
}
