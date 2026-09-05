/* Lunch Sorted service worker.
   The app is a single HTML file plus icons, so the shell is precached on
   install and served cache-first. Fonts come from Google and are cached at
   runtime, opaque responses included, so a second launch works with no
   network at all. Bump VERSION to ship a new build. */
var VERSION = 'lunchsorted-v2';
var FONTS = 'lunchsorted-fonts-v1';       /* not versioned: a new build must not re-download every font */
var SHELL = [
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
        return Promise.all(keys.filter(function(k){ return k !== VERSION && k !== FONTS; })
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
          if(res.ok){                                   /* a 404 or 5xx must not become the font forever */
            var copy = res.clone();
            caches.open(FONTS).then(function(c){ c.put(req, copy); });
          }
          return res;
        }).catch(function(){ return hit; });
      })
    );
    return;
  }

  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  if(url.pathname.indexOf('/api/') === 0) return;   /* never serve an account from cache */

  /* Navigations: serve the cached app immediately, refresh it in the
     background so the next launch has the newest build. */
  if(req.mode === 'navigate'){
    e.respondWith(
      caches.match('/app/index.html').then(function(hit){
        var net = fetch(req).then(function(res){
          /* only a real, successful HTML response may become the shell —
             never a captive-portal page, a 5xx, or a mis-deploy */
          if(res.ok && res.type === 'basic' && /text\/html/.test(res.headers.get('content-type') || '')){
            var copy = res.clone();
            caches.open(VERSION).then(function(c){ c.put('/app/index.html', copy); });
          }
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
        if(res && res.ok && res.type === 'basic'){
          var copy = res.clone();
          caches.open(VERSION).then(function(c){ c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
