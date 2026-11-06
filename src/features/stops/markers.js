  var BUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18 11H6V6h12v5z"/></svg>';
  function stopIcon(kind, color) {
    var style = color ? ' style="border-color:' + color + ';color:' + color + '"' : '';
    return L.divIcon({ className: 'stop-mk', iconSize: null, html: '<div class="stop-ic ' + (kind || '') + '"' + style + '>' + BUS_SVG + '</div>' });
  }
  function stopMarker(st, kind, color, z) {
    var mk = L.marker([st.lat, st.lon], { icon: stopIcon(kind, color), pane: 'stopPane', zIndexOffset: z || 0, keyboard: false });
    mk._z = z || 0;
    mk._stop = st;
    if (isPhone()) {
      mk.on('click', function () { openSheet(st, mk); });
    } else {
      // the popup keeps one element and only rebuilds it when its content changed (no flicker, no scroll jump)
      var el = mk._spEl = document.createElement('div');
      el.className = 'sp';
      // no Leaflet maxHeight: the popup itself never scrolls, only its card list does (long lists scroll)
      mk.bindPopup(function () {
        el.style.maxHeight = Math.max(220, Math.round(window.innerHeight * 0.55)) + 'px';
        patchStop(el, st);
        return el;
      }, { className: 'stop-pop', offset: [0, -16], closeButton: false, minWidth: 348, maxWidth: 348 });   // 380 px with the margins
      mk.on('popupopen', function () { openStopMk = mk; markSel(mk, true); focusOn(mk.getLatLng(), mk.getPopup()); });
      mk.on('popupclose', function () {
        markSel(mk, false);
        if (openStopMk === mk) { openStopMk = null; expandedStop = null; }
      });
    }
    mk.on('add', function () { if (mk.isPopupOpen() || sheetMarker === mk) markSel(mk, true); });
    return mk;
  }
