  // ---------- End of a run, the next run, and switching runs ----------
  var PARK_MAX_MS = 20 * 60e3;   // a bus that drops out of the feed at the end of its line stays this long
  function runAlong(v, m) {
    if (v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number') return v.along;
    var p = v.pos || [v.d.lat, v.d.lon], pr = projectAlong(m, p[0], p[1], v.d.bearing);
    return pr ? pr.s : null;
  }
  function atEndOfRun(v) {
    var m = routeMetaFor(v.d);
    if (!m) return false;
    var p = v.pos || [v.d.lat, v.d.lon], s = runAlong(v, m);
    return (typeof s === 'number' && m.total - s < 150) || distM(p, m.pts[m.pts.length - 1]) < 200;
  }
  function nearEndOfRun(v) {
    var m = routeMetaFor(v.d);
    if (!m) return false;
    return atEndOfRun(v) || distM(v.pos || [v.d.lat, v.d.lon], m.pts[m.pts.length - 1]) < 600;
  }
  function lastStopName(v) {
    var list = tripStopsCache[v.d.tripRef], last = list && list.length && stops[list[list.length - 1].stopId];
    return (last && last.name) || (trips[v.d.tripRef] || {}).headsign || v.d.headsign || 'the end of the line';
  }
  function clockOf(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }

  // A best guess that reaches "your stop" only after turning round at the end of this run (picked
  // from a stop's list): the next run's route from its start up to that stop. Null otherwise.
  function returnLeg(v) {
    var fg = focusGuessEta;
    if (v !== selected || !fg || fg.g.sameWay || !fg.g.tripId || !focusedStop || !shapes) return null;
    var ti = trips[fg.g.tripId];
    if (!ti || !ti.shape_id || !shapes[ti.shape_id]) return null;
    var m2 = metaFor(ti.shape_id), to = stopAlong(m2, focusedStop, 0);
    if (to === null) return null;
    var pts = [];
    for (var i = 0; i < m2.pts.length && m2.cum[i] < to; i++) pts.push(m2.pts[i]);
    pts.push(pointAt(m2, to).ll);
    return pts.length > 1 ? { pts: pts } : null;
  }
  function isReturnGuess(v) {
    return !!(v === selected && focusGuessEta && !focusGuessEta.g.sameWay && focusedStop &&
      !routeStops.some(function (r) { return r.stop.id === focusedStop.id; }));
  }

  // The run this vehicle most likely does next: a trip of the same line that starts where this run
  // ends — one the feed already links to this vehicle, otherwise the earliest one nobody is driving.
  function findNextRun(v) {
    var info = trips[v.d.tripRef], m = routeMetaFor(v.d);
    if (!info || !m || !shapes) return null;
    var end = m.pts[m.pts.length - 1], now = Date.now(), best = null, bestScore = Infinity;
    for (var tid in tuByTrip) {
      if (tid === v.d.tripRef) continue;
      var tu = tuByTrip[tid], ti = trips[tid];
      if (!ti || ti.route_id !== info.route_id || !ti.shape_id || !shapes[ti.shape_id]) continue;
      var linked = !!tu.vehId && (tu.vehId === v.d.key || tu.vehId === v.d.label);
      if (tu.vehId && !linked) continue;                 // another vehicle's trip
      if (!linked && tripToVeh[tid]) continue;           // already being driven
      var first = shapes[ti.shape_id][0];
      if (distM(end, [first[0], first[1]]) > 800) continue;   // doesn't start where this run ends
      var t = Infinity;
      tu.stus.forEach(function (x) { if (x.t && x.t > now - 60000 && x.t < t) t = x.t; });
      if (t === Infinity) continue;
      var score = linked ? t - 1e13 : t;
      if (score < bestScore) { bestScore = score; best = { tripId: tid, t: t, linked: linked }; }
    }
    return best;
  }

  function onTripChange(v, hadTrip) {
    if (hadTrip) { v.runNote = 'Started its next run → ' + (v.d.headsign || '?'); v.runNoteUntil = Date.now() + 30000; }
    clearRouteStops();
    if (shapes) drawPath(v);
    refreshPopup(v);
    var tid = v.d.tripRef, info = trips[tid];
    if (tid) loadTripStops(tid).then(function () { if (selected === v) drawRouteStops(); });
    if (info && info.shape_id && shapes && shapes[info.shape_id]) {
      snapShape(info.shape_id).then(function () { if (selected === v) { planMotion(v, false); drawPath(v); drawRouteStops(); } });
    }
  }

  function setParked(v, on) {
    if (!!v.parked === on) return;
    v.parked = on;
    v.parkedSince = on ? Date.now() : null;
    if (on) v.mo = null;
    v.dot.setStyle({ fillOpacity: on ? 0.45 : 1, dashArray: on ? '3 3' : null });
    if (v.pill) { v.k = iconKey(v.d); v.pill.setIcon(iconFor(v.d)); keepTop(v); }
    refreshPopup(v);
  }

  var pathCase = null, pathLine = null, headCase = null, headLine = null, pathSyncAt = 0;
  function drawPath(v) {
    var r3 = drawPath2d(v);
    if (view3d.on) view3d.pathChanged();   // v101: the same line on the 3D map
    return r3;
  }
  function drawPath2d(v) {
    pathLayer.clearLayers();
    headCase = headLine = pathCase = pathLine = pathEnd = pathPreview = null;
    var w = pathWeights(map.getZoom());
    var d = v.d, m = routeMetaFor(d);
    v.nextRun = null;
    if (!m) {
      stopArrows();
      v.pathNote = shapes ? 'Route path not available for this trip' : 'Loading route…';
      if (v === selected) showTracking(v);
      return false;
    }
    if (v.parked || atEndOfRun(v)) {
      // end of the line: no route ahead — show where it's going next instead
      stopArrows();
      var nr = v.nextRun = findNextRun(v);
      v.pathNote = 'At ' + lastStopName(v) + ' (end of the line)';
      if (nr) {
        var ni = trips[nr.tripId];
        v.pathNote += ' · next run → ' + (ni.headsign || '?') + ' ≈ ' + clockOf(nr.t) + (nr.linked ? '' : ' (best guess)');
        pathPreview = L.polyline(metaFor(ni.shape_id).pts, {
          renderer: pathRenderer, color: d.color, weight: w.preview, opacity: 0.55,
          dashArray: '1 12', lineCap: 'round', lineJoin: 'round', interactive: false
        }).addTo(pathLayer);
      }
      if (v === selected) showTracking(v);
      return false;
    }
    var pos = v.pos || [d.lat, d.lon];
    var r = remainingPath(m, pos[0], pos[1], d.bearing);
    if (r.path.length < 2) { stopArrows(); v.pathNote = ''; return false; }
    v.pathNote = '';
    // picked as the bus that comes back after this run: its way back to your stop, dashed, under this run
    var leg = returnLeg(v);
    if (leg) {
      pathPreview = L.polyline(leg.pts, {
        renderer: pathRenderer, color: d.color, weight: w.preview, opacity: 0.55,
        dashArray: '1 12', lineCap: 'round', lineJoin: 'round', interactive: false
      }).addTo(pathLayer);
    }

    // dark border underneath, then the coloured line on top
    pathCase = L.polyline(r.path, {
      renderer: pathRenderer, color: '#1a1a1a', weight: w.casing, opacity: 0.55,
      lineCap: 'round', lineJoin: 'round', interactive: false
    }).addTo(pathLayer);
    headCase = L.polyline([], pathCase.options).addTo(pathLayer);
    pathLine = L.polyline(r.path, {
      renderer: pathRenderer, color: d.color, weight: w.line, opacity: 0.85,
      lineCap: 'round', lineJoin: 'round', interactive: false
    }).addTo(pathLayer);
    headLine = L.polyline([], pathLine.options).addTo(pathLayer);
    // end of the line
    pathEnd = L.circleMarker(r.path[r.path.length - 1], {
      renderer: pathRenderer, radius: w.end, color: '#1a1a1a', weight: 3, opacity: 0.9,
      fillColor: '#fff', fillOpacity: 1, interactive: false
    }).addTo(pathLayer);

    // arrows slide along the route on their own; they're anchored to the route, not the vehicle,
    // so a position update only trims the ones behind the vehicle instead of making them jump
    flow = { m: m, along: typeof v.along === 'number' && v.mo && v.mo.m === m ? v.along : r.along };
    startArrows();
    if (v === selected) showTracking(v);
    return true;
  }
  // Every frame: the line starts exactly at the icon and the part already driven is cut away
  function syncPath(v) {
    if (!pathLine || !flow || !v.pos || zooming) return;
    var now = performance.now();
    if (now - pathSyncAt < 8) return;   // every frame: at 30/s the line's start trailed the icon
    if (flow.drawLat === v.pos[0] && flow.drawLon === v.pos[1] &&
        flow.drawAlong === v.along && flow.draw3d === view3d.on) return;
    flow.drawLat = v.pos[0]; flow.drawLon = v.pos[1];
    flow.drawAlong = v.along; flow.draw3d = view3d.on;
    pathSyncAt = now;
    var m = flow.m;
    if (v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number') {
      flow.along = v.along;
      var lo = 0, hi = m.cum.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (m.cum[mid] <= v.along) lo = mid + 1; else hi = mid; }
      if (!m._latLngs) {
        m._latLngs = m.pts.map(function (p) { return L.latLng(p[0], p[1]); });
      }
      if (lo !== flow._lastLo || !flow._tail) {
        flow._lastLo = lo;
        flow._tail = m._latLngs.slice(lo);
      }
    } else if (!flow._tail) {
      flow._tail = pathLine.getLatLngs().slice(1);
    }
    var tail = flow._tail;
    var head = tail.length ? [L.latLng(v.pos[0], v.pos[1]), tail[0]] : [];
    if (view3d.on) { view3d.pathMoved(head, tail); return; }
    if (flow.drawnTail !== tail) {
      pathCase.setLatLngs(tail);
      pathLine.setLatLngs(tail);
      flow.drawnTail = tail;
    }
    headCase.setLatLngs(head);
    headLine.setLatLngs(head);
  }

