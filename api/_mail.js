// Emails automatiques envoyés depuis ta boîte Gmail (gratuit, jusqu'à ~500 emails par jour).
// Dans Vercel → Settings → Environment Variables :
//   GMAIL_USER         = support.scriptboom@gmail.com
//   GMAIL_APP_PASSWORD = le « mot de passe d'application » Gmail (16 lettres, voir les étapes)
//   SITE_URL           = https://scriptboom.io (facultatif)
// Aucun module à installer : petit client SMTP intégré (connexion chiffrée TLS, port 465).
import tls from 'tls';

const USER = () => String(process.env.GMAIL_USER || '').trim();
const PASS = () => String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
export const mailReady = () => !!(USER() && PASS());
export const siteUrl = () => String(process.env.SITE_URL || 'https://scriptboom.io').trim().replace(/\/+$/, '');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n');
const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function smtp(host, port, steps, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: process.env.SMTP_INSECURE !== '1' });
    let buf = '', i = -1, done = false;
    const finish = err => { if (done) return; done = true; clearTimeout(timer); try { sock.end(); } catch (e) {} err ? reject(err) : resolve(); };
    const timer = setTimeout(() => finish(new Error('Gmail ne répond pas (délai dépassé)')), timeoutMs);
    const next = () => {
      i++;
      if (i >= steps.length) return finish();
      if (steps[i].send != null) sock.write(steps[i].send + '\r\n');
    };
    sock.on('data', d => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n'); buf = lines.pop();
      for (const line of lines) {
        if (!/^\d{3} /.test(line)) continue; // réponse sur plusieurs lignes : on attend la dernière
        const code = +line.slice(0, 3), want = i < 0 ? 220 : steps[i].expect;
        if (code !== want) {
          const hint = code === 535 ? 'identifiants Gmail refusés (vérifie GMAIL_USER et le mot de passe d\'application)' : line.slice(0, 160);
          return finish(new Error(hint));
        }
        next();
      }
    });
    sock.on('error', e => finish(e));
    sock.on('close', () => { if (!done) finish(i >= steps.length - 1 ? null : new Error('connexion Gmail coupée')); });
  });
}

// Envoie un email (texte + HTML). Renvoie { ok, detail } ; ne lève jamais d'erreur.
export async function sendMail({ to, subject, text, html }, timeoutMs = 9000) {
  if (!mailReady()) return { ok: false, detail: 'GMAIL_USER ou GMAIL_APP_PASSWORD manquant' };
  const from = USER(), rcpt = String(to || '').trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(rcpt)) return { ok: false, detail: 'email destinataire invalide' };
  const bnd = 'sb' + Math.random().toString(36).slice(2);
  const msg = [
    `From: ${encWord('ScriptBoom')} <${from}>`, `To: <${rcpt}>`, `Reply-To: <${from}>`,
    `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@scriptboom>`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${bnd}"`, '',
    `--${bnd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(text)),
    `--${bnd}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(html)),
    `--${bnd}--`, ''
  ].join('\r\n').replace(/\r\n\./g, '\r\n..'); // « dot-stuffing » SMTP
  try {
    await smtp(process.env.SMTP_HOST || 'smtp.gmail.com', Number(process.env.SMTP_PORT) || 465, [
      { send: 'EHLO scriptboom', expect: 250 },
      { send: 'AUTH LOGIN', expect: 334 },
      { send: b64(from), expect: 334 },
      { send: b64(PASS()), expect: 235 },
      { send: `MAIL FROM:<${from}>`, expect: 250 },
      { send: `RCPT TO:<${rcpt}>`, expect: 250 },
      { send: 'DATA', expect: 354 },
      { send: msg + '\r\n.', expect: 250 },
      { send: 'QUIT', expect: 221 }
    ], timeoutMs);
    return { ok: true, detail: '' };
  } catch (e) {
    console.log('EMAIL ECHEC', rcpt, e.message);
    return { ok: false, detail: e.message || 'erreur' };
  }
}

