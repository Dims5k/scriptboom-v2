// Sous-titres automatiques d'une vidéo importée : l'IA (Gemini, formule gratuite) écoute un morceau du son
// (WAV 16 kHz mono, morceaux d'environ 20 s coupés sur un silence) et renvoie le texte exact, découpé en petits segments avec leurs horaires.
import { invited } from './_auth.js';
import { useQuota, refundQuota, sendLeft, QUOTA_MSG } from './_kv.js';
import { askGemini, sendAiError } from './_ai.js';
import { LANGS } from './_langs.js';


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
  const q = b.part ? { ok: true } : await useQuota(who, 1);
  if (!q.ok) return res.status(429).json({ error: QUOTA_MSG, quota: true, code: 'QUOTA' });
  sendLeft(res, q);
  const hint = LANGS[b.lang] ? `La langue parlée est probablement : ${LANGS[b.lang]} (mais transcris la langue réellement parlée).` : '';
  // Lexique de l'utilisateur (dictionnaire de prononciation) : noms, marques, mots de la rue, écrits comme il les écrit
  const lex = (Array.isArray(b.lexicon) ? b.lexicon : []).map(w => String(w || '').replace(/[^\p{L}\p{N} '’.-]/gu, '').trim().slice(0, 40)).filter(Boolean).slice(0, 60);
  const lexTxt = lex.length ? `Orthographe à utiliser quand ces mots sont prononcés : ${lex.join(', ')}.` : '';
  // Voix déjà repérées dans les morceaux précédents : on garde les mêmes numéros
  const known = (Array.isArray(b.speakers) ? b.speakers : []).slice(0, 6).map(x => ({ id: Math.max(1, Math.min(6, Math.round(Number(x?.id) || 1))), desc: String(x?.desc || '').slice(0, 60) }));
  const spkTxt = known.length ? `Voix déjà repérées plus tôt dans la même vidéo (réutilise leur numéro si c'est la même personne) : ${known.map(x => `${x.id} = ${x.desc}`).join(' ; ')}.` : '';
  const prompt = `Transcris EXACTEMENT ce que dit la voix dans cet audio de ${dur.toFixed(1)} secondes, mot pour mot, avec la ponctuation. ${hint}
Ne traduis pas, ne résume pas, ne corrige pas, n'invente rien. Ignore la musique et les bruits. S'il n'y a aucune parole, renvoie une liste vide.
ARGOT : garde exactement les mots dits, même familiers : argot, verlan, mots de la rue, darija, anglicismes, abréviations (wesh, frérot, zarma, la hess, askip, wallah, bg, chelou, ouf, grave, genre…). Écris-les comme on les écrit sur TikTok, sans les remplacer par du français standard. ${lexTxt}
Si de la musique ou des paroles chantées couvrent la voix, cale quand même chaque horaire sur le moment exact où le mot est prononcé, pas sur le rythme de la musique.
Découpe en segments courts de 1 à 7 mots qui suivent le rythme de la parole, avec l'horaire de début et de fin de chaque segment en secondes depuis le début de l'audio (précision au dixième, entre 0 et ${dur.toFixed(1)}).
Un segment ne contient qu'une seule voix. Numérote chaque personne qui parle (1, 2, 3… jusqu'à 6) et décris chaque voix en quelques mots (ex. « homme, voix grave »). ${spkTxt}
Réponds UNIQUEMENT en JSON : {"language":"code ISO de la langue parlée","speakers":[{"id":1,"desc":"..."}],"segments":[{"start":0.0,"end":1.2,"speaker":1,"text":"..."}]}`;
  try {
    const out = await askGemini('', { json: true, temperature: 0, timeoutMs: 40000, budgetMs: 55000,
      parts: [{ inline_data: { mime_type: 'audio/wav', data: audio } }, { text: prompt }] });
    let prev = 0;
    const segments = (Array.isArray(out.segments) ? out.segments : []).map(s => {
      const text = String(s?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      let start = Math.max(prev, Math.min(dur, Number(s?.start) || prev)), end = Math.min(dur, Number(s?.end) || start + 0.8);
      if (end <= start) end = Math.min(dur, start + 0.3 + text.split(' ').length * 0.28);
      const speaker = Math.max(1, Math.min(6, Math.round(Number(s?.speaker) || 1)));
      prev = start; return text ? { start: +start.toFixed(2), end: +end.toFixed(2), speaker, text } : null;
    }).filter(Boolean);
    const speakers = (Array.isArray(out.speakers) ? out.speakers : []).slice(0, 6).map(x => ({ id: Math.max(1, Math.min(6, Math.round(Number(x?.id) || 1))), desc: String(x?.desc || '').replace(/\s+/g, ' ').trim().slice(0, 60) }));
    return res.status(200).json({ language: String(out.language || '').slice(0, 8), speakers, segments });
  } catch (e) {
    if (!b.part) await refundQuota(who, 1);
    return sendAiError(res, e);
  }
}
