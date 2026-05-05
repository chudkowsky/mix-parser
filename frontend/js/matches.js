// ── Matches page ──────────────────────────────────────────────────────────────

function matchTile(m) {
  const ratingNum = m.top_player_rating != null ? Number(m.top_player_rating).toFixed(2) : '—';
  const mapImg    = m.map_name
    ? `<img class="tile-map-img" src="/static/maps/${encodeURIComponent(m.map_name)}.png" alt="" onerror="this.style.display='none'">`
    : '';

  return `<div class="match-tile" onclick="navigate('match/${m.id}')">
    ${mapImg}
    <div class="tile-top">
      <span class="map-name">${esc(m.map_name || 'Nieznana mapa')}</span>
      ${isAdmin() ? `<button class="delete-btn" title="Usuń mecz" onclick="event.stopPropagation(); deleteMatch(${m.id}, this)">✕</button>` : ''}
    </div>
    <div class="tile-sides">
      ${m.ct_score != null && m.t_score != null
        ? (() => {
            const a = m.t_score, b = m.ct_score;
            return `<span class="${a >= b ? 'score-win' : 'score-lose'}" style="font-size:1rem">${a}</span>
                    <span class="side-sep">:</span>
                    <span class="${b >= a ? 'score-win' : 'score-lose'}" style="font-size:1rem">${b}</span>`;
          })()
        : `<span style="color:var(--muted);font-size:.8rem">${m.total_rounds ?? '?'} ${rundaWord(m.total_rounds)}</span>`
      }
    </div>
    <div class="tile-rounds">${m.total_rounds != null ? `${m.total_rounds} ${rundaWord(m.total_rounds)}` : ''}</div>
    ${m.top_player_name ? `<div class="tile-mvp">
      <span class="mvp-label">MVP</span>
      <span class="mvp-name" title="${esc(m.top_player_name)}">${esc(m.top_player_name)}</span>
      <span class="${rClass(m.top_player_rating)}">${ratingNum}</span>
    </div>` : ''}
  </div>`;
}

function dayLabel(dateKey) {
  const today     = new Date().toLocaleDateString('sv');
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('sv');
  if (dateKey === today)     return 'Dzisiaj';
  if (dateKey === yesterday) return 'Wczoraj';
  return new Date(dateKey).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function meczWord(n) {
  const count = Number(n) || 0;
  if (count === 1) return 'mecz';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'mecze';
  return 'meczów';
}

function rundaWord(n) {
  const count = Number(n) || 0;
  if (count === 1) return 'runda';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'rundy';
  return 'rund';
}
function renderMatchesPage() {
  const matches = window._matchesAll || [];

  const header = `<div class="grid-header">
    <span class="section-title">Mecze (${matches.length})</span>
  </div>`;

  if (!matches.length) {
    return `<div id="matches-section">${header}<p class="empty-state">Brak meczów. Wgraj demo powyżej.</p></div>`;
  }

  // Group by local calendar date, preserving insertion order (matches are newest-first)
  const groupMap = new Map();
  for (const m of matches) {
    const key = m.uploaded_at
      ? new Date(m.uploaded_at).toLocaleDateString('sv') // 'sv' locale gives YYYY-MM-DD
      : 'unknown';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(m);
  }
  const groups = [...groupMap.entries()].map(([key, items]) => ({ key, items }));

  const groupsHtml = groups.map(g => `
    <div class="matches-day-group">
      <div class="matches-day-label">
        <span class="matches-day-name">${esc(dayLabel(g.key))}</span>
        <span class="matches-day-count">${g.items.length} ${meczWord(g.items.length)}</span>
      </div>
      <div class="matches-grid">${g.items.map(matchTile).join('')}</div>
    </div>`
  ).join('');

  return `<div id="matches-section">${header}${groupsHtml}</div>`;
}

async function loadMatchesPage() {
  app.innerHTML = '<div class="loading">Ładowanie…</div>';
  try {
    window._matchesAll = await fetch('/matches').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">Nie można połączyć z serwerem: ${e.message}</div>`;
    return;
  }
  app.innerHTML = `<div class="card"><div class="card-body">${renderMatchesPage()}</div></div>`;
}
