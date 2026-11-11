import { envelopeHtml, envelopeIcon, ashIcon, flaskIcon, boxHtml } from './envelope.js';
import { startWeather } from './weather.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const PREVIEW = +params.get('nahled') || 0;
const REACTIONS = ['❤️', '🥹', '😂', '😘', '🔥', '👏'];
const TYPE_NAMES = {
  dopis: 'Dopis', vzpominka: 'Vzpomínka', pozvanka: 'Pozvánka', vyzva: 'Výzva', kupon: 'Kupón',
  otazka: 'Otázka', stopa: 'Stopa', pisnicka: 'Písnička', vyber: 'Výběr pro tebe',
};

let S = null; // stav ze serveru
let skew = 0; // rozdíl mezi hodinami serveru a telefonu
let tab = 'home';
let ticker = 0;
let sheetWeek = 0;
const now = () => Date.now() + skew;

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Něco se pokazilo.'), { status: res.status });
  return data;
}
async function refresh() {
  S = await api('state');
  skew = S.now - Date.now();
  return S;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3200);
}
const fmtDay = (ms) => new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' }).format(new Date(ms));

// ---------- odpočet ----------
const PLURALS = [['den', 'dny', 'dní'], ['hodina', 'hodiny', 'hodin'], ['minuta', 'minuty', 'minut'], ['vteřina', 'vteřiny', 'vteřin']];
function countdownHtml() {
  return `<div class="countdown" aria-live="off">${['dní', 'hodin', 'minut', 'vteřin'].map((l) => `<div><b>0</b><span>${l}</span></div>`).join('')}</div>`;
}
function runCountdown(root, target, onZero) {
  clearInterval(ticker);
  const cells = root.querySelectorAll('.countdown b');
  if (!cells.length) return;
  const tick = () => {
    let left = Math.max(0, target - now());
    const d = Math.floor(left / 86400000); left -= d * 86400000;
    const h = Math.floor(left / 3600000); left -= h * 3600000;
    const m = Math.floor(left / 60000); left -= m * 60000;
    [d, h, m, Math.floor(left / 1000)].forEach((v, i) => {
      cells[i].textContent = i ? String(v).padStart(2, '0') : v;
      cells[i].nextElementSibling.textContent = PLURALS[i][v === 1 ? 0 : v >= 2 && v <= 4 ? 1 : 2];
    });
    if (target - now() <= 0) { clearInterval(ticker); onZero?.(); }
  };
  tick();
  ticker = setInterval(tick, 1000);
}

// ---------- PIN ----------
function askPin(title = 'Zadej PIN') {
  return new Promise((resolve) => {
    const o = $('#overlay');
    let value = '';
    o.hidden = false;
    o.innerHTML = `<div class="pinpad card">
      <h2>${title}</h2><div class="dots"></div><p class="pin-msg"></p>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="x" class="ghost">Zpět</button><button data-k="0">0</button><button data-k="ok" class="ghost">OK</button></div></div>`;
    const dots = $('.dots', o), msg = $('.pin-msg', o);
    const draw = () => (dots.innerHTML = Array.from({ length: Math.max(4, value.length) }, (_, i) => `<i class="${i < value.length ? 'on' : ''}"></i>`).join(''));
    const done = (v) => { o.hidden = true; o.innerHTML = ''; resolve(v); };
    const submit = async () => {
      try {
        await api('pin', { method: 'POST', body: { pin: value } });
        done(value);
      } catch (e) {
        msg.textContent = e.message;
        $('.pinpad', o).classList.add('shake');
        setTimeout(() => $('.pinpad', o)?.classList.remove('shake'), 500);
        value = '';
        draw();
      }
    };
    draw();
    o.onclick = (e) => {
      if (e.target === o) return done(null);
      const k = e.target.closest('button')?.dataset.k;
      if (!k) return;
      msg.textContent = '';
      if (k === 'x') { if (!value) return done(null); value = value.slice(0, -1); }
      else if (k === 'ok') { if (value.length >= 4) submit(); return; }
      else if (value.length < 8) value += k;
      draw();
      if (value.length === (S.pinLen || 99)) submit();
    };
  });
}
async function ensureSession() {
  if (S.session || S.admin) return true;
  const pin = await askPin();
  if (!pin) return false;
  await refresh();
  return true;
}

