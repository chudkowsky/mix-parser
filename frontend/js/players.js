// ── Players list ──────────────────────────────────────────────────────────────

async function renderPlayersPage() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  let players = [];
  try {
    players = await fetch('/players').then(r => r.json());
  } catch (e) {
    app.innerHTML = `<div class="error">Could not reach server: ${e.message}</div>`;
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
      <div class="card-title">Players</div>
      <table class="players-table">
          <thead><tr>
            <th>Name</th>
            <th>Avg Rating</th>
            <th>Maps</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
    </div>`;
}
