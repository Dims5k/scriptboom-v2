// Accès sur invitation, partagé par toutes les fonctions de l'API.
// EMAILS_AUTORISES (Vercel) : « email » ou « email:code », séparés par des virgules.
//   ex. salim@exemple.com:7391, ami@gmail.com:4821   → email + code obligatoires (recommandé)
// ACCESS_SECRET (Vercel) : longue phrase secrète qui signe les jetons d'accès (recommandé).
import { createHmac, timingSafeEqual } from 'crypto';

const SECRET = () => process.env.ACCESS_SECRET || process.env.GEMINI_API_KEY || 'scriptboom';
export const invitedList = () => String(process.env.EMAILS_AUTORISES || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
export const sign = entry => createHmac('sha256', SECRET()).update('sb1|' + entry).digest('base64url');
export const makeToken = entry => Buffer.from(entry).toString('base64url') + '.' + sign(entry);

export function sameText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Renvoie l'email de la personne si son jeton est valide et qu'elle est toujours invitée, sinon false
export function invited(req) {
  const [e, sig] = String(req.headers['x-sb-token'] || '').split('.');
  if (!e || !sig || e.length > 400) return false;
  const entry = Buffer.from(e, 'base64url').toString();
  if (!sameText(sig, sign(entry)) || !invitedList().includes(entry)) return false;
  return entry.split(':')[0];
}

// Trouve l'entrée d'invitation qui correspond à un email (+ code éventuel)
export function findEntry(email, code) {
  const list = invitedList();
  const withCode = list.find(x => x.includes(':') && x.split(':')[0] === email);
  if (withCode) return code && sameText(withCode, email + ':' + code) ? withCode : null; // code obligatoire
  return list.includes(email) ? email : null;
}
