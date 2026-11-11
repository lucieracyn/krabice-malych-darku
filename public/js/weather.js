// Živé počasí na pozadí. Město se mění podle měsíce (českého času).

const CITIES = {
  paris: { name: 'Paříž', lat: 48.8566, lon: 2.3522 },
  rotterdam: { name: 'Rotterdam', lat: 51.9244, lon: 4.4777 },
  vienna: { name: 'Vídeň', lat: 48.2082, lon: 16.3738 },
  nyc: { name: 'New York', lat: 40.7128, lon: -74.006 },
};
function cityFor(ms) {
  const month = +new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', month: 'numeric' }).format(new Date(ms));
  if (month === 11) return CITIES.paris;
  if (month === 12 || month === 1) return CITIES.rotterdam;
  if (month >= 2 && month <= 4) return CITIES.vienna;
  return CITIES.nyc;
}
function kindOf(code) {
  if (code === 0) return ['clear', 'jasno'];
  if (code <= 2) return ['partly', 'polojasno'];
  if (code === 3) return ['cloudy', 'zataženo'];
  if (code <= 48) return ['fog', 'mlha'];
  if (code <= 57) return ['drizzle', 'mrholí'];
  if (code <= 67 || (code >= 80 && code <= 82)) return ['rain', 'prší'];
  if (code <= 77 || code === 85 || code === 86) return ['snow', 'sněží'];
  return ['storm', 'bouřka'];
}
const SKY = {
  'clear-day': ['#4f9fdc', '#a9d5f2', '#e6f3fb'], 'partly-day': ['#5d9fd0', '#b4d3e8', '#e9f1f6'],
  'cloudy-day': ['#8798a6', '#b7c3cb', '#dfe5e8'], 'fog-day': ['#a3acb2', '#c6cccf', '#e3e5e6'],
  'drizzle-day': ['#74889a', '#a3b2bd', '#cfd7dc'], 'rain-day': ['#5b6f82', '#8b9ba8', '#bcc6cd'],
  'snow-day': ['#9fb0c0', '#c9d4dd', '#eef2f5'], 'storm-day': ['#3c4656', '#626d7d', '#929aa6'],
  'clear-night': ['#070d24', '#152250', '#34427a'], 'partly-night': ['#0a1128', '#1b274f', '#3a466f'],
  'cloudy-night': ['#131926', '#252d3f', '#434b5c'], 'fog-night': ['#1b2029', '#343a45', '#555b65'],
  'drizzle-night': ['#0f1622', '#222c3c', '#3d4757'], 'rain-night': ['#0c121d', '#1c2534', '#36404f'],
  'snow-night': ['#18203a', '#343f5e', '#66708a'], 'storm-night': ['#090c14', '#1a1f2c', '#333947'],
};

let W = { kind: 'cloudy', day: true, label: '', temp: null, city: '' };
let cv, ctx, parts = [], stars = [], raf = 0, flash = 0, dpr = 1;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function load(now) {
  const city = cityFor(now);
  const force = new URLSearchParams(location.search).get('pocasi');
  if (force) {
    const [kind, tod] = force.split('-');
    return { kind, day: tod !== 'night', label: 'ukázka', temp: 7, city: city.name };
  }
  try {
    const cached = JSON.parse(sessionStorage.getItem('kmd-weather') || 'null');
    if (cached && cached.city === city.name && Date.now() - cached.at < 20 * 60000) return cached;
  } catch {}
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`);
    const c = (await res.json()).current;
    const [kind, label] = kindOf(c.weather_code);
    const w = { kind, day: !!c.is_day, label, temp: Math.round(c.temperature_2m), city: city.name, at: Date.now() };
    try { sessionStorage.setItem('kmd-weather', JSON.stringify(w)); } catch {}
    return w;
  } catch {
    const h = new Date().getHours();
    return { kind: 'cloudy', day: h >= 7 && h < 18, label: '', temp: null, city: city.name };
  }
}

function seed() {
  const w = cv.width, h = cv.height;
  parts = [];
  stars = [];
  const n = reduce ? 0.3 : 1;
  const count = { rain: 110, storm: 150, drizzle: 50, snow: 90 }[W.kind] || 0;
  for (let i = 0; i < count * n; i++) parts.push({ x: Math.random() * w, y: Math.random() * h, z: 0.4 + Math.random() * 0.6, p: Math.random() * 6.28 });
  if (!W.day && ['clear', 'partly'].includes(W.kind)) for (let i = 0; i < 70; i++) stars.push({ x: Math.random() * w, y: Math.random() * h * 0.7, r: (0.5 + Math.random()) * dpr, p: Math.random() * 6.28 });
}
function frame(t) {
  raf = requestAnimationFrame(frame);
  if (document.hidden) return;
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  for (const s of stars) {
    ctx.globalAlpha = 0.45 + 0.45 * Math.sin(t / 900 + s.p);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (W.kind === 'snow') {
    ctx.fillStyle = '#fff';
    for (const p of parts) {
      p.y += (0.5 + p.z) * dpr; p.x += Math.sin(t / 1100 + p.p) * 0.5 * dpr;
      if (p.y > h) { p.y = -5; p.x = Math.random() * w; }
      ctx.globalAlpha = 0.5 + p.z * 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, (1 + p.z * 2.2) * dpr, 0, 6.28); ctx.fill();
    }
  } else if (parts.length) {
    const drizzle = W.kind === 'drizzle';
    ctx.strokeStyle = W.day ? 'rgba(235,243,250,.6)' : 'rgba(190,210,235,.45)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (const p of parts) {
      const v = (drizzle ? 5 : 13) * p.z * dpr, len = (drizzle ? 7 : 17) * p.z * dpr;
      p.y += v; p.x -= v * 0.18;
      if (p.y > h) { p.y = -20; p.x = Math.random() * (w * 1.2); }
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + len * 0.18, p.y - len);
    }
    ctx.stroke();
  }
  if (W.kind === 'storm' && !reduce) {
    if (flash <= 0 && Math.random() < 0.0035) flash = 1;
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      flash -= 0.06;
    }
  }
  ctx.globalAlpha = 1;
}

function paint() {
  const sky = document.getElementById('sky');
  const key = `${W.kind}-${W.day ? 'day' : 'night'}`;
  const g = SKY[key] || SKY['cloudy-day'];
  sky.style.background = `linear-gradient(180deg, ${g[0]} 0%, ${g[1]} 55%, ${g[2]} 100%)`;
  sky.dataset.kind = W.kind;
  sky.dataset.tod = W.day ? 'day' : 'night';
  document.body.dataset.tone = W.day && !['storm', 'rain'].includes(W.kind) ? 'light' : 'dark';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', g[0]);
  const clouds = { clear: 0, partly: 3, cloudy: 6, fog: 5, drizzle: 6, rain: 7, snow: 6, storm: 8 }[W.kind];
  sky.querySelector('.clouds').innerHTML = Array.from({ length: clouds }, (_, i) =>
    `<i style="top:${(i * 37) % 52}%;--w:${150 + ((i * 71) % 170)}px;--d:${48 + ((i * 29) % 60)}s;--o:${-((i * 17) % 60)}s"></i>`).join('');
  const chip = document.getElementById('weather-chip');
  chip.textContent = [W.city, W.temp === null ? '' : `${W.temp} °C`, W.label].filter(Boolean).join(' · ');
  seed();
}

export async function startWeather(now) {
  cv = document.getElementById('sky-canvas');
  ctx = cv.getContext('2d');
  const size = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    seed();
  };
  addEventListener('resize', size);
  size();
  W = await load(now);
  paint();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}
