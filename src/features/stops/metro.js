  // Metro stations and stop times from the active service-day index, including overnight trips.
  var metroTimetable = (function () {
    var patterns = new Map();

    function index(x) {
      patterns.clear();
      x.patRoute.forEach(function (rid, p) {
        if (!routes[rid] || routes[rid].type !== 1) return;
        var start = x.patStopOff[p], end = x.patStopOff[p + 1];
        for (var i = start; i < end; i++) {
          var sid = x.stopIds[x.patStops[i]];
          if (!patterns.has(sid)) patterns.set(sid, []);
          patterns.get(sid).push({ p: p, rid: rid, offset: i - start, length: end - start });
        }
      });
    }

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
          out.push({ sid: sid, tripId: tid, t: tt.base + time * 1000, metroSchedule: true,
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
