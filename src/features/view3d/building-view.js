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

  // A GPU vertex buffer that keeps each building where it was first written. A sync appends the
  // new buildings and blanks the ones that left, so a pan uploads only what changed. The buffer
  // is rewritten whole when it is full or more than half blank.
  function buildingBuffer(stride) {
    var slots = new Map(), used = 0, capacity = 0, holes = 0, stale = false, blank = new Float32Array(0);
    return {
      count: function () { return used / stride; },
      // The meshes behind the keys have changed: the next sync writes everything again.
      reset: function () { stale = true; },
      // `keys` is the set of buildings to draw and `meshOf` returns a key's vertices. The buffer
      // must be bound to ARRAY_BUFFER. Returns the bytes uploaded.
      sync: function (gl, keys, meshOf) {
        if (stale) { slots.clear(); used = 0; holes = 0; stale = false; }
        var added = [], addedSize = 0, live = 0, gone = [], bytes = 0;
        keys.forEach(function (key) {
          var size = meshOf(key).length;
          live += size;
          if (!slots.has(key)) { added.push(key); addedSize += size; }
        });
        slots.forEach(function (slot, key) { if (!keys.has(key)) { gone.push(key); holes += slot.size; } });
        function write(list, size, at) {
          var data = new Float32Array(size), offset = 0;
          list.forEach(function (key) {
            var mesh = meshOf(key);
            data.set(mesh, offset); slots.set(key, { at: at + offset, size: mesh.length }); offset += mesh.length;
          });
          gl.bufferSubData(gl.ARRAY_BUFFER, at * 4, data);
          return data.byteLength;
        }
        if (used + addedSize > capacity || holes * 2 > used) {
          // Room for the next buildings to arrive, in whole triangles.
          capacity = Math.ceil(live * 1.5 / (3 * stride)) * 3 * stride;
          gl.bufferData(gl.ARRAY_BUFFER, capacity * 4, gl.DYNAMIC_DRAW);
          slots.clear(); used = live; holes = 0;
          return write(Array.from(keys), live, 0);
        }
        gone.forEach(function (key) {
          var slot = slots.get(key);
          if (blank.length < slot.size) blank = new Float32Array(slot.size);
          gl.bufferSubData(gl.ARRAY_BUFFER, slot.at * 4, blank.subarray(0, slot.size));   // zero-area triangles
          bytes += slot.size * 4; slots.delete(key);
        });
        if (addedSize) { bytes += write(added, addedSize, used); used += addedSize; }
        return bytes;
      }
    };
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
