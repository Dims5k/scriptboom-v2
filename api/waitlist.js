// Liste d'attente de ScriptBoom (page /bienvenue). Stockage gratuit : Upstash Redis (Vercel → Storage).
// Voir la liste : /api/waitlist?code=TON_CODE  (variable ADMIN_CODE dans Vercel)
import { kv, kvReady, rateLimit, clientIp, TOO_MANY } from './_kv.js';
import { sameText } from './_auth.js';

// Protège Excel/Sheets contre les formules cachées dans un champ (=, +, -, @)
const cell = v => { const t = String(v || '').replace(/[;\n\r]/g, ' '); return /^[=+\-@\t]/.test(t) ? "'" + t : t; };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!kvReady()) return res.status(503).json({ error: "La liste d'attente n'est pas encore ouverte. Reviens très vite !" });

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
    return res.status(200).send('date;email;plateforme;niche\n' + rows.map(r => [r.date, r.email, r.platform, r.niche].map(cell).join(';')).join('\n'));
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
    try { await kv([['SREM', 'waitlist', email], ['HDEL', 'waitlist:info', email]]); console.log('LISTE ATTENTE désinscription'); return res.status(200).json({ ok: true }); }
    catch (e) { return res.status(500).json({ error: 'La désinscription a échoué, réessaie dans un instant.' }); }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Cet email ne semble pas valide.' });
  const platform = String(b.platform || '').slice(0, 30), niche = String(b.niche || '').trim().slice(0, 80);
  try {
    const [added] = await kv([['SADD', 'waitlist', email]]);
    if (added) await kv([['HSET', 'waitlist:info', email, JSON.stringify({ email, platform, niche, date: new Date().toISOString() })]]);
    const [n] = await kv([['SCARD', 'waitlist']]);
    console.log('LISTE ATTENTE', added ? 'nouveau' : 'déjà inscrit', email);
    return res.status(200).json({ ok: true, already: !added, count: n });
  } catch (e) {
    return res.status(500).json({ error: "L'inscription a échoué, réessaie dans un instant." });
  }
}
