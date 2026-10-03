// Horaire exact de chaque mot d'un morceau de son (Whisper large-v3 chez Groq, formule gratuite).
// Sert à recaler le rythme des sous-titres d'une vidéo importée (sons, rap) : le texte affiché reste celui de l'utilisateur.
import { invited } from './_auth.js';
import { rateLimit } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "Whisper n'est pas encore branché (clé GROQ_API_KEY manquante sur Vercel)", code: 'AI_KEY' });
  if (!(await rateLimit('align', who, 60, 3600))) return res.status(429).json({ error: 'Trop de recalages en une heure. Réessaie un peu plus tard.' });
  const b = req.body || {};
  const audio = String(b.audio || '');
  if (!audio || audio.length > 3_500_000) return res.status(400).json({ error: 'Morceau audio manquant ou trop long' });
  const language = /^[a-z]{2}$/.test(String(b.lang || '')) ? String(b.lang) : '';
  try {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from(audio, 'base64')], { type: 'audio/wav' }), 'son.wav');
    fd.append('model', 'whisper-large-v3-turbo');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    fd.append('timestamp_granularities[]', 'segment');
    fd.append('temperature', '0');
    if (language) fd.append('language', language);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
    let r;
    try { r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: fd, signal: ctl.signal }); }
    finally { clearTimeout(timer); }
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) {
      const raw = d?.error?.message || `HTTP ${r.status}`;
      console.log('WHISPER ERREUR', r.status, raw.slice(0, 160));
      if (r.status === 429) return res.status(429).json({ error: 'Whisper est très demandé en ce moment. Réessaie dans une minute.' });
      return res.status(502).json({ error: 'Whisper a renvoyé une erreur. Réessaie.' });
    }
    const words = (Array.isArray(d.words) ? d.words : [])
      .map(w => ({ w: String(w.word || '').trim().slice(0, 60), start: +Number(w.start).toFixed(2), end: +Number(w.end).toFixed(2) }))
      .filter(w => w.w && isFinite(w.start));
    return res.status(200).json({ words, language: String(d.language || '').slice(0, 20) });
  } catch (e) {
    console.log('WHISPER RESEAU', e.name, e.message);
    return res.status(504).json({ error: e.name === 'AbortError' ? 'Whisper a mis trop de temps à répondre. Réessaie.' : 'Whisper est injoignable. Réessaie.' });
  }
}
