  var prefetchTimer = 0, pendingTiles = [], activePrefetch = 0;
  var activeTileUrls = new Set();
  var previousView = null, previousCoverage = '';

  function drainViewportQueue() {
    while (activePrefetch < 2 && pendingTiles.length) {
      var url = pendingTiles.shift();
      if (!activeTileUrls.has(url)) start(url);
    }
    function start(url) {
      activeTileUrls.add(url);
      activePrefetch++;
      getTile(url).then(onFinished, onFinished);
      function onFinished() {
        activeTileUrls.delete(url);
        activePrefetch--;
        drainViewportQueue();
      }
    }
  }

  function prefetchViewportTiles() {
    prefetchTimer = 0;
    if (!builtStyle || !/^vector/.test(mapMode)) return;
    var src = vectorSource(builtStyle);
    if (!src) return;
    var bounds = viewLBounds(0), center = bounds.getCenter();
    var zFrom = sourceZoom(src, viewZoom()), zTo = Math.min(src.maxzoom ?? 14, zFrom + 1);
    var dx = 0, dy = 0;
    if (previousView && previousView.mode === view3d.on) {
      var east = center.lng - previousView.center.lng, south = previousView.center.lat - center.lat;
      if (Math.abs(east) + Math.abs(south) > 0.00001) {
        dx = Math.sign(east);
        dy = Math.sign(south);
        if (Math.abs(east) > 3 * Math.abs(south)) dy = 0;
        if (Math.abs(south) > 3 * Math.abs(east)) dx = 0;
      } else {
        dx = previousView.dx; dy = previousView.dy;
      }
    }
    previousView = { center: center, mode: view3d.on, dx: dx, dy: dy };
    var template = src.tiles[0].replace(/^ofm:/, 'https:');
    var levels = [], coverage = [template, view3d.on, dx, dy];
    for (var z = zFrom; z <= zTo; z++) {
      var last = Math.pow(2, z) - 1;
      var west = tileX(bounds.getWest(), z), eastTile = tileX(bounds.getEast(), z);
      var north = tileY(bounds.getNorth(), z), southTile = tileY(bounds.getSouth(), z);
      var cx = tileX(center.lng, z), cy = tileY(center.lat, z);
      coverage.push(z, west, eastTile, north, southTile, cx, cy);
      levels.push({ z: z, last: last, west: west, east: eastTile, north: north, south: southTile, cx: cx, cy: cy });
    }
    var key = coverage.join('/');
    if (key === previousCoverage) return;
    previousCoverage = key;
    var candidates = [];
    levels.forEach(function (level) {
      var z = level.z, last = level.last, cx = level.cx, cy = level.cy;
      var west = level.west, eastTile = level.east, north = level.north, southTile = level.south;
      // Bound the work even on very wide screens. The renderer owns the visible tiles.
      for (var x = Math.max(0, west - 2 + Math.min(0, dx), cx - 12); x <= Math.min(last, eastTile + 2 + Math.max(0, dx), cx + 12); x++) {
        for (var y = Math.max(0, north - 2 + Math.min(0, dy), cy - 12); y <= Math.min(last, southTile + 2 + Math.max(0, dy), cy + 12); y++) {
          var inView = x >= west && x <= eastTile && y >= north && y <= southTile;
          if (inView && z === zFrom) continue;
          var distance = Math.hypot(x - cx - dx * 2, y - cy - dy * 2);
          candidates.push({ z: z, x: x, y: y, rank: distance + 20 * (z - zFrom) });
        }
      }
    });
    candidates.sort(function (a, b) { return a.rank - b.rank; });
    pendingTiles = candidates.slice(0, 96).map(function (tile) {
      return template.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
    }).filter(function (url) { return !activeTileUrls.has(url); });
    drainViewportQueue();
  }

  function scheduleViewportPrefetch() {
    if (!prefetchTimer) prefetchTimer = setTimeout(prefetchViewportTiles, 250);
  }

  map.on('move', function () { if (!view3d.on) scheduleViewportPrefetch(); });
  map.on('moveend', function () {
    render(false);
    if (!view3d.on) scheduleViewportPrefetch();
  });
