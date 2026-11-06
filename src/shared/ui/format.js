  // ---------- Helpers ----------
  function setStatus(level, s) {
    var el = document.getElementById('status');
    if (el.className !== level) el.className = level;
    setText(document.getElementById('statusTxt'), s);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km' : Math.round(m / 10) * 10 + ' m'; }
