// Porte d'entrée de ScriptBoom : accès sur invitation (email, ou email + code personnel).
// Chaque tentative est écrite dans les logs Vercel (ACCES OK / ACCES REFUSE).
import { readToken, findEntry, makeToken, isAdmin } from './_auth.js';
import { failCount, failHit, clientIp, kv, kvReady, quotaLeft } from './_kv.js';
import { notify, maskEmail } from './_notify.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const body = req.body || {};

  // Vérifie qu'un accès déjà donné est toujours valable (et le renouvelle s'il expire dans moins de 30 jours)
  if (body.check) {
    const t = await readToken(req);
    if (!t) return res.status(401).json({ error: 'Accès sur invitation' });
    if (kvReady()) kv([['HSET', 'seen', t.email, Date.now()]]).catch(() => {});
    const out = { ok: true, admin: isAdmin(t.email), quota: await quotaLeft(t.email) };
    if (t.exp - Date.now() / 1000 < 30 * 86400) out.token = makeToken(t.email, t.code);
    if (kvReady()) { try { const [acc] = await kv([['HGET', 'terms', t.email]]); out.terms = !!acc; } catch (e) { out.terms = true; } } else out.terms = true;
    return res.status(200).json(out);
  }

  // Acceptation des CGU (et « j'ai 18 ans ou plus »), horodatée
  if (body.acceptTerms) {
    const t = await readToken(req);
    if (!t) return res.status(401).json({ error: 'Accès sur invitation' });
    if (kvReady()) await kv([['HSET', 'terms', t.email, JSON.stringify({ date: new Date().toISOString(), version: '2026-09-30', adult: true })]]).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  // Déconnexion de tous les appareils : les jetons émis avant maintenant ne marchent plus
  if (body.logoutAll) {
    const t = await readToken(req);
    if (t && kvReady()) await kv([['HSET', 'revoked', t.email, Math.floor(Date.now() / 1000) + 1]]).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const code = String(body.code || '').trim().toLowerCase().slice(0, 60);
  if (!/^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });

  // Anti-devinette : seuls les ÉCHECS comptent (10 par IP, 6 par email + IP, sur 15 minutes).
  // Un invité qui se trompe depuis un autre réseau ne bloque pas le vrai propriétaire du compte, et le délai restant est affiché.
  const ip = clientIp(req);
  const [fi, fm] = await Promise.all([failCount('login-ip', ip), failCount('login-mail', email + '|' + ip)]);
  if (fi.n >= 10 || fm.n >= 6) {
    const wait = Math.max(1, Math.ceil(Math.max(fi.n >= 10 ? fi.ttl : 0, fm.n >= 6 ? fm.ttl : 0) / 60));
    res.setHeader('Retry-After', String(wait * 60));
    return res.status(429).json({ error: `Trop d'essais ratés. Réessaie dans ${wait} min.` });
  }
  const entry = await findEntry(email, code);
  if (!entry) {
    await Promise.all([failHit('login-ip', ip, 900), failHit('login-mail', email + '|' + ip, 900)]);
    await new Promise(r => setTimeout(r, 700));
    console.log('ACCES REFUSE', email);
    return res.status(403).json({ error: "Email ou code incorrect. ScriptBoom est en accès privé pour le moment." });
  }
  console.log('ACCES OK', email);
  // Première connexion d'un invité : on te prévient
  if (!isAdmin(email) && kvReady()) {
    try { const [first] = await kv([['SADD', 'firstlogin', email]]); if (first) await notify('👋 Un invité vient d\'entrer', `${maskEmail(email)} s'est connecté à ScriptBoom pour la première fois.`, ['wave']); } catch (e) {}
  }
  const code2 = entry.includes(':') ? entry.slice(email.length + 1) : '';
  let terms = true; if (kvReady()) { try { const [acc] = await kv([['HGET', 'terms', email]]); terms = !!acc; } catch (e) {} }
  return res.status(200).json({ token: makeToken(email, code2), admin: isAdmin(email), terms });
}
