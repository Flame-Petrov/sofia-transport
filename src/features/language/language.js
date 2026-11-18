  // ---------- Language switch (release 109) ----------
  // The menu's Български / English choice. The language itself, the texts and the phone default are in
  // shared/ui/i18n.js; picking the other language saves it and starts the page again in it.
  (function () {
    var seg = document.getElementById('langSeg');
    if (!seg) return;
    seg.querySelectorAll('button').forEach(function (b) {
      var on = b.dataset.lang === LANG;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-lang]');
      if (b) setLang(b.dataset.lang);
    });
    seg.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setLang(LANG === 'bg' ? 'en' : 'bg');
    });
  })();
