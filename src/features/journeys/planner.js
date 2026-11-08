  // ---------- v93: Route to a place ----------
  // "Start route" on a flag (or ➜ in My places): the ways from where you are to that place by bus, tram,
  // trolleybus and metro, from today's timetable (v92) with the live predictions folded in, and Sofia's own
  // walking times between stops for changes. The best way is the main card with its whole chain; the others
  // are listed under it (reports/Route to a saved place - plan.md).
  // Search: RAPTOR (round-based public transit routing; round k = the earliest arrival with k vehicles).
  // The first stop is the closest one that does the job: the nearest pole from which the place is reached
  // no more than CLOSEST_SLACK_MIN later than the fastest way overall, however far that pole is.
  var WALK_MS = 1.2;            // m/s on foot (Sofia's own transfer times imply ~1.13)
  var WALK_DETOUR = 1.3;        // streets aren't straight: straight-line distance × this
  var MIN_CHANGE_S = 60;        // getting off and onto another vehicle at the same stop
  var ROUTE_ROUNDS = 4;         // at most 4 vehicles (3 changes)
  var ROUTE_HORIZON_MIN = 90;   // vehicles leaving within this
  var CLOSEST_SLACK_MIN = 10;   // a closer first stop wins unless its way arrives more than this later than the fastest
  var FEWER_CHANGES_S = 180;    // one change less wins when it arrives at most this much later
  var ROUTE_OPTIONS = 3;        // ways shown: the main one and the others
  var WALK_ONLY_M = 1500;       // a walk-only way is offered up to this far (or whenever it's the fastest)
  var WALK_PREFER_S = 300;      // walking is the main way when it arrives at most this much later (no wait, nothing to miss)
  var ROUTE_REFRESH_MS = 60000; // a fresh search while the route is shown
  var GUESS_EARLY_S = 300;      // v99: a guessed vehicle reaching your stop more than this before your trip is the one before it
  // v97: the easiest way — one vehicle and little walking (asked: European Union → Mladost 3 never offered bus X9,
  // one bus with a 2-min walk, because "fewest vehicles" was the earliest one-vehicle way: the metro + a 22-min walk)
  var FEW_SLACK_S = 1200;       // the fewest-vehicles way is shown when it arrives at most this much later than the fastest
  var DIRECT_WALK_M = 600;      // a one-vehicle search with at most this far on foot to the first stop and from the last
  var EASY_WALK_WEIGHT = 2;     // choosing that way: a minute on foot counts as this many minutes of arriving later
  var R_INF = 0x3fffffff, R_SKIP = -0x3fffffff;
  var route = null, routeInfo = { ms: 0, runs: 0, at: 0, n: 0 };
  map.createPane('routePane').style.zIndex = 612;   // the route's stops: over stops and vehicles, under flags and your dot
  var routeLayer = L.layerGroup().addTo(map);
  // the tags (Board / Change / Get off) from street level; zoomed out they'd cover each other, the rings stay
  var ROUTE_TAG_ZOOM = 14;
  function routeTagsByZoom() { document.getElementById('map').classList.toggle('rt-far', map.getZoom() < ROUTE_TAG_ZOOM); }
  map.on('zoomend', routeTagsByZoom);
  routeTagsByZoom();
  var WALK_SVG = '<svg class="rt-walk" viewBox="0 0 16 16" aria-hidden="true"><circle cx="9.2" cy="2.4" r="1.6" fill="currentColor"/>' +
    '<path d="M8.4 5.3L6.6 9.6l2.4 1.7.5 3.7M8.4 5.3l2 2.5 2.1.7M6.9 6.2L4.7 7.6l-.5 2.2M6.6 9.6L5.2 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function walkSecM(m) { return Math.round(m * WALK_DETOUR / WALK_MS); }
  function ttStop(s) { return stops[tt.stopIds[s]] || null; }
  function served(s) { return tt.stopPatOff[s + 1] > tt.stopPatOff[s]; }
  function instRow(inst) { var p = ttInstPat[inst], L = tt.patStopOff[p + 1] - tt.patStopOff[p]; return tt.patTimeOff[p] + (inst - tt.patInstOff[p]) * L; }
  function relClock(sec) { return clockOf(tt.base + sec * 1000); }

  // Live times for every trip the feed predicts, per stop of its run (seconds from tt.base): the feed's own time,
  // else the timetable + the latest delay before it, else the timetable (the same rule as computeRouteStops).
  // Cached until the next feed update.
  var ovCache = null, ovKey = '';
  function liveOverlay() {
    var key = tt.day + '|' + feedTime + '|' + Object.keys(tuByTrip).length;
    if (ovCache && ovKey === key) return ovCache;
    var out = {}, base = tt.base / 1000, Y = ymd(tt.base - 12 * 3600e3);
    for (var tid in tuByTrip) {
      var list = ttByTrip[tid];
      if (!list) continue;
      var tu = tuByTrip[tid], inst = list[0];
      for (var j = 0; j < list.length; j++) if ((tt.instDay[list[j]] === -1) === (tu.startDate === Y)) inst = list[j];
      out[inst] = liveTimes(inst, tu, base);
    }
    ovCache = out; ovKey = key;
    return out;
  }
  function liveTimes(inst, tu, base) {
    var p = ttInstPat[inst], o = tt.patStopOff[p], L = tt.patStopOff[p + 1] - o, row = instRow(inst);
    var byStop = {}, bySeq = {};
    tu.stus.forEach(function (x) { if (x.stopId) byStop[x.stopId] = x; if (x.seq !== null) bySeq[x.seq] = x; });
    var t = new Int32Array(L), kind = new Uint8Array(L), delay = tu.delay;   // kind: 0 timetable, 1 live, 2 timetable + delay
    for (var i = 0; i < L; i++) {
      var sched = tt.times[row + i], u = byStop[tt.stopIds[tt.patStops[o + i]]] || bySeq[tt.patSeqs[o + i]];
      if (u && u.skipped) { t[i] = R_SKIP; continue; }
      if (u && u.t) { t[i] = Math.round(u.t / 1000 - base); delay = t[i] - sched; kind[i] = 1; }
      else if (u && u.delay !== null) { delay = u.delay; t[i] = sched + delay; kind[i] = 1; }
      else { t[i] = sched + (delay !== null ? delay : 0); kind[i] = delay !== null ? 2 : 0; }
    }
    return { t: t, kind: kind };
  }
  function instTime(inst, i, ov) { var lv = ov[inst]; return lv ? lv.t[i] : tt.times[instRow(inst) + i]; }

  // One search. access / egress: [{ s: stop index, sec: walking seconds }]; dep: seconds from tt.base;
  // ban: { inst: true } first vehicles not to take ("the next one"). Returns every round's labels and the
  // best arrival at the place for each number of vehicles that beats fewer vehicles.
  function raptor(access, egress, dep, ov, ban, maxK) {   // maxK: at most this many vehicles (v97; default ROUTE_ROUNDS)
    var nS = tt.stopIds.length, limit = dep + ROUTE_HORIZON_MIN * 60, rounds = maxK || ROUTE_ROUNDS;
    var best = new Int32Array(nS).fill(R_INF), bKind = new Int8Array(nS).fill(-1), bRound = new Int8Array(nS);
    var isMarked = new Uint8Array(nS), marked = [], m, j, i;
    var r0 = { at: new Int32Array(nS).fill(R_INF), acc: new Int32Array(nS).fill(-1) };
    access.forEach(function (a, n) {
      var x = dep + a.sec;
      if (x >= r0.at[a.s]) return;
      r0.at[a.s] = x; r0.acc[a.s] = n; best[a.s] = x; bKind[a.s] = 0; bRound[a.s] = 0;
      if (!isMarked[a.s]) { isMarked[a.s] = 1; marked.push(a.s); }
    });
    var egW = new Int32Array(nS).fill(R_INF);
    egress.forEach(function (e) { if (e.sec < egW[e.s]) egW[e.s] = e.sec; });
    var R = [r0], results = [], destBest = R_INF, qPos = new Int32Array(tt.patRoute.length).fill(-1);
    for (var k = 1; k <= rounds && marked.length; k++) {
      var pBest = best.slice(), pKind = bKind.slice(), pRound = bRound.slice(), qList = [];
      // the patterns through the stops reached in the last round, from their earliest such stop
      for (m = 0; m < marked.length; m++) {
        var ms = marked[m];
        isMarked[ms] = 0;
        for (j = tt.stopPatOff[ms]; j < tt.stopPatOff[ms + 1]; j++) {
          var pj = tt.stopPatP[j], ij = tt.stopPatI[j];
          if (qPos[pj] < 0) { qPos[pj] = ij; qList.push(pj); } else if (ij < qPos[pj]) qPos[pj] = ij;
        }
      }
      marked = [];
      var rd = { rt: new Int32Array(nS).fill(R_INF), ri: new Int32Array(nS), rb: new Int32Array(nS), ra: new Int32Array(nS),
                 rr: new Int8Array(nS), rk: new Int8Array(nS), ft: new Int32Array(nS).fill(R_INF), ff: new Int32Array(nS) };
      var rideMarked = [];
      for (var q = 0; q < qList.length; q++) {
        var p = qList[q], i0 = qPos[p];
        qPos[p] = -1;
        var o = tt.patStopOff[p], L = tt.patStopOff[p + 1] - o, a0 = tt.patInstOff[p], nT = tt.patInstOff[p + 1] - a0, tOff = tt.patTimeOff[p];
        var cur = -1, curRow = 0, curLv = null, curB = -1, fromR = 0, fromK = 0;
        for (i = i0; i < L; i++) {
          var s = tt.patStops[o + i];
          if (cur >= 0) {   // riding: getting off here
            var arr = curLv ? curLv.t[i] : tt.times[curRow + i];
            if (arr !== R_SKIP && arr < best[s] && arr < destBest) {
              rd.rt[s] = arr; rd.ri[s] = cur; rd.rb[s] = curB; rd.ra[s] = i; rd.rr[s] = fromR; rd.rk[s] = fromK;
              best[s] = arr; bKind[s] = 1; bRound[s] = k;
              if (!isMarked[s]) { isMarked[s] = 1; marked.push(s); }
              rideMarked.push(s);
            }
          }
          var lab = pBest[s];
          if (lab >= R_INF) continue;
          var need = lab + (pKind[s] === 1 ? MIN_CHANGE_S : 0);   // off one vehicle, onto the next: a minute
          var curDep = cur >= 0 ? (curLv ? curLv.t[i] : tt.times[curRow + i]) : R_INF;
          if (need >= curDep) continue;
          // the earliest trip leaving here at or after `need` (live times can reorder trips a little, so the
          // trips around that time are all checked)
          var lo = 0, hi = nT, key = need - 1800;
          while (lo < hi) { var mid = (lo + hi) >> 1; if (tt.times[tOff + mid * L + i] < key) lo = mid + 1; else hi = mid; }
          var bI = -1, bT = R_INF;
          for (var x = lo; x < nT; x++) {
            var sch = tt.times[tOff + x * L + i];
            if (sch > limit || (bI >= 0 && sch > bT + 1800)) break;
            if (ban && ban[a0 + x]) continue;   // v98: in every round (from round 2 the same trip was boarded again from your own stop, so "the next vehicle" came out as the main way and was dropped)
            var lv = ov[a0 + x], tx = lv ? lv.t[i] : sch;
            if (tx === R_SKIP || tx < need || tx < dep) continue;
            if (tx < bT) { bT = tx; bI = x; }
          }
          if (bI >= 0 && bT < curDep) {
            cur = a0 + bI; curRow = tOff + bI * L; curLv = ov[cur] || null; curB = i; fromR = pRound[s]; fromK = pKind[s];
          }
        }
      }
      // after getting off: walking to nearby stops (Sofia's transfer links)
      for (m = 0; m < rideMarked.length; m++) {
        var s1 = rideMarked[m], t1 = rd.rt[s1];
        for (j = tt.footOff[s1]; j < tt.footOff[s1 + 1]; j++) {
          var b2 = tt.footTo[j], t2 = t1 + tt.footSec[j];
          if (t2 < best[b2] && t2 < destBest) {
            rd.ft[b2] = t2; rd.ff[b2] = s1; best[b2] = t2; bKind[b2] = 2; bRound[b2] = k;
            if (!isMarked[b2]) { isMarked[b2] = 1; marked.push(b2); }
          }
        }
      }
      R.push(rd);
      // the place: walking from a stop where this round got off
      var dB = R_INF, dS = -1;
      for (m = 0; m < rideMarked.length; m++) {
        var s3 = rideMarked[m];
        if (egW[s3] < R_INF && rd.rt[s3] + egW[s3] < dB) { dB = rd.rt[s3] + egW[s3]; dS = s3; }
      }
      if (dS >= 0 && dB < destBest) { destBest = dB; results.push({ k: k, arr: dB, s: dS, w: egW[dS] }); }
    }
    return { R: R, results: results, access: access, dep: dep };
  }
  // the legs of one result, from you to the place: walks (from/to: stop index, −1 you, −2 the place) and rides
  function rebuild(run, res) {
    var R = run.R, legs = [{ kind: 'walk', from: res.s, to: -2, sec: res.w }], k = res.k, s = res.s, kind = 1, guard = 0;
    while (guard++ < 24) {
      if (kind === 0) { legs.unshift({ kind: 'walk', from: -1, to: s, sec: run.access[R[0].acc[s]].sec }); break; }
      var rd = R[k];
      if (kind === 2) { var f = rd.ff[s]; legs.unshift({ kind: 'walk', from: f, to: s, sec: rd.ft[s] - rd.rt[f] }); s = f; kind = 1; continue; }
      var inst = rd.ri[s], p = ttInstPat[inst], o = tt.patStopOff[p], bPos = rd.rb[s];
      legs.unshift({ kind: 'ride', inst: inst, p: p, bPos: bPos, aPos: rd.ra[s], from: tt.patStops[o + bPos], to: s, tid: tt.tripIds[tt.instTrip[inst]] });
      var nk = rd.rr[s], nkind = rd.rk[s];
      s = tt.patStops[o + bPos]; k = nk; kind = nkind;
    }
    return legs;
  }
  // the result to show for one search: the earliest arrival, unless one vehicle less arrives at most FEWER_CHANGES_S later
  function pickRes(results) {
    if (!results.length) return null;
    var fast = results[results.length - 1];
    for (var i = 0; i < results.length; i++) if (results[i].arr <= fast.arr + FEWER_CHANGES_S) return results[i];
    return fast;
  }
  function makeWay(run, res) {
    var legs = rebuild(run, res), rides = legs.filter(function (l) { return l.kind === 'ride'; }), walk = 0;
    legs.forEach(function (l) { if (l.kind === 'walk') walk += l.sec; });
    return { legs: legs, arr: res.arr, rides: rides.length, walk: walk, sig: rides.map(function (l) { return l.inst; }).join('+'), access: run.access };
  }
  function walkWay(dep, me, place) {
    var d = distM([me.lat, me.lng], [place.lat, place.lon]), sec = walkSecM(d);
    return { legs: [{ kind: 'walk', from: -1, to: -2, sec: sec, m: d }], arr: dep + sec, rides: 0, walk: sec, sig: 'walk' };
  }

  // All the ways for you → place: the main one first (closest stop that does the job), then the fastest, the one
  // with the fewest vehicles and the next vehicle after the main way's first one, and walking when it's short.
  // Each search runs in its own task (one search is 10–70 ms on a phone-speed CPU; all of them together, up to
  // ~270 ms, was a visible hitch every time the route refreshed). Resolves with { ways, dep }.
  function nextTask() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function planWays(me, place) {
    var t0 = performance.now(), ov = liveOverlay(), dep = Math.round((Date.now() - tt.base) / 1000) + 20, runs = 0;
    var meA = [me.lat, me.lng], plA = [place.lat, place.lon], near = [], far = [];
    for (var s = 0; s < tt.stopIds.length; s++) {
      var st = served(s) && ttStop(s);
      if (!st) continue;
      near.push({ s: s, d: distM(meA, [st.lat, st.lon]) });
      far.push({ s: s, d: distM(plA, [st.lat, st.lon]) });
    }
    function byD(x, y) { return x.d - y.d; }
    near.sort(byD); far.sort(byD);
    // every stop within 1.5 km (or 500 m past the nearest one, however far that is: no distance limit)
    function within(list) {
      var lim = Math.max(1500, (list.length ? list[0].d : 0) + 500), out = [];
      for (var i = 0; i < list.length && list[i].d <= lim; i++) out.push({ s: list[i].s, sec: walkSecM(list[i].d), d: list[i].d });
      return out;
    }
    var access = within(near), egress = within(far), ways = [], all, fastest, fWay, fDist, main = null, direct = null, easySig = '';
    function easyCost(w) { return w.arr + (EASY_WALK_WEIGHT - 1) * w.walk; }
    function run(acc, ban) { runs++; return raptor(acc, egress, dep, ov, ban); }
    // the closest pole (twin stops of one place together) that does the job, from the nearest outwards
    var g = 0, tries = 0, seen = {};
    function closest() {
      for (; g < near.length && !main && tries < 10; g++) {
        if (near[g].d >= fDist) { main = fWay; return null; }   // no closer stop left: the fastest way's first stop is it
        var tw = twinsOf(tt.stopIds[near[g].s]), gk = tw[0];
        if (seen[gk]) continue;
        seen[gk] = 1;
        var grp = tw.map(function (id) { return ttStopIx[id]; }).filter(function (x) { return x !== undefined && served(x); })
          .map(function (x) { return { s: x, sec: walkSecM(distM(meA, [ttStop(x).lat, ttStop(x).lon])) }; });
        g++; tries++;
        return nextTask().then(function () {
          var r = run(grp, null), pr = pickRes(r.results);
          if (pr && pr.arr <= fastest.arr + CLOSEST_SLACK_MIN * 60) main = makeWay(r, pr);
          return closest();
        });
      }
      return null;
    }
    return nextTask().then(function () {
      all = run(access, null);
      fastest = pickRes(all.results);
      if (!fastest) return null;
      fWay = makeWay(all, fastest);
      var fFirst = fWay.legs.filter(function (l) { return l.kind === 'ride'; })[0];
      fDist = fFirst ? distM(meA, [ttStop(fFirst.from).lat, ttStop(fFirst.from).lon]) : Infinity;
      return closest();
    }).then(function () {
      if (!fastest) return null;
      // v97: one vehicle, with stops at most DIRECT_WALK_M from you and from the place (the bus that goes there)
      var accD = access.filter(function (a) { return a.d <= DIRECT_WALK_M; }), egD = egress.filter(function (e) { return e.d <= DIRECT_WALK_M; });
      if (!accD.length || !egD.length) return null;
      return nextTask().then(function () {
        runs++;
        var rD = raptor(accD, egD, dep, ov, null, 1);
        if (rD.results.length) direct = makeWay(rD, rD.results[0]);
      });
    }).then(function () {
      if (!fastest) return null;
      // v97: the closest stop's way gives way to one with fewer vehicles that's as good (walking counted extra): at
      // European Union the metro under you won by 99 m with M2 + X9, against X9 from the stop across the street, same arrival
      var mainWay = main || fWay;
      [fWay, direct].forEach(function (w) { if (w && w.rides < mainWay.rides && easyCost(w) <= easyCost(mainWay) + FEWER_CHANGES_S) mainWay = w; });
      ways.push(mainWay);
      ways.push(fWay);
      // fewest vehicles (up to FEW_SLACK_S later than the fastest); v97: of two ways with as few vehicles, the one
      // with less walking unless it arrives much later (a minute on foot counts as EASY_WALK_WEIGHT minutes)
      var few = all.results.filter(function (x) { return x.arr <= fastest.arr + FEW_SLACK_S; })[0], fewWay = few ? makeWay(all, few) : null;
      if (direct && direct.arr <= fastest.arr + FEW_SLACK_S && (!fewWay || direct.rides < fewWay.rides || easyCost(direct) < easyCost(fewWay))) fewWay = direct;
      if (fewWay) ways.push(fewWay);
      if (fewWay && fewWay === direct) easySig = direct.sig;   // "Easiest" only for a way with short walks at both ends
      // the next vehicle after the main way's first one, from the main way's own stop(s)
      var first = ways[0].legs.filter(function (l) { return l.kind === 'ride'; })[0];
      if (!first) return null;
      var ban = {}; ban[first.inst] = true;
      return nextTask().then(function () {
        var rn = run(ways[0].access, ban), pn = pickRes(rn.results);
        if (pn) ways.push(makeWay(rn, pn));
      });
    }).then(function () {
      // one of each, the main first, then by arrival
      var uniq = [], sigs = {};
      ways.forEach(function (w) { if (w && !sigs[w.sig]) { sigs[w.sig] = 1; uniq.push(w); } });
      var head = uniq.shift(), rest = uniq.sort(function (x, y) { return x.arr - y.arr; });
      ways = head ? [head].concat(rest) : [];
      // on foot: when it's short, the fastest, or nothing else gets there; the main way when it arrives at most
      // WALK_PREFER_S later than the best vehicle (no wait, nothing to miss)
      var ww = walkWay(dep, me, place);
      if (!ways.length || ww.legs[0].m <= WALK_ONLY_M || ww.arr <= ways[0].arr + WALK_PREFER_S) {
        if (!ways.length || ww.arr <= ways[0].arr + WALK_PREFER_S) ways.unshift(ww); else ways.push(ww);
      }
      var cut = ROUTE_OPTIONS + (ways.some(function (w) { return w.sig === 'walk'; }) ? 1 : 0), easy = null;
      ways.forEach(function (w) { w.easy = !!easySig && w.sig === easySig && w.sig !== fWay.sig; if (w.easy) easy = w; });   // labelled unless it's also the fastest
      // v97: the easiest way stays among those shown (it arrives later, so sorting by arrival put it last, then it was cut)
      if (easy && ways.indexOf(easy) >= cut) { ways.splice(ways.indexOf(easy), 1); ways.splice(cut - 1, 0, easy); }
      ways = ways.slice(0, cut);
      routeInfo = { ms: Math.round(performance.now() - t0), runs: runs, at: Date.now(), n: ways.length };
      return { ways: ways, dep: dep };
    });
  }

