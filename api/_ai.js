// Appels à l'IA (Google Gemini) partagés par toutes les routes :
//  - délai maximal par appel (plus jamais de bouton figé),
//  - relance automatique quand Google est saturé (429 / 500 / 503), avec un délai croissant,
//  - bascule sur un modèle plus léger si le premier ne répond pas,
//  - erreurs renvoyées avec un code stable (AI_BUSY, AI_TIMEOUT, AI_BAD) et un message en français, jamais le texte brut de Google.

export const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
// Modèles légers d'abord : pour les tâches simples (idées, scènes, légendes, traductions), plus rapides et moins saturés
export const LIGHT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class AiError extends Error {
  constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}
export const MSG = {
  AI_BUSY: "L'IA est très demandée en ce moment. Réessaie dans une minute : ta demande n'a pas été décomptée.",
  AI_TIMEOUT: "L'IA a mis trop de temps à répondre. Réessaie : ta demande n'a pas été décomptée.",
  AI_BAD: "L'IA a renvoyé une réponse illisible. Réessaie : ta demande n'a pas été décomptée.",
  AI_KEY: "Le service IA n'est pas configuré (clé manquante). Préviens le support."
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const busyStatus = s => s === 429 || s === 500 || s === 502 || s === 503 || s === 504;

// Un appel HTTP à Google avec délai maximal
export async function googleFetch(path, body, timeoutMs = 25000) {
  if (!process.env.GEMINI_API_KEY) throw new AiError('AI_KEY', MSG.AI_KEY, 500);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const raw = data?.error?.message || `HTTP ${r.status}`;
      console.log('IA ERREUR', path.split('/').pop(), r.status, raw.slice(0, 160));
      if (busyStatus(r.status) || /high demand|overloaded|RESOURCE_EXHAUSTED|quota|rate.?limit|unavailable/i.test(raw))
        throw new AiError('AI_BUSY', MSG.AI_BUSY);
      throw new AiError('AI_BAD', MSG.AI_BAD, 502);
    }
    if (!data) throw new AiError('AI_BAD', MSG.AI_BAD, 502);
    return data;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e.name === 'AbortError') { console.log('IA DELAI', path.split('/').pop()); throw new AiError('AI_TIMEOUT', MSG.AI_TIMEOUT, 504); }
    console.log('IA RESEAU', e.message);
    throw new AiError('AI_BUSY', MSG.AI_BUSY);
  } finally { clearTimeout(timer); }
}

// Essaie une liste de tentatives : chacune est relancée 2 fois si Google est saturé (≈ 1 s puis 3 s),
// puis on passe à la suivante. Budget total limité pour rester sous le délai des fonctions Vercel.
export async function withRetry(attempts, { budgetMs = 50000, retries = 2 } = {}) {
  const t0 = Date.now(); let last = new AiError('AI_BUSY', MSG.AI_BUSY);
  for (const attempt of attempts) {
    for (let k = 0; k <= retries; k++) {
      if (Date.now() - t0 > budgetMs) throw last;
      try { return await attempt(); }
      catch (e) {
        last = e instanceof AiError ? e : new AiError('AI_BAD', MSG.AI_BAD, 502);
        if (last.code === 'AI_KEY') throw last;
        if (last.code !== 'AI_BUSY' || k === retries) break; // réponse illisible ou délai : on change de modèle tout de suite
        await sleep((k ? 3000 : 1000) + Math.random() * 400);
      }
    }
  }
  throw last;
}

const parseJson = t => JSON.parse(String(t).replace(/^\s*```(json)?/i, '').replace(/```\s*$/, '').trim());

// Génère du texte (ou du JSON) avec Gemini
export async function askGemini(prompt, { json = false, images = [], parts = null, models = MODELS, temperature, timeoutMs = 25000, budgetMs, validate } = {}) {
  const content = parts || [...images.map(im => ({ inline_data: { mime_type: im.mime, data: im.data } })), { text: prompt }];
  const cfg = {}; if (json) cfg.responseMimeType = 'application/json'; if (temperature != null) cfg.temperature = temperature;
  return withRetry(models.map(model => async () => {
    const data = await googleFetch(`/models/${model}:generateContent`, { contents: [{ parts: content }], ...(Object.keys(cfg).length ? { generationConfig: cfg } : {}) }, timeoutMs);
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) throw new AiError('AI_BAD', MSG.AI_BAD, 502);
    if (!json) return text;
    let out; try { out = parseJson(text); } catch (e) { throw new AiError('AI_BAD', MSG.AI_BAD, 502); }
    if (validate && !validate(out)) throw new AiError('AI_BAD', MSG.AI_BAD, 502);
    return out;
  }), { budgetMs });
}

// Réponse d'erreur propre pour le navigateur
export function sendAiError(res, e) {
  const err = e instanceof AiError ? e : new AiError('AI_BAD', MSG.AI_BAD, 502);
  if (err.code === 'AI_BUSY') res.setHeader('Retry-After', '20');
  return res.status(err.status).json({ error: err.message, code: err.code });
}

// Date du jour, donnée à l'IA pour qu'elle ne présente pas de faits périmés comme actuels
export const today = () => new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });
