// ── Matches grid + pagination ─────────────────────────────────────────────────

const MATCHES_PER_PAGE = 6;
let _matchesPage = 1;
let _matchesAll  = [];

function matchesSection(matches) {
  _matchesAll  = matches;
  _matchesPage = 1;
  return renderMatchesSection();
}

function renderMatchesSection() {
  const matches    = _matchesAll;
  const totalPages = Math.max(1, Math.ceil(matches.length / MATCHES_PER_PAGE));
  const page       = Math.min(_matchesPage, totalPages);
  const start      = (page - 1) * MATCHES_PER_PAGE;
  const slice      = matches.slice(start, start + MATCHES_PER_PAGE);

  const header = `<div class="grid-header">
    <span class="section-title">Matches (${matches.length})</span>
  </div>`;

  if (!matches.length) {
    return header + `<p class="empty-state">No matches yet. Upload a demo above.</p>`;
  }

  const tiles = slice.map(m => {
    const date      = fmtDate(m.uploaded_at);
    const ratingNum = m.top_player_rating != null ? Number(m.top_player_rating).toFixed(2) : '—';
    const mapImg    = m.map_name
      ? `<img class="tile-map-img" src="/static/maps/${encodeURIComponent(m.map_name)}.png" alt="" onerror="this.style.display='none'">`
      : '';

    return `<div class="match-tile" onclick="navigate('match/${m.id}')">
      ${mapImg}
      <div class="tile-top">
        <span class="map-name">${esc(m.map_name || 'Unknown Map')}</span>
        <span class="tile-date">${date}</span>
        ${isAdmin() ? `<button class="delete-btn" title="Remove match" onclick="event.stopPropagation(); deleteMatch(${m.id}, this)">✕</button>` : ''}
      </div>
      <div class="tile-sides">
        ${m.ct_score != null && m.t_score != null
          ? (() => {
              const a = m.t_score, b = m.ct_score;
              return `<span class="${a >= b ? 'score-win' : 'score-lose'}" style="font-size:1rem">${a}</span>
                      <span class="side-sep">:</span>
                      <span class="${b >= a ? 'score-win' : 'score-lose'}" style="font-size:1rem">${b}</span>`;
            })()
          : `<span style="color:var(--muted);font-size:.8rem">${m.total_rounds ?? '?'} rounds</span>`
        }
      </div>
      <div class="tile-rounds">${m.total_rounds != null ? `${m.total_rounds} rounds` : ''}${m.uploaded_by ? `${m.total_rounds != null ? ' · ' : ''}<span style="color:var(--text-dim)">by ${esc(m.uploaded_by)}</span>` : ''}</div>
      ${m.top_player_name ? `<div class="tile-mvp">
        <span class="mvp-label">MVP</span>
        <span class="mvp-name" title="${esc(m.top_player_name)}">${esc(m.top_player_name)}</span>
        <span class="${rClass(m.top_player_rating)}">${ratingNum}</span>
      </div>` : ''}
    </div>`;
  }).join('');

  const pageNums = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      pageNums.push(i);
    } else if (pageNums[pageNums.length - 1] !== '…') {
      pageNums.push('…');
    }
  }

  const pgBtns = pageNums.map(p =>
    p === '…'
      ? `<span class="pg-info">…</span>`
      : `<button class="pg-btn${p === page ? ' active' : ''}" onclick="matchesGoTo(${p})">${p}</button>`
  ).join('');

  const pagination = totalPages > 1 ? `
    <div class="matches-pagination">
      <button class="pg-btn" onclick="matchesGoTo(${page - 1})" ${page === 1 ? 'disabled' : ''}>‹</button>
      ${pgBtns}
      <button class="pg-btn" onclick="matchesGoTo(${page + 1})" ${page === totalPages ? 'disabled' : ''}>›</button>
      <span class="pg-info">Page ${page} of ${totalPages}</span>
    </div>` : '';

  return `<div id="matches-section">${header}<div class="matches-grid">${tiles}</div>${pagination}</div>`;
}

function matchesGoTo(page) {
  const totalPages = Math.ceil(_matchesAll.length / MATCHES_PER_PAGE);
  _matchesPage = Math.max(1, Math.min(page, totalPages));
  const el = document.getElementById('matches-section');
  if (el) el.outerHTML = renderMatchesSection();
}
