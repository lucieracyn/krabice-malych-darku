// Web Push: podpis VAPID (ES256) a šifrování zprávy (RFC 8291, aes128gcm).

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.byteLength, 0));
  let o = 0;
  for (const a of arrs) { out.set(new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength), o); o += a.byteLength; }
  return out;
};

// Klíče se vytvoří samy při prvním použití a uloží se do nastavení.
export async function ensureVapid(env, s, setS) {
  if (s.vapid_public && s.vapid_private) return { publicKey: s.vapid_public, privateJwk: JSON.parse(s.vapid_private) };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  s.vapid_public = publicKey;
  s.vapid_private = JSON.stringify(privateJwk);
  await setS(env, 'vapid_public', s.vapid_public);
  await setS(env, 'vapid_private', s.vapid_private);
  return { publicKey, privateJwk };
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

export async function encryptPayload(sub, text) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// Vrací HTTP stav od doručovací služby (201 = přijato, 404/410 = zařízení už neexistuje).
export async function sendPush(env, s, setS, origin, sub, payload) {
  const { publicKey, privateJwk } = await ensureVapid(env, s, setS);
  const aud = new URL(sub.endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: origin && origin.startsWith('https://') ? origin : 'https://krabice.invalid',
  })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  const body = await encryptPayload(sub, JSON.stringify(payload));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${head}.${claims}.${sig}, k=${publicKey}`,
      'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high',
    },
    body,
  });
  return res.status;
}
