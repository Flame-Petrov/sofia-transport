  // ---------- Map ----------
  var map = L.map('map', {
    zoomControl: false, preferCanvas: true, maxZoom: 19,
    zoomSnap: L.Browser.touch ? 0 : 1   // keep the scale where the rider lifts their fingers
  }).setView([42.6977, 23.3219], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Your location (v75): added after the zoom buttons, so Leaflet stacks it right above them.
  // What the taps do is in the "Your location" section further down (locButton).
  var locBox = (function () {
    var C = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        var box = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate');
        var a = L.DomUtil.create('a', '', box);
        a.href = '#'; a.setAttribute('role', 'button');
        a.title = 'Show my location'; a.setAttribute('aria-label', 'Show my location');
        a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>' +
          '<path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
          '<circle class="lc-in" cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); locButton(); });
        return box;
      }
    });
    return new C().addTo(map).getContainer();
  })();
  // v100: above it, the compass needle (only while 3D is open: tap = north up) and the 3D / 2D button (only on
  // the vector map). Leaflet stacks each new bottom-right control on top of the previous ones.
  function roundButton(cls, title, html, onTap) {
    var C = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        var box = L.DomUtil.create('div', 'leaflet-control ' + cls);
        var bar = box;
        if (cls === 'leaflet-control-north') {
          box.inert = true;
          bar = L.DomUtil.create('div', 'leaflet-bar', box);
        } else {
          box.classList.add('leaflet-bar');
          box.hidden = true;
        }
        var a = L.DomUtil.create('a', '', bar);
        a.href = '#'; a.setAttribute('role', 'button'); a.title = title; a.setAttribute('aria-label', title);
        a.innerHTML = html;
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); onTap(); });
        return box;
      }
    });
    return new C().addTo(map).getContainer();
  }
  var northBox = roundButton('leaflet-control-north', 'North up',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="nd"><path d="M12 3l3.6 9h-7.2z" fill="#E5221B"/><path d="M12 21l-3.6-9h7.2z" fill="#8e8e93"/></g></svg>',
    function () { if (view3d.north) view3d.north(); });
  var box3d = roundButton('leaflet-control-3d', 'Show the city in 3D', '3D', function () { if (view3d.toggle) view3d.toggle(); });
  // While a zoom (pinch or buttons) is running, Leaflet stretches the current picture and only
  // redraws at the end. Redrawing in the middle puts lines and dots in the wrong place, so all
  // animation pauses until the zoom finishes.
  var zooming = false;
  map.on('zoomstart', function () { zooming = true; });
  map.on('zoomend', function () { zooming = false; });
  // A popup pans the map once when it opens (so it isn't cut off), but not afterwards:
  // otherwise a tracked vehicle's popup, which moves with the bus, keeps pulling the map back
  // and you can't drag away from it.
  map.on('popupopen', function (e) { e.popup.options.autoPan = false; });
  // Selected things live on their own top layer: open stop > tracked vehicle > "your stop" > the rest
  map.createPane('selPane').style.zIndex = 645;
  function raise(mk, on) {
    var el = mk && mk.getElement && mk.getElement();
    if (!el) return;
    var target = on ? map.getPane('selPane') : mk.getPane();
    if (el.parentNode !== target) target.appendChild(el);
  }
  map.on('popupclose', function (e) { e.popup.options.autoPan = true; });
  // Base map. Esri's street map works from a local file on any device (OpenStreetMap's own servers
  // refuse pages opened from disk on PC). detectRetina loads one zoom finer so it stays sharp on phones.
  // If the first provider keeps failing, switch to the next one automatically.
  var ESRI = { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
               attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' };
  // OpenStreetMap's own tile servers block pages opened from a local file (the "Access blocked"
  // tiles), and their volunteer-run servers aren't meant for this kind of use, so the image map is Esri's.
  var TILE_PROVIDERS = [ESRI];
  var tileLayer = null;
  // Image tiles also go through local storage: read from the phone when saved, otherwise
  // downloaded and saved. If the server doesn't allow that kind of download, the tile simply
  // loads the normal way (no saving).
  var CachedTileLayer = L.TileLayer.extend({
    _pxBoundsToTileRange: function (bounds) {
      // 2 extra tiles on every side. No clamping here: Leaflet already skips tiles outside the world,
      // and on high-density phones (detectRetina, 128 px tiles) the world is twice as many tiles wide
      // as 2^zoom, so a 2^zoom limit cut Sofia off and left the map with no tiles at all.
      var range = L.TileLayer.prototype._pxBoundsToTileRange.call(this, bounds);
      range.min.x -= 2; range.min.y -= 2;
      range.max.x += 2; range.max.y += 2;
      return range;
    },
    createTile: function (coords, done) {
      var img = document.createElement('img'), url = this.getTileUrl(coords);
      img.alt = '';
      img.setAttribute('role', 'presentation');
      L.DomEvent.on(img, 'load', L.Util.bind(this._tileOnLoad, this, done, img));
      L.DomEvent.on(img, 'error', L.Util.bind(this._tileOnError, this, done, img));
      // Whatever happens first wins: the saved/downloaded copy, or (on any failure or after 8 s)
      // the plain image address, so a tile can never stay blank waiting on storage or a download.
      var set = false;
      function direct() { if (!set) { set = true; img.src = url; } }
      var slow = setTimeout(direct, 8000);
      function show(buf) {
        clearTimeout(slow);
        if (set) return;
        set = true;
        var u = URL.createObjectURL(new Blob([buf]));
        img.addEventListener('load', function () { URL.revokeObjectURL(u); }, { once: true });
        img.src = u;
      }
      idb.get('tiles', url).then(function (hit) {
        if (hit && hit.d) { tileHits++; show(hit.d); return; }
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        }).then(function (buf) {
          idb.put('tiles', null, { url: url, d: buf, t: Date.now() });
          show(buf);
        });
      }).catch(direct);
      return img;
    }
  });
  // "Map ready" = every tile in view has loaded and is decoded, then a moment for the fade-in
  function confirmDrawn(layer) {
    if (LOAD.map.f >= 1 || layer !== tileLayer) return;
    var tiles = layer._tiles || {}, keys = Object.keys(tiles);
    var drawn = keys.length > 0 && keys.every(function (k) {
      var t = tiles[k];
      return t.loaded && t.el && t.el.complete;
    });
    if (!drawn) { setTimeout(function () { confirmDrawn(layer); }, 150); return; }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(function () { if (layer === tileLayer) setProgress('map', 1, 'Map'); }, 350);
      });
    });
  }
  function useTiles(i) {
    if (tileLayer) map.removeLayer(tileLayer);
    var prov = TILE_PROVIDERS[i], errors = 0, loaded = 0;
    tileLayer = new CachedTileLayer(prov.url, {
      maxZoom: 20, maxNativeZoom: 18, detectRetina: true, keepBuffer: 6,
      // v86: load tiles while the map is being dragged. Leaflet's default on phones (updateWhenIdle) waits
      // until the finger stops, so the side you drag towards stayed empty (measured with an Android browser
      // at 3.5× pixels: up to 20 % of the screen blank during drags → 0 %, saved tiles or not).
      updateWhenIdle: false, updateInterval: 100,
      attribution: prov.attribution + ' · Data: Sofia Traffic GTFS'
    });
    tileLayer.on('tileload', function () { loaded++; setProgress('map', Math.min(0.9, loaded / 12), 'Map'); });
    tileLayer.on('load', function () { confirmDrawn(tileLayer); });
    tileLayer.on('tileerror', function () {
      errors++;
      if (errors >= 6 && loaded === 0 && i + 1 < TILE_PROVIDERS.length) useTiles(i + 1);
      else if (errors >= 6 && loaded === 0) setProgress('map', 1, 'Map unavailable');
    });
    tileLayer.addTo(map);
  }
  // Preferred base map: OpenFreeMap — OpenStreetMap roads (the same map Sofia's route shapes are traced on),
  // drawn as vector graphics so it's sharp at every zoom, free, no key, and allowed from a file opened from disk.
  // Falls back to the image tiles above if WebGL or OpenFreeMap isn't available.
  // Cap the two WebGL drawing buffers on high-density phones. UI text and
  // Leaflet overlays still use the screen's native resolution.
  function mapPixelRatio() {
    return Math.min(window.devicePixelRatio || 1, isPhone() ? 1.5 : MAP_DPR_MAX);
  }
  var OFM_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  var OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';   // the style's vector source
  var tileReq = 0, tileDone = 0, tileHits = 0, tileOk = 0, mapIdle = false, mapMode = '', glLayer = null, builtStyle = null;   // glLayer: the vector map layer
  function ofm(u) { return u.replace(/^https:\/\//, 'ofm://'); }
  // v101: hooks on the vector map's MapLibre map, which VIEW3D_FREE_2D can replace (the plugin makes a new one when re-added)
  function hookGlMap(g) { g.on('move', function () { glMoved = true; }); }   // v89: see camStep

  // Map tiles and fonts go through "ofm://": served from the phone's storage when saved,
  // otherwise downloaded and saved. Tile addresses carry a version, so saved tiles never go stale.
  // The map and the preload (below) share one download per tile.
  var tileInflight = {};
  // v85: one map version for a month. The tile list (TileJSON) names OpenFreeMap's current build
  // (".../planet/20261101_080013_pt/{z}/{x}/{y}.pbf") and a new build changes every tile address, so
  // re-reading it every 2 days (v84) threw the saved map away each time OpenFreeMap published. It is now
  // kept 30 days: the saved map is used for a month, then the next build is downloaded once.
  var MAP_VERSION_DAYS = 30;
  var mapVer = '', mapVerAt = 0, tjFetch = null, verSwap = null;   // verSwap: { from, to } once a build is gone
  function tileVer(url) { var m = /\/planet\/([^/]+)\//.exec(url); return m ? m[1] : ''; }
  // tiles of an offline area (and the map fonts, which never change) are saved as kept
  var keepUrls = {};
  function keepTileT(url) { return keepUrls[url] || /\/fonts\//.test(url) ? KEEP_T + Date.now() : Date.now(); }
  function fetchTile(url, signal) {
    if (!tileInflight[url]) {
      tileInflight[url] = fetch(url, signal ? { signal: signal } : undefined)
        .then(function (r) {
          if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
          return r.arrayBuffer();
        })
        .then(function (buf) { idb.put('tiles', null, { url: url, d: buf, t: keepTileT(url) }); return buf; })
        .then(function (buf) { delete tileInflight[url]; return buf; }, function (e) { delete tileInflight[url]; throw e; });
    }
    return tileInflight[url];
  }
  // A month-old build can be taken off OpenFreeMap's servers. A tile that is missing there (404) asks
  // for the current tile list once; if the build changed, every address of the old one is read from
  // the new build from then on (saved tiles of the old build still show until the monthly refresh).
  function newerBuild() {
    if (!tjFetch) {
      tjFetch = fetch(OFM_TILEJSON).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (tj) {
          var v = tileVer((tj.tiles || [])[0] || '');
          if (!v || v === mapVer) return null;
          idb.put('files', 'tilejson:' + OFM_TILEJSON, { d: tj, t: Date.now() });   // the next opening starts on it
          verSwap = { from: mapVer, to: v };
          mapVer = v; mapVerAt = Date.now();
          return verSwap;
        }).catch(function () { return null; });
    }
    return tjFetch;
  }
  function swapVer(url) { return verSwap && url.indexOf('/planet/' + verSwap.from + '/') >= 0 ? url.replace('/planet/' + verSwap.from + '/', '/planet/' + verSwap.to + '/') : url; }
  function getTile(url, signal) {
    return idb.get('tiles', url).then(function (hit) {
      if (hit && hit.d) return { d: hit.d, saved: true };
      var live = swapVer(url);
      if (live !== url) return getTile(live, signal);
      return fetchTile(url, signal).then(function (buf) { return { d: buf, saved: false }; }, function (e) {
        if (e.status !== 404 || !tileVer(url)) throw e;
        return newerBuild().then(function (sw) {
          if (!sw || swapVer(url) === url) throw e;
          return getTile(swapVer(url), signal);
        });
      });
    });
  }
  function registerCacheProtocol() {
    maplibregl.addProtocol('ofm', function (params, abortController) {
      var url = 'https://' + params.url.slice(6);
      tileReq++;
      return getTile(url, abortController.signal).then(function (r) {
        if (r.saved) tileHits++;
        return r.d;
      }).then(function (buf) {
        tileDone++;
        if (!/\/fonts\//.test(url)) tileOk++;   // a real map tile arrived
        mapProgress();
        // v100: a copy. MapLibre hands the buffer to its worker, which detaches it; one download shared by two
        // requests (two maps, or a map asking twice for a tile it shows at two zoom levels) failed the second
        // one with "ArrayBuffer at index 0 is already detached" (seen with the 3D map open).
        return { data: buf.slice(0) };
      }, function (e) {
        tileDone++; mapProgress();
        throw e;
      });
    });
  }
  function mapProgress() {
    if (!mapIdle) setProgress('map', Math.min(0.95, 0.15 + 0.8 * tileDone / Math.max(tileReq, 8)), 'Map');
  }

  // The style with every tile source and font rewritten to "ofm://"
  // v76: a light, muted palette for OpenFreeMap's "liberty" style, so the map stays readable without
  // competing with the glass controls and the vehicle dots: warm off-white land and streets, soft green
  // parks, pale blue water, subtle road outlines, quieter buildings and points of interest. Layers are
  // matched by id (a layer that isn't there is simply skipped).
  var MAP_TONE = {
    'background': { 'background-color': '#F6F3EE' },
    'park': { 'fill-color': '#DDEBCF', 'fill-opacity': 0.9 },
    'park_outline': { 'line-color': 'rgba(205,224,188,.6)' },
    'landuse_residential': { 'fill-color': 'rgba(239,233,224,.45)' },
    'landcover_wood': { 'fill-color': 'rgba(196,222,176,.55)' },
    'landcover_grass': { 'fill-color': 'rgba(214,232,196,.85)' },
    'landuse_pitch': { 'fill-color': '#E3EBD6' }, 'landuse_track': { 'fill-color': '#E3EBD6' },
    'landuse_cemetery': { 'fill-color': '#DCE6CF' }, 'landuse_hospital': { 'fill-color': '#F7E6E6' },
    'landuse_school': { 'fill-color': '#F1EDDB' }, 'landcover_sand': { 'fill-color': '#F3ECD6' },
    'water': { 'fill-color': '#C3DDF1' },
    'waterway_river': { 'line-color': '#B2D3EE' }, 'waterway_other': { 'line-color': '#B2D3EE' }, 'waterway_tunnel': { 'line-color': '#B2D3EE' },
    'aeroway_fill': { 'fill-color': '#ECE9E3' },
    'building': { 'fill-color': '#ECE7E0', 'fill-outline-color': '#E2DCD3' },
    'building-3d': { 'fill-extrusion-color': '#ECE7E0', 'fill-extrusion-opacity': 0.55 },
    'boundary_3': { 'line-color': 'rgba(150,140,130,.35)' }
  };
  // v82: OpenFreeMap's style compares feature properties as numbers (POI "rank", road-shield
  // "ref_length", 3D-building heights). Where a feature lacks one, MapLibre's map worker logged
  // "Expected value to be of type number, but found null instead." (seen since the 3D buildings; same
  // in v75, so not from the v76 colours). A missing number is now handled explicitly, with the result
  // MapLibre already used: a comparison is false (the feature isn't drawn by that layer), a height is 0.
  var CMP_OPS = { '<': 1, '<=': 1, '>': 1, '>=': 1 };
  function isGet(e) { return Array.isArray(e) && e[0] === 'get' && e.length === 2 && typeof e[1] === 'string'; }
  function guardNumbers(e) {
    if (!Array.isArray(e)) return e;
    var out = e.map(guardNumbers);
    if (CMP_OPS[out[0]] && out.length === 3) {
      var gets = out.slice(1).filter(isGet);
      if (gets.length) {
        var ok = gets.map(function (g) { return ['==', ['typeof', g], 'number']; });
        return ['case', ok.length === 1 ? ok[0] : ['all'].concat(ok), out, false];
      }
    }
    return out;
  }
  function guardStyleNumbers(l) {
    // only comparisons on ["get", …] change: old-style filters (["<", "rank", 20]) never contain it and stay as they are
    if (Array.isArray(l.filter)) l.filter = guardNumbers(l.filter);
    ['fill-extrusion-height', 'fill-extrusion-base'].forEach(function (k) {
      if (l.paint && isGet(l.paint[k])) l.paint[k] = ['coalesce', l.paint[k], 0];
    });
  }
  function restyleMap(style) {
    (style.layers || []).forEach(function (l) {
      guardStyleNumbers(l);
      var id = l.id, p = MAP_TONE[id], set = function (k, v) { l.paint = l.paint || {}; l.paint[k] = v; };
      if (p) Object.keys(p).forEach(function (k) { set(k, p[k]); });
      if (l.type === 'line' && /^(road|bridge|tunnel)_/.test(id)) {
        var casing = /_casing$/.test(id), major = /motorway|trunk|primary|secondary|tertiary|link/.test(id);
        if (/rail/.test(id)) set('line-color', '#D3CEC6');
        else if (/path_pedestrian/.test(id)) set('line-color', casing ? 'rgba(200,192,180,.5)' : '#FBF9F6');
        else if (casing) set('line-color', major ? '#E9DDBF' : '#E4DED4');   // subtle outlines
        else if (/motorway/.test(id)) set('line-color', '#F6D99E');
        else if (major) set('line-color', '#FAEDC2');                        // warm pale yellow main roads
        else set('line-color', '#FFFFFF');                                   // warm off-white side streets
      }
      if (l.type === 'symbol' && /^poi_/.test(id) && id !== 'poi_transit') {   // shops, cafés…: quieter
        set('icon-opacity', 0.5); set('text-opacity', 0.65);
      }
      if (l.type === 'symbol' && /^highway-name/.test(id)) set('text-color', '#7A746B');
    });
  }
  function buildStyle() {
    return cachedJSON('ofm-style', OFM_STYLE, 7 * 864e5).then(function (style) {
      style = JSON.parse(JSON.stringify(style));
      // 3D buildings only from BUILDING_3D_ZOOM; below it the flat building layer carries on, so there is
      // no zoom without buildings. The vector map runs one zoom level below Leaflet's (512 px tiles).
      var z3d = BUILDING_3D_ZOOM - 1;
      (style.layers || []).forEach(function (l) {
        if (l.type === 'fill-extrusion') l.minzoom = Math.max(l.minzoom || 0, z3d);
        else if (l.type === 'fill' && l['source-layer'] === 'building' && typeof l.maxzoom === 'number' && l.maxzoom < z3d) l.maxzoom = z3d;
      });
      restyleMap(style);
      // for the performance overlay: where the style's 3D buildings start (style zoom units)
      (style.layers || []).forEach(function (l) {
        if (l.type === 'fill-extrusion' && (buildingMinZoom === null || (l.minzoom || 0) < buildingMinZoom)) buildingMinZoom = l.minzoom || 0;
      });
      var jobs = Object.keys(style.sources || {}).map(function (name) {
        var srcDef = style.sources[name];
        if (srcDef.type !== 'vector' || !srcDef.url || !/^https:\/\/tiles\.openfreemap\.org/.test(srcDef.url)) return null;
        return cachedJSON('tilejson:' + srcDef.url, srcDef.url, MAP_VERSION_DAYS * 864e5).then(function (tj) {
          if (srcDef.url === OFM_TILEJSON) {
            mapVer = tileVer((tj.tiles || [])[0] || '');
            idb.get('files', 'tilejson:' + srcDef.url).then(function (c) { if (c && c.t) mapVerAt = c.t; });
          }
          style.sources[name] = {
            type: 'vector', tiles: (tj.tiles || []).map(ofm),
            minzoom: tj.minzoom || 0, maxzoom: tj.maxzoom || 14, attribution: tj.attribution || ''
          };
        });
      });
      if (style.glyphs) style.glyphs = ofm(style.glyphs);
      return Promise.all(jobs).then(function () { return style; });
    });
  }

  // Preferred base map: OpenFreeMap — OpenStreetMap roads (the same map Sofia's route shapes are traced on),
  // drawn as vector graphics so it's sharp at every zoom, free, no key, and allowed from a file opened from disk.
  // Falls back to the image tiles above if WebGL or OpenFreeMap isn't available.
  function useVectorMap() {
    var ok = false;
    try { ok = !!(window.maplibregl && L.maplibreGL && document.createElement('canvas').getContext('webgl')); } catch (e) {}
    // this device couldn't show the vector map recently: go straight to the image map (faster),
    // and try the vector map again after a week
    var memo = null;
    try { memo = JSON.parse(store('sofia_map_mode') || 'null'); } catch (e) {}
    if (memo && memo.mode === 'image' && Date.now() - memo.t < 864e5) { ok = false; mapMode = 'image map (vector failed: ' + (memo.why || '?') + ')'; }
    if (!ok) { mapMode = mapMode || 'image map'; useTiles(0); return; }
    var settled = false, gl;
    function fallback(why) {
      if (settled) return;
      settled = true;
      console.warn('Vector map unavailable, using image tiles:', why);
      store('sofia_map_mode', JSON.stringify({ mode: 'image', t: Date.now(), why: String(why) }));
      mapMode = 'image map (vector failed: ' + why + ')';
      if (view3d.on) { view3d.close('image map', true); toast('3D view closed: the map switched to the image map.', 5000); }   // v100
      if (view3d.refresh) view3d.refresh();
      setTimeout(function () { offline.render(); }, 0);
      try { if (gl) map.removeLayer(gl); } catch (e) {}
      glLayer = null;
      useTiles(0);
    }
    function works() {
      if (settled) return;
      settled = true;
      mapMode = 'vector map';
      store('sofia_map_mode', JSON.stringify({ mode: 'vector', t: Date.now() }));
      if (view3d.refresh) view3d.refresh();   // v100: the 3D button appears
      // the view first (what you're looking at), then the offline areas (v85)
      afterLoad(function () { if (/^vector/.test(mapMode)) preloadMap(builtStyle).then(function () { offline.sync(); }); });
    }
    setProgress('map', 0.05, 'Map');
    registerCacheProtocol();
    buildStyle().then(function (style) {
      if (settled) return;
      builtStyle = style;
      setProgress('map', 0.15, 'Map');
      gl = L.maplibreGL({
        style: style, pixelRatio: mapPixelRatio(),
        // map pieces appear at once instead of fading in, and stay in memory for every zoom level
        // between the starting view and street level, so zooming back and forth doesn't rebuild them
        // labels that the map adds or drops while it moves fade in 0.12 s instead of blinking on/off
        fadeDuration: 120, maxTileCacheZoomLevels: 10,
        // no extra margin drawn around the screen: 0.35 (v69) made every frame draw ~3× the pixels and halved
        // the frame rate while panning; tiles around the view are still fetched ahead (prefetchViewportTiles).
        // Cost: a fast drag into a never-visited area can show a thin blank edge for a moment (measured:
        // 1 of 16 drags, 25 px, gone within 0.4 s).
        padding: 0,
        attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; OpenStreetMap contributors · Data: Sofia Traffic GTFS'
      }).addTo(map);
      glLayer = gl;
      // The plugin puts the map canvas on whole pixels but centres the map on Leaflet's exact centre, so
      // when Leaflet's layers sit at a fraction of a pixel (follow camera, pan animations) the base map
      // would be off by that fraction. Centre it on the point under the canvas's real middle instead.
      gl._transformGL = function (glMap) {
        var m = this._map, tl = m.containerPointToLayerPoint([0, 0]).subtract(m.getSize().multiplyBy(this.options.padding));
        var c = m.layerPointToLatLng(L.point(Math.round(tl.x), Math.round(tl.y)).add(this.getSize().divideBy(2)));
        glMap.jumpTo({ center: [c.lng, c.lat], zoom: m.getZoom() - 1 });
      };
      var glMap = gl.getMaplibreMap();
      hookGlMap(glMap);
      // (v90 tried drawing the vector map inside Leaflet's frame on every re-centre: 0.4 px instead of ~2 px off the
      // vehicles, but a quarter fewer frames per second while following — not kept; see the documentation, §5.11)
      // v86: no label fade while the map is dragged. The 120 ms fade made MapLibre redraw the whole map on
      // every frame of a drag (~75 redraws/s, measured) instead of only when it moved (the plugin syncs
      // every 32 ms): ~220 → ~60 redraws over the same test drags. Labels appearing at the edge during a
      // drag pop in; the fade is back as soon as the map stops (moveend, after the glide).
      if (typeof glMap._fadeDuration === 'number') {
        map.on('dragstart', function () { var g = glLayer && glLayer._glMap; if (g) g._fadeDuration = 0; });
        map.on('moveend', function () { var g = glLayer && glLayer._glMap; if (g) g._fadeDuration = 120; });
      }
      // the style alone loading isn't enough: wait for real tiles, or switch to the image map
      var watch = setInterval(function () {
        if (settled) { clearInterval(watch); return; }
        if (tileOk > 0) { clearInterval(watch); works(); }
      }, 200);
      setTimeout(function () { if (!settled && tileOk === 0) fallback('no tiles arrived'); }, 9000);
      function mapReady() {
        if (mapIdle || tileOk === 0) return;
        mapIdle = true;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { setTimeout(function () { setProgress('map', 1, 'Map'); }, 250); });
        });
      }
      glMap.on('idle', mapReady);
      var poll = setInterval(function () {
        try {
          if (mapIdle) { clearInterval(poll); return; }
          if (glMap.isStyleLoaded() && glMap.areTilesLoaded()) { clearInterval(poll); mapReady(); }
        } catch (e) {}
      }, 300);
      glMap.on('error', function (e) { if (!settled) fallback(e && e.error ? e.error.message : 'error'); });
    }).catch(function (e) { fallback(e.message); });
    setTimeout(function () { fallback('timeout'); }, 15000);
  }

