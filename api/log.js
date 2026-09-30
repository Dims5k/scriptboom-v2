// Journal des erreurs de l'appli (suivi léger, sans service externe) : visibles dans Vercel → Logs, filtre « APPLI ERREUR ».
import { readToken } from './_auth.js';
import { rateLimit, clientIp } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await rateLimit('log', clientIp(req), 30, 300))) return res.status(204).end();
  const t = await readToken(req).catch(() => null);
  const b = req.body || {};
  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, n);
  console.log('APPLI ERREUR', JSON.stringify({ who: t ? t.email.replace(/^(.{2}).*@/, '$1•••@') : '-', kind: clip(b.kind, 20), msg: clip(b.msg, 300),
    where: clip(b.where, 200), route: clip(b.route, 40), code: clip(b.code, 20), ua: clip(req.headers['user-agent'], 120) }));
  return res.status(204).end();
}
