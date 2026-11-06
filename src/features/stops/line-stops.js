  // ---------- Stops of searched lines ----------
  var searchStops = null, searchKey = '', searchLoading = false;   // stop_id -> line colour
  var searchRoutes = null;   // route_id -> true for the searched line(s); null when not searching
  function routeColor(rid) { var r = routes[rid] || {}; return (TYPES[r.type] ? null : r.color) || typeInfo(r.type).color; }
  function updateSearchStops(toks, matched) {
    if (!toks.length) {
      if (searchStops !== null) { searchStops = null; searchKey = ''; searchLoading = false; }
      searchRoutes = null;
      return;
    }
    // lines asked for: by line number, plus the lines of any vehicle that matched (e.g. by vehicle number)
    var ids = {};
    matched.forEach(function (v) { var info = trips[v.d.tripRef]; if (info) ids[info.route_id] = true; });
    Object.keys(routes).forEach(function (rid) {
      var r = routes[rid];
      if (toks.indexOf(String(r.short).toLowerCase()) !== -1 && (!TYPES[r.type] || activeTypes[r.type])) ids[rid] = true;
    });
    var rids = Object.keys(ids).sort(), key = rids.join('|');
    searchRoutes = {};
    rids.forEach(function (rid) { searchRoutes[rid] = true; });
    if (key === searchKey && searchStops !== null) return;
    searchKey = key;
    searchStops = {};   // hide every other stop straight away
    if (!rids.length) return;
    // one trip per route variant (shape) covers all its stops
    var reps = {}, tids = [], want = {};
    rids.forEach(function (rid) { want[rid] = true; });
    for (var tid in trips) {
      var t = trips[tid];
      if (!want[t.route_id]) continue;
      var variant = t.route_id + '|' + (t.shape_id || t.headsign);
      if (!reps[variant]) { reps[variant] = tid; tids.push(tid); }
    }
    searchLoading = true;
    loadTripsStops(tids.slice(0, 40)).then(function () {
      if (searchKey !== key) return;
      var out = {};
      tids.forEach(function (tid) {
        var color = routeColor(trips[tid].route_id);
        (tripStopsCache[tid] || []).forEach(function (x) { if (stops[x.stopId] && !out[x.stopId]) out[x.stopId] = color; });
      });
      searchStops = out;
      searchLoading = false;
      renderStops();
      render(false);
    });
  }

  // Several trips' stop lists in one pass through stop_times.txt (stops early once all are found)
  function loadTripsStops(tids) {
    tids.forEach(function (t) {   // v92: from today's timetable index where possible
      var c = tripStopsCache[t];
      if (!(c && c._tt)) { var x = ttTripStops(t); if (x) tripStopsCache[t] = x; }
    });
    var need = tids.filter(function (t) { return !tripStopsCache[t]; });
    var hits = staticZip ? staticZip.file(/(^|\/)stop_times\.txt$/i) : [];
    if (!need.length || !hits.length) return Promise.resolve();
    return new Promise(function (resolve) {
      var got = {}, left = need.length, head = null, iTrip, iStop, iSeq, iArr, iDep, rest = '', done = false, helper, lastTid = null;
      need.forEach(function (t) { got[t] = null; });
      function finish() {
        if (done) return;
        done = true;
        try { helper.pause(); } catch (e) {}
        need.forEach(function (t) {
          var arr = got[t] || [];
          arr.sort(function (a, b) { return a.seq - b.seq; });
          tripStopsCache[t] = arr;
        });
        resolve();
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
        var c = null, tid;
        if (iTrip === 0) tid = l.slice(0, l.indexOf(',')).replace(/"/g, '');
        else { c = l.split(','); tid = (c[iTrip] || '').replace(/"/g, ''); }
        if (tid !== lastTid) {
          // the file is grouped by trip: a wanted trip whose rows just ended is complete
          if (lastTid !== null && got[lastTid] && !got[lastTid].done) { got[lastTid].done = true; if (--left <= 0) { finish(); return; } }
          lastTid = tid;
        }
        if (!(tid in got)) return;
        c = c || l.split(',');
        if (!got[tid]) got[tid] = [];
        got[tid].push({ stopId: c[iStop].replace(/"/g, ''), seq: +c[iSeq], arr: gtfsSec(c[iArr] || c[iDep]) });
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
  }

