// ── Match Detail ──────────────────────────────────────────────────────────────

let _ratingsTab     = 'overview';
let _currentRatings = [];

async function renderMatchDetail(id) {
  app.innerHTML = '<div class="loading">Ładowanie meczu…</div>';

  let data;
  try {
    const res = await fetch(`/matches/${id}`);
    if (!res.ok) { app.innerHTML = `<div class="error">Nie znaleziono meczu.</div>`; return; }
    data = await res.json();
  } catch (e) {
    app.innerHTML = `<div class="error">${e.message}</div>`;
    return;
  }

  const kills   = data.kills   || [];
  const rounds  = data.rounds  || [];
  const ratings = data.ratings || [];
  const header  = data.header  || {};
  _currentRatings = ratings;
  _ratingsTab     = 'overview';

  const hs = kills.filter(k => k.headshot).length;
  const hsRate = kills.length ? Math.round(hs / kills.length * 100) : 0;

  app.innerHTML = `
    ${detailHeader(data, header)}
    ${detailRatings(ratings)}
    ${detailHeatmap(id)}
    ${detailOpeningDuels(ratings)}
    ${detailFlashClutch(ratings)}
    ${rounds.length ? detailRounds(rounds) : ''}
    ${kills.length  ? detailKills(kills)   : ''}
    ${detailBomb(data.bomb_events || {})}
    ${detailRaw(data)}
    ${detailMeta(data, header, kills.length, rounds.length, hsRate)}
  `;

  loadHeatmapIframe(id);
}

function detailHeader(m, header) {
  const mapName = m.map_name || header.map_name || '';
  const bgStyle = mapName
    ? `background-image: url('/static/maps/${encodeURIComponent(mapName)}.png')`
    : `background: #1a1c28`;

  const score = (m.ct_score != null && m.t_score != null)
    ? (() => {
        const a = m.t_score, b = m.ct_score;
        const aW = a > b ? 'score-win' : (a < b ? 'score-lose' : 'score-win');
        const bW = b > a ? 'score-win' : (b < a ? 'score-lose' : 'score-win');
        return `<div class="match-hero-score">
          <span class="${aW}">${a}</span>
          <span class="match-hero-score-sep">:</span>
          <span class="${bW}">${b}</span>
        </div>`;
      })()
    : '';

  return `<div class="match-hero">
    <div class="match-hero-bg" style="${bgStyle}"></div>
    <div class="match-hero-overlay"></div>
    <div class="match-hero-content" style="text-align:center;position:relative">
      ${isAdmin() ? `<button class="download-btn match-hero-admin" style="position:absolute;right:0;top:0;border-color:var(--red);color:var(--red)"
        onclick="deleteMatch(${m.id}, this, true)">Usuń mecz</button>` : ''}
      <div class="match-hero-map" style="margin-bottom:0.25rem">${esc(mapName || 'Nieznana mapa')}</div>
      ${score}
    </div>
  </div>`;
}

function detailMeta(m, header, killCount, roundCount, hsRate) {
  const entries = [
    ['Mapa',         m.map_name    || header.map_name    || '—'],
    ['Serwer',       m.server_name || header.server_name || header.client_name || '—'],
    ['Wersja',       m.patch_version || header.patch_version || '—'],
    ['Rundy',        roundCount ?? m.total_rounds ?? '—'],
    ['Zabójstwa',    killCount ?? '—'],
    ['HS %',         hsRate != null ? `${hsRate}%` : '—'],
    ['Przesłano',    fmtDate(m.uploaded_at)],
    ...(m.uploaded_by ? [['Dodane przez', m.uploaded_by]] : []),
    ['Plik',         m.filename || '—'],
  ];
  const rows = entries.map(([k, v]) => `<dt>${k}</dt><dd>${esc(String(v))}</dd>`).join('');
  return `<div class="card">
    <div class="card-title">Informacje o meczu</div>
    <div class="card-body"><dl class="kv-grid">${rows}</dl></div>
  </div>`;
}