// ---------- Mise en page commune (sobre, noir et vert, comme l'appli) ----------
function layout(title, bodyHtml) {
  const site = siteUrl();
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#050505;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0e0e0e;border:1px solid #232323;border-radius:22px;">
<tr><td style="padding:28px 26px 8px;font-family:Arial,Helvetica,sans-serif;">
<div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.5px;">Script<span style="color:#1ed760;">Boom</span></div>
<div style="font-size:14px;color:#9a9a9a;margin-top:4px;">Un sujet. Une vidéo. <b style="color:#1ed760;">BOOM.</b></div>
</td></tr>
<tr><td style="padding:14px 26px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#e8e8e8;">${bodyHtml}</td></tr>
<tr><td style="padding:18px 26px 24px;border-top:1px solid #1e1e1e;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#8a8a8a;">
Suis-nous sur TikTok : <a href="https://www.tiktok.com/@scriptboom" style="color:#1ed760;">@scriptboom</a><br>
Une question ? Réponds simplement à cet email.<br>
<a href="${site}/confidentialite" style="color:#8a8a8a;">Confidentialité · se désinscrire</a>
</td></tr></table></td></tr></table></body></html>`;
}
const li = t => `<tr><td style="padding:5px 10px 5px 0;color:#1ed760;font-weight:800;vertical-align:top;">✓</td><td style="padding:5px 0;color:#e8e8e8;">${t}</td></tr>`;

// Email 1 : confirmation d'inscription à la liste d'attente
export function waitlistMail(rank) {
  const club = rank <= 500;
  const subject = club ? `Bienvenue dans le Club des 500 🎟️ Place n° ${rank}` : 'Tu es sur la liste d\'attente de ScriptBoom';
  const items = [
    'Aucun paiement avant le lancement.',
    'Lancement : la date n\'est pas encore fixée.',
    'Tu recevras la date en avant-première, par email.',
    'Ton code d\'accès arrivera ici, sur cet email, dès que ton tour vient.',
    ...(club ? ['Membre des 500 : accès exclusifs et d\'autres surprises à venir.'] : [])
  ];
  const html = layout(subject, `
<div style="font-size:40px;line-height:1;margin:6px 0 10px;">🎟️</div>
<div style="font-size:22px;font-weight:800;color:#ffffff;margin:0 0 6px;">${club ? 'Bienvenue dans le Club des 500 !' : 'C\'est noté, tu es sur la liste !'}</div>
${club ? `<div style="display:inline-block;background:#1ed760;color:#000;font-weight:800;border-radius:999px;padding:6px 14px;margin:4px 0 14px;">Place n° ${rank}</div>` : ''}
<p style="margin:0 0 12px;">Merci de ton inscription. ScriptBoom est encore en construction : on le peaufine avec un petit groupe de testeurs avant de l'ouvrir.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px;">${items.map(li).join('')}</table>
<p style="margin:0;color:#bdbdbd;">Pour être sûr de ne rien rater, ajoute cette adresse à tes contacts. À très vite !</p>`);
  const text = `${club ? `Bienvenue dans le Club des 500 ! Place n° ${rank}` : 'C\'est noté, tu es sur la liste d\'attente de ScriptBoom !'}

Merci de ton inscription. ScriptBoom est encore en construction : on le peaufine avec un petit groupe de testeurs avant de l'ouvrir.

${items.map(t => '✓ ' + t).join('\n')}

Suis-nous sur TikTok : @scriptboom
Se désinscrire : ${siteUrl()}/confidentialite`;
  return { subject, text, html };
}

// Email 2 : ton accès (email + code), envoyé quand tu invites quelqu'un depuis l'Admin
export function inviteMail(email, code) {
  const site = siteUrl(), subject = 'Ton accès à ScriptBoom est prêt 🎬';
  const html = layout(subject, `
<div style="font-size:40px;line-height:1;margin:6px 0 10px;">🎬</div>
<div style="font-size:22px;font-weight:800;color:#ffffff;margin:0 0 10px;">C'est ton tour : ton accès est prêt !</div>
<p style="margin:0 0 16px;">Tu fais partie des premiers à tester ScriptBoom. Voici de quoi entrer :</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;border:1px solid #2a2a2a;border-radius:16px;margin:0 0 18px;">
<tr><td style="padding:14px 16px 4px;font-size:13px;color:#9a9a9a;">Email</td></tr>
<tr><td style="padding:0 16px 10px;font-size:17px;font-weight:700;color:#ffffff;">${esc(email)}</td></tr>
<tr><td style="padding:4px 16px 4px;font-size:13px;color:#9a9a9a;">Code d'accès</td></tr>
<tr><td style="padding:0 16px 16px;font-size:28px;font-weight:800;letter-spacing:4px;color:#1ed760;font-family:'Courier New',monospace;">${esc(code)}</td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td style="background:#1ed760;border-radius:999px;">
<a href="${site}" style="display:inline-block;padding:14px 26px;font-weight:800;font-size:16px;color:#000000;text-decoration:none;">Ouvrir ScriptBoom →</a></td></tr></table>
<p style="margin:0 0 8px;color:#bdbdbd;">Sur la page d'accueil, touche « Déjà invité ? », entre ton email et ce code. Garde-le pour toi : il est personnel.</p>
<p style="margin:0;color:#bdbdbd;">Astuce : sur iPhone, ajoute ScriptBoom à ton écran d'accueil (Partager → « Sur l'écran d'accueil ») pour l'ouvrir comme une appli.</p>`);
  const text = `C'est ton tour : ton accès à ScriptBoom est prêt !

Ouvre ${site}
Touche « Déjà invité ? » puis entre :
Email : ${email}
Code d'accès : ${code}

Garde ce code pour toi, il est personnel.`;
  return { subject, text, html };
}
