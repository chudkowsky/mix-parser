// ── App references ────────────────────────────────────────────────────────────

const app     = document.getElementById('app');
const backBtn = document.getElementById('back-btn');

// ── Router ────────────────────────────────────────────────────────────────────

function navigate(hash) {
  location.hash = hash;
}

async function router() {
  const raw  = location.hash.replace('#', '');
  const [view, param] = raw.split('/');

  if (view === 'match' && param) {
    backBtn.style.display = 'block';
    await renderMatchDetail(param);
  } else if (view === 'player' && param) {
    backBtn.style.display = 'block';
    await renderPlayerProfile(param);
  } else if (view === 'team-picker') {
    backBtn.style.display = 'block';
    await renderTeamPicker();
  } else {
    backBtn.style.display = 'none';
    await renderDashboard();
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  updateAdminBtn();
  maybeAskName();
  router();
});
