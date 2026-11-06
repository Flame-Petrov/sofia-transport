  // ---------- Sliding direction arrows (Hardware-accelerated Canvas overlay) ----------
  var ARROW_GAP_PX = 70, ARROW_SPEED_PX = 30, ARROW_MAX = 120;
  var flow = null, arrowRaf = 0;
  var arrowCanvas = document.createElement('canvas');
  arrowCanvas.style.position = 'absolute';
  arrowCanvas.style.pointerEvents = 'none';
  map.getPane('arrowPane').appendChild(arrowCanvas);
  var arrowCtx = arrowCanvas.getContext('2d');
  var arrowDpr = Math.min(window.devicePixelRatio || 1, 2);

  // Pre-render the arrow icon once on an off-screen canvas glyph for instant drawImage blits
  var arrowGlyph = document.createElement('canvas');
  var arrowGw = Math.round(24 * arrowDpr), arrowGh = Math.round(24 * arrowDpr);
  arrowGlyph.width = arrowGw; arrowGlyph.height = arrowGh;
  var gctx = arrowGlyph.getContext('2d');
  gctx.scale(arrowDpr, arrowDpr);
  gctx.shadowColor = 'rgba(0,0,0,0.85)';
  gctx.shadowBlur = 3;
  gctx.fillStyle = '#ffffff';
  gctx.font = '13px system-ui, -apple-system, sans-serif';
  gctx.textAlign = 'center';
  gctx.textBaseline = 'middle';
  gctx.fillText('➤', 12, 12);

  function syncArrowCanvas() {
    var size = map.getSize();
    var nw = Math.round(size.x * arrowDpr), nh = Math.round(size.y * arrowDpr);
    if (arrowCanvas.width !== nw || arrowCanvas.height !== nh) {
      arrowCanvas.width = nw;
      arrowCanvas.height = nh;
      arrowCanvas.style.width = size.x + 'px';
      arrowCanvas.style.height = size.y + 'px';
    }
    var topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(arrowCanvas, topLeft);
  }
  map.on('move resize viewreset', syncArrowCanvas);
  map.on('zoomstart', function () {
    if (arrowCtx) arrowCtx.clearRect(0, 0, arrowCanvas.width, arrowCanvas.height);
  });
  syncArrowCanvas();

  function metersPerPixel(lat) { return 156543.03392 * Math.cos(toRad(lat)) / Math.pow(2, map.getZoom()); }
  function pointAt(m, s) {
    var lo = 0, hi = m.cum.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (m.cum[mid] <= s) lo = mid; else hi = mid; }
    var a = m.pts[lo], b = m.pts[hi], seg = m.cum[hi] - m.cum[lo], t = seg > 0 ? (s - m.cum[lo]) / seg : 0;
    return { ll: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], deg: m.bear[lo] };
  }
  function pointLL(m, s, out) {
    var lo = 0, hi = m.cum.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (m.cum[mid] <= s) lo = mid; else hi = mid; }
    var a = m.pts[lo], b = m.pts[hi], seg = m.cum[hi] - m.cum[lo], t = seg > 0 ? (s - m.cum[lo]) / seg : 0;
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    return out;
  }
  function arrowFrame(now) {
    arrowRaf = 0;
    if (!flow || view3d.on) return;
    if (zooming) { arrowRaf = requestAnimationFrame(arrowFrame); return; }   // v101: 3D has its own arrows
    syncArrowCanvas();
    var size = map.getSize(), w = size.x, h = size.y;
    arrowCtx.setTransform(arrowDpr, 0, 0, arrowDpr, 0, 0);
    arrowCtx.clearRect(0, 0, w, h);
    var m = flow.m, mpp = metersPerPixel(m.pts[0][0]);
    var gap = Math.max(ARROW_GAP_PX * mpp, m.total / ARROW_MAX);
    var offset = ((now / 1000) * ARROW_SPEED_PX * mpp) % gap;
    var n = 0;
    for (var s = Math.floor((flow.along - offset) / gap) * gap + offset; s < m.total && n < ARROW_MAX; s += gap) {
      if (s <= flow.along) continue;
      var p = pointAt(m, s);
      var pt = map.latLngToContainerPoint(p.ll);
      n++;
      if (pt.x < -15 || pt.x > w + 15 || pt.y < -15 || pt.y > h + 15) continue;
      var rad = (p.deg - 90) * Math.PI / 180;
      arrowCtx.save();
      arrowCtx.translate(pt.x, pt.y);
      arrowCtx.rotate(rad);
      arrowCtx.drawImage(arrowGlyph, -12, -12, 24, 24);
      arrowCtx.restore();
    }
    arrowRaf = requestAnimationFrame(arrowFrame);
  }
  function startArrows() { if (!arrowRaf) arrowRaf = requestAnimationFrame(arrowFrame); }
  function stopArrows() {
    if (arrowRaf) { cancelAnimationFrame(arrowRaf); arrowRaf = 0; }
    flow = null;
    if (arrowCtx) arrowCtx.clearRect(0, 0, arrowCanvas.width, arrowCanvas.height);
  }
  function clearPath() { pathLayer.clearLayers(); headCase = headLine = pathCase = pathLine = pathEnd = pathPreview = null; stopArrows(); if (view3d.on) view3d.pathChanged(); }

  function refreshPopup(v) {
    refreshVehPopup(v);
  }
  // Tracking bar: line badge, then the state (top line) and its detail (bottom line).
  // "Your stop" wins (it's what the rider waits for), then a just-started run, waiting at the
  // terminus, end of the line, and plain tracking.
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }

  // Progress to "your stop" (right edge): shown only while a vehicle is tracked towards a stop picked
  // from a stop's list or from All stops. The bus starts at the bottom and climbs to the stop on top.
  // Distance is along the route (incl. the way back for a return-trip guess); straight line until the
  // route is loaded. 100 % = the farthest it has been from the stop since tracking started.
  var prog = { key: '', total: 0, passed: false, passedAt: 0 };
  function distToStop(v, st) {
    var along = v === selected ? vehicleAlong(v) : null;
    if (flow && along !== null) {
      var m = flow.m, to = stopAlong(m, st, along - 60);
      if (typeof to === 'number') return { m: Math.max(0, to - along), exact: true };
      var leg = returnLeg(v);
      if (leg) {
        var d = Math.max(0, m.cum[m.cum.length - 1] - along);
        for (var i = 1; i < leg.pts.length; i++) d += distM(leg.pts[i - 1], leg.pts[i]);
        return { m: d, exact: true };
      }
    }
    return { m: distM(v.pos || [v.d.lat, v.d.lon], [st.lat, st.lon]), exact: false };
  }
  // The stops the vehicle still calls at before yours, each as its distance left to your stop (same
  // scale as the bus). A return-trip guess adds the rest of this run and the next run's stops up to yours.
  // Stops whose place on the route isn't known yet get null (spread evenly between bus and stop).
  function stopsBetween(v, r) {
    var out = [], along = vehicleAlong(v), m = flow && flow.m;
    function at(x, base) { return typeof x.sAlong === 'number' && typeof base === 'number' ? base - x.sAlong : null; }
    if (r) {
      for (var i = 0; i < routeStops.length && routeStops[i] !== r; i++) out.push(at(routeStops[i], r.sAlong));
      return out;
    }
    var fg = focusGuessEta;
    if (!fg || fg.g.sameWay || !fg.g.tripId || !m || along === null) return out;
    var ti = trips[fg.g.tripId], m2 = ti && ti.shape_id && shapes && shapes[ti.shape_id] ? metaFor(ti.shape_id) : null;
    var to = m2 ? stopAlong(m2, focusedStop, 0) : null;
    if (typeof to !== 'number') return out;
    var runEnd = m.cum[m.cum.length - 1];
    routeStops.forEach(function (x) { var d = at(x, runEnd); out.push(d === null ? null : d + to); });
    var list = tripStopsCache[fg.g.tripId];
    if (!list) { loadTripStops(fg.g.tripId); return out; }   // picked up on the next refresh
    var minS = 0;
    for (var j = 1; j < list.length; j++) {   // the first one is the terminus it turns at, already counted
      var st = stops[list[j].stopId];
      if (!st) continue;
      if (st.id === focusedStop.id) break;
      var sa = stopAlong(m2, st, minS);
      if (typeof sa === 'number') { minS = sa - 30; if (sa < to) out.push(to - sa); }
    }
    return out;
  }
  function drawStopDots(dists, busFrac, total) {
    var n = dists.length, html = '';
    dists.forEach(function (d, k) {
      var f = d === null ? busFrac + (1 - busFrac) * (k + 1) / (n + 1) : 1 - d / total;
      if (f > busFrac + 0.005 && f < 0.995) html += '<div class="pg-dot" style="bottom:' + (Math.round(f * 1000) / 10) + '%"></div>';
    });
    var el = document.getElementById('pgDots');
    if (el._h !== html) { el._h = html; el.innerHTML = html; }
  }
  function showProgress(v) {
    var box = document.getElementById('stopProg');
    if (!v || !focusedStop) { box.hidden = true; prog.key = ''; prog.passed = false; return; }
    var key = (v.d.key || v.d.id || v.d.label) + '|' + focusedStop.id;
    if (prog.key !== key) {
      prog.key = key; prog.total = 0; prog.passed = false;
      box.querySelector('.pg-stop').innerHTML = BUS_SVG;
    }
    var r = routeStops.filter(function (x) { return x.stop.id === focusedStop.id; })[0];
    var passed = !r && !focusGuessEta && routeStops.length > 0;
    if (passed && !prog.passed) prog.passedAt = Date.now();
    prog.passed = passed;
    var d = passed ? { m: 0, exact: true } : distToStop(v, focusedStop);
    prog.total = Math.max(prog.total, d.m, 1);
    var frac = passed ? 1 : Math.max(0, Math.min(1, 1 - d.m / prog.total));
    var eta = r ? r.eta : focusGuessEta ? (guessArrival(v, focusedStop, focusGuessEta.g, focusGuessEta.predicted) || focusGuessEta.predicted) : null;
    var min = eta ? Math.round((eta - Date.now()) / 60000) : null;
    setText(document.getElementById('pgEta'), passed ? 'passed' : min === null ? '' : (focusGuessEta ? '≈ ' : '') + (min <= 0 ? 'now' : min + ' min'));
    setText(document.getElementById('pgDist'), passed ? '' : (d.exact ? '' : '≈ ') + (d.m >= 1000 ? (d.m / 1000).toFixed(1) + ' km' : Math.round(d.m / 10) * 10 + ' m'));
    var badge = document.getElementById('pgBadge');
    setText(badge, v.d.line || v.d.label || '?');
    if (badge._c !== v.d.color) {
      badge._c = v.d.color; badge.style.background = v.d.color; badge.style.color = lineTones(v.d.color).ink;
      document.getElementById('pgFill').style.background = v.d.color;
    }
    var pct = Math.round(frac * 1000) / 10;
    var between = passed ? [] : stopsBetween(v, r);
    drawStopDots(between, frac, prog.total);
    if (between.length) setText(document.getElementById('pgDist'), document.getElementById('pgDist').textContent + '\n' + between.length + (between.length === 1 ? ' stop' : ' stops'));
    document.getElementById('pgFill').style.height = pct + '%';
    document.getElementById('pgBus').style.bottom = pct + '%';
    box.setAttribute('aria-valuenow', Math.round(pct));
    box.setAttribute('aria-label', (v.d.line || '') + ' to ' + (focusedStop.name || 'your stop') + ': ' + document.getElementById('pgDist').textContent + ' ' + document.getElementById('pgEta').textContent);
    box.hidden = false;
  }
  document.getElementById('stopProg').onclick = function () {   // tap: show the way to the stop again
    if (selected && focusedStop) { setFollow(false); fitRouteToStop(selected, focusedStop); }
  };
  var PASSED_STOP_MS = 3000;   // how long "passed" shows before tracking ends by itself
  setInterval(function () {
    if (!selected || !focusedStop) return;
    showProgress(selected);
    if (prog.passed && Date.now() - prog.passedAt > PASSED_STOP_MS) stopTracking();
  }, 500);

  function showTracking(v) {
    var bar = document.getElementById('tracking');
    showProgress(v);
    if (!v) { bar.hidden = true; return; }
    var badge = document.getElementById('trackBadge');
    setText(badge, v.d.line || v.d.label || '?');
    if (badge._c !== v.d.color) { badge._c = v.d.color; badge.style.background = v.d.color; badge.style.color = lineTones(v.d.color).ink; }
    var top = 'Tracking', bot = '→ ' + (titleCaseBg(v.d.headsign) || typeInfo(v.d.type).name + ' ' + (v.d.line || v.d.label));
    if (focusedStop) {
      var r = routeStops.filter(function (x) { return x.stop.id === focusedStop.id; })[0];
      if (r && focusGuessEta) focusGuessEta = null;   // the stop is now on this bus's own run: its own time
      top = '→ ' + (titleCaseBg(focusedStop.name) || 'your stop');
      bot = r ? etaPhrase(r.eta)
        : focusGuessEta ? '≈ ' + clockOf(guessArrival(v, focusedStop, focusGuessEta.g, focusGuessEta.predicted) || focusGuessEta.predicted || Date.now()) +
            (focusGuessEta.g.sameWay ? ' (best guess)' : ' · after turning at ' + titleCaseBg(lastStopName(v)) + ' (best guess)')
        : (routeStops.length ? 'already passed' : '…');
    } else if (v.runNote && Date.now() < v.runNoteUntil) {
      top = 'Started next run';
    } else if (v.parked) {
      top = 'Waiting at terminus';
      bot = 'last seen ' + Math.max(1, Math.round((Date.now() - (v.d.ts ? v.d.ts * 1000 : v.parkedSince)) / 60000)) + ' min ago';
    } else if (/end of the line/.test(v.pathNote || '')) {
      var nr = v.nextRun, ni = nr && trips[nr.tripId];
      top = 'End of the line';
      bot = ni ? 'Next run → ' + (titleCaseBg(ni.headsign) || '?') + ' ≈ ' + clockOf(nr.t) + (nr.linked ? '' : ' (best guess)')
               : 'At ' + titleCaseBg(lastStopName(v));
    }
    setText(document.getElementById('trackTop'), top);
    setText(document.getElementById('trackBot'), bot);
    bar.hidden = false;
  }
  function deselect() {
    if (sheetVeh) closeSheet();   // phones: its card goes with it
    if (selected) selected.pathNote = '';
    var was = selected;
    selected = null;
    markVehicle(was, false);
    focusedStop = null;
    focusGuessEta = null;
    drawFocusStop();
    clearPath();
    clearRouteStops();
    showTracking(null);
  }
  function select(v) {
    var was = selected;
    selected = v;
    setLocFollow(false);   // tracking a vehicle: the camera is its, not your location's
    if (was && was !== v) { markVehicle(was, false); clearPath(); }
    markVehicle(v, true);
    // v99: one of your way's vehicles, however it was picked (a tap on the map, the card): tracked to the stop
    // where you get on it, so the tracking bar and its card count down to that stop
    var rv = routeVeh[v.d.key];
    if (rv && !pendingFocusStop && stops[rv.stopId]) { pendingFocusStop = stops[rv.stopId]; pendingGuessEta = rv.guess; }
    focusedStop = pendingFocusStop;   // set only when picked from a stop's list (v99: or your way's vehicle)
    focusGuessEta = pendingGuessEta;  // set only when that pick was a best guess
    pendingFocusStop = null;
    pendingGuessEta = null;
    drawFocusStop();
    showTracking(v);
    clearRouteStops();
    drawRouteStops();
    if (following) map.panTo(v.pos || [v.d.lat, v.d.lon]);
    if (!shapes) { v.pathNote = 'Loading route…'; refreshPopup(v); }
    var tTap = performance.now();
    // 1) the route line first…
    loadShapes().then(function () {
      if (selected !== v) return;
      planMotion(v, false);
      drawPath(v);
      timings.route = Math.round(performance.now() - tTap) + ' ms';
      refreshPopup(v);
      // 2) …then, once it's on screen and the camera has landed, the stop timetable and the road snapping
      afterCamera(function () {
        if (selected !== v) return;
        renderDiag();
        var info = trips[v.d.tripRef];
        if (info && info.shape_id && shapes && shapes[info.shape_id]) {
          snapShape(info.shape_id).then(function () { if (selected === v) { planMotion(v, false); drawPath(v); drawRouteStops(); } });
        }
        if (v.d.tripRef) {
          var tid = v.d.tripRef, cached = !!tripStopsCache[tid], t1 = performance.now();
          loadTripStops(tid).then(function () {
            timings.stops = cached ? 'already loaded' : Math.round(performance.now() - t1) + ' ms';
            renderDiag();
            if (selected === v) drawRouteStops();
          });
        }
      });
    });
  }
  // v89: runs fn once the camera isn't flying or gliding (30 ms at the earliest, at most 2 s later)
  var camMoving = false;
  map.on('movestart', function () { camMoving = true; });
  map.on('moveend', function () { camMoving = false; });
  function afterCamera(fn) {
    var done = false;
    function go() { if (!done) { done = true; setTimeout(fn, 60); } }
    setTimeout(function () {
      if (!camMoving) { done = true; fn(); return; }
      map.once('moveend', go);
      setTimeout(go, 2000);
    }, 30);
  }
  // Tapping a vehicle starts tracking it. Closing its popup (X) only hides the popup;
  // tracking stops via the Stop button, a tap on empty map, or tapping another vehicle.
