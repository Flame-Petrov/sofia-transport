  // Live vehicles heading to a stop, soonest first
  // v77: at a shared stop, everything due at any of its twins (bus, trolley and tram stops of one pole);
  // each arrival keeps its own stop (sid), so picking it makes the right stop of that vehicle's route "your stop"
  function arrivalsAt(stopId) {
    var now = Date.now(), seen = {}, entries = [];
    twinsOf(stopId).forEach(function (sid) {
      (stopIndex[sid] || []).forEach(function (e) { entries.push({ e: e, sid: sid }); });
    });
    var list = entries.map(function (x) {
      var e = x.e, key = vehicles[e.vehId] ? e.vehId : (vehByLabel[e.vehId] || tripToVeh[e.tripId]);
      var t = e.t;
      if (!t && tripStopsCache[e.tripId] && key && vehicles[key]) {
        var r = computeRouteStops(vehicles[key]).filter(function (y) { return y.stop.id === x.sid; })[0];
        if (r) t = r.eta;
      }
      return { tripId: e.tripId, key: key, t: t, sid: x.sid };
    }).filter(function (a) {
      if (a.t && a.t < now - 30000) return false;
      if (searchRoutes && !(trips[a.tripId] && searchRoutes[trips[a.tripId].route_id])) return false;   // only the searched line(s)
      if (seen[a.tripId]) return false;
      return (seen[a.tripId] = true);
    }).sort(function (a, b) { return (a.t || Infinity) - (b.t || Infinity); }).slice(0, 60);   // enough to fill the line cards (all twins)
    // arrivals the feed hasn't tied to a vehicle yet get the most likely live one, soonest first
    var used = {};
    list.forEach(function (a) { if (a.key) used[a.key] = true; });
    list.forEach(function (a) {
      var st = stops[a.sid];
      if (a.key || !st) return;
      var g = guessVehicle(a, st, used);
      if (g) {
        a.key = g.key; a.guess = g; used[g.key] = true;
        a.t = guessArrival(vehicles[g.key], st, g, a.t) || a.t;
      }
    });
    if (activeTypes[1]) twinsOf(stopId).forEach(function (sid) {
      metroTimetable.upcoming(sid, now, searchRoutes).forEach(function (a) {
        if (!seen[a.tripId]) { seen[a.tripId] = true; list.push(a); }
      });
    });
    return list.sort(function (a, b) { return (a.t || Infinity) - (b.t || Infinity); });
  }

  // Best guess for an arrival without a vehicle: a live vehicle of the same line that could
  // realistically be there by then — first one heading the same way and still before the stop,
  // otherwise one finishing its previous run (it turns around and comes back).
  var RETURN_PENALTY_S = 600;   // handicap for a guess that comes only after turning round at its terminus
  function guessVehicle(a, st, used) {
    var info = trips[a.tripId];
    if (!info) return null;
    if (!shapes) { loadShapes(); return null; }   // routes still loading: the next refresh fills this in
    var secs = a.t ? (a.t - Date.now()) / 1000 : null, best = null, bestScore = Infinity, bestSame = false;
    var newM = info.shape_id && shapes && shapes[info.shape_id] ? metaFor(info.shape_id) : null;
    var stopOnNew = newM ? stopAlong(newM, st, 0) : null;
    for (var k in vehicles) {
      if (used[k] || vehicles[k].d.metroPlan) continue;
      var v = vehicles[k], vi = trips[v.d.tripRef];
      if (!vi || vi.route_id !== info.route_id || !v.pos) continue;
      var m = routeMetaFor(v.d);
      if (!m) continue;
      var vs = (v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number') ? v.along
             : ((projectAlong(m, v.pos[0], v.pos[1], v.d.bearing) || {}).s);
      if (typeof vs !== 'number') continue;
      var sameWay = (vi.shape_id && vi.shape_id === info.shape_id) || (vi.headsign && vi.headsign === info.headsign);
      var dist;
      if (sameWay) {
        var ss = stopAlong(m, st, Math.max(0, vs - 30));
        if (ss === null) continue;            // already past the stop
        dist = ss - vs;
      } else {
        if (m.total - vs > 4000) continue;    // too far from the end of its current run
        dist = (m.total - vs) + (stopOnNew !== null ? stopOnNew : 1500);
      }
      var travel = dist / 5.5;                // ~20 km/h average through the city
      if (secs !== null && travel > secs + 600) continue;   // couldn't make it in time
      // a bus that has to turn round first only wins when the ones already heading here are clearly off (> 10 min)
      var score = (secs !== null ? Math.abs(travel - secs) : travel) + (sameWay ? 0 : RETURN_PENALTY_S);
      if (score < bestScore) { bestScore = score; best = k; bestSame = !!sameWay; }
    }
    return best ? { key: best, sameWay: bestSame, stopOnNew: stopOnNew } : null;
  }

  // When the guessed vehicle is the one finishing its previous run, it reaches the stop when that
  // run ends (if the stop is at the end of it), or after it ends plus the drive to the stop —
  // and never earlier than the next run's own predicted time.
  function guessArrival(v, st, g, predicted) {
    var m = routeMetaFor(v.d), now = Date.now();
    if (!m || !v.pos) return predicted;
    var along = (v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number') ? v.along
              : ((projectAlong(m, v.pos[0], v.pos[1], v.d.bearing) || {}).s);
    if (typeof along !== 'number') return predicted;
    var rs = computeRouteStops(v);
    function etaAlong(sAt) {
      // prefer the vehicle's own predicted time at a stop of its current run near that point
      var best = null, bestD = 150;
      rs.forEach(function (r) {
        var sa = stopAlong(m, r.stop, Math.max(0, along - 30));
        if (sa !== null && Math.abs(sa - sAt) < bestD) { bestD = Math.abs(sa - sAt); best = r.eta; }
      });
      return best || now + Math.max(0, sAt - along) / 5.5 * 1000;   // ~20 km/h through the city
    }
    if (g.sameWay) {
      var sa = stopAlong(m, st, Math.max(0, along - 30));
      return sa !== null ? etaAlong(sa) : predicted;
    }
    var sNear = stopAlong(m, st, Math.max(along, m.total - 400));   // the stop sits where this run ends
    if (sNear !== null) return etaAlong(sNear);
    return Math.max(etaAlong(m.total) + (g.stopOnNew || 0) / 5.5 * 1000, predicted || 0);
  }

