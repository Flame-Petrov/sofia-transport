  function setOnlyType(t) {
    Object.keys(activeTypes).forEach(function (k) { activeTypes[k] = (String(k) === String(t)); });
    syncTypeButtons();
  }
  function syncTypeButtons() {
    document.querySelectorAll('#types button').forEach(function (b) {
      var on = !!activeTypes[b.getAttribute('data-t')];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.querySelectorAll('#types button').forEach(function (b) {
    b.onclick = function () {
      var t = b.getAttribute('data-t');
      activeTypes[t] = !activeTypes[t];
      syncTypeButtons();
      stopIfFiltered();
      render(false);
    };
  });

  // the ✕ in the search box: shown while there is text, clears it (same as deleting it by hand)
  var qClear = document.getElementById('qClear');
  function syncClear() { qClear.hidden = !q.value; }
  qClear.onclick = function () { q.value = ''; q.dispatchEvent(new Event('input')); q.focus(); };
  q.addEventListener('input', syncClear);

  var debounce;
  q.addEventListener('input', function () {
    clearTimeout(debounce);
    if (!q.value.trim()) { Object.keys(activeTypes).forEach(function (k) { activeTypes[k] = true; }); syncTypeButtons(); }
    debounce = setTimeout(function () { stopIfFiltered(); render(true); }, 250);
  });
