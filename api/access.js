// Porte d'entrée de ScriptBoom : accès sur invitation (email, ou email + code personnel).
// Chaque tentative est écrite dans les logs Vercel (ACCES OK / ACCES REFUSE).
import { invited, findEntry, makeToken, isAdmin } from './_auth.js';
import { rateLimit, clientIp, TOO_MANY, kv, kvReady } from './_kv.js';
import { notify, maskEmail } from './_notify.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const body = req.body || {};

  // Vérifie qu'un accès déjà donné est toujours valable
  if (body.check) {
    const who = await invited(req);
    return who ? res.status(200).json({ ok: true, admin: isAdmin(who) }) : res.status(401).json({ error: 'Accès sur invitation' });
  }

  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const code = String(body.code || '').trim().toLowerCase().slice(0, 60);
  if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });

  // Anti-devinette : 10 essais par IP et 6 par email toutes les 15 minutes
  if (!(await rateLimit('login-ip', clientIp(req), 10, 900)) || !(await rateLimit('login-mail', email, 6, 900)))
    return res.status(429).json({ error: TOO_MANY });

  const entry = await findEntry(email, code);
  if (!entry) {
    await new Promise(r => setTimeout(r, 700));
    console.log('ACCES REFUSE', email);
    return res.status(403).json({ error: "Email ou code incorrect. ScriptBoom est en accès privé pour le moment." });
  }
  console.log('ACCES OK', email);
  // Première connexion d'un invité : on te prévient
  if (!isAdmin(email) && kvReady()) {
    try { const [first] = await kv([['SADD', 'firstlogin', email]]); if (first) await notify('👋 Un invité vient d\'entrer', `${maskEmail(email)} s'est connecté à ScriptBoom pour la première fois.`, ['wave']); } catch (e) {}
  }
  return res.status(200).json({ token: makeToken(entry), admin: isAdmin(email) });
}
