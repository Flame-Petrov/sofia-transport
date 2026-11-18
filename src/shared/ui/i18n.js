  // ---------- Language (Bulgarian / English) ----------
  // The rider picks Български or English in the menu (saved as sofia_lang). Until then the phone's own language
  // decides: Bulgarian when it is Bulgarian, English for every other language. Texts are written in English in
  // the source and looked up in BG (keyed by the English text), so a missing translation shows the English.
  // Each feature keeps its own Bulgarian table in a strings-bg.js next to its code. See docs/language.md.
  var LANG_KEY = 'sofia_lang';
  var BG = {};
  var LANG = (function () {
    var saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (e) {}
    if (saved === 'bg' || saved === 'en') return saved;
    return phoneLang();
  })();
  var LOCALE = LANG === 'bg' ? 'bg-BG' : 'en-GB';
  // The phone's first language: 'bg' for Bulgarian, 'en' for anything else (or when the browser does not say)
  function phoneLang() {
    var nav = typeof navigator !== 'undefined' ? navigator : {};
    var first = (nav.languages && nav.languages[0]) || nav.language || '';
    return /^bg(\b|[-_])/i.test(first) ? 'bg' : 'en';
  }
  // t('Live · {n} vehicles', { n: 12 }) → the text in the chosen language with {name} filled in
  function t(s, vars) {
    var r = (LANG === 'bg' && Object.prototype.hasOwnProperty.call(BG, s)) ? BG[s] : s;
    if (vars) r = r.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
    return r;
  }
  // tp(3, '{n} vehicle', '{n} vehicles') — one / many (Bulgarian has the same two forms)
  function tp(n, one, many, vars) {
    var v = vars || {};
    if (!Object.prototype.hasOwnProperty.call(v, 'n')) v.n = n;
    return t(n === 1 ? one : many, v);
  }
  // Feed names are Bulgarian (Cyrillic). In English they are written in Latin letters with Bulgaria's official
  // transliteration (Streamlined System, 2009 law): "Ж.к. Младост 1" → "Zh.k. Mladost 1", "Ъ" → "A", "Щ" → "Sht".
  var TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a',
    ь: 'y', ю: 'yu', я: 'ya', ѝ: 'i', э: 'e', ы: 'y', ё: 'yo' };
  function translit(s) {
    return String(s || '').replace(/[Ѐ-ӿ]/g, function (c, i, all) {
      var low = c.toLowerCase(), r = TRANSLIT[low];
      if (r === undefined) return c;
      if (c === low) return r;
      // capital: "Ж" → "Zh" before a small letter, "ZH" inside an all-caps word
      var next = all.charAt(i + 1);
      return next && next !== next.toLowerCase() ? r.toUpperCase() : r.charAt(0).toUpperCase() + r.slice(1);
    });
  }
  // A name from the feed in the chosen language: as it is in Bulgarian, transliterated in English
  function feedText(s) { return LANG === 'en' ? translit(s) : s; }

  // Static markup is written in English; this swaps every text node and title / aria-label / placeholder that has
  // a Bulgarian entry. Run once at start (on the whole page) and again on markup added later from templates.
  // An English word with two meanings names its entry with data-i18n: <button data-i18n="Stop tracking">Stop</button>
  // shows "Stop" in English and BG['Stop tracking'] in Bulgarian (BG['Stop'] is a bus stop).
  var I18N_ATTRS = ['title', 'aria-label', 'placeholder'];
  function localizeDom(root) {
    if (LANG !== 'bg' || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), node, list = [];
    while ((node = walker.nextNode())) list.push(node);
    list.forEach(function (n) {
      var raw = n.nodeValue, key = raw.replace(/\s+/g, ' ').trim();
      if (!key || !Object.prototype.hasOwnProperty.call(BG, key)) return;
      var lead = /^\s*/.exec(raw)[0], tail = /\s*$/.exec(raw)[0];
      n.nodeValue = lead + BG[key] + tail;
    });
    var own = root.querySelectorAll ? root.querySelectorAll('[data-i18n]') : [];
    Array.prototype.forEach.call(own, function (el) {
      var k = el.getAttribute('data-i18n');
      if (Object.prototype.hasOwnProperty.call(BG, k)) el.textContent = BG[k];
    });
    var els = root.querySelectorAll ? root.querySelectorAll('[title],[aria-label],[placeholder]') : [];
    Array.prototype.forEach.call(els, function (el) {
      I18N_ATTRS.forEach(function (a) {
        var v = el.getAttribute(a);
        if (v && Object.prototype.hasOwnProperty.call(BG, v)) el.setAttribute(a, BG[v]);
      });
    });
  }
  // The menu's language switch: save the choice and start again in it (every text, name and map label changes)
  function setLang(lang) {
    if (lang !== 'bg' && lang !== 'en') return;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    if (lang !== LANG) location.reload();
  }
