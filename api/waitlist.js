// Liste d'attente de ScriptBoom (page /bienvenue). Stockage gratuit : Upstash Redis (Vercel → Storage).
// Voir la liste : /api/waitlist?code=TON_CODE  (variable ADMIN_CODE dans Vercel)
import { kv, kvReady } from './_kv.js';

export default async function handler(req, res) {
  if (!kvReady()) return res.status(503).json({ error: "La liste d'attente n'est pas encore ouverte. Reviens très vite !" });

  if (req.method === 'GET') {
    const code = String(req.query?.code || '');
    if (!process.env.ADMIN_CODE || code !== process.env.ADMIN_CODE) {
      const [n] = await kv([['SCARD', 'waitlist']]);
      return res.status(200).json({ count: n || 0 });
    }
    const [all] = await kv([['HGETALL', 'waitlist:info']]);
    const rows = [];
    for (let i = 0; i < (all || []).length; i += 2) { try { rows.push(JSON.parse(all[i + 1])); } catch (e) {} }
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="liste-attente-scriptboom.csv"');
    return res.status(200).send('date;email;plateforme;niche\n' + rows.map(r => [r.date, r.email, r.platform, r.niche].map(v => String(v || '').replace(/[;\n\r]/g, ' ')).join(';')).join('\n'));
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // piège à robots
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
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
