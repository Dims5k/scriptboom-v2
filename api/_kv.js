// Petit stockage gratuit (Upstash Redis, via Vercel → Storage) + limite d'utilisation par personne.
// Variables ajoutées automatiquement par Vercel quand on crée la base :
//   KV_REST_API_URL / KV_REST_API_TOKEN  (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
// Réglages facultatifs : QUOTA_JOUR (actions IA par personne et par jour, 60 par défaut),
//                        ADMIN_EMAILS (emails sans limite, séparés par des virgules).
// Trouve la base quel que soit le préfixe choisi dans Vercel (KV_, STORAGE_, UPSTASH_REDIS_…)
const findEnv = end => process.env['KV' + end] || process.env['UPSTASH_REDIS' + end] ||
  Object.keys(process.env).filter(k => k.endsWith(end) && !k.includes('READ_ONLY')).map(k => process.env[k])[0];
const URL_ = () => findEnv('_REST_API_URL') || findEnv('_REST_URL');
const TOKEN = () => findEnv('_REST_API_TOKEN') || findEnv('_REST_TOKEN');
export const kvReady = () => !!(URL_() && TOKEN());

export async function kv(commands) {
  const r = await fetch(URL_() + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('Stockage indisponible (' + r.status + ')');
  return (await r.json()).map(x => x.result);
}

// Compte une action IA. Renvoie { ok, left } ; sans base configurée, tout est permis.
export async function useQuota(email, cost = 1) {
  if (!kvReady() || !email) return { ok: true, left: null };
  const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (admins.includes(String(email).toLowerCase())) return { ok: true, left: null };
  const max = Number(process.env.QUOTA_JOUR) || 60;
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${day}:${String(email).toLowerCase()}`;
  try {
    const [n] = await kv([['INCRBY', key, cost], ['EXPIRE', key, 172800]]);
    if (n > max){ await kv([['DECRBY', key, cost]]).catch(() => {}); return { ok: false, left: 0, max }; }
    return { ok: true, left: max - n, max };
  } catch (e) { return { ok: true, left: null }; } // stockage en panne : on ne bloque pas l'utilisateur
}

// Rend une action IA qui a échoué : l'utilisateur ne perd rien quand Google est en panne
export async function refundQuota(email, cost = 1) {
  if (!kvReady() || !email) return;
  const key = `quota:${new Date().toISOString().slice(0, 10)}:${String(email).toLowerCase()}`;
  try { const [n] = await kv([['DECRBY', key, cost]]); if (n < 0) await kv([['SET', key, 0, 'EX', 172800]]); } catch (e) {}
}

// Solde du jour (sans rien décompter), pour l'afficher dans l'appli
export async function quotaLeft(email) {
  const max = Number(process.env.QUOTA_JOUR) || 60;
  if (!kvReady() || !email) return { left: null, max };
  const admins = String(process.env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if (admins.includes(String(email).toLowerCase())) return { left: null, max };
  try { const [n] = await kv([['GET', `quota:${new Date().toISOString().slice(0, 10)}:${String(email).toLowerCase()}`]]); return { left: Math.max(0, max - (Number(n) || 0)), max }; }
  catch (e) { return { left: null, max }; }
}
// Ajoute le solde à la réponse (en-tête lu par l'appli)
export function sendLeft(res, q) { if (q && q.left != null) res.setHeader('X-SB-Left', String(q.left) + '/' + String(q.max || '')); }

export const QUOTA_MSG = "Tu as atteint ta limite de créations pour aujourd'hui. Elle se remet à zéro chaque nuit : à demain !";

// Message clair quand Google (formule gratuite) est à court
export function friendly(msg) {
  const m = String(msg || '');
  if (/quota|RESOURCE_EXHAUSTED|rate.?limit|429|too many requests/i.test(m))
    return "Le service IA gratuit est très demandé en ce moment. Réessaie dans une minute (ou demain si ça continue).";
  return m || 'Erreur';
}

// Anti-abus : au plus `max` actions par `windowSec` secondes pour une même clé (IP, email…)
export async function rateLimit(name, id, max, windowSec) {
  if (!kvReady() || !id) return true;
  const key = `rl:${name}:${String(id).toLowerCase().slice(0, 120)}`;
  try {
    const [, n] = await kv([['SET', key, 0, 'EX', windowSec, 'NX'], ['INCR', key]]);
    return n <= max;
  } catch (e) { return true; }
}
// Limiteur qui ne compte que les échecs (connexion) : on regarde sans compter, puis on compte seulement si c'est raté
export async function failCount(name, id) {
  if (!kvReady() || !id) return { n: 0, ttl: 0 };
  try { const [n, ttl] = await kv([['GET', `rf:${name}:${String(id).toLowerCase().slice(0, 120)}`], ['TTL', `rf:${name}:${String(id).toLowerCase().slice(0, 120)}`]]); return { n: Number(n) || 0, ttl: Number(ttl) || 0 }; }
  catch (e) { return { n: 0, ttl: 0 }; }
}
export async function failHit(name, id, windowSec) {
  if (!kvReady() || !id) return;
  const key = `rf:${name}:${String(id).toLowerCase().slice(0, 120)}`;
  try { await kv([['SET', key, 0, 'EX', windowSec, 'NX'], ['INCR', key]]); } catch (e) {}
}
export const clientIp =req => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'inconnu';
export const TOO_MANY = 'Trop de tentatives. Patiente quelques minutes avant de réessayer.';
