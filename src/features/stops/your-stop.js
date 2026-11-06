  // ---------- "Your stop": the stop a vehicle was picked from stays marked ----------
  var focusedStop = null, pendingFocusStop = null, focusMarker = null, focusGuessEta = null, pendingGuessEta = null;
  var focusLayer = L.layerGroup().addTo(map);
  function drawFocusStop() {
    focusLayer.clearLayers();
    focusMarker = null;
    if (!focusedStop) { if (view3d.on) view3d.stopsChanged(); return; }
    if (stopMarkers[focusedStop.id]) { stopLayer.removeLayer(stopMarkers[focusedStop.id]); delete stopMarkers[focusedStop.id]; }
    if (routeStopMarkers[focusedStop.id]) { routeStopLayer.removeLayer(routeStopMarkers[focusedStop.id]); delete routeStopMarkers[focusedStop.id]; }
    focusMarker = stopMarker(focusedStop, 'focus', null, 1000);
    focusMarker.bindTooltip(esc(focusedStop.name || 'Your stop'), {
      permanent: true, direction: 'top', offset: [0, -20], className: 'focus-label'
    });
    focusLayer.addLayer(focusMarker);
    raise(focusMarker, true);
    if (view3d.on) view3d.stopsChanged();   // v101
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
  function renderStops() {
    renderStops2d();
    if (view3d.on) view3d.stopsChanged();   // v101: the 3D map shows the same stop markers
  }
  function renderStops2d() {
    var searching = searchStops !== null;
    var show = viewZoom() >= (searching ? 11 : STOP_ZOOM);
    var b = viewLBounds(0.2);
    var minLat = b.getSouth(), maxLat = b.getNorth(), minLon = b.getWest(), maxLon = b.getEast();
    var live = Object.keys(tuByTrip).length > 0, now = Date.now();
    function eligible(st) {
      if (!st || st.station) return false;
      if (searching && !searchStops[st.id]) return false;
      if (!show || st.lat < minLat || st.lat > maxLat || st.lon < minLon || st.lon > maxLon) return false;
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
    Object.keys(stopMarkers).forEach(function (id) {
      var mk = stopMarkers[id], color = searching ? (searchStops[id] || null) : null;
      if (wanted(stops[id]) && mk._color === color) return;
      if (mk.isPopupOpen() || mk === sheetMarker) return;   // don't yank an open popup away
      stopLayer.removeLayer(mk);
      delete stopMarkers[id];
    });
    if (!show) return;
    var candidates;
    if (searching) {
      candidates = Object.keys(searchStops).map(function (id) { return stops[id]; }).filter(Boolean);
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
      if (stopMarkers[id] || !wanted(st)) continue;
      var color = searching ? searchStops[id] : null;
      var mk = st._mk;
      if (!mk) {
        mk = st._mk = stopMarker(st, color ? 'route' : '', color, color ? 200 : 0);
        mk._color = color;
      } else {
        if (mk._color !== color) {
          mk._color = color;
          mk.setIcon(stopIcon(color ? 'route' : '', color));
          mk.setZIndexOffset(color ? 200 : 0);
        }
      }
      stopLayer.addLayer(stopMarkers[id] = mk);
    }
  }

