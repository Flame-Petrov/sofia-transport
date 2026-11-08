  var followEndAt = 0, glMoved = false, camPanned = 0;
  var MOVEEND_SHARE = 0.05, MOVEEND_MAX_MS = 2000;   // v90: see camStep
  // One camera step of a following camera (vehicle Follow, your location): the map slides by fractions of a
  // pixel. v89: the vector map is drawn right away only when the plugin actually re-centred it in this step
  // (about every other frame); in between, its canvas just slides along with the map, nothing to redraw.
  // Before, it was redrawn every frame (~2× the drawing for the same picture).
  // v90: the "offset decay" lock (feed-forward, from the research report): each frame the camera moves by
  // exactly the subject's own motion, and only the gap left over from a start, a switch, a zoom, a drag or a
  // flight (st.off) shrinks, by exp(−dt/τ) — the same feel at 30, 60 or 120 frames a second. No lag behind
  // a moving subject and nothing to snap at the end. Before: 12 % of the gap per frame (τ 130 ms at 60 Hz,
  // 65 ms at 120 Hz, 261 ms at 30 Hz), then a jump of up to 3 px once within 3 px.
  var FOLLOW_TAU = 130;   // ms
  var followCam = { off: null }, locCam = { off: null, at: 0, rest: false };
  function lockCam(st, icon, target, dt, tau) {
    var gap = icon.subtract(target);
    if (!st.off || reduceMotion) st.off = reduceMotion ? L.point(0, 0) : gap;
    st.off = st.off.multiplyBy(Math.exp(-dt / tau));
    if (Math.abs(st.off.x) < 0.005 && Math.abs(st.off.y) < 0.005) st.off = L.point(0, 0);
    var step = gap.subtract(st.off);
    if (Math.abs(step.x) < 0.005 && Math.abs(step.y) < 0.005) return;
    camStep(step);
  }
  map.on('zoomend', function () { followCam.off = null; locCam.off = null; });
  function camStep(step) {
    map._rawPanBy(step);
    map.fire('move');
    // 'moveend' re-centres the drawing layers (the canvas is reallocated and every route and dot redrawn) and
    // refreshes labels and stops in view. v90: once the map has slid 5 % of the screen (the canvas has 10 %
    // to spare on each side), or every 2 s while it moves — before, every 0.5 s even when it had moved 1 px.
    camPanned += Math.abs(step.x) + Math.abs(step.y);
    var now = Date.now(), size = map.getSize();
    if (camPanned >= MOVEEND_SHARE * Math.min(size.x, size.y) || now - followEndAt > MOVEEND_MAX_MS) {
      followEndAt = now; camPanned = 0; map.fire('moveend');
    }
    // after both: either can re-centre the vector map, and it must be drawn in this same frame
    if (glMoved && glLayer && glLayer._glMap) {
      glMoved = false;
      try { glLayer._glMap.redraw(); } catch (e) {}
    }
  }
  // Leaflet's latLngToLayerPoint rounds to whole pixels; the follow camera needs the exact position
  function exactLayerPoint(ll) { return map.project(ll).subtract(map.getPixelOrigin()); }
  function followFrame() {
    if (view3d.on) { followCam.off = null; return; }   // v100: the 3D map has its own camera
    if (!following || followHold || (map._panAnim && map._panAnim._inProgress) || !selected || !selected.pos || zooming || map._animatingZoom ||
        (map.dragging && map.dragging.moving())) { followCam.off = null; return; }
    var size = map.getSize(), top = freeTop(), bottom = freeBottom(), room = vpCardRoom();   // phones: between the panel and the sheet
    if (room) bottom = vpFreeBottom();   // v100: the vehicle with its card below it
    // ease the lean towards the look-ahead direction (starts centred for a newly followed vehicle)
    var t = performance.now(), dt = lookAt ? Math.min(100, t - lookAt) : 16;
    lookAt = t;
    if (lookFor !== selected) { lookFor = selected; lookOff = L.point(0, 0); followCam.off = null; }
    lookOff = lookOff.add(lookAhead(selected, size.x, Math.max(0, bottom - top - room)).subtract(lookOff).multiplyBy(1 - Math.exp(-dt / LOOK_EASE_MS)));
    var centre = L.point(size.x / 2, room ? vpTargetY(bottom) : top + (bottom - top) / 2);   // middle of the free map area
    var target = centre.subtract(lookOff);                        // the vehicle sits behind it, the road ahead in view
    // The map glides by fractions of a pixel (moving it only in whole pixels made the whole map, and every
    // icon on it, tick 1 px about 10 times a second at street zoom). The vehicle lands exactly on target.
    var icon = exactLayerPoint(selected.pos).add(map._getMapPanePos());   // where the vehicle is on screen
    lockCam(followCam, icon, target, dt, FOLLOW_TAU);
  }

  // v89: your location, kept in view the same way: every frame, the camera locks on to the dot as it glides
  // between GPS readings (glideMe). Before, each reading (~1 per second) started a 0.8 s pan to it and the dot
  // jumped: stop-and-go (the camera stood still in ~36 % of frames, measured) with a jump each second.
  function locFrame() {
    if ((loc.state !== 'on' && loc.state !== 'wait') || !loc.show || !loc.marker) return;
    var sh = loc.show, now = performance.now();
    if (sh.dur && sh.ll !== sh.to) {
      var k = Math.min(1, (now - sh.t0) / sh.dur);
      sh.ll = k >= 1 ? sh.to : L.latLng(sh.from.lat + (sh.to.lat - sh.from.lat) * k, sh.from.lng + (sh.to.lng - sh.from.lng) * k);
      loc.marker.setLatLng(sh.ll);
      if (loc.acc) loc.acc.setLatLng(sh.ll);
    }
    if (view3d.on) { locCam.off = null; locCam.at = 0; return; }   // v100: the glide above feeds the 3D dot; its camera is the 3D map's
    if (!loc.follow || following || loc.camHold || zooming || map._animatingZoom || (map.dragging && map.dragging.moving())) {
      locCam.off = null; locCam.at = 0; return;
    }
    var dt = locCam.at ? Math.min(100, now - locCam.at) : 16;
    locCam.at = now;
    var size = map.getSize(), top = freeTop(), bottom = freeBottom();
    var target = L.point(size.x / 2, top + (bottom - top) / 2);   // middle of the free map area
    var icon = exactLayerPoint(sh.ll).add(map._getMapPanePos()), gap = icon.subtract(target);
    // v90: moving (≥ 1 m/s): locked like a vehicle. Standing: GPS wanders a few metres, so the camera rests
    // while the dot stays within ME_DEAD_PX of the middle, and only re-centres (gently) once it leaves.
    if (meSpeed() >= 1) { locCam.rest = false; lockCam(locCam, icon, target, dt, ME_TAU); return; }
    locCam.off = null;
    var dist = Math.sqrt(gap.x * gap.x + gap.y * gap.y);
    if (locCam.rest && dist <= ME_DEAD_PX) return;
    locCam.rest = dist < 0.5;
    if (!locCam.rest) camStep(gap.multiplyBy(1 - Math.exp(-dt / ME_RECENTRE_MS)));
  }
  var ME_TAU = 300, ME_DEAD_PX = 24, ME_RECENTRE_MS = 500;
  // walking pace or faster? The phone's own speed when it gives one, else the last ~6 s of readings
  // (only when they moved further than the reading's accuracy, so standing still with a wandering GPS is 0)
  function meSpeed() {
    var f = loc.fix;
    if (!f) return 0;
    if (typeof f.speed === 'number' && f.speed >= 0 && !isNaN(f.speed)) return f.speed;
    var h = loc.hist;
    if (!h || h.length < 2) return 0;
    var a = h[0], b = h[h.length - 1], d = a.ll.distanceTo(b.ll), sec = (b.t - a.t) / 1000;
    return sec > 0 && d > Math.max(10, f.acc || 0) ? d / sec : 0;
  }

