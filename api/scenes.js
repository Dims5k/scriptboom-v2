// Découpe le script en scènes, trouve pour chacune une vidéo libre de droits sur Pexels.
// Gratuit : Gemini (formule gratuite) + API Pexels (gratuite).
import { createHmac } from 'crypto';

// Accès sur invitation : seuls les emails listés dans EMAILS_AUTORISES (réglages Vercel) peuvent utiliser l'appli.
function invited(req) {
  const list = String(process.env.EMAILS_AUTORISES || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const [e, sig] = String(req.headers['x-sb-token'] || '').split('.');
  if (!e || !sig) return false;
  const email = Buffer.from(e, 'base64url').toString();
  const good = createHmac('sha256', process.env.ACCESS_SECRET || process.env.GEMINI_API_KEY || 'scriptboom').update(email).digest('base64url');
  return sig === good && list.includes(email);
}
const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
const PEXELS = ['https://api.pexels.com/v1/videos/search', 'https://api.pexels.com/videos/search'];

async function askGemini(prompt) {
  let lastError = 'Erreur IA';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      const data = await r.json();
      if (!r.ok) { lastError = data?.error?.message || 'Erreur IA'; continue; }
      const txt = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      const json = JSON.parse(txt.replace(/^```(json)?|```$/g, '').trim());
      const scenes = Array.isArray(json) ? json : json.scenes;
      if (Array.isArray(scenes) && scenes.length) return scenes;
      lastError = 'Découpage vide';
    } catch (e) { lastError = e.message || lastError; }
  }
  throw new Error(lastError);
}

async function searchPexels(query, page = 1) {
  const qs = new URLSearchParams({ query, orientation: 'portrait', size: 'medium', per_page: '8', page: String(page) });
  let lastError = 'Erreur Pexels';
  for (const base of PEXELS) {
    try {
      const r = await fetch(`${base}?${qs}`, { headers: { Authorization: process.env.PEXELS_API_KEY } });
      if (!r.ok) { lastError = `Pexels ${r.status}`; continue; }
      const data = await r.json();
      return data.videos || [];
    } catch (e) { lastError = e.message || lastError; }
  }
  throw new Error(lastError);
}

// Choisit le fichier vertical le plus proche de 720 px de large, hébergé chez Pexels.
function pickFile(video) {
  const files = (video.video_files || []).filter(f =>
    f.link && (f.file_type || '').includes('mp4') && f.height >= f.width && /^https:\/\/videos\.pexels\.com\//.test(f.link));
  if (!files.length) return null;
  files.sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720));
  return files[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!invited(req)) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!process.env.PEXELS_API_KEY) return res.status(500).json({ error: 'Clé PEXELS_API_KEY manquante dans Vercel' });
  const { script, page = 1, query, exclude = [] } = req.body || {};

  // Remplacer UNE scène : nouvelle recherche sur des mots-clés, en évitant les vidéos déjà utilisées
  if (query) {
    const q = String(query).trim().slice(0, 60);
    const skip = new Set((Array.isArray(exclude) ? exclude : []).map(Number));
    try {
      for (let p = Number(page) || 1, tries = 0; tries < 3; p++, tries++) {
        const videos = await searchPexels(q, p);
        if (!videos.length) break;
        for (const v of videos) {
          if (skip.has(Number(v.id))) continue;
          const f = pickFile(v); if (!f) continue;
          return res.status(200).json({ video: {
            id: v.id, src: '/pexels/' + f.link.replace(/^https:\/\/videos\.pexels\.com\//, ''),
            width: f.width, height: f.height, author: v.user?.name || 'Pexels', page: v.url || 'https://www.pexels.com'
          }, page: p });
        }
      }
      return res.status(404).json({ error: 'Aucune autre vidéo trouvée pour « ' + q + ' »' });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'Erreur Pexels' });
    }
  }

  if (!script || typeof script !== 'string' || script.length > 2500) return res.status(400).json({ error: 'Script manquant ou trop long' });

  const prompt = `Tu prépares le montage d'une vidéo verticale (TikTok) à partir de ce script de voix off :

"""${script}"""

Découpe le script en 4 à 8 scènes consécutives qui couvrent TOUT le texte, dans l'ordre, sans rien ajouter ni enlever.
Pour chaque scène, donne une recherche de vidéo d'archive (stock footage) en ANGLAIS, 1 à 3 mots, qui illustre visuellement la scène.
Règles pour la recherche : des choses filmables et concrètes (lieux, objets, foules, actions, ambiances, époques) ; jamais de nom de personne célèbre ; pas de mots abstraits.
Réponds en JSON : {"scenes":[{"text":"texte exact de la scène","query":"english search"}]}`;

  try {
    const raw = await askGemini(prompt);
    const scenes = raw.map(s => ({ text: String(s.text || '').trim(), query: String(s.query || '').trim().slice(0, 60) }))
                      .filter(s => s.text && s.query);
    if (!scenes.length) throw new Error('Découpage vide');

    const used = new Set();
    const results = await Promise.all(scenes.map(async s => {
      let videos = [];
      try { videos = await searchPexels(s.query, page); } catch (e) {}
      if (!videos.length && s.query.includes(' ')) {
        try { videos = await searchPexels(s.query.split(' ').slice(-1)[0], page); } catch (e) {}
      }
      return { ...s, videos };
    }));

    const out = results.map(s => {
      for (const v of s.videos) {
        if (used.has(v.id)) continue;
        const f = pickFile(v);
        if (!f) continue;
        used.add(v.id);
        return {
          text: s.text, query: s.query,
          video: {
            id: v.id,
            src: '/pexels/' + f.link.replace(/^https:\/\/videos\.pexels\.com\//, ''),
            width: f.width, height: f.height,
            author: v.user?.name || 'Pexels', page: v.url || 'https://www.pexels.com'
          }
        };
      }
      return { text: s.text, query: s.query, video: null };
    });

    if (!out.some(s => s.video)) return res.status(500).json({ error: 'Aucune vidéo trouvée sur Pexels' });
    return res.status(200).json({ scenes: out });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erreur' });
  }
}
