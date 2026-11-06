  // ---------- Static GTFS (line names, types, headsigns) ----------
  var routes = {};   // route_id -> { short, type, color }
  var trips = {};    // trip_id  -> { route_id, headsign }
  var staticState = 'loading', staticInfo = '', staticZip = null;
  var STOP_GRID_DEG = 0.01;   // ~1 km spatial grid for ultra-fast viewport culling
  var stopGrid = {};
  function stopGridKey(lat, lon) {
    return Math.floor(lat / STOP_GRID_DEG) + ':' + Math.floor(lon / STOP_GRID_DEG);
  }
  function indexStop(st) {
    var k = stopGridKey(st.lat, st.lon);
    (stopGrid[k] || (stopGrid[k] = [])).push(st);
  }
  // v77: one pole, several stops. Sofia's GTFS has a separate stop per transport mode where buses,
  // trolleys and trams share a stop: A1325 (bus), TB1325 (trolley) and TM1325 (tram) are all "Хотел
  // Хемус", code 1325, at exactly the same spot (826 such places in Nov 2026: bus+trolley 672,
  // bus+tram 91, all three 63). Before v77 they were three stops drawn on top of each other, and a tap
  // showed the arrivals of only one of them — e.g. the buses, while the trolleys coming were missing
  // until you happened to tap the trolley stop. Stops with the same code within TWIN_M are "twins": one
  // icon is drawn for them and its list shows what is due at all of them.
  var TWIN_M = 30;
  var stopTwins = {}, stopTwinPlaces = 0;   // stop_id -> [stop_ids of the shared stop, itself included]; only stops that have twins
  function buildStopTwins() {
    var byCode = {};
    stopTwins = {}; stopTwinPlaces = 0;
    Object.keys(stops).forEach(function (id) {
      var s = stops[id];
      if (!s.station && s.code) (byCode[s.code] || (byCode[s.code] = [])).push(s);
    });
    Object.keys(byCode).forEach(function (code) {
      var g = byCode[code];
      if (g.length < 2) return;
      g.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      g.forEach(function (s) {
        var tw = g.filter(function (o) { return distM([s.lat, s.lon], [o.lat, o.lon]) <= TWIN_M; })
                  .map(function (o) { return o.id; });
        if (tw.length > 1) { stopTwins[s.id] = tw; if (tw[0] === s.id) stopTwinPlaces++; }
      });
    });
  }
  function twinsOf(id) { return stopTwins[id] || [id]; }

  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function eachRecord(text, fn) {
    var rows = parseCSV(text.replace(/^﻿/, ''));
    if (!rows.length) return;
    var head = rows[0].map(function (h) { return h.trim(); });
    for (var i = 1; i < rows.length; i++) {
      if (rows[i].length < 2) continue;
      var o = {};
      for (var j = 0; j < head.length; j++) o[head[j]] = (rows[i][j] || '').trim();
      fn(o);
    }
  }
  // find a file anywhere in the zip (it may sit inside a sub-folder)
  function zipFile(zip, name) {
    var hits = zip.file(new RegExp('(^|/)' + name.replace('.', '\\.') + '$', 'i'));
    return hits.length ? hits[0].async('string') : Promise.resolve('');
  }

  // The schedule zip (lines, stops, routes) is the biggest download, so it's kept on the phone.
  // A saved copy is used at once; if it's older than 12 h a fresh one is fetched in the
  // background and used from the next opening.
  var STATIC_KEY = 'gtfs-static', STATIC_REFRESH_MS = 12 * 3600e3, staticSource = '', staticSavedAt = 0;
  function loadStatic() {
    idb.get('files', STATIC_KEY).then(function (c) {
      if (c && c.d) {
        staticSource = 'saved copy from ' + new Date(c.t).toLocaleString();
        staticSavedAt = c.t;
        setProgress('lines', 0.6, 'Lines & stops');
        processStatic(c.d, function () { downloadStatic(true); });   // saved copy broken: download
        if (Date.now() - c.t > STATIC_REFRESH_MS) downloadStatic(false);
      } else downloadStatic(true);
    });
  }
  function downloadStatic(apply) {
    fetchWithProgress(src(STATIC_URL), function (f, got) {
      if (apply) setProgress('lines', f !== null ? f * 0.6 : Math.min(0.55, got / 15e6), 'Lines & stops ' + (got / 1e6).toFixed(1) + ' MB');
    })
      .then(function (buf) {
        idb.put('files', STATIC_KEY, { d: buf, t: Date.now() });
        if (apply) { staticSource = 'downloaded'; processStatic(buf, null); }
      })
      .catch(function (e) {
        if (!apply) return;
        console.warn('Static GTFS failed:', e);
        staticState = 'failed'; staticInfo = String(e && e.message || e);
        setProgress('lines', 1, 'Lines unavailable');
        update(true);
      });
  }
  function processStatic(buf, onBroken) {
    try { buf = new Uint8Array(buf).slice().buffer; } catch (e) {}   // plain local copy of the saved bytes
    JSZip.loadAsync(buf)
      .then(function (zip) {
        staticZip = zip;
        staticInfo = 'zip files: ' + Object.keys(zip.files).slice(0, 12).join(', ');
        return Promise.all([zipFile(zip, 'routes.txt'), zipFile(zip, 'trips.txt'), zipFile(zip, 'stops.txt')]);
      })
      .then(function (txt) {
        eachRecord(txt[0], function (r) {
          routes[r.route_id] = {
            short: r.route_short_name || r.route_long_name || r.route_id,
            type: parseInt(r.route_type, 10),
            color: r.route_color ? '#' + r.route_color : null
          };
        });
        eachRecord(txt[1], function (t) {
          trips[t.trip_id] = { route_id: t.route_id, headsign: t.trip_headsign || '', shape_id: t.shape_id || '', sid: t.service_id || '' };
        });
        eachRecord(txt[2], function (st) {
          if (!st.stop_lat || !st.stop_lon) return;
          var obj = {
            id: st.stop_id, name: st.stop_name || '', code: st.stop_code || '',
            lat: +st.stop_lat, lon: +st.stop_lon, station: st.location_type === '1'
          };
          stops[st.stop_id] = obj;
          indexStop(obj);
        });
        buildStopTwins();
        staticState = Object.keys(routes).length ? 'ok' : 'empty';
        setProgress('lines', 1, 'Lines & stops');
        afterLoad(function () { loadShapes(); });   // routes ready before the first tap
        afterLoad(function () { setTimeout(ttEnsure, 1500); });   // v92: today's timetable, in the background
        renderStops();
        update(true);
      })
      .catch(function (e) {
        if (onBroken) { onBroken(); return; }
        console.warn('Static GTFS failed:', e);
        staticState = 'failed'; staticInfo = String(e && e.message || e);
        setProgress('lines', 1, 'Lines unavailable');
        update(true);
      });
  }

