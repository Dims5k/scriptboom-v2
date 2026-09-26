// Projets sauvegardés en ligne (Upstash Redis, gratuit) : on retrouve ses vidéos sur n'importe quel appareil.
// On garde les textes et les réglages (scripts, accroches, parties, voix choisie…), pas les fichiers audio/vidéo.
import { invited } from './_auth.js';
import { kv, kvReady } from './_kv.js';

const MAX_ITEMS = 60, MAX_SIZE = 40000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!kvReady()) return res.status(503).json({ error: 'Sauvegarde en ligne indisponible' });
  const key = 'proj:' + String(who).toLowerCase();

  try {
    if (req.method === 'GET') {
      const [all] = await kv([['HGETALL', key]]);
      const items = [];
      for (let i = 0; i < (all || []).length; i += 2) { try { items.push(JSON.parse(all[i + 1])); } catch (e) {} }
      items.sort((a, b) => (b.date || 0) - (a.date || 0));
      return res.status(200).json({ items });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
    const b = req.body || {};

    if (b.action === 'delete') {
      const id = String(b.id || '').slice(0, 40);
      if (id) await kv([['HDEL', key, id]]);
      return res.status(200).json({ ok: true });
    }

    if (b.action === 'save') {
      const item = b.item || {};
      const id = String(item.id || '').replace(/[^\w-]/g, '').slice(0, 40);
      if (!id) return res.status(400).json({ error: 'Projet invalide' });
      const json = JSON.stringify({ ...item, id });
      if (json.length > MAX_SIZE) return res.status(413).json({ error: 'Projet trop lourd' });
      const [, n] = await kv([['HSET', key, id, json], ['HLEN', key]]);
      // Trop de projets : on retire les plus anciens
      if (n > MAX_ITEMS) {
        const [all] = await kv([['HGETALL', key]]);
        const list = [];
        for (let i = 0; i < (all || []).length; i += 2) { let d = 0; try { d = JSON.parse(all[i + 1]).date || 0; } catch (e) {} list.push([all[i], d]); }
        list.sort((a, b) => a[1] - b[1]);
        const old = list.slice(0, n - MAX_ITEMS).map(x => x[0]);
        if (old.length) await kv([['HDEL', key, ...old]]);
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erreur' });
  }
}
