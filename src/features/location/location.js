  // ---------- Your location (v75): blue dot, accuracy circle and the way you're facing ----------
  // The button above the zoom buttons (locBox, made with the zoom buttons) cycles:
  //   off → tap: asks for location (and, on iPhone, the compass), flies to you and keeps you in view
  //   keeping you in view → drag the map / tap a vehicle or stop / vehicle Follow: the dot stays, the camera is free
  //   free → tap: back to you, kept in view again
  //   keeping you in view → tap: location off (dot gone, GPS and compass stopped)
  // The beam points the way the phone faces (compass); without a compass (PC, some phones) it shows the
  // GPS direction of travel while you move faster than walking pace, and no beam while you stand.
  var LOC_ZOOM = 16;             // the first fix flies in to this zoom when further out (stops show from 16)
  var LOC_STALE_MS = 30000;      // no fix for this long: the dot turns grey and loses its beam
  var GPS_HEADING_SPEED = 1.5;   // m/s: a GPS direction below this speed is noise
  var COMPASS_LIVE_MS = 2000;    // compass readings this recent win over the GPS direction
  var COMPASS_SMOOTH = 0.2;      // share of each compass step taken (≈ 60 readings a second): calms the jitter
  map.createPane('meAccPane').style.zIndex = 340;   // accuracy circle: under the route line
  map.createPane('mePane').style.zIndex = 620;      // the dot: over vehicles and stops, under the tracked vehicle / open stop
  map.getPane('mePane').style.pointerEvents = 'none';
  var meSvg = L.svg({ pane: 'meAccPane' });   // accuracy circle and the line to your destination
  var loc = {
    state: 'off',      // off | wait (asked, no fix yet) | on | err
    follow: false,     // keeping you in view
    fix: null,         // { ll, acc (m), t, speed, heading }
    first: false,      // the next fix is the first one: fly in
    err: '',
    heading: null,     // degrees from north, unwrapped (keeps counting past 360 so the beam never spins the long way)
    headingSrc: '', headingAt: 0, compassAt: 0, compassOn: false, compassNote: '',
    watchId: null, marker: null, acc: null, waitTimer: 0, tick: 0, drawQueued: false
  };
  var meIcon = L.divIcon({
    className: 'me-mk', iconSize: null,
    html: '<div class="me-cone" hidden><svg viewBox="-60 -60 120 120" aria-hidden="true"><defs>' +
      '<radialGradient id="meBeam" cx="0" cy="0" r="58" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#1A73E8" stop-opacity=".55"/><stop offset="1" stop-color="#1A73E8" stop-opacity="0"/></radialGradient></defs>' +
      // a 70° wedge pointing up (north before rotation)
      '<path d="M0 0L-33.3 -47.5A58 58 0 0 1 33.3 -47.5Z" fill="url(#meBeam)"/></svg></div>' +
      '<div class="me-halo"></div><div class="me-dot"></div>'
  });

  var toastTimer = 0;
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    clearTimeout(toastTimer);
    el.textContent = msg; el.hidden = false;
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 5000);
  }

  // v87: a page opened from a file on the phone (content://…) isn't "secure", so the browser refuses location
  // without even asking. serve.py (Termux on the phone, or on a PC) serves the app at http://localhost:8080/,
  // which counts as secure. The app looks for it: found → switches over (and carries on with location if that
  // was what was tapped); not found → a note with the steps and an Open button (a plain link still works when
  // the browser blocks the check itself).
  // iPhones/iPads can't run the server (no Termux; iOS stops apps in the background), and Files opens an .html
  // as a preview without its scripts — there the app needs an https address: put it in HOSTED_URL once it has one
  // (e.g. GitHub Pages), and the note's Open button goes there on any phone when the local server isn't running.
  var LOCAL_SERVER = 'http://localhost:8080/';
  var HOSTED_URL = 'https://flame-petrov.github.io/sofia-transport/';   // v88: GitHub Pages (repo Flame-Petrov/sofia-transport)
  var IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var secure = { checked: false, found: null, err: '' };
  function insecurePage() { return window.isSecureContext === false; }
  function localTarget(list, locate) {
    var href = location.href;
    try { href = decodeURIComponent(href); } catch (e) {}
    var m = /(\d+_public-transport\.html)/.exec(href);
    var file = m && list && list.indexOf(m[1]) >= 0 ? m[1] : '';   // same version if the server has it, else its newest
    return LOCAL_SERVER + file + (locate ? '#locate' : '');
  }
  function probeServer(cb) {
    var done = false, ctl = window.AbortController ? new AbortController() : null;
    function end(v, err) { if (done) return; done = true; secure.checked = true; secure.found = v; secure.err = err || ''; cb(v); }
    setTimeout(function () { if (ctl) ctl.abort(); end(null, 'no answer'); }, 2500);
    try {
      fetch(LOCAL_SERVER + '__sofia', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) {
          var ok = j && j.app === 'sofia-transit';
          end(ok ? (j.versions || []) : null, ok ? '' : 'another program');
        }, function (e) { end(null, String(e && e.message || e)); });
    } catch (e) { end(null, String(e && e.message || e)); }
  }
  function secureFix(locate) {
    probeServer(function (list) {
      if (list) { location.replace(localTarget(list, locate)); return; }
      showSecBar(locate);
    });
  }
  function showSecBar(locate) {
    clearTimeout(toastTimer); document.getElementById('toast').hidden = true;
    var open = document.getElementById('secOpen'), txt;
    if (HOSTED_URL) {
      txt = 'Location needs a secure page. Open the app from its web address to use it.';
      open.onclick = function () { location.href = HOSTED_URL + (locate ? '#locate' : ''); };
    } else if (IS_IOS) {
      txt = 'On iPhone, location needs the app opened from an https address (documentation, “Host it”).';
      open.onclick = null;
    } else {
      txt = 'Location needs the local server. Start “Sofia Transport” (Termux), then tap Open.';
      open.onclick = function () { location.href = localTarget(secure.found, locate); };
    }
    open.hidden = !open.onclick;
    document.getElementById('secTxt').textContent = txt;
    document.getElementById('secBar').hidden = false;
  }
  document.getElementById('secClose').onclick = function () { document.getElementById('secBar').hidden = true; };

  function locButton() {
    if (loc.state === 'off' || loc.state === 'err') startLocation();
    else if (!loc.follow) { setLocFollow(true); centreOnMe(true); }
    else stopLocation();
  }
  function startLocation() {
    if (insecurePage()) { secureFix(true); return; }   // v87: the browser would refuse without asking
    startCompass();   // first: iPhones only allow asking for the compass inside the tap itself
    if (!navigator.geolocation) { locError('This browser has no location access.'); return; }
    loc.state = 'wait'; loc.err = ''; loc.first = true; loc.lastErr = '';
    permState(function (s) { loc.perm = s; });   // v84: for Diagnostics
    if (following) setFollow(false);
    setLocFollow(true);
    try {
      loc.watchId = navigator.geolocation.watchPosition(onFix, onFixError, { enableHighAccuracy: true, maximumAge: 5000 });
    } catch (e) { locError('Location failed: ' + (e && e.message || e)); return; }
    clearTimeout(loc.waitTimer);
    loc.waitTimer = setTimeout(function () {
      if (loc.state === 'wait') toast('Still looking for you… Is location (GPS) turned on on the device?');
    }, 12000);
    clearInterval(loc.tick);
    loc.tick = setInterval(queueMeDraw, 1000);   // greys the dot / drops the beam when readings stop coming
    updLocUI();
  }
  // v87: opened from a file while the local server runs → use the server (quietly; nothing shown if it isn't)
  if (insecurePage()) probeServer(function (list) { if (list) location.replace(localTarget(list, false)); });
  // v87: arrived from the file page after tapping location → carry on and ask
  if (location.hash === '#locate') {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    if (!insecurePage()) setTimeout(startLocation, 0);
  }
  function stopLocation() {
    if (loc.watchId !== null) { try { navigator.geolocation.clearWatch(loc.watchId); } catch (e) {} }
    loc.watchId = null;
    stopCompass();
    clearTimeout(loc.waitTimer); clearInterval(loc.tick);
    if (loc.marker) { map.removeLayer(loc.marker); loc.marker = null; }
    if (loc.acc) { map.removeLayer(loc.acc); loc.acc = null; }
    loc.state = 'off'; loc.follow = false; loc.fix = null; loc.show = null; loc.hist = null; loc.camHold = false; loc.heading = null; loc.headingSrc = ''; loc.drawnFixT = 0;
    updLocUI();
    if (savedPlaces) savedPlaces.refreshDestination();
    if (route) { route.state = 'wait'; route.ways = []; routeLayer.clearLayers(); renderRoute(); }   // v93: a route needs your location
  }
  function locError(msg) {
    stopLocation();
    loc.state = 'err'; loc.err = msg;
    toast(msg, 7000);
    updLocUI();
  }
  // v89: the dot moves from where it is shown to each new reading over about the time between readings
  // (0.3–1.5 s), so it moves steadily instead of jumping once a second. Readings further than ME_SNAP_M
  // (a first rough fix, after a tunnel) are jumped to.
  var ME_SNAP_M = 150;
  function meShown() { return loc.show ? loc.show.ll : loc.fix ? loc.fix.ll : null; }
  function glideMe(ll) {
    var now = performance.now(), sh = loc.show;
    if (!sh || reduceMotion || sh.ll.distanceTo(ll) > ME_SNAP_M) { loc.show = { ll: ll, from: ll, to: ll, t0: now, dur: 0, fixAt: now }; return; }
    var dur = Math.max(300, Math.min(1500, now - sh.fixAt));
    loc.show = { ll: sh.ll, from: sh.ll, to: ll, t0: now, dur: dur, fixAt: now };
  }
  function onFix(p) {
    var c = p.coords;
    loc.fix = { ll: L.latLng(c.latitude, c.longitude), acc: c.accuracy || 0, t: Date.now(), speed: c.speed, heading: c.heading };
    loc.state = 'on'; loc.err = '';
    glideMe(loc.fix.ll);
    var hist = loc.hist || (loc.hist = []);   // v90: for meSpeed
    hist.push({ ll: loc.fix.ll, t: loc.fix.t });
    while (hist.length > 2 && loc.fix.t - hist[0].t > 6000) hist.shift();
    clearTimeout(loc.waitTimer);
    // no compass: the direction of travel while moving
    if (typeof c.heading === 'number' && !isNaN(c.heading) && (c.speed || 0) >= GPS_HEADING_SPEED &&
        Date.now() - loc.compassAt > COMPASS_LIVE_MS) setHeading(c.heading, 'gps', 1);
    drawMe();
    if (loc.first) { loc.first = false; if (loc.follow) centreOnMe(true); }
    // (later readings: locFrame keeps the camera on the gliding dot)
    updLocUI();
    if (route && (route.state === 'wait' || route.state === 'err')) routeSearch();   // v93: a route was waiting for you
    if (route && route.go) courseTick();   // v95: where you are on the way
  }
  // v84: "permission denied" (code 1) has more than one cause, and the advice has to fit the real one.
  // Seen on Android: the file opened from Downloads (content://…) got "allow it in the site settings" —
  // but a page opened from a file has no web address (origin "null"), so there is no site setting to
  // change. The facts are kept for Diagnostics → Your location (and Copy report).
  function pageContext() {
    var proto = location.protocol, origin = location.origin;
    return { proto: proto, origin: origin, secure: window.isSecureContext,
             localFile: /^(content|file):$/.test(proto) || origin === 'null' };
  }
  function permState(cb) {   // the browser's own answer for this page: granted / prompt / denied ('' if unknown)
    try { navigator.permissions.query({ name: 'geolocation' }).then(function (r) { cb(r.state); }, function () { cb(''); }); }
    catch (e) { cb(''); }
  }
  function deniedAdvice(ctx, state) {
    if (ctx.secure === false) return 'Location only works on a secure page (https or localhost). Start the local server (“Sofia Transport” shortcut or python serve.py) and open http://localhost:8080/.';
    if (ctx.localFile) return 'Location isn’t available here: the app is opened from a file on the device (' + ctx.proto + '//…), and browsers usually don’t give location to files (there’s no site setting for them). Open it from its https address to use location (see the documentation, “Host it”).';
    if (state === 'denied') return 'Location is blocked for this site. Allow it in the browser’s site settings (the icon left of the address), then tap the button again.';
    // not refused for this site, yet refused: the device's own setting for the browser, or location is off
    return 'The device refused location to the browser. Turn location on and let the browser use it (Android: Settings → Apps → Chrome → Permissions → Location), then tap again.';
  }
  function onFixError(e) {
    var code = e && e.code;
    loc.lastErr = 'code ' + code + ' (' + (['', 'PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT'][code] || '?') + ')' + (e && e.message ? ' · ' + e.message : '');
    if (code === 1) {   // PERMISSION_DENIED
      var ctx = pageContext();
      permState(function (state) {
        loc.perm = state;
        if (loc.state === 'off') return;   // switched off meanwhile
        locError(deniedAdvice(ctx, state));
      });
      return;
    }
    // POSITION_UNAVAILABLE / TIMEOUT: the watch keeps trying
    if (loc.state === 'wait') toast('No location yet — is location (GPS) turned on on the device?');
  }

  // Keeping you in view: you sit in the middle of the free map area (phones: between the panel and a sheet)
  function setLocFollow(on) {
    if (!loc || loc.follow === on) return;
    loc.follow = on && loc.state !== 'off' && loc.state !== 'err';
    updLocUI();
    if (view3d.on && view3d.refreshNorth) view3d.refreshNorth();   // v102
  }
  function centreOnMe(fly) {
    if (!loc.fix) return;
    if (view3d.on) { view3d.focus(meShown(), fly ? Math.max(viewZoom(), LOC_ZOOM) : viewZoom(), (freeTop() + freeBottom()) / 2); return; }   // v100
    var size = map.getSize(), top = freeTop(), bottom = freeBottom(), z0 = map.getZoom();
    var z = fly ? Math.max(z0, LOC_ZOOM) : z0;
    var off = L.point(0, (top + bottom) / 2 - size.y / 2);
    var center = map.unproject(map.project(meShown(), z).subtract(off), z);
    if (!fly && map.latLngToContainerPoint(center).distanceTo(size.divideBy(2)) < 2) return;   // already there
    if (reduceMotion) { map.setView(center, z, { animate: false }); return; }
    loc.camHold = true;   // v89: locFrame waits until the flight has landed
    clearTimeout(loc.holdTimer);
    loc.holdTimer = setTimeout(function () { loc.camHold = false; }, 1500);
    map.once('moveend', function () { loc.camHold = false; });
    if (z !== z0) map.flyTo(center, z, { duration: flyDur(center, z) });
    else map.panTo(center, { animate: true, duration: fly ? 0.5 : 0.8, easeLinearity: 0.5 });
  }
  // (dragging the map takes over: see DRAG_TAKEOVER_PX; the dot stays)

  // ---- Compass: which way the phone faces ----
  function screenAngle() {
    var o = screen.orientation;
    return o && typeof o.angle === 'number' ? o.angle : (+window.orientation || 0);
  }
  // Direction from the full phone orientation (not just alpha, which only works with the phone lying
  // flat): the sum of the screen's "up" and the back of the phone, both laid flat onto the ground. Lying
  // flat, the top of the screen counts; held upright (camera forward), the back does; in between, both
  // point the same way. Works in landscape too (the screen's up is then a side of the phone).
  // Device → earth rotation per the W3C spec: R = Rz(alpha)·Rx(beta)·Ry(gamma); earth x = east, y = north.
  function facing(al, be, ga) {
    var r = Math.PI / 180;
    var cA = Math.cos(al * r), sA = Math.sin(al * r), cB = Math.cos(be * r), sB = Math.sin(be * r);
    var cG = Math.cos(ga * r), sG = Math.sin(ga * r), th = screenAngle() * r, sT = Math.sin(th), cT = Math.cos(th);
    var upE = sT * (cA * cG - sA * sB * sG) - cT * sA * cB;   // sin θ · device x + cos θ · device y
    var upN = sT * (sA * cG + cA * sB * sG) + cT * cA * cB;
    var backE = -(cA * sG + sA * sB * cG), backN = cA * sB * cG - sA * sG;   // −(device z)
    var E = upE + backE, N = upN + backN;
    if (E * E + N * N < 1e-6) return null;
    return Math.atan2(E, N) / r;
  }
  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading + screenAngle();   // iPhone
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && typeof e.alpha === 'number' && e.alpha !== null) {
      h = facing(e.alpha, e.beta || 0, e.gamma || 0);
    }
    if (h === null || isNaN(h)) return;
    loc.compassAt = Date.now();
    setHeading(h, 'compass', COMPASS_SMOOTH);
  }
  function startCompass() {
    if (loc.compassOn) return;
    var D = window.DeviceOrientationEvent;
    if (!D) { loc.compassNote = 'not available'; return; }
    loc.compassOn = true; loc.compassNote = '';
    // Android Chrome: the 'absolute' event is north-based; plain 'deviceorientation' is relative there
    // (and north-based with webkitCompassHeading on iPhone)
    window.addEventListener('deviceorientationabsolute', onOrient);
    window.addEventListener('deviceorientation', onOrient);
    // iPhone (iOS 13+) sends nothing until asked, inside the tap. Chrome has requestPermission too (seen
    // in 156) and may answer "denied" on a device without sensors: the listeners stay either way, a
    // blocked compass simply never reports (the beam then uses the GPS direction while moving).
    if (typeof D.requestPermission === 'function') {
      try {
        D.requestPermission().then(function (r) { if (r !== 'granted') loc.compassNote = 'not allowed'; })
          .catch(function () { loc.compassNote = 'not allowed'; });
      } catch (e) {}
    }
  }
  function stopCompass() {
    window.removeEventListener('deviceorientationabsolute', onOrient);
    window.removeEventListener('deviceorientation', onOrient);
    loc.compassOn = false; loc.compassAt = 0;
  }
  function setHeading(h, src, k) {
    h = ((h % 360) + 360) % 360;
    if (loc.heading === null) loc.heading = h;
    else {
      var d = ((h - loc.heading) % 360 + 540) % 360 - 180;   // shortest turn, −180…180
      loc.heading += d * k;
    }
    loc.headingSrc = src; loc.headingAt = Date.now();
    queueMeDraw();
  }

  // ---- Drawing: at most once a frame, however fast the compass reports ----
  function queueMeDraw() {
    if (loc.drawQueued) return;
    loc.drawQueued = true;
    requestAnimationFrame(function () { loc.drawQueued = false; drawMe(); });
  }
  function drawMe() {
    if (!loc.fix || loc.state === 'off' || loc.state === 'err') return;
    var now = Date.now(), ll = meShown(), stale = now - loc.fix.t > LOC_STALE_MS;
    if (!loc.acc) {
      loc.acc = L.circle(ll, { radius: loc.fix.acc, pane: 'meAccPane', renderer: meSvg, interactive: false,
        color: '#1A73E8', weight: 1, opacity: 0.35, fillColor: '#1A73E8', fillOpacity: 0.12 }).addTo(map);
    } else { loc.acc.setLatLng(ll); loc.acc.setRadius(loc.fix.acc); }
    if (!loc.marker) loc.marker = L.marker(ll, { icon: meIcon, pane: 'mePane', interactive: false, keyboard: false }).addTo(map);
    else if (!loc.marker.getLatLng().equals(ll)) loc.marker.setLatLng(ll);
    var el = loc.marker.getElement();
    if (!el) return;
    el.classList.toggle('stale', stale);
    // the beam: a live compass, or a recent GPS direction while moving
    var src = loc.headingSrc, fresh = src === 'compass' ? now - loc.compassAt < COMPASS_LIVE_MS
      : src === 'gps' && now - loc.headingAt < 10000 && (loc.fix.speed || 0) >= GPS_HEADING_SPEED;
    var cone = el.querySelector('.me-cone');
    cone.hidden = !(fresh && loc.heading !== null);
    if (loc.heading !== null) cone.style.setProperty('--h', loc.heading.toFixed(1) + 'deg');
    if (loc.fix.t !== loc.drawnFixT) {
      loc.drawnFixT = loc.fix.t;
      if (savedPlaces) savedPlaces.refreshDestination();
    }
  }
  // rows for Diagnostics
  function locDiag() {
    var now = Date.now(), f = loc.fix;
    var dir = now - loc.compassAt < COMPASS_LIVE_MS ? 'Compass' : loc.headingSrc === 'gps' && now - loc.headingAt < 10000 ? 'GPS (moving)'
      : 'None' + (loc.compassNote ? ' (compass ' + loc.compassNote + ')' : loc.compassOn ? ' (no compass readings)' : '');
    return [
      ['Status', loc.state === 'wait' ? 'Finding…' : loc.state === 'err' ? 'Failed' : loc.follow ? 'On · kept in view' : 'On'],
      ['Accuracy', f ? '± ' + Math.round(f.acc) + ' m' : '—'],
      ['Last fix', f ? Math.round((now - f.t) / 1000) + ' s ago' : '—'],
      ['Direction', dir]
    ].concat(loc.lastErr || loc.state === 'err' ? (function () {   // v84: what the page is and what the browser said
      var c = pageContext();
      return [
        ['Page', c.proto + ' · origin ' + c.origin + (c.localFile ? ' (opened from a file)' : '')],
        ['Secure context', c.secure === true ? 'yes' : c.secure === false ? 'no' : 'unknown'],
        ['Local server', !secure.checked ? 'not checked' : secure.found ? 'running' : 'not found (' + secure.err + ')'],
        ['Permission', loc.perm || 'unknown'],
        ['Last error', loc.lastErr || '—']
      ];
    })() : []);
  }
  function updLocUI() {
    if (!locBox) return;
    var a = locBox.querySelector('a'), s = loc.state;
    locBox.classList.toggle('wait', s === 'wait');
    locBox.classList.toggle('on', s === 'on' || s === 'wait');
    locBox.classList.toggle('follow', s === 'on' && loc.follow);
    locBox.classList.toggle('err', s === 'err');
    var t = s === 'off' || s === 'err' ? 'Show my location' : s === 'wait' ? 'Finding your location… (tap to cancel)'
      : loc.follow ? 'Turn off my location' : 'Back to my location';
    a.title = t; a.setAttribute('aria-label', t);
    a.setAttribute('aria-pressed', s === 'on' && loc.follow ? 'true' : 'false');
  }
