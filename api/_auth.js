// Accès sur invitation, partagé par toutes les fonctions de l'API.
// Deux sources d'invités :
//  1. EMAILS_AUTORISES (Vercel) : « email » ou « email:code », séparés par des virgules (accès fixes, ex. l'admin).
//  2. Le tableau Admin de l'appli (stocké dans Upstash, clé « invites ») : on/off en un clic.
// ADMIN_EMAILS (Vercel) : emails qui voient le tableau Admin (et n'ont pas de limite).
// ACCESS_SECRET (Vercel) : longue phrase secrète qui signe les jetons d'accès.
import { createHmac, timingSafeEqual } from 'crypto';
import { kv, kvReady } from './_kv.js';

const SECRET = () => process.env.ACCESS_SECRET || process.env.GEMINI_API_KEY || 'scriptboom';
const splitList = v => String(v || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
export const invitedList = () => splitList(process.env.EMAILS_AUTORISES);
export const isAdmin = email => !!email && splitList(process.env.ADMIN_EMAILS).includes(String(email).toLowerCase());
export const sign = entry => createHmac('sha256', SECRET()).update('sb1|' + entry).digest('base64url');
// Jeton v2 : « email:v2:émis:expire:empreinte ». Le code d'accès n'y figure JAMAIS (seulement une empreinte signée),
// il expire au bout de 60 jours (renouvelé automatiquement tant que la personne revient) et peut être révoqué.
const TOKEN_DAYS = 60;
const codeHash = (email, code) => createHmac('sha256', SECRET()).update('code|' + email + '|' + (code || '')).digest('base64url').slice(0, 16);
export function makeToken(email, code) {
  const now = Math.floor(Date.now() / 1000);
  const entry = [email, 'v2', now, now + TOKEN_DAYS * 86400, codeHash(email, code)].join(':');
  return Buffer.from(entry).toString('base64url') + '.' + sign(entry);
}
// Code actuel d'un invité (null s'il n'est plus invité, '' s'il n'a pas de code)
async function currentCode(email) {
  const list = invitedList();
  const withCode = list.find(x => x.includes(':') && x.split(':')[0] === email);
  if (withCode) return withCode.slice(email.length + 1);
  if (list.includes(email)) return '';
  const inv = await getInvite(email);
  return inv && inv.on ? String(inv.code || '') : null;
}

export function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Invitation enregistrée dans le tableau Admin : { code, on, added }
export async function getInvite(email) {
  if (!kvReady()) return null;
  try { const [v] = await kv([['HGET', 'invites', email]]); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

// Lit un jeton : { email, iat, exp } s'il est authentique et encore valable, sinon null
export async function readToken(req) {
  const [e, sig] = String(req.headers['x-sb-token'] || '').split('.');
  if (!e || !sig || e.length > 400) return null;
  const entry = Buffer.from(e, 'base64url').toString();
  if (!sameText(sig, sign(entry))) return null;
  const [email, v, iat, exp, h] = entry.split(':');
  if (v !== 'v2' || !email || !h) return null; // ancien format (contenait le code) : il faut se reconnecter une fois
  const now = Math.floor(Date.now() / 1000);
  if (!(Number(exp) > now)) return null;
  const code = await currentCode(email);
  if (code == null || !sameText(h, codeHash(email, code))) return null; // invitation retirée ou code changé
  if (kvReady()) {
    try { const [rev] = await kv([['HGET', 'revoked', email]]); if (rev && Number(iat) < Number(rev)) return null; } catch (err) {}
  }
  return { email, iat: Number(iat), exp: Number(exp), code };
}

// Renvoie l'email de la personne si son jeton est valide et qu'elle est toujours invitée, sinon false
export async function invited(req) {
  const t = await readToken(req);
  if (!t) return false;
  if (kvReady()) kv([['HSET', 'seen', t.email, Date.now()]]).catch(() => {}); // « vu pour la dernière fois »
  return t.email;
}

// Trouve l'entrée d'invitation qui correspond à un email (+ code éventuel)
export async function findEntry(email, code) {
  const list = invitedList();
  const withCode = list.find(x => x.includes(':') && x.split(':')[0] === email);
  if (withCode) return code && sameText(withCode, email + ':' + code) ? withCode : null; // code obligatoire
  if (list.includes(email)) return email;
  const inv = await getInvite(email);
  if (inv && inv.on && code && sameText(inv.code, code)) return email + ':' + inv.code;
  return null;
}

// Lien de désinscription signé (liste d'attente) : seul le propriétaire de l'email peut s'effacer
export const unsubToken = email => Buffer.from(String(email)).toString('base64url') + '.' + createHmac('sha256', SECRET()).update('unsub|' + email).digest('base64url').slice(0, 22);
export function readUnsub(tok) {
  const [e, sig] = String(tok || '').split('.'); if (!e || !sig) return null;
  const email = Buffer.from(e, 'base64url').toString();
  return sameText(sig, createHmac('sha256', SECRET()).update('unsub|' + email).digest('base64url').slice(0, 22)) ? email : null;
}
