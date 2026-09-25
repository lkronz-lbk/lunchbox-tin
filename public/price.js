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
  }).catch(function(){});
})();
