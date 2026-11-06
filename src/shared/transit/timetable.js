  // ---------- v92: today's timetable, indexed once a day ----------
  // The route search (v93) needs every trip that runs today, by stop and in driving order. stop_times.txt
  // (40 MB, ~650,000 rows) is streamed once a day in the background into compact arrays (~2 MB), saved in
  // IndexedDB ('files' → 'tt'), so later openings that day load it at once.
  // Which trips run: calendar_dates.txt (Sofia has no calendar.txt; it is read too when present).
  // Found while planning (5 Nov 2026): 3,530 trips have their rows in 2–8 separate blocks of stop_times.txt,
  // up to ~198,000 lines apart. loadTripStops stopped 5,000 lines after a trip's rows ended and
  // loadTripsStops at the end of a trip's first block, so those trips' stop lists could be cut short.
  // The index collects every row of a trip wherever it is, and both readers now answer from it.
  // Layout (for RAPTOR): every stop has an index; a pattern is one line's exact stop sequence; its trips,
  // sorted by departure and never overtaking each other (else they go to a second pattern), are rows of a
  // times matrix in seconds from today's "noon − 12 h". Yesterday's trips running past midnight are in it
  // too (their times shifted by a day).
  var TT_VER = 1;
  var tt = null, ttBusy = null, ttInfo = { state: '', ms: 0, from: '', err: '' };
  var ttFirst = {}, ttInstPat = null, ttStopIx = {}, ttByTrip = {};   // derived when the index is put to use (not saved)
  function ymd(d) { return '' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  function noonMinus12(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() - 12 * 3600e3; }
  function zipEntry(name) {
    var h = staticZip ? staticZip.file(new RegExp('(^|/)' + name.replace('.', '\\.') + '$', 'i')) : [];
    return h.length ? h[0] : null;
  }
  function zipId() {   // which schedule the index was built from
    var e = zipEntry('stop_times.txt');
    return e ? (e.date ? e.date.getTime() : 0) + ':' + ((e._data && e._data.uncompressedSize) || 0) : '';
  }
  // Every line of a file in the zip, streamed (no 40 MB string in memory), pausing every ~12 ms so the
  // page keeps drawing frames
  function zipLines(name, onLine) {
    var e = zipEntry(name);
    if (!e) return Promise.resolve(false);
    return new Promise(function (resolve, reject) {
      var rest = '', helper, t0 = performance.now(), first = true;
      function emit(l) {
        if (l.charCodeAt(l.length - 1) === 13) l = l.slice(0, -1);
        if (first) { first = false; if (l.charCodeAt(0) === 0xFEFF) l = l.slice(1); }
        onLine(l);
      }
      try {
        helper = e.internalStream('string')
          .on('data', function (chunk) {
            var parts = (rest + chunk).split('\n');
            rest = parts.pop();
            for (var i = 0; i < parts.length; i++) emit(parts[i]);
            if (performance.now() - t0 > 12) {
              helper.pause();
              setTimeout(function () { t0 = performance.now(); helper.resume(); }, 0);
            }
          })
          .on('end', function () { if (rest) emit(rest); resolve(true); })
          .on('error', reject);
        helper.resume();
      } catch (err) { reject(err); }
    });
  }
  // fn(i) for every i < n, in slices of ~12 ms with a pause between them (the page keeps drawing)
  function inSlices(n, fn) {
    return new Promise(function (resolve) {
      var i = 0;
      (function step() {
        var t0 = performance.now();
        while (i < n && performance.now() - t0 < 12) fn(i++);
        if (i < n) setTimeout(step, 0); else resolve();
      })();
    });
  }
  function csvHead(l) { return l.split(',').map(function (h) { return h.trim().replace(/"/g, ''); }); }
  function hmsSec(s) {   // "HH:MM:SS" (hours may pass 24) → seconds; -1 when empty
    s = s.trim();
    var a = s.indexOf(':'), b = s.indexOf(':', a + 1);
    return a < 0 || b < 0 ? -1 : (+s.slice(0, a)) * 3600 + (+s.slice(a + 1, b)) * 60 + (+s.slice(b + 1));
  }

  // how long each step of the build took (Diagnostics → Copy report)
  var ttMarkAt = 0;
  function ttMark(name) {
    var now = performance.now();
    if (!name) ttInfo.phases = [];
    else ttInfo.phases.push(name + ' ' + Math.round(now - ttMarkAt));
    ttMarkAt = now;
  }
  function ttBuild(T, id) {
    var now = new Date(), yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), Y = ymd(yd);
    var baseT = noonMinus12(now), offY = Math.round((noonMinus12(yd) - baseT) / 1000);   // ≈ −86,400 (DST-safe)
    var act = {}; act[Y] = {}; act[T] = {};
    var head = null, rowsRead = 0;
    var wk = [Y, T].map(function (d) { return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)).getDay()]; });
    // 1) which services run yesterday and today
    ttMark('');
    return zipLines('calendar.txt', function (l) {
      if (!head) { head = csvHead(l); return; }
      var c = l.split(','), r = {};
      head.forEach(function (h, i) { r[h] = (c[i] || '').trim(); });
      [Y, T].forEach(function (d, i) { if (r[wk[i]] === '1' && r.start_date <= d && d <= r.end_date) act[d][r.service_id] = true; });
    }).then(function () {
      head = null;
      var iS, iD, iE;
      return zipLines('calendar_dates.txt', function (l) {
        if (!head) { head = csvHead(l); iS = head.indexOf('service_id'); iD = head.indexOf('date'); iE = head.indexOf('exception_type'); return; }
        var c = l.split(','), d = (c[iD] || '').trim();
        if (d !== Y && d !== T) return;
        act[d][(c[iS] || '').trim()] = (c[iE] || '').trim() === '1';   // 1 added, 2 removed
      });
    }).then(function () {
      ttMark('calendar');
      // 2) the trips that run (bit 1 = yesterday, 2 = today)
      var tripIx = {}, tripIds = [], mask = [];
      Object.keys(trips).forEach(function (tid) {
        var s = trips[tid].sid, m = (act[Y][s] ? 1 : 0) | (act[T][s] ? 2 : 0);
        if (m) { tripIx[tid] = tripIds.length; tripIds.push(tid); mask.push(m); }
      });
      // 3) their rows of stop_times.txt, wherever they are in the file
      var sIds = Object.keys(stops), sIx = {};
      sIds.forEach(function (s, i) { sIx[s] = i; });
      var cap = 1 << 19, n = 0, rT = new Int32Array(cap), rQ = new Int32Array(cap), rS = new Int32Array(cap), rA = new Int32Array(cap);
      function bigger(a) { var b = new Int32Array(cap); b.set(a); return b; }
      function grow() { cap *= 2; rT = bigger(rT); rQ = bigger(rQ); rS = bigger(rS); rA = bigger(rA); }
      var iT, iA, iDp, iSt, iQ;
      head = null;
      return zipLines('stop_times.txt', function (l) {
        if (!head) {
          head = csvHead(l);
          iT = head.indexOf('trip_id'); iA = head.indexOf('arrival_time'); iDp = head.indexOf('departure_time');
          iSt = head.indexOf('stop_id'); iQ = head.indexOf('stop_sequence');
          return;
        }
        rowsRead++;
        var k;
        if (iT === 0) {   // fast path: skip rows of other days without splitting them
          var c0 = l.indexOf(','), t0 = c0 < 0 ? l : l.slice(0, c0);
          if (t0.charCodeAt(0) === 34) t0 = t0.replace(/"/g, '');
          k = tripIx[t0];
          if (k === undefined) return;
        }
        var c = l.split(',');
        if (iT !== 0) { k = tripIx[(c[iT] || '').replace(/"/g, '').trim()]; if (k === undefined) return; }
        var sid = (c[iSt] || '').replace(/"/g, '').trim(), s = sIx[sid];
        if (s === undefined) { s = sIx[sid] = sIds.length; sIds.push(sid); }
        var a = hmsSec(c[iA] || '');
        if (a < 0) a = hmsSec(c[iDp] || '');
        if (n === cap) grow();
        rT[n] = k; rQ[n] = +c[iQ]; rS[n] = s; rA[n] = a; n++;
      }).then(function () {
        ttMark('stop_times');
        // 4) rows grouped by trip (counting sort), each trip in stop_sequence order
        var nT = tripIds.length, start = new Int32Array(nT + 1), order = new Int32Array(n), fill, i, k;
        for (i = 0; i < n; i++) start[rT[i] + 1]++;
        for (k = 0; k < nT; k++) start[k + 1] += start[k];
        fill = start.slice(0, nT);
        for (i = 0; i < n; i++) order[fill[rT[i]]++] = i;
        // 5) patterns: one line's exact stop sequence; trips sorted by departure, never overtaking within one.
        // In slices of ~12 ms (all at once took ~0.5 s on a phone-speed CPU, a visible freeze).
        var pats = {}, plist = [], lanes = [];
        return inSlices(nT, function (k) {
          var a0 = start[k], m = start[k + 1] - a0, i;
          if (m < 2) return;
          var rows = Array.prototype.slice.call(order, a0, a0 + m);
          rows.sort(function (x, y) { return rQ[x] - rQ[y]; });
          var st = rows.map(function (r) { return rS[r]; }), sec = rows.map(function (r) { return rA[r]; });
          // a stop without a time (allowed by GTFS): in proportion between its neighbours
          for (i = 0; i < m; i++) {
            if (sec[i] >= 0) continue;
            var lo = i - 1, hi = i + 1;
            while (hi < m && sec[hi] < 0) hi++;
            sec[i] = lo >= 0 && hi < m ? Math.round(sec[lo] + (sec[hi] - sec[lo]) * (i - lo) / (hi - lo)) : lo >= 0 ? sec[lo] : 0;
          }
          var tid = tripIds[k], key = trips[tid].route_id + '>' + st.join('.');
          var p = pats[key];
          if (!p) { p = pats[key] = { route: trips[tid].route_id, stops: st, seqs: rows.map(function (r) { return rQ[r]; }), insts: [] }; plist.push(p); }
          if (mask[k] & 2) p.insts.push({ k: k, day: 0, t: sec });
          if ((mask[k] & 1) && sec[m - 1] + offY > -600) {   // yesterday's run still going after midnight
            p.insts.push({ k: k, day: -1, t: sec.map(function (x) { return x + offY; }) });
          }
        }).then(function () {
          return inSlices(plist.length, function (j0) {
            var p = plist[j0];
            if (!p.insts.length) return;
            p.insts.sort(function (x, y) { return x.t[0] - y.t[0]; });
            var mine = [];
            p.insts.forEach(function (ins) {
              for (var j = 0; j < mine.length; j++) {
                var last = mine[j].insts[mine[j].insts.length - 1].t, ok = true;
                for (var q = 0; q < last.length && ok; q++) if (last[q] > ins.t[q]) ok = false;
                if (ok) { mine[j].insts.push(ins); return; }
              }
              mine.push({ route: p.route, stops: p.stops, seqs: p.seqs, insts: [ins] });
            });
            for (var j1 = 0; j1 < mine.length; j1++) lanes.push(mine[j1]);
          });
        }).then(function () {
        ttMark('patterns');
        // 6) flat arrays
        var P = lanes.length, nS = 0, nI = 0, nTm = 0;
        lanes.forEach(function (p) { nS += p.stops.length; nI += p.insts.length; nTm += p.stops.length * p.insts.length; });
        var x = {
          v: TT_VER, id: id, day: T, base: baseT, offY: offY, built: Date.now(),
          stopIds: sIds, patRoute: new Array(P),
          patStopOff: new Int32Array(P + 1), patStops: new Int32Array(nS), patSeqs: new Int32Array(nS),
          patInstOff: new Int32Array(P + 1), patTimeOff: new Int32Array(P), times: new Int32Array(nTm),
          instTrip: new Int32Array(nI), instDay: new Int8Array(nI), tripIds: tripIds,
          rows: rowsRead, kept: n
        };
        var so = 0, io = 0, to = 0;
        lanes.forEach(function (p, pi) {
          var L = p.stops.length;
          x.patRoute[pi] = p.route;
          x.patStopOff[pi] = so; x.patInstOff[pi] = io; x.patTimeOff[pi] = to;
          for (var q = 0; q < L; q++) { x.patStops[so + q] = p.stops[q]; x.patSeqs[so + q] = p.seqs[q]; }
          p.insts.forEach(function (ins) {
            x.instTrip[io] = ins.k; x.instDay[io] = ins.day; io++;
            for (var q2 = 0; q2 < L; q2++) x.times[to + q2] = ins.t[q2];
            to += L;
          });
          so += L;
        });
        x.patStopOff[P] = so; x.patInstOff[P] = io;
        // 7) patterns at each stop (with the stop's position in the pattern)
        var nSt = sIds.length, spOff = new Int32Array(nSt + 1), q3;
        for (q3 = 0; q3 < so; q3++) spOff[x.patStops[q3] + 1]++;
        for (q3 = 0; q3 < nSt; q3++) spOff[q3 + 1] += spOff[q3];
        var spP = new Int32Array(so), spI = new Int32Array(so), spFill = spOff.slice(0, nSt);
        for (var pi2 = 0; pi2 < P; pi2++) {
          for (var q4 = x.patStopOff[pi2]; q4 < x.patStopOff[pi2 + 1]; q4++) {
            var s2 = x.patStops[q4], at = spFill[s2]++;
            spP[at] = pi2; spI[at] = q4 - x.patStopOff[pi2];
          }
        }
        x.stopPatOff = spOff; x.stopPatP = spP; x.stopPatI = spI;
        ttMark('arrays');
        return ttFootpaths(x, sIx);
        });
      });
    });
  }
  // 8) walking between stops for changes: Sofia publishes them (transfers.txt, ~143,000 pairs up to ~1 km, with
  // the walking time, both directions; twin stops included). Without that file: stops within 400 m, straight line.
  function ttFootpaths(x, sIx) {
    var nSt = x.stopIds.length, from = [], to = [], sec = [], head = null, iF, iTo, iTy, iMin;
    return zipLines('transfers.txt', function (l) {
      if (!head) { head = csvHead(l); iF = head.indexOf('from_stop_id'); iTo = head.indexOf('to_stop_id'); iTy = head.indexOf('transfer_type'); iMin = head.indexOf('min_transfer_time'); return; }
      var c = l.split(','), a = sIx[(c[iF] || '').trim()], b = sIx[(c[iTo] || '').trim()], ty = (c[iTy] || '').trim();
      if (a === undefined || b === undefined || a === b || ty === '3' || ty === '4' || ty === '5') return;   // 3: not possible
      var m = parseInt(c[iMin], 10);
      if (!(m >= 0)) { var A = stops[x.stopIds[a]], B = stops[x.stopIds[b]]; m = A && B ? Math.round(distM([A.lat, A.lon], [B.lat, B.lon]) * 1.3 / 1.2) : 300; }
      from.push(a); to.push(b); sec.push(m);
    }).then(function (had) {
      if (!had || !from.length) {
        x.stopIds.forEach(function (id, a) {
          var A = stops[id];
          if (!A) return;
          for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
            (stopGrid[(Math.floor(A.lat / STOP_GRID_DEG) + dx) + ':' + (Math.floor(A.lon / STOP_GRID_DEG) + dy)] || []).forEach(function (B) {
              var b = sIx[B.id], d = distM([A.lat, A.lon], [B.lat, B.lon]);
              if (b !== undefined && b !== a && d <= 400) { from.push(a); to.push(b); sec.push(Math.round(d * 1.3 / 1.2)); }
            });
          }
        });
      }
      var off = new Int32Array(nSt + 1), i;
      for (i = 0; i < from.length; i++) off[from[i] + 1]++;
      for (i = 0; i < nSt; i++) off[i + 1] += off[i];
      var fTo = new Int32Array(from.length), fSec = new Int32Array(from.length), fill = off.slice(0, nSt);
      for (i = 0; i < from.length; i++) { var at = fill[from[i]]++; fTo[at] = to[i]; fSec[at] = sec[i]; }
      x.footOff = off; x.footTo = fTo; x.footSec = fSec;
      ttMark('footpaths');
      return x;
    });
  }
  // put an index to use (built now or loaded from storage)
  function ttUse(x) {
    var P = x.patRoute.length, nI = x.instTrip.length, ip = new Int32Array(nI), first = {}, ix = {}, byTrip = {};
    for (var p = 0; p < P; p++) for (var i = x.patInstOff[p]; i < x.patInstOff[p + 1]; i++) ip[i] = p;
    for (var j = 0; j < nI; j++) {
      var tid = x.tripIds[x.instTrip[j]], f = first[tid];
      if (f === undefined || (x.instDay[f] === -1 && x.instDay[j] === 0)) first[tid] = j;   // today's run first
      (byTrip[tid] || (byTrip[tid] = [])).push(j);
    }
    x.stopIds.forEach(function (s, k) { ix[s] = k; });
    x.nTrips = Object.keys(first).length;
    tt = x; ttInstPat = ip; ttFirst = first; ttStopIx = ix; ttByTrip = byTrip;
  }
  // A trip's stops in the old loadTripStops format: [{ stopId, seq, arr (s from its own service day) }]
  function ttTripStops(tid) {
    var inst = tt ? ttFirst[tid] : undefined;
    if (inst === undefined) return null;
    var p = ttInstPat[inst], o = tt.patStopOff[p], L = tt.patStopOff[p + 1] - o;
    var t0 = tt.patTimeOff[p] + (inst - tt.patInstOff[p]) * L, off = tt.instDay[inst] === -1 ? tt.offY : 0, out = [];
    for (var i = 0; i < L; i++) out.push({ stopId: tt.stopIds[tt.patStops[o + i]], seq: tt.patSeqs[o + i], arr: tt.times[t0 + i] - off });
    out._tt = true;
    return out;
  }
  // −1: the trip runs only as yesterday's service (past midnight); 0: today; null: not in the index
  function ttTripDay(tid) { var inst = tt ? ttFirst[tid] : undefined; return inst === undefined ? null : tt.instDay[inst]; }
  function ttEnsure() {
    if (!staticZip || staticState !== 'ok') return Promise.resolve(null);
    var T = ymd(new Date()), id = zipId();
    if (tt && tt.day === T && tt.id === id) return Promise.resolve(tt);
    if (ttBusy) return ttBusy;
    var t0 = performance.now();
    ttInfo.state = 'loading'; ttInfo.err = '';
    ttBusy = idb.get('files', 'tt').then(function (c) {
      if (c && c.v === TT_VER && c.day === T && c.id === id) { ttInfo.from = 'saved'; return c; }
      ttInfo.state = 'building';
      renderDiag();
      return ttBuild(T, id).then(function (x) { ttInfo.from = 'built'; idb.put('files', 'tt', x); return x; });
    }).then(function (x) {
      ttUse(x);
      ttInfo.state = 'ready'; ttInfo.ms = Math.round(performance.now() - t0);
      ttBusy = null;
      // stop lists read before the index was ready may be cut short (split trips): take the complete ones
      Object.keys(tripStopsCache).forEach(function (tid) { var l = ttTripStops(tid); if (l) tripStopsCache[tid] = l; });
      if (selected) drawRouteStops();
      renderDiag();
      return tt;
    }).catch(function (e) {
      console.warn('Timetable index failed:', e);
      ttInfo.state = 'failed'; ttInfo.err = String(e && e.message || e);
      ttBusy = null;
      renderDiag();
      return null;
    });
    return ttBusy;
  }
  // after midnight: the next day's index (the old one keeps working meanwhile)
  setInterval(function () { if (tt && tt.day !== ymd(new Date())) ttEnsure(); }, 60000);

