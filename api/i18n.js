// Interface de ScriptBoom dans toutes les langues : chaque texte (écrit en français) est traduit UNE fois par l'IA,
// puis gardé dans Upstash et partagé par tous les utilisateurs (instantané ensuite, et gratuit).
import { invited } from './_auth.js';
import { kv, kvReady, rateLimit } from './_kv.js';
import { askGemini, LIGHT_MODELS } from './_ai.js';
import { LANGS } from './_langs.js';

// Les dialectes utilisent l'interface en arabe standard
const UI_BASE = { ma: 'ar', dz: 'ar', tn: 'ar', eg: 'ar', lb: 'ar' };
const NAMES = { ...LANGS, br: 'portugais du Brésil' };

async function translate(lang, list) {
  const prompt = `Traduis ces textes de l'interface d'une application mobile de création de vidéos courtes (ScriptBoom) du français vers : ${NAMES[lang]}.
Règles :
- Style d'application moderne, court, naturel, en tutoyant si la langue le permet.
- Garde EXACTEMENT les marqueurs {0}, {1}, {2}… (ce sont des nombres), les emojis, les symboles (→ ← ✓ ✕ • ▶ ■ ⚡ %), la ponctuation de début et de fin.
- Ne traduis jamais : ScriptBoom, BOOM, TikTok, Instagram, Reels, YouTube, Shorts, Threads, X, Pexels, Wikimedia, Gemini, Kore, Aoede, Leda, Sulafat, Puck, Charon, Fenrir, Orus, Bricolage, Anton, Poppins.
- Un texte qui est déjà dans la langue cible, ou un nom propre, reste tel quel.
- Glossaire (garde des mots DIFFÉRENTS pour chaque notion) : « Voix » = la voix off qui lit le script ; « Son » = le mixage audio (musique, bruitages, volumes) ; « Fonds » = les vidéos d'arrière-plan ; « Accroche » = le texte choc affiché au début ; « Sous-titres » = les mots affichés pendant la voix ; « Script » = le texte lu par la voix.
Réponds UNIQUEMENT avec un tableau JSON de ${list.length} chaînes, dans le même ordre :
${JSON.stringify(list)}`;
  const arr = await askGemini(prompt, { json: true, models: LIGHT_MODELS, temperature: 0.2, timeoutMs: 20000, budgetMs: 40000,
    validate: a => Array.isArray(a) && a.length === list.length });
  return arr.map((x, i) => {
    const s = String(x ?? '').trim();
    // sécurité : même nombre de marqueurs {n}, sinon on garde le français
    const want = (list[i].match(/\{\d+\}/g) || []).length, got = (s.match(/\{\d+\}/g) || []).length;
    return s && want === got ? s.slice(0, 600) : list[i];
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  const b = req.body || {};
  const lang = UI_BASE[b.lang] || String(b.lang || '');
  if (!NAMES[lang] || lang === 'fr') return res.status(400).json({ error: 'Langue inconnue' });
  const strings = [...new Set((Array.isArray(b.strings) ? b.strings : []).map(s => String(s || '').slice(0, 400)).filter(s => /\p{L}/u.test(s)))].slice(0, 60);
  if (!strings.length) return res.status(200).json({ lang, map: {} });
  if (!(await rateLimit('i18n', who, 40, 60))) return res.status(429).json({ error: 'Trop de demandes de traduction, patiente une minute.' });
  const key = 'i18n:' + lang, map = {};
  try {
    let missing = strings;
    if (kvReady()) {
      const [vals] = await kv([['HMGET', key, ...strings]]);
      missing = [];
      strings.forEach((s, i) => { if (vals && vals[i] != null) map[s] = vals[i]; else missing.push(s); });
    }
    // Traduit ce qui manque, par paquets
    for (let i = 0; i < missing.length; i += 60) {
      const part = missing.slice(i, i + 60), out = await translate(lang, part);
      part.forEach((s, k) => { map[s] = out[k]; });
      if (kvReady()) await kv([['HSET', key, ...part.flatMap((s, k) => [s, out[k]])]]);
    }
    return res.status(200).json({ lang, map });
  } catch (e) {
    return res.status(e.status || 503).json({ error: e.message || 'Traduction indisponible', code: e.code || 'AI_BAD', lang, map });
  }
}
