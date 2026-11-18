  // ---------- Offline map areas (v85) ----------
  // Areas whose whole map is kept on the phone, at every detail level (zoom 8 to the most detailed
  // tiles, from which every closer zoom is drawn). "Sofia" (every stop of the network, 1st–99th
  // percentile) is there from the start; "Save this view" in the menu adds the area on screen. After
  // the app has loaded, missing tiles are downloaded quietly in the background, 4 at a time. Kept tiles
  // are never removed to make room (KEEP_T); removing an area removes its tiles. When the monthly map
  // version changes (MAP_VERSION_DAYS) every area is downloaded again and the old build is deleted.
  // The list is in localStorage 'sofia_offline_areas', the download record in 'sofia_offline_state'.
  var offline = (function () {
    var AREA_Z0 = 8, AREA_MAX_TILES = 2000, KB_PER_TILE = 55;
    var SOFIA = { id: 'sofia', name: 'Sofia', b: [23.12, 42.52, 23.55, 42.83] };   // [west, south, east, north]
    var areas = null, rec = {}, run = null, html = '';
    // what's happening now: { id, done, total, failed } while an area downloads
    var now = null, lastErr = '';
    try { areas = JSON.parse(store('sofia_offline_areas') || 'null'); } catch (e) { areas = null; }
    if (!Array.isArray(areas)) areas = [SOFIA];
    areas = areas.filter(function (a) { return a && a.id && a.name && Array.isArray(a.b) && a.b.length === 4 && a.b.every(isFinite); });
    try { rec = JSON.parse(store('sofia_offline_state') || '{}') || {}; } catch (e) { rec = {}; }
    function save() { store('sofia_offline_areas', JSON.stringify(areas)); store('sofia_offline_state', JSON.stringify(rec)); }
    function zTop() { var s = vectorSource(builtStyle); return (s && s.maxzoom) || 14; }
    // the tile addresses that cover an area, coarse levels first
    function urlsFor(b, z1) {
      var s = vectorSource(builtStyle), out = [];
      if (!s) return out;
      var tpl = 'https://' + s.tiles[0].replace(/^ofm:\/\//, '');
      if (verSwap) tpl = swapVer(tpl);
      for (var z = AREA_Z0; z <= z1; z++) {
        var n = Math.pow(2, z) - 1;
        var x0 = Math.max(0, tileX(b[0], z)), x1 = Math.min(n, tileX(b[2], z));
        var y0 = Math.max(0, tileY(b[3], z)), y1 = Math.min(n, tileY(b[1], z));
        for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      }
      return out;
    }
    function countFor(b) {   // without building the list (for big areas)
      var z1 = zTop(), n = 0;
      for (var z = AREA_Z0; z <= z1; z++) n += (tileX(b[2], z) - tileX(b[0], z) + 1) * (tileY(b[1], z) - tileY(b[3], z) + 1);
      return n;
    }
    function mb(bytes) { return bytes >= 10485760 ? Math.round(bytes / 1048576) + ' MB' : (bytes / 1048576).toFixed(1) + ' MB'; }
    function ready(a) { var r = rec[a.id]; return !!(r && r.ver === mapVer && !r.failed && r.n); }
    function canRun() { return /^vector/.test(mapMode) && storageOn !== false && !!vectorSource(builtStyle) && !!mapVer; }

    // Downloads what's missing for every area (one at a time), then removes tiles of older builds.
    // Called after the app has loaded, and again when an area is added.
    function sync() {
      if (run) { run.again = true; return run.p; }
      if (!canRun()) { render(); return Promise.resolve(); }
      // "Save data" on: nothing big in the background (an area can still be refreshed from the list)
      var saveData = false;
      try { saveData = !!(navigator.connection && navigator.connection.saveData); } catch (e) {}
      run = { again: false };
      run.p = idb.keptKeys().then(function (kept) {
        if (!kept) { lastErr = 'storage not available'; return; }
        var todo = areas.filter(function (a) { return !saveData || ready(a); });
        return todo.reduce(function (p, a) { return p.then(function () { return syncArea(a, kept.keys); }); }, Promise.resolve());
      }).then(cleanup).catch(function (e) { lastErr = String(e && e.message || e); })
        .then(function () {
          var again = run.again;
          now = null; run = null; render(); renderDiag();
          if (again) return sync();
        });
      render();
      return run.p;
    }
    function syncArea(a, keptKeys) {
      if (areas.indexOf(a) < 0) return Promise.resolve();   // removed meanwhile
      var urls = urlsFor(a.b, zTop()), ver = mapVer;
      urls.forEach(function (u) { keepUrls[u] = 1; });
      var todo = urls.filter(function (u) { return !keptKeys[u]; });
      var r = rec[a.id] && rec[a.id].ver === mapVer ? rec[a.id] : { bytes: 0 };
      if (!todo.length && ready(a)) return Promise.resolve();   // all there: nothing read, nothing downloaded
      now = { id: a.id, done: urls.length - todo.length, total: urls.length, failed: 0 };
      var bytes = todo.length === urls.length ? 0 : r.bytes || 0;   // a partial run keeps the size it counted so far
      render();
      return runLimited(todo.map(function (u) {
        return function () {
          if (areas.indexOf(a) < 0 || mapVer !== ver) return Promise.resolve();   // removed, or the build changed
          // a tile that is already saved (seen on the map before) is re-saved as kept, not downloaded again
          return idb.get('tiles', u).then(function (hit) {
            if (hit && hit.d) return idb.put('tiles', null, { url: u, d: hit.d, t: KEEP_T + Date.now() }).then(function (key) {
              if (key !== u) throw new Error('Offline tile was not retained');
              return hit.d;
            });
            return fetchTile(u, undefined, true);
          }).then(function (buf) { bytes += buf.byteLength; keptKeys[u] = 1; }, function (e) {
            now.failed++;
            // the build was taken off the server: switch to the current one and start this run over
            if (e && e.status === 404) newerBuild().then(function (sw) { if (sw && run) run.again = true; });
          })
            .then(function () { now.done++; if (now.done % 25 === 0) { render(); renderDiag(); } });
        };
      }), 4).then(function () {
        if (areas.indexOf(a) < 0 || mapVer !== ver) return;
        // (size unknown when the record was lost but the tiles were all there: the estimate)
        rec[a.id] = { ver: ver, n: urls.length, bytes: bytes || (now.failed ? 0 : urls.length * KB_PER_TILE * 1024), failed: now.failed, t: Date.now() };
        save();
      });
    }
    // after a complete run on the current build: tiles of older builds go (kept or not), and kept
    // tiles no area needs any more become ordinary again… by being removed (cheapest, frees the space)
    function cleanup() {
      if (!mapVer || areas.some(function (a) { return !ready(a); })) return;
      var want = {};
      areas.forEach(function (a) { urlsFor(a.b, zTop()).forEach(function (u) { want[u] = 1; }); });
      return idb.dropTiles(function (url, kept) {
        var v = tileVer(url);
        if (!v) return false;                 // fonts, image-map tiles
        if (v !== mapVer) return /tiles\.openfreemap\.org\/planet\//.test(url);
        return kept && !want[url];
      });
    }

    function add(name, b) {
      var a = { id: 'a' + Date.now().toString(36), name: name, b: b.map(function (v) { return +v.toFixed(5); }) };
      areas.push(a); save(); render(); sync();
    }
    function remove(a) {
      areas = areas.filter(function (x) { return x !== a; });
      delete rec[a.id]; save();
      var want = {};
      areas.forEach(function (x) { urlsFor(x.b, zTop()).forEach(function (u) { want[u] = 1; }); });
      urlsFor(a.b, zTop()).forEach(function (u) { if (!want[u]) delete keepUrls[u]; });
      // once nothing is downloading (a running area would put its tiles back)
      (run ? run.p : Promise.resolve()).then(function () {
        return idb.dropTiles(function (url, kept) { return kept && !!tileVer(url) && !want[url]; });
      }).then(function () { render(); renderDiag(); });
      render();
    }
    function show(a) {
      var box = L.latLngBounds([a.b[1], a.b[0]], [a.b[3], a.b[2]]);
      setLocFollow(false);
      map.flyToBounds(box, { paddingTopLeft: [30, freeTop() + 30], paddingBottomRight: [30, map.getSize().y - freeBottom() + 30], duration: 0.8 });
      var rect = L.rectangle(box, { color: '#0A6CF0', weight: 2, dashArray: '6 5', fillOpacity: 0.06, interactive: false }).addTo(map);
      setTimeout(function () { map.removeLayer(rect); }, 4000);
      if (isPhone()) setFolded(true);
    }

    // ---- the list in the menu ----
    var CLOUD_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 12.5h7.2a2.8 2.8 0 0 0 .4-5.6A4 4 0 0 0 4.4 6a3.3 3.3 0 0 0 .1 6.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.8v4M6.3 9.2L8 10.9l1.7-1.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function status(a) {
      var r = rec[a.id];
      if (now && now.id === a.id) return t('Downloading {p}%', { p: Math.round(100 * now.done / Math.max(1, now.total)) });
      if (ready(a)) return t('{size} · saved', { size: mb(r.bytes) });
      if (!canRun()) return '';
      if (r && r.ver === mapVer && r.failed) return t('{n} tiles missing · retry', { n: r.failed });
      if (r && r.ver && r.ver !== mapVer) return t('Updating soon');
      return run ? t('Waiting') : t('up to {size}', { size: mb(countFor(a.b) * KB_PER_TILE * 1024) });
    }
    function render() {
      var list = document.getElementById('offList');
      if (!list) return;
      var n = areas.filter(ready).length;
      // release 109: plain words instead of "0/1" — "1 area saved", "1 of 2 saved", "Not saved yet", "Saving…"
      var cnt = !areas.length || !/^vector/.test(mapMode) ? '' : now ? t('Saving…') : !n ? t('Not saved yet')
        : n === areas.length ? tp(n, '{n} area saved', '{n} areas saved') : t('{n} of {total} saved', { n: n, total: areas.length });
      var cEl = document.getElementById('offCount');
      if (cEl.textContent !== cnt) cEl.textContent = cnt;
      var h = areas.map(function (a) {
        var nm = esc(t(a.name)), st = status(a), busy = now && now.id === a.id;
        return '<div class="pl-item off-item' + (ready(a) ? ' ok' : '') + '" role="listitem" data-off="' + esc(a.id) + '">' +
          '<button type="button" class="pl-go" data-off-act="show" title="' + esc(t('Show this area on the map')) + '">' + CLOUD_SVG +
            '<span class="pl-n">' + nm + '</span><span class="pl-d">' + esc(st) + '</span></button>' +
          (busy ? '<i class="off-bar" style="--p:' + (now.done / Math.max(1, now.total)).toFixed(3) + '"></i>' : '') +
          '<button type="button" class="pl-act" data-off-act="del" title="' + esc(t('Remove from the phone')) + '" aria-label="' + esc(t('Remove {name}', { name: t(a.name) })) + '">' + DEL_SVG + '</button></div>';
      }).join('');
      if (h !== html) { html = h; list.innerHTML = h; }
      var info = !/^vector/.test(mapMode) ? (mapMode ? t('Offline areas work with the vector map only (this device is using the image map).') : '')
        : storageOn === false ? t('This browser doesn\'t allow saving here, so areas can\'t be kept.')
        : mapVer ? t('Map of {date} · next update {when}', { date: verDate(mapVer), when: nextUpdate() }) : '';
      var el = document.getElementById('offInfo');
      if (el.textContent !== info) el.textContent = info;
    }
    function verDate(v) {   // "20261101_080013_pt" → "1 Nov 2026"
      var m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
      if (!m) return v;
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function nextUpdate() {
      if (!mapVerAt) return t('in about a month');
      var d = Math.ceil((mapVerAt + MAP_VERSION_DAYS * 864e5 - Date.now()) / 864e5);
      return d <= 1 ? t('on the next opening') : t('in {n} days', { n: d });
    }
    function setOpen(on) {
      reveal(document.getElementById('offBody'), on);
      document.getElementById('offBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
      store('sofia_offline_open', on ? '1' : '0');
      if (on) render();
    }
    document.getElementById('offBtn').onclick = function () { setOpen(!isRevealed(document.getElementById('offBody'))); };
    document.getElementById('offAdd').onclick = function () {
      var bb = map.getBounds(), b = [bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()], n = countFor(b);
      if (n > AREA_MAX_TILES) {
        toast(t('This view is too big to keep (up to {size}). Zoom in and try again.', { size: mb(n * KB_PER_TILE * 1024) }));
        return;
      }
      openPinDlg(t('Keep this view offline'), '', function (name) { add(name, b); },
        { sub: t('Up to {size} on this phone (less outside cities) · every zoom level · updated monthly', { size: mb(n * KB_PER_TILE * 1024) }), placeholder: t('e.g. Plovdiv, Bansko, Grandma\'s') });
    };
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-off-act]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var box = b.closest('[data-off]'), id = box && box.getAttribute('data-off'), act = b.getAttribute('data-off-act');
      var a = areas.filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      if (act === 'show') {
        show(a);
        if (!ready(a) && !run && canRun()) sync();   // also retries an area that had missing tiles
      } else if (act === 'del') {
        if (!b.classList.contains('confirm')) {   // first tap asks, a second one within 3 s removes
          var was = b.innerHTML;
          b.classList.add('confirm');
          b.textContent = t('Remove?');
          setTimeout(function () { if (b.isConnected) { b.classList.remove('confirm'); b.innerHTML = was; } }, 3000);
          return;
        }
        remove(a);
      }
    }, true);
    // after the whole script has run (the list uses icons and helpers defined further down)
    setTimeout(function () { if (store('sofia_offline_open') === '1') setOpen(true); else render(); }, 0);
    return {
      sync: sync, render: render,
      // for the diagnostics
      info: function () {
        var size = 0, n = 0;
        areas.forEach(function (a) { if (ready(a)) { size += rec[a.id].bytes; n++; } });
        return {
          areas: areas.length, ready: n, bytes: size, ver: mapVer, swapped: !!verSwap, err: lastErr,
          now: now ? (areas.filter(function (a) { return a.id === now.id; })[0] || {}).name + ' ' + now.done + '/' + now.total + (now.failed ? ' (' + now.failed + ' failed)' : '') : ''
        };
      }
    };
  })();
  useVectorMap();
  // Dots are drawn on one canvas (cheap); labelled markers are DOM elements (expensive), so few of them.
  // Each dot answers to the mouse within its radius + 5 px, so neighbouring dots overlap. Leaflet then
  // picks the dot drawn last, often a neighbour of the one under the pointer (hover grew the wrong dot,
  // a click could track the wrong vehicle). Here the dot closest to the pointer wins, for hover and clicks.
  var DotCanvas = L.Canvas.extend({
    // release 109: a dot's shape tells the vehicle type (options.shape, set in features/search/render.js):
    // 'square' for trams, 'diamond' for trolleybuses, a circle otherwise. The same area as the circle, so none looks bigger.
    _updateCircle: function (layer) {
      var shape = layer.options.shape;
      if (!shape || shape === 'circle') return L.Canvas.prototype._updateCircle.call(this, layer);
      if (!this._drawing || layer._empty()) return;
      var p = layer._point, ctx = this._ctx, r = Math.max(Math.round(layer._radius), 1);
      ctx.beginPath();
      if (shape === 'square') {
        var h = r * 0.89, k = Math.min(1.5, h * 0.3);   // half side; small rounded corners
        ctx.moveTo(p.x - h + k, p.y - h); ctx.lineTo(p.x + h - k, p.y - h); ctx.quadraticCurveTo(p.x + h, p.y - h, p.x + h, p.y - h + k);
        ctx.lineTo(p.x + h, p.y + h - k); ctx.quadraticCurveTo(p.x + h, p.y + h, p.x + h - k, p.y + h);
        ctx.lineTo(p.x - h + k, p.y + h); ctx.quadraticCurveTo(p.x - h, p.y + h, p.x - h, p.y + h - k);
        ctx.lineTo(p.x - h, p.y - h + k); ctx.quadraticCurveTo(p.x - h, p.y - h, p.x - h + k, p.y - h);
      } else {   // diamond
        var d = r * 1.26;
        ctx.moveTo(p.x, p.y - d); ctx.lineTo(p.x + d, p.y); ctx.lineTo(p.x, p.y + d); ctx.lineTo(p.x - d, p.y);
      }
      ctx.closePath();
      this._fillStroke(ctx, layer);
    },
    _closestAt: function (point, e) {
      var best = null, bestD2 = Infinity, layer;
      for (var order = this._drawFirst; order; order = order.next) {
        layer = order.layer;
        if (!layer.options.interactive || !layer._point) continue;
        if (e && (e.type === 'click' || e.type === 'preclick') && this._map._draggableMoved(layer)) continue;
        var dx = point.x - layer._point.x, dy = point.y - layer._point.y;
        var d2 = dx * dx + dy * dy;
        var r = (layer.options && layer.options.radius) || 5;
        var tol = r + 5;
        if (d2 <= tol * tol && d2 <= bestD2) { bestD2 = d2; best = layer; }   // equal distance: the one drawn on top
      }
      return best;
    },
    _onClick: function (e) {
      var layer = this._closestAt(this._map.mouseEventToLayerPoint(e), e);
      this._fireEvent(layer ? [layer] : false, e);
    },
    _handleMouseHover: function (e, point) {
      if (this._mouseHoverThrottled) return;
      var layer = this._closestAt(point);
      if (layer !== this._hoveredLayer) {
        this._handleMouseOut(e);
        if (layer) {
          L.DomUtil.addClass(this._container, 'leaflet-interactive');   // pointer cursor
          this._fireEvent([layer], e, 'mouseover');
          this._hoveredLayer = layer;
        }
      }
      this._fireEvent(this._hoveredLayer ? [this._hoveredLayer] : false, e);
      this._mouseHoverThrottled = true;
      setTimeout(L.Util.bind(function () { this._mouseHoverThrottled = false; }, this), 32);
    }
  });
  var canvas = new DotCanvas({ padding: 0.3, tolerance: 5 });
  var dotLayer = L.layerGroup().addTo(map);
  var pillLayer = L.layerGroup().addTo(map);

