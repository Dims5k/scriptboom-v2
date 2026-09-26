// Découpe le script en scènes, trouve pour chacune une vidéo libre de droits sur Pexels.
// Gratuit : Gemini (formule gratuite) + API Pexels (gratuite).
import { invited } from './_auth.js';
import { useQuota, QUOTA_MSG, friendly } from './_kv.js';

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

// ---------- Pixabay (gratuit, facultatif : clé PIXABAY_API_KEY dans Vercel) ----------
async function searchPixabay(query, page = 1) {
  if (!process.env.PIXABAY_API_KEY) return [];
  const qs = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q: query, per_page: '10', page: String(page), safesearch: 'true' });
  const r = await fetch('https://pixabay.com/api/videos/?' + qs);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.hits || []).map(h => {
    const f = h.videos?.medium?.url ? h.videos.medium : h.videos?.small?.url ? h.videos.small : h.videos?.large;
    if (!f?.url || !/^https:\/\/cdn\.pixabay\.com\//.test(f.url)) return null;
    return { id: 'px' + h.id, src: '/pixabay/' + f.url.replace(/^https:\/\/cdn\.pixabay\.com\//, ''), width: f.width, height: f.height,
             author: h.user || 'Pixabay', page: h.pageURL || 'https://pixabay.com', source: 'Pixabay' };
  }).filter(Boolean);
}

// ---------- Wikimedia Commons : vraies photos libres (personnes célèbres, lieux, événements) ----------
const FREE_LICENSE = /^(public domain|pd|cc0|cc[ -]by([ -]sa)?( [0-9.]+)?)/i;
async function searchCommons(title) {
  const qs = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: title + ' filetype:bitmap', gsrnamespace: '6',
    gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1080', origin: '*' });
  const r = await fetch('https://commons.wikimedia.org/w/api.php?' + qs, { headers: { 'User-Agent': 'ScriptBoom/1.0 (https://scriptboom-v2.vercel.app)' } });
  if (!r.ok) return [];
  const data = await r.json();
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const strip = t => String(t || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return pages.map(p => {
    const ii = p.imageinfo?.[0]; if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) return null;
    const lic = strip(ii.extmetadata?.LicenseShortName?.value);
    if (!FREE_LICENSE.test(lic)) return null;
    const url = ii.thumburl || ii.url;
    if (!/^https:\/\/upload\.wikimedia\.org\//.test(url) || (ii.width || 0) < 500) return null;
    return { id: 'wm' + p.pageid, image: true, src: '/wiki/' + url.replace(/^https:\/\/upload\.wikimedia\.org\//, ''), width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height,
             author: strip(ii.extmetadata?.Artist?.value) || 'Wikimedia Commons', license: lic, page: ii.descriptionurl || 'https://commons.wikimedia.org', source: 'Wikimedia Commons' };
  }).filter(Boolean);
}
function fromPexels(v) {
  const f = pickFile(v); if (!f) return null;
  return { id: v.id, src: '/pexels/' + f.link.replace(/^https:\/\/videos\.pexels\.com\//, ''), width: f.width, height: f.height,
           author: v.user?.name || 'Pexels', page: v.url || 'https://www.pexels.com', source: 'Pexels' };
}
// Cherche un média : photo libre du vrai sujet d'abord (si la scène en nomme un), puis vidéos Pexels, puis Pixabay
async function findMedia({ query, alt, wiki }, page, used) {
  const pick = list => list.find(m => m && !used.has(String(m.id)));
  const tries = [];
  if (wiki) tries.push(() => searchCommons(wiki));
  tries.push(async () => (await searchPexels(query, page).catch(() => [])).map(fromPexels));
  if (alt) tries.push(async () => (await searchPexels(alt, page).catch(() => [])).map(fromPexels));
  tries.push(() => searchPixabay(query, page).catch(() => []));
  if (alt) tries.push(() => searchPixabay(alt, page).catch(() => []));
  if (query.includes(' ')) tries.push(async () => (await searchPexels(query.split(' ').slice(-1)[0], page).catch(() => [])).map(fromPexels));
  for (const t of tries) { let m = null; try { m = pick(await t()); } catch (e) {} if (m) { used.add(String(m.id)); return m; } }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!(await useQuota(who)).ok) return res.status(429).json({ error: QUOTA_MSG, quota: true });
  if (!process.env.PEXELS_API_KEY) return res.status(500).json({ error: 'Clé PEXELS_API_KEY manquante dans Vercel' });
  const { script, page = 1, query, exclude = [] } = req.body || {};

  // Remplacer UNE scène : nouvelle recherche sur des mots-clés, en évitant les médias déjà utilisés
  if (query) {
    const q = String(query).trim().slice(0, 60);
    const used = new Set((Array.isArray(exclude) ? exclude : []).map(String));
    try {
      for (let p = Number(page) || 1, tries = 0; tries < 3; p++, tries++) {
        const m = await findMedia({ query: q, wiki: req.body.wiki ? String(req.body.wiki).slice(0, 80) : '' }, p, used);
        if (m) return res.status(200).json({ video: m, page: p });
      }
      return res.status(404).json({ error: 'Aucun autre média trouvé pour « ' + q + ' »' });
    } catch (e) {
      return res.status(500).json({ error: friendly(e.message || 'Erreur de recherche') });
    }
  }

  if (!script || typeof script !== 'string' || script.length > 2500) return res.status(400).json({ error: 'Script manquant ou trop long' });

  const prompt = `Tu prépares le montage d'une vidéo verticale (TikTok) à partir de ce script de voix off :

"""${script}"""

Découpe le script en 4 à 8 scènes consécutives qui couvrent TOUT le texte, dans l'ordre, sans rien ajouter ni enlever.
Pour chaque scène, donne :
- "query" : une recherche de vidéo d'archive (stock footage) en ANGLAIS, 2 à 4 mots, très visuelle et précise : sujet + lieu ou action + ambiance (ex. « old tv living room », « heart monitor hospital », « athlete lifting barbell gym »). Choisis ce qui évoque le mieux le sujet réel de la scène, jamais un mot abstrait ni un nom de personne ou de marque ;
- "alt" : une 2e recherche plus simple et plus large, en anglais, 1 à 2 mots ;
- "wiki" : SEULEMENT si la scène parle d'une vraie personne célèbre, d'un lieu, d'un monument ou d'un événement historique précis, son nom exact en anglais tel qu'on le trouve sur Wikipédia (ex. « Malcolm X », « Eiffel Tower », « Apollo 11 ») ; sinon "". Jamais pour un personnage de fiction, un dessin animé, un film, une série ou une marque.
Réponds en JSON : {"scenes":[{"text":"texte exact de la scène","query":"english search","alt":"simple","wiki":""}]}`;

  try {
    const raw = await askGemini(prompt);
    const scenes = raw.map(s => ({ text: String(s.text || '').trim(), query: String(s.query || '').trim().slice(0, 60),
      alt: String(s.alt || '').trim().slice(0, 40), wiki: String(s.wiki || '').trim().slice(0, 80) })).filter(s => s.text && s.query);
    if (!scenes.length) throw new Error('Découpage vide');

    const used = new Set();
    const out = [];
    // Une scène après l'autre pour ne jamais réutiliser le même média
    for (const sc of scenes) out.push({ text: sc.text, query: sc.query, wiki: sc.wiki, video: await findMedia(sc, page, used) });
    if (!out.some(s => s.video)) return res.status(500).json({ error: 'Aucune vidéo trouvée' });
    return res.status(200).json({ scenes: out });
  } catch (e) {
    return res.status(500).json({ error: friendly(e.message || 'Erreur') });
  }
}
