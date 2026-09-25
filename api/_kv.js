// Petit stockage gratuit (Upstash Redis, via Vercel → Storage) + limite d'utilisation par personne.
// Variables ajoutées automatiquement par Vercel quand on crée la base :
//   KV_REST_API_URL / KV_REST_API_TOKEN  (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)
// Réglages facultatifs : QUOTA_JOUR (actions IA par personne et par jour, 60 par défaut),
//                        ADMIN_EMAILS (emails sans limite, séparés par des virgules).
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
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
    if (n > max) return { ok: false, left: 0 };
    return { ok: true, left: max - n };
  } catch (e) { return { ok: true, left: null }; } // stockage en panne : on ne bloque pas l'utilisateur
}

export const QUOTA_MSG = "Tu as atteint ta limite de créations pour aujourd'hui. Elle se remet à zéro chaque nuit : à demain !";

// Message clair quand Google (formule gratuite) est à court
export function friendly(msg) {
  const m = String(msg || '');
  if (/quota|RESOURCE_EXHAUSTED|rate.?limit|429|too many requests/i.test(m))
    return "Le service IA gratuit est très demandé en ce moment. Réessaie dans une minute (ou demain si ça continue).";
  return m || 'Erreur';
}
