  // ---------- v100: 3D view ----------
  // The 3D button (bottom right, only on the vector map) opens a second, native MapLibre map (#map3d) over the 2D one,
  // at the same place, which then tilts so Sofia's buildings stand up (reports/3D city map - plan.md). Leaflet can't
  // tilt: everything it draws sits in flat screen space and would slide off the streets, so the 3D map draws its own.
  // The 2D map stays the source of truth: the feed, the motion planner, tracking, the route planner and guidance keep
  // running in the 2D code, and the 3D map only draws what they already know (v.pos, loc.show, places…). While it's
  // open, Leaflet's map pane is hidden (its size is kept) and its handlers are off; 2D flattens the view, hands the
  // centre and zoom back to Leaflet, and frees the 3D map. Zooms here are Leaflet's (the 3D map runs one level lower).
  (function () {
    var MEMO_KEY = 'sofia_3d_memo', OPEN_KEY = 'sofia_3d_open', PAD0 = { top: 0, bottom: 0, left: 0, right: 0 };
    var EMPTY = { type: 'FeatureCollection', features: [] };
    var mapEl = map.getContainer();
    var m3 = null, el = null, ready = false, closing = false, revealTimer = 0;
    var camBusy = false, camTimer = 0;   // one of our own camera moves is running (the cameras that follow wait for it)
    var meMk = null, beamMk = null, meKey = '', accKey = '', pinMks = {};
    var pop = null, popKind = '', popRef = null, popClosedAt = 0;
    var info = { opens: 0, lastClose: '', tiles0: 0, hits0: 0, lost: 0 };
    var hiddenAt = 0, hideTimer = 0, addedAt = 0, lp = null;
    // v101: vehicles, the tracked one, its route and stops
    var shown = [], drawn = [], vehDue = 0, vehN = 0, farN = 0, vehMs = [], inkOf = {}, trkMk = null, stopMks = {}, stopsQueued = false, freed = false;
    var trk = { color: '#888', tailRef: null }, fontB = ['Noto Sans Bold'];
    // v102: following cameras, route to a place
    var headingUp = store('sofia_3d_heading') !== 'north', fc = { off: null, at: 0 }, lc = { off: null, at: 0, rest: false };
    var stopsDrawn = [], terrainOn = store('sofia_3d_terrain') === null ? VIEW3D_TERRAIN : store('sofia_3d_terrain') === '1', demAttr = false;   // v103
    var textureBox = document.getElementById('v3Textures');
    var houseBox = document.getElementById('v3HouseDesigns');
    var controlsHelp = document.getElementById('v3Help');
    controlsHelp.querySelector('button').onclick = function () {
      controlsHelp.close();
      if (m3 && !closing) m3.getCanvas().focus({ preventScroll: true });
    };
    controlsHelp.addEventListener('cancel', function (event) { event.preventDefault(); });
    function keyboardCamera(event) {
      if (!ready || closing || controlsHelp.open || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      var key = event.key, move;
      if (key === 'ArrowLeft' || key === 'ArrowRight') move = { bearing: m3.getBearing() + (key === 'ArrowLeft' ? -10 : 10) };
      else if (key === 'ArrowUp' || key === 'ArrowDown') move = { pitch: Math.max(0, Math.min(VIEW3D_MAX_PITCH, m3.getPitch() + (key === 'ArrowUp' ? 5 : -5))) };
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
      m3.jumpTo(move);
    }
    textureBox.checked = store('sofia_3d_building_textures') === '1';
    houseBox.checked = store('sofia_3d_house_designs') === '1';
    var userMoving = false, pointerDown = false, dragFrom = null, dragAt = 0, selfMove = false, lastRender = 0, rtSig = '', rtAt = 0, rtMks = {}, dimNow = null;
    var HANDLERS = ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard'];

    // ---- after a crash: the button stays hidden for VIEW3D_RETRY_MS ----
    function memo() {
      try { var m = JSON.parse(store(MEMO_KEY) || 'null'); return m && Date.now() - m.t < VIEW3D_RETRY_MS ? m : null; } catch (e) { return null; }
    }
    function unstore(k) { try { localStorage.removeItem(k); } catch (e) {} }
    // WebKit can kill and reload a page that uses too much memory without any event: a 3D view still marked open at
    // start-up (opened less than 10 min ago) means the last session died in it. A normal reload or close clears the
    // mark (pagehide).
    (function () {
      var t = +(store(OPEN_KEY) || 0);
      if (t && Date.now() - t < 10 * 60e3) store(MEMO_KEY, JSON.stringify({ t: Date.now(), why: 'the page reloaded while 3D was open' }));
      unstore(OPEN_KEY);
    })();
    window.addEventListener('pagehide', function () { unstore(OPEN_KEY); });
    function available() { return /^vector/.test(mapMode) && !!builtStyle && !memo(); }

    // ---- the buttons and the menu note ----
    function refresh() {
      var show = view3d.on || available(), a = box3d.querySelector('a'), relayout = false;
      if (box3d.hidden === show) { box3d.hidden = !show; relayout = true; }
      if (northBox.inert === view3d.on) { northBox.inert = !view3d.on; relayout = true; }
      box3d.classList.toggle('on', view3d.on);
      var t = view3d.on ? 'Back to the flat map' : 'Show the city in 3D';
      setText(a, view3d.on ? '2D' : '3D');
      if (a.title !== t) { a.title = t; a.setAttribute('aria-label', t); }
      a.setAttribute('aria-pressed', view3d.on ? 'true' : 'false');
      document.getElementById('v3TerRow').hidden = !/^vector/.test(mapMode);   // v103
      document.getElementById('v3TextureRow').hidden = !show || !window.DecompressionStream;
      document.getElementById('v3TextureKey').hidden = !textureBox.checked;
      document.getElementById('v3HouseHint').hidden = !houseBox.checked;
      var m = memo(), bx = document.getElementById('v3Box');
      bx.hidden = !m || !/^vector/.test(mapMode);
      if (m) setText(document.getElementById('v3Note'), '3D was turned off on this device after it ran out of graphics memory (' + clockHM(m.t) + ', ' + m.why + '). It comes back by itself after a day.');
      if (relayout) layoutRightEdge();
    }
    document.getElementById('v3Retry').onclick = function () { unstore(MEMO_KEY); refresh(); };

    // ---- the 3D style: the 2D map's finished style, changed for 3D only ----
    function firstOf(type) {
      var ls = m3.getStyle().layers || [];
      for (var i = 0; i < ls.length; i++) if (ls[i].type === type) return ls[i].id;
      return undefined;
    }
    function style3d() {
      var s = JSON.parse(JSON.stringify(builtStyle)), z = VIEW3D_BUILDING_ZOOM - 1;
      (s.layers || []).forEach(function (l) {
        if (l.type === 'fill-extrusion') {
          l.minzoom = z;
          l.paint = l.paint || {};
          l.paint['fill-extrusion-opacity'] = VIEW3D_BUILDING_OPACITY;
          if (l['source-layer'] === 'building') l.paint['fill-extrusion-opacity-transition'] = { duration: 0, delay: 0 };
          // a gentle tint by height: most buildings have no height in OpenStreetMap and are drawn 5 m tall
          l.paint['fill-extrusion-color'] = ['interpolate', ['linear'], ['to-number', ['get', 'render_height'], 0], 0, '#E6E0D7', 60, '#F2EEE8'];
        } else if (l.type === 'fill' && l['source-layer'] === 'building' && typeof l.maxzoom === 'number') l.maxzoom = z;
      });
      // light from the south-west, fixed to the map, so walls have shade whichever way the camera turns
      s.light = { anchor: 'map', position: [1.5, 225, 35], intensity: 0.35, color: '#FFFFFF' };
      // a pale sky, and fog that matches the land and hides the coarse tiles near the horizon
      s.sky = { 'sky-color': '#DCE9F5', 'horizon-color': '#F6F3EE', 'fog-color': '#F6F3EE',
                'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 };
      return s;
    }

    // ---- open / close ----
    function handlers(on) {
      HANDLERS.forEach(function (h) {
        var x = map[h];
        if (!x) return;
        if (on) { if (x._v3off) { x._v3off = false; x.enable(); } }
        else if (x.enabled()) { x._v3off = true; x.disable(); }
      });
    }
    function open() {
      cancelFocusCard();
      if (view3d.on || !available()) return;
      if (savedPlaces && savedPlaces.isPlacing) savedPlaces.cancelPlacement();
      map.closePopup();
      var c = map.getCenter(), z = map.getZoom();
      el = document.createElement('div');
      el.id = 'map3d';
      mapEl.insertBefore(el, map._controlContainer);   // above the map pane, under the buttons
      L.DomEvent.disableClickPropagation(el);           // taps here are the 3D map's, not Leaflet's
      L.DomEvent.disableScrollPropagation(el);
      try {
        m3 = new maplibregl.Map({
          container: el, style: style3d(), center: [c.lng, c.lat], zoom: z - 1, pitch: 0, bearing: 0,
          minZoom: 8, maxZoom: 18, maxPitch: VIEW3D_MAX_PITCH,
          pixelRatio: mapPixelRatio(),
          antialias: true,
          fadeDuration: 120, maxTileCacheZoomLevels: 3, attributionControl: false, renderWorldCopies: false,
          dragRotate: true, touchPitch: true, pitchWithRotate: true
        });
      } catch (e) {
        if (el) el.remove();
        el = null; m3 = null;
        toast('The 3D view could not start: ' + (e && e.message || e), 6000);
        return;
      }
      view3d.on = true; ready = false; closing = false;
      m3.getCanvas().addEventListener('keydown', keyboardCamera, true);
      controlsHelp.showModal();
      viewBounds01 = null;
      function invalidateBounds() { viewBounds01 = null; }
      m3.on('move', scheduleViewportPrefetch);
      m3.on('move', invalidateBounds);
      m3.on('resize', invalidateBounds);
      info.opens++; info.tiles0 = tileReq; info.hits0 = tileHits;
      store(OPEN_KEY, String(Date.now()));
      handlers(false);
      m3.getCanvas().addEventListener('webglcontextlost', onLost, false);
      // our layers go in as soon as the style is there ('load' waits for the first complete picture)
      m3.once('style.load', onLoad);
      m3.on('styleimagemissing', function (e) {
        if (!m3 || m3.hasImage(e.id)) return;
        if (/^v3pill-/.test(e.id)) addPill(e.id);        // v101: a pill per line colour
        else if (/^v3stop-/.test(e.id)) addStopImg(e.id);   // v103: the stop icon, in a searched line's colour
      });
      // shown once it has drawn (the 2D map stays visible under it until then); on a slow connection after 8 s,
      // with a note after 1.5 s
      m3.once('idle', reveal);
      revealTimer = setTimeout(reveal, 8000);
      setTimeout(function () { if (view3d.on && !ready && !closing) toast('Loading the 3D view…', 2500); }, 1500);
      // v102: the follow cameras move the map every frame (jumpTo): their moveend refreshes labels and stops at most
      // once a second; a user's gesture pauses them until it ends
      m3.on('movestart', function (e) { if (e && e.originalEvent) userMoving = true; });
      m3.on('moveend', function () {
        var now = performance.now();
        if (selfMove) { if (now - lastRender > 1000) { lastRender = now; renderStops(); } return; }
        camBusy = false; userMoving = false; lastRender = now;
        if (view3d.on) render(false);
      });
      // dragging takes over from a following camera once the map has moved DRAG_TAKEOVER_PX (as in 2D)
      // a finger or the mouse on the map pauses the follow cameras: their jumpTo every frame would stop MapLibre's
      // gesture handlers (jumpTo calls stop()), so a drag could never start and the release counted as a tap
      var cont = m3.getCanvasContainer();
      cont.addEventListener('mousedown', pointerOn, true);
      cont.addEventListener('touchstart', pointerOn, { capture: true, passive: true });
      window.addEventListener('mouseup', pointerOff, true);
      window.addEventListener('touchend', pointerOff, true);
      window.addEventListener('touchcancel', pointerOff, true);
      m3.on('dragstart', function () { cancelFocusCard(); dragFrom = m3.getCenter(); dragAt = Date.now(); });
      m3.on('drag', function () {
        if (!dragFrom) return;
        var p = m3.project(dragFrom), c = m3.project(m3.getCenter());
        if (Math.sqrt((p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y)) < DRAG_TAKEOVER_PX) return;
        dragFrom = null;
        if (following) setFollow(false);
        setLocFollow(false);
      });
      m3.on('dragend', function () { dragFrom = null; dragAt = Date.now(); });
      m3.on('rotate', needle);
      m3.on('click', onClick);
      m3.on('contextmenu', function (e) { cancelPress(); addHere(e.lngLat); });
      // a long press: Android and PC send their own (contextmenu, above); iPhones don't, so there it is timed here
      m3.on('touchstart', function (e) {
        cancelPress();
        if (!IS_IOS || e.points.length !== 1) return;
        var at = e.point, ll = e.lngLat;
        lp = { p: at, t: setTimeout(function () { lp = null; addHere(ll); }, 650) };
      });
      m3.on('touchmove', function (e) { if (lp && (e.points.length !== 1 || Math.abs(e.point.x - lp.p.x) + Math.abs(e.point.y - lp.p.y) > 8)) cancelPress(); });
      m3.on('touchend', cancelPress);
      m3.on('touchcancel', cancelPress);
      refresh();
      renderDiag();
    }
    function onLoad() {
      if (!m3 || m3.getSource('v3-me-acc')) return;
      var sym = firstOf('symbol');
      m3.addSource('v3-me-acc', { type: 'geojson', data: EMPTY });
      m3.addLayer({ id: 'v3-me-acc', type: 'fill', source: 'v3-me-acc',
        paint: { 'fill-color': '#1A73E8', 'fill-opacity': 0.12, 'fill-outline-color': 'rgba(26,115,232,.45)' } }, sym);
      accKey = '';
      addOverlays(sym);
      applyBuildingTextures();
      syncPins();
      drawMe3();
    }

    // ---- v101: images, sources and layers for vehicles and the tracked route ----
    function canvas2(w, h, draw) {
      var cv = document.createElement('canvas'), g;
      cv.width = w * 2; cv.height = h * 2;
      g = cv.getContext('2d'); g.scale(2, 2); draw(g);
      return g.getImageData(0, 0, w * 2, h * 2);
    }
    function rr(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    // the line-number label: the line's colour with a white rim, stretched around the text (as the 2D pill)
    function addPill(id) {
      var color = id.slice(7), W = 20, H = 18, R = 7;
      var img = canvas2(W, H, function (g) { g.fillStyle = '#fff'; rr(g, 0, 0, W, H, R); g.fill(); g.fillStyle = color; rr(g, 1.5, 1.5, W - 3, H - 3, R - 1.5); g.fill(); });
      m3.addImage(id, img, { pixelRatio: 2, stretchX: [[2 * R, 2 * (W - R)]], stretchY: [[2 * R, 2 * (H - R)]], content: [6, 4, 2 * W - 6, 2 * H - 4] });
    }
    // v103: the 2D stop icon (white rounded square, bus glyph) as a map image; colour 'x' = the plain dark one
    var BUS_D = (/ d="([^"]+)"/.exec(BUS_SVG) || [])[1] || '';
    function addStopImg(id) {
      var metro = id === 'v3stop-metro', color = metro ? TYPES[1].color : id.slice(7) === 'x' ? '#263238' : id.slice(7), S = 20;
      var img = canvas2(S, S, function (g) {
        g.fillStyle = '#fff'; rr(g, 0.5, 0.5, S - 1, S - 1, 6); g.fill();
        g.lineWidth = 2; g.strokeStyle = color; rr(g, 1.5, 1.5, S - 3, S - 3, 5); g.stroke();
        if (metro) { g.fillStyle = color; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText('M', S / 2, 14.5); }
        else if (BUS_D && window.Path2D) { g.save(); g.translate(3.5, 3.5); g.scale(13 / 24, 13 / 24); g.fillStyle = color; g.fill(new Path2D(BUS_D)); g.restore(); }
      });
      m3.addImage(id, img, { pixelRatio: 2 });
    }
    function setSrc(id, data) { var s = m3 && m3.getSource(id); if (s) s.setData(data); }
    function addOverlays(sym) {
      // a small arrow ahead of each labelled vehicle, lying on the street in its direction
      m3.addImage('v3arrow', canvas2(10, 10, function (g) {
        g.beginPath(); g.moveTo(5, 0.8); g.lineTo(9.2, 9); g.lineTo(5, 7); g.lineTo(0.8, 9); g.closePath();
        g.fillStyle = '#263238'; g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke(); g.fill();
      }), { pixelRatio: 2 });
      // the tracked route's direction arrows (static here; they slide only in 2D)
      m3.addImage('v3chev', canvas2(14, 14, function (g) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(4, 3); g.lineTo(9.5, 7); g.lineTo(4, 11);
        g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      }), { pixelRatio: 2 });
      (m3.getStyle().layers || []).some(function (l) {
        var tf = l.layout && l.layout['text-font'];
        if (Array.isArray(tf) && tf.length && tf.every(function (x) { return typeof x === 'string'; }) && tf.some(function (x) { return /Bold/.test(x); })) { fontB = tf; return true; }
        return false;
      });
      // the tracked route: under the buildings (a building in front hides it, as it hides the street)
      var under = firstOf('fill-extrusion') || sym, U = ui;
      ['v3-trk-tail', 'v3-trk-head', 'v3-trk-x'].forEach(function (id) { m3.addSource(id, { type: 'geojson', data: EMPTY }); });
      var caseW = ['interpolate', ['linear'], ['zoom'], 11, 5, 15, 12], lineW = ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 7];
      var round = { 'line-cap': 'round', 'line-join': 'round' };
      m3.addLayer({ id: 'v3-trk-prev', type: 'line', source: 'v3-trk-x', filter: ['==', ['get', 'dash'], 1], layout: round,
        paint: { 'line-color': ['get', 'c'], 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 6], 'line-dasharray': [0.1, 3] } }, under);
      ['tail', 'head'].forEach(function (p) {
        m3.addLayer({ id: 'v3-trk-case-' + p, type: 'line', source: 'v3-trk-' + p, layout: round, paint: { 'line-color': '#1a1a1a', 'line-opacity': 0.55, 'line-width': caseW } }, under);
      });
      ['tail', 'head'].forEach(function (p) {
        m3.addLayer({ id: 'v3-trk-line-' + p, type: 'line', source: 'v3-trk-' + p, layout: round, paint: { 'line-color': ['get', 'c'], 'line-opacity': 0.85, 'line-width': lineW } }, under);
      });
      m3.addLayer({ id: 'v3-trk-arrow', type: 'symbol', source: 'v3-trk-tail',
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 70 * U, 'icon-image': 'v3chev', 'icon-size': U, 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, under);
      m3.addLayer({ id: 'v3-trk-end', type: 'circle', source: 'v3-trk-x', filter: ['==', ['get', 'end'], 1],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 7], 'circle-color': '#fff', 'circle-stroke-color': '#1a1a1a', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' } }, under);
      // v102: the route to a place (the same lines as 2D: walks dotted pink, rides in the line's colour with a dark casing)
      m3.addSource('v3-rt', { type: 'geojson', data: EMPTY });
      m3.addLayer({ id: 'v3-rt-line', type: 'line', source: 'v3-rt', filter: ['==', ['get', 'd'], 0], layout: round,
        paint: { 'line-color': ['get', 'c'], 'line-opacity': ['get', 'o'],
                 'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'k'], 1], 5, 3], 15, ['case', ['==', ['get', 'k'], 1], 12, 7]] } }, under);
      m3.addLayer({ id: 'v3-rt-walk', type: 'line', source: 'v3-rt', filter: ['==', ['get', 'd'], 1], layout: round,
        paint: { 'line-color': ['get', 'c'], 'line-opacity': ['get', 'o'], 'line-width': 4, 'line-dasharray': [0.1, 2.2] } }, under);
      // v103: all stops (from street level, as in 2D; a searched line's stops at any zoom, in its colour)
      m3.addSource('v3-stops', { type: 'geojson', data: EMPTY });
      m3.addLayer({ id: 'v3-stops', type: 'symbol', source: 'v3-stops',
        layout: { 'icon-image': ['get', 'img'], 'icon-size': ['case', ['==', ['get', 'sel'], 1], 1.6 * U, U], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'sel'] } });
      // the vehicles: over everything else on the map (only the markers are above them)
      m3.addSource('v3-veh', { type: 'geojson', data: EMPTY, buffer: 16 });
      var transport = m3.getStyle().layers.find(function (l) { return l['source-layer'] === 'transportation'; });
      railSource = transport && transport.source;
      railsDirty = true; railRefreshAt = 0; railSegments = [];
      m3.on('sourcedata', function (e) { if (e.sourceId === railSource) railsDirty = true; });
      m3.on('moveend', function () { railsDirty = true; });
      m3.addLayer(vehicleModelLayer(function () { return drawn; }));
      var LZ = LABEL_ZOOM - 1, faded = function (a) { return ['case', ['==', ['get', 'pk'], 1], a, 1]; };
      var label = function (size) {
        return { 'text-field': ['get', 't'], 'text-font': fontB, 'text-size': size * U, 'text-offset': ['case', ['==', ['get', 'model'], 1], ['literal', [0, -30 / size]], ['literal', [0, 0]]], 'icon-image': ['concat', 'v3pill-', ['get', 'c']],
          'icon-text-fit': 'both', 'icon-text-fit-padding': [1 * U, 4 * U, 1 * U, 4 * U], 'text-allow-overlap': true, 'icon-allow-overlap': true,
          'text-ignore-placement': true, 'icon-ignore-placement': true, 'symbol-z-order': 'viewport-y' };
      };
      m3.addSource('v3-veh-far', { type: 'geojson', data: EMPTY, buffer: 16 });
      var dotPaint = { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 12, 4.5, 15, 7], 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5, 'circle-opacity': faded(0.45), 'circle-stroke-opacity': faded(0.45), 'circle-pitch-alignment': 'map' };
      m3.addLayer({ id: 'v3-veh-far', type: 'circle', source: 'v3-veh-far', paint: dotPaint });
      m3.addLayer({ id: 'v3-veh-dot', type: 'circle', source: 'v3-veh', filter: ['==', ['get', 'm'], 0], maxzoom: LZ, paint: dotPaint });
      m3.addLayer({ id: 'v3-veh-dir', type: 'symbol', source: 'v3-veh', minzoom: LZ, filter: ['all', ['>=', ['get', 'b'], 0], ['==', ['get', 'model'], 0]],
        layout: { 'icon-image': 'v3arrow', 'icon-size': U, 'icon-rotate': ['get', 'b'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
          'icon-offset': [0, -17], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      // v99's route vehicles ("Board · 4 min"): bigger, ringed in pink, with their tag, at every zoom
      m3.addLayer({ id: 'v3-veh-ring', type: 'circle', source: 'v3-veh', filter: ['==', ['get', 'm'], 1],
        paint: { 'circle-radius': 17 * U, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#D6336C', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'viewport' } });
      addNumberOverlay();
      var tag = label(10.5);
      tag['text-field'] = ['get', 'tag']; tag['icon-image'] = 'v3pill-#D6336C'; tag['text-offset'] = [0, 2.1];
      m3.addLayer({ id: 'v3-veh-tag', type: 'symbol', source: 'v3-veh', filter: ['==', ['get', 'm'], 1], layout: tag, paint: { 'text-color': '#fff' } });
      pointSnapshots = {};
      shown = []; vehDue = 0; rtSig = ''; dimNow = null;
      view3d.followChanged(following);
      render(false);          // the vehicles to show (fills `shown`)
      view3d.pathChanged();
      syncStops();
      applyTerrain();   // v103
    }

    // ---- v101: vehicles (15 times a second from v.pos; the tracked one is a marker moved every frame) ----
    var labelsBy = null;
    // Near vehicles (inside the clipped view, + 30 %) go to 'v3-veh' 15 times a second; the far ones, toward the
    // horizon, only as dots and twice a second ('v3-veh-far'), so a tilted view doesn't update the whole city 15×/s.
    var farDue = 0, farDrawn = [];
    // Keep snapshots per map instance. Compare geometry, styling and order so a
    // colour change or a disappearing vehicle still reaches the worker.
    var pointSnapshots = {};
    function submitPointSource(id, features, tolerance) {
      var snapshot = pointSnapshots[id], previous = snapshot ? snapshot.features : [];
      // Let small movements accumulate against the last submitted position.
      // Flush the exact endpoint within half a second, even at city zoom.
      if (snapshot && performance.now() - snapshot.at >= 500) tolerance = 0;
      var lngStep = tolerance ? tolerance.lng : 0, latStep = tolerance ? tolerance.lat : 0;
      if (previous.length === features.length && features.every(function (f, i) {
        var old = previous[i], a = f.geometry.coordinates, b = old.geometry.coordinates;
        if (Math.abs(a[0] - b[0]) > lngStep || Math.abs(a[1] - b[1]) > latStep) return false;
        for (var key in f.properties) if (f.properties[key] !== old.properties[key]) return false;
        return true;
      })) return;
      setSrc(id, { type: 'FeatureCollection', features: features });
      pointSnapshots[id] = { features: features, at: performance.now() };
    }
    function modelBearing(v) {
      var motion = v.mo, bearing = v.d.bearing;
      var roadVehicle = v.d.type === 3 || v.d.type === 11;
      if (roadVehicle && motion && motion.kind === 'line' && distM(motion.a, motion.b) > 3) {
        bearing = bearingDeg(motion.a, motion.b);
      } else {
        // A trip shape is ordered in the direction of service, even at a stop.
        var route = routeMetaFor(v.d);
        if (route && motion && motion.m === route) {
          bearing = pointAt(route, Number.isFinite(v.along) ? v.along : motion.s0).deg;
        } else if (route) {
          // While waiting for a route motion plan, project once per GPS report.
          if (v.modelReport !== v.d || v.modelRoute !== route) {
            var projection = projectAlong(route, v.d.lat, v.d.lon, bearing, v.along);
            v.modelTangent = projection && projection.dist < 60 ? pointAt(route, projection.s).deg : null;
            v.modelReport = v.d;
            v.modelRoute = route;
          }
          if (Number.isFinite(v.modelTangent)) bearing = v.modelTangent;
        }
      }
      if (!Number.isFinite(bearing) && motion && motion.kind === 'line' && distM(motion.a, motion.b) > 3) {
        bearing = bearingDeg(motion.a, motion.b);
      }
      if (Number.isFinite(bearing)) {
        v.modelHeading = bearing;
        v.modelTrip = v.d.tripRef;
      }
      return v.modelTrip === v.d.tripRef ? v.modelHeading : null;
    }
    var railSource, railSegments = [], railsDirty = true, railRefreshAt = 0;
    var railNeighbors = new Map();
    var modelPoses = new Map();
    function refreshRails(now) {
      if (!railSource || !railsDirty || now < railRefreshAt) return;
      railsDirty = false;
      railRefreshAt = now + 350;
      railSegments = [];
      railNeighbors.clear();
      var tracks = m3.querySourceFeatures(railSource, { sourceLayer: 'transportation',
        filter: ['any', ['==', 'subclass', 'tram'], ['==', 'class', 'tram']] });
      tracks.forEach(function (track) {
        var g = track.geometry;
        var lines = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
        lines.forEach(function (line) {
          for (var i = 1; i < line.length; i++) {
            var a = line[i-1], b = line[i];
            if (a[0] === b[0] && a[1] === b[1]) continue;
            railSegments.push([a, b]);
            connect(a, b);
            connect(b, a);
          }
        });
      });
      function connect(a, b) {
        var key = a.join(',');
        if (!railNeighbors.has(key)) railNeighbors.set(key, new Map());
        railNeighbors.get(key).set(b.join(','), b);
      }
    }
    // Work in local metres. At crossings prefer the tangent of the current trip.
    function railPosition(lng, lat, heading, segments, distanceOnly) {
      var east = 111320 * Math.cos(toRad(lat)), north = 111320, best = null, score = Infinity;
      for (var i = 0; i < segments.length; i++) {
        var a = segments[i][0], b = segments[i][1];
        if (lng < Math.min(a[0], b[0]) - 50/east || lng > Math.max(a[0], b[0]) + 50/east ||
            lat < Math.min(a[1], b[1]) - 50/north || lat > Math.max(a[1], b[1]) + 50/north) continue;
        var x = (a[0]-lng)*east, y = (a[1]-lat)*north;
        var dx = (b[0]-a[0])*east, dy = (b[1]-a[1])*north, length2 = dx*dx + dy*dy;
        if (!length2) continue;
        var t = Math.max(0, Math.min(1, -(x*dx+y*dy)/length2));
        var distance = Math.hypot(x+t*dx, y+t*dy);
        if (distance > 50) continue;
        var bearing = (Math.atan2(dx,dy)*180/Math.PI + 360) % 360;
        var diff = angleDiff(heading, bearing);
        var reversed = diff > 90;
        if (reversed) { bearing = (bearing+180)%360; diff = 180-diff; }
        var cost = distanceOnly ? distance : distance + diff * 0.25;
        if (cost < score) {
          score = cost;
          best = { at: [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])], bearing: bearing, forward: reversed ? a : b, backward: reversed ? b : a,
            endpoint: t === 0 ? a : t === 1 ? b : null };
        }
      }
      // A GPS chord through a bend can favor the next segment before the
      // center reaches it. At a simple joint use the closer of the two rails.
      if (!distanceOnly && best && best.endpoint) {
        var neighbors = railNeighbors.get(best.endpoint.join(','));
        if (neighbors && neighbors.size === 2) {
          var joint = Array.from(neighbors.values(), function (next) { return [best.endpoint, next]; });
          return railPosition(lng, lat, heading, joint, true);
        }
      }
      return best;
    }
    // Sample each end of the carriages on connected rails. Distances follow the
    // rendered footprint in metres, independent of the camera zoom.
    function tramHeadings(rail, v, metresPerUnit) {
      var east = 111320 * Math.cos(toRad(rail.at[1])), north = 111320;
      function direction(a, b) {
        return Math.atan2((b[0]-a[0])*east, (b[1]-a[1])*north)*180/Math.PI;
      }
      function ends(forward) {
        var here = rail.at, next = forward ? rail.forward : rail.backward;
        var prev = forward ? rail.backward : rail.forward;
        var heading = rail.bearing + (forward ? 0 : 180), walked = 0;
        return [3.6, 10.8].map(function (offset) {
          var distance = offset * metresPerUnit;
          while (next) {
            var length = Math.hypot((next[0]-here[0])*east, (next[1]-here[1])*north);
            if (length > 0.001) heading = direction(here, next);
            if (walked + length >= distance) {
              var t = (distance-walked)/length;
              return [here[0]+(next[0]-here[0])*t, here[1]+(next[1]-here[1])*t];
            }
            walked += length;
            var node = next, neighbors = railNeighbors.get(node.join(','));
            var target = heading, best = Infinity;
            if (neighbors && neighbors.size > 2 && v.mo && v.mo.kind === 'route' && Number.isFinite(v.along)) {
              var m = v.mo.m, sign = forward ? 1 : -1;
              target = pointAt(m, Math.max(0, Math.min(m.total, v.along + sign*(walked+5)))).deg + (forward ? 0 : 180);
            }
            next = null;
            if (neighbors) neighbors.forEach(function (candidate, key) {
              if (key === prev.join(',')) return;
              var h = direction(node, candidate);
              var turn = angleDiff(h, heading), cost = angleDiff(h, target) + turn*.2;
              if (turn < 100 && cost < best) { best = cost; next = candidate; }
            });
            prev = node; here = node;
          }
          var r = toRad(heading);
          return [here[0]+Math.sin(r)*(distance-walked)/east, here[1]+Math.cos(r)*(distance-walked)/north];
        });
      }
      var front = ends(true), rear = ends(false);
      return [direction(rear[1], rear[0]), direction(rear[0], front[0]), direction(front[0], front[1])];
    }
    var coveredMetroRails = [];
    metroRoofSections.forEach(function (rows) {
      var previous;
      rows.forEach(function (row) {
        var center = [(row[0]+row[2])/2, (row[1]+row[3])/2];
        if (previous) coveredMetroRails.push([previous, center]);
        previous = center;
      });
    });
    function coveredMetroPosition(lon, lat, heading) {
      var rail = railPosition(lon, lat, heading, coveredMetroRails, true);
      if (!rail || angleDiff(heading, rail.bearing) > 45) return [lon, lat];
      var direction = toRad(rail.bearing), east = 111320*Math.cos(toRad(lat));
      var dx = (lon-rail.at[0])*east, dy = (lat-rail.at[1])*111320;
      // Keep the longitudinal motion through each portal. Blend out onto the timetable path.
      var along = dx*Math.sin(direction) + dy*Math.cos(direction);
      var cross = dx*Math.cos(direction) - dy*Math.sin(direction);
      var blend = Math.min(1, Math.max(0, (40-Math.abs(along))/30),
        Math.max(0, (32-Math.abs(cross))/10));
      var shift = (1.65-cross)*blend;
      return [lon + shift*Math.cos(direction)/east, lat - shift*Math.sin(direction)/111320];
    }
    function vehicleAnchor(v) {
      var pose = modelPoses.get(v);
      return pose ? pose.c : [v.pos[1], v.pos[0]];
    }
    // Use the same carriage pivots as the tram mesh, measured along the metro trip.
    function metroHeadings(v) {
      var plan = v.d.metroPlan, path = plan.m;
      var center = Number.isFinite(v.along) ? v.along : plan.s0;
      function sample(offset) {
        return pointAt(path, Math.max(0, Math.min(path.total, center + offset * vehicleModelMetresPerUnit)));
      }
      var tail = sample(-10.8), rearPivot = sample(-3.6), frontPivot = sample(3.6), nose = sample(10.8);
      function heading(a, b) {
        if (a.ll[0] === b.ll[0] && a.ll[1] === b.ll[1]) return a.deg;
        return bearingDeg(a.ll, b.ll);
      }
      return [heading(tail, rearPivot), heading(rearPivot, frontPivot), heading(frontPivot, nose)];
    }
    // Between fleet updates a tram only needs its current rail and the branches
    // touching either end. Refresh that neighborhood when it crosses a vertex.
    function localRails(rail) {
      var segments = [[rail.backward, rail.forward]];
      function adjacent(node, other) {
        var neighbors = railNeighbors.get(node.join(','));
        if (neighbors) neighbors.forEach(function (next, key) {
          if (key !== other.join(',')) segments.push([node, next]);
        });
      }
      adjacent(rail.forward, rail.backward);
      adjacent(rail.backward, rail.forward);
      return segments;
    }
    // Project the number on the frame MapLibre actually paints, including camera-only moves.
    function addNumberOverlay() {
      var map3 = m3, base = map3.getCanvas(), canvas = document.createElement('canvas');
      canvas.className = 'v3-vehicle-numbers';
      canvas.setAttribute('aria-hidden', 'true');
      base.after(canvas);
      var g = canvas.getContext('2d'), painted = false;
      map3.on('render', function () {
        if (map3 !== m3 || (!painted && !numberPoses.length)) return;
        if (canvas.width !== base.width) canvas.width = base.width;
        if (canvas.height !== base.height) canvas.height = base.height;
        var width = base.clientWidth, height = base.clientHeight;
        if (!width || !height) return;
        g.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
        g.clearRect(0, 0, width, height);
        painted = numberPoses.length > 0;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        numberPoses.forEach(function (pose) {
          var point = map3.project(pose.c), x = point.x, y = point.y - (pose.model ? 30 * ui : 0);
          if (x < -60 || y < -30 || x > width + 60 || y > height + 30) return;
          var size = (pose.m ? 14 : 11) * ui, h = size + 6 * ui;
          g.font = 'bold ' + size + 'px sans-serif';
          var w = Math.max(h, g.measureText(pose.number).width + 10 * ui);
          g.globalAlpha = pose.m ? 1 : pose.opacity;
          rr(g, x - w / 2, y - h / 2, w, h, 6 * ui);
          g.fillStyle = pose.color; g.fill();
          g.lineWidth = 1.5 * ui; g.strokeStyle = '#fff'; g.stroke();
          g.fillStyle = pose.ink; g.fillText(pose.number, x, y);
        });
      });
    }
    var numberPoses = [];
    function advanceVehicles(frameTime) {
      var repaint = false;
      numberPoses.forEach(function (pose) {
        var v = pose.vehicle;
        if (!v.mo || !pose.animate) return;
        var pos = posAt(v, frameTime);
        if (pos[0] === pose.lat && pos[1] === pose.lon) return;
        pose.lat = pos[0]; pose.lon = pos[1];
        var heading = pose.model ? modelBearing(v) : null;
        if (pose.rail) {
          var rail = railPosition(pose.lon, pose.lat, heading, pose.localRails);
          if (!rail) return; // The fleet update will reacquire a track or show the marker.
          if (rail.forward !== pose.rail.forward || rail.backward !== pose.rail.backward) pose.localRails = localRails(rail);
          pose.rail = rail;
          pose.sections = tramHeadings(rail, v, vehicleModelMetresPerUnit);
          pose.bearing = pose.sections[1];
          pose.c = rail.at;
        } else {
          if (pose.model && v.d.metroPlan) pose.sections = metroHeadings(v);
          pose.bearing = pose.sections ? pose.sections[1] : heading;
          pose.c = pose.model && v.d.metroPlan ? coveredMetroPosition(pose.lon, pose.lat, pose.bearing) : [pose.lon, pose.lat];
        }
        repaint = true;
      });
      if (repaint) m3.triggerRepaint();
    }
    function buildVeh(frameTime) {
      if (!m3 || !m3.getSource('v3-veh')) return;
      var t0 = performance.now(), nb = view3d.bounds(0.3), b = m3.getBounds(), now = performance.now(), doFar = now >= farDue;
      var s = nb.getSouth(), n = nb.getNorth(), w = nb.getWest(), e = nb.getEast(), feats = [], far = [], seen = {};
      var fs = b.getSouth(), fn = b.getNorth(), fw = b.getWest(), fe = b.getEast();
      drawn = []; numberPoses = [];
      if (doFar) { farDue = now + 500; farDrawn = []; }
      var close = m3.getZoom() >= vehicleModelZoom;
      var previousPoses = modelPoses, repaint = false;
      modelPoses = new Map();
      if (close) refreshRails(now);
      function add(v) {
        if (!v || !v.pos || seen[v.d.key]) return;
        var model = close && !!vehicleMeshes[vehicleMeshType(v.d.type)];
        if (v === selected && !model) return;
        seen[v.d.key] = 1;
        var d = v.d, rv = routeVeh[d.key], la = v.pos[0], lo = v.pos[1];
        if (v !== selected && !rv && !labelsBySearch && (la < s || la > n || lo < w || lo > e)) {   // (a search's few vehicles: all labelled)
          if (doFar && la >= fs && la <= fn && lo >= fw && lo <= fe) {
            far.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] }, properties: { k: d.key, c: d.color, pk: v.parked ? 1 : 0 } });
            farDrawn.push({ k: d.key, c: [lo, la], m: false });
          }
          return;
        }
        var numbered = rv || labelsBySearch || m3.getZoom() >= LABEL_ZOOM - 1;
        var animate = numbered && (v === selected || (la >= s && la <= n && lo >= w && lo <= e));
        if (animate && v.mo) {
          posAt(v, frameTime);
          la = v.pos[0]; lo = v.pos[1];
        }
        var heading = model ? modelBearing(v) : null;
        model = model && Number.isFinite(heading);
        if (v === selected && !model) return;
        if (model && d.type === 0) {
          var rail = railPosition(lo, la, heading, railSegments);
          if (rail) {
            lo = rail.at[0]; la = rail.at[1]; heading = rail.bearing;
            var sections = tramHeadings(rail, v, vehicleModelMetresPerUnit);
            heading = sections[1];
          } else {
            model = false;
            if (v === selected) return;
          }
        }
        if (model && d.metroPlan) {
          sections = metroHeadings(v);
          heading = sections[1];
          var covered = coveredMetroPosition(lo, la, heading);
          lo = covered[0]; la = covered[1];
        }
        var ink = inkOf[d.color] || (inkOf[d.color] = lineTones(d.color).ink);
        var pose = { k: d.key, c: [lo, la], m: !!rv, type: d.type, color: d.color, bearing: heading, sections: sections, model: model, opacity: (dimNow && !rv && v !== selected ? 0.35 : 1) * (v.parked ? 0.6 : 1) };
        drawn.push(pose);
        if (numbered) {
          pose.vehicle = v; pose.number = String(d.shown); pose.ink = ink;
          pose.animate = animate; pose.lat = v.pos[0]; pose.lon = v.pos[1];
          numberPoses.push(pose);
        }
        if (model) {
          var prev = previousPoses.get(v);
          if (!prev || lo !== prev.c[0] || la !== prev.c[1] || heading !== prev.bearing) repaint = true;
          if (rail && animate) { pose.rail = rail; pose.localRails = localRails(rail); }
          modelPoses.set(v, pose);
        }
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] },
          properties: { k: d.key, model: model ? 1 : 0, c: d.color, ink: ink, t: String(d.shown), b: typeof d.bearing === 'number' && !v.parked ? Math.round(d.bearing) : -1,
                        pk: v.parked ? 1 : 0, m: rv ? 1 : 0, tag: rv ? rv.tag : '' } });
      }
      for (var i = 0; i < shown.length; i++) add(shown[i]);
      for (var k in routeVeh) add(vehicles[k]);
      add(selected);
      if (repaint || previousPoses.size !== modelPoses.size) m3.triggerRepaint();
      var halfPixel = 180 / (512 * Math.pow(2, m3.getZoom()));
      var tolerance = { lng: halfPixel, lat: halfPixel * Math.cos(toRad(m3.getCenter().lat)) };
      submitPointSource('v3-veh', feats, tolerance);
      if (doFar) submitPointSource('v3-veh-far', far, tolerance);
      vehN = feats.length; farN = farDrawn.length;
      vehMs.push(performance.now() - t0);
      if (vehMs.length > 100) vehMs.shift();
      // a search that leaves few vehicles labels them at any zoom (LABEL_MAX), as in 2D
      if (labelsBy !== labelsBySearch) {
        labelsBy = labelsBySearch;
        m3.setLayoutProperty('v3-veh-dot', 'visibility', labelsBy ? 'none' : 'visible');
        m3.setLayerZoomRange('v3-veh-dir', labelsBy ? 0 : LABEL_ZOOM - 1, 24);
      }
    }
    view3d.feedChanged = function (list) { shown = list || []; vehDue = 0; farDue = 0; };
    view3d.drawn = function () { return drawn; };
    function trackFrame() {
      var v = selected;
      if (!v || !v.pos) { if (trkMk) { trkMk.remove(); trkMk = null; } return; }
      var at = vehicleAnchor(v);
      if (!trkMk || trkMk._v !== v) {
        if (trkMk) trkMk.remove();
        var e = mkEl('veh', '', 7);
        e.addEventListener('click', function (ev) { ev.stopPropagation(); if (selected) openVeh(selected); });
        // exact (fractional) position, as the tracked vehicle in 2D (v90): rounded, it crept and jumped 1 px
        trkMk = new maplibregl.Marker({ element: e, pitchAlignment: 'viewport', rotationAlignment: 'viewport', subpixelPositioning: true }).setLngLat(at).addTo(m3);
        trkMk._v = v; trkMk._k = '';
      }
      var k = iconKey(v.d);
      if (k !== trkMk._k) { trkMk._k = k; trkMk.getElement().innerHTML = iconFor(v.d).options.html; }
      trkMk.getElement().hidden = m3.getZoom() >= vehicleModelZoom && modelPoses.has(v);
      var atMarker = trkMk.getLngLat();
      if (atMarker.lng === at[0] && atMarker.lat === at[1]) return;
      trkMk.setLngLat(at);
      if (pop && popKind === 'veh' && popRef === v) pop.setLngLat(at);
    }
    view3d.selectChanged = function () {
      vehDue = 0;
      if (pop && popKind === 'veh' && popRef !== selected) closePop();
    };
    // A tap: the closest drawn vehicle within reach wins (as on the 2D map): 12 px around a dot, the size of its
    // label when labels show. Worked out from the drawn positions, not queryRenderedFeatures: on a symbol layer
    // whose data changes 15 times a second, MapLibre 4.7 can throw "feature index out of bounds" there.
    function vehAtPoint(p) {
      var lbl = labelsBySearch || viewZoom() >= LABEL_ZOOM, best = null, bd = Infinity;
      var all = drawn.concat(farDrawn);
      for (var i = 0; i < all.length; i++) {
        var f = all[i], q = m3.project(f.c), dx = Math.abs(q.x - p.x), dy = Math.abs(q.y - p.y);
        var rx = f.m ? 26 * ui : lbl ? 18 * ui : 12, ry = f.m ? 16 * ui : lbl ? 12 * ui : 12;
        if (f.model) {
          var length = (vehicleMeshType(f.type) === 0 ? 10.5 : 6) * vehicleModelMetresPerUnit;
          var h = toRad(f.bearing), lon = length*Math.sin(h)/(111320*Math.cos(toRad(f.c[1]))), lat = length*Math.cos(h)/111320;
          var front = m3.project([f.c[0]+lon, f.c[1]+lat]), rear = m3.project([f.c[0]-lon, f.c[1]-lat]);
          var vx = front.x-rear.x, vy = front.y-rear.y;
          var t = Math.max(0, Math.min(1, ((p.x-rear.x)*vx+(p.y-rear.y)*vy)/(vx*vx+vy*vy || 1)));
          var bodyDistance = Math.hypot(p.x-rear.x-t*vx, p.y-rear.y-t*vy);
          var labelPoint = q;
          var labelHit = Math.abs(labelPoint.x - p.x) <= rx && Math.abs(labelPoint.y - 30 * ui - p.y) <= ry;
          if (!labelHit && bodyDistance > 18 * ui) continue;
          dx = labelHit ? Math.abs(labelPoint.x - p.x) : bodyDistance; dy = 0;
        } else if (dx > rx || dy > ry) continue;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = f.k; }
      }
      return best !== null ? vehicles[best] || null : null;
    }
    // a vehicle's card: phones in the bottom sheet (as in 2D), PC on the 3D map, following the vehicle
    function openVeh(v, noFocus) {
      if (!m3 || !v) return;
      if (selected !== v) select(v);
      if (noFocus) { openPop('veh', v); return; }
      closePop();
      closeSheet();
      // the vehicle and its card together in the middle of the free map area (as v100's card in 2D)
      focusOn(v.pos ? vehicleAnchor(v).slice().reverse() : [v.d.lat, v.d.lon], null, vpTargetY(vpFreeBottom(), vehPopupSize(v).h), function () {
        if (view3d.on && selected === v) openPop('veh', v);
      });
    }
    // screen px the open 3D card takes below the vehicle (0 when none): the gap, the pointer and the card
    function cardRoom3() {
      var el = pop && popKind === 'veh' && pop.getElement();
      return el ? Math.round(VP_GAP * ui) + el.offsetHeight : 0;
    }
    view3d.cardEl = function () { var el = pop && popKind === 'veh' && pop.getElement(); return el ? el.querySelector('.maplibregl-popup-content') : null; };
    var cardEdgeTimer = 0;
    view3d.openVeh = openVeh;
    view3d.popOf = function () { return pop && popKind === 'veh' ? popRef : null; };
    view3d.popStop = function () { return pop && popKind === 'stop' ? popRef : null; };
    view3d.closePop = function () { closePop(); };

    // ---- v102: cameras that follow (a vehicle, your location) ----
    // Heading-up: the vehicle sits in the lower third of the free map area and the road it is about to drive fills the
    // screen ahead of it. The direction is taken from the route ahead (as 2D's look-ahead), eased over LOOK_EASE_MS and
    // never faster than VIEW3D_TURN_DEG_S, so it doesn't swing at corners. The centre locks on with 2D's "offset decay"
    // (FOLLOW_TAU): it moves with the subject every frame and only the gap left from a start, a zoom or a drag shrinks.
    // where the finger / mouse went down: a "tap" that ends more than 6 px away was a drag, not a tap (as in Leaflet)
    var downXY = null;
    function pointerOn(e) {
      pointerDown = true;
      var t = e && e.touches && e.touches[0] ? e.touches[0] : e;
      downXY = t && typeof t.clientX === 'number' ? [t.clientX, t.clientY] : null;
    }
    function pointerOff(e) { if (!(e && e.touches && e.touches.length)) pointerDown = false; }
    // someone is moving the map: a finger or the mouse is down, or one of MapLibre's gestures (wheel, pinch, glide) runs
    function userBusy() {
      if (pointerDown || userMoving) return true;
      try { return m3.scrollZoom.isActive() || m3.dragPan.isActive() || m3.touchZoomRotate.isActive() || m3.dragRotate.isActive() || m3.touchPitch.isActive(); } catch (e) { return false; }
    }
    function selfJump(o) { selfMove = true; try { m3.jumpTo(o); } finally { selfMove = false; } }
    // padding that puts the camera's centre at screen height y
    function padAt(y) {
      var H = m3.getCanvas().clientHeight;
      return { pad: y >= H / 2 ? { top: 2 * y - H, bottom: 0, left: 0, right: 0 } : { top: 0, bottom: H - 2 * y, left: 0, right: 0 }, y: y };
    }
    // where the followed vehicle goes: the lower third of the free map area heading-up, the middle north-up; with its
    // card open, the vehicle and the card together in the middle (v100's vpTargetY), the card below it
    function followY() {
      var room = cardRoom3(), H = m3.getCanvas().clientHeight;
      if (room) return vpTargetY(vpFreeBottom(), room);
      var top = freeTop(), bottom = Math.min(H, freeBottom());
      return top + (bottom - top) * (headingUp ? 0.67 : 0.5);
    }
    function freePad(share) { var H = m3.getCanvas().clientHeight, top = freeTop(), bottom = Math.min(H, freeBottom()); return padAt(top + (bottom - top) * share); }
    function turnToward(b, target, dt, tau) {
      var d = ((target - b) % 360 + 540) % 360 - 180, step = d * (1 - Math.exp(-dt / tau)), cap = VIEW3D_TURN_DEG_S * dt / 1000;
      return b + Math.max(-cap, Math.min(cap, step));
    }
    function vehBearing(v) {
      var m = routeMetaFor(v.d);
      if (m && v.mo && v.mo.kind === 'route' && v.mo.m === m && typeof v.along === 'number') {
        var c = m3.getCenter(), mpp = 156543.03 * Math.cos(toRad(c.lat)) / Math.pow(2, m3.getZoom() + 1);
        var lead = Math.max(40, Math.min(500, LOOK_AHEAD * Math.min(m3.getCanvas().clientWidth, freeBottom() - freeTop()) * mpp * 1.4));
        var ahead = pointAt(m, Math.min(m.total, v.along + lead)).ll;
        if (distM(v.pos, ahead) > 8) return bearingDeg(v.pos, ahead);
      }
      return typeof v.d.bearing === 'number' && !v.parked ? v.d.bearing : null;
    }
    function lockOn(st, ll, y, bearing, dt, tau) {
      var fp = padAt(y), center = m3.getCenter(), padding = m3.getPadding();
      if (!st.off) { var c = m3.unproject([m3.getCanvas().clientWidth / 2, fp.y]); st.off = [c.lng - ll[0], c.lat - ll[1]]; }
      var k = reduceMotion ? 0 : Math.exp(-dt / tau);
      st.off[0] *= k; st.off[1] *= k;
      var lng = ll[0] + st.off[0], lat = ll[1] + st.off[1];
      var quarterPixel = 90 / (512 * Math.pow(2, m3.getZoom()));
      if (Math.abs(center.lng - lng) < quarterPixel &&
          Math.abs(center.lat - lat) < quarterPixel * Math.cos(toRad(lat)) &&
          Math.abs(m3.getBearing() - bearing) < 0.005 &&
          Math.abs(padding.top - fp.pad.top) < 0.1 && Math.abs(padding.bottom - fp.pad.bottom) < 0.1) return;
      selfJump({ center: [lng, lat], bearing: bearing, padding: fp.pad });
    }
    function followCam3() {
      var v = selected;
      if (!following || followHold || !v || !v.pos || camBusy || userBusy() || !ready) { fc.off = null; fc.at = 0; return; }
      var now = performance.now(), dt = fc.at ? Math.min(250, now - fc.at) : 16;   // (250: slow phones still ease at the right speed)
      fc.at = now;
      var b = m3.getBearing(), tb = headingUp ? vehBearing(v) : 0;
      if (tb !== null) b = turnToward(b, tb, dt, LOOK_EASE_MS);
      lockOn(fc, vehicleAnchor(v), followY(), b, dt, FOLLOW_TAU);
    }
    // your location: heading-up while you walk (compass, or the GPS direction); standing, it rests while the dot stays
    // within ME_DEAD_PX of the middle, as in 2D
    function locCam3() {
      var sh = loc.show;
      if (!loc.follow || following || loc.camHold || camBusy || userBusy() || !ready || !sh || (loc.state !== 'on' && loc.state !== 'wait')) { lc.off = null; lc.at = 0; return; }
      var now = performance.now(), dt = lc.at ? Math.min(250, now - lc.at) : 16, t = Date.now();
      lc.at = now;
      var ll = [sh.ll.lng, sh.ll.lat], moving = meSpeed() >= 1, b = m3.getBearing();
      var fresh = loc.heading !== null && (t - loc.compassAt < COMPASS_LIVE_MS || (loc.headingSrc === 'gps' && t - loc.headingAt < 10000));
      if (moving && headingUp && fresh) b = turnToward(b, loc.heading, dt, 800);
      if (moving) { lc.rest = false; lockOn(lc, ll, freePad(0.5).y, b, dt, ME_TAU); return; }
      lc.off = null;
      var fp = freePad(0.5), p = m3.project(ll), cx = m3.getCanvas().clientWidth / 2, gap = Math.sqrt((p.x - cx) * (p.x - cx) + (p.y - fp.y) * (p.y - fp.y));
      if (lc.rest && gap <= ME_DEAD_PX) return;
      lc.rest = gap < 0.5;
      if (lc.rest) return;
      var c = m3.unproject([cx, fp.y]), k = reduceMotion ? 1 : 1 - Math.exp(-dt / ME_RECENTRE_MS);
      selfJump({ center: [c.lng + (ll[0] - c.lng) * k, c.lat + (ll[1] - c.lat) * k], bearing: b, padding: fp.pad });
    }
    function refreshNorth() {
      var sub = following || (loc && loc.follow), a = northBox.querySelector('a');
      northBox.classList.toggle('hu', !!(sub && headingUp));
      var t = sub ? (headingUp ? 'Heading up (tap for north up)' : 'North up (tap for heading up)') : 'North up';
      if (a.title !== t) { a.title = t; a.setAttribute('aria-label', t); }
    }
    view3d.refreshNorth = refreshNorth;
    view3d.followChanged = function (on) {
      fc.off = null; fc.at = 0;
      if (m3) {   // pinch and wheel zoom around the followed vehicle (the camera's centre is it)
        try { m3.scrollZoom.enable(on ? { around: 'center' } : undefined); m3.touchZoomRotate.enable(on ? { around: 'center' } : undefined); } catch (e) {}
      }
      refreshNorth();
    };
    // Follow switched on from a stop's list: the flight lands where the vehicle will be, already heading-up
    view3d.flyFollow = function (v) {
      if (!m3 || !v || !v.pos) return;
      var dur = reduceMotion ? 0 : 900, at = posAt(v, Date.now() + dur) || v.pos, b = headingUp ? vehBearing(v) : 0;
      fc.off = null;
      cam({ center: [at[1], at[0]], bearing: b === null ? m3.getBearing() : b, padding: padAt(followY()).pad, duration: dur }, false);
    };
    // a route to a place: fitted and turned so it runs from you (bottom) up to the place (top); the tilt stays
    view3d.fitRoute = function (pts, me, p, tl, br) {
      if (!m3) return;
      var b = L.latLngBounds(pts), bear = bearingDeg([me.lat, me.lng], [p.lat, p.lon]), cv = m3.getCanvas();
      // phones: the panel and the route sheet can leave less room than MapLibre accepts (it then returns nothing):
      // shrink the margins to keep at least 80 px of map, and if it still can't fit, just turn and centre
      var pad = { top: tl[1], left: tl[0], bottom: br[1], right: br[0] }, H = cv.clientHeight, W = cv.clientWidth;
      if (pad.top + pad.bottom > H - 80) { var ky = (H - 80) / (pad.top + pad.bottom); pad.top *= ky; pad.bottom *= ky; }
      if (pad.left + pad.right > W - 80) { var kx = (W - 80) / (pad.left + pad.right); pad.left *= kx; pad.right *= kx; }
      var c = null;
      try { c = m3.cameraForBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: pad, maxZoom: 16, bearing: bear }); } catch (e) {}
      var mid = b.getCenter();
      cam(c ? { center: c.center, zoom: c.zoom, bearing: bear, padding: PAD0, duration: 800 } : { center: [mid.lng, mid.lat], bearing: bear, padding: PAD0, duration: 800 }, true);
    };
    // the route's lines and tags, mirrored from the 2D route layer whenever it changes (checked 3 times a second)
    function routePoll(now) {
      if (now - rtAt < 300 || !m3.getSource('v3-rt')) return;
      rtAt = now;
      var sig = '', dim = mapEl.classList.contains('rt-dim');
      routeLayer.eachLayer(function (l) { sig += L.stamp(l) + ','; });
      if (savedPlaces.destinationLine) { var d0 = savedPlaces.destinationLine.getLatLngs()[0]; sig += 'd' + d0.lat.toFixed(6) + ',' + d0.lng.toFixed(6); }
      if (sig !== rtSig) { rtSig = sig; syncRoute(); }
      if (dim !== dimNow) { dimNow = dim; applyDim(dim); }
      mapEl.classList.toggle('rt-far', viewZoom() < ROUTE_TAG_ZOOM);
    }
    function syncRoute() {
      var feats = [], seen = {};
      function line(lls, c, o, dash, casing) {
        if (lls.length > 1) feats.push({ type: 'Feature', properties: { c: c, o: o, d: dash ? 1 : 0, k: casing ? 1 : 0 }, geometry: { type: 'LineString', coordinates: lls.map(function (q) { return [q.lng, q.lat]; }) } });
      }
      routeLayer.eachLayer(function (l) {
        if (l instanceof L.Polyline) { var o = l.options; line(l.getLatLngs(), o.color, o.opacity, !!o.dashArray, o.color === '#1a1a1a'); return; }
        if (!l.getLatLng) return;
        var id = L.stamp(l), e0 = l.getElement(), html = e0 ? e0.innerHTML : (l.options.icon && l.options.icon.options.html) || '', ll = l.getLatLng();
        seen[id] = 1;
        if (!rtMks[id]) rtMks[id] = new maplibregl.Marker({ element: mkEl('rt-mk', html, 3), pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([ll.lng, ll.lat]).addTo(m3);
      });
      Object.keys(rtMks).forEach(function (id) { if (!seen[id]) { rtMks[id].remove(); delete rtMks[id]; } });
      if (savedPlaces.destinationLine) line(savedPlaces.destinationLine.getLatLngs(), savedPlaces.destinationLine.options.color, savedPlaces.destinationLine.options.opacity, true, false);
      setSrc('v3-rt', { type: 'FeatureCollection', features: feats });
    }
    // while a route is open, the other vehicles are dimmed (its own keep their pink ring), as in 2D
    function applyDim(dim) {
      var k = dim ? 0.35 : 1, f = function (a) { return ['*', k, ['case', ['==', ['get', 'pk'], 1], a, 1]]; };
      ['v3-veh-dot', 'v3-veh-far'].forEach(function (id) { m3.setPaintProperty(id, 'circle-opacity', f(0.45)); m3.setPaintProperty(id, 'circle-stroke-opacity', f(0.45)); });
      m3.setPaintProperty('v3-veh-dir', 'icon-opacity', k);
    }
    view3d.routeTest = function () { return { lines: m3.getSource('v3-rt')._data.features.length, tags: Object.keys(rtMks).length }; };

    // ---- v101: the tracked vehicle's route (the same points as the 2D line) ----
    function lineFeat(lls, c) {
      return { type: 'Feature', properties: { c: c }, geometry: { type: 'LineString', coordinates: lls.map(function (p) { return [p.lng, p.lat]; }) } };
    }
    view3d.pathChanged = function () {
      if (!m3 || !m3.getSource('v3-trk-tail')) return;
      var x = [];
      trk.color = pathLine ? pathLine.options.color : '#888'; trk.tailRef = null;
      if (selected && selected.pos && pathLine && flow) {
        syncPath(selected, true);
      } else {
        setSrc('v3-trk-tail', EMPTY);
        setSrc('v3-trk-head', EMPTY);
      }
      if (pathPreview) { var f = lineFeat(pathPreview.getLatLngs(), pathPreview.options.color); f.properties.dash = 1; x.push(f); }
      if (pathEnd) { var e = pathEnd.getLatLng(); x.push({ type: 'Feature', properties: { end: 1 }, geometry: { type: 'Point', coordinates: [e.lng, e.lat] } }); }
      setSrc('v3-trk-x', { type: 'FeatureCollection', features: x });
    };
    // every frame: only the short piece from the vehicle to the next point of the route changes
    view3d.pathMoved = function (head, tail) {
      if (!m3 || !m3.getSource('v3-trk-tail')) return;
      if (trk.tailRef !== tail) {
        trk.tailRef = tail;
        setSrc('v3-trk-tail', tail.length > 1 ? lineFeat(tail, trk.color) : EMPTY);
      }
      setSrc('v3-trk-head', head.length ? lineFeat(head, trk.color) : EMPTY);
    };

    // ---- v101: stops — the same markers as on the 2D map: the tracked vehicle's stops and "your stop" ----
    view3d.stopsChanged = function () {
      if (!m3 || stopsQueued) return;
      stopsQueued = true;
      requestAnimationFrame(function () { stopsQueued = false; syncStops(); });
    };
    function syncStops() {
      if (!m3) return;
      var seen = {};
      [focusLayer, routeStopLayer].forEach(function (g) {
        g.eachLayer(function (mk) {
          var id = L.stamp(mk);
          if (seen[id] || !mk.getLatLng) return;
          seen[id] = 1;
          var src = mk.getElement(), html = src ? src.innerHTML : mk.options.icon.options.html, ll = mk.getLatLng(), m = stopMks[id];
          if (mk.getTooltip && mk.getTooltip()) html += '<div class="v3-flabel">' + esc((mk._stop && mk._stop.name) || 'Your stop') + '</div>';
          if (!m) {
            var e = mkEl('stop-mk', '', 2);
            e.addEventListener('click', function (ev) { ev.stopPropagation(); stopTap(mk); });
            m = stopMks[id] = new maplibregl.Marker({ element: e, pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([ll.lng, ll.lat]).addTo(m3);
          }
          var e2 = m.getElement();
          if (e2._h !== html) { e2._h = html; e2.innerHTML = html; }
          e2.style.zIndex = /\bsel\b/.test(html) || mk === focusMarker ? 3 : 2;
        });
      });
      Object.keys(stopMks).forEach(function (id) { if (!seen[id]) { stopMks[id].remove(); delete stopMks[id]; } });
      // v103: all other stops in one layer (DOM markers for hundreds of stops would be slow); the open one is enlarged
      var feats = [];
      stopsDrawn = [];
      stopLayer.eachLayer(function (mk) {
        var st = mk._stop;
        if (!st) return;
        var sel = mk === sheetMarker || (pop && popKind === 'stop' && popRef === mk) ? 1 : 0;
        var img = metroTimetable.serves(st.id) ? 'v3stop-metro' : 'v3stop-' + (mk._color || 'x');
        feats.push({ type: 'Feature', properties: { img: img, sel: sel }, geometry: { type: 'Point', coordinates: [st.lon, st.lat] } });
        stopsDrawn.push({ mk: mk, c: [st.lon, st.lat] });
      });
      submitPointSource('v3-stops', feats);
    }
    function stopAtPoint(p) {
      var best = null, bd = Infinity, rad = 14 * ui;
      for (var i = 0; i < stopsDrawn.length; i++) {
        var q = m3.project(stopsDrawn[i].c), dx = q.x - p.x, dy = q.y - p.y, d = dx * dx + dy * dy;
        if (Math.abs(dx) <= rad && Math.abs(dy) <= rad && d < bd) { bd = d; best = stopsDrawn[i].mk; }
      }
      return best;
    }
    view3d.counts = function () {
      var lbl = labelsBySearch || viewZoom() >= LABEL_ZOOM;
      return { dots: lbl ? farN : vehN + farN, labels: lbl ? vehN : 0, stops: stopsDrawn.length + Object.keys(stopMks).length };
    };
    function stopTap(mk) {
      var st = mk._stop;
      if (!st || !m3) return;
      closePop();
      closeSheet();
      if (isPhone() || !mk._spEl) { openSheet(st, mk); return; }
      focusOn([st.lat, st.lon], null, undefined, function () { openPop('stop', mk); });
    }
    function startBearing() {
      if (headingUp && following && selected && selected.pos) { var b = vehBearing(selected); if (b !== null) return b; }
      if (headingUp && loc.follow && loc.heading !== null && Date.now() - loc.compassAt < COMPASS_LIVE_MS) return loc.heading;
      return m3.getBearing();
    }
    function reveal() {
      clearTimeout(revealTimer);
      if (ready || !m3 || closing) return;
      ready = true;
      el.classList.add('ready');
      // the 2D map is hidden once the 3D one has faded in over it
      setTimeout(function () {
        if (!view3d.on || closing) return;
        mapEl.classList.add('v3on');
        // v101: optionally free the 2D vector map's graphics memory while 3D is open (made again on return)
        if (VIEW3D_FREE_2D && glLayer && map.hasLayer(glLayer)) { try { map.removeLayer(glLayer); freed = true; } catch (e) {} }
      }, 260);
      // v103: the tilt you last left it at (between 20° and the most allowed), else VIEW3D_PITCH
      var keep = +(store('sofia_3d_pitch') || 0), pitch = keep >= 20 ? Math.min(VIEW3D_MAX_PITCH, keep) : VIEW3D_PITCH;
      cam({ pitch: pitch, bearing: startBearing(), duration: 800 });
      refresh();
    }
    function close(reason, instant) {
      cancelFocusCard();
      if (!view3d.on || closing) return;
      closing = true;
      if (controlsHelp.open) controlsHelp.close();
      info.lastClose = reason || 'button';
      try { if (m3 && ready && m3.getPitch() >= 20) store('sofia_3d_pitch', String(Math.round(m3.getPitch()))); } catch (e) {}   // v103
      terrainAttr(false);
      closePop();
      cancelPress();
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(revealTimer);
        var mm = m3, e3 = el, c = null, z = null;
        try { if (mm) { c = mm.getCenter(); z = mm.getZoom() + 1; } } catch (e) {}
        scheduleViewportPrefetch();
        view3d.on = false; closing = false; ready = false; camBusy = false;
        m3 = null; el = null; viewBounds01 = null;
        meMk = beamMk = null; meKey = accKey = ''; pinMks = {}; pop = null;
        numberPoses = []; modelPoses.clear(); railNeighbors.clear(); railSegments = []; trkMk = null; stopMks = {}; stopsDrawn = []; shown = []; drawn = []; farDrawn = []; labelsBy = null; rtMks = {}; rtSig = ''; fc.off = lc.off = null; userMoving = pointerDown = false;
        window.removeEventListener('mouseup', pointerOff, true); window.removeEventListener('touchend', pointerOff, true); window.removeEventListener('touchcancel', pointerOff, true);
        mapEl.classList.remove('v3on');
        handlers(true);
        var wasFreed = freed;
        if (freed) { freed = false; try { glLayer.addTo(map); hookGlMap(glLayer._glMap); } catch (x) {} }
        if (c && isFinite(z)) map.setView([c.lat, c.lng], z, { animate: false });
        back2d();
        unstore(OPEN_KEY);
        // MapLibre's remove() deliberately loses its own WebGL context: that is not a crash
        try { if (mm) mm.getCanvas().removeEventListener('webglcontextlost', onLost, false); } catch (x) {}
        if (e3) {
          // fades out over the 2D map (which has redrawn under it), then is freed
          e3.classList.add('leaving');
          setTimeout(function () { try { mm.remove(); } catch (x) {} e3.remove(); }, instant ? 0 : wasFreed ? 900 : 300);
        }
        refresh();
        renderDiag();
      }
      if (instant || reduceMotion || !ready || !m3) { finish(); return; }
      // Match the receiving map's zoom precision when handing the camera back to Leaflet.
      var snap = map.options.zoomSnap, zs = m3.getZoom();
      if (snap) zs = Math.round((zs + 1) / snap) * snap - 1;
      m3.easeTo({ pitch: 0, bearing: 0, zoom: zs, padding: PAD0, duration: 600 });
      m3.once('moveend', function () { requestAnimationFrame(finish); });
      setTimeout(finish, 1000);
    }
    // back in 2D: every marker where the motion planner says, the cameras start fresh
    function back2d() {
      for (var k in vehicles) {
        var v = vehicles[k];
        if (!v.pos) continue;
        v.dot.setLatLng(v.pos);
        if (v.pillInMap && v.pill) v.pill.setLatLng(v.pos);
      }
      followCam.off = null; locCam.off = null; lookAt = 0; pathSyncAt = 0;
      if (selected && shapes) drawPath(selected);
      render(false);
      routeTagsByZoom();   // v102
    }

    // ---- our own camera moves ----
    function cam(o, fly) {
      if (!m3) return;
      if (reduceMotion) o.duration = 0;
      if (fly && o.duration) m3.flyTo(o); else m3.easeTo(o);
      camBusy = !!o.duration;   // after the call: starting a move ends the previous one (its moveend)
      clearTimeout(camTimer);
      camTimer = setTimeout(function () { camBusy = false; }, (o.duration || 0) + 400);
    }
    // Leaflet camera calls made by the 2D code while 3D is open (fit a route, show a place, a search…) move the
    // 3D map instead. Pitch and bearing stay; centres are the middle of the screen, as in Leaflet.
    function msOf(o, dflt) { return o && o.animate === false ? 0 : Math.round(((o && o.duration) || dflt) * 1000); }
    function llOf(c) { var ll = L.latLng(c); return [ll.lng, ll.lat]; }
    function wrap(name, fn) {
      var orig = map[name];
      map[name] = function () { if (view3d.on && m3) { fn.apply(this, arguments); return this; } return orig.apply(this, arguments); };
    }
    wrap('setView', function (c, z, o) { cam({ center: llOf(c), zoom: (typeof z === 'number' ? z : viewZoom()) - 1, padding: PAD0, duration: o && o.animate ? msOf(o, 0.5) : 0 }); });
    wrap('flyTo', function (c, z, o) { cam({ center: llOf(c), zoom: (typeof z === 'number' ? z : viewZoom()) - 1, padding: PAD0, duration: msOf(o, 0.8) }, true); });
    wrap('panTo', function (c, o) { cam({ center: llOf(c), padding: PAD0, duration: msOf(o, 0.45) }); });
    function fitOpts(o) {
      o = o || {};
      var tl = L.point(o.paddingTopLeft || o.padding || [0, 0]), br = L.point(o.paddingBottomRight || o.padding || [0, 0]);
      return { padding: { top: tl.y, left: tl.x, bottom: br.y, right: br.x }, maxZoom: (o.maxZoom || 18) - 1, duration: msOf(o, 0.8) };
    }
    function fit(b, o, fly) {
      b = L.latLngBounds(b);
      if (!b.isValid() || !m3) return;
      var f = fitOpts(o);
      try {
        var c = m3.cameraForBounds([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]], { padding: f.padding, maxZoom: f.maxZoom, bearing: m3.getBearing() });
        if (c) cam({ center: c.center, zoom: c.zoom, bearing: m3.getBearing(), padding: PAD0, duration: f.duration }, fly);
      } catch (e) {}
    }
    wrap('fitBounds', function (b, o) { fit(b, o, false); });
    wrap('flyToBounds', function (b, o) { fit(b, o, true); });
    // put a spot at screen height targetY (the 2D focusOn / centreOnMe), at zoom z
    view3d.focus = function (ll, z, targetY, arrived) {
      if (!m3) return;
      ll = L.latLng(ll);
      var H = el.clientHeight, pad = { top: 0, bottom: 0, left: 0, right: 0 }, cur = viewZoom();
      if (targetY > H / 2) pad.top = Math.min(H - 40, 2 * targetY - H); else pad.bottom = Math.min(H - 40, H - 2 * targetY);
      var zoomed = Math.abs(z - cur) > 0.01;
      if (arrived) {
        m3.stop();
        m3.once('moveend', function () {
          if (!m3 || !view3d.on) return;
          var pos = m3.getCenter();
          if (Math.abs(pos.lat - ll.lat) < 0.00001 && Math.abs(pos.lng - ll.lng) < 0.00001) arrived();
        });
      }
      cam({ center: [ll.lng, ll.lat], zoom: z - 1, padding: pad, duration: zoomed ? 800 : 450 }, zoomed);
    };
    view3d.zoomBy = function (d) {
      if (!m3) return;
      cam({ zoom: Math.max(7, Math.min(18, m3.getZoom() + d)), duration: 300 });   // (v102: the follow cameras wait for it; around the subject)
    };
    // the compass needle: north up; while a camera follows (a vehicle, you) it switches heading-up / north-up (kept)
    view3d.north = function () {
      if (!m3) return;
      if (following || loc.follow) {
        headingUp = !headingUp;
        store('sofia_3d_heading', headingUp ? 'heading' : 'north');
        refreshNorth();
        toast(headingUp ? 'Heading up: the map turns with the way ahead.' : 'North up while following.', 2200);
        if (!headingUp) cam({ bearing: 0, duration: 600 });   // one smooth turn; the camera then keeps north up
        return;
      }
      cam({ bearing: 0, duration: 500 });
    };
    function needle() {
      var g = northBox.querySelector('.nd');
      if (g && m3) g.setAttribute('transform', 'rotate(' + (-m3.getBearing()).toFixed(1) + ' 12 12)');
    }
    view3d.zoom = function () { return m3 ? m3.getZoom() + 1 : map.getZoom(); };
    // What's on screen. Tilted, the view reaches toward the horizon; it is clipped to about what the flat view at
    // this zoom would show (0.6 × the screen's larger side from the middle, 0.5–2.5 km), so vehicles and stops near
    // the horizon don't all count as on screen (v101: at zoom 16 a fixed 3 km put 526 stop markers on the map).
    function clipM() {
      var c = m3.getCenter(), mpp = 156543.03 * Math.cos(toRad(c.lat)) / Math.pow(2, m3.getZoom() + 1), cv = m3.getCanvas();
      return Math.max(500, Math.min(2500, 0.6 * Math.max(cv.clientWidth, cv.clientHeight) * mpp));
    }
    view3d.bounds = function (pad) {
      if (!m3) return map.getBounds().pad(pad);
      var b = m3.getBounds(), c = m3.getCenter(), dLat = clipM() / 111320, dLon = dLat / Math.cos(toRad(c.lat));
      var s = Math.max(b.getSouth(), c.lat - dLat), n = Math.min(b.getNorth(), c.lat + dLat);
      var w = Math.max(b.getWest(), c.lng - dLon), e = Math.min(b.getEast(), c.lng + dLon);
      if (s >= n || w >= e) { s = c.lat - dLat; n = c.lat + dLat; w = c.lng - dLon; e = c.lng + dLon; }
      return L.latLngBounds([s, w], [n, e]).pad(pad);
    };
    view3d.camText = function () { return m3 ? 'p' + Math.round(m3.getPitch()) + '° b' + Math.round((m3.getBearing() + 360) % 360) + '°' : ''; };

    // ---- every frame (called at the end of motionFrame while 3D is open) ----
    view3d.frame = function (frameTime) {
      if (!m3) return;
      drawMe3();
      if (!m3.getSource('v3-veh')) return;
      var now = performance.now();
      if (now >= vehDue) { vehDue = now + 1000 / VIEW3D_VEH_HZ; buildVeh(frameTime); }
      else advanceVehicles(frameTime);
      trackFrame();
      followCam3();   // v102
      locCam3();
      routePoll(now);
    };

    // ---- your location: dot, accuracy circle, and the beam lying on the ground ----
    var BEAM_SVG = '<svg viewBox="-60 -60 120 120" aria-hidden="true"><defs><radialGradient id="meBeam3" cx="0" cy="0" r="58" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#1A73E8" stop-opacity=".55"/><stop offset="1" stop-color="#1A73E8" stop-opacity="0"/></radialGradient></defs>' +
      '<path d="M0 0L-33.3 -47.5A58 58 0 0 1 33.3 -47.5Z" fill="url(#meBeam3)"/></svg>';
    function mkEl(cls, html, z) {
      var d = document.createElement('div');
      d.className = 'v3-mk ' + cls;
      d.innerHTML = html;
      if (z) d.style.zIndex = z;
      return d;
    }
    function circlePoly(ll, r) {
      var pts = [], la = toRad(ll.lat);
      for (var i = 0; i <= 40; i++) {
        var a = i / 40 * 2 * Math.PI;
        pts.push([ll.lng + r * Math.sin(a) / (6371000 * Math.cos(la)) * 180 / Math.PI, ll.lat + r * Math.cos(a) / 6371000 * 180 / Math.PI]);
      }
      return pts;
    }
    function setAcc(ll, r) {
      var s = m3 && m3.getSource('v3-me-acc');
      if (!s) return;
      var key = ll ? ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6) + ',' + Math.round(r) : '-';
      if (key === accKey) return;
      accKey = key;
      s.setData(ll ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePoly(ll, r)] } } : EMPTY);
    }
    function drawMe3() {
      var ll = loc.fix && loc.state !== 'off' && loc.state !== 'err' ? meShown() : null;
      if (!ll) {
        if (meMk) { meMk.remove(); meMk = null; }
        if (beamMk) { beamMk.remove(); beamMk = null; }
        meKey = '';
        setAcc(null);
        return;
      }
      var at = [ll.lng, ll.lat], key = ll.lat + ',' + ll.lng;
      if (!meMk) {
        meMk = new maplibregl.Marker({ element: mkEl('me-mk', meIcon.options.html, 6), pitchAlignment: 'viewport', rotationAlignment: 'viewport', subpixelPositioning: true }).setLngLat(at).addTo(m3);
        beamMk = new maplibregl.Marker({ element: mkEl('me-beam', BEAM_SVG, 5), pitchAlignment: 'map', rotationAlignment: 'map', subpixelPositioning: true }).setLngLat(at).addTo(m3);
      } else if (key !== meKey) { meMk.setLngLat(at); beamMk.setLngLat(at); }
      meKey = key;
      var now = Date.now(), stale = now - loc.fix.t > LOC_STALE_MS, src = loc.headingSrc;
      var fresh = src === 'compass' ? now - loc.compassAt < COMPASS_LIVE_MS
        : src === 'gps' && now - loc.headingAt < 10000 && (loc.fix.speed || 0) >= GPS_HEADING_SPEED;
      meMk.getElement().classList.toggle('stale', stale);
      beamMk.getElement().classList.toggle('off', !(fresh && loc.heading !== null && !stale));
      if (loc.heading !== null && Math.abs(beamMk.getRotation() - loc.heading) > 0.1) beamMk.setRotation(loc.heading);
      setAcc(ll, loc.fix.acc);
    }

    // ---- My places: the flags (read only here; placing and moving one is done in 2D) ----
    function pinHtml(p) {
      var d = p.id === savedPlaces.destinationId ? savedPlaces.distanceFromMe(p) : null;
      return '<div class="pin-ic">' + savedPlaces.markerSvg(p) + '</div><div class="pin-lbl">' + esc(p.name) + (d !== null ? ' <small>· ' + fmtM(d) + '</small>' : '') + '</div>';
    }
    function syncPins() {
      if (!m3) return;
      var seen = {};
      savedPlaces.forEach(function (p) {
        var id = p.id, m = pinMks[id], html = pinHtml(p), dest = id === savedPlaces.destinationId;
        seen[id] = true;
        if (!m) {
          var e = mkEl('pin-mk', '', 0);
          e.addEventListener('click', function (ev) { ev.stopPropagation(); var q = savedPlaces.find(id); if (q) openPop('pin', q); });
          m = pinMks[id] = new maplibregl.Marker({ element: e, pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([p.lon, p.lat]).addTo(m3);
        }
        var e2 = m.getElement();
        if (e2._h !== html) { e2._h = html; e2.innerHTML = html; }
        e2.classList.toggle('dest', dest);
        e2.style.zIndex = dest ? 4 : 3;
        var ll = m.getLngLat();
        if (ll.lng !== p.lon || ll.lat !== p.lat) m.setLngLat([p.lon, p.lat]);
      });
      Object.keys(pinMks).forEach(function (id) { if (!seen[id]) { pinMks[id].remove(); delete pinMks[id]; } });
      if (pop && popKind === 'pin') {
        var q = savedPlaces.find(popRef.id);
        if (!q) closePop(); else pop.setHTML(savedPlaces.popupHtml(q));
      }
    }
    view3d.placesChanged = function () { if (m3) syncPins(); };
    // a long-press / right-click: a new place is named and put down on the flat map
    function cancelPress() { if (lp) { clearTimeout(lp.t); lp = null; } }
    function addHere(lngLat) {
      if (!view3d.on || Date.now() - addedAt < 1000) return;
      addedAt = Date.now();
      var ll = L.latLng(lngLat.lat, lngLat.lng);
      close('adding a place');
      toast('Places are added in 2D.', 2500);
      openPinDlg('New place here', '', function (name) { savedPlaces.add(name, ll); });
    }

    // ---- popups (PC and phones: the flag's card) ----
    var POP_OFF = { top: [0, 8], 'top-left': [0, 8], 'top-right': [0, 8], bottom: [0, -34], 'bottom-left': [0, -34], 'bottom-right': [0, -34], left: [10, -16], right: [-10, -16] };
    function popOffset(dy) { return { top: [0, 8], 'top-left': [0, 8], 'top-right': [0, 8], bottom: [0, -dy], 'bottom-left': [0, -dy], 'bottom-right': [0, -dy], left: [12, 0], right: [-12, 0] }; }
    // kind: 'pin' (a flag), 'veh' (v101: the vehicle card, PC) or 'stop' (v101: the stop card, PC)
    function openPop(kind, ref) {
      closePop();
      var p = new maplibregl.Popup({ className: 'v3-pop ' + (kind === 'veh' ? 'veh-pop' : kind === 'stop' ? 'stop-pop' : 'pin-pop'), closeButton: false, closeOnClick: false,
        anchor: kind === 'veh' ? 'top' : undefined,   // v100's card: always below the vehicle
        offset: kind === 'pin' ? POP_OFF : kind === 'veh' ? [0, Math.round(VP_GAP * ui) - 8] : popOffset(18), maxWidth: 'none', focusAfterOpen: false });
      if (kind === 'pin') p.setLngLat([ref.lon, ref.lat]).setHTML(savedPlaces.popupHtml(ref));
      else if (kind === 'veh') { var el = vehPopupEl(ref); patchVeh(el, ref); p.setLngLat(vehicleAnchor(ref)).setDOMContent(el); }
      else {
        var st = ref._stop, se = ref._spEl;
        se.style.maxHeight = Math.max(220, Math.round(window.innerHeight * 0.55)) + 'px';
        patchStop(se, st);
        p.setLngLat([st.lon, st.lat]).setDOMContent(se);
        expandedStop = null;
      }
      p.addTo(m3);
      var ce = p.getElement() && p.getElement().querySelector('.maplibregl-popup-content');
      if (ce && kind !== 'pin') ce.style.width = (kind === 'veh' ? vpW() + 36 : 348) + 'px';
      popKind = kind; popRef = ref; pop = p;
      if (kind === 'stop') markSel(ref, true);
      if (kind === 'veh') {   // as v100's card in 2D: body.vp-card, and the map buttons it runs under step aside
        document.body.classList.add('vp-card');
        clearInterval(cardEdgeTimer); cardEdgeTimer = setInterval(vpClearEdge, 250); vpClearEdge();
      }
      p.on('close', function () {
        if (kind === 'veh') { ref.allStops = false; document.body.classList.remove('vp-card'); clearInterval(cardEdgeTimer); setTimeout(vpClearEdge, 0); }
        if (kind === 'stop') { markSel(ref, false); expandedStop = null; }
        if (pop === p) { pop = null; popKind = ''; popRef = null; popClosedAt = Date.now(); }
      });
    }
    function closePop() { if (pop) { var p = pop; pop = null; try { p.remove(); } catch (e) {} popKind = ''; popRef = null; popClosedAt = Date.now(); } }
    var leafletClosePopup = map.closePopup;
    map.closePopup = function () { if (pop) closePop(); return leafletClosePopup.apply(this, arguments); };

    // ---- a tap on the 3D map ----
    function onClick(e) {
      if (Date.now() - dragAt < 300) return;   // v102: the end of a drag (even a short one) isn't a tap, as in Leaflet
      var oe = e && e.originalEvent;
      if (downXY && oe && typeof oe.clientX === 'number' && Math.abs(oe.clientX - downXY[0]) + Math.abs(oe.clientY - downXY[1]) > 6) return;
      var v = e && e.point ? vehAtPoint(e.point) : null;   // v101: a vehicle under the finger
      if (v) { openVeh(v); return; }
      var sm = e && e.point ? stopAtPoint(e.point) : null;   // v103: a stop of the all-stops layer
      if (sm) { stopTap(sm); return; }
      cancelFocusCard();
      if (pop) { closePop(); return; }                    // this tap only closes the open card
      if (sheetStop || sheetVeh || sheetRoute) { closeSheet(); return; }
      if (Date.now() - popClosedAt < 400) return;
      if (selected) deselect();
    }

    // ---- memory: the iPhone's ceiling ----
    function onLost(e) {
      if (!view3d.on || !m3 || (e && e.target && e.target !== m3.getCanvas())) return;   // only the open 3D map's own loss
      if (e && e.preventDefault) e.preventDefault();
      info.lost++;
      store(MEMO_KEY, JSON.stringify({ t: Date.now(), why: 'graphics memory lost' }));
      close('ran out of graphics memory', true);
      toast('3D view closed: the phone ran out of graphics memory.', 7000);
    }
    // in the background nothing is drawn; after 10 minutes there the 3D map is closed (iOS kills hidden tabs that
    // hold a lot of graphics memory)
    document.addEventListener('visibilitychange', function () {
      clearTimeout(hideTimer);
      if (document.hidden) {
        hiddenAt = Date.now();
        if (view3d.on) hideTimer = setTimeout(function () { if (document.hidden) close('in the background for 10 min', true); }, 10 * 60e3);
      } else if (view3d.on && hiddenAt && Date.now() - hiddenAt > 10 * 60e3) close('in the background for 10 min', true);
    });

    // ---- Diagnostics ----
    view3d.diagRows = function () {
      var m = memo(), rows = [];
      var st = view3d.on ? (m3 ? 'On · pitch ' + Math.round(m3.getPitch()) + '° · bearing ' + Math.round((m3.getBearing() + 360) % 360) + '°' : 'On')
        : /^image/.test(mapMode) ? 'Hidden: image map'
        : m ? 'Hidden: stopped ' + clockHM(m.t) + ' (' + m.why + '), back at ' + clockHM(m.t + VIEW3D_RETRY_MS) + ' tomorrow'
        : !/^vector/.test(mapMode) ? 'Waiting for the map' : 'Off';
      rows.push(['Status', st]);
      if (view3d.on && m3) {
        var cv = m3.getCanvas(), dpr = cv.clientWidth ? cv.width / cv.clientWidth : 0;
        rows.push(['Drawn at', dpr.toFixed(2) + '× pixels (screen ' + (window.devicePixelRatio || 1) + '×) · buildings from zoom ' + VIEW3D_BUILDING_ZOOM]);
        rows.push(['Tiles since open', fmtN(tileReq - info.tiles0) + ' asked · ' + fmtN(tileHits - info.hits0) + ' from storage']);
        if (vehMs.length) {
          // the median (a pause for garbage collection makes the average meaningless) and the worst of the last 100
          var sorted = vehMs.slice().sort(function (x, y) { return x - y; }), med = sorted[sorted.length >> 1], worst = sorted[sorted.length - 1];
          rows.push(['Vehicles drawn', fmtN(vehN) + ' near + ' + fmtN(farN) + ' far · layer update ' + med.toFixed(2) + ' ms median, ' + worst.toFixed(1) + ' ms worst (' + VIEW3D_VEH_HZ + '×/s)']);
        }
        rows.push(['2D map while open', freed ? 'freed (VIEW3D_FREE_2D)' : 'kept (instant return)']);
        rows.push(['Terrain', terrainOn ? 'on (Mapterhorn)' : 'off']);   // v103
      }
      rows.push(['Opened', info.opens + '× this session' + (info.lastClose ? ' · last closed: ' + info.lastClose : '') + (info.lost ? ' · memory lost ' + info.lost + '×' : '')]);
      return rows;
    };

    // ---- v103: terrain (off by default): Mapterhorn's free elevation tiles (Copernicus 30 m over Bulgaria) ----
    function terrainAttr(on) {
      if (on === demAttr || !map.attributionControl) return;
      demAttr = on;
      var t = 'Terrain &copy; <a href="https://mapterhorn.com/attribution" target="_blank">Mapterhorn</a>';
      if (on) map.attributionControl.addAttribution(t); else map.attributionControl.removeAttribution(t);
    }
    function applyTerrain() {
      if (!m3 || !m3.getSource('v3-veh')) return;
      try {
        if (terrainOn) {
          if (!m3.getSource('v3-dem')) m3.addSource('v3-dem', { type: 'raster-dem', tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'], tileSize: 512, encoding: 'terrarium', maxzoom: 12 });
          m3.setTerrain({ source: 'v3-dem', exaggeration: 1 });
        } else if (m3.getTerrain && m3.getTerrain()) m3.setTerrain(null);
      } catch (e) { console.warn('3D terrain failed:', e); }
      terrainAttr(terrainOn && view3d.on);
    }
    var terBox = document.getElementById('v3Terrain');
    terBox.checked = terrainOn;
    terBox.onchange = function () { terrainOn = this.checked; store('sofia_3d_terrain', terrainOn ? '1' : '0'); applyTerrain(); };
    view3d.terrain = function () { return { on: terrainOn, set: !!(m3 && m3.getTerrain && m3.getTerrain()) }; };

    function applyBuildingTextures() {
      if (m3 && m3.getSource('v3-me-acc') && window.DecompressionStream) buildingMaterials.apply(m3, textureBox.checked, houseBox.checked);
    }
    textureBox.onchange = function () {
      store('sofia_3d_building_textures', this.checked ? '1' : '0');
      refresh();
      applyBuildingTextures();
    };
    houseBox.onchange = function () {
      store('sofia_3d_house_designs', this.checked ? '1' : '0');
      refresh();
      applyBuildingTextures();
    };

    view3d.open = open;
    view3d.close = close;
    view3d.toggle = function () { if (view3d.on) close('2D button'); else open(); };
    view3d.refresh = refresh;
    view3d.map = function () { return m3; };
    refresh();
  })();

