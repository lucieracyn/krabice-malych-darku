// Minihry: kvíz, pexeso, puzzle, stírací los a oblékání avatarů.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mediaUrl = (id) => `/api/media/${id}`;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const images = (L) => (L.body.media || []).filter((m) => m.kind === 'image');

export const GAME_TYPES = ['kviz', 'pexeso', 'puzzle', 'los', 'oblekani'];
// U těchto her jsou fotky součástí hry, pod textem se už znovu neukazují.
export const usesPhotos = (type) => ['pexeso', 'puzzle', 'los'].includes(type);

export function gameHtml(L) {
  return GAME_TYPES.includes(L.type) ? `<div class="game" data-game="${L.type}"></div>` : '';
}

// api.record(value) uloží výsledek, api.done() ukáže reakce pod dopisem.
export function mountGame(root, L, api) {
  const el = root.querySelector('.game');
  if (!el) return;
  ({ kviz, pexeso, puzzle, los, oblekani })[L.type](el, L, api);
}

// ---------- kvíz ----------
function kviz(el, L, api) {
  const qs = (L.body.questions || []).filter((q) => q.q && (q.options || []).filter(Boolean).length >= 2);
  const prev = L.actions.find((a) => a.startsWith('kvíz: '));
  if (!qs.length) { el.innerHTML = ''; return api.done(); }
  let i = 0, score = 0;
  const finish = (text) => {
    el.innerHTML = `<div class="ticket game-end"><p class="eyebrow">Kvíz</p><h3>${esc(text)}</h3>${L.body.after ? `<p>${esc(L.body.after)}</p>` : ''}<div class="row"><button class="btn ghost sm" data-again>Zahrát znovu</button></div></div>`;
    el.querySelector('[data-again]').onclick = () => { i = 0; score = 0; ask(); };
    api.done();
  };
  const ask = () => {
    const q = qs[i];
    el.innerHTML = `<div class="quiz"><p class="eyebrow">Otázka ${i + 1} z ${qs.length}</p><h3>${esc(q.q)}</h3>
      <div class="opts">${q.options.map((o, k) => (o ? `<button data-k="${k}">${esc(o)}</button>` : '')).join('')}</div><div class="fb"></div></div>`;
    el.querySelector('.opts').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || el.querySelector('.opts').classList.contains('locked')) return;
      el.querySelector('.opts').classList.add('locked');
      const ok = +b.dataset.k === +q.correct;
      if (ok) score++;
      b.classList.add(ok ? 'right' : 'wrong');
      el.querySelector(`[data-k="${+q.correct}"]`)?.classList.add('right');
      el.querySelector('.fb').innerHTML = `<p>${ok ? 'Správně.' : 'Vedle.'} ${esc(q.comment || '')}</p><button class="btn primary sm">${i + 1 < qs.length ? 'Další otázka' : 'Výsledek'}</button>`;
      el.querySelector('.fb button').onclick = () => {
        i++;
        if (i < qs.length) return ask();
        const res = `kvíz: ${score} z ${qs.length}`;
        if (!prev) api.record(res);
        finish(`Máš ${score} z ${qs.length}`);
      };
    };
  };
  if (prev) finish(`Minule: ${prev.slice(6)}`); else ask();
}

// ---------- pexeso ----------
const tahy = (n) => (n === 1 ? 'tah' : n >= 2 && n <= 4 ? 'tahy' : 'tahů');
function pexeso(el, L, api) {
  const pics = images(L).slice(0, 8);
  if (pics.length < 2) { el.innerHTML = ''; return api.done(); }
  const was = L.actions.some((a) => a.startsWith('pexeso'));
  const start = () => {
    const cards = shuffle([...pics, ...pics].map((m, n) => ({ id: m.id, n })));
    let open = [], found = 0, moves = 0, lock = false;
    el.innerHTML = `<div class="pexeso c${cards.length <= 6 ? 3 : 4}">${cards.map((c, k) => `<button data-k="${k}"><span class="back">♥</span><span class="face" style="background-image:url(${mediaUrl(c.id)})"></span></button>`).join('')}</div><p class="small game-info">Najdi všechny dvojice.</p>`;
    el.querySelector('.pexeso').onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b || lock || b.classList.contains('on')) return;
      b.classList.add('on');
      open.push(b);
      if (open.length < 2) return;
      moves++;
      const [a, c] = open;
      open = [];
      if (cards[+a.dataset.k].id === cards[+c.dataset.k].id) {
        a.classList.add('found'); c.classList.add('found');
        if (++found === pics.length) {
          el.querySelector('.game-info').innerHTML = `Hotovo na ${moves} ${tahy(moves)}. <button class="btn ghost sm" data-again>Znovu</button>`;
          el.querySelector('[data-again]').onclick = start;
          if (!was) api.record(`pexeso dohráno na ${moves} ${tahy(moves)}`);
          api.done();
        }
      } else {
        lock = true;
        setTimeout(() => { a.classList.remove('on'); c.classList.remove('on'); lock = false; }, 900);
      }
    };
  };
  start();
  if (was) api.done();
}

