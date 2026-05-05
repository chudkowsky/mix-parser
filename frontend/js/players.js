// ── Players list ──────────────────────────────────────────────────────────────

async function renderPlayersPage() {
  app.innerHTML = '<div class="loading">Ładowanie…</div>';
  let players = [];
  try {
    players = await fetch('/players').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">Nie można połączyć z serwerem: ${e.message}</div>`;
    return;
  }

  const rows = players.map(p => `
    <tr class="players-row" onclick="navigate('player/${p.steamid}')">
      <td class="players-name">
        ${p.avatarmedium ? `<img class="player-avatar-md" src="${esc(p.avatarmedium)}" alt="">` : ''}${esc(p.name || p.steamid)}
      </td>
      <td>${fmtRating(p.avg_rating)}</td>
      <td class="players-maps">${p.matches_played}</td>
    </tr>`
  ).join('');

  app.innerHTML = `
    <div class="card">
      <div class="card-title">Gracze</div>
      <table class="players-table">
          <thead><tr>
            <th>Nazwa</th>
            <th>Śr. Rating</th>
            <th>Mapy</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
    </div>`;
}
