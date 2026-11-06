  // v91: the live feed failed (most often: the phone/computer was asleep or offline for a while). Instead of the
  // old CORS box in the panel, a popup over everything asks for a reload, which starts the app fresh with the
  // latest data. While the device says it's offline the button waits (reloading then would only show the
  // browser's "no internet" page); if a later update gets through on its own, the popup goes away by itself.
  var reloadDlg = document.getElementById('reloadDlg'), reloadBtn = document.getElementById('reloadBtn');
  var RELOAD_MSG = 'The connection to the live feed was lost. Reload to get the latest vehicles and arrivals.';
  var OFFLINE_MSG = 'You\u2019re offline. Once you\u2019re connected again, reload to get the latest vehicles and arrivals.';
  function reloadState() {
    var off = navigator.onLine === false;
    reloadBtn.disabled = off;
    setText(reloadBtn, off ? 'Waiting for connection\u2026' : 'Reload');
    setText(document.getElementById('reloadMsg'), off ? OFFLINE_MSG : RELOAD_MSG);
  }
  function showReload(on) {
    if (on === !reloadDlg.hidden) { if (on) reloadState(); return; }
    reloadDlg.hidden = !on;
    if (!on) return;
    document.getElementById('proxy').value = proxy;
    reloadState();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    // keyboard users land on the button; on touch screens no focus ring is drawn around it
    if (window.matchMedia && matchMedia('(hover: hover)').matches) try { reloadBtn.focus({ preventScroll: true }); } catch (e) {}
  }
  function stripStamp(u) { return u.replace(/([?&])_r=\d+&?/, '$1').replace(/[?&](#|$)/, '$1'); }
  function hardReload() {
    reloadBtn.disabled = true;
    setText(reloadBtn, 'Reloading\u2026');
    // a new address, so no cached copy of the page can be served: the app starts over with the newest version.
    // Only on the website: a file opened from the phone (content://, file://) may not survive an added ?query
    if (!/^https?:$/.test(location.protocol)) { location.reload(); return; }
    var hash = location.hash, u = stripStamp(location.href.replace(/#.*$/, ''));
    location.replace(u + (u.indexOf('?') < 0 ? '?' : '&') + '_r=' + Date.now() + hash);
  }
  reloadBtn.onclick = hardReload;
  window.addEventListener('online', function () { if (!reloadDlg.hidden) reloadState(); update(true); });
  window.addEventListener('offline', function () { if (!reloadDlg.hidden) reloadState(); });
  // the _r= stamp from a reload is taken out of the address bar again (bookmarks and shares stay clean)
  if (/[?&]_r=\d+/.test(location.search) && history.replaceState) {
    try { history.replaceState(history.state, '', stripStamp(location.href)); } catch (e) {}
  }

  document.getElementById('saveProxy').onclick = function () {
    proxy = document.getElementById('proxy').value.trim();
    store('sofia_proxy', proxy);
    hardReload();
  };

