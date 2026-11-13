  // ---------- Diagnostics ----------
  // Closed by default (remembered). Open, it shows problems first, then what the feed, schedule and map
  // contain as key–value sections. "Copy report" copies the full raw report — the old Debug info text,
  // every line — which is also readable under "Raw log & vehicle samples".
  var diagOpen = false, diagRawText = '', diagDrawn = {}, tilesSaved = null, tilesCountAt = 0;
  var WARN_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.2v3.4M8 11.6v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function fmtN(n) { return Number(n).toLocaleString('en-US'); }
  function fmtMs(t) { return String(t || '').replace(/(\d{4,})/g, function (n) { return fmtN(+n); }); }
  function clockHM(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function drawOnce(id, html) {
    if (diagDrawn[id] === html) return;   // only touch the page when something changed
    diagDrawn[id] = html;
    document.getElementById(id).innerHTML = html;
  }

  // What can be wrong, worst first; computed from the same values as the raw report
  function diagIssues(n, withLine) {
    var out = [], vf = /vector failed: (.*)\)$/.exec(mapMode || '');
    if (feedFailed) out.push({ level: 'err', text: 'Live feed blocked: ' + feedError + '. A CORS proxy can be set in the reload popup ("Still not loading?").' });
    if (staticState === 'failed' || staticState === 'empty') {
      out.push({ level: 'err', text: 'Schedule failed to load: ' + (staticState === 'empty' ? 'it contains no lines' : staticInfo || 'unknown error') });
    }
    if (Object.keys(tuByTrip).length && tuCount === 0) {
      out.push({ level: 'warn', text: 'Trip updates carry no vehicle IDs (0 linked). Arrivals use fleet numbers and best guesses.' });
    }
    if (vf) out.push({ level: 'warn', text: 'Vector map failed (' + vf[1] + ') — using image map.' });
    if (storageOn === false) out.push({ level: 'warn', text: 'Storage unavailable — nothing is cached on this device.' });
    if (staticState === 'ok' && n - withLine > 0) {
      out.push({ level: 'warn', text: (n - withLine) + (n - withLine === 1 ? ' vehicle has' : ' vehicles have') + ' no known line.' });
    }
    if (feedInterval > 15000) out.push({ level: 'warn', text: 'Feed updates slowly (~' + Math.round(feedInterval / 1000) + ' s).' });
    if (loc && loc.state === 'err') out.push({ level: 'warn', text: loc.err });
    return out;
  }

  // v96: the route and its guidance, for Diagnostics and Copy report
  function routeDiag() {
    var p = savedPlaces.find(route.placeId), w = route.ways[0], lg = w && w.legs[route.leg];
    return [
      ['To', p ? p.name : '—'],
      ['State', route.state + (route.go ? ' · guiding: ' + (route.phase || 'planning') + ' (step ' + Math.min(route.leg + 1, w ? w.legs.length : route.leg + 1) + ' of ' + (w ? w.legs.length : '?') + ')' : '')],
      ['Main way', w ? w.legs.map(function (l) { return l.kind === 'walk' ? 'walk' + (l.street ? '' : ' ≈') : ((routes[tt.patRoute[l.p]] || {}).short || '?') + (l.live && l.live.key && vehicles[l.live.key] ? ' (' + vehicles[l.live.key].d.label + ')' : ''); }).join(' › ') : '—'],
      ['Current trip', lg && lg.kind === 'ride' ? lg.tid : '—'],
      ['Screen kept on', route.go ? wakeInfo || '…' : '—'],
      ['Last search', routeInfo.at ? clockHM(routeInfo.at) + ' · ' + fmtN(routeInfo.ms) + ' ms' : '—']
    ];
  }
  // v92: today's timetable index, in one line
  function ttText() {
    if (ttInfo.state === 'failed') return 'Failed: ' + ttInfo.err;
    if (ttInfo.state === 'building') return 'Building…';
    if (ttInfo.state === 'loading') return 'Loading…';
    if (!tt) return staticState === 'ok' ? 'Waiting' : '—';
    return fmtN(tt.nTrips) + ' trips · ' + fmtN(tt.patRoute.length) + ' patterns · ' +
      (ttInfo.from === 'saved' ? 'loaded from storage in ' : 'built in ') + fmtN(ttInfo.ms) + ' ms';
  }
  // How often the live feed is asked for positions and trip updates (shared/transit/live-feed.js)
  function checksText() {
    var s = function (ms) { return (Math.round(ms / 100) / 10) + ' s'; };
    return 'positions every ' + s(pollDelay()) + ' · trip updates every ' + s(TU_REFRESH_MS);
  }
  function renderDiag() {
    var keys = Object.keys(vehicles), withLine = 0, viaPos = 0, viaTu = 0, parked = 0;
    keys.forEach(function (k) {
      var d = vehicles[k].d;
      if (d.inRoutes) withLine++;
      if (d.via === 'position') viaPos++;
      if (d.via === 'trip-update') viaTu++;
      if (vehicles[k].parked) parked++;
    });
    // issue counter on the closed row: errors win over warnings
    var issues = diagIssues(keys.length, withLine);
    var nErr = issues.filter(function (i) { return i.level === 'err'; }).length, nWarn = issues.length - nErr;
    drawOnce('diagCount', nErr ? '<span class="c-err">' + nErr + (nErr === 1 ? ' error' : ' errors') + '</span>'
      : nWarn ? '<span class="c-warn">' + nWarn + (nWarn === 1 ? ' warning' : ' warnings') + '</span>' : '');
    if (!diagOpen) return;   // the rest is only drawn while Diagnostics is open

    var rIds = Object.keys(routes).slice(0, 5).map(function (id) { return id + '→' + routes[id].short + ' (t' + routes[id].type + ')'; });
    var tIds = Object.keys(trips).slice(0, 2);
    var samples = keys.slice(0, 4).map(function (k) {
      var d = vehicles[k].d;
      return 'veh ' + (d.label || '—') + ' | trip ' + (d.tripId || '—') + ' | route ' + (d.routeId || '—') + ' | shown ' + d.shown;
    });
    // the full raw report (exactly the old Debug info text)
    diagRawText = [
      'static: ' + staticState + ', routes ' + Object.keys(routes).length + ', trips ' + Object.keys(trips).length,
      staticInfo,
      'route samples: ' + (rIds.join('; ') || '—'),
      'trip samples: ' + (tIds.join('; ') || '—'),
      'trip-updates with vehicle: ' + tuCount,
      'stops: ' + Object.keys(stops).length + ' · trip updates: ' + (tuSample || '—'),
      'storage: ' + (storageOn === null ? 'checking' : storageOn ? 'on' : 'not allowed here') +
        ' · ' + (mapMode || 'map starting') + ' · tiles from storage: ' + tileHits + ' · schedule: ' + (staticSource || '—'),
      (function () {
        var o = offline.info();
        return 'offline map: ' + o.ready + '/' + o.areas + ' areas saved (' + (o.bytes / 1048576).toFixed(1) + ' MB) · build ' + (o.ver || '—') +
          (o.swapped ? ' (old build gone, switched)' : '') + (o.now ? ' · downloading ' + o.now : '') + (o.err ? ' · error: ' + o.err : '');
      })(),
      'map preload: ' + (!preload.state ? (/^image/.test(mapMode) ? 'not used on the image map' : 'waiting') :
        preload.done + '/' + preload.total + ' tiles (zoom ' + preload.zoom + ', ' + preload.saved + ' already saved' +
        (preload.failed ? ', ' + preload.failed + ' failed' : '') + ')' + (preload.state === 'done' ? ' · done in ' + preload.ms + ' ms' : ' · loading…')),
      'checks: ' + checksText() + (feedFailures ? ' · ' + feedFailures + ' failed in a row' : ''),
      'motion: reports every ~' + Math.round(feedInterval / 1000) + ' s · ' + onScreenCount + ' moving on screen · ' +
        parked + ' waiting at the end of their line' +
        (staleUpdates ? ' · placed directly after a data gap: ' + staleUpdates + '×' : ''),
      'timings: routes ready ' + (timings.shapes || '…') + ' · last tap → route ' + (timings.route || '—') +
        ' · stops ' + (timings.stops || '—') + ' · road snap ' + (timings.snap || '—'),
      'shapes: ' + (shapes ? Object.keys(shapes).length : 'loading…') +
        (snapStats.last ? ' · road snap: ' + snapStats.last : ''),
      'today\'s timetable: ' + ttText() + (tt ? ' · day ' + tt.day + ' · stop_times rows read ' + (tt.rows || '?') + ', kept ' + (tt.kept || '?') +
        ' · footpaths ' + tt.footTo.length + ' · zip ' + tt.id + (ttInfo.phases ? ' · build steps (ms): ' + ttInfo.phases.join(', ') : '') : ''),
      'vehicles ' + keys.length + ': line found ' + withLine + ', via position ' + viaPos + ', via trip-update ' + viaTu,
      selected ? 'tracked: veh ' + (selected.d.label || selected.d.key) + ' | trip ' + (selected.d.tripRef || selected.d.tripId || '—') +
        ' | route ' + ((trips[selected.d.tripRef] || {}).route_id || selected.d.routeId || '—') + ' | via ' + (selected.d.via || 'label') : 'tracked: —',
      'route: ' + (route ? routeDiag().map(function (r) { return r[0].toLowerCase() + ' ' + r[1]; }).join(' · ') : '—'),
      'location: ' + (!loc || loc.state === 'off' ? 'off' : locDiag().map(function (r) { return r[0].toLowerCase() + ' ' + r[1]; }).join(' · ')),
      '3d view: ' + (view3d.diagRows ? view3d.diagRows().map(function (r) { return r[0].toLowerCase() + ' ' + r[1]; }).join(' · ') : '—'),   // v100
      samples.join('\n')
    ].join('\n');
    var raw = document.getElementById('diagRaw');
    if (isRevealed(raw) && raw.value !== diagRawText && document.activeElement !== raw) raw.value = diagRawText;

    drawOnce('diagIssues', issues.map(function (i) {
      return '<div class="dg-issue ' + i.level + '" role="note">' + WARN_SVG + '<span>' + esc(i.text) + '</span></div>';
    }).join(''));

    // tiles saved on the device: counted at most every 10 s
    if (storageOn && Date.now() - tilesCountAt > 10000) {
      tilesCountAt = Date.now();
      idb.count('tiles').then(function (c) { if (c !== null && c !== tilesSaved) { tilesSaved = c; renderDiag(); } });
    }
    function kv(k, v) { return '<div class="dg-kv"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }
    function section(title, rows) {
      return '<div class="dg-sec"><div class="dg-sec-lbl">' + esc(title) + '</div><div class="dg-card">' + rows.join('') + '</div></div>';
    }
    var missing = keys.length - withLine, snapRunning = Object.keys(snapping).length > 0;
    var snapTxt = snapRunning ? 'Running…' : timings.snap === 'saved on device' ? 'Saved on device'
      : snapStats.last ? (/^0\//.test(snapStats.last) ? 'Failed' : 'Done · ' + snapStats.last) : '—';
    drawOnce('diagSections', [
      section('Live feed', [
        kv('Vehicles', fmtN(keys.length) + ' · ' + (staticState !== 'ok' ? 'lines loading' : missing ? fmtN(missing) + ' without line' : 'all lines matched')),
        kv('Report interval', '~' + Math.round(feedInterval / 1000) + ' s'),
        kv('Checks', checksText()),
        kv('Moving on screen', fmtN(onScreenCount) + ' · ' + fmtN(parked) + ' at terminus'),
        kv('Trip updates', tuStats ? fmtN(tuStats.n) + ' stops · delay ' + fmtN(tuStats.delay) : '—'),
        kv('Linked to vehicles', fmtN(tuCount))
      ]),
      section('Schedule', [
        kv('Status', staticState === 'ok' ? 'OK · ' + (staticSavedAt ? 'saved ' + clockHM(staticSavedAt) : 'downloaded')
          : staticState === 'loading' ? 'Loading…' : staticState === 'empty' ? 'Empty' : 'Failed'),
        kv('Lines · trips', fmtN(Object.keys(routes).length) + ' · ' + fmtN(Object.keys(trips).length)),
        kv('Stops · shapes', fmtN(Object.keys(stops).length) + ' · ' + (shapes ? fmtN(Object.keys(shapes).length) : '…')),
        kv('Shared stops', stopTwinPlaces ? fmtN(stopTwinPlaces) + ' merged (bus / trolley / tram at one pole)' : '—'),
        kv('Today\'s timetable', ttText())
      ]),
      section('Map & storage', [
        kv('Base map', /^vector/.test(mapMode) ? 'Vector' : /vector failed/.test(mapMode) ? 'Image (vector failed)' : /^image/.test(mapMode) ? 'Image' : 'Starting…'),
        kv('Storage', storageOn === null ? 'Checking…' : !storageOn ? 'Off' : 'On · ' + (tilesSaved !== null ? fmtN(tilesSaved) + ' tiles cached' : '…')),
        kv('Map preload', !preload.state ? (/^image/.test(mapMode) ? 'Not used (image map)' : 'Waiting') :
          fmtN(preload.done) + ' / ' + fmtN(preload.total) + ' tiles' + (preload.state === 'done' ? ' · done' : ' · loading…')),
        (function () {
          var o = offline.info();
          return kv('Offline map', o.now ? 'Downloading ' + o.now : o.ready + ' / ' + o.areas + ' areas · ' + (o.bytes / 1048576).toFixed(1) + ' MB') +
            kv('Map version', o.ver ? o.ver.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') + (o.swapped ? ' (switched: old build gone)' : '') + ' · kept ' + MAP_VERSION_DAYS + ' days' : '—');
        })(),
        kv('Road snap', snapTxt)
      ]),
      view3d.diagRows ? section('3D view', view3d.diagRows().map(function (r) { return kv(r[0], r[1]); })) : '',   // v100
      selected ? section('Tracked vehicle', [
        kv('Trip ID', selected.d.tripRef || selected.d.tripId || '—'),
        kv('Route ID', (trips[selected.d.tripRef] || {}).route_id || selected.d.routeId || '—'),
        kv('Vehicle ID', selected.d.key || '—'),
        kv('Label', selected.d.label || '—'),
        kv('Matched by', selected.d.via === 'position' ? 'Position feed' : selected.d.via === 'trip-update' ? 'Trip updates' : 'Fleet number only')
      ]) : '',
      loc && loc.state !== 'off' ? section('Your location', locDiag().map(function (r) { return kv(r[0], r[1]); })) : '',
      route ? section('Route', routeDiag().map(function (r) { return kv(r[0], r[1]); })) : '',
      section('Timings', [
        kv('Routes ready', fmtMs(timings.shapes) || '…'),
        kv('Tap → route', fmtMs(timings.route) || '—'),
        kv('Stop lookup', fmtMs(timings.stops) || '—'),
        kv('Route search', routeInfo.at ? fmtN(routeInfo.ms) + ' ms · ' + routeInfo.runs + ' searches · ' + routeInfo.n + ' ways' : '—'),
        kv('Walking paths', walkInfo.n || walkInfo.fail ? fmtN(walkInfo.n) + ' worked out · last ' + fmtN(walkInfo.last) + ' ms · ' + walkInfo.tiles + ' map tiles read' +
          (walkInfo.fail ? ' · ' + walkInfo.fail + ' failed (' + (walkInfo.err || '?') + ')' : '') : '—')
      ].concat(/\d+ ms/.test(timings.snap || '') ? [kv('Road snap', fmtMs(timings.snap))] : []))
    ].join(''));
  }

  // v81: like My places — the Diagnostics row stays where it is and toggles; its chevron turns and the
  // content reveals below it (before, the row folded away and a separate header with ✕ took its place)
  function setDiagOpen(on) {
    diagOpen = on;
    document.getElementById('diagBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
    reveal(document.getElementById('diagBody'), on);
    store('sofia_diag_open', on ? '1' : '0');
    if (on) { diagDrawn.diagIssues = diagDrawn.diagSections = null; renderDiag(); }
  }
  document.getElementById('diagBtn').onclick = function () { setDiagOpen(!diagOpen); };
  if (store('sofia_diag_open') === '1') setDiagOpen(true);

  // Raw log & vehicle samples: collapsed by default, not remembered
  function setRawOpen(on) {
    var raw = document.getElementById('diagRaw');
    reveal(raw, on);
    document.getElementById('rawBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) raw.value = diagRawText;
  }
  document.getElementById('rawBtn').onclick = function () { setRawOpen(!isRevealed(document.getElementById('diagRaw'))); };

  // Copy report: the full raw text. Where the clipboard isn't available (e.g. some browsers for a file
  // opened from disk), the raw log opens with all its text selected, ready to copy.
  document.getElementById('diagCopy').onclick = function () {
    var btn = this, label = btn.querySelector('span');
    renderDiag();
    function shown(t) {
      label.textContent = t;
      clearTimeout(btn._t);
      btn._t = setTimeout(function () { label.textContent = 'Copy report'; }, 1500);
    }
    function fallback() {
      setRawOpen(true);
      var raw = document.getElementById('diagRaw');
      raw.focus();
      raw.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      shown(ok ? 'Copied' : 'Selected');
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(diagRawText).then(function () { shown('Copied'); }, fallback);
    } else fallback();
  };

