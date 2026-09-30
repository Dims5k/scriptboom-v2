// Découpe le script en scènes, trouve pour chacune une vidéo libre de droits sur Pexels.
// Gratuit : Gemini (formule gratuite) + API Pexels (gratuite).
import { invited } from './_auth.js';
import { useQuota, refundQuota, sendLeft, QUOTA_MSG } from './_kv.js';
import { askGemini as ask, LIGHT_MODELS } from './_ai.js';

const PEXELS = ['https://api.pexels.com/v1/videos/search', 'https://api.pexels.com/videos/search'];

async function askGemini(prompt) {
  const json = await ask(prompt, { json: true, models: LIGHT_MODELS, budgetMs: 22000, validate: j => Array.isArray(Array.isArray(j) ? j : j && j.scenes) && (Array.isArray(j) ? j : j.scenes).length > 0 });
  return Array.isArray(json) ? json : json.scenes;
}

// Secours sans IA : on découpe le script par phrases et on cherche avec les mots les plus parlants
const STOP = new Set('chaque voici jusqu ceci celui celle entre depuis encore toujours jamais alors aussi avec avoir cette cela comme dans des elle elles est être fait faire mais même pour plus quand que qui sans ses son sont sur tes ton tous tout très une vous nous leur leurs parce pourquoi comment votre notre the and with that this from have what your'.split(' '));
function fallbackScenes(script) {
  const sent = String(script).replace(/\s+/g, ' ').trim().split(/(?<=[.!?…؟])\s+/).filter(Boolean);
  const n = Math.min(6, Math.max(1, sent.length)), per = Math.ceil(sent.length / n), out = [];
  for (let i = 0; i < sent.length; i += per) {
    const text = sent.slice(i, i + per).join(' ');
    const words = (text.toLowerCase().match(/[\p{L}]{4,}/gu) || []).filter(w => !STOP.has(w)).sort((x, y) => y.length - x.length);
    out.push({ text, query: words.slice(0, 2).join(' ') || 'abstract background', alt: words[0] || 'nature', wiki: '', locale: 'fr-FR' });
  }
  return out;
}

async function searchPexels(query, page = 1, orient = 'portrait', locale = '') {
  const qs = new URLSearchParams({ query, orientation: orient, size: 'medium', per_page: '15', page: String(page) });
  if (locale) qs.set('locale', locale);
  let lastError = 'Erreur Pexels';
  for (const base of PEXELS) {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(`${base}?${qs}`, { headers: { Authorization: process.env.PEXELS_API_KEY }, signal: ctl.signal }).finally(() => clearTimeout(timer));
      if (!r.ok) { lastError = `Pexels ${r.status}`; continue; }
      const data = await r.json();
      return data.videos || [];
    } catch (e) { lastError = e.message || lastError; }
  }
  throw new Error(lastError);
}

