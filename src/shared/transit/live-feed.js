  // ---------- Fetching ----------
  var lastHeaderTs = 0, feedTime = 0, busy = false, staleFeed = false, staleUpdates = 0;
  var feedFailed = false, feedError = '', feedFailures = 0;

  function applyTripUpdates(buf) {
    if (!buf) return;
    try {
      var tum = decode(buf);
      var byVehicle = {}, count = 0, byTrip = {}, byStop = {};
      var nStu = 0, withTime = 0, withDelay = 0, withStop = 0;
      (tum.entity || []).forEach(function (e) {
        var tu = e.trip_update;
        if (!tu || !tu.trip) return;
        var vehId = tu.vehicle ? (tu.vehicle.id || tu.vehicle.label || '') : '';
        if (tu.vehicle) {
          count++;
          if (tu.vehicle.id) byVehicle[tu.vehicle.id] = tu.trip;
          if (tu.vehicle.label) byVehicle[tu.vehicle.label] = tu.trip;
        }
        var tid = tu.trip.trip_id || '';
        var stus = (tu.stop_time_update || []).map(function (u) {
          var ev = u.arrival || u.departure || {};
          nStu++;
          if (ev.time) withTime++;
          if (typeof ev.delay === 'number') withDelay++;
          if (u.stop_id) withStop++;
          return {
            stopId: u.stop_id || '', seq: typeof u.stop_sequence === 'number' ? u.stop_sequence : null,
            t: ev.time ? ev.time * 1000 : null, delay: typeof ev.delay === 'number' ? ev.delay : null,
            skipped: u.schedule_relationship === 1
          };
        });
        if (!tid) return;
        byTrip[tid] = { stus: stus, vehId: vehId, startDate: tu.trip.start_date || '',
                          delay: typeof tu.delay === 'number' ? tu.delay : null };
        stus.forEach(function (x) {
          if (!x.stopId || x.skipped) return;
          (byStop[x.stopId] || (byStop[x.stopId] = [])).push({ tripId: tid, vehId: vehId, t: x.t });
        });
      });
      tuByVehicle = byVehicle; tuCount = count; tuByTrip = byTrip; stopIndex = byStop;
      tuSample = nStu + ' stop updates (time ' + withTime + ', delay ' + withDelay + ', stop_id ' + withStop + ')';
      tuStats = { n: nStu, time: withTime, delay: withDelay, stop: withStop };
      return true;
    } catch (e) { console.warn('Trip updates decode failed:', e); return false; }
  }

  var unresolvedPositions = [];
  // `arrived` is when this file came in. A vehicle's `seenAt` is when its last new report came in.
  function applyPositions(msg, arrived) {
    unresolvedPositions = [];
    var seen = {}, gaps = [];
    tripToVeh = {}; vehByLabel = {};
    (msg.entity || []).forEach(function (ent) {
      if (ent.is_deleted || !ent.vehicle || !ent.vehicle.position) return;
      var d = describe(ent);
      if (!d.lat || !d.lon) return;
      seen[d.key] = true;
      if (d.tripRef) tripToVeh[d.tripRef] = d.key;
      if (d.label) vehByLabel[d.label] = d.key;
      if (d.via !== 'position') unresolvedPositions.push(ent);
      var old = vehicles[d.key], fresh = !!(old && d.ts && old.d.ts && d.ts > old.d.ts);
      if (fresh && old.seenAt && arrived) gaps.push(arrived - old.seenAt);
      upsert(d);
      if (fresh && arrived) old.seenAt = arrived;
    });
    learnReportInterval(gaps);
    Object.keys(vehicles).forEach(function (k) {
      var v = vehicles[k];
      if (v.d.metroPlan) return;
      if (seen[k]) { if (v.parked) setParked(v, false); return; }
      if (v.parked ? Date.now() - v.parkedSince < PARK_MAX_MS : nearEndOfRun(v)) { setParked(v, true); return; }
      dotLayer.removeLayer(v.dot);
      v.dotInMap = false;
      if (v.pill) { pillLayer.removeLayer(v.pill); v.pillInMap = false; }
      forgetMotion(v);
      delete vehicles[k];
    });
  }

  // Moves are planned to last until the vehicle's next report arrives (motion.js). That is the time
  // between two sightings of a new report from the same vehicle: its report interval (about 5 s) when
  // checks are more frequent, the check interval when they are slower (Data Saver, a failing feed).
  // The time between checks alone would say 1 s. Only sightings measured on both ends count: a
  // vehicle's first report after it appears was not seen when it was made.
  function learnReportInterval(gaps) {
    if (staleFeed) return;   // after a data gap the sightings are far apart for no reason of the feed's
    gaps = gaps.filter(function (g) { return g > 500 && g < 60000; });
    if (gaps.length < 5) return;
    gaps.sort(function (a, b) { return a - b; });
    var mid = gaps[gaps.length >> 1];
    feedInterval = Math.max(4000, Math.min(25000, feedInterval * 0.7 + mid * 0.3));
  }

  // A feed file, given up after `ms`: a request that never answered used to leave `busy` set, so the map
  // stopped updating for the rest of the session (seen: the trip-updates server hanging for 2 minutes).
  function fetchFeed(u, ms) {
    var ac = window.AbortController ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, ms) : 0;
    return fetch(src(u), { cache: 'no-store', signal: ac ? ac.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (buf) { clearTimeout(timer); return buf; }, function (e) {
        clearTimeout(timer);
        throw (e && e.name === 'AbortError') ? new Error('no answer in ' + ms / 1000 + ' s') : e;
      });
  }

  var updateSequence = 0, lastTripSequence = 0;
  function enrichPositions() {
    var changed = false;
    unresolvedPositions.forEach(function (ent) {
      var d = describe(ent), v = vehicles[d.key];
      if (!v || (v.d.tripRef === d.tripRef && v.d.line === d.line && v.d.via === d.via && v.d.type === d.type && v.d.color === d.color && v.d.headsign === d.headsign)) return;
      if (tripToVeh[v.d.tripRef] === d.key) delete tripToVeh[v.d.tripRef];
      if (d.tripRef) tripToVeh[d.tripRef] = d.key;
      upsert(d);
      changed = true;
    });
    return changed;
  }
  function refreshFeedViews(fleetChanged) {
    if (selected) {
      if (vehicles[selected.d.key] === selected) {
        if (shapes && (!flow || flow.m !== routeMetaFor(selected.d) || atEndOfRun(selected))) {
          drawPath(selected); refreshPopup(selected);
        }
        drawRouteStops(true); // The shared refresh below updates stops after the fleet filter.
      } else deselect();
    }
    if (fleetChanged) render(false);
    else renderStops();
    refreshStopViews();
    renderDiag();
    if (route) renderRoute();
  }
  // Trip updates follow every TU_REFRESH_MS, one request at a time. A forced update (startup, back
  // online) asks at once. Positions never wait for them.
  var tuRequestedAt = 0, tuPending = false;
  function maybeRefreshTripUpdates(force) {
    if (tuPending || (!force && Date.now() - tuRequestedAt < TU_REFRESH_MS)) return;
    tuPending = true;
    tuRequestedAt = Date.now();
    refreshTripUpdates(++updateSequence).then(function () { tuPending = false; });
  }
  function refreshTripUpdates(sequence) {
    return fetchFeed(TU_URL, TU_TIMEOUT_MS).then(function (buf) {
      if (sequence <= lastTripSequence || !applyTripUpdates(buf)) return;
      lastTripSequence = sequence;
      ovCache = null;
      // Resolve missing trip IDs against the most recent positions, even when
      // requests complete out of order. Never replay an older GPS snapshot.
      refreshFeedViews(enrichPositions());
    }).catch(function (e) { console.warn('Trip updates unavailable:', e); });
  }

  // force = reprocess even if the feed hasn't changed (e.g. once line names have loaded)
  function update(force) {
    if (document.hidden || busy) return;
    busy = true;
    return fetchFeed(FEED_URL, FEED_TIMEOUT_MS)
      .then(function (buf) {
        var msg = decode(buf);
        var ts = (msg.header && msg.header.timestamp) || 0;
        lastFeedTime = Date.now();
        feedFailed = false;
        feedFailures = 0;
        showReload(false);
        setProgress('vehicles', 1, 'Vehicles');
        if (!force && ts && ts === lastHeaderTs) { renderFeedStatus(); return; }
        lastHeaderTs = ts;
        feedTime = ts ? ts * 1000 : Date.now();
        if (ts) daylight.clockOffset(feedTime);   // a device clock far off the feed's would skew the sun
        var arrived = Date.now();
        // no new data for a long while (tab in the background, computer asleep, feed stalled):
        // this update places every vehicle where it is instead of animating from its old spot
        staleFeed = !!lastNewDataAt && arrived - lastNewDataAt > Math.max(STALE_FEED_MS, feedInterval * 3);
        if (staleFeed) staleUpdates++;
        lastNewDataAt = arrived;
        applyPositions(msg, arrived);
        staleFeed = false;
        refreshFeedViews(true);
        maybeRefreshTripUpdates(force);
      })
      .catch(function (e) {
        console.warn('Feed failed:', e);
        feedFailed = true;
        feedFailures++;
        feedError = String(e && e.message || e);
        setStatus('err', 'Live feed unavailable');
        setProgress('vehicles', 1, 'Vehicles unavailable');
        showReload(true);
        renderDiag();
      })
      .then(function () { busy = false; });
  }

  // ---------- Checking for new positions ----------
  // One check at a time, the next one REFRESH_MS after the last one started (or after it ended, if it
  // took longer). Data Saver keeps the old 5-second pace; while the feed fails the wait doubles up to
  // REFRESH_MAX_MS. A hidden page stops checking and checks at once when it is shown again.
  var pollTimer = 0;
  function pollDelay() {
    var c = typeof navigator !== 'undefined' && navigator.connection;
    var base = c && c.saveData ? REFRESH_SAVE_DATA_MS : REFRESH_MS;
    return feedFailures ? Math.min(REFRESH_MAX_MS, base * Math.pow(2, feedFailures)) : base;
  }
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = 0;
    if (document.hidden) return;
    var started = Date.now();
    Promise.resolve(update(false)).then(function () {
      if (pollTimer || document.hidden) return;   // a newer poll() already holds the timer
      pollTimer = setTimeout(poll, Math.max(250, pollDelay() - (Date.now() - started)));
    });
  }
  function startPolling() {
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    pollTimer = setTimeout(poll, pollDelay());
  }