// ---------- puzzle ----------
function puzzle(el, L, api) {
  const pic = images(L)[0];
  if (!pic) { el.innerHTML = ''; return api.done(); }
  const n = Math.min(5, Math.max(3, +L.body.grid || 3));
  const was = L.actions.includes('puzzle složeno');
  const img = new Image();
  img.onload = () => {
    const order = [...Array(n * n).keys()];
    if (!was) do shuffle(order); while (order.every((v, k) => v === k));
    let sel = -1, solved = was;
    const draw = () => {
      el.innerHTML = `<div class="puzzle${solved ? ' solved' : ''}" style="aspect-ratio:${img.width}/${img.height};grid-template-columns:repeat(${n},1fr)">${order.map((v, k) =>
        `<button data-k="${k}" class="${k === sel ? 'sel' : ''}" style="background-image:url(${mediaUrl(pic.id)});background-size:${n * 100}% ${n * 100}%;background-position:${((v % n) / (n - 1)) * 100}% ${(Math.floor(v / n) / (n - 1)) * 100}%"></button>`).join('')}</div>
        <p class="small game-info">${solved ? esc(pic.caption || 'Složeno.') : 'Klepni na dva dílky a prohodí se.'}</p>`;
      el.querySelector('.puzzle').onclick = (e) => {
        const b = e.target.closest('button');
        if (!b || solved) return;
        const k = +b.dataset.k;
        if (sel < 0) sel = k;
        else {
          [order[sel], order[k]] = [order[k], order[sel]];
          sel = -1;
          if (order.every((v, x) => v === x)) { solved = true; api.record('puzzle složeno'); api.done(); }
        }
        draw();
      };
    };
    draw();
    if (was) api.done();
  };
  img.src = mediaUrl(pic.id);
  el.innerHTML = '<p class="small game-info">Načítám…</p>';
}

