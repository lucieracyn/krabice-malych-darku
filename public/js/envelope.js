// Obálky: každý týden jiná barva, tvar chlopně, pečeť a okraj.

const PALETTES = [
  ['#f4e7d0', '#ecdcbf', '#b5473c', '#a8322d'],
  ['#cfe0e8', '#bcd2dd', '#f7efe2', '#35526b'],
  ['#f6d7d0', '#f0c4bb', '#fff3ec', '#b8433f'],
  ['#d9e3c8', '#c8d6b2', '#fbf3df', '#5a7340'],
  ['#2f4858', '#27404f', '#e9c46a', '#e9c46a'],
  ['#f3d9a4', '#eccb8a', '#7b3f2a', '#7b3f2a'],
  ['#e5d4ee', '#d7c0e4', '#fdf6ff', '#6b4a8a'],
  ['#c98f6b', '#bb7f5b', '#f4e3cc', '#5a2e1c'],
  ['#f9f4ea', '#f0e9da', '#d4a373', '#bc4749'],
  ['#7d2e3a', '#6d2430', '#f1d9c0', '#e8c27a'],
  ['#b9d7c9', '#a3c9b8', '#fdfbf0', '#2f6f5e'],
  ['#f2b8a2', '#ec9f85', '#fff1e6', '#8d3b2b'],
  ['#3d405b', '#34374f', '#f2cc8f', '#e07a5f'],
];
const FLAPS = {
  v: { d: 'M0,0 H300 L150,112 Z', tip: 112 },
  round: { d: 'M0,0 H300 C300,52 196,118 150,118 C104,118 0,52 0,0 Z', tip: 118 },
  square: { d: 'M0,0 H300 V74 H0 Z', tip: 74 },
  deep: { d: 'M0,0 H300 L150,150 Z', tip: 150 },
  wave: { d: 'M0,0 H300 C300,40 250,60 225,78 C200,96 175,104 150,104 C125,104 100,96 75,78 C50,60 0,40 0,0 Z', tip: 104 },
};
const FLAP_KEYS = Object.keys(FLAPS);
const SEALS = ['♥', '★', '✿', '☾', '♥', '✦'];
const BORDERS = ['none', 'airmail', 'dots', 'double', 'none', 'line'];

export function styleOf(week) {
  const p = PALETTES[(week * 5 + 2) % PALETTES.length];
  return {
    body: p[0], flap: p[1], liner: p[2], seal: p[3],
    flapKey: FLAP_KEYS[(week * 3 + 1) % FLAP_KEYS.length],
    glyph: SEALS[(week * 7) % SEALS.length],
    border: BORDERS[(week * 11 + 3) % BORDERS.length],
    tilt: ((week * 37) % 7) - 3,
  };
}

function borderSvg(s) {
  if (s.border === 'airmail') {
    return `<rect x="5" y="5" width="290" height="190" rx="8" fill="none" stroke="#c2413a" stroke-width="7" stroke-dasharray="16 16"/>
      <rect x="5" y="5" width="290" height="190" rx="8" fill="none" stroke="#3b5b8c" stroke-width="7" stroke-dasharray="16 16" stroke-dashoffset="16"/>`;
  }
  if (s.border === 'dots') return `<rect x="9" y="9" width="282" height="182" rx="7" fill="none" stroke="${s.seal}" stroke-width="3" stroke-dasharray="0.1 9" stroke-linecap="round" opacity=".7"/>`;
  if (s.border === 'double') return `<rect x="7" y="7" width="286" height="186" rx="7" fill="none" stroke="${s.seal}" stroke-width="1.5" opacity=".6"/><rect x="12" y="12" width="276" height="176" rx="5" fill="none" stroke="${s.seal}" stroke-width="1" opacity=".45"/>`;
  if (s.border === 'line') return `<rect x="8" y="8" width="284" height="184" rx="7" fill="none" stroke="${s.seal}" stroke-width="2" opacity=".5"/>`;
  return '';
}

const CHAR = `
  <radialGradient id="chA" cx="0" cy="1" r=".6"><stop offset="0" stop-color="#140c08" stop-opacity=".95"/><stop offset=".55" stop-color="#3a2114" stop-opacity=".55"/><stop offset="1" stop-color="#3a2114" stop-opacity="0"/></radialGradient>
  <radialGradient id="chB" cx="1" cy="0" r=".5"><stop offset="0" stop-color="#140c08" stop-opacity=".9"/><stop offset=".6" stop-color="#4a2a18" stop-opacity=".4"/><stop offset="1" stop-color="#4a2a18" stop-opacity="0"/></radialGradient>
  <radialGradient id="chC" cx="1" cy="1" r=".45"><stop offset="0" stop-color="#140c08" stop-opacity=".85"/><stop offset="1" stop-color="#4a2a18" stop-opacity="0"/></radialGradient>`;
