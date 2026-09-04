/* Five Boxes service worker.
   The app is a single HTML file plus icons, so the shell is precached on
   install and served cache-first. Fonts come from Google and are cached at
   runtime, opaque responses included, so a second launch works with no
   network at all. Bump VERSION to ship a new build. */
var VERSION = 'fiveboxes-v3';
var SHELL = [
  '/app/',
  '/app/index.html',
  '/app/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];
var FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(VERSION)
      .then(function(c){ return c.addAll(SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== VERSION; })
                              .map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;

  var isFont = FONT_HOSTS.some(function(h){ return req.url.indexOf(h) === 0; });
  if(isFont){
    e.respondWith(
      caches.match(req).then(function(hit){
        return hit || fetch(req).then(function(res){
          var copy = res.clone();
          caches.open(VERSION).then(function(c){ c.put(req, copy); });
          return res;
        }).catch(function(){ return hit; });
      })
    );
    return;
  }

  if(new URL(req.url).origin !== self.location.origin) return;

  /* Navigations: serve the cached app immediately, refresh it in the
     background so the next launch has the newest build. */
  if(req.mode === 'navigate'){
    e.respondWith(
      caches.match('/app/index.html').then(function(hit){
        var net = fetch(req).then(function(res){
          var copy = res.clone();
          caches.open(VERSION).then(function(c){ c.put('/app/index.html', copy); });
          return res;
        }).catch(function(){ return hit; });
        return hit || net;
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        if(res && res.status === 200){
          var copy = res.clone();
          caches.open(VERSION).then(function(c){ c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