function detailRatings(ratings) {
  const ct = ratings.filter(p => p.team === 'CT');
  const t  = ratings.filter(p => p.team === 'TERRORIST');

  function overviewRows(list) {
    return list.map(p => `<div class="ov-row">
      <span class="ov-row-name" title="${esc(p.name)}">${esc(p.name)}</span>
      <div class="ov-stat"><span class="ov-stat-val ${rClass(p.rating)}">${Number(p.rating).toFixed(2)}</span><span class="ov-stat-lbl">Rating</span></div>
      <div class="ov-stat"><span class="ov-stat-val">${p.kills}/${p.deaths}</span><span class="ov-stat-lbl">K/D</span></div>
      <div class="ov-stat"><span class="ov-stat-val">${p.kast}%</span><span class="ov-stat-lbl">KAST</span></div>
      <div class="ov-stat"><span class="ov-stat-val">${p.adr}</span><span class="ov-stat-lbl">ADR</span></div>
      <div class="ov-stat"><span class="ov-stat-val">${p.hs_pct ?? '—'}%</span><span class="ov-stat-lbl">HS%</span></div>
    </div>`).join('');
  }

  function detailRows(list) {
    return list.map(p => {
      const mk     = typeof p.multi_kills === 'string' ? JSON.parse(p.multi_kills || '{}') : (p.multi_kills || {});
      const ctR    = p.ct_rating != null ? `<span class="${rClass(p.ct_rating)}" style="font-size:.72rem">CT ${p.ct_rating.toFixed(2)}</span>` : '';
      const tR     = p.t_rating  != null ? `<span class="${rClass(p.t_rating)}"  style="font-size:.72rem">T ${p.t_rating.toFixed(2)}</span>`  : '';
      const clutch = p.clutch_total ? `${p.clutch_won}/${p.clutch_total}` : '';
      return `<div class="rating-row" style="flex-wrap:wrap;gap:.35rem">
        <span class="rating-row-name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="rating-row-meta">
          <span>K/D <b>${p.kills}/${p.deaths}</b></span>
          <span>ADR <b>${p.adr}</b></span>
          <span>HS <b>${p.hs_pct ?? '—'}%</b></span>
          <span>KAST <b>${p.kast}%</b></span>
          ${p.flash_enemies ? `<span>Flash <b>${p.flash_enemies}</b></span>` : ''}
          ${clutch ? `<span>Clutch <b>${clutch}</b></span>` : ''}
          ${p.knife_kills ? `<span>🔪 <b>${p.knife_kills}</b></span>` : ''}
          ${p.zeus_kills  ? `<span>⚡ <b>${p.zeus_kills}</b></span>`  : ''}
        </span>
        <span style="display:flex;align-items:center;gap:.4rem;margin-left:auto">
          ${ctR} ${tR}
          ${mkBadges(mk)}
          <span class="rating-num ${rClass(p.rating)}">${Number(p.rating).toFixed(2)}</span>
        </span>
      </div>`;
    }).join('');
  }

  const isOverview = _ratingsTab === 'overview';
  const board = isOverview
    ? `<div class="rating-board">
      <div class="rating-team ct"><h3>Drużyna A</h3>${overviewRows(ct)}</div>
      <div class="rating-team t"><h3>Drużyna B</h3>${overviewRows(t)}</div>
       </div>`
    : `<div class="rating-board">
      <div class="rating-team ct"><h3>Drużyna A</h3>${detailRows(ct)}</div>
      <div class="rating-team t"><h3>Drużyna B</h3>${detailRows(t)}</div>
       </div>
       <p class="formula-note">Rating = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587</p>`;

  return `<div class="card" id="ratings-card">
    <div class="card-title" style="justify-content:space-between">
      <span>Ocena HLTV 2.0</span>
      <div class="detail-tabs" style="margin:0">
        <button class="detail-tab${isOverview ? ' active' : ''}" onclick="switchRatingsTab('overview')">Przegląd</button>
        <button class="detail-tab${!isOverview ? ' active' : ''}" onclick="switchRatingsTab('details')">Szczegóły</button>
      </div>
    </div>
    <div class="card-body">${board}</div>
  </div>`;
}

function switchRatingsTab(tab) {
  _ratingsTab = tab;
  const card = document.getElementById('ratings-card');
  if (card) card.outerHTML = detailRatings(_currentRatings);
}

