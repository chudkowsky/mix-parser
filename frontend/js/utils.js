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
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
  return 'r-extreme-low';              // dark red
}

function mkBadges(mk) {
  if (!mk) return '';
  const labels = { '2': '2K', '3': '3K', '4': '4K', '5': 'ACE' };
  const colors  = { '2': '#888', '3': '#f0a500', '4': '#5baeff', '5': '#4caf7d' };
  return Object.entries(mk).map(([k, v]) =>
    `<span style="background:#111318;border:1px solid ${colors[k]};color:${colors[k]};border-radius:3px;padding:.1rem .35rem;font-size:.7rem;font-weight:700;margin-left:.2rem">${labels[k]}×${v}</span>`
  ).join('');
}

function popcount(n) {
  let c = 0; while (n) { c += n & 1; n >>>= 1; } return c;
}
