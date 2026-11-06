  // ---------- v95: guidance along the way (GPS) ----------
  // Start: the camera keeps you in view and a banner says what to do now. Your GPS position moves it on: at the stop
  // → the vehicle is tracked coming to you (the progress bar, §3.3c); next to it and moving at its speed → on board,
  // the progress bar now counts down to where you get off; near that stop and slow → off, next leg; at the place →
  // arrived. Planned again by itself when the vehicle leaves without you, you walk another way, or get off
  // elsewhere. Phone turned back on (screen on again / app back in front): fresh feed and a fresh fix at once, then
  // where you are now decides the step, or a new plan. Survives a reload (localStorage 'sofia_course', 3 h).
  var AT_STOP_M = 40, ARRIVED_M = 50, BOARD_M = 80, OFF_COURSE_M = 150, OFF_COURSE_MS = 20000, COURSE_KEEP_MS = 3 * 3600e3;
  // v96: the screen stays on while a route is guided (Screen Wake Lock: Android Chrome, iPhone Safari 16.4+; the
  // browser drops it when the app goes to the background, so it is asked for again when it comes back), and on
  // Android the phone vibrates at the moments that matter (iPhone browsers have no vibration: nothing happens)
  var wakeLock = null, wakeInfo = '';
  function keepScreenOn(on) {
    if (!on) { if (wakeLock) { try { wakeLock.release(); } catch (e) {} } wakeLock = null; wakeInfo = 'off'; return; }
    if (!navigator.wakeLock) { wakeInfo = 'not available in this browser'; return; }
    if (wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l; wakeInfo = 'on';
      l.addEventListener('release', function () { wakeLock = null; if (wakeInfo === 'on') wakeInfo = 'released'; });
    }, function (e) { wakeInfo = 'refused (' + (e && e.name || e) + ')'; });
  }
  function buzz(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} }
  function legPhase(lg) { return lg ? (lg.kind === 'walk' ? 'walk' : 'wait') : 'done'; }
  function startCourse() {
    if (!route || !route.ways.length) return;
    route.go = true;
    keepScreenOn(true);   // v96
    store('sofia_course', JSON.stringify({ placeId: route.placeId, at: Date.now() }));
    document.getElementById('panel').classList.add('course');
    courseBegin();
    if (isPhone()) closeSheet();   // the map and the banner; the chain is a tap away
    if (following) setFollow(false);
    setLocFollow(true);
    centreOnMe(true);
    renderRoute();
  }
  function courseBegin() {   // guidance from the first leg of the main way
    route.leg = 0; route.phase = legPhase(route.ways[0] && route.ways[0].legs[0]);
    route.offAt = 0; route.boardHits = 0; route.nextOff = false; route.soonBuzz = false;
    courseTrack();
    courseTick();
  }
  function courseStop() {
    keepScreenOn(false);   // v96
    store('sofia_course', '');
    document.getElementById('panel').classList.remove('course');
    if (route && route.trackKey && selected && selected.d.key === route.trackKey) stopTracking();
  }
  function curLeg() { return route && route.ways[0] ? route.ways[0].legs[route.leg] : null; }
  function stopLLx(s) { var st = ttStop(s); return st ? [st.lat, st.lon] : null; }
  // distance (m) from p to a polyline, and the metres left along it from the closest point
  function alongPath(p, pts) {
    var best = Infinity, left = 0, cos = Math.cos(toRad(p[0])), bi = 0, bt = 0;
    for (var i = 1; i < pts.length; i++) {
      var ax = (pts[i - 1][1] - p[1]) * cos, ay = pts[i - 1][0] - p[0], bx = (pts[i][1] - p[1]) * cos, by = pts[i][0] - p[0];
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      var d = Math.sqrt((ax + dx * t) * (ax + dx * t) + (ay + dy * t) * (ay + dy * t)) * 111320;
      if (d < best) { best = d; bi = i; bt = t; }
    }
    if (bi) {
      left = distM(pts[bi - 1], pts[bi]) * (1 - bt);
      for (var j = bi + 1; j < pts.length; j++) left += distM(pts[j - 1], pts[j]);
    }
    return { off: best, left: left };
  }
  // the planned walking line: from where you were when the way was planned (not from where you are now, else you'd
  // never be off it)
  function walkPts(lg, me, pl) {
    var a = lg.from === -1 && route.from ? route.from : legLL(lg.from, me, pl), b = legLL(lg.to, me, pl);
    return lg.street ? [a].concat(lg.pts, [b]) : [a, b];
  }
  // the vehicle has gone past stop s on the leg's own trip (not just on its way back after this run)
  function vehPassed(v, lg) {
    if (!v || v.d.tripRef !== lg.tid) return false;
    loadTripStops(v.d.tripRef);
    var rs = computeRouteStops(v), tw = twinsOf(tt.stopIds[lg.from]);
    return rs.length > 0 && !rs.some(function (r) { return tw.indexOf(r.stop.id) >= 0; });
  }
  // the vehicle of the current leg on the map: tracked towards your stop (waiting) or where you get off (riding)
  function courseTrack() {
    var lg = curLeg(), lv = lg && lg.kind === 'ride' && lg.live, v = lv && lv.key && vehicles[lv.key];
    if (!v || (route.phase !== 'wait' && route.phase !== 'ride')) {
      if (route.trackKey && selected && selected.d.key === route.trackKey) stopTracking();
      route.trackKey = '';
      return;
    }
    var st = stops[tt.stopIds[route.phase === 'wait' ? lg.from : lg.to]];
    var keepCam = loc.follow;
    pendingFocusStop = st;
    pendingGuessEta = route.phase === 'wait' && lv.guess ? { predicted: tt.base + lv.dep * 1000, g: { sameWay: lv.guess.sameWay, stopOnNew: lv.guess.stopOnNew || 0, tripId: lg.tid } } : null;
    if (selected === v) {
      focusedStop = pendingFocusStop; focusGuessEta = pendingGuessEta; pendingFocusStop = null; pendingGuessEta = null;
      drawFocusStop(); drawRouteStops(); if (shapes) drawPath(v);
    } else select(v);
    route.trackKey = v.d.key;
    if (keepCam) setLocFollow(true);   // tracking doesn't take the camera from you
  }
  function courseNext(msg) {
    route.leg++; route.offAt = 0; route.boardHits = 0; route.nextOff = false; route.soonBuzz = false;
    var lg = curLeg();
    route.phase = legPhase(lg);
    if (route.phase === 'done') {
      var pl = savedPlaces.find(route.placeId);
      toast('You\'ve arrived' + (pl ? ' at ' + pl.name : '') + '.', 6000);
      buzz([200, 100, 200]);   // v96
      courseTrack();
      setTimeout(function () { if (route && route.phase === 'done') endRoute(); }, 10000);
    } else {
      if (msg) toast(msg, 4000);
      courseTrack();
    }
    renderRoute();
  }
  function courseBoard() {
    var lg = curLeg(), to = ttStop(lg.to);
    route.phase = 'ride'; route.boardHits = 0;
    toast('On board — get off at ' + (titleCaseBg(to && to.name) || 'your stop') + '.', 4000);
    courseTrack();
    renderRoute();
  }
  function courseReplan(msg) {
    if (msg) toast(msg, 5000);
    route.ways = []; route.phase = null; route.leg = 0; route.trackKey && selected && selected.d.key === route.trackKey && stopTracking();
    route.trackKey = '';
    routeLayer.clearLayers();
    routeSearch();
  }
  function courseTick() {
    if (!route || !route.go || !route.ways.length || !loc.fix || route.phase === null || route.phase === 'done' || routeBusy) return;
    var way = realize(route.ways[0]), lg = way.legs[route.leg], me = loc.fix.ll, meA = [me.lat, me.lng], pl = savedPlaces.find(route.placeId), now = Date.now();
    var acc = Math.min(loc.fix.acc || 0, 60), speed = meSpeed();
    if (!lg || !pl) return;
    if (route.phase === 'walk') {
      var tgt = legLL(lg.to, me, pl);
      if (distM(meA, tgt) <= Math.max(lg.to === -2 ? ARRIVED_M : AT_STOP_M, acc)) { courseNext(); return; }
      var ap = alongPath(meA, walkPts(lg, me, pl));
      if (ap.off > OFF_COURSE_M) {   // walking somewhere else: a new plan from here after a while
        if (!route.offAt) route.offAt = now;
        else if (now - route.offAt > OFF_COURSE_MS) { courseReplan('You went another way — here\'s a new route.'); return; }
      } else route.offAt = 0;
    } else if (route.phase === 'wait') {
      var lv = lg.live || {}, v = lv.key && vehicles[lv.key], sA = stopLLx(lg.from), dStop = sA ? distM(meA, sA) : 0;
      if (v && v.pos && distM(meA, v.pos) < BOARD_M && speed > 2.5) {   // next to the vehicle and moving with it
        if (++route.boardHits >= 2) { courseBoard(); return; }
      } else route.boardHits = 0;
      // no vehicle to watch (metro, timetable only): away from the stop, fast, along the line
      if (!v && dStop > 150 && speed > 4 && alongPath(meA, ridePath(lg) || []).off < 60) { courseBoard(); return; }
      var gone = v ? vehPassed(v, lg) && (!v.pos || distM(meA, v.pos) > 150) : tt.base + lv.dep * 1000 + 120000 < now && dStop < 150;
      // v96: a buzz once when it's about a minute away
      if (lv.dep && lv.dep - (now - tt.base) / 1000 <= 60 && !route.soonBuzz) { route.soonBuzz = true; buzz(250); }
      if (gone) {
        var line = (routes[tt.patRoute[lg.p]] || {}).short || '';
        courseReplan(typeOf(lg) + ' ' + line + ' left without you — here\'s a new route.');
        return;
      }
    } else if (route.phase === 'ride') {
      var lv2 = lg.live || {}, v2 = lv2.key && vehicles[lv2.key], sB = stopLLx(lg.to), dTo = sB ? distM(meA, sB) : Infinity;
      if (dTo < 60 + acc && (speed < 2 || (v2 && v2.pos && distM(meA, v2.pos) > 150))) {
        var after = way.legs.slice(route.leg + 1).filter(function (l) { return l.kind === 'ride'; })[0];
        courseNext(after ? 'Off — now to ' + typeOf(after) + ' ' + ((routes[tt.patRoute[after.p]] || {}).short || '') + '.' : 'Off — walk to ' + (pl ? pl.name : 'your place') + '.');
        return;
      }
      // "get off at the next stop": the vehicle's next stop is yours
      if (v2) {
        var rs = computeRouteStops(v2), tw = twinsOf(tt.stopIds[lg.to]);
        var nxt = rs.length && tw.indexOf(rs[0].stop.id) >= 0;
        if (nxt && !route.nextOff) { route.nextOff = true; toast('Next stop: get off.', 5000); buzz([300, 150, 300]); renderRoute(); }
      }
      // off somewhere else (slow, away from the line and from your stop)
      if (speed < 1 && dTo > 250 && alongPath(meA, ridePath(lg) || []).off > 120) { courseReplan('You got off elsewhere — here\'s a new route.'); return; }
    }
  }
  setInterval(courseTick, 2000);   // also between fixes (the vehicles move)
  // the next step, for the banner (phones: in the panel; PC: on top of the card)
  function courseBannerHtml(inCard) {
    var way = realize(route.ways[0]), lg = way.legs[route.leg], pl = savedPlaces.find(route.placeId), me = loc.fix ? loc.fix.ll : null;
    var nowS = (Date.now() - tt.base) / 1000, top = '', bot = '', badge = '', cls = '';
    if (route.phase === 'done' || !lg) { top = 'You\'ve arrived'; bot = pl ? esc(pl.name) : ''; cls = ' ok'; }
    else if (route.phase === 'walk') {
      var ap = me ? alongPath([me.lat, me.lng], walkPts(lg, me, pl)) : { left: 0 }, mins = durTxt(ap.left / WALK_MS), next = way.legs[route.leg + 1];
      if (lg.to === -2) { top = 'Walk to ' + esc(pl ? pl.name : 'your place'); bot = fmtM(ap.left) + ' · ' + mins + ' · arrive ' + relClock(way.liveArr); }
      else {
        var st = ttStop(lg.to);
        top = (route.leg ? 'Change: walk to ' : 'Walk to ') + esc(titleCaseBg(st && st.name) || 'the stop');
        bot = fmtM(ap.left) + ' · ' + mins + (next && next.live ? ' · ' + badgeHtml(next, 'span') + ' ' + minsTo(next.live.dep, nowS) + ' · ' + spareHtml(next.live.dep - nowS - ap.left / WALK_MS) : '');
      }
    } else if (route.phase === 'wait') {
      var lv = lg.live || {}, line = (routes[tt.patRoute[lg.p]] || {}).short || '', to = ttStop(lg.to);
      badge = badgeHtml(lg, 'span');
      top = esc(typeOf(lg)) + ' ' + esc(line) + ' ' + minsTo(lv.dep, nowS);
      bot = (lv.ret ? 'after its current run' : lv.away !== null && lv.away !== undefined ? (lv.away === 0 ? 'next stop is yours' : lv.away + (lv.away === 1 ? ' stop' : ' stops') + ' away') : KIND_TXT[lv.kind]) +
        ' · then ' + (lg.aPos - lg.bPos) + ' stops to ' + esc(titleCaseBg(to && to.name) || 'your stop');
      if (lv.dep - nowS < 120) cls = ' soon';
    } else {
      var lv3 = lg.live || {}, to3 = ttStop(lg.to), v3 = lv3.key && vehicles[lv3.key], left = null;
      if (v3) { var rs = computeRouteStops(v3), tw = twinsOf(tt.stopIds[lg.to]); for (var i = 0; i < rs.length; i++) if (tw.indexOf(rs[i].stop.id) >= 0) { left = i + 1; break; } }
      badge = badgeHtml(lg, 'span');
      top = 'Get off at ' + esc(titleCaseBg(to3 && to3.name) || 'your stop');
      bot = route.nextOff ? '<b>Next stop — get off</b>' : (left !== null ? 'in ' + left + (left === 1 ? ' stop' : ' stops') + ' · ' : '') + relClock(lv3.arr);
      if (route.nextOff) cls = ' soon';
    }
    return '<div class="rt-banner' + cls + (inCard ? ' in-card' : '') + '" role="status" aria-live="polite">' + (badge || '<span class="rt-flag">' + FLAG_SVG + '</span>') +
      '<button type="button" class="rt-bt" ' + (inCard ? 'data-rt-me' : 'data-rt-open') + '><b>' + top + '</b><span>' + bot + '</span></button>' +
      '<button type="button" class="rt-x" data-rt-close aria-label="End the route" title="End the route">' + CLOSE_SVG + '</button></div>';
  }
  // phone back on / app back in front: fresh data and a fresh fix now, then the step from where you are
  document.addEventListener('visibilitychange', function () {
    if (!route || !route.go) return;
    if (document.hidden) { route.hiddenAt = Date.now(); return; }
    var away = route.hiddenAt ? Date.now() - route.hiddenAt : 0, woke = false;
    keepScreenOn(true);   // v96: the browser released it when the app went to the background
    route.hiddenAt = 0;
    // (the feed is fetched again by the general handler at the end of the script)
    function wake() {
      if (woke || !route || !route.go) return;
      woke = true;
      if (away < 30000) { courseTick(); return; }
      toast('Updated — the screen was off for ' + Math.max(1, Math.round(away / 60000)) + ' min.', 4000);
      var lg = curLeg(), me = loc.fix && loc.fix.ll;
      // still riding along the line: carry on (the next fixes tell when you get off); otherwise a new plan from here
      if (route.phase === 'ride' && me && lg && alongPath([me.lat, me.lng], ridePath(lg) || []).off < 120) { courseTick(); return; }
      if (route.phase !== 'done') courseReplan(null);
    }
    // a fresh fix is asked for at once, but a phone's first fix after sleep can take a while: the update doesn't
    // wait more than 2.5 s for it (the last known position then; the fresh fix moves things on when it comes)
    setTimeout(wake, away < 30000 ? 0 : 2500);
    try {
      navigator.geolocation.getCurrentPosition(function (p) { onFix(p); wake(); }, function () { wake(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    } catch (e) { wake(); }
  });
  // a route under way survives a reload (the v91 Reload popup, a phone reloading a page kept in the background)
  (function () {
    var c = null;
    try { c = JSON.parse(store('sofia_course') || 'null'); } catch (e) {}
    var p = c && savedPlaces.find(c.placeId);
    if (!p || Date.now() - c.at > COURSE_KEEP_MS) { store('sofia_course', ''); return; }
    setTimeout(function () {
      startRoute(p);
      route.go = true; route.phase = null;   // guidance starts on the first plan from where you are now
      keepScreenOn(true);   // v96
      document.getElementById('panel').classList.add('course');
      setLocFollow(true);
      toast('Carrying on with your route to ' + p.name + '.', 4000);
    }, 0);
  })();

