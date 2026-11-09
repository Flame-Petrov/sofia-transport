  // Metro stations and stop times from the active service-day index, including overnight trips.
  var metroTimetable = (function () {
    var patterns = new Map(), runs = [], paths = new Map(), active = new Set();

    function trainKey(x, inst, first) {
      return 'metro:' + x.tripIds[x.instTrip[inst]] + ':' + (x.base + first * 1000);
    }

    function index(x) {
      patterns.clear();
      runs = [];
      paths.clear();
      x.patRoute.forEach(function (rid, p) {
        if (!routes[rid] || routes[rid].type !== 1) return;
        var start = x.patStopOff[p], end = x.patStopOff[p + 1];
        var length = end - start;
        if (length >= 2) {
          for (var inst = x.patInstOff[p]; inst < x.patInstOff[p + 1]; inst++) {
            var t = x.patTimeOff[p] + (inst - x.patInstOff[p]) * length;
            runs.push({ p: p, rid: rid, t: t, length: length, start: start,
                        key: trainKey(x, inst, x.times[t]), tid: x.tripIds[x.instTrip[inst]] });
          }
        }
        for (var i = start; i < end; i++) {
          var sid = x.stopIds[x.patStops[i]];
          if (!patterns.has(sid)) patterns.set(sid, []);
          patterns.get(sid).push({ p: p, rid: rid, offset: i - start, length: end - start });
        }
      });
      updateTrains();
    }

    // Share station distances across all trains using the same pattern and directed shape.
    function pathFor(run) {
      var shape = (trips[run.tid] || {}).shape_id;
      var hasShape = shapes && shapes[shape] && shapes[shape].length >= 2;
      var key = run.p + '|' + (hasShape ? shape : '');
      if (paths.has(key)) return paths.get(key);
      var stations = [];
      for (var i = 0; i < run.length; i++) stations.push(stops[tt.stopIds[tt.patStops[run.start + i]]]);
      var path = null;
      if (stations.every(Boolean)) {
        var m = hasShape && tripShapeMeta(trips[run.tid]), distances = [], last = 0;
        if (m) {
          for (var j = 0; j < stations.length; j++) {
            var s = stopAlong(m, stations[j], last);
            if (s === null) break;
            last = Math.min(s, m.total);
            distances.push(last);
          }
        }
        if (distances.length !== stations.length) {
          m = smoothMetroShape(pathMeta(stations.map(function (st) { return [st.lat, st.lon]; })));
          last = 0;
          distances = stations.map(function (st, index) {
            var position = projectAlong(m, st.lat, st.lon, null, last);
            if (position) last = Math.max(last, position.s);
            return index === stations.length - 1 ? m.total : last;
          });
        }
        path = { m: m, distances: distances };
      }
      paths.set(key, path);
      return path;
    }

    function updateTrains() {
      if (!tt || document.hidden) return;
      var now = Date.now(), sec = (now - tt.base) / 1000, next = new Set(), changed = false;
      runs.forEach(function (run) {
        var t = run.t, last = run.length - 1;
        if (sec < tt.times[t] || sec >= tt.times[t + last] || tripToVeh[run.tid]) return;
        var path = pathFor(run);
        if (!path) return;
        var i = 0;
        while (i + 1 < last && tt.times[t + i + 1] <= sec) i++;
        var v = vehicles[run.key], start = tt.base + tt.times[t + i] * 1000;
        var dur = (tt.times[t + i + 1] - tt.times[t + i]) * 1000;
        if (dur <= 0) return;
        next.add(run.key);
        if (v && v.d.metroRun === run && v.mo.t0 === start && v.mo.m === path.m) {
          v.d.lat = v.pos[0]; v.d.lon = v.pos[1];
          return;
        }
        var plan = { kind: 'route', m: path.m, s0: path.distances[i], s1: path.distances[i + 1], t0: start, dur: dur };
        var pos = pointAt(path.m, routeS(plan, (now - start) / dur));
        var line = routes[run.rid].short;
        upsert({ key: run.key, type: 1, routeId: run.rid, tripId: run.tid, tripRef: run.tid,
                 metroPlan: plan, metroRun: run, headsign: (trips[run.tid] || {}).headsign, line: line, shown: line,
                 hasLine: true, inRoutes: true, via: 'timetable', label: '', plate: '', color: routeColor(run.rid),
                 lat: pos.ll[0], lon: pos.ll[1], bearing: pos.deg, curSeq: tt.patSeqs[run.start + i + 1], ts: 0 });
        if (v && v === selected) { drawPath(v); drawRouteStops(); }
        changed = true;
      });
      active.forEach(function (key) {
        if (next.has(key)) return;
        var v = vehicles[key];
        if (v === selected) {
          if (following) setFollow(false);
          if (view3d.on && view3d.popOf() === v) view3d.closePop();
          deselect();
        }
        if (v === hoverV) hideHover();
        dotLayer.removeLayer(v.dot);
        if (v.pill) pillLayer.removeLayer(v.pill);
        delete vehicles[key];
        changed = true;
      });
      active = next;
      if (changed) { render(false); refreshStopViews(); }
    }

    setInterval(updateTrains, 1000);
    document.addEventListener('visibilitychange', updateTrains);

    function serves(sid, routeFilter) {
      var parts = patterns.get(sid);
      return !!parts && (!routeFilter || parts.some(function (part) { return routeFilter[part.rid]; }));
    }

    function upcoming(sid, now, routeFilter) {
      var out = [], parts = patterns.get(sid);
      if (!parts) return out;
      var sec = (now - tt.base) / 1000;
      parts.forEach(function (part) {
        if (routeFilter && !routeFilter[part.rid]) return;
        var p = part.p, start = tt.patInstOff[p], end = tt.patInstOff[p + 1];
        var first = tt.patTimeOff[p] + part.offset, lo = 0, hi = end - start;
        while (lo < hi) {
          var mid = (lo + hi) >> 1;
          if (tt.times[first + mid * part.length] < sec) lo = mid + 1;
          else hi = mid;
        }
        for (var i = lo; start + i < end; i++) {
          var time = tt.times[first + i * part.length];
          if (time > sec + 3600) break;
          var tid = tt.tripIds[tt.instTrip[start + i]];
          var key = trainKey(tt, start + i, tt.times[first - part.offset + i * part.length]);
          out.push({ sid: sid, key: active.has(key) ? key : null, tripId: tid, t: tt.base + time * 1000, metroSchedule: true,
                     terminates: part.offset === part.length - 1 });
        }
      });
      return out;
    }

    return { index: index, serves: serves, stationIds: function () { return patterns.keys(); }, upcoming: upcoming };
  })();

  // Offline timetables still count down when the live feed stalls.
  setInterval(function () {
    if (!document.hidden && (openStopMk || sheetStop || (view3d.on && view3d.popStop && view3d.popStop()))) refreshStopViews();
  }, 15000);
