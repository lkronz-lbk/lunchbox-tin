/* The front page's prices come from Stripe, as the app's and the emails' do (GET /api/billing), so a
   price changed in Stripe changes here too. What the page says in its own HTML shows before this
   runs and whenever it cannot. The founding line follows metadata founding = yes on the yearly price. */
(function(){
  function fmt(p){
    if(!p || !isFinite(p.amount)) return '';
    try{ return new Intl.NumberFormat('en-US', {style:'currency', currency:(p.currency || 'usd').toUpperCase(), minimumFractionDigits: p.amount % 100 ? 2 : 0}).format(p.amount / 100); }
    catch(e){ return ''; }
  }
  function each(sel, fn){ Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  fetch('/api/billing').then(function(r){ return r.ok ? r.json() : null; }).then(function(b){
    var pr = b && b.enabled && b.prices, y = pr && fmt(pr.year);
    if(!y) return;
    var m = fmt(pr.month);
    each('[data-price="year"]', function(e){ e.textContent = y; });
    each('[data-price="month"]', function(e){ if(m) e.textContent = m; });
    each('[data-price="month-line"]', function(e){ e.hidden = !m; });
    each('[data-founding]', function(e){ e.hidden = !pr.year.founding; });
    offers(pr);
  }).catch(function(){});
  /* the JSON-LD search engines read carries the same prices: Google reads it after scripts run,
     so it says what the page shows rather than what the HTML was typed with */
  function offers(pr){
    var el = document.querySelector('script[type="application/ld+json"]');
    if(!el) return;
    try{
      var ld = JSON.parse(el.textContent), app = (ld['@graph'] || []).filter(function(x){ return x['@type'] === 'WebApplication'; })[0];
      if(!app || !Array.isArray(app.offers)) return;
      var set = function(name, p){
        var i = app.offers.findIndex(function(o){ return o.name === name; });
        if(!p || !isFinite(p.amount)){ if(i > -1) app.offers.splice(i, 1); return; }
        var o = {'@type':'Offer', name:name, price:(p.amount / 100).toFixed(2), priceCurrency:(p.currency || 'usd').toUpperCase()};
        if(i > -1) app.offers[i] = o; else app.offers.push(o);
      };
      set('Household plan, yearly', pr.year);
      set('Household plan, monthly', pr.month);
      el.textContent = JSON.stringify(ld).replace(/<\//g, '<\\/');
    }catch(e){}
  }
})();
