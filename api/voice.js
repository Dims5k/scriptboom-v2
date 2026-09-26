// Génère la voix off avec l'IA de Google (Gemini TTS, formule gratuite).
// Renvoie un fichier audio WAV.
import { invited } from './_auth.js';
import { useQuota, QUOTA_MSG, friendly } from './_kv.js';
import { LANGS, ACCENTS } from './_langs.js';

const VOICES = ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Puck', 'Charon', 'Fenrir', 'Orus'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Cherche l'audio (base64) n'importe où dans la réponse de Google.
function findAudio(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return null;
  const mime = obj.mime_type || obj.mimeType || '';
  if (typeof obj.data === 'string' && obj.data.length > 1000 &&
      (String(mime).includes('audio') || obj.type === 'audio' || !mime)) {
    return { data: obj.data, mime: String(mime) };
  }
  for (const k of Object.keys(obj)) {
    const found = findAudio(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

// Ajoute un en-tête WAV si Google renvoie de l'audio brut (PCM 16 bits mono).
function toWav(buf, mime) {
  if (buf.slice(0, 4).toString('ascii') === 'RIFF') return buf;
  const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

async function callGoogle(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Erreur ${r.status}`);
  const audio = findAudio(data);
  if (!audio) throw new Error('Pas d\'audio dans la réponse');
  return audio;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who) return res.status(401).json({ error: 'Accès sur invitation' });
  if (!(await useQuota(who)).ok) return res.status(429).json({ error: QUOTA_MSG, quota: true });
  const { text, voice = 'Kore', tone = 'dynamique', lang = 'fr' } = req.body || {};
  const langue = LANGS[lang] || LANGS.fr;
  if (!text || typeof text !== 'string' || text.length > 2500) return res.status(400).json({ error: 'Script manquant ou trop long' });
  const v = VOICES.includes(voice) ? voice : 'Kore';
  const accent = ACCENTS[lang] || 'accent natif';
  const style = `voix off en ${langue} de vidéo TikTok, ${accent}, ton ${String(tone).slice(0, 60)}, rythme vivant et naturel`;

  const attempts = [
    // Nouvelle API Google (Interactions)
    ...['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'].map(model => () => callGoogle(`${BASE}/interactions`, {
      model,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: v }] }
    })),
    // Ancienne API Google (generateContent), en secours
    ...['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'].map(model => () => callGoogle(`${BASE}/models/${model}:generateContent`, {
      contents: [{ parts: [{ text: `Lis ce texte en ${langue}, ${style} :\n\n${text}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } }
    }))
  ];

  let lastError = 'Erreur voix';
  for (const attempt of attempts) {
    try {
      const { data, mime } = await attempt();
      const wav = toWav(Buffer.from(data, 'base64'), mime);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(wav);
    } catch (e) {
      lastError = e.message || lastError;
    }
  }
  return res.status(500).json({ error: friendly(lastError) });
}
