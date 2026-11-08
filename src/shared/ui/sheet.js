  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 700px)').matches); }

  // ---------- Bottom sheet (phones) ----------
  var sheet = document.getElementById('sheet'), sheetBody = document.getElementById('sheetBody');
  var sheetStop = null, sheetMarker = null, sheetVeh = null;
  // its height, kept up to date without reading layout (the follow camera needs it every frame)
  var sheetH = 0;
  // (on screen, i.e. after --ui; offsetHeight and ResizeObserver give the size before the zoom)
  function sheetHeight() { return sheet.hidden ? 0 : sheet.getBoundingClientRect().height; }
  if (window.ResizeObserver) new ResizeObserver(function () { sheetH = sheetHeight(); }).observe(sheet);
  window.addEventListener('resize', function () { sheetH = sheetHeight(); });
  function freeBottom() { var y = map.getSize().y; return isPhone() && !sheet.hidden ? y - (sheetH || sheetHeight()) : y; }
  function openSheet(st, mk) {
    if (sheetMarker && sheetMarker !== mk) markSel(sheetMarker, false);
    map.closePopup();
    leaveVehSheet();
    leaveRouteSheet();   // v93
    sheetStop = sheetMarker = null;
    expandedStop = null;
    patchStop(sheetBody, st);
    // Measure at the real sheet width, then hide it before the browser paints.
    sheet.hidden = false;
    var targetY = (freeTop() + map.getSize().y - sheetHeight()) / 2;
    sheet.hidden = true;
    focusOn([st.lat, st.lon], null, targetY, function () {
      sheetStop = st; sheetMarker = mk;
      markSel(mk, true);
      patchStop(sheetBody, st);
      sheet.hidden = false;
    });
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    sheetH = 0;
    if (sheetMarker) markSel(sheetMarker, false);
    sheetStop = sheetMarker = null;
    expandedStop = null;
    leaveVehSheet();
    leaveRouteSheet();   // v93
  }
  // Phones: the vehicle card (the same element as the PC popup) in the bottom sheet. Tracks the vehicle
  // and puts it in the middle of the map area left between the panel and the sheet.
  function openVehSheet(v) {
    map.closePopup();
    if (sheetStop) { if (sheetMarker) markSel(sheetMarker, false); sheetStop = sheetMarker = null; expandedStop = null; }
    if (sheetVeh && sheetVeh !== v) leaveVehSheet();
    leaveRouteSheet();   // v93
    if (selected !== v) select(v);
    var el = vehPopupEl(v);
    patchVeh(el, v);
    if (el.parentNode !== sheetBody) {
      sheetBody.innerHTML = '';
      sheetBody._html = null;
      sheetBody.className = '';
      sheetBody.appendChild(el);
    }
    sheetVeh = v;
    sheet.classList.add('vsheet');
    sheet.hidden = false;
    if (popupNoFocus) return;
    requestAnimationFrame(function () {
      if (sheetVeh !== v) return;
      var top = document.getElementById('panel').getBoundingClientRect().bottom;
      focusOn(v.pos || [v.d.lat, v.d.lon], null, (top + map.getSize().y - sheetHeight()) / 2);
    });
  }
  // the sheet stops showing a vehicle (closed, or a stop takes its place)
  function leaveVehSheet() {
    if (!sheetVeh) return;
    sheetVeh.allStops = false;
    if (sheetVeh.popEl && sheetVeh.popEl.parentNode === sheetBody) sheetBody.removeChild(sheetVeh.popEl);
    sheetVeh = null;
    sheet.classList.remove('vsheet');
    sheetBody.className = 'sp';
  }

  // Re-render the open stop details after a feed update. The DOM is rebuilt only when the content
  // changed, and the card list keeps its scroll position.
  function patchStop(el, st) {
    var html = stopPopupHtml(st);
    if (el._html === html) return false;
    var body = el.querySelector('.sp-body'), top = body ? body.scrollTop : 0;
    el.innerHTML = html;
    el._html = html;
    body = el.querySelector('.sp-body');
    if (body && top) body.scrollTop = top;
    return true;
  }
  function refreshStopViews() {
    var mk = openStopMk;
    if (mk && mk.isPopupOpen() && mk._spEl && patchStop(mk._spEl, mk._stop)) {
      // new size; the content function returns the same, already patched element. Leaflet re-attaches it,
      // which can lose the card list's scroll position, so put it back.
      var body = mk._spEl.querySelector('.sp-body'), top = body ? body.scrollTop : 0;
      mk.getPopup().update();
      if (body && top) body.scrollTop = top;
    }
    if (sheetStop) patchStop(sheetBody, sheetStop);
    var sm = view3d.on && view3d.popStop ? view3d.popStop() : null;   // v101: a stop's card on the 3D map
    if (sm && sm._spEl) patchStop(sm._spEl, sm._stop);
  }

  // vehicle popups on phones: never open underneath the search panel
  function updatePopupPadding() {
    var pb = document.getElementById('panel').getBoundingClientRect().bottom;
    L.Popup.prototype.options.autoPanPaddingTopLeft = isPhone() ? L.point(12, Math.round(pb) + 12) : L.point(12, 12);
  }
  window.addEventListener('resize', updatePopupPadding);
  // a new --ui changes an open popup's size: let Leaflet place it again
  window.addEventListener('resize', function () { if (map._popup && map._popup.isOpen()) map._popup.update(); });

  // The right edge stacks, from the bottom, the zoom buttons, the location button, the Follow button and
  // the progress bar to your stop, 10–12 px apart (phones since v73, every screen since v76's glass
  // design moved Follow to the bottom right on PC too). Placed from where things really are: on narrow
  // screens the map credits wrap onto two lines and push the zoom buttons up, and the panel's height
  // changes (tracking bar, menu). The bar takes what room is left under the panel on phones (140–260 px
  // before --ui), or under the top of the window on PC (140–340 px; the panel is on the left there).
  // Measured on screen (getBoundingClientRect); insets and heights of these zoomed elements are written
  // divided by --ui, since the zoom multiplies them again.
  function layoutRightEdge() {
    var f = document.getElementById('follow'), pg = document.getElementById('stopProg'), phone = isPhone();
    // (the location button sits on top of the zoom buttons since v75: the stack starts above it)
    // The mode toggle sits above the animated compass whenever 3D is available.
    var h = window.innerHeight, zc = box3d.hidden ? locBox : box3d;
    var zTop = zc ? zc.getBoundingClientRect().top : h - 150 * ui;
    var fBottom = h - zTop + 10;
    f.style.bottom = (fBottom / ui).toFixed(1) + 'px';
    var fTop = h - fBottom - f.getBoundingClientRect().height;
    pg.style.bottom = ((h - fTop + 12) / ui).toFixed(1) + 'px';
    var above = phone ? document.getElementById('panel').getBoundingClientRect().bottom : 4;
    pg.style.height = Math.round(Math.max(140, Math.min(phone ? 260 : 340, (fTop - 12 - above - 12) / ui))) + 'px';
    // v76: the city card (bottom left) sits just above the map credits when they would run under it
    var cc = document.getElementById('cityCard'), at = document.querySelector('.leaflet-control-attribution');
    if (cc) {
      cc.style.bottom = '';
      var ab = at && at.getBoundingClientRect();
      if (ab && ab.height && ab.left < cc.getBoundingClientRect().right) cc.style.bottom = ((h - ab.top + 8) / ui).toFixed(1) + 'px';
    }
    fitPanel();   // v79: after the city card has its place
  }
  window.addEventListener('resize', layoutRightEdge);
  if (window.ResizeObserver) {
    var edgeObs = new ResizeObserver(layoutRightEdge);
    edgeObs.observe(document.getElementById('panel'));
    var corner = document.querySelector('.leaflet-bottom.leaflet-right');
    if (corner) edgeObs.observe(corner);
    edgeObs.observe(document.getElementById('cityCard'));
  }
  layoutRightEdge();

