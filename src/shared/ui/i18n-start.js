  // Every Bulgarian table is loaded: translate the page's static markup and tell the browser the page's language
  document.documentElement.lang = LANG;
  localizeDom(document.body);
  document.title = t(document.title);
