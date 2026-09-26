// Notifications sur ton téléphone, gratuites, avec l'appli ntfy (iPhone / Android).
// Dans Vercel → Settings → Environment Variables : NTFY_TOPIC = un nom secret et long (ex. scriptboom-salim-8f3k2q9x).
// Dans l'appli ntfy : « S'abonner à un sujet » avec exactement le même nom.
// Garde seulement ce que ntfy accepte (lettres sans accent, chiffres, - et _), même si la valeur a été collée avec des guillemets, « NTFY_TOPIC= » ou l'adresse complète
export const topicName = () => String(process.env.NTFY_TOPIC || '').normalize('NFKC').trim()
  .replace(/^NTFY_TOPIC\s*[=:]\s*/i, '').replace(/^https?:\/\/[^/]+\//i, '').replace(/[‐-―−]/g, '-')
  .replace(/[^-_A-Za-z0-9]/g, '').slice(0, 64);
const server = () => String(process.env.NTFY_SERVER || 'https://ntfy.sh').trim().replace(/\/+$/, '');
export const notifyReady = () => !!topicName();

// Masque un email : salim.dimah@gmail.com → sa•••••••••@gmail.com (l'email complet reste visible dans ton Admin)
export const maskEmail = e => { const [u, d] = String(e || '').split('@'); return d ? u.slice(0, 2) + '•'.repeat(Math.max(3, u.length - 2)) + '@' + d : '•••'; };

// En-tête HTTP avec accents et emojis (format RFC 2047, compris par ntfy)
const hdr = t => /^[\x20-\x7e]*$/.test(t) ? t : '=?UTF-8?B?' + Buffer.from(t, 'utf8').toString('base64') + '?=';

async function post(url, opts) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { ...opts, signal: ctl.signal }); const txt = r.ok ? '' : (await r.text().catch(() => '')).slice(0, 160); return { ok: r.ok, detail: r.ok ? '' : `ntfy ${r.status} ${txt}` }; }
  catch (e) { return { ok: false, detail: e.name === 'AbortError' ? 'ntfy ne répond pas (délai dépassé)' : (e.message || 'erreur réseau') }; }
  finally { clearTimeout(timer); }
}

// Renvoie { ok, detail } ; une notification ratée ne bloque jamais l'inscription
export async function notifyDetailed(title, message, tags = [], click) {
  const topic = topicName(); if (!topic) return { ok: false, detail: 'NTFY_TOPIC manquant' };
  const link = click || process.env.SITE_URL || 'https://scriptboom.io';
  // 1) envoi JSON
  const a = await post(server(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, tags, click: link, priority: 4 }) });
  if (a.ok) return a;
  // 2) envoi simple sur l'adresse du sujet
  const b = await post(server() + '/' + encodeURIComponent(topic), { method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: hdr(title), Tags: tags.join(','), Priority: '4', Click: link }, body: message });
  if (b.ok) return b;
  console.log('NOTIF ECHEC', a.detail, '|', b.detail);
  return { ok: false, detail: b.detail || a.detail };
}
export async function notify(title, message, tags = [], click) { return (await notifyDetailed(title, message, tags, click)).ok; }