const charRects = `<g class="char"><rect width="300" height="200" rx="10" fill="url(#chA)"/><rect width="300" height="200" rx="10" fill="url(#chB)"/><rect width="300" height="200" rx="10" fill="url(#chC)"/></g>`;

// Velká obálka z vrstev, aby šla otevřít (chlopeň se překlopí, papír vyjede).
export function envelopeHtml(week, { scorched = false } = {}) {
  const s = styleOf(week);
  const f = FLAPS[s.flapKey];
  const sealY = Math.max(f.tip - 14, 40);
  return `
  <div class="env${scorched ? ' scorched' : ''}" data-week="${week}" style="--tilt:${s.tilt}deg">
    <svg class="env-back" viewBox="0 0 300 200"><rect width="300" height="200" rx="10" fill="${s.liner}"/>
      <rect width="300" height="200" rx="10" fill="#000" opacity=".12"/></svg>
    <div class="env-paper"><i></i><i></i><i></i><i></i></div>
    <svg class="env-front" viewBox="0 0 300 200">
      <defs>${CHAR}</defs>
      <path d="M0,10 Q0,0 6,6 L150,${Math.min(f.tip + 6, 128)} L294,6 Q300,0 300,10 V190 Q300,200 290,200 H10 Q0,200 0,190 Z" fill="${s.body}"/>
      <path d="M0,200 L118,96 M300,200 L182,96" stroke="#000" stroke-opacity=".12" stroke-width="1.5" fill="none"/>
      ${borderSvg(s)}
      ${scorched ? charRects : ''}
    </svg>
    <div class="env-flap">
      <svg viewBox="0 0 300 160" class="flap-out"><defs>${CHAR}</defs>
        <path d="${f.d}" fill="${s.flap}" stroke="#000" stroke-opacity=".1"/>
        ${scorched ? `<path d="${f.d}" fill="url(#chB)"/>` : ''}
        <circle cx="150" cy="${sealY}" r="17" fill="${s.seal}"/>
        <circle cx="150" cy="${sealY}" r="13" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.5"/>
        <text x="150" y="${sealY + 6}" text-anchor="middle" font-size="16" fill="#fff" fill-opacity=".85">${s.glyph}</text>
      </svg>
      <svg viewBox="0 0 300 160" class="flap-in"><path d="${f.d}" fill="${s.liner}"/><path d="${f.d}" fill="#000" opacity=".06"/></svg>
    </div>
    ${scorched ? '<div class="embers"><b></b><b></b><b></b></div><div class="smoke"><b></b><b></b><b></b></div>' : ''}
  </div>`;
}

// Malá obálka do kalendáře.
export function envelopeIcon(week, { scorched = false } = {}) {
  const s = styleOf(week);
  const f = FLAPS[s.flapKey];
  const id = `i${week}`;
  return `<svg class="env-icon" viewBox="0 0 300 200" aria-hidden="true">
    <defs>${CHAR.replace(/id="ch/g, `id="${id}ch`)}</defs>
    <rect width="300" height="200" rx="16" fill="${s.body}"/>
    <path d="${f.d}" fill="${s.flap}" stroke="#000" stroke-opacity=".12" stroke-width="3"/>
    <circle cx="150" cy="${Math.max(f.tip - 14, 40)}" r="22" fill="${s.seal}"/>
    ${scorched ? `<rect width="300" height="200" rx="16" fill="url(#${id}chA)"/><rect width="300" height="200" rx="16" fill="url(#${id}chB)"/><rect width="300" height="200" rx="16" fill="url(#${id}chC)"/>` : ''}
  </svg>`;
}

export const ashIcon = `<svg class="ash-icon" viewBox="0 0 120 70" aria-hidden="true">
  <ellipse cx="60" cy="60" rx="52" ry="8" fill="#000" opacity=".18"/>
  <path d="M10,60 C22,44 34,48 44,34 C52,22 62,26 70,36 C80,48 96,44 110,60 Z" fill="#6f6862"/>
  <path d="M26,60 C36,50 44,52 52,42 C58,36 66,38 72,46 C80,54 90,52 98,60 Z" fill="#8d867f"/>
  <circle cx="40" cy="50" r="2" fill="#3b3632"/><circle cx="66" cy="44" r="2.4" fill="#3b3632"/><circle cx="82" cy="54" r="1.8" fill="#3b3632"/>
  <circle cx="56" cy="54" r="1.6" fill="#b8b0a8"/><circle cx="74" cy="56" r="1.4" fill="#b8b0a8"/>
</svg>`;

export const flaskIcon = (full = true) => `<svg class="flask" viewBox="0 0 40 56" aria-hidden="true">
  <path d="M15,4 h10 v14 l11,22 a9,9 0 0 1 -8,13 h-16 a9,9 0 0 1 -8,-13 l11,-22 z" fill="${full ? '#dff3fb' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" opacity="${full ? 1 : 0.45}"/>
  ${full ? '<path d="M9.5,36 l-4,8 a6.5,6.5 0 0 0 6,9 h17 a6.5,6.5 0 0 0 6,-9 l-4,-8 z" fill="#3aa0d8"/><circle cx="17" cy="44" r="2" fill="#fff" opacity=".8"/><circle cx="24" cy="40" r="1.3" fill="#fff" opacity=".8"/>' : ''}
  <rect x="13" y="1.5" width="14" height="5" rx="2" fill="currentColor" opacity="${full ? 1 : 0.45}"/>
</svg>`;

// Obyčejná papírová krabice. Nahoře vykukují vršky dopisů, které v ní ještě zbývají.
function topsSvg(weeks) {
  return weeks.slice().sort((a, b) => b - a).map((w) => {
    const s = styleOf(w), k = w - 1;
    const row = 3 - Math.floor(k / 13), col = (k * 5) % 13;
    const x = 31 + col * 14.6 + (row % 2) * 7 + ((w * 7) % 4), y = -14 + row * 11 + ((w * 13) % 5);
    const f = FLAPS[s.flapKey];
    return `<g transform="translate(${x.toFixed(1)} ${y}) rotate(${((w * 37) % 7) - 3} 30 50) scale(.2)">
      <rect width="300" height="260" rx="12" fill="${s.body}" stroke="#000" stroke-opacity=".16" stroke-width="4"/>
      <path d="${f.d}" fill="${s.flap}" stroke="#000" stroke-opacity=".16" stroke-width="4"/>
      <circle cx="150" cy="${Math.max(f.tip - 14, 40)}" r="18" fill="${s.seal}"/></g>`;
  }).join('');
}
export function boxHtml(remaining = []) {
  return `
  <div class="box">
    <svg class="box-back" viewBox="0 0 320 210">
      <path d="M34,30 L286,30 L296,2 L24,2 Z" fill="#c7a273"/><path d="M34,30 L286,30 L296,2 L24,2 Z" fill="none" stroke="#8c6a43" stroke-opacity=".5"/>
      <rect x="26" y="28" width="268" height="80" fill="#7a5a3a"/>
      <rect x="26" y="28" width="268" height="80" fill="#000" opacity=".18"/>
      ${topsSvg(remaining)}
    </svg>
    <div class="box-slot"></div>
    <svg class="box-front" viewBox="0 0 320 210">
      <defs><linearGradient id="cb" x1="0" x2="1"><stop offset="0" stop-color="#b98f5e"/><stop offset=".5" stop-color="#cba476"/><stop offset="1" stop-color="#b38957"/></linearGradient>
      <pattern id="corr" width="5" height="6" patternUnits="userSpaceOnUse"><path d="M0,6 L2.5,0 L5,6" fill="none" stroke="#7d5c38" stroke-width="1"/></pattern></defs>
      <path d="M26,54 L4,74 L4,98 L26,84 Z" fill="#a98152"/><path d="M294,54 L316,74 L316,98 L294,84 Z" fill="#a98152"/>
      <rect x="26" y="52" width="268" height="150" rx="3" fill="url(#cb)"/>
      <rect x="26" y="52" width="268" height="6" fill="#e0c39a"/><rect x="26" y="52" width="268" height="6" fill="url(#corr)" opacity=".7"/>
      <path d="M40,58 H280 L270,92 H50 Z" fill="#b08655"/><path d="M50,92 H270" stroke="#000" stroke-opacity=".18" stroke-width="2"/>
      <rect x="141" y="92" width="38" height="110" fill="#e8d7b5" opacity=".55"/>
      <g stroke="#6b4c2c" stroke-opacity=".12" stroke-width="1"><path d="M26,120 H294 M26,150 H294 M26,180 H294"/></g>
      <path d="M258,176 c-7,-5 -11,-9 -11,-13.5 a6,6 0 0 1 11,-2.5 a6,6 0 0 1 11,2.5 c0,4.5 -4,8.5 -11,13.5 z" fill="none" stroke="#7b4a34" stroke-width="2.2" stroke-linejoin="round" opacity=".7"/>
    </svg>
    <div class="box-smoke smoke"><b></b><b></b><b></b></div>
  </div>`;
}
