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
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data?.error?.message || 'Erreur API' });
    const script = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return res.status(200).json({ script });
  } catch (e) {
    return res.status(500).json({ error: 'Serveur injoignable' });
  }
}
