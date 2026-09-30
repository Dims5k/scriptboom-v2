// Liste d'attente de ScriptBoom (page /bienvenue). Stockage gratuit : Upstash Redis (Vercel → Storage).
// Voir la liste : /api/waitlist?code=TON_CODE  (variable ADMIN_CODE dans Vercel)
import { kv, kvReady, rateLimit, clientIp, TOO_MANY } from './_kv.js';
import { sameText, readUnsub } from './_auth.js';
import { notify, maskEmail } from './_notify.js';
import { sendMail, waitlistMail, unsubMail, mailReady } from './_mail.js';

// Protège Excel/Sheets contre les formules cachées dans un champ (=, +, -, @)
const cell = v => { const t = String(v || '').replace(/[;\n\r]/g, ' '); return /^[=+\-@\t]/.test(t) ? "'" + t : t; };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!kvReady()) return res.status(503).json({ error: "La liste d'attente n'est pas encore ouverte. Reviens très vite !" });

  if (req.method === 'GET' && req.query?.unsub) {
    const who = readUnsub(req.query.unsub);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const page = (t, m) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ScriptBoom</title></head><body style="margin:0;background:#000;color:#e8e8e8;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center"><div><h1 style="color:#fff;font-size:22px">${t}</h1><p>${m}</p><p><a href="/bienvenue" style="color:#1ed760">Retour à ScriptBoom</a></p></div></body></html>`;
    if (!who) return res.status(400).send(page('Lien invalide', 'Ce lien de désinscription n\'est pas valable. Écris-nous depuis la page Confidentialité.'));
    try { await kv([['SREM', 'waitlist', who], ['HDEL', 'waitlist:info', who]]); console.log('LISTE ATTENTE désinscription confirmée'); }
    catch (e) { return res.status(500).send(page('Petit souci', 'La désinscription a échoué, réessaie dans un instant.')); }
    return res.status(200).send(page('C\'est fait ✓', 'Ton email a été effacé de la liste d\'attente. Tu ne recevras plus rien de notre part.'));
  }

  if (req.method === 'GET') {
    const code = String(req.query?.code || '');
    const admin = process.env.ADMIN_CODE && String(process.env.ADMIN_CODE).length >= 8 && sameText(code, process.env.ADMIN_CODE);
    if (code && !admin && !(await rateLimit('admin', clientIp(req), 8, 900))) return res.status(429).json({ error: TOO_MANY });
    if (!admin) {
      const [n] = await kv([['SCARD', 'waitlist']]);
      return res.status(200).json({ count: n || 0 });
    }
    if (req.query?.messages) {
      const [msgs] = await kv([['LRANGE', 'messages', 0, 499]]);
      const list = (msgs || []).map(m => { try { return JSON.parse(m); } catch (e) { return null; } }).filter(Boolean);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(list.length ? list.map(m => `${m.date.slice(0, 16).replace('T', ' ')} · ${m.email}\n${m.message}`).join('\n\n———\n\n') : 'Aucun message pour le moment.');
    }
    const [all] = await kv([['HGETALL', 'waitlist:info']]);
    const rows = [];
    for (let i = 0; i < (all || []).length; i += 2) { try { rows.push(JSON.parse(all[i + 1])); } catch (e) {} }
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="liste-attente-scriptboom.csv"');
    return res.status(200).send('rang;date;email;plateforme;niche;offre_-50%\n' + rows.map(r => [r.rank || '', r.date, r.email, r.platform, r.niche, r.early === false ? 'non' : 'oui'].map(cell).join(';')).join('\n'));
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // piège à robots
  // Anti-spam : 8 envois par IP toutes les 15 minutes
  if (!(await rateLimit('wl-' + (b.action || 'join'), clientIp(req), 8, 900))) return res.status(429).json({ error: TOO_MANY });
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  // Message de contact (page Confidentialité) : visible dans /api/waitlist?code=TON_CODE&messages=1
  if (b.action === 'contact') {
    const message = String(b.message || '').trim().slice(0, 1500);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !message) return res.status(400).json({ error: 'Il manque ton email ou ton message.' });
    try { await kv([['LPUSH', 'messages', JSON.stringify({ date: new Date().toISOString(), email, message })], ['LTRIM', 'messages', 0, 499]]); console.log('MESSAGE CONTACT', email);
      return res.status(200).json({ ok: true }); }
    catch (e) { return res.status(500).json({ error: "L'envoi a échoué, réessaie dans un instant." }); }
  }
  // Désinscription (page Confidentialité) : efface l'email et ses infos
  if (b.action === 'remove') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Cet email ne semble pas valide.' });
    // On envoie un lien de confirmation à l'adresse : personne ne peut effacer l'email de quelqu'un d'autre
    if (mailReady()) {
      try { const [isIn] = await kv([['SISMEMBER', 'waitlist', email]]); if (isIn) await sendMail({ to: email, ...unsubMail(email) }); } catch (e) {}
      return res.status(200).json({ ok: true, confirm: true, message: 'Si cet email est inscrit, tu vas recevoir un lien pour confirmer la désinscription.' });
    }
    try { await kv([['SREM', 'waitlist', email], ['HDEL', 'waitlist:info', email]]); console.log('LISTE ATTENTE désinscription'); return res.status(200).json({ ok: true }); }
    catch (e) { return res.status(500).json({ error: 'La désinscription a échoué, réessaie dans un instant.' }); }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Cet email ne semble pas valide.' });
  const platform = String(b.platform || '').slice(0, 30), niche = String(b.niche || '').trim().slice(0, 80);
  try {
    const [added] = await kv([['SADD', 'waitlist', email]]);
    const [n] = await kv([['SCARD', 'waitlist']]);
    // Rang d'inscription gardé pour le lancement : les 500 premiers auront −50 % à vie
    if (added) await kv([['HSET', 'waitlist:info', email, JSON.stringify({ email, platform, niche, rank: n, early: n <= 500, date: new Date().toISOString() })]]);
    console.log('LISTE ATTENTE', added ? 'nouveau' : 'déjà inscrit', email);
    // Email de bienvenue + notification pour toi, en même temps
    if (added) await Promise.all([sendMail({ to: email, ...waitlistMail(n, email) }), notify(n <= 500 ? `🎟️ Nouvel inscrit · n° ${n}` : `Nouvel inscrit · n° ${n}`,
      `${maskEmail(email)}\nPlateforme : ${platform || '—'} · Niche : ${niche || '—'}\n` + (n <= 500 ? `Club des 500 : ${500 - n} places restantes` : 'Club des 500 complet'), ['tada'])]);
    return res.status(200).json({ ok: true, already: !added, count: n });
  } catch (e) {
    return res.status(500).json({ error: "L'inscription a échoué, réessaie dans un instant." });
  }
}