// ---------- domovská obrazovka ----------
function available() {
  const out = [];
  const cur = S.weeks[S.current - 1];
  if (cur && ['fresh', 'smoldering'].includes(cur.status)) out.push(cur);
  for (const w of S.weeks) if (w.status === 'revived') out.push(w);
  return out;
}

function renderHome({ flyIn = false } = {}) {
  const v = $('#view');
  const seen = store.get('kmd-burn-seen', []);
  const burned = S.weeks.filter((w) => w.status === 'burned' && !seen.includes(w.week));
  if (burned.length && !PREVIEW) {
    store.set('kmd-burn-seen', [...seen, ...burned.map((w) => w.week)]);
    return playBurn(burned[burned.length - 1].week, () => renderHome({ flyIn: true }));
  }
  const avail = available()[0];
  const cur = S.weeks[S.current - 1];
  const next = S.next;
  let eyebrow = 'Krabice malých dárků', title = '', extra = '', scorched = false;

  if (avail) {
    scorched = avail.status !== 'fresh';
    eyebrow = `Dopis č. ${avail.week} z ${S.total}`;
    title = { fresh: 'Něco na tebe čeká', smoldering: 'Dopis začíná doutnat', revived: 'Dopis vstal z popela' }[avail.status];
    extra = `${avail.status === 'smoldering' ? `<p class="hint">Otevři ho do neděle, o půlnoci shoří.</p>` : ''}
      <button class="btn primary" id="go">Zadat PIN</button>`;
  } else {
    if (S.current === 0) title = 'První dopis dorazí za';
    else if (!next) { title = 'Krabice je dočtená'; extra = '<p class="hint">Všechny dopisy najdeš v kalendáři.</p>'; }
    else if (cur.status === 'empty') { eyebrow = 'Tento týden krabice odpočívá'; title = 'Další dopis dorazí za'; }
    else { eyebrow = cur.status === 'opened' ? `Dopis č. ${cur.week} je přečtený` : `Dopis č. ${cur.week}`; title = 'Další dopis dorazí za'; }
    if (next) {
      extra = `${countdownHtml()}
        ${next.teaser ? `<div class="teaser card"><span>Příště</span><p>${esc(next.teaser)}</p></div>` : ''}
        ${cur?.status === 'opened' ? '<button class="btn ghost" id="reread">Přečíst znovu</button>' : ''}`;
    }
  }
  v.innerHTML = `<section class="home">
    <header class="hero"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></header>
    <div class="scene${avail ? ' ready' : ''}${scorched ? ' smoldering' : ''}${flyIn && avail ? ' fly' : ''}">${boxHtml()}</div>
    <div class="cta">${extra}</div>
    <div id="nudge"></div>
  </section>`;
  if (avail) $('.box-slot', v).innerHTML = envelopeHtml(avail.week, { scorched });
  if (next && !avail) runCountdown(v, next.release, async () => { await sleep(1200); await refresh(); renderHome({ flyIn: true }); });
  $('#go')?.addEventListener('click', () => openFlow(avail));
  $('#reread')?.addEventListener('click', () => openArchived(cur.week));
  renderNudge();
}

