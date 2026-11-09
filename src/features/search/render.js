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
    updateSearchStops(toks, matched);
    renderStops();
    updatePopupPadding();
    feedStatusCount = (toks.length ? fmtN(matched.length) + ' of ' : '') + fmtN(keys.length);
    renderFeedStatus();
  }
  var feedStatusCount = '0';
  function renderFeedStatus() {
    // status: Live (green) / Delayed, no new data for > 30 s (yellow) / feed failing (red) / Loading
    var at = feedTime ? new Date(feedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
    if (feedFailed) setStatus('err', 'Live feed unavailable');
    else if (!feedTime) setStatus('loading', 'Loading…');
    else if (Date.now() - lastNewDataAt > 30000) setStatus('warn', 'Delayed · last data ' + at);
    else setStatus('ok', 'Live · ' + feedStatusCount + ' vehicles · ' + at);
  }

  function flatMarkerView() {
    var b = viewLBounds(0.2);
    return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast(),
             labels: viewZoom() >= LABEL_ZOOM || labelsBySearch };
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
      if (!v.dotInMap) { syncMarkerPosition(v.dot, v.pos); dotLayer.addLayer(v.dot); v.dotInMap = true; }
      if (pillOpen && !v.dot.isPopupOpen()) { v.dot.openPopup(); popupClosedAt = 0; }
    }
  }

  function renderVehicleMarkers(keys, matched) {
    switching = true;
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
        b.innerHTML = '<i style="background:' + g.color + '"></i>' + esc(typeInfo(g.type).name) + ' ' + esc(g.line) +
          ' <small>' + (g.n ? '×' + g.n : 'timetable') + '</small>';
        b.onclick = function () {
          q.value = g.line;
          syncClear();
          if (TYPES[g.type]) setOnlyType(g.type);
          stopIfFiltered();
          render(true);
        };
        box.appendChild(b);
      });
  }

