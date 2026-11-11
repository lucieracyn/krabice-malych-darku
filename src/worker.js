// Krabice malých dárků – server (Cloudflare Worker)
// Hlídá čas, PIN, vydává dopisy až po půlnoci, ukládá reakce a posílá upozornění.

import { sendPush, ensureVapid } from './push.js';

const WEEKS = 52;
const START = [2026, 10, 16]; // 16. 11. 2026 (měsíc je od nuly)
const DAY = 86400000;
const WATER_MAX = 3;
const RHYTHM = ['Dopis', 'Vzpomínka', 'Hra nebo otázka', 'Něco do reálu (pozvánka, výzva, kupón)'];
const TYPE_NAMES = {
  dopis: 'Dopis', vzpominka: 'Vzpomínka', pozvanka: 'Pozvánka', vyzva: 'Výzva', kupon: 'Kupón',
  otazka: 'Otázka', stopa: 'Stopa', pisnicka: 'Písnička', vyber: 'Výběr do wishlistu',
  kviz: 'Kvíz', pexeso: 'Pexeso', puzzle: 'Puzzle', los: 'Stírací los', oblekani: 'Oblékání',
};

// ---------- čas (všechno se řídí českým časem) ----------
function pragueParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague', hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) o[p.type] = p.type === 'weekday' ? p.value : +p.value;
  return o;
}
function pragueOffset(ms) {
  const o = pragueParts(ms);
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(ms / 1000) * 1000;
}
// Půlnoc českého času, `days` dní po 16. 11. 2026.
function localMidnight(days) {
  const asUtc = Date.UTC(START[0], START[1], START[2] + days);
  return asUtc - pragueOffset(asUtc - 3600000);
}
const releaseMs = (w) => localMidnight(7 * (w - 1));
const smolderMs = (w) => localMidnight(7 * (w - 1) + 4);
const burnMs = (w) => localMidnight(7 * w);
function currentWeek(now) {
  if (now < releaseMs(1)) return 0;
  let w = Math.floor((now - releaseMs(1)) / (7 * DAY)) + 1;
  while (releaseMs(w + 1) <= now) w++;
  while (w > 1 && releaseMs(w) > now) w--;
  return w;
}
const fmtDate = (ms) => new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));

// ---------- pomocné ----------
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (status, error) => json({ error }, status);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function hashSecret(value, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(value), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 50000 }, key, 256));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- databáze ----------
let dbReady = false;
async function initDb(env) {
  if (dbReady) return;
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
    'CREATE TABLE IF NOT EXISTS letters (week INTEGER PRIMARY KEY, type TEXT, title TEXT, teaser TEXT, body TEXT, draft INTEGER DEFAULT 0, updated_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS state (week INTEGER PRIMARY KEY, opened_at INTEGER, scorched INTEGER DEFAULT 0, revived_at INTEGER, revived_by TEXT)',
    'CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY AUTOINCREMENT, week INTEGER, kind TEXT, value TEXT, created_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS wishlist (id INTEGER PRIMARY KEY AUTOINCREMENT, week INTEGER, title TEXT, detail TEXT, link TEXT, media TEXT, created_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sub TEXT, created_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, week INTEGER, kind TEXT, mime TEXT, size INTEGER, created_at INTEGER)',
  ].map((q) => env.DB.prepare(q)));
  dbReady = true;
}
async function loadSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value;
  if (!s.secret) {
    s.secret = randHex(32);
    await setS(env, 'secret', s.secret);
  }
  return s;
}
const setS = (env, key, value) =>
  env.DB.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, String(value)).run();

// ---------- přihlášení ----------
async function makeCookie(s, role, name) {
  const exp = Date.now() + 400 * DAY;
  const body = `${role}.${exp}`;
  return `${name}=${body}.${await hmac(s.secret, body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${400 * 86400}`;
}
async function hasRole(req, s, role, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  if (!m) return false;
  const [r, exp, sig] = m[1].split('.');
  if (r !== role || !(+exp > Date.now()) || !sig) return false;
  return safeEqual(sig, await hmac(s.secret, `${r}.${exp}`));
}
async function checkPin(env, s, pin) {
  if (!s.pin_hash) return { ok: false, error: 'PIN ještě není nastavený.' };
  if (+(s.pin_lock || 0) > Date.now()) return { ok: false, error: 'Moc pokusů. Zkus to za pár minut.' };
  const ok = safeEqual(await hashSecret(String(pin || ''), s.secret), s.pin_hash);
  if (ok) {
    if (s.pin_fail && s.pin_fail !== '0') await setS(env, 'pin_fail', 0);
    return { ok: true };
  }
  const fails = +(s.pin_fail || 0) + 1;
  if (fails >= 5) {
    await setS(env, 'pin_lock', Date.now() + 5 * 60000);
    await setS(env, 'pin_fail', 0);
  } else await setS(env, 'pin_fail', fails);
  return { ok: false, error: 'Tenhle PIN nesedí.' };
}

