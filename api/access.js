import { createHmac } from 'crypto';

// Porte d'entrée de ScriptBoom : accès sur invitation.
// Liste des invités : variable EMAILS_AUTORISES dans Vercel (emails séparés par des virgules).
// Chaque tentative est écrite dans les logs Vercel (ACCES OK / ACCES REFUSE).
const invitedList = () => String(process.env.EMAILS_AUTORISES || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
const sign = email => createHmac('sha256', process.env.ACCESS_SECRET || process.env.GEMINI_API_KEY || 'scriptboom').update(email).digest('base64url');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const body = req.body || {};

  // Vérifie qu'un accès déjà donné est toujours valable (email pas retiré de la liste)
  if (body.check) {
    const [e, sig] = String(req.headers['x-sb-token'] || '').split('.');
    const email = e ? Buffer.from(e, 'base64url').toString() : '';
    const ok = email && sig === sign(email) && invitedList().includes(email);
    return ok ? res.status(200).json({ ok: true }) : res.status(401).json({ error: 'Accès sur invitation' });
  }

  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });

  if (!invitedList().includes(email)) {
    console.log('ACCES REFUSE', email);
    return res.status(403).json({ error: "Cet email n'est pas encore invité. ScriptBoom est en accès privé pour le moment." });
  }
  console.log('ACCES OK', email);
  return res.status(200).json({ token: Buffer.from(email).toString('base64url') + '.' + sign(email) });
}
