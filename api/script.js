const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { topic, dur = 35, tone = 'captivant' } = req.body || {};
  if (!topic || typeof topic !== 'string' || topic.length > 300) return res.status(400).json({ error: 'Sujet manquant ou trop long' });
  const d = [20, 35, 60].includes(Number(dur)) ? Number(dur) : 35;
  const nWords = Math.round(d * 2.6);
  const prompt = `Écris un script de voix off en français pour une vidéo verticale (TikTok/Reels/Shorts) sur le sujet : "${topic}".
Ton : ${String(tone).slice(0, 60)}. Longueur : environ ${nWords} mots (${d} secondes lues à voix haute).
Règles : commence par une accroche forte dès la première phrase ; phrases courtes et orales ; tutoiement ; finis par une phrase qui pousse à s'abonner ou commenter.
Réponds UNIQUEMENT avec le texte à lire, sans titre, sans guillemets, sans indications de mise en scène, sans emojis.`;
  let lastError = 'Erreur API';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await r.json();
      if (!r.ok) { lastError = data?.error?.message || 'Erreur API'; continue; }
      const script = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (script) return res.status(200).json({ script });
    } catch (e) {
      lastError = 'Serveur injoignable';
    }
  }
  return res.status(500).json({ error: lastError });
}
