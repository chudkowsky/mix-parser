// ── App references ────────────────────────────────────────────────────────────

const app     = document.getElementById('app');
const backBtn = document.getElementById('back-btn');

// ── Router ────────────────────────────────────────────────────────────────────

function navigate(hash) {
  location.hash = hash;
}

function updateNav(active) {
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`nav-${active}`);
  if (el) el.classList.add('active');
}

async function router() {
  const raw  = location.hash.replace('#', '');
  const [view, param] = raw.split('/');

  if (view === 'match' && param) {
    backBtn.style.display = 'block';
    updateNav('');
    await renderMatchDetail(param);
  } else if (view === 'player' && param) {
    backBtn.style.display = 'block';
    updateNav('');
    await renderPlayerProfile(param);
  } else if (view === 'season' && param) {
    backBtn.style.display = 'block';
    updateNav('seasons');
    await renderSeasonSummary(param);
  } else if (view === 'matches') {
    backBtn.style.display = 'none';
    updateNav('matches');
    await loadMatchesPage();
  } else if (view === 'players') {
    backBtn.style.display = 'none';
    updateNav('players');
    await renderPlayersPage();
  } else if (view === 'maps' && param) {
    backBtn.style.display = 'block';
    updateNav('maps');
    await renderMapDetail(decodeURIComponent(param));
  } else if (view === 'maps') {
    backBtn.style.display = 'none';
    updateNav('maps');
    await renderMapsPage();
  } else if (view === 'seasons') {
    backBtn.style.display = 'none';
    updateNav('seasons');
    await renderSeasonsList();
  } else if (view === 'team-picker') {
    backBtn.style.display = 'none';
    updateNav('team-picker');
    await renderTeamPicker();
  } else {
    backBtn.style.display = 'none';
    updateNav('leaderboard');
    await renderDashboard();
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  updateAdminBtn();
  maybeAskName();
  router();
});
