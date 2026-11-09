  // ---- on the map ----
  function legLL(x, me, place) {
    if (x === -1) return [me.lat, me.lng];
    if (x === -2) return [place.lat, place.lon];
    var st = ttStop(x);
    return st ? [st.lat, st.lon] : null;
  }
  function ridePath(lg) {
    var a = ttStop(lg.from), b = ttStop(lg.to), info = trips[lg.tid];
    if (!a || !b) return null;
    if (shapes && info && info.shape_id && shapes[info.shape_id] && shapes[info.shape_id].length > 1) {
      var m = tripShapeMeta(info), s0 = stopAlong(m, a, 0), s1 = s0 !== null ? stopAlong(m, b, s0 + 1) : null;
      if (s0 !== null && s1 !== null && s1 > s0) {
        var pts = [pointAt(m, s0).ll];
        for (var i = 0; i < m.pts.length; i++) if (m.cum[i] > s0 && m.cum[i] < s1) pts.push(m.pts[i]);
        pts.push(pointAt(m, s1).ll);
        return pts;
      }
    }
    return [[a.lat, a.lon], [b.lat, b.lon]];
  }
  function routeColorOf(lg) { return routeColor(tt.patRoute[lg.p]); }
  function drawRoute() {
    routeLayer.clearLayers();
    savedPlaces.refreshDestination();
    var way = route && route.ways[0], p = route && savedPlaces.find(route.placeId), me = loc.fix ? loc.fix.ll : null;
    if (!way || !p || !me) return;
    var w = pathWeights(map.getZoom()), nRide = 0;
    way.legs.forEach(function (lg, n) {
      if (lg.kind === 'walk') {
        var a = legLL(lg.from, me, p), b = legLL(lg.to, me, p);
        // v94: along the streets once worked out (straight until then, or when it can't be)
        if (a && b) L.polyline(lg.street ? [a].concat(lg.pts, [b]) : [a, b], { renderer: pathRenderer, color: '#D6336C', weight: 4, opacity: 0.9, dashArray: '1 9', lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
        return;
      }
      var pts = ridePath(lg), color = routeColorOf(lg);
      if (!pts) return;
      L.polyline(pts, { renderer: pathRenderer, color: '#1a1a1a', weight: w.casing, opacity: 0.45, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
      L.polyline(pts, { renderer: pathRenderer, color: color, weight: w.line, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(routeLayer);
      var info = trips[lg.tid], rType = (routes[tt.patRoute[lg.p]] || {}).type;
      // onto the roads, as for a tapped vehicle — not the metro (no roads to match: the service answers 400)
      if (rType !== 1 && info && info.shape_id && shapes && shapes[info.shape_id] && snapped[info.shape_id] === undefined) {
        snapShape(info.shape_id).then(function () { if (route && route.ways[0] === way) drawRoute(); });
      }
      var line = (routes[tt.patRoute[lg.p]] || {}).short || '?', tone = lineTones(color);
      routeTag(ttStop(lg.from), (nRide ? 'Change → ' : 'Board ') + '<b style="background:' + color + ';color:' + tone.ink + '">' + esc(line) + '</b>', color);
      var next = way.legs[n + 1], last = !way.legs.slice(n + 1).some(function (l) { return l.kind === 'ride'; });
      if (last || (next && next.kind === 'walk')) routeTag(ttStop(lg.to), 'Get off', color, true);
      nRide++;
    });
  }
  // a tag on a stop of the route: boarding / changing above the stop, getting off below it (they're often
  // only a short walk apart and would cover each other)
  function routeTag(st, html, color, below) {
    if (!st) return;
    L.marker([st.lat, st.lon], {
      pane: 'routePane', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'rt-mk', iconSize: null, html: '<div class="rt-pin" style="border-color:' + color + '"></div><div class="rt-tag' + (below ? ' below' : '') + '">' + html + '</div>' })
    }).addTo(routeLayer);
  }
  function fitRoute() {
    var way = route && route.ways[0], p = route && savedPlaces.find(route.placeId), me = loc.fix ? loc.fix.ll : null;
    if (!way || !p || !me) return;
    var pts = [[me.lat, me.lng], [p.lat, p.lon]];
    way.legs.forEach(function (lg) { if (lg.kind === 'ride') pts = pts.concat(ridePath(lg) || []); else if (lg.street) pts = pts.concat(lg.pts); });
    var fr = way.legs.filter(function (l) { return l.kind === 'ride'; })[0], fk = fr && fr.live && fr.live.key, fv = fk && vehicles[fk], bs = fr && ttStop(fr.from);   // v99
    if (fv && bs) { var vp = fv.pos || [fv.d.lat, fv.d.lon]; if (distM(vp, [bs.lat, bs.lon]) < 4000) pts.push(vp); }
    var size = map.getSize(), pr = document.getElementById('panel').getBoundingClientRect(), tl, br;
    // phones: the sheet's height read now (the kept value can still be the short "searching…" sheet's)
    if (isPhone()) { tl = [28, Math.round(pr.bottom) + 40]; br = [28, Math.round(sheetHeight()) + 28]; }
    else { tl = [Math.round(pr.right) + 40, 48]; br = [100, 40]; }
    if (following) setFollow(false);
    setLocFollow(false);
    if (view3d.on && view3d.fitRoute) { view3d.fitRoute(pts, me, p, tl, br); return; }   // v102: turned so the way runs up the screen
    map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: tl, paddingBottomRight: br, maxZoom: 17, duration: 0.8 });
  }

