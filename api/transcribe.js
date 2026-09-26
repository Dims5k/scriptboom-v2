// Sous-titres automatiques d'une vidéo importée : l'IA (Gemini, formule gratuite) écoute un morceau du son
// (WAV 16 kHz mono, 60 s maximum par envoi) et renvoie le texte exact, découpé en petits segments avec leurs horaires.
import { invited } from './_auth.js';
import { useQuota, QUOTA_MSG, friendly } from './_kv.js';
import { LANGS } from './_langs.js';

const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  const b = req.body || {};
  const audio = String(b.audio || '');
  if (!audio || audio.length > 3_000_000) return res.status(400).json({ error: 'Morceau audio manquant ou trop long' });
  const dur = Math.max(0.5, Math.min(70, Number(b.duration) || 0));
  // le 1er morceau d'une vidéo compte pour 1 action IA, les suivants sont gratuits
  if (!b.part && !(await useQuota(who, 1)).ok) return res.status(429).json({ error: QUOTA_MSG, quota: true });
  const hint = LANGS[b.lang] ? `La langue parlée est probablement : ${LANGS[b.lang]} (mais transcris la langue réellement parlée).` : '';
  const prompt = `Transcris EXACTEMENT ce que dit la voix dans cet audio de ${dur.toFixed(1)} secondes, mot pour mot, avec la ponctuation. ${hint}
Ne traduis pas, ne résume pas, n'invente rien. Ignore la musique et les bruits. S'il n'y a aucune parole, renvoie une liste vide.
Découpe en segments courts de 1 à 7 mots qui suivent le rythme de la parole, avec l'horaire de début et de fin de chaque segment en secondes depuis le début de l'audio (précision au dixième, entre 0 et ${dur.toFixed(1)}).
Réponds UNIQUEMENT en JSON : {"language":"code ISO de la langue parlée","segments":[{"start":0.0,"end":1.2,"text":"..."}]}`;
  let last = 'Erreur IA';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'audio/wav', data: audio } }, { text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
      });
      const data = await r.json();
      if (!r.ok) { last = data?.error?.message || last; continue; }
      const t = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      const out = JSON.parse(t.replace(/^```(json)?|```$/g, '').trim());
      let prev = 0;
      const segments = (Array.isArray(out.segments) ? out.segments : []).map(s => {
        const text = String(s?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        let start = Math.max(prev, Math.min(dur, Number(s?.start) || prev)), end = Math.min(dur, Number(s?.end) || start + 0.8);
        if (end <= start) end = Math.min(dur, start + 0.3 + text.split(' ').length * 0.28);
        prev = start; return text ? { start: +start.toFixed(2), end: +end.toFixed(2), text } : null;
      }).filter(Boolean);
      return res.status(200).json({ language: String(out.language || '').slice(0, 8), segments });
    } catch (e) { last = e.message || last; }
  }
  return res.status(500).json({ error: friendly(last) });
}
