  // One padded building query per map and layer, shared by the wall and house batches.
  // It repeats when the tiles change, or once the camera has carried the ground further
  // than the padding. Ordinary pans, follow and small turns reuse the previous result.
  // The batches rebuild on the frames after a query, so one frame never carries all the work.
  var buildingViews = new WeakMap();
  var BUILDING_QUERY_PAD = 0.3;        // extra margin on each side, as a share of the longer screen edge
  var BUILDING_QUERY_INTERVAL = 200;   // ms between queries while the camera keeps leaving the margin

  function mercatorX(lng) { return (lng + 180) / 360; }
  function mercatorY(lat) {
    return (180 - 180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360;
  }

  // Cheap stand-in for serializing a footprint: its point count and a rolling hash.
  function footprintKey(rings) {
    var hash = rings.length, points = 0;
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      points += ring.length;
      for (var j = 0; j < ring.length; j++) {
        hash = (hash * 33 + Math.round(ring[j][0] * 1e7) + 3 * Math.round(ring[j][1] * 1e7)) % 4294967291;
      }
    }
    return points + ':' + hash;
  }

  function buildingView(map, layerId) {
    var views = buildingViews.get(map);
    if (!views) buildingViews.set(map, views = new Map());
    if (views.has(layerId)) return views.get(layerId);
    var stale = true, moved = false, queried = -Infinity, anchors = null, zoom = 0;

    function query() {
      var canvas = map.getCanvas(), w = canvas.clientWidth, h = canvas.clientHeight;
      var pad = BUILDING_QUERY_PAD * Math.max(w, h);
      var pitch = map.getPitch() * Math.PI / 180, bearing = map.getBearing() * Math.PI / 180;
      var fov = (map.transform && map.transform.fov || 36.87) * Math.PI / 180;
      var focal = h / 2 / Math.tan(fov / 2);
      // Screen distance from the centre up to the horizon. The padded top edge stays below it.
      var horizon = pitch > 0.01 ? focal / Math.tan(pitch) : Infinity;
      var top = Math.max(0, Math.min(pad, (horizon - h / 2) / 2));
      view.features = map.queryRenderedFeatures([[-pad, -top], [w + pad, h + pad]], { layers: [layerId] });
      view.version++;

      // Ground points under the screen corners and centre. Their later screen positions
      // measure how far the picture has shifted since this query.
      var center = map.getCenter(), cx = mercatorX(center.lng), cy = mercatorY(center.lat);
      var world = 512 * Math.pow(2, map.getZoom());
      var up = Math.min(h / 2, horizon * 0.6);
      zoom = map.getZoom();
      anchors = [[-w / 2, -up, top], [w / 2, -up, top], [-w / 2, h / 2, pad], [w / 2, h / 2, pad], [0, 0, pad]].map(function (a) {
        var back = a[1] * focal / (focal * Math.cos(pitch) + a[1] * Math.sin(pitch));
        var side = a[0] * (focal - back * Math.sin(pitch)) / focal;
        var x = cx + (side * Math.cos(bearing) - back * Math.sin(bearing)) / world;
        var y = cy + (side * Math.sin(bearing) + back * Math.cos(bearing)) / world;
        var ll = [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
        var at = map.project(ll);
        return { ll: ll, x: at.x, y: at.y, limit: 0.7 * a[2] };
      });
    }

    function covered() {
      if (!anchors || Math.abs(map.getZoom() - zoom) > 0.5) return false;
      return anchors.every(function (a) {
        var at = map.project(a.ll);
        return Math.hypot(at.x - a.x, at.y - a.y) <= a.limit;   // false for NaN as well
      });
    }

    var view = {
      features: [], version: 0, queriedAt: -Infinity,
      invalidate: function () { stale = true; },
      cameraMoved: function () { moved = true; },
      // Returns the version of `features`, querying again first when it is due.
      refresh: function (now) {
        if (moved && !stale) stale = !covered();
        moved = false;
        if (!stale) return view.version;
        if (now - queried < BUILDING_QUERY_INTERVAL) { map.triggerRepaint(); return view.version; }
        query();
        stale = false; queried = view.queriedAt = now;
        return view.version;
      }
    };
    views.set(layerId, view);
    return view;
  }