function collapsibleCard(id, title, content, cardStyle = '') {
  return `<div class="card"${cardStyle ? ` style="${cardStyle}"` : ''}>
    <div class="card-title collapsible-hdr" id="hdr-${id}" onclick="toggleSection('${id}')">
      <span>${title}</span><span class="chevron">&#9658;</span>
    </div>
    <div class="collapsible-body" id="${id}">
      <div class="collapsible-inner card-body">${content}</div>
    </div>
  </div>`;
}

function toggleSection(id) {
  const body = document.getElementById(id);
  const hdr  = document.getElementById('hdr-' + id);
  if (!body) return;
  const open = body.classList.toggle('open');
  hdr.classList.toggle('open', open);
}

function detailOpeningDuels(ratings) {
  const sorted = [...ratings].sort((a, b) => (b.opening_kills || 0) - (a.opening_kills || 0));
  const rows = sorted.filter(p => p.opening_attempts > 0).map(p => {
    const pct = p.opening_attempts ? Math.round(p.opening_kills / p.opening_attempts * 100) : 0;
    return `<tr><td>${esc(p.name)}</td><td>${p.opening_kills ?? 0}</td><td>${p.opening_attempts ?? 0}</td><td>${pct}%</td></tr>`;
  }).join('');
  if (!rows) return '';
  const content = `<div class="table-wrap"><table>
    <thead><tr><th>Gracz</th><th>Wejścia</th><th>Pojedynki</th><th>Wygr%</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  return collapsibleCard('sec-opening', 'Wejścia', content);
}

function detailFlashClutch(ratings) {
  const flashers = [...ratings]
    .filter(p => p.flash_enemies > 0)
    .sort((a, b) => b.flash_enemies - a.flash_enemies);

  const clutchers = [...ratings]
    .filter(p => p.clutch_total > 0)
    .sort((a, b) => b.clutch_total - a.clutch_total);

  const flashRows = flashers.map(p => `<tr>
    <td>${esc(p.name)}</td>
    <td>${p.flash_enemies}</td>
    <td>${p.flash_avg_dur != null ? Number(p.flash_avg_dur).toFixed(2) + 's' : '—'}</td>
  </tr>`).join('');

  const clutchRows = clutchers.map(p => {
    const pct = Math.round(p.clutch_won / p.clutch_total * 100);
    return `<tr>
      <td>${esc(p.name)}</td>
      <td>${p.clutch_won}/${p.clutch_total}</td>
      <td>${pct}%</td>
    </tr>`;
  }).join('');

  const flashCard = flashRows ? collapsibleCard('sec-flash', 'Efektywność flashy',
    `<table><thead><tr><th>Gracz</th><th>Oślepieni</th><th>Śr. czas</th></tr></thead><tbody>${flashRows}</tbody></table>`) : '';

  const clutchCard = clutchRows ? collapsibleCard('sec-clutch', 'Clutch (1vX)',
    `<table><thead><tr><th>Gracz</th><th>Wygrane/Razem</th><th>Wygr%</th></tr></thead><tbody>${clutchRows}</tbody></table>`) : '';

  return flashCard + clutchCard;
}

function detailRounds(rounds) {
  const rows = rounds.map(r => `<tr>
    <td>${r.round ?? r.total_rounds_played ?? '—'}</td>
    <td>${tag(r.winner, r.winner === 'CT' ? 'ct' : 't')}</td>
    <td>${r.reason ?? '—'}</td>
    <td>${r.tick ?? '—'}</td>
  </tr>`).join('');
  const content = `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Zwycięzca</th><th>Powód</th><th>Tick</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
  return collapsibleCard('sec-rounds', `Rundy (${rounds.length})`, content);
}

