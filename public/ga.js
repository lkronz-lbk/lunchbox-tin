/* Google Analytics 4 for the marketing site only. The planner at /app/ never loads this
   file, and its own CSP would refuse the tag. Leave GA_ID empty and nothing loads. */
(function(){
  var GA_ID = '';                                   /* the measurement id from GA4, G-XXXXXXXXXX */
  if(!/^G-[A-Z0-9]{6,}$/.test(GA_ID)) return;
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID, {anonymize_ip:true});
  var s = document.createElement('script'); s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
})();
