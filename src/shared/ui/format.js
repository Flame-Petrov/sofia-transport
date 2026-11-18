  // ---------- Helpers ----------
  function setStatus(level, s) {
    var el = document.getElementById('status');
    if (el.className !== level) el.className = level;
    setText(document.getElementById('statusTxt'), s);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function fmtM(m) {
    if (m < 1000) return t('{n} m', { n: Math.round(m / 10) * 10 });
    var km = (m / 1000).toFixed(m >= 10000 ? 0 : 1);
    return t('{n} km', { n: LANG === 'bg' ? km.replace('.', ',') : km });   // Bulgarian writes 1,5 км
  }