// ---------- stav dopisů ----------
const nowOf = (s) => Date.now() + (+(s.shift_ms || 0) || 0);
function statusOf(w, letter, st, now) {
  if (now < releaseMs(w)) return 'future';
  if (!letter || letter.draft) return 'empty';
  if (st?.opened_at) return 'opened';
  if (st?.revived_at) return 'revived';
  if (now >= burnMs(w)) return 'burned';
  if (now >= smolderMs(w)) return 'smoldering';
  return 'fresh';
}
async function loadAll(env) {
  const [l, st] = await env.DB.batch([
    env.DB.prepare('SELECT week, type, title, teaser, draft FROM letters'),
    env.DB.prepare('SELECT * FROM state'),
  ]);
  const letters = {}, state = {};
  for (const r of l.results) letters[r.week] = r;
  for (const r of st.results) state[r.week] = r;
  return { letters, state };
}
async function letterPayload(env, w, st) {
  const row = await env.DB.prepare('SELECT * FROM letters WHERE week = ?').bind(w).first();
  if (!row) return null;
  const { results } = await env.DB.prepare('SELECT kind, value, created_at FROM responses WHERE week = ? ORDER BY id').bind(w).all();
  return {
    week: w, type: row.type, title: row.title, body: JSON.parse(row.body || '{}'),
    scorched: !!st?.scorched, revived: !!st?.revived_at, openedAt: st?.opened_at || null,
    reactions: results.filter((r) => r.kind === 'reaction').map((r) => r.value),
    notes: results.filter((r) => r.kind === 'note').map((r) => ({ text: r.value, at: r.created_at })),
    actions: results.filter((r) => r.kind === 'action').map((r) => r.value),
  };
}