function detailKills(kills) {
  const rows = kills.slice(0, 300).map(k => `<tr>
    <td>${esc(k.attacker_name ?? '—')} ${tag(k.attacker_team_name ?? '', k.attacker_team_name === 'CT' ? 'ct' : 't')}</td>
    <td>${esc(k.user_name ?? '—')} ${tag(k.user_team_name ?? '', k.user_team_name === 'CT' ? 'ct' : 't')}</td>
    <td>${k.weapon ?? '—'}</td>
    <td>${k.headshot ? tag('HS', 'hs') : ''}</td>
    <td>${k.distance != null ? Number(k.distance).toFixed(1) : '—'}</td>
    <td>${k.total_rounds_played ?? '—'}</td>
  </tr>`).join('');
  const note = kills.length > 300 ? `<p style="color:var(--muted);font-size:.8rem;margin-top:.5rem">Pokazano pierwsze 300 z ${kills.length}</p>` : '';
  const content = `<div class="table-wrap"><table>
    <thead><tr><th>Atakujący</th><th>Ofiara</th><th>Broń</th><th></th><th>Dystans</th><th>Runda</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${note}`;
  return collapsibleCard('sec-kills', `Kanał zabójstw (${kills.length})`, content);
}

function detailBomb(bombEvents) {
  const sections = Object.entries(bombEvents).map(([ev, rows]) => {
    if (!rows.length) return '';
    return `<p style="color:var(--accent);margin:.6rem 0 .3rem;font-size:.82rem;font-weight:700">${ev} (${rows.length})</p>
      <div class="table-wrap"><table>
        <thead><tr>${Object.keys(rows[0]).map(k => `<th>${k}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 50).map(r => `<tr>${Object.values(r).map(v => `<td>${v ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  }).join('');
  if (!sections) return '';
  return collapsibleCard('sec-bomb', 'Zdarzenia bomby', sections);
}

function detailHeatmap(matchId) {
  return `<div class="card" id="heatmap-card">
    <div class="card-title">Mapa zabójstw</div>
    <div id="heatmap-frame-wrap" style="
      position:relative;width:100%;height:960px;
      background:#0d0d0d;border-radius:0 0 8px 8px;overflow:hidden
    ">
      <div style="
        display:flex;align-items:center;justify-content:center;
        height:100%;color:var(--muted)
      ">Ładowanie…</div>
    </div>
  </div>`;
}

function loadHeatmapIframe(matchId) {
  const wrap = document.getElementById('heatmap-frame-wrap');
  if (!wrap) return;
  const url = `/static/heatmaps/${matchId}.html`;
  fetch(url, { method: 'HEAD' }).then(res => {
    if (!res.ok) {
      wrap.innerHTML = `<div style="
        display:flex;flex-direction:column;align-items:center;
        justify-content:center;height:100%;gap:.75rem;color:var(--muted)
      ">
        <span style="font-size:2rem">⏳</span>
        <span>Mapa zabójstw jeszcze nie wygenerowana.</span>
        <span style="font-size:.8rem">Generowana automatycznie po każdym nowym wgraniu.</span>
      </div>`;
      return;
    }
    wrap.innerHTML = `
      <div id="heatmap-loading" style="
        position:absolute;inset:0;display:flex;align-items:center;
        justify-content:center;color:var(--muted);background:#0d0d0d;z-index:1
      ">Ładowanie mapy zabójstw…</div>
      <iframe
        src="${url}"
        style="width:100%;height:100%;border:none;display:block"
        onload="document.getElementById('heatmap-loading')?.remove()"
      ></iframe>`;
  }).catch(() => {
    wrap.innerHTML = `<div style="
      display:flex;align-items:center;justify-content:center;
      height:100%;color:var(--muted)
    ">Nie można załadować mapy zabójstw.</div>`;
  });
}

function detailRaw(data) {
  const summary = JSON.stringify({
    header: data.header,
    map_name: data.map_name,
    total_rounds: data.total_rounds,
    ratings_count: (data.ratings || []).length,
    kills_count: (data.kills || []).length,
  }, null, 2);

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);

  return `<div class="card">
    <div class="card-title" style="display:flex;align-items:center;gap:1rem">
      Surowe JSON
      <a href="${url}" download="match_${data.id || 'data'}.json" style="text-decoration:none">
        <button class="download-btn">Pobierz pełny JSON</button>
      </a>
    </div>
    <pre style="background:var(--bg-deep);border:1px solid var(--border);padding:1rem;font-family:'IBM Plex Mono',monospace;font-size:.78rem;overflow:auto;max-height:280px;color:var(--text-sub)">${esc(summary)}</pre>
  </div>`;
}