async function openFlow(wk) {
  const pin = await askPin(`PIN k dopisu č. ${wk.week}`);
  if (!pin) return;
  const scene = $('.scene');
  const cta = $('.cta');
  cta.innerHTML = '';
  scene.classList.remove('ready', 'fly');
  scene.classList.add('lid');
  await sleep(650);
  scene.classList.add('up');
  await sleep(1000);
  cta.innerHTML = '<button class="btn primary pop" id="open">Otevřít dopis</button>';
  $('#open').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const letter = await api('open', { method: 'POST', body: { week: wk.week, pin } });
      cta.innerHTML = '';
      $('.home').classList.add('opening');
      $('.env', scene).classList.add('open');
      await sleep(1500);
      await showSheet(letter, { fresh: true });
      if (letter.gainedWater) toast('Za pět dopisů včas máš novou živou vodu.');
      await refresh();
      renderHome();
    } catch (err) {
      toast(err.message);
      await refresh();
      renderHome();
    }
  };
}

async function openArchived(week) {
  try {
    showSheet(await api(`letter/${week}`));
  } catch (e) {
    if (e.status === 401 && (await ensureSession())) return openArchived(week);
    toast(e.message);
  }
}

// ---------- hoření ----------
function playBurn(week, done) {
  const o = $('#overlay');
  o.hidden = false;
  o.onclick = null;
  o.innerHTML = `<div class="burn-scene">
    <p class="eyebrow">Dopis č. ${week}</p>
    <div class="burn-stage">${envelopeHtml(week, { scorched: true })}<div class="ash-wrap">${ashIcon}</div><canvas class="fire"></canvas></div>
    <div class="burn-text"><h2>Dopis shořel</h2><p>Zůstal moc dlouho neotevřený. V kalendáři po něm zbyla hromádka popela – a živá voda ji umí vzkřísit.</p>
    <button class="btn primary">Dál</button></div></div>`;
  const stage = $('.burn-stage', o), env = $('.env', o), cv = $('.fire', o), ash = $('.ash-wrap', o);
  const ctx = cv.getContext('2d');
  const r = stage.getBoundingClientRect();
  cv.width = r.width; cv.height = r.height;
  const er = env.getBoundingClientRect();
  const ex = er.left - r.left, ey = er.top - r.top;
  const parts = [];
  const T = 3400, t0 = performance.now() + 900;
  const frame = (t) => {
    const p = Math.min(1, Math.max(0, (t - t0) / T));
    const line = ey + er.height * (1 - p);
    env.style.clipPath = `inset(-40% -10% ${p * 100}% -10%)`;
    env.style.filter = `brightness(${1 - p * 0.55})`;
    ash.style.transform = `translateX(-50%) scale(${0.2 + p * 0.8})`;
    ash.style.opacity = Math.min(1, p * 3);
    if (p > 0 && p < 1) for (let i = 0; i < 7; i++) parts.push({ x: ex + Math.random() * er.width, y: line + Math.random() * 6, vx: (Math.random() - 0.5) * 0.8, vy: -1.2 - Math.random() * 2.4, life: 1, r: 6 + Math.random() * 12 });
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.x += q.vx; q.y += q.vy; q.life -= 0.022; q.r *= 0.985;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
      const c = q.life > 0.6 ? '255,220,120' : q.life > 0.3 ? '255,130,40' : '150,50,30';
      g.addColorStop(0, `rgba(${c},${q.life * 0.6})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.28); ctx.fill();
    }
    if (p < 1 || parts.length) requestAnimationFrame(frame);
    else { env.style.visibility = 'hidden'; $('.burn-scene', o).classList.add('done'); }
  };
  requestAnimationFrame(frame);
  $('.btn', o).onclick = () => { o.hidden = true; o.innerHTML = ''; done(); };
}

// ---------- čtení dopisu ----------
const mediaUrl = (id) => `/api/media/${id}`;
function textHtml(text) {
  return String(text || '').trim().split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
function mediaHtml(list = []) {
  return list.map((m, i) => {
    const cap = m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '';
    if (m.kind === 'audio') return `<figure class="audio"><audio controls preload="metadata" src="${mediaUrl(m.id)}"></audio>${cap}</figure>`;
    if (m.kind === 'video') return `<figure class="video"><video controls playsinline preload="metadata" src="${mediaUrl(m.id)}"></video>${cap}</figure>`;
    return `<figure class="photo" style="--r:${[-1.6, 1.2, -0.7, 1.8][i % 4]}deg"><img src="${mediaUrl(m.id)}" alt="" loading="lazy">${cap}</figure>`;
  }).join('');
}
function fmtWhen(v) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(v || '');
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(d);
}
function actionBtn(L, value, label, doneLabel) {
  const done = L.actions.includes(value);
  return `<button class="btn ${done ? 'done' : 'primary'}" data-action="${value}" data-done="${esc(doneLabel)}" ${done ? 'disabled' : ''}>${done ? esc(doneLabel) : esc(label)}</button>`;
}
function typeBlock(L, wished) {
  const b = L.body;
  switch (L.type) {
    case 'pozvanka':
      return `<div class="ticket"><dl>${b.when ? `<dt>Kdy</dt><dd>${esc(fmtWhen(b.when))}</dd>` : ''}${b.where ? `<dt>Kde</dt><dd>${esc(b.where)}</dd>` : ''}</dl>
        <div class="row">${actionBtn(L, 'rsvp:yes', 'Přijdu', 'Přijdu ✓')}${b.when ? `<a class="btn ghost" href="/api/ics/${L.week}">Přidat do kalendáře</a>` : ''}</div></div>`;
    case 'vyzva': return `<div class="row">${actionBtn(L, 'done', 'Splněno', 'Splněno ✓')}</div>`;
    case 'kupon': return `<div class="ticket coupon"><p class="eyebrow">Kupón</p><h3>${esc(b.what || L.title)}</h3>${b.valid ? `<p class="small">${esc(b.valid)}</p>` : ''}
        <div class="row">${actionBtn(L, 'redeem', 'Uplatnit kupón', 'Uplatněno ✓')}</div></div>`;
    case 'stopa': return `<div class="row">${actionBtn(L, 'found', 'Našel jsem to', 'Nalezeno ✓')}</div>`;
    case 'pisnicka': return b.link ? `<div class="ticket"><h3>${esc(b.song || 'Písnička pro tebe')}</h3><div class="row"><a class="btn primary" href="${esc(b.link)}" target="_blank" rel="noopener">▶ Pustit</a></div></div>` : '';
    case 'vyber':
      return `<div class="picks">${(b.items || []).map((it, i) => {
        const on = wished.has(it.title);
        return `<div class="pick">${it.media ? `<img src="${mediaUrl(it.media)}" alt="">` : '<div class="noimg">♪</div>'}
          <div><h3>${esc(it.title)}</h3>${it.detail ? `<p class="small">${esc(it.detail)}</p>` : ''}${it.note ? `<p>${esc(it.note)}</p>` : ''}
          <div class="row">${it.link ? `<a class="btn ghost sm" href="${esc(it.link)}" target="_blank" rel="noopener">Poslechnout</a>` : ''}
          <button class="btn sm ${on ? 'done' : 'primary'}" data-wish="${i}" ${on ? 'disabled' : ''}>${on ? 'Ve wishlistu ✓' : '♡ Do wishlistu'}</button></div></div></div>`;
      }).join('')}</div>`;
    default: return '';
  }
}

async function showSheet(L, { fresh = false, preview = false } = {}) {
  sheetWeek = L.week;
  const b = L.body || {};
  const wished = new Set();
  if (L.type === 'vyber' && !preview) {
    try { for (const it of (await api('wishlist')).items) if (it.week === L.week) wished.add(it.title); } catch {}
  }
  const photosFirst = L.type === 'vzpominka';
  const meta = [b.memWhen, b.memWhere].filter(Boolean).join(' · ');
  const isCurrent = S && L.week === S.current && S.next;
  const sheet = $('#sheet'), body = $('#sheet-body');
  body.className = `paper${L.scorched ? ' scorched' : ''}`;
  body.innerHTML = `
    <p class="eyebrow">${esc(TYPE_NAMES[L.type] || 'Dopis')} · č. ${L.week}${L.revived ? ' · vzkříšený' : L.scorched ? ' · očouzený' : ''}</p>
    ${L.title ? `<h1>${esc(L.title)}</h1>` : ''}
    ${meta ? `<p class="meta">${esc(meta)}</p>` : ''}
    ${photosFirst ? mediaHtml(b.media) : ''}
    <div class="text">${textHtml(b.text)}</div>
    ${b.signature ? `<p class="signature">${esc(b.signature)}</p>` : ''}
    ${photosFirst ? '' : mediaHtml(b.media)}
    ${typeBlock(L, wished)}
    <div id="end-mark"></div>
    <section class="endzone">
      <div class="reactions">${REACTIONS.map((r) => `<button data-react="${r}" class="${L.reactions?.includes(r) ? 'on' : ''}">${r}</button>`).join('')}</div>
      <div class="notes">${(L.notes || []).map((n) => `<p class="note">${esc(n.text).replace(/\n/g, '<br>')}</p>`).join('')}</div>
      <form class="note-form"><textarea rows="2" placeholder="${L.type === 'otazka' ? 'Tvoje odpověď…' : 'Chceš něco odepsat?'}"></textarea><button class="btn primary sm" type="submit">Poslat</button></form>
      ${isCurrent ? `<div class="teaser"><span>Příště</span>${S.next.teaser ? `<p>${esc(S.next.teaser)}</p>` : ''}${countdownHtml()}</div>` : ''}
    </section>`;
  sheet.hidden = false;
  sheet.classList.toggle('fresh', fresh);
  $('#sheet-scroll').scrollTop = 0;
  requestAnimationFrame(() => sheet.classList.add('show'));
  if (isCurrent) runCountdown(body, S.next.release);

  // Reakce a odpověď se objeví až po dočtení.
  const opened = Date.now();
  const end = $('.endzone', body);
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    setTimeout(() => end.classList.add('show'), Math.max(500, (fresh ? 4000 : 800) - (Date.now() - opened)));
  }, { root: $('#sheet-scroll'), threshold: 0.9 });
  io.observe($('#end-mark', body));

  body.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (preview) return toast('V náhledu se nic neukládá.');
    try {
      if (t.dataset.react) {
        const on = !t.classList.contains('on');
        t.classList.toggle('on', on);
        if (on) { t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump'); }
        await api('react', { method: 'POST', body: { week: L.week, value: t.dataset.react, on } });
      } else if (t.dataset.action) {
        t.disabled = true;
        await api('action', { method: 'POST', body: { week: L.week, value: t.dataset.action } });
        t.textContent = t.dataset.done;
        t.className = 'btn done';
      } else if (t.dataset.wish) {
        const it = b.items[+t.dataset.wish];
        t.disabled = true;
        await api('wishlist', { method: 'POST', body: { week: L.week, title: it.title, detail: it.detail, link: it.link, media: it.media } });
        t.textContent = 'Ve wishlistu ✓';
        t.className = 'btn sm done';
      }
    } catch (err) { toast(err.message); t.disabled = false; }
  };
  $('.note-form', body).onsubmit = async (e) => {
    e.preventDefault();
    const ta = $('textarea', e.target), value = ta.value.trim();
    if (!value) return;
    if (preview) return toast('V náhledu se nic neukládá.');
    try {
      await api('note', { method: 'POST', body: { week: L.week, value } });
      $('.notes', body).insertAdjacentHTML('beforeend', `<p class="note">${esc(value).replace(/\n/g, '<br>')}</p>`);
      ta.value = '';
      toast('Odesláno.');
    } catch (err) { toast(err.message); }
  };
  return new Promise((resolve) => {
    $('#sheet-close').onclick = () => {
      sheet.classList.remove('show');
      body.querySelectorAll('audio,video').forEach((m) => m.pause());
      setTimeout(() => { sheet.hidden = true; body.innerHTML = ''; resolve(); if (tab === 'home' && !PREVIEW) renderHome(); }, 350);
    };
  });
}

// ---------- kalendář ----------
const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
function renderCalendar() {
  const v = $('#view');
  const byDate = {};
  S.weeks.forEach((w) => {
    const d = new Date(Date.UTC(2026, 10, 16 + 7 * (w.week - 1)));
    byDate[`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`] = w;
  });
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(now()));
  const today = `${p.find((x) => x.type === 'year').value}-${+p.find((x) => x.type === 'month').value - 1}-${+p.find((x) => x.type === 'day').value}`;
  let html = `<section class="calendar"><header class="hero"><p class="eyebrow">Kalendář</p><h1>Rok v krabici</h1></header>
    <div class="water card"><div class="flasks">${Array.from({ length: S.waterMax }, (_, i) => flaskIcon(i < S.water)).join('')}</div>
    <p><b>Živá voda: ${S.water} z ${S.waterMax}</b><br>Uhasí a vzkřísí shořelý dopis. Další získáš za pět dopisů otevřených včas po sobě.</p></div>`;
  for (let i = 0; i < 13; i++) {
    const y = 2026 + Math.floor((10 + i) / 12), m = (10 + i) % 12;
    const first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    if (i === 12 && !Object.keys(byDate).some((k) => k.startsWith(`${y}-${m}-`))) continue;
    html += `<div class="month card" id="m-${y}-${m}"><h2>${MONTHS[m]} ${y}</h2><div class="grid">${['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((d) => `<span class="dow">${d}</span>`).join('')}${'<span></span>'.repeat(first)}`;
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${m}-${d}`, w = byDate[key];
      const cls = key === today ? ' today' : '';
      if (!w) { html += `<span class="day${cls}"><em>${d}</em></span>`; continue; }
      let icon = '<i class="dot"></i>';
      if (w.status === 'opened') icon = envelopeIcon(w.week, { scorched: w.scorched });
      else if (w.status === 'burned') icon = ashIcon;
      else if (['fresh', 'smoldering', 'revived'].includes(w.status)) icon = `<i class="pulse"></i>${envelopeIcon(w.week, { scorched: w.status !== 'fresh' })}`;
      else if (w.status === 'future') icon = '<svg class="env-icon ghost" viewBox="0 0 300 200"><rect x="6" y="6" width="288" height="188" rx="16"/><path d="M6,10 L150,110 L294,10"/></svg>';
      html += `<button class="day has ${w.status}${cls}" data-week="${w.week}" aria-label="Dopis č. ${w.week}"><em>${d}</em>${icon}</button>`;
    }
    html += '</div></div>';
  }
  v.innerHTML = html + '</section>';
  v.querySelector('.calendar').onclick = async (e) => {
    const b = e.target.closest('button[data-week]');
    if (!b) return;
    const w = S.weeks[+b.dataset.week - 1];
    if (w.status === 'opened') openArchived(w.week);
    else if (w.status === 'burned') reviveDialog(w);
    else if (w.status === 'future') toast(`Tenhle dopis dorazí ${fmtDay(w.release)}.`);
    else if (w.status === 'empty') toast('Tenhle týden krabice odpočívala.');
    else switchTab('home');
  };
  const cur = v.querySelector('.day.today')?.closest('.month');
  if (cur && cur.previousElementSibling?.classList.contains('month')) cur.scrollIntoView({ block: 'start' });
}

function reviveDialog(w) {
  const o = $('#overlay');
  o.hidden = false;
  o.innerHTML = `<div class="revive card">
    <p class="eyebrow">Dopis č. ${w.week}</p><div class="revive-stage">${ashIcon}</div>
    <h2>Zbyl jen popel</h2>
    <p>${S.water > 0 ? `Živá voda ho uhasí a vzkřísí. Máš ${S.water} z ${S.waterMax}.` : 'Živá voda došla. Novou získáš za pět dopisů otevřených včas po sobě.'}</p>
    <div class="row"><button class="btn ghost" data-x>Nechat být</button>${S.water > 0 ? `<button class="btn primary water-btn" data-go>Polít živou vodou</button>` : ''}</div></div>`;
  o.onclick = async (e) => {
    if (e.target === o || e.target.closest('[data-x]')) { o.hidden = true; o.innerHTML = ''; return; }
    if (!e.target.closest('[data-go]')) return;
    if (!(await ensureSession())) return;
    try {
      e.target.disabled = true;
      const L = await api('revive', { method: 'POST', body: { week: w.week } });
      const stage = $('.revive-stage', o);
      stage.insertAdjacentHTML('beforeend', '<div class="drops"><b></b><b></b><b></b><b></b><b></b></div>');
      await sleep(1300);
      stage.innerHTML = `<div class="reborn">${envelopeIcon(w.week, { scorched: true })}</div>`;
      $('h2', o).textContent = 'Dopis je zpátky';
      await sleep(1400);
      o.hidden = true; o.innerHTML = '';
      await refresh();
      renderCalendar();
      showSheet(L);
    } catch (err) { toast(err.message); }
  };
}

// ---------- wishlist ----------
async function renderWishlist() {
  const v = $('#view');
  v.innerHTML = `<section class="wishlist"><header class="hero"><p class="eyebrow">Wishlist</p><h1>Tvoje přání</h1></header>
    <form class="card add"><input placeholder="Přidat vlastní přání…" maxlength="200"><button class="btn primary sm">Přidat</button></form><div class="list"></div></section>`;
  const list = $('.list', v);
  const draw = (items) => {
    list.innerHTML = items.length ? items.map((it) => `<div class="pick card">${it.media ? `<img src="${mediaUrl(it.media)}" alt="">` : '<div class="noimg">♡</div>'}
      <div><h3>${esc(it.title)}</h3>${it.detail ? `<p class="small">${esc(it.detail)}</p>` : ''}
      <div class="row">${it.link ? `<a class="btn ghost sm" href="${esc(it.link)}" target="_blank" rel="noopener">Otevřít</a>` : ''}<button class="btn ghost sm" data-del="${it.id}">Odebrat</button></div></div></div>`).join('')
      : '<p class="empty">Zatím tu nic není. Co se ti v krabici zalíbí, můžeš si sem uložit – nebo si připiš vlastní přání.</p>';
  };
  try { draw((await api('wishlist')).items); } catch (e) { toast(e.message); }
  $('.add', v).onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('input', e.target);
    if (!inp.value.trim()) return;
    try { draw((await api('wishlist', { method: 'POST', body: { title: inp.value.trim() } })).items); inp.value = ''; } catch (err) { toast(err.message); }
  };
  list.onclick = async (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del;
    if (!id) return;
    try { await api(`wishlist/${id}`, { method: 'DELETE' }); draw((await api('wishlist')).items); } catch (err) { toast(err.message); }
  };
}

// ---------- upozornění a instalace ----------
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function b64ToBytes(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('push/key');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}
function renderNudge() {
  const n = $('#nudge');
  if (!n || PREVIEW) return;
  if (isIos() && !isStandalone() && !store.get('kmd-install-off', false)) {
    n.innerHTML = `<div class="card nudge"><b>Přidej si krabici na plochu</b><p>Klepni dole v Safari na ikonu Sdílet a zvol „Přidat na plochu“. Pak ti budou chodit upozornění na nové dopisy.</p><button class="btn ghost sm" data-off>Teď ne</button></div>`;
    $('[data-off]', n).onclick = () => { store.set('kmd-install-off', true); n.innerHTML = ''; };
    return;
  }
  if (!S.session || !('PushManager' in window) || !('Notification' in window)) return;
  if (Notification.permission === 'granted') { subscribePush().catch(() => {}); return; }
  if (Notification.permission === 'default' && !store.get('kmd-push-off', false)) {
    n.innerHTML = `<div class="card nudge"><b>Zapnout upozornění?</b><p>Dám ti vědět, až do krabice dorazí nový dopis.</p><div class="row"><button class="btn ghost sm" data-off>Teď ne</button><button class="btn primary sm" data-on>Zapnout</button></div></div>`;
    $('[data-off]', n).onclick = () => { store.set('kmd-push-off', true); n.innerHTML = ''; };
    $('[data-on]', n).onclick = async () => {
      try {
        if ((await Notification.requestPermission()) === 'granted') { await subscribePush(); toast('Upozornění jsou zapnutá.'); }
      } catch (e) { toast('Upozornění se nepodařilo zapnout.'); }
      n.innerHTML = '';
    };
  }
}

// ---------- přepínání ----------
async function switchTab(name) {
  if (name !== 'home' && !(await ensureSession())) return;
  tab = name;
  clearInterval(ticker);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#view').scrollTop = 0;
  if (name === 'home') renderHome();
  else if (name === 'calendar') renderCalendar();
  else renderWishlist();
}

// Náhled pro správkyni: /?nahled=3 (a volitelně &stav=doutna nebo &stav=shori)
async function runPreview() {
  const stav = params.get('stav');
  const L = await api(`letter/${PREVIEW}`);
  L.scorched = stav === 'doutna';
  const v = $('#view');
  const play = () => {
    v.innerHTML = `<section class="home"><header class="hero"><p class="eyebrow">Náhled · dopis č. ${PREVIEW}</p><h1>${L.scorched ? 'Dopis začíná doutnat' : 'Něco na tebe čeká'}</h1></header>
      <div class="scene ready${L.scorched ? ' smoldering' : ''}">${boxHtml()}</div><div class="cta"><button class="btn primary" id="go">Otevřít krabici</button></div></section>`;
    $('.box-slot', v).innerHTML = envelopeHtml(PREVIEW, { scorched: L.scorched });
    $('#go').onclick = async () => {
      const scene = $('.scene'), cta = $('.cta');
      cta.innerHTML = '';
      scene.classList.remove('ready'); scene.classList.add('lid');
      await sleep(650); scene.classList.add('up'); await sleep(1000);
      cta.innerHTML = '<button class="btn primary pop" id="open">Otevřít dopis</button>';
      $('#open').onclick = async () => {
        cta.innerHTML = '';
        $('.home').classList.add('opening');
        $('.env', scene).classList.add('open');
        await sleep(1500);
        await showSheet(L, { fresh: true, preview: true });
        play();
      };
    };
  };
  if (stav === 'shori') playBurn(PREVIEW, play); else play();
}

async function boot() {
  try {
    await refresh();
  } catch (e) {
    $('#view').innerHTML = '<section class="home"><header class="hero"><h1>Krabice je teď mimo dosah</h1><p class="hint">Zkus to prosím za chvíli znovu.</p></header></section>';
    return;
  }
  startWeather(now());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };
  if (PREVIEW) {
    $('#tabs').hidden = true;
    return runPreview().catch((e) => ($('#view').innerHTML = `<section class="home"><header class="hero"><h1>Náhled nejde zobrazit</h1><p class="hint">${esc(e.message)} Přihlas se nejdřív na stránce pro vkládání.</p></header></section>`));
  }
  renderHome();
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !$('#sheet').hidden || !$('#overlay').hidden) return;
    try { await refresh(); if (tab === 'home') renderHome(); else if (tab === 'calendar') renderCalendar(); } catch {}
  });
}
boot();
