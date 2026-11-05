// Network first, so updates arrive straight away; the cached copy keeps Folio working offline.
var CACHE = 'folio-v3';
var SHELL = [
  './', 'index.html', 'styles.css', 'store.js', 'ink.js', 'ui.js', 'docs.js', 'sync.js', 'editor.js', 'library.js', 'app.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('folio-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Android's Share menu posts files here. They wait in a cache until the app collects them.
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'POST' || url.origin !== location.origin || url.pathname.indexOf('/share-target') < 0) return;
  e.respondWith(e.request.formData().then(function (form) {
    return caches.open('folio-incoming').then(function (cache) {
      var jobs = [], text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n');
      form.getAll('files').forEach(function (file, i) {
        if (!file || !file.size) return;
        jobs.push(cache.put('/incoming/' + Date.now() + '-' + i, new Response(file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name || 'Shared file') }
        })));
      });
      if (text && !jobs.length) {
        jobs.push(cache.put('/incoming/' + Date.now() + '-text', new Response(text, {
          headers: { 'Content-Type': 'text/plain', 'x-file-name': encodeURIComponent('Shared text.txt') }
        })));
      }
      return Promise.all(jobs);
    });
  }).then(function () {
    return Response.redirect(new URL('./#/incoming', self.registration.scope).href, 303);
  }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      return hit || caches.match('index.html');
    });
  }));
});
