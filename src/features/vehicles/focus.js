  function focusVehicle(key, stopId, guessEta, followArrival) {
    var v = vehicles[key];
    if (!v) return;
    map.closePopup();
    closeSheet();
    var st = pendingFocusStop = (stopId && stops[stopId]) || null;
    pendingGuessEta = guessEta || null;
    // Follow off first: the follow camera would pull straight back to the vehicle (and select() pans to it)
    if ((st || followArrival) && following) setFollow(false);
    if (selected === v) { focusedStop = pendingFocusStop; focusGuessEta = pendingGuessEta; pendingFocusStop = null; pendingGuessEta = null; drawFocusStop(); drawRouteStops(); if (shapes) drawPath(v); }
    else select(v);
    if (followArrival) { setFollow(true); return; }
    var opened = isPhone() && !!st;
    function openIt() {
      if (opened || selected !== v) return;
      opened = true;
      var mk = (v.pill && v.pillInMap) ? v.pill : v.dot;
      if (!map.hasLayer(mk)) return;
      popupNoFocus = true;
      try { mk.openPopup(); } finally { popupNoFocus = false; }
      if (st) return;   // the route to the stop stays centred; the popup doesn't move the map
      // only nudge the map if the popup would be cut off at the edges
      var pp = mk.getPopup();
      if (pp && pp.isOpen() && pp._adjustPan) { var was = pp.options.autoPan; pp.options.autoPan = true; pp._adjustPan(); pp.options.autoPan = was; }
    }
    function openAfterMove() { map.once('moveend', function () { setTimeout(openIt, 0); }); }
    if (!st) { focusOn(v.pos || [v.d.lat, v.d.lon], null, vpTargetY(undefined, vehPopupSize(v).h), openIt); return; }
    setTimeout(openIt, 1500);
    // Route not loaded yet: show vehicle and stop now, the road between them once it's drawn
    // (select() asked for the route first, so by the time this runs its path is ready)
    var hadShapes = !!shapes;
    if (!hadShapes) { fitRouteToStop(v, st); openAfterMove(); }
    loadShapes().then(function () {
      if (selected !== v) return;
      var b = routeToStopBounds(v, st);
      if (hadShapes || !map.getBounds().contains(b)) { fitRouteToStop(v, st, b); if (!opened) openAfterMove(); }
    });
  }
  // The stretch of the tracked vehicle's route from where it is now to the stop
  function routeToStopBounds(v, st) {
    var pts = [v.pos || [v.d.lat, v.d.lon], [st.lat, st.lon]];
    var along = v === selected ? vehicleAlong(v) : null;
    if (flow && along !== null) {
      var m = flow.m, to = stopAlong(m, st, along - 60);
      var leg = typeof to === 'number' ? null : returnLeg(v);
      if (typeof to === 'number') {
        for (var i = 0; i < m.pts.length; i++) if (m.cum[i] > along && m.cum[i] < to) pts.push(m.pts[i]);
      } else if (leg) {   // it comes back after this run: the rest of the run, then the way back
        for (var j = 0; j < m.pts.length; j++) if (m.cum[j] > along) pts.push(m.pts[j]);
        pts = pts.concat(leg.pts);
      }
    }
    return L.latLngBounds(pts);
  }
  // Centred in the free map area (beside the panel on PC, below it on phones). Every element keeps its
  // own room, not just the route line: the stop with its name tag, the vehicle's label and the popup
  // that opens above it. Picks the closest zoom (max 16) at which all of that fits with a margin, so
  // the popup never has to push the map when it opens.
  function vehPopupSize(v) {
    var w = vpW() + 36, h = 0, el = vehPopupEl(v);
    try {
      patchVeh(el, v);
      if (!el.isConnected) {   // measure the popup content off-screen, at its real width
        var probe = document.createElement('div');
        probe.className = 'leaflet-popup veh-pop';
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;width:' + vpW() + 'px';
        probe.appendChild(el);
        document.body.appendChild(probe);
        h = el.offsetHeight;
        probe.removeChild(el);
        document.body.removeChild(probe);
      } else h = el.offsetHeight;
    } catch (e) {}
    // + card padding, the tip and the gap to the label; the stop rows may still be loading, so never less than a full card;
    // on screen it is --ui times that
    // v100: + the card's margins and edge, the pointer and the gap to the vehicle's spot
    return { w: w * ui, h: (Math.max(h + 44, 230) + 11 + VP_GAP) * ui };
  }
  function fitRouteToStop(v, st, b) {
    if (autoFocusOff) return;
    setLocFollow(false);
    b = b || routeToStopBounds(v, st);
    var pr = document.getElementById('panel').getBoundingClientRect(), size = map.getSize();
    var left = isPhone() ? 0 : Math.max(0, pr.right), top = isPhone() ? Math.max(0, pr.bottom) : 0;
    var mg = Math.round(Math.max(32, 0.06 * Math.min(size.x - left, size.y - top)));
    var x0 = left + mg, y0 = top + mg, x1 = size.x - mg, y1 = size.y - mg;
    var pg = document.getElementById('stopProg');
    if (!pg.hidden) x1 = Math.min(x1, pg.getBoundingClientRect().left - (isPhone() ? 8 : 16));
    // phones: no popup opens over the map (the card lives in the bottom sheet), so no room for one
    var pos = v.pos || [v.d.lat, v.d.lon], pop = isPhone() ? { w: 0, h: 0 } : vehPopupSize(v);
    function boxAt(z) {
      var box = L.bounds(map.project(b.getNorthWest(), z), map.project(b.getSouthEast(), z));
      var sp = map.project([st.lat, st.lon], z), vp = map.project(pos, z);
      box.extend(sp.add([-110 * ui, -64 * ui])); box.extend(sp.add([110 * ui, 24 * ui]));   // stop icon with its name tag above
      box.extend(vp.add([-40 * ui, -24 * ui])); box.extend(vp.add([40 * ui, 24 * ui]));     // the vehicle's label
      box.extend(vp.add([-pop.w / 2, 0])); box.extend(vp.add([pop.w / 2, pop.h]));   // v100: its card below it
      return box;
    }
    var z = 16, box = boxAt(z);
    while (z > 10 && (box.max.x - box.min.x > x1 - x0 || box.max.y - box.min.y > y1 - y0)) box = boxAt(--z);
    // put the middle of everything in the middle of the free area
    var c = box.min.add(box.max).divideBy(2);
    var center = map.unproject(c.subtract(L.point((x0 + x1) / 2, (y0 + y1) / 2)).add(size.divideBy(2)), z);
    map.flyTo(center, z, { duration: flyDur(center, z) });
  }

  // The tracked vehicle is already centred on tap: just bring it back into view
  function recenter(v) {
    var ll = v.pos || [v.d.lat, v.d.lon];
    if (!sheet.hidden) {
      var top = document.getElementById('panel').getBoundingClientRect().bottom;
      focusOn(ll, null, (top + map.getSize().y - sheetHeight()) / 2);
    } else focusOn(ll, null, vpCard ? vpTargetY() : undefined);
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-sp-close]')) {   // closes the stop details only; tracking continues
      e.preventDefault(); e.stopPropagation();
      if (sheetStop) closeSheet(); else map.closePopup();
      return;
    }
    var more = t.closest('[data-sp-more]');
    if (more) {
      e.preventDefault(); e.stopPropagation();
      expandedStop = more.getAttribute('data-sp-more');
      refreshStopViews();
      return;
    }
    // vehicle popup: ✕ hides it (tracking continues), Follow, All stops / Hide stops, pick "your stop"
    var vp = t.closest('[data-vp-close],[data-vp-follow],[data-vp-all],[data-vp-stop]');
    if (vp) {
      e.preventDefault(); e.stopPropagation();
      if (vp.hasAttribute('data-vp-close')) { if (sheetVeh) closeSheet(); else map.closePopup(); }
      else if (vp.hasAttribute('data-vp-follow')) setFollow(!following);
      else if (vp.hasAttribute('data-vp-all')) { if (selected) { selected.allStops = !selected.allStops; refreshVehPopup(selected); vpKeepInView(); } }
      else vpPickStop(vp.getAttribute('data-vp-stop'), +vp.getAttribute('data-vp-eta') || null, vp.getAttribute('data-vp-run'));
      return;
    }
    var a = t.closest('[data-veh]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    var followArrival = a.hasAttribute('data-follow-arrival');
    if (!followArrival && selected && vehicles[a.getAttribute('data-veh')] === selected) { recenter(selected); return; }
    focusVehicle(a.getAttribute('data-veh'), a.getAttribute('data-stop'), a.classList.contains('guess') ? {
      predicted: +a.getAttribute('data-eta') || null,
      g: { sameWay: a.getAttribute('data-same') === '1', stopOnNew: +a.getAttribute('data-onnew') || 0, tripId: a.getAttribute('data-trip') || '' }
    } : null, followArrival);
  }, true);

