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
export const makeToken = entry => Buffer.from(entry).toString('base64url') + '.' + sign(entry);

export function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Invitation enregistrée dans le tableau Admin : { code, on, added }
export async function getInvite(email) {
  if (!kvReady()) return null;
  try { const [v] = await kv([['HGET', 'invites', email]]); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

// Renvoie l'email de la personne si son jeton est valide et qu'elle est toujours invitée, sinon false
export async function invited(req) {
  const [e, sig] = String(req.headers['x-sb-token'] || '').split('.');
  if (!e || !sig || e.length > 400) return false;
  const entry = Buffer.from(e, 'base64url').toString();
  if (!sameText(sig, sign(entry))) return false;
  const email = entry.split(':')[0];
  let ok = invitedList().includes(entry);
  if (!ok) {
    const inv = await getInvite(email);
    ok = !!(inv && inv.on && sameText(entry, email + ':' + inv.code));
  }
  if (!ok) return false;
  if (kvReady()) kv([['HSET', 'seen', email, Date.now()]]).catch(() => {}); // « vu pour la dernière fois »
  return email;
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
