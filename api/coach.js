// Coach ScriptBoom : analyse d'un short (captures des stats + images clés de la vidéo + réglages du projet)
// pour TikTok, YouTube Shorts, Instagram Reels, Threads, X… et historique des analyses sauvegardé en ligne.
// Gratuit : Gemini (formule gratuite) + Upstash.
import { invited, isAdmin } from './_auth.js';
import { kv, kvReady, useQuota, QUOTA_MSG, friendly } from './_kv.js';
import { LANGS } from './_langs.js';
const UI_BASE = { ma: 'ar', dz: 'ar', tn: 'ar', eg: 'ar', lb: 'ar' };

const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
const MAX_ITEMS = 80;

// Réglages que le coach a le droit de changer, avec leurs valeurs possibles
export const SETTINGS = {
  capStyle: ['classique', 'jaune', 'neon', 'karaoke', 'minimal'],
  capFont: ['bricolage', 'anton', 'poppins'],
  capPos: ['.3', '.52', '.72'],
  capWords: ['1', '2', '3', '4'],
  capUpper: 'bool', kwOn: 'bool', progOn: 'bool', endOn: 'bool',
  fx: ['aucun', 'doux', 'dynamique'],
  dur: ['20', '35', '60'],
  tone: ['mystérieux et captivant', 'énergique et fun', 'pédagogique et clair', 'motivant et intense'],
  format: ['libre', 'histoire', 'fait', 'top5', 'citation', 'saviezvous'],
  mood: ['none', 'triste', 'calme', 'suspense', 'motivation', 'joyeux'],
  speed: ['0.9', '1', '1.1', '1.2'],
  voice: ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Puck', 'Charon', 'Fenrir', 'Orus'],
  volMusic: 'pct', volSfx: 'pct',
  vfmt: ['916', '11', '169'],
  hook: 'text'
};
const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'threads', 'x', 'autre'];
const CATS = ['accroche', 'rythme', 'sous-titres', 'visuel', 'son', 'longueur', 'sujet', 'appel à l\'action', 'publication'];

function cleanValue(key, v) {
  const rule = SETTINGS[key]; if (!rule) return null;
  if (rule === 'bool') return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
  if (rule === 'pct') { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 100 ? String(n) : null; }
  if (rule === 'text') { const t = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80); return t || null; }
  const s = String(v); return rule.includes(s) ? s : null;
}
const txt = (v, n = 300) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

async function askGemini(parts) {
  let lastError = 'Erreur IA';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } })
      });
      const data = await r.json();
      if (!r.ok) { lastError = data?.error?.message || 'Erreur IA'; continue; }
      const t = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      return JSON.parse(t.replace(/^```(json)?|```$/g, '').trim());
    } catch (e) { lastError = e.message || lastError; }
  }
  throw new Error(lastError);
}

