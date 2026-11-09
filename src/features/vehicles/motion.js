  // ---------- Continuous movement ----------
  // Vehicles don't jump or glide-and-wait between reports. Each report plans a constant-speed
  // move along the vehicle's route that lasts until the next report is expected: from where the
  // icon is now, to where the vehicle should be by then (last report + its speed × time,
  // corrected for how old the report already is). The next report corrects the plan smoothly.
  var feedInterval = 10000;   // measured time between new reports (ms)
  var lastNewDataAt = 0;

  function syncMarkerPosition(marker, pos, tolerance) {
    var ll = marker.getLatLng();
    if (ll.lat === pos[0] && ll.lng === pos[1]) return;
    if (tolerance && Math.abs(ll.lng - pos[1]) < tolerance.lng && Math.abs(ll.lat - pos[0]) < tolerance.lat) return;
    marker.setLatLng(pos);
  }
  function setPos(v, lat, lon, tolerance) {
    if (!v.pos) v.pos = [lat, lon];
    else { v.pos[0] = lat; v.pos[1] = lon; }
    if (view3d.on) return;   // v100: the 2D map is hidden; its markers are put back on v.pos when 3D closes
    if (v.dotInMap) syncMarkerPosition(v.dot, v.pos, tolerance);
    if (v.pillInMap) syncMarkerPosition(v.pill, v.pos, tolerance);
    if (hoverV === v) hoverTip.setLatLng(v.pos);
  }
  function routeMetaFor(d) {
    if (d.metroPlan) return d.metroPlan.m;
    var info = trips[d.tripRef];
    if (!shapes || !info || !info.shape_id || !shapes[info.shape_id] || shapes[info.shape_id].length < 2) return null;
    return tripShapeMeta(info);
  }
  // Closest point on the route (to the segment, not just a vertex). The vehicle's heading and its
  // previous position along the route break ties where the route passes the same street twice.
  function projectAlong(m, lat, lon, bearing, prevS) {
    var pts = m.pts, R = 6371000 * Math.PI / 180, cosLat = Math.cos(toRad(lat));
    var best = null, bestScore = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var ax = (a[1] - lon) * cosLat * R, ay = (a[0] - lat) * R, bx = (b[1] - lon) * cosLat * R, by = (b[0] - lat) * R;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var px = ax + dx * t, py = ay + dy * t, dist = Math.sqrt(px * px + py * py);
      if (dist > 150) continue;
      var sAt = m.cum[i] + t * (m.cum[i + 1] - m.cum[i]);
      var score = dist;
      if (typeof bearing === 'number' && len2 > 1) score += angleDiff(m.bear[i], bearing) * 0.5;
      if (typeof prevS === 'number' && Math.abs(sAt - prevS) > 500) score += 100;
      if (score < bestScore) { bestScore = score; best = { s: sAt, dist: dist }; }
    }
    return best;
  }
  function speedMs(v, d, sRep) {
    var sp = typeof d.speed === 'number' ? d.speed / 3.6 : null;   // feed sends km/h
    if (sp === null && v.lastRep && typeof sRep === 'number' && d.ts && v.lastRep.ts && d.ts > v.lastRep.ts) {
      sp = Math.max(0, (sRep - v.lastRep.s) / (d.ts - v.lastRep.ts));  // estimated from the last two reports
    }
    sp = Math.min(sp || 0, 25);
    return sp < 0.8 ? 0 : sp;
  }

  var motionViewBounds = null, motionViewAt = 0;
  function getMotionBounds() {
    var now = Date.now();
    if (!motionViewBounds || now - motionViewAt > 200) {
      motionViewAt = now;
      var b = viewLBounds(0.6);
      motionViewBounds = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() };
    }
    return motionViewBounds;
  }

  function planMotion(v, isNew) {
    var d = v.d, now = Date.now();
    if (d.metroPlan) {
      v.mo = d.metroPlan;
      var pos = posAt(v, now);
      setPos(v, pos[0], pos[1]);
      return;
    }
    if (isNew || !v.pos) setPos(v, d.lat, d.lon);
    var cur = v.pos, dur = feedInterval * 1.15;
    if (distM(cur, [d.lat, d.lon]) > 1500) { setPos(v, d.lat, d.lon); v.mo = null; cur = v.pos; }   // far jump: teleport
    var mb = getMotionBounds();
    var curIn = cur && cur[0] >= mb.minLat && cur[0] <= mb.maxLat && cur[1] >= mb.minLon && cur[1] <= mb.maxLon;
    var repIn = d.lat >= mb.minLat && d.lat <= mb.maxLat && d.lon >= mb.minLon && d.lon <= mb.maxLon;
    var m = (v === selected || curIn || repIn) ? routeMetaFor(d) : null;
    var rep = m ? projectAlong(m, d.lat, d.lon, d.bearing, v.along) : null;
    if (rep && rep.dist < 60) {
      var age = d.ts ? Math.max(0, Math.min(60, now / 1000 - d.ts)) : 0;
      var sp = speedMs(v, d, rep.s);
      v.lastRep = { s: rep.s, ts: d.ts };
      var sNow = rep.s + sp * age;
      var sEnd = Math.min(m.total, rep.s + MOTION_MAX_AHEAD, sNow + sp * (dur / 1000) * 0.85);
      var here = (v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number')
        ? { s: v.along, dist: 0 } : projectAlong(m, cur[0], cur[1], d.bearing, rep.s);
      if (here && here.dist < 60 && Math.abs(here.s - sNow) < 400) {
        var s1 = sEnd;
        if (here.s > sEnd) {
          if (here.s - sEnd < 80) s1 = here.s;   // a little ahead: wait here rather than reverse
          else { v.mo = { kind: 'route', m: m, s0: here.s, s1: sEnd, t0: now, dur: 2000 }; return; }  // well ahead: ease back
        }
        // Smooth speed changes: the new move starts at the speed the icon has right now and blends
        // into the new average speed (instead of jumping to it), so there's no jolt at each report.
        var v0 = Math.max(0, velAt(v.mo, m, now));
        // a sudden slow-down: let it coast a little further (at most to 80 m past the vehicle, as above)
        // so it can brake smoothly instead of stopping dead
        if (s1 - here.s < v0 * dur / 3) s1 = Math.max(s1, Math.min(here.s + v0 * dur / 3, sEnd + 80));
        v.mo = { kind: 'route', m: m, s0: here.s, s1: s1, t0: now, dur: dur, v0: v0, v1: (s1 - here.s) / dur, smooth: true };
        return;
      }
      // icon is off the route: head straight for where the vehicle will be
      var target = pointAt(m, sEnd).ll;
      v.mo = { kind: 'line', a: cur.slice(), b: target, t0: now, dur: dur };
      return;
    }
    v.lastRep = null;
    // Spread a moving GPS-only fix across the measured feed interval. A
    // reported stop settles promptly, and neither case predicts beyond the fix.
    v.mo = { kind: 'line', a: cur.slice(), b: [d.lat, d.lon], t0: now, dur: d.speed === 0 ? 3000 : feedInterval };
  }

  // Where along the road a move is at moment k (0…1): a smooth curve from the start speed v0 to the
  // end speed v1 (m per ms), so consecutive moves join without a jump in speed
  function routeS(mo, k) {
    if (!mo.smooth) return mo.s0 + (mo.s1 - mo.s0) * k;   // constant speed
    var k2 = k * k, k3 = k2 * k;
    var s = (2 * k3 - 3 * k2 + 1) * mo.s0 + (k3 - 2 * k2 + k) * mo.dur * mo.v0 +
            (-2 * k3 + 3 * k2) * mo.s1 + (k3 - k2) * mo.dur * mo.v1;
    return Math.max(Math.min(mo.s0, mo.s1), Math.min(Math.max(mo.s0, mo.s1), s));   // never past either end
  }
  // A smooth move that ends before the next report arrives (the feed is irregular) doesn't stop dead:
  // the icon coasts on, slowing down gradually (speed halves every ~1 s), adding at most v1 × 1.5 s.
  var COAST_MS = 1500;
  function coastS(mo, now) {
    var x = now - mo.t0 - mo.dur;
    return Math.min(mo.m.total, mo.s1 + mo.v1 * COAST_MS * (1 - Math.exp(-x / COAST_MS)));
  }
  // The icon's current speed along the road (m per ms) in move mo, if it runs on route m
  function velAt(mo, m, now) {
    if (!mo || mo.kind !== 'route' || mo.m !== m) return 0;
    var k = (now - mo.t0) / mo.dur;
    if (k >= 1) return mo.smooth ? mo.v1 * Math.exp(-(now - mo.t0 - mo.dur) / COAST_MS) : 0;   // coasting / standing
    k = Math.max(0, k);
    if (!mo.smooth) return (mo.s1 - mo.s0) / mo.dur;
    var k2 = k * k;
    return ((6 * k2 - 6 * k) * mo.s0 + (3 * k2 - 4 * k + 1) * mo.dur * mo.v0 +
            (-6 * k2 + 6 * k) * mo.s1 + (3 * k2 - 2 * k) * mo.dur * mo.v1) / mo.dur;
  }
  function posAt(v, now) {
    var mo = v.mo;
    if (!mo) return null;
    var k = Math.max(0, Math.min(1, (now - mo.t0) / mo.dur));
    if (!v.pos) v.pos = [0, 0];
    if (mo.kind === 'route') {
      var sv = (mo.smooth && now - mo.t0 > mo.dur) ? coastS(mo, now) : routeS(mo, k);
      v.along = sv;
      return pointLL(mo.m, sv, v.pos);
    }
    v.along = null;
    v.pos[0] = mo.a[0] + (mo.b[0] - mo.a[0]) * k;
    v.pos[1] = mo.a[1] + (mo.b[1] - mo.a[1]) * k;
    return v.pos;
  }

  // One loop moves everything: on-screen vehicles every frame (or 20× a second when there are
  // very many), off-screen ones twice a second, and the tracked vehicle's route line with its icon.
  var lastFull = 0, lastBatch = 0, onScreenCount = 0;
  var viewBounds01 = null;
  // v100: what's on screen and the zoom, from whichever map is showing (the 3D map while it's open)
  function viewZoom() { return view3d.on && view3d.zoom ? view3d.zoom() : map.getZoom(); }
  function viewLBounds(pad) { return view3d.on && view3d.bounds ? view3d.bounds(pad || 0) : map.getBounds().pad(pad || 0); }
  function updateMotionViewBounds() {
    var b = viewLBounds(0.1);
    viewBounds01 = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() };
  }
  map.on('move resize viewreset zoomend', updateMotionViewBounds);

  function motionFrame(ts) {
    requestAnimationFrame(motionFrame);
    if (zooming) { lastFull = 0; pathSyncAt = 0; return; }   // catch up in full right after the zoom
    var now = Date.now();
    var full = now - lastFull > 500;
    if (!viewBounds01) updateMotionViewBounds();
    var minLat = viewBounds01.minLat, maxLat = viewBounds01.maxLat, minLon = viewBounds01.minLon, maxLon = viewBounds01.maxLon;
    // Ordinary markers are drawn at whole pixels. Accumulate fractional
    // movement against the displayed coordinate, then catch up on full ticks.
    var halfPixel = 180 / (256 * Math.pow(2, map.getZoom()));
    var tolerance = { lng: halfPixel, lat: halfPixel * Math.cos(toRad((minLat + maxLat) / 2)) };
    var count = 0;
    var interval = view3d.on ? 1000 / VIEW3D_VEH_HZ : onScreenCount < 150 ? 0 : 50;
    var batch = ts - lastBatch >= interval;
    if (batch) lastBatch = ts;
    if (full) lastFull = now;
    for (var k in vehicles) {
      var v = vehicles[k];
      if (!v.mo || !v.pos) continue;
      var lat = v.pos[0], lon = v.pos[1];
      var vis = lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
      if (vis) count++;
      if (v === selected || (vis && batch) || full) {
        var p = posAt(v, now);
        if (p) setPos(v, p[0], p[1], (full || v === selected || v === hoverV) ? null : tolerance);
      }
    }
    if (batch || full) onScreenCount = count;
    followFrame();
    locFrame();
    if (view3d.on) view3d.frame(now);
    if (selected) syncPath(selected);
    if (selected && now - lastPassCheck > 300) { lastPassCheck = now; checkPassedStops(); }
  }
  var lastPassCheck = 0;
  requestAnimationFrame(motionFrame);

  // Follow mode: the camera moves with the tracked vehicle every frame. (It used to start a 1-second
  // pan every second, aimed at where the vehicle was then: always a step behind, with a lurch each
  // second.) The map is shifted by exactly as many whole pixels as the icon moved, so the icon stays
  // still on screen and the map slides under it; the vector base map is redrawn in the same frame so
  // it never trails the icons. When follow starts, the view glides to the vehicle first.
  // Smart camera (look-ahead): the camera aims at a point on the vehicle's route a little ahead of it,
  // so the vehicle sits behind the middle of the view and most of the screen shows the road it is
  // about to drive. The point is taken along the route, so the view already leans into an upcoming
  // turn. The lean changes gently (eased over ~1.2 s), never swinging at corners; near the end of
  // the line it shrinks as the road runs out. Without a known route the vehicle's heading is used.
  var LOOK_AHEAD = 0.25;        // lead = this share of the free map area's smaller side, in screen pixels
  var LOOK_EASE_MS = 1200;      // how fast the lean follows a change of direction
  var lookOff = L.point(0, 0), lookAt = 0, lookFor = null;
  function lookAhead(v, w, h) {
    var lead = LOOK_AHEAD * Math.min(w, h), m = routeMetaFor(v.d), here = map.latLngToContainerPoint(v.pos), vec = null;
    if (m && v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number') {
      // a point along the road ahead (a bit further than the lead, since roads aren't straight)
      var ahead = pointAt(m, Math.min(m.total, v.along + lead * metersPerPixel(v.pos[0]) * 1.4)).ll;
      vec = map.latLngToContainerPoint(ahead).subtract(here);
    } else if (typeof v.d.bearing === 'number' && !v.parked) {
      var r = toRad(v.d.bearing);
      vec = L.point(Math.sin(r), -Math.cos(r)).multiplyBy(lead);
    }
    if (!vec) return L.point(0, 0);   // standing, direction unknown: centre it
    var len = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    return len > lead ? vec.multiplyBy(lead / len) : vec;
  }

