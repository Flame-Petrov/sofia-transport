  // ---------- Route ahead of the selected vehicle ----------
  map.createPane('pathPane').style.zIndex = 350;   // under the vehicles
  map.createPane('arrowPane').style.zIndex = 390;
  map.getPane('arrowPane').style.pointerEvents = 'none';
  var pathRenderer = L.svg({ pane: 'pathPane' });

  // ---------- Route line width and zooming ----------
  // The line is thinner when zoomed out and grows smoothly as you zoom in. While the map flies or
  // is pinched, the library only stretches the old picture (8× thicker going from zoom 13 to 16),
  // so the route is redrawn at the real zoom on every frame instead. Quick CSS zooms (buttons,
  // double-tap) fade it out for their quarter-second and back in at the right size.
  var pathEnd = null, pathPreview = null, zoomFrame = 0;
  function pathWeights(z) {
    var k = Math.max(0, Math.min(1, (z - 12) / 4));   // zoom 12 → thinnest, 16+ → full width
    return { casing: 5 + 7 * k, line: 3 + 4 * k, end: 4 + 3 * k, preview: 3 + 3 * k };
  }
  function applyPathWeights() {
    var w = pathWeights(map.getZoom());
    if (pathCase) pathCase.setStyle({ weight: w.casing });
    if (pathLine) pathLine.setStyle({ weight: w.line });
    if (headCase) headCase.setStyle({ weight: w.casing });
    if (headLine) headLine.setStyle({ weight: w.line });
    if (pathEnd) pathEnd.setRadius(w.end);
    if (pathPreview) pathPreview.setStyle({ weight: w.preview });
  }
  map.on('zoom', function () {
    if (zoomFrame || map._animatingZoom) return;
    zoomFrame = requestAnimationFrame(function () {
      zoomFrame = 0;
      if (map._animatingZoom) return;
      applyPathWeights();
      if (pathRenderer._map) pathRenderer._reset();
      if (canvas._map) canvas._reset();   // vehicle dots keep their size too
    });
  });
  map.on('zoomanim', function () { L.DomUtil.addClass(map.getPane('pathPane'), 'zfade'); });
  map.on('zoomend', function () {
    applyPathWeights();
    requestAnimationFrame(function () { L.DomUtil.removeClass(map.getPane('pathPane'), 'zfade'); });
  });
  var pathLayer = L.layerGroup().addTo(map);
  var shapes = null, shapesLoading = null, selected = null, switching = false;

  // shapes.txt is big, so it's parsed only the first time someone taps a vehicle
  function loadShapes() {
    if (shapes) return Promise.resolve(shapes);
    if (shapesLoading) return shapesLoading;
    if (!staticZip) return Promise.resolve(null);
    var t0 = performance.now();
    shapesLoading = zipFile(staticZip, 'shapes.txt').then(function (text) {
      // processed in slices of 20,000 lines with a pause between them, so the page never freezes
      return new Promise(function (resolve) {
        var out = {}, lines = text.replace(/^﻿/, '').split('\n');
        text = null;
        var head = lines[0].replace('\r', '').split(',').map(function (h) { return h.trim().replace(/"/g, ''); });
        var iId = head.indexOf('shape_id'), iLat = head.indexOf('shape_pt_lat'),
            iLon = head.indexOf('shape_pt_lon'), iSeq = head.indexOf('shape_pt_sequence'), i = 1;
        function slice() {
          for (var end = Math.min(lines.length, i + 20000); i < end; i++) {
            var c = lines[i].replace('\r', '').split(',');
            if (c.length < 3) continue;
            var id = c[iId].replace(/"/g, '').trim();
            (out[id] || (out[id] = [])).push([+c[iLat], +c[iLon], +c[iSeq]]);
          }
          if (i < lines.length) { setTimeout(slice, 0); return; }
          Object.keys(out).forEach(function (id) { out[id].sort(function (a, b) { return a[2] - b[2]; }); });
          shapes = out;
          timings.shapes = Math.round(performance.now() - t0) + ' ms';
          resolve(out);
        }
        slice();
      });
    }).catch(function (e) { console.warn('Shapes failed:', e); shapes = {}; return shapes; });
    return shapesLoading;
  }

  function toRad(x) { return x * Math.PI / 180; }
  function distM(a, b) {
    var x = toRad(b[1] - a[1]) * Math.cos(toRad((a[0] + b[0]) / 2)), y = toRad(b[0] - a[0]);
    return Math.sqrt(x * x + y * y) * 6371000;
  }
  function bearingDeg(a, b) {
    var y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
    var x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function angleDiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // Per-shape lookup tables: cumulative distance and heading of each segment (built once per shape)
  var shapeMeta = {};
  function metaFor(id) {
    var key = id + (snapped[id] ? '|snapped' : '');
    if (shapeMeta[key]) return shapeMeta[key];
    var pts = (snapped[id] || shapes[id]).map(function (p) { return [p[0], p[1]]; }), cum = [0], bear = [], i;
    for (i = 1; i < pts.length; i++) { cum.push(cum[i - 1] + distM(pts[i - 1], pts[i])); bear.push(bearingDeg(pts[i - 1], pts[i])); }
    bear.push(bear.length ? bear[bear.length - 1] : 0);
    return (shapeMeta[key] = { pts: pts, cum: cum, bear: bear, total: cum[cum.length - 1] });
  }

  // Sofia's route shapes have few points, so straight lines between them cut corners and drift
  // off the street. When a vehicle is tapped, its route is snapped once onto OpenStreetMap's roads
  // with the free OSRM map-matching service, then cached. Any piece that fails, or that the
  // snapping would turn into a detour (e.g. a bus-only road cars can't use), keeps the original line.
  var OSRM_MATCH = 'https://router.project-osrm.org/match/v1/driving/';
  var snapped = {}, snapping = {};
  function pathLen(pts) { var t = 0; for (var i = 1; i < pts.length; i++) t += distM(pts[i - 1], pts[i]); return t; }
  function matchChunk(ch) {
    var url = OSRM_MATCH + ch.map(function (p) { return p[1].toFixed(6) + ',' + p[0].toFixed(6); }).join(';') +
      '?geometries=geojson&overview=full&gaps=ignore&tidy=true&radiuses=' + ch.map(function () { return '30'; }).join(';');
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.code !== 'Ok' || !j.matchings || !j.matchings.length) return null;
        var g = [];
        j.matchings.forEach(function (m) { m.geometry.coordinates.forEach(function (c) { g.push([c[1], c[0]]); }); });
        if (g.length < 2 || pathLen(g) > pathLen(ch) * 1.35 + 150) return null;  // looks like a detour
        return g;
      })
      .catch(function () { return 'fail'; });   // network problem (not saved, retried next time)
  }
  // run at most n at once (kind to the free routing service)
  function runLimited(tasks, n) {
    var results = new Array(tasks.length), next = 0;
    function worker() {
      if (next >= tasks.length) return Promise.resolve();
      var k = next++;
      return tasks[k]().then(function (r) { results[k] = r; return worker(); });
    }
    var ws = [];
    for (var i = 0; i < Math.min(n, tasks.length); i++) ws.push(worker());
    return Promise.all(ws).then(function () { return results; });
  }
  function snapShape(id) {
    if (snapped[id] !== undefined) return Promise.resolve(snapped[id]);
    if (snapping[id]) return snapping[id];
    var raw = shapes[id].map(function (p) { return [p[0], p[1]]; });
    // saved snaps are keyed by the shape's own geometry, so a changed route is snapped afresh
    var first = raw[0], last = raw[raw.length - 1];
    var key = 'snap:' + id + ':' + raw.length + ':' + first[0].toFixed(5) + ',' + first[1].toFixed(5) + ':' + last[0].toFixed(5) + ',' + last[1].toFixed(5);
    var t0 = performance.now();
    snapping[id] = idb.get('files', key).then(function (c) {
      if (c && c.d && Date.now() - c.t < 30 * 864e5) {
        snapped[id] = c.d.length > 1 ? c.d : null;
        timings.snap = 'saved on device';
        return snapped[id];
      }
      var pts = [raw[0]];
      for (var i = 1; i < raw.length; i++) if (distM(pts[pts.length - 1], raw[i]) >= 15 || i === raw.length - 1) pts.push(raw[i]);
      var chunks = [];
      for (i = 0; i < pts.length - 1; i += 99) chunks.push(pts.slice(i, i + 100));
      return runLimited(chunks.map(function (ch) { return function () { return matchChunk(ch); }; }), 3).then(function (res) {
        var out = [], ok = 0, failed = 0;
        res.forEach(function (g, k) {
          if (g === 'fail') { failed++; g = null; }
          if (g) ok++;
          var part = g || chunks[k];
          out = out.concat(out.length ? part.slice(1) : part);
        });
        snapped[id] = ok > 0 && out.length > 1 ? out : null;
        if (!failed) idb.put('files', key, { d: snapped[id] || [], t: Date.now() });
        snapStats = { done: (snapStats.done || 0) + 1, last: ok + '/' + chunks.length + ' pieces snapped' };
        timings.snap = Math.round(performance.now() - t0) + ' ms (' + ok + '/' + chunks.length + ' pieces)';
        return snapped[id];
      });
    }).then(function (r) {
      delete snapping[id];
      renderDiag();
      return r;
    });
    return snapping[id];
  }
  var snapStats = {};

  // The part of the route still ahead, and how far along the route the vehicle is.
  // When the line passes the same street twice, the vehicle's heading picks the right direction.
  function remainingPath(m, lat, lon, bearing) {
    var pts = m.pts, here = [lat, lon], best = 0, bestD = Infinity, ds = [], i;
    for (i = 0; i < pts.length; i++) { var dd = distM(here, pts[i]); ds.push(dd); if (dd < bestD) { bestD = dd; best = i; } }
    if (typeof bearing === 'number' && pts.length > 1) {
      var bestScore = Infinity;
      for (i = 0; i < pts.length - 1; i++) {
        if (ds[i] > bestD + 80) continue;
        var score = angleDiff(m.bear[i], bearing) + ds[i] / 10;
        if (score < bestScore) { bestScore = score; best = i; }
      }
    }
    var path = [here];
    for (i = best + 1; i < pts.length; i++) path.push(pts[i]);
    var along = best + 1 < pts.length
      ? Math.max(m.cum[best], m.cum[best + 1] - distM(here, pts[best + 1]))
      : m.total;
    return { path: path, along: along };
  }

