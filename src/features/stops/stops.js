  // ---------- Stops ----------
  // All stops show as small white dots from zoom 16. A tracked vehicle's upcoming stops show at any
  // zoom, ringed in its colour, with its arrival time. Any stop's popup lists the live vehicles heading
  // there; tapping one tracks it and centers the map on it.
  var STOP_ZOOM = 16;
  map.createPane('stopPane').style.zIndex = 590;   // above the route line, under vehicle labels
  var stops = {};                 // stop_id -> { id, name, code, lat, lon, station }
  var stopMarkers = {};           // general stop markers on the map right now
  var stopLayer = L.layerGroup().addTo(map);
  var routeStopLayer = L.layerGroup().addTo(map);
  var routeStopMarkers = {}, routeStops = [];
  var tuByTrip = {}, stopIndex = {}, tripToVeh = {}, vehByLabel = {}, tuSample = '', tuStats = null;
  var tripStopsCache = {}, tripStopsLoading = {};

  function etaPhrase(ms) {
    var min = Math.round((ms - Date.now()) / 60000);
    var clock = new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return (min <= 0 ? 'now' : 'in ' + min + ' min') + ' · ' + clock;
  }
  function gtfsSec(x) {
    var p = String(x || '').trim().split(':');
    return p.length === 3 ? (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]) : null;
  }
  // GTFS times count from "noon minus 12 h" of the service day (keeps DST days right)
  function serviceBase(tid) {
    var sd = (tuByTrip[tid] && tuByTrip[tid].startDate) || '', d = new Date();
    if (/^\d{8}$/.test(sd)) d = new Date(+sd.slice(0, 4), +sd.slice(4, 6) - 1, +sd.slice(6, 8));
    else if (ttTripDay(tid) === -1) d.setDate(d.getDate() - 1);   // v92: yesterday's trip still running after midnight
    d.setHours(12, 0, 0, 0);
    return d.getTime() - 12 * 3600 * 1000;
  }

  // The trip's stops and timetable, read from stop_times.txt (large) by streaming through it,
  // only for the trip that was tapped, then cached.
  // v92: answered from today's timetable index when it's ready (complete, instant); the streaming read
  // below is only used before that (its early stop can cut a trip short, see "today's timetable").
  function loadTripStops(tid) {
    var c = tripStopsCache[tid];
    if (!(c && c._tt)) { var x = ttTripStops(tid); if (x) { tripStopsCache[tid] = x; return Promise.resolve(x); } }
    if (c) return Promise.resolve(c);
    if (tripStopsLoading[tid]) return tripStopsLoading[tid];
    var hits = staticZip ? staticZip.file(/(^|\/)stop_times\.txt$/i) : [];
    if (!hits.length) return Promise.resolve(null);
    tripStopsLoading[tid] = new Promise(function (resolve) {
      var head = null, iTrip, iStop, iSeq, iArr, iDep, rest = '', out = [], misses = 0, done = false, helper;
      function finish() {
        if (done) return;
        done = true;
        try { helper.pause(); } catch (e) {}
        out.sort(function (a, b) { return a.seq - b.seq; });
        tripStopsCache[tid] = out;
        delete tripStopsLoading[tid];
        resolve(out);
      }
      function line(l) {
        if (done) return;
        if (l.charCodeAt(l.length - 1) === 13) l = l.slice(0, -1);
        if (!head) {
          head = l.replace(/^﻿/, '').split(',').map(function (h) { return h.trim().replace(/"/g, ''); });
          iTrip = head.indexOf('trip_id'); iStop = head.indexOf('stop_id'); iSeq = head.indexOf('stop_sequence');
          iArr = head.indexOf('arrival_time'); iDep = head.indexOf('departure_time');
          return;
        }
        if (l.indexOf(tid) !== -1) {
          var c = l.split(',');
          if (c[iTrip].replace(/"/g, '') === tid) {
            out.push({ stopId: c[iStop].replace(/"/g, ''), seq: +c[iSeq], arr: gtfsSec(c[iArr] || c[iDep]) });
            misses = 0;
            return;
          }
        }
        // the file is grouped by trip: once this trip's rows are behind us, stop reading
        if (out.length && ++misses > 5000) finish();
      }
      try {
        helper = hits[0].internalStream('string')
          .on('data', function (chunk) {
            var parts = (rest + chunk).split('\n');
            rest = parts.pop();
            for (var i = 0; i < parts.length && !done; i++) line(parts[i]);
          })
          .on('end', function () { if (rest) line(rest); finish(); })
          .on('error', function (e) { console.warn('stop_times failed:', e); finish(); });
        helper.resume();
      } catch (e) { console.warn('stop_times failed:', e); finish(); }
    });
    return tripStopsLoading[tid];
  }

  // Upcoming stops of the tracked vehicle with arrival times. Live times from the feed win;
  // otherwise timetable + the latest known delay; otherwise timetable only (marked "scheduled").
  function computeRouteStops(v) {
    var tid = v.d.tripRef, list = tripStopsCache[tid], tu = tuByTrip[tid], now = Date.now(), out = [];
    var byStop = {}, bySeq = {};
    if (tu) tu.stus.forEach(function (x) { if (x.stopId) byStop[x.stopId] = x; if (x.seq !== null) bySeq[x.seq] = x; });
    if (list && list.length) {
      var base = serviceBase(tid), delay = tu ? tu.delay : null;
      list.forEach(function (st) {
        var u = byStop[st.stopId] || bySeq[st.seq];
        var sched = st.arr !== null ? base + st.arr * 1000 : null, eta = null, rt = false;
        if (u && u.skipped) return;
        if (u && u.t) { eta = u.t; rt = true; if (sched) delay = (u.t - sched) / 1000; }
        else if (u && u.delay !== null && sched) { delay = u.delay; eta = sched + delay * 1000; rt = true; }
        else if (sched) { eta = sched + (delay !== null ? delay * 1000 : 0); rt = delay !== null; }
        if (eta && stops[st.stopId]) out.push({ stop: stops[st.stopId], eta: eta, realtime: rt, seq: st.seq });
      });
    } else if (tu) {
      tu.stus.forEach(function (x) {
        if (!x.skipped && x.t && stops[x.stopId]) out.push({ stop: stops[x.stopId], eta: x.t, realtime: true, seq: x.seq });
      });
    }
    var cur = v.d.curSeq;
    return out.filter(function (r) {
      if (cur && r.seq !== null && r.seq < cur) return false;   // already passed
      return r.eta >= now - 60000;
    });
  }

  // Where a stop sits along the route (metres from the start), searching only after minS so
  // stops are placed in driving order even where the route passes the same street twice
  function stopAlong(m, st, minS) {
    if (minS === 0) {
      if (!m._stopDist) m._stopDist = {};
      if (m._stopDist[st.id] !== undefined) return m._stopDist[st.id];
    }
    var pts = m.pts, R = 6371000 * Math.PI / 180, cosLat = Math.cos(toRad(st.lat)), best = null, bestD = 80;
    for (var i = 0; i < pts.length - 1; i++) {
      if (m.cum[i + 1] < minS) continue;
      var a = pts[i], b = pts[i + 1];
      var ax = (a[1] - st.lon) * cosLat * R, ay = (a[0] - st.lat) * R, bx = (b[1] - st.lon) * cosLat * R, by = (b[0] - st.lat) * R;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      var px = ax + dx * t, py = ay + dy * t, dist = Math.sqrt(px * px + py * py), sAt = m.cum[i] + t * Math.sqrt(len2);
      if (sAt >= minS && dist < bestD) { bestD = dist; best = sAt; }
    }
    if (minS === 0) m._stopDist[st.id] = best;
    return best;
  }
  function vehicleAlong(v) {
    if (!flow) return null;
    if (v.mo && v.mo.kind === 'route' && v.mo.m === flow.m && typeof v.along === 'number') return v.along;
    return flow.along;
  }
  // Called many times a second while tracking: a stop the icon has just driven past turns back to normal
  function checkPassedStops() {
    if (!selected || !routeStops.length) return;
    var along = vehicleAlong(selected);
    if (along === null) return;
    if (routeStops.some(function (r) { return typeof r.sAlong === 'number' && r.sAlong < along - 10; })) drawRouteStops();
  }

  function drawRouteStops() {
    if (!selected) return;
    routeStops = computeRouteStops(selected);
    // drop stops the icon has already driven past (by position along the route, not just by the timetable)
    var along = vehicleAlong(selected);
    if (flow && along !== null) {
      var minS = along - 60;
      routeStops.forEach(function (r) {
        r.sAlong = stopAlong(flow.m, r.stop, minS);
        if (typeof r.sAlong === 'number') minS = r.sAlong - 30;
        else {
          // not found ahead: if it lies on the part of the route already driven, it's been passed
          var back = stopAlong(flow.m, r.stop, 0);
          if (typeof back === 'number' && back < along - 10) r.sAlong = back;
        }
      });
      routeStops = routeStops.filter(function (r) { return typeof r.sAlong !== 'number' || r.sAlong >= along - 10; });
    }
    var keep = {}, color = selected.d.color;
    routeStops.forEach(function (r) {
      var id = r.stop.id, mk = routeStopMarkers[id];
      keep[id] = true;
      if (!mk) {
        if (focusedStop && focusedStop.id === id) return;   // the green "your stop" marker shows it
        mk = routeStopMarkers[id] = stopMarker(r.stop, 'route', color, 500);
        mk._color = color;
        routeStopLayer.addLayer(mk);
      } else {
        if (mk._color !== color) { mk._color = color; mk.setIcon(stopIcon('route', color)); if (mk.isPopupOpen()) markSel(mk, true); }
      }
      if (stopMarkers[id]) { stopLayer.removeLayer(stopMarkers[id]); delete stopMarkers[id]; }
    });
    Object.keys(routeStopMarkers).forEach(function (id) {
      if (!keep[id]) { routeStopLayer.removeLayer(routeStopMarkers[id]); delete routeStopMarkers[id]; }
    });
    renderStops();
    showTracking(selected);
    refreshStopViews();
    refreshVehPopup(selected);   // next stop / your stop in the vehicle popup
  }

