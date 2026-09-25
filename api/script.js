// Textes générés par l'IA (Gemini, formule gratuite) :
// mode "script" (par défaut) : accroche + script ; mode "ideas" : 10 idées ; mode "caption" : titre, légende, hashtags.
import { invited } from './_auth.js';
import { useQuota, QUOTA_MSG, friendly } from './_kv.js';

const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

const LANGS = {
  fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand',
  it: 'italien', ar: 'arabe', tr: 'turc', nl: 'néerlandais'
};

const FORMATS = {
  libre: '',
  histoire: "Format « Histoire vraie » : raconte une histoire réelle comme un conteur. Accroche intrigante, montée de tension, puis révélation ou chute marquante.",
  fait: "Format « Fait incroyable » : un fait réel et surprenant. Accroche choc, explication simple, puis une conséquence ou un détail encore plus étonnant.",
  top5: "Format « Top » : un classement du dernier au 1er. Annonce clairement chaque numéro. Pour chaque élément : l'idée en une phrase, puis POURQUOI c'est vrai ou faux (le mécanisme, une preuve ou un exemple concret). Le n°1 est le plus surprenant.",
  citation: "Format « Citation motivante » : commence par une citation célèbre et son auteur (uniquement si tu es sûr de l'exactitude, sinon formule-la comme une leçon de vie sans l'attribuer), puis explique ce qu'elle enseigne et termine par un appel à passer à l'action.",
  saviezvous: "Format « Le saviez-vous ? » : commence par l'équivalent de « Le saviez-vous ? » dans la langue demandée, puis donne 1 ou 2 faits surprenants liés au sujet, chacun suivi de son explication (pourquoi ou comment ça marche)."
};

