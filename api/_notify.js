// Notifications sur ton téléphone, gratuites, avec l'appli ntfy (iPhone / Android).
// Dans Vercel → Settings → Environment Variables : NTFY_TOPIC = un nom secret et long (ex. scriptboom-salim-8f3k2q9x).
// Dans l'appli ntfy : « S'abonner à un sujet » avec exactement le même nom.
export const notifyReady = () => !!process.env.NTFY_TOPIC;

// Masque un email : salim.dimah@gmail.com → sa•••••••••@gmail.com (l'email complet reste visible dans ton Admin)
export const maskEmail = e => { const [u, d] = String(e || '').split('@'); return d ? u.slice(0, 2) + '•'.repeat(Math.max(3, u.length - 2)) + '@' + d : '•••'; };

export async function notify(title, message, tags = [], click) {
  const topic = process.env.NTFY_TOPIC; if (!topic) return false;
  try {
    const r = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, message, tags, click: click || process.env.SITE_URL || 'https://scriptboom.io', priority: 4 }),
      signal: AbortSignal.timeout(3500)
    });
    return r.ok;
  } catch (e) { return false; } // une notification ratée ne bloque jamais l'inscription
}
