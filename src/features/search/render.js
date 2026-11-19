  // ---------- Search, filters, rendering ----------
  var q = document.getElementById('q');
  var activeTypes = { 3: true, 0: true, 11: true, 1: true };

  function tokens() { return q.value.toLowerCase().split(/[,\s]+/).filter(Boolean); }
  function matches(d, toks) {
    if (d.type !== null && TYPES[d.type] && !activeTypes[d.type]) return false;
    if (!toks.length) return true;
    var line = String(d.line).toLowerCase(), label = String(d.label).toLowerCase();
    return toks.some(function (t) { return line === t || label === t || String(d.plate).toLowerCase() === t; });
  }

  function render(fit) {
    var toks = tokens(), keys = Object.keys(vehicles), matched = [];
    keys.forEach(function (k) {
      var v = vehicles[k];
      v.filterMatch = matches(v.d, toks);
      if (v.filterMatch) matched.push(v);
    });

    if (fit && toks.length && matched.length) {
      setLocFollow(false);
      map.fitBounds(matched.map(function (v) { return [v.d.lat, v.d.lon]; }), { padding: [60, 60], maxZoom: 16, animate: false });
    }

    labelsBySearch = toks.length > 0 && matched.length <= LABEL_MAX;
    if (view3d.on) view3d.feedChanged(matched);
    else renderVehicleMarkers(keys, matched);
    renderChips(toks);
    renderResults(toks, matched);
    updateSearchStops(toks, matched);
    renderStops();
    updatePopupPadding();
    feedStatusCount = keys.length;
    renderFeedStatus();
  }
  // ---- the city card's status line (release 109) ----
  // Short enough for a phone: "Live · 637 vehicles". After 30 s without new data it turns yellow and says how old the
  // last update is ("Delayed · updated 40 s ago"); red when the feed fails. A tap on the card opens a second line with
  // the clock time of the last update. The search count is on its chip, not here.
  var feedStatusCount = 0;
  function feedAge(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? t('{n} s ago', { n: s }) : t('{n} min ago', { n: Math.round(s / 60) });
  }
  function renderFeedStatus() {
    var now = Date.now(), age = lastNewDataAt ? now - lastNewDataAt : null;
    var at = feedTime ? new Date(feedTime).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
    if (feedFailed) setStatus('err', age !== null ? t('No live data · updated {age}', { age: feedAge(age) }) : t('Live feed unavailable'));
    else if (!feedTime) setStatus('loading', t('Loading…'));
    else if (age > 30000) setStatus('warn', t('Delayed · updated {age}', { age: feedAge(age) }));
    else setStatus('ok', tp(feedStatusCount, 'Live · {count} vehicle', 'Live · {count} vehicles', { count: fmtCount(feedStatusCount) }));
    var more = document.getElementById('statusMore');
    if (more) setText(more, at ? t('Last update {time}', { time: at }) + (age !== null && age > 2000 ? ' · ' + feedAge(age) : '') : '');
  }
  function fmtCount(n) { return Number(n).toLocaleString(LOCALE); }
  setInterval(function () { if (!document.hidden) renderFeedStatus(); }, 1000);   // the age keeps counting while no data comes
  (function () {   // tap the city card: the time of the last update
    var card = document.getElementById('cityCard'), more = document.getElementById('statusMore');
    if (!card || !more) return;
    function toggle() {
      var on = more.hidden;
      more.hidden = !on;
      card.setAttribute('aria-expanded', on ? 'true' : 'false');
      layoutRightEdge();
    }
    card.addEventListener('click', toggle);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  })();

  // ---- search results (release 109): the vehicles a search found, as a list under the search ----
  // Each row: the line badge, where it is going, its fleet number, its next stop and how late it is. A tap tracks
  // that vehicle (the same as tapping it on the map). Shown while a search has 1 to RESULTS_MAX matches and no
  // vehicle is tracked.
  var RESULTS_MAX = 30;
  var resultsHtml = '';
  // 2026-11-19: the list can be put away. Its ✕, a tap on the chip of the search shown (a second tap brings it back)
  // or a tap anywhere outside the list, the search row and the chips hides it; typing in the search shows it again.
  var resultsOpen = true, resultsListable = false;
  function vehNextStop(v) {
    if (v.d.metroRun || typeof computeRouteStops !== 'function') return null;
    var list = computeRouteStops(v);
    return list && list[0] ? list[0] : null;
  }
  function vehDelay(v, next) {   // seconds late (negative: early), or null when the feed does not say
    var tu = tuByTrip[v.d.tripRef];
    if (!tu) return null;
    if (next) {
      for (var i = 0; i < tu.stus.length; i++) {
        var u = tu.stus[i];
        if ((u.stopId && u.stopId === next.stop.id) || (u.seq !== null && u.seq === next.seq)) {
          if (u.delay !== null) return u.delay;
          break;
        }
      }
    }
    return tu.delay;
  }
  function delayText(sec) {
    if (sec === null || sec === undefined) return '';
    var min = Math.round(sec / 60);
    if (min === 0) return '<span class="rs-ok">' + esc(t('on time')) + '</span>';
    return min > 0 ? '<span class="rs-late">' + esc(t('{n} min late', { n: min })) + '</span>'
      : '<span class="rs-early">' + esc(t('{n} min early', { n: -min })) + '</span>';
  }
  function renderResults(toks, matched) {
    var box = document.getElementById('results');
    if (!box) return;
    resultsListable = toks.length > 0 && matched.length > 0 && matched.length <= RESULTS_MAX && !selected;
    var show = resultsListable && resultsOpen;
    var html = '';
    if (show) {
      var list = matched.slice().sort(function (a, b) {
        return String(a.d.line).localeCompare(String(b.d.line), 'bg', { numeric: true }) ||
          String(a.d.headsign || '').localeCompare(String(b.d.headsign || ''), 'bg') ||
          String(a.d.label).localeCompare(String(b.d.label), 'bg', { numeric: true });
      });
      html = '<div class="rs-head"><span>' + esc(tp(list.length, '{n} vehicle found', '{n} vehicles found')) + '</span>' +
        '<button type="button" class="rs-close" aria-label="' + esc(t('Hide results')) + '" title="' + esc(t('Hide results')) + '">' +
        '<svg viewBox="0 0 14 14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3 3l8 8M11 3l-8 8"/></svg>' +
        '</button></div>' +
        list.map(function (v) {
          var d = v.d, tone = lineTones(d.color), next = vehNextStop(v), delay = vehDelay(v, next);
          var title = d.headsign ? t('To {dest}', { dest: titleCaseBg(d.headsign) }) : typeInfo(d.type).name + ' ' + (d.line || '');
          var bits = [];
          if (d.label) bits.push('#' + esc(d.label));
          if (next) {
            var mins = Math.round((next.eta - Date.now()) / 60000);
            bits.push(esc(t('next: {stop}', { stop: titleCaseBg(next.stop.name) })) + ' ' +
              esc((next.realtime ? '' : '~') + (mins <= 0 ? t('now') : t('{n} min', { n: mins }))));
          }
          var late = delayText(delay);
          if (late) bits.push(late);
          if (isParked(d)) bits.push(esc(t('parked')));
          return '<button type="button" class="rs-row" data-veh="' + esc(d.key) + '">' +
            '<span class="rs-badge" style="background:' + d.color + ';color:' + tone.ink + '">' + esc(d.line || d.label || '?') + '</span>' +
            '<span class="rs-txt"><span class="rs-title">' + esc(title) + '</span>' +
            '<span class="rs-sub">' + bits.join('<span class="sep" aria-hidden="true"> · </span>') + '</span></span></button>';
        }).join('');
    }
    if (html !== resultsHtml) {
      resultsHtml = html;
      box.innerHTML = html;
      box.hidden = !html;
      fitPanel();
    }
    syncChipState();
  }
  function setResultsOpen(on) {
    if (resultsOpen === on) return;
    resultsOpen = on;
    var toks = tokens();
    renderResults(toks, Object.keys(vehicles).map(function (k) { return vehicles[k]; }).filter(function (v) { return matches(v.d, toks); }));
  }
  // the chip of the search on screen says whether its list is open (aria-expanded, .open)
  function chipShown(b) {
    return q.value.trim().toLowerCase() === String(b.getAttribute('data-line')).toLowerCase() &&
      Object.keys(activeTypes).every(function (k) { return !!activeTypes[k] === (k === b.getAttribute('data-type')); });
  }
  function syncChipState() {
    var listed = !!resultsHtml;
    document.querySelectorAll('#chips .chip').forEach(function (b) {
      var on = listed && chipShown(b);
      b.classList.toggle('open', on);
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }
  q.addEventListener('input', function () { resultsOpen = true; });
  q.addEventListener('click', function () { if (resultsListable) setResultsOpen(true); });   // a tap in the search: back
  // a tap outside the list, the search row and the chips puts the list away (capture: the map stops some events)
  document.addEventListener('pointerdown', function (e) {
    if (!resultsHtml || !e.target.closest) return;
    if (e.target.closest('#results, #chips, #types, #panel .qrow')) return;
    setResultsOpen(false);
  }, true);
  document.getElementById('results').addEventListener('click', function (e) {
    if (e.target.closest('.rs-close')) { setResultsOpen(false); return; }
    var row = e.target.closest('[data-veh]'), v = row && vehicles[row.getAttribute('data-veh')];
    if (!v) return;
    q.blur();
    var mk = v.pill && v.pillInMap ? v.pill : v.dot;
    if (!map.hasLayer(mk)) { select(v); focusOn(v.pos || [v.d.lat, v.d.lon]); }
    else mk.fire('click');
    renderResults(tokens(), []);
  });

  // ---- vehicle shapes and clusters (release 109) ----
  // Away from the line labels, a vehicle is a dot whose shape says its type as well as its colour (bus and tram are
  // red and orange): bus ●, tram ■, trolley ◆, metro ●. The canvas draws them (DotCanvas in features/offline/areas.js).
  var DOT_SHAPE = { 3: 'circle', 0: 'square', 11: 'diamond', 1: 'circle' };
  // Zoomed out below CLUSTER_ZOOM, crowded spots (CLUSTER_MIN or more vehicles in a CLUSTER_PX square) become one
  // round marker with the count; a tap zooms in there. The tracked vehicle and your way's vehicles never cluster.
  var CLUSTER_ZOOM = 12, CLUSTER_PX = 44, CLUSTER_MIN = 4;
  var clusterLayer = L.layerGroup().addTo(map), clusterHas = null, clusterSig = '';
  function buildClusters(matched) {
    if (view3d.on || map.getZoom() >= CLUSTER_ZOOM) return null;
    var cells = {}, has = {}, out = [];
    matched.forEach(function (v) {
      if (v === selected || routeVeh[v.d.key]) return;
      var p = map.latLngToContainerPoint(v.pos || [v.d.lat, v.d.lon]);
      var k = Math.floor(p.x / CLUSTER_PX) + ':' + Math.floor(p.y / CLUSTER_PX);
      (cells[k] || (cells[k] = [])).push(v);
    });
    Object.keys(cells).forEach(function (k) {
      var c = cells[k];
      if (c.length < CLUSTER_MIN) return;
      c.forEach(function (v) { has[v.d.key] = true; });
      out.push(c);
    });
    return { has: has, list: out };
  }
  function drawClusters(cl) {
    var sig = cl ? cl.list.map(function (c) { return c.length + '@' + c[0].d.key; }).join(',') + '|' + map.getZoom() : '';
    if (sig === clusterSig) return;
    clusterSig = sig;
    clusterLayer.clearLayers();
    if (!cl) return;
    cl.list.forEach(function (c) {
      var lat = 0, lon = 0, byType = {};
      c.forEach(function (v) { var p = v.pos || [v.d.lat, v.d.lon]; lat += p[0]; lon += p[1]; byType[v.d.type] = (byType[v.d.type] || 0) + 1; });
      lat /= c.length; lon /= c.length;
      var top = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; })[0];
      var size = c.length >= 30 ? 40 : c.length >= 10 ? 34 : 28;
      var mk = L.marker([lat, lon], {
        keyboard: false, zIndexOffset: -100,
        icon: L.divIcon({ className: 'vcl', iconSize: [size, size],
          html: '<span style="border-color:' + typeInfo(+top).color + '" aria-label="' + esc(tp(c.length, '{n} vehicle here', '{n} vehicles here')) + '">' + c.length + '</span>' })
      });
      mk.on('click', function () { map.setView([lat, lon], Math.max(CLUSTER_ZOOM, map.getZoom() + 2)); });
      clusterLayer.addLayer(mk);
    });
  }
  map.on('zoomend moveend', function () { if (!view3d.on && (clusterHas || map.getZoom() < CLUSTER_ZOOM)) render(false); });

  function flatMarkerView() {
    var b = viewLBounds(0.2);
    return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast(),
             labels: viewZoom() >= LABEL_ZOOM || labelsBySearch, cluster: clusterHas };
  }

  function updateFlatVehicle(v, view) {
    var lat = v.pos[0], lon = v.pos[1];
    var inside = lat >= view.south && lat <= view.north && lon >= view.west && lon <= view.east;
    var pinned = v === selected || !!routeVeh[v.d.key];
    if (!inside && !pinned && !v.dot.isPopupOpen() && !(v.pill && v.pill.isPopupOpen())) {
      if (v.dotInMap) { dotLayer.removeLayer(v.dot); v.dotInMap = false; }
      if (v.pillInMap) { pillLayer.removeLayer(v.pill); v.pillInMap = false; }
      return;
    }
    if (view.cluster && view.cluster[v.d.key] && !pinned) {   // counted in a cluster marker instead
      if (v.dotInMap) { dotLayer.removeLayer(v.dot); v.dotInMap = false; }
      if (v.pillInMap) { pillLayer.removeLayer(v.pill); v.pillInMap = false; }
      return;
    }
    var asPill = (view.labels && inside) || pinned;
    // when a vehicle switches between dot and label, its open popup moves with it
    if (asPill) {
      var dotOpen = v.dot.isPopupOpen();
      if (v.dotInMap) { dotLayer.removeLayer(v.dot); v.dotInMap = false; }
      var p = ensurePill(v);
      if (!v.pillInMap) { syncMarkerPosition(p, v.pos); pillLayer.addLayer(p); v.pillInMap = true; keepTop(v); }
      if (dotOpen && !p.isPopupOpen()) { p.openPopup(); popupClosedAt = 0; }
    } else {
      var pillOpen = !!(v.pill && v.pill.isPopupOpen());
      if (v.pillInMap) { pillLayer.removeLayer(v.pill); v.pillInMap = false; }
      if (v.dot.options) v.dot.options.shape = DOT_SHAPE[v.d.type] || 'circle';
      if (!v.dotInMap) { syncMarkerPosition(v.dot, v.pos); dotLayer.addLayer(v.dot); v.dotInMap = true; }
      if (pillOpen && !v.dot.isPopupOpen()) { v.dot.openPopup(); popupClosedAt = 0; }
    }
  }

  function renderVehicleMarkers(keys, matched) {
    switching = true;
    var cl = labelsBySearch ? null : buildClusters(matched);
    clusterHas = cl ? cl.has : null;
    drawClusters(cl);
    var view = flatMarkerView();
    matched.forEach(function (v) { updateFlatVehicle(v, view); });
    keys.forEach(function (k) {
      if (vehicles[k].filterMatch) return;
      var v = vehicles[k];
      if (v.dotInMap) { dotLayer.removeLayer(v.dot); v.dotInMap = false; }
      if (routeVeh[k]) { var rp = ensurePill(v); if (!v.pillInMap) { syncMarkerPosition(rp, v.pos); pillLayer.addLayer(rp); v.pillInMap = true; } return; }   // v99: yours stays
      if (v.pillInMap) { pillLayer.removeLayer(v.pill); v.pillInMap = false; }
    });

    switching = false;
  }

  function renderChips(toks) {
    var box = document.getElementById('chips');
    box.innerHTML = '';
    var last = toks[toks.length - 1];
    if (!last) return;
    var groups = {};
    Object.keys(vehicles).forEach(function (k) {
      var d = vehicles[k].d, line = String(d.line);
      if (!line || line.toLowerCase().indexOf(last) !== 0) return;
      var g = line + '|' + d.type;
      if (!groups[g]) groups[g] = { line: line, type: d.type, color: d.color, n: 0 };
      groups[g].n++;
    });
    Object.keys(routes).forEach(function (id) {
      var r = routes[id];
      if (r.type !== 1 || r.short.toLowerCase().indexOf(last) !== 0) return;
      var key = r.short + '|1';
      if (!groups[key]) groups[key] = { line: r.short, type: 1, color: TYPES[1].color, n: 0 };
    });
    Object.keys(groups).map(function (g) { return groups[g]; })
      .sort(function (a, b) { return a.line.length - b.line.length || a.line.localeCompare(b.line, 'bg', { numeric: true }); })
      .slice(0, 14)
      .forEach(function (g) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.setAttribute('data-line', g.line);
        b.setAttribute('data-type', String(g.type));
        // release 109: "Bus 94 · 10 running" instead of "×10"; the shape of the type's map marker in the dot
        b.innerHTML = '<i class="sh-' + (DOT_SHAPE[g.type] || 'circle') + '" style="background:' + g.color + '"></i>' + esc(typeInfo(g.type).name) + ' ' + esc(g.line) +
          ' <small>' + esc(g.n ? tp(g.n, '{n} running', '{n} running') : t('timetable')) + '</small>' +
          (g.n && g.n <= RESULTS_MAX ? '<svg class="chip-car" viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M3 4.5l3 3 3-3"/></svg>' : '');
        b.title = g.n ? t('Show the {n} vehicles of this line', { n: g.n }) : t('No live vehicles: timetable only');
        b.onclick = function () {
          // the chip of the search already shown: a tap hides its list, the next one shows it again
          if (chipShown(b) && resultsListable) { setResultsOpen(!resultsOpen); return; }
          resultsOpen = true;
          q.value = g.line;
          syncClear();
          if (TYPES[g.type]) setOnlyType(g.type);
          stopIfFiltered();
          render(true);
        };
        box.appendChild(b);
      });
  }

