  // ---------- Map preload: load the map once ----------
  // Once the loading screen is gone, the vector map's data for the starting area (the view plus a
  // margin) is downloaded at every detail level, from the starting zoom down to the most detailed
  // tiles. Closer zooms are drawn from those most detailed tiles, so after this, zooming in anywhere
  // in that area never waits on the network. Already saved tiles are skipped (next openings: instant).
  var PRELOAD_MAX = 800;
  var preload = { state: '', done: 0, total: 0, saved: 0, failed: 0 };
  function tileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function tileY(lat, z) {
    var r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  }
  function vectorSource(style) {
    var src = null;
    Object.keys((style && style.sources) || {}).forEach(function (n) {
      var s = style.sources[n];
      if (!src && s.type === 'vector' && s.tiles && s.tiles.length) src = s;
    });
    return src;
  }
  function sourceZoom(src, zoom) {
    return Math.min(src.maxzoom ?? 14, Math.max(src.minzoom || 0, Math.floor(zoom) - 1));
  }
  function preloadMap(style) {
    if (!style || preload.state) return Promise.resolve();
    var src = vectorSource(style);
    if (!src) return Promise.resolve();
    var b = map.getBounds(), urls = [];
    var zFrom = sourceZoom(src, map.getZoom()), zTo = src.maxzoom ?? 14;   // style zoom = Leaflet − 1
    var tpl = 'https://' + src.tiles[0].replace(/^ofm:\/\//, '');
    for (var z = zFrom; z <= zTo; z++) {
      var n = Math.pow(2, z) - 1;
      // Guarantee at least 2 tiles around the viewport in every direction
      var x0 = Math.max(0, tileX(b.getWest(), z) - 2), x1 = Math.min(n, tileX(b.getEast(), z) + 2);
      var y0 = Math.max(0, tileY(b.getNorth(), z) - 2), y1 = Math.min(n, tileY(b.getSouth(), z) + 2);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) urls.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
    urls = urls.slice(0, PRELOAD_MAX);   // coarse levels first: they matter most if the list is ever cut
    preload = { state: 'loading', done: 0, total: urls.length, saved: 0, failed: 0, zoom: (zFrom + 1) + '–' + (zTo + 1), t0: performance.now() };
    renderDiag();
    return runLimited(urls.map(function (u) {
      return function () {
        return getTile(u).then(function (r) { if (r.saved) preload.saved++; }, function () { preload.failed++; })
          .then(function () { preload.done++; if (preload.done % 20 === 0) renderDiag(); });
      };
    }), 4).then(function () {
      preload.state = 'done';
      preload.ms = Math.round(performance.now() - preload.t0);
      renderDiag();
    });
  }