// Choisit le fichier au bon format (vertical, carré ou paysage) le plus proche de la taille voulue, hébergé chez Pexels.
function pickFile(video, orient = 'portrait') {
  const okShape = f => orient === 'landscape' ? f.width >= f.height : orient === 'square' ? true : f.height >= f.width;
  const files = (video.video_files || []).filter(f =>
    f.link && (f.file_type || '').includes('mp4') && okShape(f) && /^https:\/\/videos\.pexels\.com\//.test(f.link));
  if (!files.length) return null;
  const target = orient === 'landscape' ? 1280 : 720;
  files.sort((a, b) => Math.abs(a.width - target) - Math.abs(b.width - target));
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
function fromPexels(v, orient) {
  const f = pickFile(v, orient); if (!f) return null;
  return { id: v.id, src: '/pexels/' + f.link.replace(/^https:\/\/videos\.pexels\.com\//, ''), width: f.width, height: f.height,
           author: v.user?.name || 'Pexels', page: v.url || 'https://www.pexels.com', source: 'Pexels',
           // description de la vidéo, tirée de son adresse Pexels (ex. « man-lifting-barbell-in-gym »)
           desc: String(v.url || '').toLowerCase().replace(/^.*\/video\//, '').replace(/-?\d+\/?$/, '').replace(/-/g, ' ') };
}
// Pertinence : combien de mots de la recherche se retrouvent dans la description du média
function relevance(m, query) {
  if (!m || !m.desc) return 0;
  const d = ' ' + m.desc + ' ';
  return String(query || '').toLowerCase().split(/\s+/).filter(w => w.length > 2).reduce((n, w) => n + (d.includes(' ' + w) ? 1 : 0), 0);
}
// Cherche un média : photo libre du vrai sujet d'abord (si la scène en nomme un), puis vidéos Pexels, puis Pixabay
async function findMedia({ query, alt, wiki, locale }, page, used, orient = 'portrait') {
  const px = async q => {
    const list = (await searchPexels(q, page, orient, locale).catch(() => [])).map(v => fromPexels(v, orient)).filter(Boolean);
    // les vidéos qui correspondent le mieux à la recherche passent en premier (à pertinence égale, l'ordre de Pexels est gardé)
    return list.map((m, i) => ({ m, s: relevance(m, q) * 10 - i * 0.1 })).sort((a, b) => b.s - a.s).map(x => x.m);
  };
  const pick = list => list.find(m => m && !used.has(String(m.id)));
  const tries = [];
  if (wiki) tries.push(() => searchCommons(wiki));
  tries.push(() => px(query));
  if (alt) tries.push(() => px(alt));
  tries.push(() => searchPixabay(query, page).catch(() => []));
  if (alt) tries.push(() => searchPixabay(alt, page).catch(() => []));
  if (query.includes(' ')) tries.push(() => px(query.split(' ').slice(-1)[0]));
  for (const t of tries) { let m = null; try { m = pick(await t()); } catch (e) {} if (m) { used.add(String(m.id)); return m; } }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!process.env.PEXELS_API_KEY) return res.status(500).json({ error: 'Clé PEXELS_API_KEY manquante dans Vercel' });
  const { script, page = 1, query, exclude = [] } = req.body || {};
  // Remplacer une scène ne demande pas l'IA : gratuit. Seul le découpage complet compte pour 1 action.
  const q0 = query ? { ok: true } : await useQuota(who);
  if (!q0.ok) return res.status(429).json({ error: QUOTA_MSG, quota: true, code: 'QUOTA' });
  sendLeft(res, q0);
  const orient = ['portrait', 'square', 'landscape'].includes(req.body?.orient) ? req.body.orient : 'portrait';

  // Remplacer UNE scène : nouvelle recherche sur des mots-clés, en évitant les médias déjà utilisés
  if (query) {
    const q = String(query).trim().slice(0, 60);
    const used = new Set((Array.isArray(exclude) ? exclude : []).map(String));
    try {
      for (let p = Number(page) || 1, tries = 0; tries < 3; p++, tries++) {
        const m = await findMedia({ query: q, wiki: req.body.wiki ? String(req.body.wiki).slice(0, 80) : '' }, p, used, orient);
        if (m) return res.status(200).json({ video: m, page: p });
      }
      return res.status(404).json({ error: 'Aucun autre média trouvé pour « ' + q + ' »' });
    } catch (e) {
      return res.status(503).json({ error: 'La recherche de vidéos a échoué. Réessaie dans un instant.' });
    }
  }

  if (!script || typeof script !== 'string' || script.length > 2500) { await refundQuota(who); return res.status(400).json({ error: 'Script manquant ou trop long' }); }

  const prompt = `Tu prépares le montage d'une vidéo verticale (TikTok) à partir de ce script de voix off :

"""${script}"""

Découpe le script PHRASE PAR PHRASE : une scène = une phrase (deux seulement si elles sont très courtes), de 4 à 10 scènes consécutives qui couvrent TOUT le texte, dans l'ordre, sans rien ajouter ni enlever.
Pour chaque scène, donne :
- "query" : une recherche de vidéo d'archive (stock footage) en ANGLAIS, 2 à 4 mots, qui montre LITTÉRALEMENT ce que dit la phrase : l'objet, l'animal, la partie du corps, l'action ou le lieu cité, tel qu'on le verrait à l'écran (ex. « creatine powder scoop », « heart monitor hospital », « athlete lifting barbell gym », « lion hunting savanna »). Reprends en priorité les mots concrets de la phrase. Jamais un mot abstrait (success, idea, concept, motivation), ni un nom de personne ou de marque ;
- "alt" : une 2e recherche plus simple et plus large, en anglais, 1 à 2 mots, sur le même sujet concret ;
- "wiki" : dès que la phrase nomme une vraie personne célèbre, un lieu, une ville, un pays, un monument ou un événement historique précis, son nom exact en anglais tel qu'on le trouve sur Wikipédia (ex. « Malcolm X », « Eiffel Tower », « Apollo 11 ») : une vraie photo vaut mieux qu'une vidéo générique. Sinon "". Jamais pour un personnage de fiction, un dessin animé, un film, une série ou une marque.
Réponds en JSON : {"scenes":[{"text":"texte exact de la scène","query":"english search","alt":"simple","wiki":""}]}`;

  try {
    let raw, noAi = false;
    try { raw = await askGemini(prompt); }
    catch (e) { raw = fallbackScenes(script); noAi = true; console.log('SCENES secours sans IA', e.code || e.message); }
    const scenes = raw.map(s => ({ text: String(s.text || '').trim(), query: String(s.query || '').trim().slice(0, 60),
      alt: String(s.alt || '').trim().slice(0, 40), wiki: String(s.wiki || '').trim().slice(0, 80), locale: s.locale || '' })).filter(s => s.text && s.query);
    if (!scenes.length) throw new Error('Découpage vide');

    const used = new Set();
    const out = [];
    // Une scène après l'autre pour ne jamais réutiliser le même média
    for (const sc of scenes) out.push({ text: sc.text, query: sc.query, wiki: sc.wiki, video: await findMedia(sc, page, used, orient) });
    if (noAi) await refundQuota(who); // le secours n'a pas utilisé l'IA : gratuit
    if (!out.some(s => s.video)) { if (!noAi) await refundQuota(who); return res.status(404).json({ error: 'Aucune vidéo trouvée pour ce script. Essaie « Ma vidéo » ou modifie les mots-clés.' }); }
    return res.status(200).json({ scenes: out, noAi });
  } catch (e) {
    await refundQuota(who);
    return res.status(503).json({ error: 'La recherche de vidéos a échoué. Réessaie dans un instant.' });
  }
}
