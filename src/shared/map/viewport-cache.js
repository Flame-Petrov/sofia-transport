  var prefetchTimer = 0;
  function prefetchViewportTiles() {
    if (!builtStyle || !/^vector/.test(mapMode)) return;
    var src = null;
    Object.keys(builtStyle.sources || {}).forEach(function (n) {
      var s = builtStyle.sources[n];
      if (!src && s.type === 'vector' && s.tiles && s.tiles.length) src = s;
    });
    if (!src) return;
    var b = map.getBounds();
    var curZ = Math.floor(map.getZoom()) - 1;   // style zoom = Leaflet − 1
    var zFrom = Math.max(src.minzoom || 0, curZ);
    var zTo = Math.min(src.maxzoom || 14, curZ + 1);
    var tpl = 'https://' + src.tiles[0].replace(/^ofm:\/\//, '');
    var urls = [];
    for (var z = zFrom; z <= zTo; z++) {
      var n = Math.pow(2, z) - 1;
      // At least 2 tiles margin in every direction around the user's current viewport
      var x0 = Math.max(0, tileX(b.getWest(), z) - 2), x1 = Math.min(n, tileX(b.getEast(), z) + 2);
      var y0 = Math.max(0, tileY(b.getNorth(), z) - 2), y1 = Math.min(n, tileY(b.getSouth(), z) + 2);
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          urls.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
        }
      }
    }
    runLimited(urls.map(function (u) {
      return function () { return getTile(u); };
    }), 3);
  }

  map.on('moveend', function () {
    render(false);
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchViewportTiles, 350);
  });

