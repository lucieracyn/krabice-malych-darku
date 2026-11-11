// Stránka pro vkládání obsahu do krabice.
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = {
  dopis: 'Dopis', vzpominka: 'Vzpomínka (fotka s příběhem)', pozvanka: 'Pozvánka na rande', vyzva: 'Výzva na týden', kupon: 'Kupón',
  otazka: 'Otázka pro něj', stopa: 'Stopa ke schovanému dárku', pisnicka: 'Písnička', vyber: 'Výběr do wishlistu (desky, knihy…)',
};
const STATUS = {
  future: ['čeká na svůj den', ''], empty: ['nic se neposlalo', 'bad'], fresh: ['doručeno, neotevřeno', 'warn'], smoldering: ['doutná', 'warn'],
  burned: ['shořel', 'bad'], revived: ['vzkříšený, neotevřený', 'warn'], opened: ['otevřený', 'ok'],
};
let O = null; // přehled ze serveru
let tab = 'weeks';
let E = null; // rozpracovaný dopis

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    headers: raw ? undefined : body ? { 'content-type': 'application/json' } : undefined,
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Něco se pokazilo.'), { status: res.status });
  return data;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 3500);
}
const fmt = (ms, opts = { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }) =>
  new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', ...opts }).format(new Date(ms));