async function askGemini(prompt, json, images = []) {
  let lastError = 'Erreur API';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [...images.map(im => ({ inline_data: { mime_type: im.mime, data: im.data } })), { text: prompt }] }],
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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!(await useQuota(who)).ok) return res.status(429).json({ error: QUOTA_MSG, quota: true });
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

    if (mode === 'translate') {
      // Sous-titres dans une autre langue : traduction phrase par phrase (même nombre de phrases)
      const to = LANGS[b.to]; const from = LANGS[b.from] || lang;
      const src = (Array.isArray(b.sentences) ? b.sentences : []).filter(x => typeof x === 'string').slice(0, 80).map(x => clean(x, 500));
      if (!to || !src.length) return res.status(400).json({ error: 'Rien à traduire' });
      const out = await askGemini(`Traduis ces ${src.length} éléments du ${from} vers le ${to}, pour des sous-titres de vidéo TikTok : naturel, court, oral, fidèle au sens, chiffres conservés.
Garde exactement le même nombre d'éléments, dans le même ordre, un élément traduit par élément source (ne fusionne pas, ne découpe pas).
Éléments : ${JSON.stringify(src)}
Réponds en JSON : {"sentences":["..."]}`, true);
      const dst = Array.isArray(out.sentences) ? out.sentences : Array.isArray(out) ? out : [];
      return res.status(200).json({ sentences: src.map((x, i) => typeof dst[i] === 'string' && dst[i].trim() ? clean(dst[i].trim(), 600) : x) });
    }

    if (mode === 'coach') {
      // Analyse des captures de statistiques TikTok / Instagram du créateur
      const images = (Array.isArray(b.images) ? b.images : []).slice(0, 4)
        .filter(im => im && typeof im.data === 'string' && /^image\/(jpeg|png|webp)$/.test(im.mime) && im.data.length < 1500000);
      if (!images.length) return res.status(400).json({ error: 'Ajoute au moins une capture de tes statistiques' });
      const out = await askGemini(`Tu es un coach expert de la croissance sur TikTok, Instagram Reels et YouTube Shorts, pour les vidéos courtes sans visage. Repère d'abord de quelle plateforme viennent les captures, et adapte ton analyse à ses indicateurs (ex. : « Vidéo regardée en entier » sur TikTok, « Taux de rétention » ou « Vues vs swipes » sur YouTube Shorts, « Durée de visionnage moyenne » et « Taux de saut » sur Instagram).
Voici ${images.length} capture(s) des statistiques d'une ou plusieurs vidéos courtes du créateur (vues, temps de visionnage moyen, pourcentage de vidéo regardée en entier, courbe de fidélisation, sources de trafic, abonnés gagnés…).${b.note ? ` Précisions du créateur : "${clean(b.note, 400)}".` : ''}
1. Lis précisément les chiffres visibles. N'invente aucun chiffre : si une donnée n'est pas lisible, ne la cite pas.
2. Diagnostique où et pourquoi les spectateurs décrochent (accroche, longueur, rythme, sujet, visuel, restriction de diffusion…).
3. Donne des règles concrètes et directement applicables à l'écriture des PROCHAINS scripts (accroche, durée, structure, fin).
Écris en français, simple et direct, en tutoyant le créateur.
Réponds en JSON : {"summary":"2 phrases maximum sur ce que disent les chiffres","numbers":["chiffre clé lu sur la capture, avec son sens"],"problems":["problème principal et sa cause"],"rules":["règle courte pour les prochains scripts, à l'impératif"],"duration":20}
"rules" : 3 à 5 règles. "duration" : la durée conseillée pour les prochaines vidéos, 20, 35 ou 60.`, true, images);
      const list = (x, n) => (Array.isArray(x) ? x : []).filter(v => typeof v === 'string' && v.trim()).map(v => clean(v, 220)).slice(0, n);
      return res.status(200).json({ summary: clean(out.summary, 400), numbers: list(out.numbers, 6), problems: list(out.problems, 4),
        rules: list(out.rules, 5), duration: [20, 35, 60].includes(Number(out.duration)) ? Number(out.duration) : null });
    }

    if (mode === 'week') {
      const niche = clean(b.niche, 120).trim();
      if (!niche) return res.status(400).json({ error: 'Niche manquante' });
      const out = await askGemini(`Tu es le stratège d'un créateur TikTok sans visage. Niche : "${niche}".
Prépare son planning de 7 vidéos pour la semaine (1 par jour), en ${lang}. Varie les formats et les angles, et commence par les sujets les plus accrocheurs.
Pour chaque vidéo :
- "topic" : le sujet précis et intrigant, en une ligne (c'est lui qu'on donnera ensuite au générateur de script) ;
- "format" : un parmi "histoire", "fait", "top5", "saviezvous", "citation" ;
- "dur" : 20 ou 35 (60 seulement pour une histoire riche) ;
- "tone" : un parmi "mystérieux et captivant", "énergique et fun", "pédagogique et clair", "motivant et intense" ;
- "voice" : une voix parmi Kore (femme assurée), Aoede (femme légère), Leda (femme jeune), Sulafat (femme chaleureuse), Puck (homme dynamique), Charon (homme posé), Fenrir (homme énergique), Orus (homme grave), adaptée au sujet ;
- "why" : en français, une phrase courte qui dit pourquoi ce sujet va accrocher.
Réponds en JSON : {"week":[{"topic":"...","format":"...","dur":20,"tone":"...","voice":"...","why":"..."}]}`, true);
      const F = ['histoire', 'fait', 'top5', 'saviezvous', 'citation'], T = ['mystérieux et captivant', 'énergique et fun', 'pédagogique et clair', 'motivant et intense'];
      const V = ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Puck', 'Charon', 'Fenrir', 'Orus'];
      const week = (Array.isArray(out) ? out : out.week || []).filter(x => x && typeof x.topic === 'string').slice(0, 7).map(x => ({
        topic: clean(x.topic, 200), format: F.includes(x.format) ? x.format : 'fait', dur: [20, 35, 60].includes(Number(x.dur)) ? Number(x.dur) : 20,
        tone: T.includes(x.tone) ? x.tone : T[0], voice: V.includes(x.voice) ? x.voice : 'Kore', why: clean(x.why, 160)
      }));
      if (!week.length) throw new Error('Planning vide');
      return res.status(200).json({ week });
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
    const reply = b.reply && typeof b.reply.text === 'string' && b.reply.text.trim()
      ? { user: clean(b.reply.user, 40).replace(/^@/, '').trim(), text: clean(b.reply.text, 400).trim() } : null;
    const topic = reply ? reply.text : clean(b.topic, 300).trim();
    if (!topic) return res.status(400).json({ error: 'Sujet manquant' });
    const coach = (Array.isArray(b.coach) ? b.coach : []).filter(x => typeof x === 'string').map(x => clean(x, 220)).slice(0, 5);
    const coachTxt = coach.length ? `\nConseils tirés des vraies statistiques du créateur (à respecter en priorité) :\n- ${coach.join('\n- ')}` : '';
    const replyTxt = reply ? `\nC'est une VIDÉO DE RÉPONSE à ce commentaire laissé par ${reply.user ? '@' + reply.user : 'un abonné'} : "${reply.text}".
La bulle du commentaire sera affichée à l'écran. La première phrase réagit directement au commentaire (sans le relire en entier), puis tu réponds vraiment à la question ou à la remarque avec des explications, et tu finis en invitant les gens à poser leurs questions en commentaire.` : '';
    const d = [20, 35, 60].includes(Number(b.dur)) ? Number(b.dur) : 35;
    const nWords = Math.round(d * 2.6);
    const series = !!b.series && !reply;
    // Moins d'éléments quand la vidéo est courte, pour avoir le temps d'expliquer chacun
    const nTop = d <= 35 ? 3 : 5;
    const top = b.format === 'top5'
      ? (series ? ` Fais un Top ${nTop * 2 > 6 ? 6 : nTop * 2} réparti sur les 2 parties : la partie 1 va du dernier au milieu, la partie 2 finit par le n°1.`
                : ` Fais un Top ${nTop} (pas plus), annoncé comme « Top ${nTop} » ou l'équivalent dans la langue.`) : '';
    const depth = `Profondeur : le spectateur doit APPRENDRE quelque chose. Chaque affirmation est immédiatement suivie de son explication : le pourquoi ou le comment, avec un mécanisme simple, un exemple concret ou un ordre de grandeur connu. Interdit : aligner des affirmations sans les expliquer. Mieux vaut moins d'idées bien expliquées que beaucoup d'idées survolées.`;
    const hookRules = `Accroche (le plus important : la moitié des gens partent après 1 seconde) : la toute première phrase fait 8 mots maximum et balance directement l'info la plus choquante, une promesse forte ou une question qui pique la curiosité. Jamais d'introduction du type « Aujourd'hui on va parler de », « Si tu venais de », « Tu t'es déjà demandé ». Exemples de bon style : « Ton cerveau te ment chaque matin. », « Cette poudre blanche change tes muscles. ».
Rétention : juste après l'accroche, annonce ce que le spectateur va gagner s'il reste jusqu'au bout, et garde la révélation la plus forte pour la fin.`;
    const style = `Règles : phrases courtes et orales ; tutoiement (ou l'équivalent naturel dans la langue). ${facts}
Chaque script ne contient QUE le texte à lire : pas de titre, pas de guillemets, pas d'indications de mise en scène, pas d'emojis, pas de numérotation du type « 1. ».
"keywords" : 3 à 6 mots importants du script (chiffres, noms, mots forts), écrits exactement comme dans le script, un seul mot par élément ; ils seront colorés dans les sous-titres.
"hook" : une accroche visuelle choc et très courte (3 à 6 mots, pas une simple reformulation du sujet ; elle crée un manque ou une surprise) à afficher en gros à l'écran pendant les 2 premières secondes, dans la même langue.`;

    let parts;
    if (series) {
      const out = await askGemini(`Écris une SÉRIE de 2 vidéos verticales (TikTok/Reels/Shorts) en ${lang} sur le sujet : "${topic}".${coachTxt} Chaque partie est une voix off d'environ ${nWords} mots (${d} secondes).
Ton : ${clean(b.tone, 60) || 'captivant'}.
${format}${top}
${depth}
${hookRules}
Partie 1 : pose le mystère et donne de vraies infos, mais garde la réponse ou la révélation la plus forte pour la partie 2. Elle se termine OBLIGATOIREMENT par un suspense puis une phrase du type « La suite dans la partie 2, abonne-toi pour ne pas la rater. »
Partie 2 : commence par « Partie 2 » (ou l'équivalent dans la langue) et un rappel d'une phrase, puis livre la révélation promise, et finit par une question qui pousse à commenter.
${style}
Réponds en JSON : {"part1":{"hook":"...","script":"...","keywords":["..."]},"part2":{"hook":"...","script":"...","keywords":["..."]}}`, true);
      parts = [out.part1 || {}, out.part2 || {}];
    } else {
      const out = await askGemini(`Écris un script de voix off en ${lang} pour une vidéo verticale (TikTok/Reels/Shorts) sur le sujet : "${topic}".${replyTxt}${coachTxt}
Ton : ${clean(b.tone, 60) || 'captivant'}. Longueur : environ ${nWords} mots (${d} secondes lues à voix haute).
${format}${top}
${depth}
${hookRules}
Finis par une phrase qui pousse à s'abonner ou commenter.
${style}
Réponds en JSON : {"hook":"...","script":"...","keywords":["..."]}`, true);
      parts = [out];
    }
    parts = parts.map(p => ({ script: clean(p.script, 3000).trim(), hook: clean(p.hook, 80).trim(),
      keywords: (Array.isArray(p.keywords) ? p.keywords : []).filter(k => typeof k === 'string' && k.trim()).map(k => clean(k.trim(), 30)).slice(0, 8) }));
    if (!parts[0].script || (series && !parts[1].script)) throw new Error('Script vide');

    // Vérification des faits : une 2e lecture corrige les chiffres, dates et affirmations douteuses
    let fixes = [];
    if (b.check !== false) {
      try {
        const chk = await askGemini(`Tu es vérificateur de faits pour des vidéos de vulgarisation. Voici ${parts.length > 1 ? 'les scripts' : 'le script'} (en ${lang}) :
${parts.map((p, k) => `--- SCRIPT ${k + 1} ---\n${p.script}`).join('\n')}
Relis chaque affirmation. Si un chiffre, une date, un nom ou une affirmation est faux, exagéré ou incertain, corrige-le ou reformule-le de façon plus générale et prudente. Ne touche à rien d'autre : garde le style, l'accroche, le ton, la longueur et la fin. Si tout est correct, renvoie les scripts à l'identique.
Réponds en JSON : {"scripts":["script 1 corrigé"${parts.length > 1 ? ', "script 2 corrigé"' : ''}],"fixes":["courte description de chaque correction, en français (vide si aucune)"]}`, true);
        const fixed = Array.isArray(chk.scripts) ? chk.scripts : [];
        parts.forEach((p, k) => {
          const f = clean(fixed[k], 3000).trim();
          // On n'accepte la correction que si elle garde à peu près la même longueur
          if (f && f.length > p.script.length * 0.7 && f.length < p.script.length * 1.3) p.script = f;
        });
        fixes = (chk.fixes || []).filter(x => typeof x === 'string' && x.trim()).map(x => clean(x, 200)).slice(0, 6);
      } catch (e) { /* si la vérification échoue, on garde le script tel quel */ }
    }
    return res.status(200).json({ ...parts[0], part2: series ? parts[1] : null, fixes });
  } catch (e) {
    return res.status(500).json({ error: friendly(e.message || 'Erreur') });
  }
}