async function analyze(b) {
  const platform = PLATFORMS.includes(b.platform) ? b.platform : 'autre';
  const shots = (Array.isArray(b.images) ? b.images : []).slice(0, 4).filter(im => im && /^image\/(jpeg|png|webp)$/.test(im.mime) && typeof im.data === 'string');
  const frames = (Array.isArray(b.frames) ? b.frames : []).slice(0, 14).filter(f => f && typeof f.data === 'string');
  if (!shots.length && !frames.length) throw new Error('Ajoute au moins une capture de tes stats ou ta vidéo.');
  const p = b.project || {};
  const cur = {}; for (const k of Object.keys(SETTINGS)) { const v = cleanValue(k, p.settings?.[k]); if (v != null) cur[k] = v; }
  const parts = [];
  shots.forEach((im, i) => { parts.push({ text: `Capture de statistiques n° ${i + 1} :` }); parts.push({ inline_data: { mime_type: im.mime, data: im.data } }); });
  frames.forEach(f => { parts.push({ text: `Image de la vidéo à ${Number(f.t).toFixed(1)} s :` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: f.data } }); });
  parts.push({ text: `Tu es le meilleur coach au monde pour les vidéos courtes verticales (TikTok, YouTube Shorts, Instagram Reels, Threads, X), spécialiste des vidéos explicatives sans visage.
Plateforme indiquée : ${platform}. ${b.duration ? `Durée de la vidéo : ${Number(b.duration).toFixed(1)} s.` : ''} ${b.note ? `Précision du créateur : « ${txt(b.note, 300)} ».` : ''}
${shots.length ? 'Les captures montrent les statistiques de la vidéo : lis les chiffres EXACTS (vues, likes, commentaires, partages, enregistrements, durée moyenne de visionnage, % regardé en entier, rétention, abonnés gagnés, sources de trafic). Ne devine jamais un chiffre absent : mets null.' : 'Pas de capture de statistiques : base-toi sur la vidéo seulement et mets les chiffres à null.'}
${frames.length ? 'Les images de la vidéo sont données avec leur moment (en secondes) : juge l\'accroche visuelle des 2 premières secondes, la lisibilité et le style des sous-titres, le rythme des plans, les moments où l\'attention risque de chuter.' : ''}
${p.script ? `Script de la voix off : « ${txt(p.script, 1500)} »` : ''}${p.hook ? `\nAccroche à l'écran : « ${txt(p.hook, 100)} »` : ''}${p.topic ? `\nSujet : « ${txt(p.topic, 120)} »` : ''}
Réglages actuels du projet ScriptBoom (JSON) : ${JSON.stringify(cur)}
Réglages possibles et leurs valeurs autorisées : ${JSON.stringify(SETTINGS)} (capFont : bricolage = arrondie moderne, anton = très grasse et serrée style TikTok, poppins = ronde et nette ; capPos : .3 haut, .52 milieu, .72 bas ; vfmt : 916 vertical, 11 carré, 169 paysage ; volMusic/volSfx en % de 0 à 100 ; hook = nouvelle accroche à l'écran de 8 mots maximum).

Réponds en ${LANGS[UI_BASE[b.lang] || b.lang] || 'français'} (tous les textes du JSON, sauf les clés, les valeurs de réglages et les catégories qui restent exactement comme dans la liste), en tutoyant, de façon concrète et directe. Réponds UNIQUEMENT en JSON :
{"platform":"tiktok|youtube|instagram|threads|x|autre (celle que tu reconnais sur les captures, sinon celle indiquée)",
"title":"titre court de la vidéo (déduit du sujet ou des images)",
"metrics":{"views":nombre|null,"likes":nombre|null,"comments":nombre|null,"shares":nombre|null,"saves":nombre|null,"avgWatchSec":nombre|null,"completionPct":nombre|null,"retention3sPct":nombre|null,"followersGained":nombre|null},
"score":note de 0 à 100 du potentiel de la vidéo (accroche, rétention, clarté, partage),
"verdict":"une phrase qui résume",
"strengths":["2 à 4 points forts"],
"problems":[{"time":secondes|null,"category":"une de ${JSON.stringify(CATS)}","issue":"ce qui ne va pas","fix":"la correction précise à faire"}],
"changes":[{"key":"un réglage de la liste","value":"nouvelle valeur autorisée","why":"pourquoi ce changement fera plus de vues"}],
"rules":["3 à 5 règles courtes à appliquer aux prochains scripts"],
"nextIdeas":["3 sujets de prochaines vidéos dans la même niche, formulés comme des sujets"]}
Dans "changes", ne propose QUE des réglages à modifier (valeur différente de l'actuelle) qui ont un vrai impact, 2 à 6 maximum, classés du plus important au moins important.` });

  const out = await askGemini(parts);
  const m = out.metrics || {};
  const changes = (Array.isArray(out.changes) ? out.changes : []).map(c => {
    const key = String(c?.key || ''), value = cleanValue(key, c?.value);
    if (value == null || (cur[key] != null && String(cur[key]) === String(value))) return null;
    return { key, value, from: cur[key] ?? null, why: txt(c.why, 220) };
  }).filter(Boolean).filter((c, i, a) => a.findIndex(x => x.key === c.key) === i).slice(0, 6);
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: Date.now(),
    platform: PLATFORMS.includes(out.platform) ? out.platform : platform,
    title: txt(out.title, 90) || txt(p.topic, 90) || 'Vidéo sans titre',
    metrics: Object.fromEntries(['views', 'likes', 'comments', 'shares', 'saves', 'avgWatchSec', 'completionPct', 'retention3sPct', 'followersGained'].map(k => [k, num(m[k])])),
    score: Math.max(0, Math.min(100, Math.round(num(out.score) ?? 50))),
    verdict: txt(out.verdict, 240),
    strengths: (out.strengths || []).map(s => txt(s, 200)).filter(Boolean).slice(0, 4),
    problems: (out.problems || []).map(x => ({ time: num(x?.time), category: CATS.includes(x?.category) ? x.category : 'rythme', issue: txt(x?.issue, 220), fix: txt(x?.fix, 220) })).filter(x => x.issue).slice(0, 8),
    changes,
    rules: (out.rules || []).map(s => txt(s, 200)).filter(Boolean).slice(0, 5),
    nextIdeas: (out.nextIdeas || []).map(s => txt(s, 140)).filter(Boolean).slice(0, 3),
    hadVideo: frames.length > 0, hadStats: shots.length > 0
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  const key = 'coach:' + String(who).toLowerCase();
  try {
    if (req.method === 'GET') {
      if (!kvReady()) return res.status(200).json({ items: [] });
      const [all] = await kv([['HGETALL', key]]);
      const items = []; for (let i = 0; i < (all || []).length; i += 2) { try { items.push(JSON.parse(all[i + 1])); } catch (e) {} }
      items.sort((a, b) => (b.date || 0) - (a.date || 0));
      return res.status(200).json({ items });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
    const b = req.body || {};
    if (b.action === 'delete') {
      if (kvReady()) await kv([['HDEL', key, String(b.id || '').slice(0, 40)]]);
      return res.status(200).json({ ok: true });
    }
    // Analyse : compte pour 2 actions IA (images + vidéo)
    if (!isAdmin(who) && !(await useQuota(who, 2)).ok) return res.status(429).json({ error: QUOTA_MSG, quota: true });
    const item = await analyze(b);
    if (kvReady()) {
      const [, n] = await kv([['HSET', key, item.id, JSON.stringify(item)], ['HLEN', key]]);
      if (n > MAX_ITEMS) {
        const [all] = await kv([['HGETALL', key]]); const list = [];
        for (let i = 0; i < all.length; i += 2) { let d = 0; try { d = JSON.parse(all[i + 1]).date || 0; } catch (e) {} list.push([all[i], d]); }
        list.sort((x, y) => x[1] - y[1]); const old = list.slice(0, n - MAX_ITEMS).map(x => x[0]);
        if (old.length) await kv([['HDEL', key, ...old]]);
      }
    }
    return res.status(200).json({ item });
  } catch (e) {
    return res.status(500).json({ error: friendly(e.message || 'Erreur') });
  }
}
