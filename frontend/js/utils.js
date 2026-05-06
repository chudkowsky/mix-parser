function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tag(text, cls) {
  return `<span class="tag ${cls}">${text}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtRating(r) {
  if (r == null) return '—';
  return `<span class="${rClass(r)}">${Number(r).toFixed(2)}</span>`;
}

function rClass(r) {
  if (r == null) return '';
  if (r >= 1.70) return 'r-elite';
  if (r >= 1.20) return 'r-very-high'; // green
  if (r >= 1.05) return 'r-high';       // light green
  if (r >= 0.95) return 'r-mid';        // yellow
  if (r >= 0.85) return 'r-low';        // orange
  if (r >= 0.45) return 'r-very-low';   // red
  return 'r-disaster';              // dark red
}

function mkBadges(mk) {
  if (!mk) return '';
  const labels = { '2': '2K', '3': '3K', '4': '4K', '5': 'ACE' };
  const colors  = { '2': '#7a8aaa', '3': '#F5C542', '4': '#7EB8D4', '5': '#4ADE80' };
  return Object.entries(mk).map(([k, v]) =>
    `<span style="background:var(--bg-deep);border:1px solid ${colors[k]};color:${colors[k]};font-family:'IBM Plex Mono',monospace;padding:.1rem .35rem;font-size:.7rem;font-weight:700;margin-left:.2rem">${labels[k]}×${v}</span>`
  ).join('');
}

function popcount(n) {
  let c = 0; while (n) { c += n & 1; n >>>= 1; } return c;
}
