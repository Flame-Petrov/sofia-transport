  // ---------- "Your stop": the stop a vehicle was picked from stays marked ----------
  var focusedStop = null, pendingFocusStop = null, focusMarker = null, focusGuessEta = null, pendingGuessEta = null;
  var focusLayer = L.layerGroup().addTo(map);
  function drawFocusStop() {
    focusLayer.clearLayers();
    focusMarker = null;
    if (!focusedStop) { if (view3d.on) renderStops(); return; }
    if (stopMarkers[focusedStop.id]) { stopLayer.removeLayer(stopMarkers[focusedStop.id]); delete stopMarkers[focusedStop.id]; }
    if (routeStopMarkers[focusedStop.id]) { routeStopLayer.removeLayer(routeStopMarkers[focusedStop.id]); delete routeStopMarkers[focusedStop.id]; }
    focusMarker = stopMarker(focusedStop, 'focus', null, 1000);
    focusMarker.bindTooltip(esc(focusedStop.name || 'Your stop'), {
      permanent: true, direction: 'top', offset: [0, -20], className: 'focus-label'
    });
    focusLayer.addLayer(focusMarker);
    raise(focusMarker, true);
    if (view3d.on) renderStops();
  }
  function clearRouteStops() {
    routeStopLayer.clearLayers();
    routeStopMarkers = {};
    routeStops = [];
    renderStops();
  }

  // Normally: all stops from zoom 16 (STOP_ZOOM). While a line is searched: only that line's stops, in its colour,
  // at (almost) any zoom so the whole line is visible.
  // A stop is worth drawing only if the live feed has something still due there (while searching:
  // from the searched line(s)). Without trip updates nothing is known, so every stop shows.
  function stopExpecting(id, now) {
    var list = stopIndex[id];
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.t && e.t < now - 30000) continue;
      if (searchRoutes && !(trips[e.tripId] && searchRoutes[trips[e.tripId].route_id])) continue;
      return true;
    }
    return false;
  }
  var visibleStops = new Map();
  function renderStops() {
    visibleStops = stopsInView();
    var open = sheetMarker || (view3d.on && view3d.popStop && view3d.popStop());
    if (open && open._stop && !visibleStops.has(open._stop.id) &&
        open === open._stop._mk && !twinsOf(open._stop.id).some(function (id) {
          return routeStopMarkers[id] || (focusedStop && focusedStop.id === id);
        })) {
      visibleStops.set(open._stop.id,{stop:open._stop,color:open._color});
    }
    if (view3d.on) { view3d.stopsChanged(); return; }
    Object.keys(stopMarkers).forEach(function (id) {
      var mk = stopMarkers[id];
      if (visibleStops.has(id) || mk.isPopupOpen() || mk === sheetMarker) return;
      stopLayer.removeLayer(mk);
      delete stopMarkers[id];
    });
    visibleStops.forEach(function (item,id) {
      var mk = ordinaryStopMarker(item.stop,item.color);
      if (!stopMarkers[id]) stopLayer.addLayer(stopMarkers[id]=mk);
    });
  }
  function stopsInView() {
    var searching = searchStops !== null;
    var zoom = viewZoom(), show = zoom >= (searching ? 11 : STOP_ZOOM);
    var metroOnly = activeTypes[1] && !activeTypes[0] && !activeTypes[3] && !activeTypes[11];
    var showMetro = activeTypes[1] && zoom >= (searching || metroOnly ? 11 : 13);
    var b = viewLBounds(0.2);
    var minLat = b.getSouth(), maxLat = b.getNorth(), minLon = b.getWest(), maxLon = b.getEast();
    var live = Object.keys(tuByTrip).length > 0, now = Date.now();
    function eligible(st) {
      if (!st || st.station) return false;
      if (st.lat < minLat || st.lat > maxLat || st.lon < minLon || st.lon > maxLon) return false;
      if (metroTimetable.serves(st.id)) return showMetro && metroTimetable.serves(st.id, searchRoutes);
      if (!show || metroOnly || (searching && !searchStops[st.id])) return false;
      return !live || stopExpecting(st.id, now);   // empty stops aren't drawn
    }
    // twins (v77): one icon per shared stop — the first twin that qualifies; none when one of them is
    // already drawn as the tracked vehicle's stop or as "your stop" (its list covers all twins too)
    function wanted(st) {
      if (!eligible(st)) return false;
      var tw = twinsOf(st.id);
      for (var i = 0; i < tw.length; i++) {
        if (routeStopMarkers[tw[i]] || (focusedStop && focusedStop.id === tw[i])) return false;
      }
      for (var j = 0; j < tw.length && tw[j] !== st.id; j++) if (eligible(stops[tw[j]])) return false;
      return true;
    }
    function markerColor(id) { return metroTimetable.serves(id) ? TYPES[1].color : searching ? searchStops[id] || null : null; }
    var visible = new Map();
    if (!show && !showMetro) return visible;
    var candidates;
    if (!show || metroOnly) {
      candidates = Array.from(metroTimetable.stationIds(), function (id) { return stops[id]; }).filter(Boolean);
    } else if (searching) {
      candidates = Object.keys(searchStops).map(function (id) { return stops[id]; }).filter(Boolean);
      for (var sid of metroTimetable.stationIds()) if (!searchStops[sid] && stops[sid]) candidates.push(stops[sid]);
    } else {
      candidates = [];
      var x0 = Math.floor(minLat / STOP_GRID_DEG), x1 = Math.floor(maxLat / STOP_GRID_DEG);
      var y0 = Math.floor(minLon / STOP_GRID_DEG), y1 = Math.floor(maxLon / STOP_GRID_DEG);
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var cell = stopGrid[x + ':' + y];
          if (cell) {
            for (var ci = 0; ci < cell.length; ci++) candidates.push(cell[ci]);
          }
        }
      }
    }
    for (var i = 0; i < candidates.length; i++) {
      var st = candidates[i], id = st.id;
      if (wanted(st)) visible.set(id,{stop:st,color:markerColor(id)});
    }
    return visible;
  }

  function ordinaryStopMarker(st, color) {
    var mk = st._mk;
    if (!mk) {
      mk = st._mk = stopMarker(st, color ? 'route' : '', color, color ? 200 : 0);
      mk._color = color;
    } else if (mk._color !== color) {
      mk._color = color;
      mk.setIcon(stopIcon(color ? 'route' : '', color, st));
      mk.setZIndexOffset(color ? 200 : 0);
    }
    return mk;
  }
