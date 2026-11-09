  // ---------- Camera: move to what was tapped ----------
  // Zooms in to FOCUS_ZOOM only when further out; when already that close or closer, keeps the zoom
  // and just slides the item into view. The item lands a bit below the middle of the free map area
  // (below the panel), leaving room for its popup above it.
  var FOCUS_ZOOM = 16, autoFocusOff = false;
  function freeTop() {
    return isPhone() ? document.getElementById('panel').getBoundingClientRect().bottom : 0;
  }
  var focusRequest = 0;
  function cancelFocusCard() { focusRequest++; }
  function focusOn(ll, popup, targetY, arrived) {
    var request = ++focusRequest;
    if (autoFocusOff || !ll) { if (arrived) arrived(); return; }
    setLocFollow(false);   // the camera goes to what was tapped: stop keeping your location in view
    ll = L.latLng(ll);
    var z = map.getZoom(), tz = Math.max(z, FOCUS_ZOOM), size = map.getSize();
    if (typeof targetY !== 'number') { var top = freeTop(); targetY = top + (size.y - top) * 0.62; }
    if (view3d.on) { view3d.focus(ll, Math.max(viewZoom(), FOCUS_ZOOM), targetY, arrived && function () { if (request === focusRequest) arrived(); }); return; }   // v100: the same spot on the 3D map
    var pt = map.project(ll, tz), center = map.unproject(pt.subtract(L.point(0, targetY - size.y / 2)), tz);
    function fitPopup() {
      // make sure the popup isn't cut off at the edges once the camera has arrived
      if (popup && popup.isOpen && popup.isOpen() && popup._adjustPan) {
        var was = popup.options.autoPan;
        popup.options.autoPan = true; popup._adjustPan(); popup.options.autoPan = was;
      }
    }
    if (arrived) {
      map.stop();
      if (map.getZoom() === tz && map.project(map.getCenter(), tz).distanceTo(map.project(center, tz)) <= 1) {
        arrived();
        return;
      }
      map.once('moveend', function () {
        if (request === focusRequest && map.getZoom() === tz &&
            map.project(map.getCenter(), tz).distanceTo(map.project(center, tz)) <= 2) arrived();
      });
    }
    if (popup) map.once('moveend', function () { setTimeout(fitPopup, 0); });
    if (tz !== z) map.flyTo(center, tz, { duration: flyDur(center, tz) });
    else map.panTo(center, { animate: true, duration: 0.45 });
  }

  var popupNoFocus = false;   // set while a popup is opened by code that has already placed the camera
  function hookSelect(v, marker) {
    marker.off('click', marker._openPopup, marker);
    marker.on('click', function () {
      if (marker.isPopupOpen()) { marker.closePopup(); return; }
      map.closePopup();
      closeSheet();
      if (selected !== v) select(v);
      focusOn(v.pos || marker.getLatLng(), null, vpTargetY(undefined, vehPopupSize(v).h), function () {
        if (selected !== v) return;
        var active = v.pill && v.pillInMap ? v.pill : v.dot;
        if (!map.hasLayer(active)) return;
        popupNoFocus = true;
        try { active.openPopup(); } finally { popupNoFocus = false; }
      });
    });
    marker.on('popupopen', function () {
      if (selected !== v) select(v);
      if (!popupNoFocus) focusOn(marker.getLatLng(), marker.getPopup(), vpCard ? vpTargetY() : undefined);   // v100: card below it
    });
  }
  // A tap on empty map first closes whatever popup/sheet is open; only the next tap stops tracking.
  // (Leaflet closes popups just before 'click' fires, so remember when that happened.)
  var popupClosedAt = 0;
  map.on('popupclose', function () { popupClosedAt = Date.now(); });
  map.on('dragstart', cancelFocusCard);
  map.on('click', function () {
    cancelFocusCard();
    if (savedPlaces && savedPlaces.isPlacing) return;   // this tap puts a flag down (My places)
    if (sheetStop || sheetVeh || sheetRoute) { closeSheet(); return; }
    if (Date.now() - popupClosedAt < 400) return;   // this tap just closed a popup
    if (selected) deselect();
  });
  function stopTracking() {
    if (selected) { selected.dot.closePopup(); if (selected.pill) selected.pill.closePopup(); }
    deselect();
  }
  document.getElementById('stopTrack').onclick = stopTracking;
  // A new search or type filter that leaves out the tracked vehicle stops tracking it
  function stopIfFiltered() {
    if (selected && !matches(selected.d, tokens())) stopTracking();
  }