// ---------- stírací los ----------
function los(el, L, api) {
  const pic = images(L)[0];
  const was = L.actions.includes('setřel los');
  el.innerHTML = `<div class="scratch"><div class="prize">${pic ? `<img src="${mediaUrl(pic.id)}" alt="">` : ''}<h3>${esc(L.body.prize || '')}</h3></div>${was ? '' : '<canvas></canvas>'}</div>
    <p class="small game-info">${was ? '' : 'Setři stříbrnou vrstvu prstem.'}</p>`;
  if (was) return api.done();
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const r = cv.getBoundingClientRect();
  cv.width = r.width; cv.height = r.height;
  const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
  g.addColorStop(0, '#b9bcc2'); g.addColorStop(0.5, '#e4e6ea'); g.addColorStop(1, '#a9adb5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(70,74,84,.55)'; ctx.font = '600 15px -apple-system, sans-serif'; ctx.textAlign = 'center';
  for (let y = 26; y < cv.height; y += 46) for (let x = (y / 46) % 2 ? 50 : 100; x < cv.width + 50; x += 110) ctx.fillText('setři mě', x, y);
  ctx.globalCompositeOperation = 'destination-out';
  let down = false, moves = 0, done = false, last = null;
  const at = (e) => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const rub = (e) => {
    const [x, y] = at(e);
    ctx.lineWidth = 44; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(...(last || [x, y])); ctx.lineTo(x + 0.1, y); ctx.stroke();
    last = [x, y];
    if (++moves % 8 || done) return;
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0, total = 0;
    for (let i = 3; i < d.length; i += 4 * 97) { total++; if (d[i] < 40) clear++; }
    if (clear / total > 0.5) {
      done = true;
      cv.classList.add('gone');
      el.querySelector('.game-info').textContent = '';
      api.record('setřel los'); api.done();
    }
  };
  cv.onpointerdown = (e) => { down = true; last = null; cv.setPointerCapture(e.pointerId); rub(e); };
  cv.onpointermove = (e) => { if (down) rub(e); };
  cv.onpointerup = cv.onpointercancel = () => { down = false; };
}

// ---------- oblékání ----------
const OUTFITS = {
  formal: { on: 'Sako', ona: 'Šaty' },
  outdoor: { on: 'Kraťasy a pohorky', ona: 'Kraťasy a pohorky' },
  home: { on: 'Tepláky', ona: 'Tepláky' },
};
const DEFAULT_OUT = {
  formal: { title: 'Jdeme do divadla', text: 'Sako a šaty mluví jasně. Lístky nechej na mně.' },
  outdoor: { title: 'Jedeme na hory', text: 'Pohorky už máš na nohou, tak vyrážíme.' },
  home: { title: 'Zůstáváme doma', text: 'Tepláky, deka a něco dobrého. Vybereme film, nebo budeme něco vyrábět.' },
  mix: { title: 'To bude zajímavé rande', text: 'Každý jsme oblečený na něco jiného. Sejdeme se v půli cesty a necháme se překvapit.' },
};

export function avatarSvg(who, look = {}, outfit = '') {
  const skin = look.skin || '#f0c9a8', hair = look.hair || (who === 'on' ? '#4a3426' : '#7a4a2a');
  const she = who === 'ona';
  const legs = (color, shortTo) => `<rect x="44" y="150" width="14" height="${shortTo || 84}" rx="6" fill="${color}"/><rect x="62" y="150" width="14" height="${shortTo || 84}" rx="6" fill="${color}"/>`;
  const bare = legs(skin);
  const arms = (color) => `<rect x="24" y="84" width="12" height="62" rx="6" fill="${color}"/><rect x="84" y="84" width="12" height="62" rx="6" fill="${color}"/><circle cx="30" cy="148" r="6.5" fill="${skin}"/><circle cx="90" cy="148" r="6.5" fill="${skin}"/>`;
  let body;
  if (outfit === 'formal' && !she) body = `${legs('#2b2f3a')}<rect x="42" y="230" width="18" height="9" rx="4" fill="#15171c"/><rect x="60" y="230" width="18" height="9" rx="4" fill="#15171c"/>
    ${arms('#343a4a')}<path d="M36,84 Q60,74 84,84 L86,156 H34 Z" fill="#343a4a"/><path d="M52,80 L60,112 L68,80 Z" fill="#fff"/><path d="M58,86 h4 l2,24 -4,6 -4,-6 z" fill="#a23b45"/><path d="M52,80 L60,112 L46,96 Z M68,80 L60,112 L74,96 Z" fill="#2a2f3d"/>`;
  else if (outfit === 'formal') body = `${bare}<path d="M44,232 h14 l2,7 h-18 z M62,232 h14 l2,7 h-18 z" fill="#7d2e3a"/>
    ${arms(skin)}<path d="M40,84 Q60,76 80,84 L78,122 L94,196 H26 L42,122 Z" fill="#a23b45"/><path d="M40,84 Q60,100 80,84" fill="none" stroke="#7d2e3a" stroke-width="2"/><rect x="42" y="118" width="36" height="6" fill="#7d2e3a"/>`;
  else if (outfit === 'outdoor') body = `${bare}<rect x="43" y="204" width="16" height="12" fill="#d8d2c4"/><rect x="61" y="204" width="16" height="12" fill="#d8d2c4"/>
    <path d="M40,214 h20 v22 q0,4 -4,4 h-18 q-3,0 -2,-6 z M60,214 h20 l4,20 q1,6 -2,6 h-18 q-4,0 -4,-4 z" fill="#7b5236"/><path d="M38,236 h22 M60,236 h24" stroke="#3a2618" stroke-width="4"/>
    ${arms(skin)}<path d="M36,84 Q60,74 84,84 L84,150 H36 Z" fill="${she ? '#e58a6a' : '#5f8a5a'}"/><rect x="22" y="82" width="16" height="26" rx="7" fill="${she ? '#e58a6a' : '#5f8a5a'}"/><rect x="82" y="82" width="16" height="26" rx="7" fill="${she ? '#e58a6a' : '#5f8a5a'}"/>
    <path d="M38,146 H82 L84,182 H62 L60,166 L58,182 H36 Z" fill="#b9a377"/>`;
  else if (outfit === 'home') body = `${legs('#8a8f9a')}<rect x="43" y="226" width="16" height="6" rx="3" fill="#6d727d"/><rect x="61" y="226" width="16" height="6" rx="3" fill="#6d727d"/><rect x="42" y="231" width="18" height="9" rx="4" fill="#f1ece2"/><rect x="60" y="231" width="18" height="9" rx="4" fill="#f1ece2"/>
    ${arms(she ? '#d9b8c4' : '#a7adb8')}<path d="M34,84 Q60,72 86,84 L88,158 H32 Z" fill="${she ? '#d9b8c4' : '#a7adb8'}"/><path d="M48,80 Q60,96 72,80" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/><rect x="46" y="124" width="28" height="16" rx="5" fill="#000" opacity=".08"/>`;
  else body = `${bare}${arms(skin)}<path d="M38,84 Q60,76 82,84 L82,150 H38 Z" fill="#f4f1ea"/><path d="M38,146 H82 L83,172 H62 L60,162 L58,172 H37 Z" fill="#d9d4c8"/>`;
  const hairBack = she ? `<path d="M30,44 Q28,10 60,10 Q92,10 90,44 L${look.long === false ? '88,62 H32' : '94,104 Q60,112 26,104'} Z" fill="${hair}"/>` : '';
  const hairTop = she ? `<path d="M36,42 Q38,18 60,18 Q84,18 84,44 Q70,26 52,30 Q42,32 36,42 Z" fill="${hair}"/>`
    : `<path d="M36,40 Q34,14 60,14 Q86,14 84,40 Q78,26 60,26 Q42,26 36,40 Z" fill="${hair}"/>`;
  const beard = !she && look.beard ? `<path d="M40,50 Q42,76 60,78 Q78,76 80,50 Q76,64 60,64 Q44,64 40,50 Z" fill="${hair}"/>` : '';
  const glasses = look.glasses ? `<g fill="none" stroke="#2b2220" stroke-width="2"><circle cx="50" cy="46" r="7.5"/><circle cx="70" cy="46" r="7.5"/><path d="M57.5,46 h5"/></g>` : '';
  return `<svg class="avatar" viewBox="0 0 120 246" aria-hidden="true"><ellipse cx="60" cy="240" rx="40" ry="5" fill="#000" opacity=".12"/>
    ${hairBack}${body}<rect x="54" y="66" width="12" height="16" fill="${skin}"/><circle cx="60" cy="46" r="24" fill="${skin}"/>${beard}${hairTop}
    <circle cx="51" cy="46" r="2.2" fill="#2b2220"/><circle cx="69" cy="46" r="2.2" fill="#2b2220"/><path d="M52,57 Q60,63 68,57" fill="none" stroke="#2b2220" stroke-width="2" stroke-linecap="round"/>${glasses}</svg>`;
}

function oblekani(el, L, api) {
  const b = L.body, looks = b.looks || {};
  const pick = { on: '', ona: '' };
  const prev = L.actions.find((a) => a.startsWith('oblékání: '));
  if (prev) {
    const m = /on=(.+), ona=(.+)$/.exec(prev);
    for (const [k, v] of Object.entries(OUTFITS)) { if (m && v.on === m[1]) pick.on = k; if (m && v.ona === m[2]) pick.ona = k; }
  }
  let locked = !!prev;
  const draw = () => {
    const key = pick.on && pick.on === pick.ona ? pick.on : 'mix';
    const out = { ...DEFAULT_OUT[key], ...Object.fromEntries(Object.entries(b.outcomes?.[key] || {}).filter(([, v]) => v)) };
    el.innerHTML = `<div class="dress">${['on', 'ona'].map((w) => `<div class="doll"><p class="eyebrow">${w === 'on' ? 'Ty' : 'Já'}</p>${avatarSvg(w, looks[w], pick[w])}
      <div class="chips">${Object.entries(OUTFITS).map(([k, v]) => `<button data-w="${w}" data-o="${k}" class="${pick[w] === k ? 'on' : ''}" ${locked ? 'disabled' : ''}>${v[w]}</button>`).join('')}</div></div>`).join('')}</div>
      ${locked ? `<div class="ticket invite pop"><p class="eyebrow">Pozvánka</p><h3>${esc(out.title)}</h3><p>${esc(out.text)}</p>
        ${out.when || out.where ? `<dl>${out.when ? `<dt>Kdy</dt><dd>${esc(out.when)}</dd>` : ''}${out.where ? `<dt>Kde</dt><dd>${esc(out.where)}</dd>` : ''}</dl>` : ''}</div>`
        : `<div class="row center"><button class="btn primary" data-go ${pick.on && pick.ona ? '' : 'disabled'}>Hotovo, jdeme</button></div><p class="small game-info">Obleč nás oba. Podle toho, co vybereš, ti přijde pozvánka.</p>`}`;
  };
  el.onclick = (e) => {
    const c = e.target.closest('[data-o]');
    if (c && !locked) { pick[c.dataset.w] = c.dataset.o; return draw(); }
    if (e.target.closest('[data-go]') && pick.on && pick.ona) {
      locked = true;
      api.record(`oblékání: on=${OUTFITS[pick.on].on}, ona=${OUTFITS[pick.ona].ona}`);
      draw();
      api.done();
    }
  };
  draw();
  if (locked) api.done();
}
