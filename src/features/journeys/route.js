  // ---- live state of a way: which vehicle, where it is, when it comes, time to spare ----
  function realize(way) {
    var ov = liveOverlay(), nowS = (Date.now() - tt.base) / 1000, used = {}, prevArr = null, prevStop = null, walkBefore = 0, first = true;
    way.legs.forEach(function (lg) {
      if (lg.kind === 'walk') { walkBefore += lg.sec; return; }
      var lv = ov[lg.inst], st = ttStop(lg.from), sched = tt.times[instRow(lg.inst) + lg.bPos];
      var dep = lv ? lv.t[lg.bPos] : sched, kind = lv ? ['sched', 'live', 'est'][lv.kind[lg.bPos]] : 'sched';
      var arr = lv ? lv.t[lg.aPos] : tt.times[instRow(lg.inst) + lg.aPos];
      // the vehicle: the one the feed puts on this trip, else the most likely live one of the line
      var key = tripToVeh[lg.tid] || null, g = null;
      if (key && !vehicles[key]) key = null;
      // v99: a guessed vehicle heading this way that reaches your stop well before your trip (GUESS_EARLY_S) is the one
      // before it, on its own run (trip updates carry no vehicle ids, so your trip often has none yet): the next one is tried
      if (!key && st && shapes) {
        var skip = L.extend({}, used);
        for (var tries = 0; tries < 4 && !key; tries++) {
          g = guessVehicle({ tripId: lg.tid, t: tt.base + dep * 1000 }, st, skip);
          if (!g) break;
          var own = g.sameWay ? guessArrival(vehicles[g.key], st, g, null) : null;
          if (own && own < tt.base + (dep - GUESS_EARLY_S) * 1000) { skip[g.key] = true; g = null; continue; }
          key = g.key;
        }
      }
      if (key) used[key] = true;
      var v = key ? vehicles[key] : null, away = null;
      if (v && kind !== 'live' && st) {   // no live time here: from where the vehicle is now
        var ga = guessArrival(v, st, g || { sameWay: true }, tt.base + dep * 1000);
        if (ga) { var nd = Math.round((ga - tt.base) / 1000); arr += nd - dep; dep = nd; kind = 'est'; }
      }
      if (v && (!g || g.sameWay) && st) {   // how many stops before yours
        var tw = twinsOf(st.id);
        loadTripStops(v.d.tripRef);
        var rs = computeRouteStops(v);
        for (var i = 0; i < rs.length; i++) if (tw.indexOf(rs[i].stop.id) >= 0) { away = i; break; }
      }
      var ready = first ? nowS + walkBefore : prevArr + walkBefore + (prevStop === lg.from ? MIN_CHANGE_S : 0);
      lg.live = { dep: dep, arr: arr, kind: kind, key: key, guess: g, away: away, ret: !!(g && !g.sameWay), spare: dep - ready,
                  leave: first ? dep - walkBefore : null };
      prevArr = arr; prevStop = lg.to; walkBefore = 0; first = false;
    });
    var last = way.legs[way.legs.length - 1], lastRide = way.legs.filter(function (l) { return l.kind === 'ride'; }).pop();
    way.liveArr = lastRide && lastRide.live ? lastRide.live.arr + (last.kind === 'walk' ? last.sec : 0) : way.arr;
    return way;
  }

  // ---- starting, searching, ending ----
  function startRoute(p) {
    map.closePopup();
    if (savedPlaces.destinationId !== p.id) savedPlaces.setDestination(p.id);
    route = { placeId: p.id, ways: [], sig: '', state: 'wait', msg: '', at: 0, fitted: false };
    if (loc.state === 'off' || loc.state === 'err') {
      startLocation();      // inside the tap (iPhone asks for location and compass only then)
      setLocFollow(false);  // the route view takes the camera, not the first fix
    }
    showRoute();
    routeSearch();
  }
  function endRoute() {
    var clearDestination = route && savedPlaces.destinationId === route.placeId;
    if (route && route.go) courseStop();   // v95
    route = null;
    updateRouteVehs();   // v99
    routeLayer.clearLayers();
    showRoute();
    if (clearDestination) savedPlaces.setDestination('');
    else savedPlaces.refreshDestination();
  }
  var routeBusy = false;
  function routeSearch() {
    if (!route || routeBusy) return;
    var p = savedPlaces.find(route.placeId);
    if (!p) { endRoute(); return; }
    var me = loc.fix && loc.state === 'on' ? loc.fix.ll : null;
    if (!me) {
      route.state = loc.state === 'err' ? 'err' : 'wait';
      route.msg = loc.state === 'err' ? (loc.err || 'Location is blocked.') : '';
      renderRoute();
      return;
    }
    if (!route.ways.length) route.state = 'search';
    renderRoute();
    if (staticState === 'loading' || !staticZip) { setTimeout(routeSearch, 1500); return; }   // v95: e.g. a route restored on opening
    routeBusy = true;
    Promise.all([ttEnsure(), loadShapes()]).then(function (r) {
      if (!route) return null;
      if (!r[0]) { route.state = 'err'; route.msg = 'Today\'s timetable isn\'t available (' + (ttInfo.err || 'schedule not loaded') + ').'; renderRoute(); return null; }
      return planWays(loc.fix ? loc.fix.ll : me, p);
    }).then(function (res) {
      routeBusy = false;
      if (!route || !res) return;
      if (savedPlaces.find(route.placeId) !== p) { routeSearch(); return; }   // another place was picked meanwhile: search for it
      // the way you picked stays the main one while it's still there
      var ways = res.ways, keep = route.sig && ways.filter(function (w) { return w.sig === route.sig; })[0];
      if (keep && ways[0] !== keep) { ways.splice(ways.indexOf(keep), 1); ways.unshift(keep); }
      var sigWas = route.sig;
      route.ways = ways; route.sig = ways.length ? ways[0].sig : ''; route.state = 'ok'; route.at = Date.now();
      if (route.go && (route.phase === null || route.sig !== sigWas)) { route.from = [me.lat, me.lng]; courseBegin(); }   // v95: guidance on the new way
      if (!route.from || !route.go) route.from = [me.lat, me.lng];   // where the plan starts
      drawRoute();
      renderRoute();
      if (!route.fitted && !route.go) { route.fitted = true; requestAnimationFrame(function () { requestAnimationFrame(fitRoute); }); }   // once the card has its size
      renderDiag();
      streetWalks();   // v94: the walking parts along the streets (redrawn as each arrives)
    }).catch(function (e) {
      routeBusy = false;
      console.warn('Route search failed:', e);
      if (route) { route.state = 'err'; route.msg = 'The search failed: ' + (e && e.message || e); renderRoute(); }
    });
  }
  function pickWay(sig) {
    if (!route) return;
    var w = route.ways.filter(function (x) { return x.sig === sig; })[0];
    if (!w) return;
    route.ways.splice(route.ways.indexOf(w), 1);
    route.ways.unshift(w);
    route.sig = sig;
    if (route.go) { courseBegin(); drawRoute(); renderRoute(); return; }   // v95: guidance switches to that way
    drawRoute(); renderRoute(); fitRoute();
  }
  // fresh searches while the route is shown; the minutes count down in between
  setInterval(function () {
    if (!route) return;
    if (route.state === 'ok' && Date.now() - route.at > ROUTE_REFRESH_MS && !(route.go && route.phase === 'ride')) routeSearch();   // (not while riding: you're on the vehicle)
    else renderRoute();
  }, 10000);

