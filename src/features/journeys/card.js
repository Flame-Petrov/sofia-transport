  // ---- the card: the main way with its chain, the others under it ----
  // Phones: in the bottom sheet (a short bar in the panel brings it back when the sheet is closed). PC: in the panel.
  var routeEl = document.createElement('div');
  routeEl.className = 'rt';
  var sheetRoute = false;
  function showRoute() {
    var card = document.getElementById('routeCard');
    if (!route) {
      card.hidden = true; card.innerHTML = ''; card._h = null;
      if (sheetRoute) closeSheet();
      return;
    }
    if (isPhone()) openRouteSheet();
    else {
      if (sheetRoute) closeSheet();
      if (routeEl.parentNode !== card) { card.innerHTML = ''; card._h = null; card.appendChild(routeEl); }
      card.classList.remove('compact');
      card.hidden = false;
    }
    renderRoute();
  }
  function openRouteSheet() {
    map.closePopup();
    if (sheetStop) { if (sheetMarker) markSel(sheetMarker, false); sheetStop = sheetMarker = null; expandedStop = null; }
    leaveVehSheet();
    if (routeEl.parentNode !== sheetBody) { sheetBody.innerHTML = ''; sheetBody._html = null; sheetBody.className = ''; sheetBody.appendChild(routeEl); }
    sheetRoute = true;
    sheet.classList.add('rsheet');
    sheet.hidden = false;
    renderRoute();
  }
  function leaveRouteSheet() {
    if (!sheetRoute) return;
    sheetRoute = false;
    sheet.classList.remove('rsheet');
    if (routeEl.parentNode === sheetBody) sheetBody.removeChild(routeEl);
    sheetBody.className = 'sp';
    setTimeout(renderRoute, 0);   // the short bar in the panel
  }
  window.addEventListener('resize', function () { if (route) showRoute(); });
  function minsTo(sec, nowS) { var m = Math.round((sec - nowS) / 60); return m <= 0 ? 'now' : m < 60 ? 'in ' + m + ' min' : 'at ' + relClock(sec); }
  function durTxt(sec) { var m = Math.max(1, Math.round(sec / 60)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + ('0' + m % 60).slice(-2) + ' min'; }
  var KIND_TXT = { live: 'live', est: '≈ estimate', sched: 'timetable' };
  // the attributes that make a button track a ride's vehicle to the stop where you get on (the [data-veh] handler)
  function vehAttrs(lg, cls) {
    var lv = lg.live || {};
    return ' data-veh="' + esc(lv.key) + '" data-stop="' + esc(tt.stopIds[lg.from]) + '"' + (lv.guess ? ' class="' + cls + ' guess" data-eta="' + Math.round(tt.base + lv.dep * 1000) +
      '" data-same="' + (lv.guess.sameWay ? 1 : 0) + '" data-onnew="' + (lv.guess.stopOnNew || 0) + '" data-trip="' + esc(lg.tid) + '"' : ' class="' + cls + '"');
  }
  function badgeHtml(lg, tag) {
    var color = routeColorOf(lg), tone = lineTones(color), line = (routes[tt.patRoute[lg.p]] || {}).short || '?', lv = lg.live || {};
    var attrs = '';
    if (tag === 'button' && lv.key && vehicles[lv.key]) {   // tap: the map shows that vehicle coming to your stop
      attrs = vehAttrs(lg, 'rt-badge') + ' title="Show this vehicle on the map"';
    } else { tag = 'span'; attrs = ' class="rt-badge"'; }
    return '<' + tag + attrs + ' style="background:' + color + ';color:' + tone.ink + '">' + esc(line) + '</' + tag + '>';
  }
  function seqHtml(way) {
    return '<div class="rt-seq">' + way.legs.map(function (lg) {
      return lg.kind === 'walk' ? (lg.sec >= 60 || way.rides === 0 ? WALK_SVG : '') : badgeHtml(lg, 'span');
    }).filter(Boolean).join('<span class="sep" aria-hidden="true">›</span>') + '</div>';
  }
  function spareHtml(sp) {
    if (sp === null || sp === undefined) return '';
    var m = Math.round(sp / 60), cls = sp < 0 ? 'miss' : sp < 180 ? 'tight' : 'ok';
    var txt = sp < 0 ? 'you won\'t make it' : m < 1 ? 'tight — hurry' : m + ' min to spare';
    return '<span class="rt-slack ' + cls + '">' + txt + '</span>';
  }
  function typeOf(lg) { return VP_TYPE[(routes[tt.patRoute[lg.p]] || {}).type] || 'Vehicle'; }
  var TRACK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/><path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function firstLine(way, nowS, track) {   // track (v99): add "Track this bus" (the main way's card only: the others are buttons themselves)
    var lg = way.legs.filter(function (l) { return l.kind === 'ride'; })[0];
    if (!lg) return '<div class="rt-first">' + durTxt(way.walk) + ' on foot · ' + (way.legs[0].street ? '' : '≈ ') + fmtM(way.legs[0].street ? way.legs[0].m : (way.legs[0].m || 0) * WALK_DETOUR) + '</div>';
    var lv = lg.live, st = ttStop(lg.from), leave = lv.leave - nowS;
    return '<div class="rt-first">' + esc(typeOf(lg)) + ' ' + esc((routes[tt.patRoute[lg.p]] || {}).short || '') + ' ' + minsTo(lv.dep, nowS) +
      ' at ' + esc(titleCaseBg(st && st.name) || 'the stop') + ' · ' + KIND_TXT[lv.kind] +
      (lv.ret ? ' · after its current run' : lv.away !== null ? ' · ' + (lv.away === 0 ? 'next stop' : lv.away + (lv.away === 1 ? ' stop' : ' stops') + ' away') : '') +
      '<br>' + leaveHtml(lv, nowS) + '</div>' +
      (track && lv.key && vehicles[lv.key] ? '<button type="button"' + vehAttrs(lg, 'rt-show') + '>' + TRACK_SVG + 'Track this ' + esc(typeOf(lg).toLowerCase()) + '</button>' : '');
  }
  // when to set off for the first stop: by the vehicle's time minus the walk
  function leaveHtml(lv, nowS) {
    var sp = lv.spare, m = Math.floor(sp / 60);
    if (sp < 0) return '<span class="rt-slack miss">You won\'t make it — see the other ways</span>';
    if (sp < 60) return '<span class="rt-slack tight">Leave now — hurry</span>';
    return '<span class="rt-slack ' + (sp < 180 ? 'tight' : 'ok') + '">Leave by ' + relClock(lv.leave) + '</span> · in ' + m + ' min';
  }
  function sumHtml(way, nowS) {
    var walkMin = Math.round(way.walk / 60), meta = way.rides === 0 ? 'on foot' :
      (way.rides === 1 ? 'no change' : (way.rides - 1) + (way.rides === 2 ? ' change' : ' changes')) + (walkMin ? ' · ' + walkMin + ' min walk' : '');
    return '<div class="rt-sum"><b>Arrive ' + relClock(way.liveArr) + '</b><span class="rt-dur">' + durTxt(way.liveArr - nowS) + '</span>' +
      (way.easy ? '<span class="rt-easy" title="One vehicle and the least walking">Easiest</span>' : '') + '<span class="rt-meta">' + meta + '</span></div>';   // v97
  }
  function chainHtml(way, nowS, place) {
    var rows = [], t = nowS, me = loc.fix && loc.fix.ll;
    function pt(time, dot, html) { rows.push('<li class="rt-pt"><span class="rt-time">' + (time !== null ? relClock(time) : '') + '</span><span class="rt-dot ' + dot + '"></span><span class="rt-what">' + html + '</span></li>'); }
    function leg(bar, style, html) { rows.push('<li class="rt-leg"><span class="rt-time"></span><span class="rt-bar ' + bar + '"' + style + '></span><span class="rt-what">' + html + '</span></li>'); }
    pt(t, 'me', '<b>You</b>');
    way.legs.forEach(function (lg, n) {
      if (lg.kind === 'walk') {
        var a = legLL(lg.from, me, place), b = legLL(lg.to, me, place), d = lg.street ? lg.m : a && b ? distM(a, b) * WALK_DETOUR : 0;
        var nextRide = way.legs[n + 1];
        leg('walk', '', 'Walk ' + (lg.street ? '' : '≈ ') + fmtM(d) + ' · ' + durTxt(lg.sec) + (n === 0 && nextRide && nextRide.live ? '<small>by ' + relClock(nextRide.live.leave) + ' at the latest</small>' : '') +
          (n > 0 && lg.to !== -2 ? '<small>change</small>' : ''));
        t += lg.sec;
        if (lg.to === -2) pt(t, 'dest', '<b>' + esc(place.name) + '</b>');
        return;
      }
      var lv = lg.live, from = ttStop(lg.from), to = ttStop(lg.to), color = routeColorOf(lg), info = trips[lg.tid] || {};
      var prev = way.legs[n - 1];
      if (!prev || prev.kind !== 'ride') pt(lv.dep, '','<b>' + esc(titleCaseBg(from && from.name) || 'Stop') + '</b>' + (from && from.code ? ' <small>stop ' + esc(from.code) + '</small>' : ''));
      else pt(lv.dep, '', 'Change at <b>' + esc(titleCaseBg(from && from.name) || 'the stop') + '</b>');
      var nStops = lg.aPos - lg.bPos;
      leg('ride', ' style="background:' + color + '"', badgeHtml(lg, 'button') + ' ' + esc(typeOf(lg)) + ' → ' + esc(titleCaseBg(info.headsign) || '') +
        '<small>' + (n ? 'comes ' : 'arrives ') + relClock(lv.dep) + ' · ' + KIND_TXT[lv.kind] +
        (lv.ret ? ' · after its current run' : lv.away !== null ? ' · ' + (lv.away === 0 ? 'next stop' : lv.away + (lv.away === 1 ? ' stop' : ' stops') + ' away') : '') +
        (n ? ' · ' + spareHtml(lv.spare) : '') + '</small>' +
        '<small>Ride ' + nStops + (nStops === 1 ? ' stop' : ' stops') + ' · ' + durTxt(lv.arr - lv.dep) + '</small>');
      t = lv.arr;
      var nx = way.legs[n + 1];
      if (!nx || nx.kind === 'walk') pt(lv.arr, '', 'Get off at <b>' + esc(titleCaseBg(to && to.name) || 'the stop') + '</b>');
    });
    return '<ol class="rt-chain">' + rows.join('') + '</ol>';
  }
  function routeHtml() {
    var p = savedPlaces.find(route.placeId), name = p ? p.name : 'your place', nowS = tt ? (Date.now() - tt.base) / 1000 : 0;
    var h = '<div class="rt-head"><span class="rt-flag">' + FLAG_SVG + '</span><div class="rt-tt"><div class="rt-small">Route to</div>' +
      '<div class="rt-name">' + esc(name) + '</div></div>' +
      '<button type="button" class="rt-x" data-rt-close aria-label="Close the route" title="Close the route">' + CLOSE_SVG + '</button></div>';
    function status(txt, err) { return h + '<div class="rt-status' + (err ? ' err' : '') + '" role="status">' + (err ? '' : '<span class="rt-spin" aria-hidden="true"></span>') + esc(txt) + '</div>'; }
    if (route.state === 'wait' && loc.state === 'err') return status(loc.err || 'Location is blocked.', true);
    if (route.state === 'wait' && loc.state === 'off') {
      return status(insecurePage() ? 'Location needs the app opened from its web address (see the note below).' : 'Your location is off: tap the location button (bottom right) to see the way.', true);
    }
    if (route.state === 'wait') return status('Finding your location…');
    if (route.state === 'err') return status(route.msg || 'Something went wrong.', true);
    if (!route.ways.length) return status(tt ? 'Looking for the best way…' : 'Preparing today\'s timetable (once a day)…');
    var ways = route.ways.map(realize), main = ways[0];
    // v95: guidance — the next step on top, the chain with what's done greyed; before it starts, a Start button
    var out = h + (route.go ? courseBannerHtml(true) : '') + '<div class="rt-way main">' + sumHtml(main, nowS) + seqHtml(main) +
      (route.go ? '' : firstLine(main, nowS, true) + '<button type="button" class="rt-go" data-rt-go>' + ROUTE_SVG + 'Start</button>') + chainHtml(main, nowS, p) + '</div>';
    if (ways.length > 1) {
      out += '<div class="rt-alts">Other ways</div>' + ways.slice(1).map(function (w) {
        return '<button type="button" class="rt-way alt" data-rt-pick="' + esc(w.sig) + '" aria-label="Use this way">' + sumHtml(w, nowS) + seqHtml(w) + firstLine(w, nowS) + '</button>';
      }).join('');
    }
    return out + '<div class="rt-foot">Updated ' + clockOf(route.at) + ' · times live where the feed has them, ≈ estimated, or from the timetable</div>';
  }
  function routeBarHtml() {   // phones, sheet closed: a short bar in the panel
    if (route.go && route.ways.length) return courseBannerHtml(false);   // v95: the next step
    var p = savedPlaces.find(route.placeId), way = route.ways[0], nowS = tt ? (Date.now() - tt.base) / 1000 : 0, txt;
    if (way) {
      realize(way);
      var lg = way.legs.filter(function (l) { return l.kind === 'ride'; })[0];
      txt = 'Arrive ' + relClock(way.liveArr) + (lg ? ' · ' + badgeHtml(lg, 'span') + ' ' + minsTo(lg.live.dep, nowS) : ' · on foot');
    } else txt = route.state === 'err' ? 'Route unavailable' : 'Finding the way…';
    return '<button type="button" class="rt-open" data-rt-open><span class="rt-flag">' + FLAG_SVG + '</span><span class="rt-bar-t"><b>' + esc(p ? p.name : 'Route') + '</b>' +
      '<span>' + txt + '</span></span><span class="rt-more" aria-hidden="true">›</span></button>' +
      '<button type="button" class="rt-x" data-rt-close aria-label="Close the route" title="Close the route">' + CLOSE_SVG + '</button>';
  }
  // v99: the vehicles of the main way on the map (see routeVeh): their tags follow the card (every feed update and
  // minute), ridden ones drop off during guidance; the other vehicles are dimmed while there's at least one
  function updateRouteVehs() {
    var next = {}, way = route && route.state === 'ok' && route.ways[0], nowS = tt ? (Date.now() - tt.base) / 1000 : 0, firstRide = -1, k;
    if (way && tt) way.legs.forEach(function (lg, i) {
      if (lg.kind !== 'ride') return;
      if (firstRide < 0) firstRide = i;
      var lv = lg.live;
      if (!lv || !lv.key || !vehicles[lv.key] || next[lv.key] || (route.go && i < route.leg)) return;
      var m = Math.round((lv.dep - nowS) / 60), when = m <= 0 ? 'now' : m < 60 ? m + ' min' : relClock(lv.dep);
      var tag = route.go && i === route.leg && route.phase === 'ride' ? 'On board' : (i === firstRide ? 'Board · ' : 'Change · ') + (lv.guess ? '≈ ' : '') + when;
      next[lv.key] = { tag: tag, stopId: tt.stopIds[lg.from],
        guess: lv.guess ? { predicted: Math.round(tt.base + lv.dep * 1000), g: { sameWay: !!lv.guess.sameWay, stopOnNew: lv.guess.stopOnNew || 0, tripId: lg.tid } } : null };
    });
    var old = routeVeh, all = {}, changed = false;
    routeVeh = next;
    for (k in old) { all[k] = 1; if (!next[k]) changed = true; }
    for (k in next) { all[k] = 1; if (!old[k]) changed = true; }
    for (k in all) {
      var v = vehicles[k];
      if (!v || !v.pill) continue;
      var ik = iconKey(v.d);
      if (ik === v.k) continue;
      v.k = ik; v.pill.setIcon(iconFor(v.d));
      if (v !== selected) v.pill.setZIndexOffset(next[k] ? 2000 : 0);
      keepTop(v);
    }
    document.getElementById('map').classList.toggle('rt-dim', Object.keys(next).length > 0);
    if (canvas._container) L.DomUtil.addClass(canvas._container, 'veh-dots');
    if (changed) render(false);
  }
  function renderRoute() {
    var card = document.getElementById('routeCard');
    if (!route) { updateRouteVehs(); return; }
    var html = routeHtml();
    updateRouteVehs();   // v99 (after routeHtml: it brings the live vehicles of the ways up to date)
    if (routeEl._h !== html) {
      var sc = routeEl.parentNode, top = sc ? sc.scrollTop : 0;
      routeEl.innerHTML = html; routeEl._h = html;
      if (sc && top) sc.scrollTop = top;
    }
    if (isPhone()) {
      if (sheetRoute) { card.hidden = true; return; }
      var bar = routeBarHtml();
      card.classList.add('compact');
      if (card._h !== bar) { card.innerHTML = bar; card._h = bar; }
      card.hidden = false;
    }
  }
  // the card's buttons (capture: Leaflet stops clicks inside popups from bubbling)
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-rt-close],[data-rt-pick],[data-rt-open],[data-rt-go],[data-rt-me]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (t.hasAttribute('data-rt-close')) endRoute();
    else if (t.hasAttribute('data-rt-go')) startCourse();
    else if (t.hasAttribute('data-rt-me')) { setLocFollow(true); centreOnMe(false); }
    else if (t.hasAttribute('data-rt-open')) openRouteSheet();
    else pickWay(t.getAttribute('data-rt-pick'));
  }, true);