// ---------- e-mail správkyni (FormSubmit, bez účtu a bez klíče) ----------
// `fields` je tabulka „popisek: text“; služba z ní poskládá e-mail.
async function sendEmail(s, subject, fields) {
  if (!s.her_email) return { ok: false, error: 'Nejdřív vyplň svůj e-mail.' };
  const origin = s.origin || 'https://krabice.invalid';
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(s.her_email)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', origin, referer: `${origin}/admin/` },
      body: JSON.stringify({ _subject: subject, _template: 'box', _captcha: 'false', ...fields }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && String(data.success) === 'true') return { ok: true, message: data.message || '' };
    return { ok: false, error: `Odeslání se nepovedlo (${res.status}). ${String(data.message || '').slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: 'Službu pro odesílání e-mailů se nepodařilo zastihnout.' };
  }
}
async function pushAll(env, s, origin, payload) {
  const { results } = await env.DB.prepare('SELECT endpoint, sub FROM push_subs').all();
  let sent = 0;
  for (const r of results) {
    const res = await sendPush(env, s, setS, origin, JSON.parse(r.sub), payload).catch(() => 0);
    if (res === 404 || res === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(r.endpoint).run();
    else if (res >= 200 && res < 300) sent++;
  }
  return { sent, total: results.length };
}

// ---------- pravidelné úlohy ----------
async function runCron(env) {
  await initDb(env);
  const s = await loadSettings(env);
  const now = nowOf(s);
  const w = currentWeek(now);
  const origin = s.origin || '';
  const { letters, state } = await loadAll(env);
  const once = async (flag, fn) => {
    if (s[flag]) return;
    await setS(env, flag, now);
    await fn();
  };
  if (w >= 1 && w <= WEEKS && statusOf(w, letters[w], state[w], now) !== 'empty' && !state[w]?.opened_at) {
    await once(`f:notified:${w}`, async () => {
      await pushAll(env, s, origin, { title: 'Krabice malých dárků', body: 'Přišel ti nový dopis. Otevři ho, než začne doutnat.' });
    });
    if (now >= smolderMs(w) && s.smolder_remind !== '0') {
      await once(`f:smolder:${w}`, () =>
        pushAll(env, s, origin, { title: 'Krabice malých dárků', body: 'Tvůj dopis začíná doutnat. Do neděle ho ještě zachráníš.' }));
    }
  }
  const prev = w - 1;
  if (prev >= 1 && prev <= WEEKS && statusOf(prev, letters[prev], state[prev], now) === 'burned') {
    await once(`f:burned:${prev}`, () =>
      sendEmail(s, `Dopis č. ${prev} shořel`, {
        'Co se stalo': `Dopis č. ${prev} „${letters[prev].title || TYPE_NAMES[letters[prev].type]}“ zůstal neotevřený a shořel. V kalendáři po něm zbyla hromádka popela.`,
        'Co s tím': `Manžel ho může uhasit živou vodou (má jí ${+(s.water ?? 1)} ze ${WATER_MAX}). Vzkřísit ho můžeš i ty na stránce pro vkládání${origin ? `: ${origin}/admin/` : '.'}`,
      }));
  }
  const p = pragueParts(now);
  if (w >= 1 && w <= WEEKS + 1 && p.weekday === 'Sun' && p.hour >= 20) {
    await once(`f:digest:${w}`, async () => sendEmail(s, `Týdenní souhrn z krabice (týden ${Math.min(w, WEEKS)})`, await digestFields(env, s, w, letters, state, now)));
  }
}
async function digestFields(env, s, w, letters, state, now) {
  const since = releaseMs(Math.min(w, WEEKS));
  const [resp, wish] = await env.DB.batch([
    env.DB.prepare('SELECT week, kind, value, created_at FROM responses WHERE created_at >= ? ORDER BY week, id').bind(since),
    env.DB.prepare('SELECT title, detail, created_at FROM wishlist WHERE created_at >= ? ORDER BY id').bind(since),
  ]);
  const out = {};
  if (w <= WEEKS) {
    const L = letters[w], st = statusOf(w, L, state[w], now);
    const name = L ? `č. ${w} „${L.title || TYPE_NAMES[L.type]}“` : `č. ${w}`;
    out['Dopis tohoto týdne'] = {
      empty: 'Na tento týden v krabici nic nebylo.',
      opened: `Dopis ${name} otevřel ${fmtDate(state[w]?.opened_at || now)}${state[w]?.scorched ? '. Už doutnal, takže je očouzený.' : '.'}`,
      fresh: `Dopis ${name} zatím neotevřel.`,
      smoldering: `Dopis ${name} zatím neotevřel a doutná. O půlnoci shoří.`,
    }[st] || `Dopis ${name}: ${st}.`;
  }
  const names = { done: 'splnil výzvu', redeem: 'uplatnil kupón', found: 'našel schovaný dárek', 'rsvp:yes': 'potvrdil pozvánku' };
  if (!resp.results.length) out['Jeho odezva'] = 'Tento týden nijak nereagoval.';
  const byWeek = {};
  for (const r of resp.results) (byWeek[r.week] ||= []).push(r);
  for (const [wk, rows] of Object.entries(byWeek)) {
    const parts = [];
    const reacts = rows.filter((r) => r.kind === 'reaction').map((r) => r.value).join(' ');
    if (reacts) parts.push(`Reakce: ${reacts}`);
    for (const r of rows.filter((r) => r.kind === 'action')) parts.push(names[r.value] || r.value);
    for (const r of rows.filter((r) => r.kind === 'note')) parts.push(`Napsal: „${r.value}“`);
    out[`Odezva na dopis č. ${wk}${letters[wk]?.title ? ` (${letters[wk].title})` : ''}`] = parts.join(' | ');
  }
  if (wish.results.length) out['Nově ve wishlistu'] = wish.results.map((r) => `${r.title}${r.detail ? ` – ${r.detail}` : ''}`).join(' | ');
  const missing = [w + 1, w + 2].filter((x) => x <= WEEKS && (!letters[x] || letters[x].draft));
  if (missing.length) out['Pozor'] = `V krabici zatím chybí obsah pro týden ${missing.join(' a ')}.`;
  out['Živá voda'] = `${+(s.water ?? 1)} ze ${WATER_MAX}`;
  return out;
}

// ---------- API ----------
async function api(req, env, ctx, url) {
  await initDb(env);
  const s = await loadSettings(env);
  if (s.origin !== url.origin && !/localhost|127\.0\.0\.1/.test(url.hostname)) {
    s.origin = url.origin;
    ctx.waitUntil(setS(env, 'origin', url.origin));
  }
  const now = nowOf(s);
  const path = url.pathname.slice(5);
  const method = req.method;
  const body = method === 'POST' || method === 'PUT' ? await req.clone().json().catch(() => ({})) : {};
  const isAdmin = await hasRole(req, s, 'a', 'kmd_a');
  const isHim = await hasRole(req, s, 'h', 'kmd_s');
  const seg = path.split('/');

  // --- veřejné ---
  if (path === 'state') {
    const { letters, state } = await loadAll(env);
    const cur = currentWeek(now);
    const authed = isHim || isAdmin;
    const weeks = [];
    for (let w = 1; w <= WEEKS; w++) {
      const st = statusOf(w, letters[w], state[w], now);
      const item = { week: w, release: releaseMs(w), smolder: smolderMs(w), burn: burnMs(w), status: st };
      if (authed && st === 'opened') Object.assign(item, { type: letters[w].type, title: letters[w].title, scorched: !!state[w].scorched, revived: !!state[w].revived_at });
      weeks.push(item);
    }
    const next = cur + 1;
    return json({
      now, session: isHim, admin: isAdmin, current: cur, total: WEEKS, weeks, pinSet: !!s.pin_hash, pinLen: +(s.pin_len || 0),
      next: next <= WEEKS ? { week: next, release: releaseMs(next), teaser: authed ? letters[next]?.teaser || '' : '' } : null,
      water: +(s.water ?? 1), waterMax: WATER_MAX, streak: +(s.streak || 0),
    });
  }
  if (path === 'pin' && method === 'POST') {
    const r = await checkPin(env, s, body.pin);
    if (!r.ok) return fail(403, r.error);
    return json({ ok: true }, 200, { 'set-cookie': await makeCookie(s, 'h', 'kmd_s') });
  }
  if (path === 'push/key') return json({ key: (await ensureVapid(env, s, setS)).publicKey });

  // --- správa: první nastavení a přihlášení ---
  if (path === 'admin/status') return json({ setup: !s.admin_hash, admin: isAdmin });
  if (path === 'admin/login' && method === 'POST') {
    const pw = String(body.password || '');
    if (!s.admin_hash) {
      if (pw.length < 8) return fail(400, 'Heslo musí mít aspoň 8 znaků.');
      await setS(env, 'admin_hash', await hashSecret(pw, s.secret));
    } else {
      if (+(s.admin_lock || 0) > Date.now()) return fail(403, 'Moc pokusů. Zkus to za pár minut.');
      if (!safeEqual(await hashSecret(pw, s.secret), s.admin_hash)) {
        const fails = +(s.admin_fail || 0) + 1;
        await setS(env, 'admin_fail', fails >= 5 ? 0 : fails);
        if (fails >= 5) await setS(env, 'admin_lock', Date.now() + 5 * 60000);
        return fail(403, 'Heslo nesedí.');
      }
    }
    return json({ ok: true }, 200, { 'set-cookie': await makeCookie(s, 'a', 'kmd_a') });
  }
  if (seg[0] === 'admin') return isAdmin ? adminApi(req, env, s, url, seg, body, now) : fail(401, 'Přihlas se.');

  // --- pro něj (po zadání PINu) ---
  if (!isHim && !isAdmin) return fail(401, 'Zadej PIN.');

  if (seg[0] === 'media' && seg[1]) return serveMedia(req, env, seg[1], isAdmin);
  if (seg[0] === 'ics' && seg[1]) return serveIcs(env, +seg[1], isAdmin);

  if (seg[0] === 'letter' && seg[1]) {
    const w = +seg[1];
    const st = await env.DB.prepare('SELECT * FROM state WHERE week = ?').bind(w).first();
    if (!st?.opened_at && !isAdmin) return fail(403, 'Tenhle dopis ještě není otevřený.');
    const p = await letterPayload(env, w, st);
    return p ? json(p) : fail(404, 'Dopis nenalezen.');
  }
  if (path === 'open' && method === 'POST') {
    const w = +body.week;
    const { letters, state } = await loadAll(env);
    const st = statusOf(w, letters[w], state[w], now);
    if (st === 'opened') return json(await letterPayload(env, w, state[w]));
    if (!['fresh', 'smoldering', 'revived'].includes(st)) return fail(409, st === 'burned' ? 'Tenhle dopis už shořel.' : 'Tenhle dopis teď otevřít nejde.');
    const pin = await checkPin(env, s, body.pin);
    if (!pin.ok) return fail(403, pin.error);
    const scorched = st !== 'fresh' ? 1 : 0;
    await env.DB.prepare('INSERT INTO state (week, opened_at, scorched) VALUES (?1, ?2, ?3) ON CONFLICT(week) DO UPDATE SET opened_at = ?2, scorched = ?3')
      .bind(w, now, scorched).run();
    let gained = false;
    if (st !== 'revived') {
      // Živá voda: za každých pět včas otevřených dopisů po sobě jedna navíc.
      let streak = +(s.streak || 0);
      const prevSt = w > 1 ? statusOf(w - 1, letters[w - 1], state[w - 1], now) : 'opened';
      if (prevSt === 'burned' || prevSt === 'revived' || state[w - 1]?.revived_at) streak = 0;
      streak++;
      await setS(env, 'streak', streak);
      if (streak % 5 === 0 && +(s.water ?? 1) < WATER_MAX) {
        await setS(env, 'water', +(s.water ?? 1) + 1);
        gained = true;
      }
    }
    const p = await letterPayload(env, w, { opened_at: now, scorched, revived_at: state[w]?.revived_at });
    return json({ ...p, gainedWater: gained });
  }
  if (path === 'revive' && method === 'POST') {
    const w = +body.week;
    const { letters, state } = await loadAll(env);
    if (statusOf(w, letters[w], state[w], now) !== 'burned') return fail(409, 'Tady není co hasit.');
    const water = +(s.water ?? 1);
    if (water < 1) return fail(409, 'Živá voda došla.');
    await setS(env, 'water', water - 1);
    await env.DB.prepare('INSERT INTO state (week, opened_at, scorched, revived_at, revived_by) VALUES (?1, ?2, 1, ?2, ?3) ON CONFLICT(week) DO UPDATE SET opened_at = ?2, scorched = 1, revived_at = ?2, revived_by = ?3')
      .bind(w, now, 'on').run();
    await env.DB.prepare('INSERT INTO responses (week, kind, value, created_at) VALUES (?, ?, ?, ?)').bind(w, 'action', 'uhasil dopis živou vodou', now).run();
    return json({ ...(await letterPayload(env, w, { opened_at: now, scorched: 1, revived_at: now })), water: water - 1 });
  }
  if (['react', 'note', 'action'].includes(path) && method === 'POST') {
    const w = +body.week;
    const st = await env.DB.prepare('SELECT opened_at FROM state WHERE week = ?').bind(w).first();
    if (!st?.opened_at) return fail(403, 'Dopis není otevřený.');
    const value = String(body.value || '').trim().slice(0, 4000);
    if (!value) return fail(400, 'Prázdné.');
    const kind = path === 'react' ? 'reaction' : path;
    if (kind === 'note') {
      await env.DB.prepare('INSERT INTO responses (week, kind, value, created_at) VALUES (?, ?, ?, ?)').bind(w, kind, value, now).run();
    } else {
      await env.DB.prepare('DELETE FROM responses WHERE week = ? AND kind = ? AND value = ?').bind(w, kind, value).run();
      if (body.on !== false) await env.DB.prepare('INSERT INTO responses (week, kind, value, created_at) VALUES (?, ?, ?, ?)').bind(w, kind, value, now).run();
    }
    return json({ ok: true });
  }
  if (path === 'wishlist') {
    if (method === 'POST') {
      const title = String(body.title || '').trim().slice(0, 300);
      if (!title) return fail(400, 'Prázdné.');
      const dup = await env.DB.prepare('SELECT id FROM wishlist WHERE title = ? AND IFNULL(week, 0) = ?').bind(title, +body.week || 0).first();
      if (!dup) await env.DB.prepare('INSERT INTO wishlist (week, title, detail, link, media, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(+body.week || null, title, String(body.detail || '').slice(0, 500), String(body.link || '').slice(0, 500), String(body.media || '').slice(0, 64), now).run();
    }
    const { results } = await env.DB.prepare('SELECT * FROM wishlist ORDER BY id DESC').all();
    return json({ items: results });
  }
  if (seg[0] === 'wishlist' && seg[1] && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM wishlist WHERE id = ?').bind(+seg[1]).run();
    return json({ ok: true });
  }
  if (path === 'push/subscribe' && method === 'POST') {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh) return fail(400, 'Neplatné přihlášení k upozorněním.');
    await env.DB.prepare('INSERT INTO push_subs (endpoint, sub, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(endpoint) DO UPDATE SET sub = ?2')
      .bind(sub.endpoint, JSON.stringify(sub), now).run();
    return json({ ok: true });
  }
  return fail(404, 'Neznámá adresa.');
}

async function adminApi(req, env, s, url, seg, body, now) {
  const method = req.method;
  const sub = seg.slice(1).join('/');
  if (sub === 'overview') {
    const [l, st, resp, wish, subs] = await env.DB.batch([
      env.DB.prepare('SELECT week, type, title, teaser, draft, updated_at FROM letters'),
      env.DB.prepare('SELECT * FROM state'),
      env.DB.prepare('SELECT week, kind, value, created_at FROM responses ORDER BY week DESC, id'),
      env.DB.prepare('SELECT * FROM wishlist ORDER BY id DESC'),
      env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs'),
    ]);
    const letters = {}, state = {};
    for (const r of l.results) letters[r.week] = r;
    for (const r of st.results) state[r.week] = r;
    const weeks = [];
    for (let w = 1; w <= WEEKS; w++) {
      weeks.push({
        week: w, release: releaseMs(w), suggested: w === 1 ? 'Dopis (úvodní)' : w === WEEKS ? 'Dopis (závěrečný)' : RHYTHM[(w - 1) % 4],
        letter: letters[w] || null, status: statusOf(w, letters[w], state[w], now), openedAt: state[w]?.opened_at || null,
        scorched: !!state[w]?.scorched, revived: !!state[w]?.revived_at,
      });
    }
    return json({
      now, realNow: Date.now(), current: currentWeek(now), weeks, responses: resp.results, wishlist: wish.results,
      settings: {
        pinSet: !!s.pin_hash, her_email: s.her_email || '', smolder_remind: s.smolder_remind !== '0', shiftDays: Math.round((+(s.shift_ms || 0) / DAY) * 100) / 100,
        water: +(s.water ?? 1), streak: +(s.streak || 0), pushDevices: subs.results[0].n, origin: s.origin || url.origin,
      },
    });
  }
  if (seg[1] === 'letter' && seg[2]) {
    const w = +seg[2];
    if (!(w >= 1 && w <= WEEKS)) return fail(400, 'Neplatný týden.');
    if (method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM letters WHERE week = ?').bind(w).first();
      return json(row ? { ...row, body: JSON.parse(row.body || '{}') } : null);
    }
    if (method === 'PUT') {
      await env.DB.prepare(`INSERT INTO letters (week, type, title, teaser, body, draft, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(week) DO UPDATE SET type = ?2, title = ?3, teaser = ?4, body = ?5, draft = ?6, updated_at = ?7`)
        .bind(w, String(body.type || 'dopis'), String(body.title || ''), String(body.teaser || ''), JSON.stringify(body.body || {}), body.draft ? 1 : 0, Date.now()).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM letters WHERE week = ?').bind(w).run();
      return json({ ok: true });
    }
  }
  if (sub === 'media' && method === 'POST') {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 24 * 1024 * 1024) return fail(413, 'Soubor je větší než 24 MB. Zkrať ho, nebo vlož odkaz.');
    const id = randHex(12);
    const mime = url.searchParams.get('mime') || 'application/octet-stream';
    await env.MEDIA.put(`m:${id}`, buf);
    await env.DB.prepare('INSERT INTO media (id, week, kind, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, +url.searchParams.get('week') || 0, url.searchParams.get('kind') || 'image', mime, buf.byteLength, Date.now()).run();
    return json({ id, mime });
  }
  if (sub === 'settings' && method === 'POST') {
    if (body.pin !== undefined && body.pin !== '') {
      if (!/^\d{4,8}$/.test(String(body.pin))) return fail(400, 'PIN musí mít 4 až 8 číslic.');
      await setS(env, 'pin_hash', await hashSecret(String(body.pin), s.secret));
      await setS(env, 'pin_len', String(body.pin).length);
    }
    if (body.her_email !== undefined) await setS(env, 'her_email', String(body.her_email).trim());
    if (body.smolder_remind !== undefined) await setS(env, 'smolder_remind', body.smolder_remind ? 1 : 0);
    if (body.shiftDays !== undefined) await setS(env, 'shift_ms', Math.round((+body.shiftDays || 0) * DAY));
    if (body.water !== undefined) await setS(env, 'water', Math.max(0, Math.min(WATER_MAX, +body.water || 0)));
    return json({ ok: true });
  }
  if (seg[1] === 'revive' && seg[2] && method === 'POST') {
    const w = +seg[2];
    await env.DB.prepare('INSERT INTO state (week, revived_at, revived_by) VALUES (?1, ?2, ?3) ON CONFLICT(week) DO UPDATE SET revived_at = ?2, revived_by = ?3')
      .bind(w, now, 'ona').run();
    return json({ ok: true });
  }
  if (sub === 'test-email' && method === 'POST') {
    const fresh = await loadSettings(env);
    return json(await sendEmail(fresh, 'Zkouška z Krabice malých dárků', { Zpráva: 'E-maily z krabice fungují. Sem ti bude chodit nedělní souhrn a zpráva o shořelém dopisu.' }));
  }
  if (sub === 'test-push' && method === 'POST') {
    return json(await pushAll(env, s, s.origin || url.origin, { title: 'Krabice malých dárků', body: 'Zkouška: upozornění fungují.' }));
  }
  if (sub === 'run-cron' && method === 'POST') {
    await runCron(env);
    return json({ ok: true });
  }
  if (sub === 'reset' && method === 'POST') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM state'), env.DB.prepare('DELETE FROM responses'), env.DB.prepare('DELETE FROM wishlist'),
      env.DB.prepare("DELETE FROM settings WHERE key LIKE 'f:%' OR key IN ('water', 'streak', 'shift_ms', 'pin_fail', 'pin_lock')"),
    ]);
    return json({ ok: true });
  }
  return fail(404, 'Neznámá adresa.');
}

async function serveMedia(req, env, id, isAdmin) {
  if (!/^[0-9a-f]{24}$/.test(id)) return fail(404, 'Nenalezeno.');
  const m = await env.DB.prepare('SELECT m.mime, s.opened_at FROM media m LEFT JOIN state s ON s.week = m.week WHERE m.id = ?').bind(id).first();
  if (!m) return fail(404, 'Nenalezeno.');
  if (!m.opened_at && !isAdmin) return fail(403, 'Ještě ne.');
  const buf = await env.MEDIA.get(`m:${id}`, 'arrayBuffer');
  if (!buf) return fail(404, 'Nenalezeno.');
  const headers = { 'content-type': m.mime, 'cache-control': 'private, max-age=31536000, immutable', 'accept-ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    const size = buf.byteLength;
    let start = range[1] ? +range[1] : size - +range[2];
    let end = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
    start = Math.max(0, start);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    return new Response(buf.slice(start, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}` } });
  }
  return new Response(buf, { headers });
}

async function serveIcs(env, w, isAdmin) {
  const row = await env.DB.prepare('SELECT l.title, l.body, s.opened_at FROM letters l LEFT JOIN state s ON s.week = l.week WHERE l.week = ?').bind(w).first();
  if (!row || (!row.opened_at && !isAdmin)) return fail(404, 'Nenalezeno.');
  const b = JSON.parse(row.body || '{}');
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(b.when || '');
  if (!m) return fail(404, 'Pozvánka nemá datum.');
  const start = `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00`;
  const endD = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5]));
  const end = endD.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const t = (x) => String(x || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Krabice malych darku//CS', 'BEGIN:VEVENT', `UID:krabice-${w}@krabice`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;TZID=Europe/Prague:${start}`, `DTEND;TZID=Europe/Prague:${end}`,
    `SUMMARY:${t(row.title || 'Rande')}`, `LOCATION:${t(b.where)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="pozvanka.ics"' } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, ctx, url);
      } catch (e) {
        console.error(e);
        return fail(500, 'Něco se pokazilo. Zkus to prosím znovu.');
      }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};
