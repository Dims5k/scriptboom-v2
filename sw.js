// ScriptBoom : permet d'installer l'appli sur l'écran d'accueil.
// Aucune mise en cache : l'appli est toujours à jour et les appels à l'IA passent directement.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return; // seules les pages passent ici, jamais l'IA ni les vidéos
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<meta charset="utf-8"><body style="background:#000;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center"><p>Pas de connexion internet.<br>Reconnecte-toi pour utiliser ScriptBoom.</p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