const fmtTime = (ms) => fmt(ms, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---------- přihlášení ----------
async function start() {
  const st = await api('admin/status');
  if (st.admin) return load();
  app.innerHTML = `<h1>Krabice malých dárků</h1>
    <form class="card"><p>${st.setup ? 'Vítej. Nejdřív si nastav heslo k této stránce (aspoň 8 znaků). Budeš se jím přihlašovat při vkládání obsahu.' : 'Přihlášení ke vkládání obsahu.'}</p>
    <label>Heslo</label><input type="password" autocomplete="${st.setup ? 'new-password' : 'current-password'}" required minlength="8">
    <div class="row"><button class="primary">${st.setup ? 'Nastavit heslo' : 'Přihlásit'}</button></div></form>`;
  $('form', app).onsubmit = async (e) => {
    e.preventDefault();
    try { await api('admin/login', { method: 'POST', body: { password: $('input', app).value } }); load(); } catch (err) { toast(err.message); }
  };
}
async function load() {
  O = await api('admin/overview');
  render();
}

function render() {
  const s = O.settings;
  const todo = [];
  if (!s.pinSet) todo.push('nastavit PIN');
  if (!s.her_email) todo.push('vyplnit svůj e-mail');
  if (!O.weeks[0].letter) todo.push('vložit první dopis');
  app.innerHTML = `<h1>Krabice malých dárků</h1>
    <p class="muted">Adresa pro manžela: <b>${esc(s.origin)}</b></p>
    ${s.shiftDays ? `<div class="banner"><b>Zkušební posun času je zapnutý (${s.shiftDays} dne).</b> Krabice si myslí, že je ${fmtTime(O.now)}. Před 16. 11. ho vypni v Nastavení.</div>` : ''}
    ${todo.length ? `<div class="banner">Ještě zbývá: ${todo.join(', ')}.</div>` : ''}
    <nav>${[['weeks', 'Týdny'], ['resp', 'Odezvy'], ['settings', 'Nastavení']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <div id="pane"></div>`;
  $('nav', app).onclick = (e) => { const t = e.target.dataset.tab; if (t) { tab = t; render(); } };
  ({ weeks: paneWeeks, resp: paneResp, settings: paneSettings })[tab]($('#pane'));
}

// ---------- týdny ----------
function paneWeeks(el) {
  const ready = O.weeks.filter((w) => w.letter && !w.letter.draft).length;
  el.innerHTML = `<p class="muted">Připraveno ${ready} z ${O.weeks.length} týdnů. Každý dopis se odemkne v pondělí o půlnoci českého času. U prázdných týdnů je napsaný návrh podle měsíčního rytmu.</p>
    ${O.weeks.map((w) => {
      const L = w.letter;
      const chip = L ? (L.draft ? ['koncept', 'warn'] : w.status === 'future' ? ['připraveno', 'ok'] : STATUS[w.status]) : w.status === 'future' ? ['prázdné', ''] : STATUS.empty;
      return `<button class="week${w.week === O.current ? ' now' : ''}" data-week="${w.week}">
        <span class="n">${w.week}</span>
        <span><span class="t">${L ? esc(L.title || TYPES[L.type] || L.type) : `<span class="muted">Návrh: ${esc(w.suggested)}</span>`}</span><br>
        <span class="d">${fmt(w.release)}${L ? ` · ${esc((TYPES[L.type] || L.type).split(' (')[0])}` : ''}${w.openedAt ? ` · otevřel ${fmtTime(w.openedAt)}${w.scorched ? ' (očouzený)' : ''}` : ''}</span></span>
        <span class="chip ${chip[1]}">${chip[0]}</span></button>`;
    }).join('')}`;
  el.onclick = (e) => { const b = e.target.closest('[data-week]'); if (b) edit(+b.dataset.week); };
}

// ---------- editor ----------
async function edit(week) {
  const row = await api(`admin/letter/${week}`);
  E = row ? { week, type: row.type, title: row.title, teaser: row.teaser, draft: !!row.draft, body: row.body || {} } : { week, type: 'dopis', title: '', teaser: '', draft: false, body: {} };
  E.body.media ||= [];
  E.body.items ||= [];
  renderEditor();
  scrollTo(0, 0);
}
function field(key, label, { type = 'text', hint = '', cls = '', ph = '' } = {}) {
  const v = E.body[key] ?? '';
  const h = hint ? `<small>${hint}</small>` : '';
  if (type === 'textarea') return `<label>${label}${h}</label><textarea data-b="${key}" class="${cls}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
  return `<label>${label}${h}</label><input type="${type}" data-b="${key}" value="${esc(v)}" placeholder="${esc(ph)}">`;
}
function typeFields() {
  const t = E.type;
  const text = (label, hint) => field('text', label, { type: 'textarea', hint: hint || 'Prázdný řádek oddělí odstavce.' });
  const sig = field('signature', 'Podpis', { ph: 'Tvoje L.' });
  if (t === 'vzpominka') return `<div class="grid2"><div>${field('memWhen', 'Kdy to bylo', { ph: 'léto 2019' })}</div><div>${field('memWhere', 'Kde', { ph: 'Lisabon' })}</div></div>${text('Vzpomínka')}${sig}`;
  if (t === 'pozvanka') return `${text('Text pozvánky')}<div class="grid2"><div>${field('when', 'Kdy', { type: 'datetime-local' })}</div><div>${field('where', 'Kde', { ph: 'u nás doma' })}</div></div>${sig}`;
  if (t === 'vyzva') return `${text('Výzva', 'Malý úkol na týden. Pod textem bude tlačítko „Splněno“.')}${sig}`;
  if (t === 'kupon') return `${field('what', 'Na co kupón je', { ph: 'Snídaně do postele' })}${field('valid', 'Platnost nebo podmínky', { ph: 'Platí kdykoli do konce roku' })}${text('Průvodní text')}${sig}`;
  if (t === 'otazka') return `${text('Otázka', 'Odpoví ti do pole pod dopisem a uvidíš to v souhrnu.')}${sig}`;
  if (t === 'stopa') return `${text('Nápověda', 'Kde má hledat. Pod textem bude tlačítko „Našel jsem to“.')}${sig}`;
  if (t === 'pisnicka') return `${field('song', 'Název a interpret', { ph: 'Nick Cave – Into My Arms' })}${field('link', 'Odkaz (Spotify, YouTube, Apple Music)', { type: 'url' })}${text('Proč zrovna tahle')}${sig}`;
  if (t === 'vyber') return `${text('Úvodní text')}${sig}<h2>Položky</h2><p class="muted">Každou si může jedním klepnutím uložit do wishlistu.</p>
    <div id="items">${E.body.items.map((it, i) => `<div class="item"><div class="grid2"><div><label>Název</label><input type="text" data-i="${i}" data-k="title" value="${esc(it.title)}"></div>
      <div><label>Interpret / autor</label><input type="text" data-i="${i}" data-k="detail" value="${esc(it.detail)}"></div></div>
      <label>Proč by se mu mohla líbit</label><input type="text" data-i="${i}" data-k="note" value="${esc(it.note)}">
      <label>Odkaz na poslech</label><input type="url" data-i="${i}" data-k="link" value="${esc(it.link)}">
      <div class="row">${it.media ? `<img src="/api/media/${it.media}" style="width:56px;height:56px;border-radius:6px;object-fit:cover">` : ''}
      <button type="button" class="sm" data-cover="${i}">${it.media ? 'Změnit obal' : 'Přidat obal'}</button><button type="button" class="sm danger" data-rmitem="${i}">Odebrat</button></div></div>`).join('')}</div>
    <div class="row"><button type="button" id="additem">+ Přidat položku</button></div>`;
  return `${text('Text dopisu')}${sig}`;
}
function renderEditor() {
  const w = O.weeks[E.week - 1];
  app.innerHTML = `<div class="row" style="margin:0 0 10px"><button id="back">← Zpět na týdny</button></div>
    <h1>Týden ${E.week}</h1><p class="muted">Odemkne se ${fmt(w.release)} o půlnoci. Návrh podle rytmu: ${esc(w.suggested)}.</p>
    <form class="card" id="f">
      <label>Co to bude</label><select id="type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === E.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Nadpis</label><input type="text" id="title" value="${esc(E.title)}" placeholder="Milý můj…">
      ${typeFields()}
      <h2>Fotky, zvuk, video</h2>
      <p class="muted">Fotky se před nahráním samy zmenší. Zvuk a video do 24 MB (delší video vlož raději jako odkaz do textu).</p>
      <div id="media">${E.body.media.map((m, i) => `<div class="media">${m.kind === 'image' ? `<img src="/api/media/${m.id}">` : `<div class="ph">${m.kind === 'audio' ? '♪' : '▶'}</div>`}
        <div><input type="text" data-cap="${i}" value="${esc(m.caption)}" placeholder="Popisek (nepovinný)">
        <div class="row" style="margin-top:6px">${i ? `<button type="button" class="sm" data-up="${i}">↑ Výš</button>` : ''}<button type="button" class="sm danger" data-rm="${i}">Odebrat</button></div></div></div>`).join('')}</div>
      <div class="row"><button type="button" id="addmedia">+ Přidat fotku, zvuk nebo video</button><span class="muted" id="upstate"></span></div>
      <input type="file" id="file" accept="image/*,audio/*,video/*" multiple hidden><input type="file" id="cover" accept="image/*" hidden>
      <h2>Teaser</h2>
      <label>Věta, která na tento dopis navnadí<small>Uvidí ji týden předem, pod předchozím dopisem a u odpočtu.</small></label>
      <textarea id="teaser" class="short" placeholder="Příště se vrátíme někam, kde bylo hodně písku.">${esc(E.teaser)}</textarea>
      <label class="check"><input type="checkbox" id="draft" ${E.draft ? 'checked' : ''}> Je to jen koncept (zatím neposílat)</label>
      <div class="sticky row"><button class="primary">Uložit</button><button type="button" id="preview">Uložit a zobrazit náhled</button>
        ${w.letter ? '<button type="button" class="danger" id="del">Smazat</button>' : ''}
        ${w.status === 'burned' ? '<button type="button" id="revive">Vzkřísit shořelý dopis</button>' : ''}</div>
    </form>`;
  const f = $('#f');
  const collect = () => {
    E.type = $('#type').value; E.title = $('#title').value.trim(); E.teaser = $('#teaser').value.trim(); E.draft = $('#draft').checked;
    f.querySelectorAll('[data-b]').forEach((i) => (E.body[i.dataset.b] = i.value.trim()));
    f.querySelectorAll('[data-cap]').forEach((i) => (E.body.media[+i.dataset.cap].caption = i.value.trim()));
    f.querySelectorAll('[data-i]').forEach((i) => (E.body.items[+i.dataset.i][i.dataset.k] = i.value.trim()));
  };
  const save = async () => {
    collect();
    const body = { ...E.body, items: E.type === 'vyber' ? E.body.items.filter((it) => it.title) : [] };
    await api(`admin/letter/${E.week}`, { method: 'PUT', body: { type: E.type, title: E.title, teaser: E.teaser, draft: E.draft, body } });
  };
  $('#back').onclick = () => load();
  $('#type').onchange = () => { collect(); renderEditor(); };
  f.onsubmit = async (e) => { e.preventDefault(); try { await save(); toast('Uloženo.'); load(); } catch (err) { toast(err.message); } };
  $('#preview').onclick = async () => { try { await save(); toast('Uloženo.'); window.open(`/?nahled=${E.week}`, '_blank'); } catch (err) { toast(err.message); } };
  $('#del')?.addEventListener('click', async () => { if (confirm(`Opravdu smazat obsah týdne ${E.week}?`)) { await api(`admin/letter/${E.week}`, { method: 'DELETE' }); load(); } });
  $('#revive')?.addEventListener('click', async () => { await api(`admin/revive/${E.week}`, { method: 'POST' }); toast('Dopis vstal z popela. Manžel ho najde v krabici.'); load(); });
  $('#addmedia').onclick = () => $('#file').click();
  $('#file').onchange = async (e) => {
    collect();
    for (const file of e.target.files) {
      try {
        $('#upstate').textContent = `Nahrávám ${file.name}…`;
        E.body.media.push({ ...(await upload(file)), caption: '' });
      } catch (err) { toast(`${file.name}: ${err.message}`); }
    }
    renderEditor();
  };
  let coverFor = -1;
  $('#cover').onchange = async (e) => {
    if (!e.target.files[0]) return;
    collect();
    try { E.body.items[coverFor].media = (await upload(e.target.files[0], 600)).id; } catch (err) { toast(err.message); }
    renderEditor();
  };
  f.onclick = (e) => {
    const d = e.target.dataset;
    if (d.rm !== undefined) { collect(); E.body.media.splice(+d.rm, 1); renderEditor(); }
    else if (d.up !== undefined) { collect(); const i = +d.up; [E.body.media[i - 1], E.body.media[i]] = [E.body.media[i], E.body.media[i - 1]]; renderEditor(); }
    else if (d.rmitem !== undefined) { collect(); E.body.items.splice(+d.rmitem, 1); renderEditor(); }
    else if (d.cover !== undefined) { coverFor = +d.cover; $('#cover').click(); }
    else if (e.target.id === 'additem') { collect(); E.body.items.push({ title: '', detail: '', note: '', link: '', media: '' }); renderEditor(); }
  };
}
async function upload(file, maxSide = 2000) {
  let blob = file, kind = file.type.startsWith('audio') ? 'audio' : file.type.startsWith('video') ? 'video' : 'image', mime = file.type;
  if (kind === 'image') {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error('Tenhle obrázek neumím načíst. Zkus JPG nebo PNG.'); }
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.86));
    mime = 'image/jpeg';
  } else if (file.size > 24 * 1024 * 1024) throw new Error('Soubor je větší než 24 MB.');
  const { id } = await api(`admin/media?week=${E.week}&kind=${kind}&mime=${encodeURIComponent(mime)}`, { method: 'POST', raw: blob });
  return { id, kind };
}

// ---------- odezvy ----------
function paneResp(el) {
  const names = { done: 'Splnil výzvu', redeem: 'Uplatnil kupón', found: 'Našel schovaný dárek', 'rsvp:yes': 'Potvrdil pozvánku' };
  const by = {};
  for (const r of O.responses) (by[r.week] ||= []).push(r);
  const weeks = Object.keys(by).sort((a, b) => b - a);
  el.innerHTML = `<p class="muted">Totéž ti chodí každou neděli večer e-mailem. Živá voda: ${O.settings.water} ze 3.</p>
    ${weeks.length ? weeks.map((w) => {
      const rows = by[w], L = O.weeks[w - 1].letter;
      const reacts = rows.filter((r) => r.kind === 'reaction').map((r) => r.value).join(' ');
      return `<div class="card"><b>Týden ${w}${L?.title ? ` · ${esc(L.title)}` : ''}</b>
        ${reacts ? `<div class="resp">Reakce: ${reacts}</div>` : ''}
        ${rows.filter((r) => r.kind !== 'reaction').map((r) => `<div class="resp">${r.kind === 'note' ? `„${esc(r.value).replace(/\n/g, '<br>')}“` : esc(names[r.value] || r.value)} <span class="muted">· ${fmtTime(r.created_at)}</span></div>`).join('')}</div>`;
    }).join('') : '<div class="card muted">Zatím žádné reakce ani odpovědi.</div>'}
    <h2>Jeho wishlist</h2>
    ${O.wishlist.length ? `<div class="card">${O.wishlist.map((it) => `<div class="resp"><b>${esc(it.title)}</b>${it.detail ? ` – ${esc(it.detail)}` : ''} <span class="muted">· ${it.week ? `z týdne ${it.week}` : 'vlastní přání'}, ${fmtTime(it.created_at)}</span></div>`).join('')}</div>` : '<div class="card muted">Wishlist je zatím prázdný.</div>'}`;
}

// ---------- nastavení ----------
function paneSettings(el) {
  const s = O.settings;
  el.innerHTML = `
    <form class="card" id="s-pin"><h2 style="margin-top:0">PIN pro manžela</h2>
      <p class="muted">${s.pinSet ? 'PIN je nastavený. Vyplň jen tehdy, když ho chceš změnit.' : 'Zatím není nastavený. Bez něj nepůjde otevřít žádný dopis.'}</p>
      <label>${s.pinSet ? 'Nový PIN' : 'PIN'} (4 až 8 číslic)</label><input type="text" inputmode="numeric" pattern="\\d{4,8}" id="pin" autocomplete="off">
      <div class="row"><button class="primary">Uložit PIN</button></div></form>
    <form class="card" id="s-mail"><h2 style="margin-top:0">E-mail pro tebe</h2>
      <label>Tvůj e-mail<small>Sem chodí nedělní souhrn a zpráva o shořelém dopisu. Manžel dostává upozornění přímo v telefonu.</small></label><input type="email" id="her" value="${esc(s.her_email)}">
      <p class="muted" style="margin-top:10px">Při prvním zkušebním e-mailu ti přijde zpráva od služby FormSubmit s potvrzovacím odkazem. Klikni na něj a zkoušku zopakuj.</p>
      <label class="check"><input type="checkbox" id="smolder" ${s.smolder_remind ? 'checked' : ''}> V pátek mu v telefonu připomenout, že dopis začíná doutnat</label>
      <div class="row"><button class="primary">Uložit</button><button type="button" id="t-her">Poslat zkušební e-mail</button></div></form>
    <div class="card"><h2 style="margin-top:0">Upozornění v telefonu</h2>
      <p class="muted">Zařízení s povoleným upozorněním: ${s.pushDevices}. Manžel si je zapne v aplikaci po přidání na plochu.</p>
      <div class="row"><button id="t-push">Poslat zkušební upozornění</button></div></div>
    <form class="card" id="s-test"><h2 style="margin-top:0">Zkoušení</h2>
      <p class="muted">Posunem času si vyzkoušíš, jak krabice vypadá v jiný den: 5 = páteční doutnání prvního dopisu, 7 = druhý týden a shoření prvního. Otevírání při zkoušení se ukládá, proto před 16. 11. posun vypni a zkušební data smaž.</p>
      <label>Posun času ve dnech (0 = vypnuto)</label><input type="number" step="0.01" id="shift" value="${s.shiftDays}">
      <div class="row"><button class="primary">Nastavit posun</button><button type="button" id="cron">Spustit hodinovou kontrolu teď</button><button type="button" class="danger" id="reset">Smazat zkušební data a vypnout posun</button></div></form>`;
  const save = async (body, msg = 'Uloženo.') => { try { await api('admin/settings', { method: 'POST', body }); toast(msg); await load(); } catch (e) { toast(e.message); } };
  $('#s-pin').onsubmit = (e) => { e.preventDefault(); if ($('#pin').value) save({ pin: $('#pin').value }, 'PIN uložen.'); };
  const mail = () => ({ her_email: $('#her').value, smolder_remind: $('#smolder').checked });
  $('#s-mail').onsubmit = (e) => { e.preventDefault(); save(mail()); };
  const test = async () => {
    try {
      await api('admin/settings', { method: 'POST', body: mail() });
      const r = await api('admin/test-email', { method: 'POST' });
      toast(r.ok ? `Odesláno. Mrkni do schránky (i do spamu). ${r.message || ''}` : r.error);
    } catch (e) { toast(e.message); }
  };
  $('#t-her').onclick = () => test();
  $('#t-push').onclick = async () => { const r = await api('admin/test-push', { method: 'POST' }); toast(r.total ? `Odesláno na ${r.sent} z ${r.total} zařízení.` : 'Žádné zařízení zatím nemá upozornění povolené.'); };
  $('#s-test').onsubmit = (e) => { e.preventDefault(); save({ shiftDays: +$('#shift').value || 0 }, 'Posun nastaven.'); };
  $('#cron').onclick = async () => { await api('admin/run-cron', { method: 'POST' }); toast('Kontrola proběhla.'); load(); };
  $('#reset').onclick = async () => {
    if (!confirm('Smazat všechna otevření, reakce, odpovědi a wishlist? Dopisy zůstanou.')) return;
    await api('admin/reset', { method: 'POST' }); toast('Zkušební data smazána.'); load();
  };
}

start().catch((e) => (app.innerHTML = `<div class="card">Stránku se nepodařilo načíst: ${esc(e.message)}</div>`));
