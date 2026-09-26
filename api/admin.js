// Tableau Admin : invités (on/off, code, dernière activité) + liste d'attente.
// Réservé aux emails de ADMIN_EMAILS, connectés avec un jeton valide.
import { randomInt } from 'crypto';
import { invited, isAdmin, invitedList, getInvite } from './_auth.js';
import { kv, kvReady } from './_kv.js';
import { notifyDetailed, notifyReady } from './_notify.js';

const EMAIL = /^[^\s@:,;]+@[^\s@:,;]+\.[^\s@:,;]+$/;
const newCode = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let c = ''; for (let i = 0; i < 6; i++) c += a[randomInt(a.length)]; return c; };
const pairs = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };

async function snapshot() {
  const day = new Date().toISOString().slice(0, 10);
  const [inv, seen, wl] = await kv([['HGETALL', 'invites'], ['HGETALL', 'seen'], ['HGETALL', 'waitlist:info']]);
  const invites = pairs(inv), seenAt = pairs(seen);
  const rows = [];
  for (const entry of invitedList()) {
    const email = entry.split(':')[0];
    rows.push({ email, fixed: true, on: true, code: null, admin: isAdmin(email) });
  }
  for (const [email, v] of Object.entries(invites)) {
    let d = {}; try { d = JSON.parse(v); } catch (e) {}
    if (rows.some(r => r.email === email)) continue;
    rows.push({ email, fixed: false, on: !!d.on, code: d.code, added: d.added, admin: isAdmin(email) });
  }
  const used = rows.length ? await kv(rows.map(r => ['GET', `quota:${day}:${r.email}`])) : [];
  rows.forEach((r, i) => { r.seen = Number(seenAt[r.email]) || null; r.today = Number(used[i]) || 0; });
  rows.sort((a, b) => (b.seen || 0) - (a.seen || 0));
  const waitlist = Object.values(pairs(wl)).map(v => { try { return JSON.parse(v); } catch (e) { return null; } })
    .filter(Boolean).sort((a, b) => (a.rank || 0) - (b.rank || 0))
    .map(w => ({ ...w, invited: rows.some(r => r.email === w.email) }));
  return { rows, waitlist, quota: Number(process.env.QUOTA_JOUR) || 60, notify: notifyReady() };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const who = await invited(req);
  if (!who || !isAdmin(who)) return res.status(403).json({ error: 'Réservé à l\'admin' });
  if (!kvReady()) return res.status(500).json({ error: 'Base Upstash non connectée' });

  const b = req.body || {}, action = String(b.action || 'list');
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  try {
    if (action === 'notifyTest') {
      if (!notifyReady()) return res.status(400).json({ error: 'Ajoute d\'abord NTFY_TOPIC dans Vercel (voir les étapes).' });
      const r = await notifyDetailed('🔔 Test ScriptBoom', 'Les notifications marchent ! Tu seras prévenu à chaque nouvel inscrit.', ['bell']);
      if (!r.ok) return res.status(500).json({ error: 'La notification n\'est pas partie : ' + r.detail });
      return res.status(200).json({ ...(await snapshot()), sent: true });
    }
    if (action !== 'list') {
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'Email invalide' });
      if (invitedList().some(x => x.split(':')[0] === email)) return res.status(400).json({ error: 'Cet accès est fixé dans Vercel (EMAILS_AUTORISES) : modifie-le là-bas.' });
      const cur = await getInvite(email);
      if (action === 'add') {
        if (cur) return res.status(400).json({ error: 'Déjà invité' });
        await kv([['HSET', 'invites', email, JSON.stringify({ code: newCode(), on: true, added: Date.now() })]]);
        console.log('ADMIN invite', email);
      } else if (!cur) return res.status(404).json({ error: 'Invité introuvable' });
      else if (action === 'toggle') await kv([['HSET', 'invites', email, JSON.stringify({ ...cur, on: !!b.on })]]);
      else if (action === 'code') await kv([['HSET', 'invites', email, JSON.stringify({ ...cur, code: newCode() })]]);
      else if (action === 'remove') await kv([['HDEL', 'invites', email], ['HDEL', 'seen', email]]);
      else return res.status(400).json({ error: 'Action inconnue' });
    }
    return res.status(200).json(await snapshot());
  } catch (e) { return res.status(500).json({ error: e.message || 'Erreur' }); }
}
