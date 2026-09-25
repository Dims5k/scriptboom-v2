// Textes générés par l'IA (Gemini, formule gratuite) :
// mode "script" (par défaut) : accroche + script ; mode "ideas" : 10 idées ; mode "caption" : titre, légende, hashtags.
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

const LANGS = {
  fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand',
  it: 'italien', ar: 'arabe', tr: 'turc', nl: 'néerlandais'
};

const FORMATS = {
  libre: '',
  histoire: "Format « Histoire vraie » : raconte une histoire réelle comme un conteur. Accroche intrigante, montée de tension, puis révélation ou chute marquante.",
  fait: "Format « Fait incroyable » : un fait réel et surprenant. Accroche choc, explication simple, puis une conséquence ou un détail encore plus étonnant.",
  top5: "Format « Top 5 » : un classement du 5e au 1er. Annonce clairement chaque numéro, une ou deux phrases par élément, le n°1 est le plus surprenant.",
  citation: "Format « Citation motivante » : commence par une citation célèbre et son auteur (uniquement si tu es sûr de l'exactitude, sinon formule-la comme une leçon de vie sans l'attribuer), puis explique ce qu'elle enseigne et termine par un appel à passer à l'action.",
  saviezvous: "Format « Le saviez-vous ? » : commence par l'équivalent de « Le saviez-vous ? » dans la langue demandée, puis enchaîne 2 ou 3 faits surprenants liés au sujet."
};

async function askGemini(prompt, json) {
  let lastError = 'Erreur API';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {})
        })
      });
      const data = await r.json();
      if (!r.ok) { lastError = data?.error?.message || 'Erreur API'; continue; }
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!text) { lastError = 'Réponse vide'; continue; }
      if (!json) return text;
      return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    } catch (e) {
      lastError = e.message || 'Serveur injoignable';
    }
  }
  throw new Error(lastError);
}

const clean = (s, n) => String(s || '').slice(0, n);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!invited(req)) return res.status(401).json({ error: 'Accès sur invitation' });
  const b = req.body || {};
  const mode = b.mode || 'script';
  const lang = LANGS[b.lang] || LANGS.fr;
  const format = FORMATS[b.format] ?? '';
  const facts = "N'invente jamais de faits, de dates ou de chiffres : si tu n'es pas sûr d'un détail, reste général.";

  try {
    if (mode === 'ideas') {
      const niche = clean(b.niche, 120).trim();
      if (!niche) return res.status(400).json({ error: 'Niche manquante' });
      const out = await askGemini(`Tu aides un créateur de vidéos courtes (TikTok, Reels, Shorts) sans visage.
Niche : "${niche}". ${format}
Propose 10 sujets de vidéos précis et accrocheurs, qui donnent envie de regarder jusqu'au bout. Chaque sujet tient en une ligne courte.
Écris en ${lang}.
Réponds en JSON : {"ideas":["...", "..."]}`, true);
      const ideas = (Array.isArray(out) ? out : out.ideas || []).filter(x => typeof x === 'string').slice(0, 10);
      return res.status(200).json({ ideas });
    }

    if (mode === 'caption') {
      const script = clean(b.script, 2500).trim();
      if (!script) return res.status(400).json({ error: 'Script manquant' });
      const out = await askGemini(`Voici le script d'une vidéo courte :
"""${script}"""
Écris, en ${lang}, de quoi la publier sur TikTok et Instagram :
- "title" : un titre court et accrocheur (max 60 caractères) ;
- "caption" : une légende de 1 à 3 phrases qui donne envie de regarder, avec 1 ou 2 emojis, et une question pour faire commenter ;
- "hashtags" : 8 à 12 hashtags pertinents (mélange de populaires et de précis), sans espace, commençant par #.
Réponds en JSON : {"title":"...","caption":"...","hashtags":["#..."]}`, true);
      return res.status(200).json({
        title: clean(out.title, 120), caption: clean(out.caption, 800),
        hashtags: (out.hashtags || []).filter(h => typeof h === 'string').map(h => h.startsWith('#') ? h : '#' + h).slice(0, 15)
      });
    }

    // mode "script"
    const topic = clean(b.topic, 300).trim();
    if (!topic) return res.status(400).json({ error: 'Sujet manquant' });
    const d = [20, 35, 60].includes(Number(b.dur)) ? Number(b.dur) : 35;
    const nWords = Math.round(d * 2.6);
    const out = await askGemini(`Écris un script de voix off en ${lang} pour une vidéo verticale (TikTok/Reels/Shorts) sur le sujet : "${topic}".
Ton : ${clean(b.tone, 60) || 'captivant'}. Longueur : environ ${nWords} mots (${d} secondes lues à voix haute).
${format}
Règles : la première phrase est une accroche forte ; phrases courtes et orales ; tutoiement (ou l'équivalent naturel dans la langue) ; finis par une phrase qui pousse à s'abonner ou commenter. ${facts}
Le script ne contient QUE le texte à lire : pas de titre, pas de guillemets, pas d'indications de mise en scène, pas d'emojis, pas de numérotation du type « 1. ».
Donne aussi "hook" : une accroche visuelle très courte (3 à 7 mots) à afficher en gros à l'écran pendant les 2 premières secondes, dans la même langue.
Réponds en JSON : {"hook":"...","script":"..."}`, true);
    const script = clean(out.script, 3000).trim();
    if (!script) throw new Error('Script vide');
    return res.status(200).json({ script, hook: clean(out.hook, 80).trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erreur' });
  }
}
