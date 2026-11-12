  // 3D road and rail tiles: which are wanted, loading and decoding, the memory budget, the
  // upload queue and the frame-time governor. No WebGL here, so the Node tests can run it;
  // road-layer.js owns the buffers and the drawing. The format is described in docs/3d-roads.md.
  var roadStore = (function () {
    var ZOOM = 15, STEPS = 49152, MARGIN = 8192, UNIT = 1 / (Math.pow(2, ZOOM) * STEPS);
    var MAGIC = 0x31445253, HEADER = 44, VERTEX_BYTES = 12;
    var MAX_WANTED = 24, MAX_LOADING = 4, RETRY_MS = 30000;
    var table = typeof sofiaRoadTiles === 'object' && sofiaRoadTiles ? sofiaRoadTiles : {};
    var bounds = typeof sofiaRoadBounds === 'object' && sofiaRoadBounds ? sofiaRoadBounds : [0, 0, -1, -1];
    var tiles = new Map(), ready = [], wanted = [], loading = 0, clock = 0;
    var budget = 24 * 1048576, used = 0, release = null, changed = null;
    var stats = { requests: 0, uploads: 0, uploadBytes: 0, evictions: 0, decodeMs: 0, failures: 0 };
    var lineVersion = 0, lineCache = null, lineCacheVersion = -1;

    // ---- the tile format ----
    // Header, then columns of wrapping differences (x, y, z, distance as uint16, then material
    // and flags as bytes), the index differences and the track centrelines. The result is the
    // interleaved 12-byte vertex the layer hands to WebGL unchanged.
    function decode(buffer, x, y) {
      var view = new DataView(buffer);
      if (buffer.byteLength < HEADER || view.getUint32(0, true) !== MAGIC) throw new Error('Not a road tile');
      if (view.getUint16(4, true) !== 1) throw new Error('Unknown road tile version');
      var wide = !!(view.getUint16(6, true) & 1), n = view.getUint32(8, true), count = view.getUint32(12, true);
      var prefix = [0, 1, 2, 3, 4].map(function (i) { return view.getUint32(16 + 4 * i, true); });
      var lineBytes = view.getUint32(40, true);
      var width = wide ? 4 : 2, at = HEADER + n * 10;
      at += (4 - at % 4) % 4;
      var indexAt = at;
      at += count * width;
      at += (4 - at % 4) % 4;
      if (at + lineBytes > buffer.byteLength || prefix[4] !== count) throw new Error('Truncated road tile');
      var columns = new Uint16Array(buffer, HEADER, n * 4), bytes = new Uint8Array(buffer, HEADER + n * 8, n * 2);
      var out = new ArrayBuffer(n * VERTEX_BYTES), words = new Uint16Array(out), octets = new Uint8Array(out);
      var px = 0, py = 0, pz = 0, pd = 0;
      for (var i = 0, w = 0; i < n; i++, w += 6) {
        words[w] = px = (px + columns[i]) & 65535;
        words[w + 1] = py = (py + columns[n + i]) & 65535;
        words[w + 2] = pz = (pz + columns[2 * n + i]) & 65535;
        words[w + 4] = pd = (pd + columns[3 * n + i]) & 65535;
        octets[w * 2 + 6] = bytes[i];
        octets[w * 2 + 7] = bytes[n + i];
      }
      var packed = wide ? new Uint32Array(buffer, indexAt, count) : new Uint16Array(buffer, indexAt, count);
      var indices = wide ? new Uint32Array(count) : new Uint16Array(count), last = 0;
      for (var j = 0; j < count; j++) indices[j] = last = (last + packed[j]) >>> 0;
      for (var k = 0; k < count; k++) if (indices[k] >= n) throw new Error('Bad road tile index');
      // Centrelines as longitude and latitude. The steps are global, so a point shared by two
      // tiles comes out identical in both and the lines join up.
      var lines = [], raw = new Uint16Array(buffer, at, lineBytes >> 1), signed = new Int16Array(buffer, at, lineBytes >> 1);
      var ox = x * STEPS - MARGIN, oy = y * STEPS - MARGIN;
      for (var r = 1, l = 0; l < (raw.length ? raw[0] : 0); l++) {
        var kind = raw[r], points = raw[r + 1], gx = ox + raw[r + 2], gy = oy + raw[r + 3], line = [];
        r += 4;
        for (var p = 0; p < points; p++) {
          if (p) { gx += signed[r]; gy += signed[r + 1]; r += 2; }
          line.push([gx * UNIT * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * gy * UNIT))) * 180 / Math.PI]);
        }
        lines.push({ kind: kind, points: line });
      }
      return { vertices: out, indices: indices, vertexCount: n, prefix: prefix, wide: wide, lines: lines,
        bytes: out.byteLength + indices.byteLength };
    }

    // ---- loading ----
    function gunzip(bytes) {
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Promise.resolve(bytes.buffer);   // the server already unpacked it
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    function fetchTile(packed) {
      if (packed.indexOf('tiles/') === 0) {
        return fetch(packed).then(function (response) {
          if (!response.ok) throw new Error('Road tile HTTP ' + response.status);
          return response.arrayBuffer();
        }).then(function (data) { return gunzip(new Uint8Array(data)); });
      }
      var text = atob(packed), bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return gunzip(bytes);
    }
    var loader = fetchTile;

    function entryFor(x, y) {
      var key = x + '/' + y, entry = tiles.get(key);
      if (!entry) {
        var packed = table[key];
        var inside = x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
        // Inside the prepared area a tile without an entry has no roads. An empty entry is a
        // tile this build leaves out, and anything outside the area is unknown.
        entry = { key: key, x: x, y: y, state: packed ? 'idle' : packed === undefined && inside ? 'empty' : 'absent',
          data: null, handle: null, bytes: 0, prefix: null, lines: null, used: 0, wantedAt: -1, retryAt: 0,
          // The tile's corner in Mercator units (0 to 1) and the origin of its vertex steps.
          x0: x / Math.pow(2, ZOOM), y0: y / Math.pow(2, ZOOM), ox: (x * STEPS - MARGIN) * UNIT, oy: (y * STEPS - MARGIN) * UNIT };
        tiles.set(key, entry);
      }
      return entry;
    }
    function start(entry) {
      entry.state = 'loading';
      loading++;
      stats.requests++;
      var began = clock;
      Promise.resolve().then(function () { return loader(table[entry.key], entry); }).then(function (buffer) {
        var t = typeof performance === 'object' ? performance.now() : 0;
        var data = decode(buffer, entry.x, entry.y);
        stats.decodeMs += (typeof performance === 'object' ? performance.now() : 0) - t;
        return data;
      }).then(function (data) {
        loading--;
        if (!tiles.has(entry.key) || tiles.get(entry.key) !== entry) return;   // reset meanwhile
        entry.state = 'decoded'; entry.data = data; entry.prefix = data.prefix; entry.lines = data.lines;
        lineVersion++;
        pump();
        if (changed) changed();
      }, function (error) {
        loading--;
        stats.failures++; stats.lastFailure = entry.key + ': ' + (error && error.message || error);
        entry.state = 'failed'; entry.retryAt = began + RETRY_MS;
        pump();
        if (changed) changed();
      });
    }
    function pump() {
      for (var i = 0; i < wanted.length && loading < MAX_LOADING; i++) {
        var entry = wanted[i];
        if (entry.state === 'failed' && clock >= entry.retryAt) entry.state = 'idle';
        if (entry.state === 'idle') start(entry);
      }
    }

    // ---- which tiles ----
    // `box` is the ground the camera sees in tile units [west, north, east, south], `near` the
    // point to load outward from, `lead` how far the camera travels in about a second. One
    // extra ring ahead of the motion is requested so tiles are ready before they are seen.
    function plan(box, near, lead, now) {
      clock = now;
      var pad = 0.2, ax = lead ? lead[0] : 0, ay = lead ? lead[1] : 0;
      var x0 = Math.floor(box[0] - pad + Math.min(ax, 0)), x1 = Math.floor(box[2] + pad + Math.max(ax, 0));
      var y0 = Math.floor(box[1] - pad + Math.min(ay, 0)), y1 = Math.floor(box[3] + pad + Math.max(ay, 0));
      var list = [];
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 400) {
        for (var x = x0; x <= x1; x++) {
          for (var y = y0; y <= y1; y++) {
            var entry = entryFor(x, y);
            if (entry.state === 'empty' || entry.state === 'absent') continue;
            entry.far = Math.hypot(x + 0.5 - near[0], y + 0.5 - near[1]);
            list.push(entry);
          }
        }
      }
      list.sort(function (a, b) { return a.far - b.far; });
      if (list.length > MAX_WANTED) list.length = MAX_WANTED;
      list.forEach(function (entry) { entry.wantedAt = now; });
      wanted = list;
      pump();
      forget();
    }
    // True when every tile under `box` is on the GPU or known to hold no roads.
    function covered(box) {
      var x0 = Math.floor(box[0]), x1 = Math.floor(box[2]), y0 = Math.floor(box[1]), y1 = Math.floor(box[3]);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_WANTED) return false;
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var state = entryFor(x, y).state;
          if (state !== 'ready' && state !== 'empty') return false;
        }
      }
      return true;
    }

    // ---- uploads and memory ----
    // The nearest decoded tile, for the layer to upload: at most one a frame.
    function takeUpload() {
      for (var i = 0; i < wanted.length; i++) if (wanted[i].state === 'decoded') return wanted[i];
      return null;
    }
    function uploaded(entry, handle, now) {
      entry.handle = handle; entry.bytes = entry.data.bytes; entry.data = null;   // never kept twice
      entry.state = 'ready'; entry.used = now;
      ready.push(entry);
      used += entry.bytes;
      stats.uploads++; stats.uploadBytes += entry.bytes;
      trim(now);
    }
    function drop(entry) {
      var at = ready.indexOf(entry);
      if (at >= 0) ready.splice(at, 1);
      if (entry.handle && release) release(entry.handle);
      used -= entry.bytes;
      if (entry.lines && entry.lines.length) lineVersion++;
      tiles.delete(entry.key);
    }
    // Over the budget the tiles drawn longest ago go first; a tile wanted now always stays.
    function trim(now) {
      while (used > budget) {
        var oldest = null;
        for (var i = 0; i < ready.length; i++) {
          var entry = ready[i];
          if (entry.wantedAt === clock || entry.used === now) continue;
          if (!oldest || entry.used < oldest.used) oldest = entry;
        }
        if (!oldest) break;
        drop(oldest);
        stats.evictions++;
      }
    }
    // Decoded tiles that were never uploaded and are no longer wanted give their memory back.
    function forget() {
      tiles.forEach(function (entry) {
        if (entry.wantedAt === clock) return;
        if (entry.state === 'decoded') { if (entry.lines && entry.lines.length) lineVersion++; tiles.delete(entry.key); }
        else if (entry.state !== 'ready' && entry.state !== 'loading' && tiles.size > 2000) tiles.delete(entry.key);
      });
    }
    function reset() {
      ready.slice().forEach(drop);
      tiles.clear(); wanted = []; ready.length = 0; used = 0; lineVersion++;
      governor.reset();
    }

    // ---- track centrelines for snapping trams ----
    function centrelines() {
      if (lineCacheVersion !== lineVersion) {
        var list = [];
        tiles.forEach(function (entry) {
          if (entry.lines) entry.lines.forEach(function (line) { list.push(line); });
        });
        lineCache = { version: lineVersion, lines: list };
        lineCacheVersion = lineVersion;
      }
      return lineCache;
    }

    // ---- the frame-time governor ----
    // While the 95th-percentile frame stays above 20 ms for a second, detail distances shrink
    // one step, then the draw distance. Below 14 ms they step back up.
    var governor = (function () {
      var SLOW = 20, FAST = 14, STEPS_MAX = 5, DETAIL = [1, 0.7, 0.5, 0.35, 0.35, 0.35], DRAW = [1, 1, 1, 1, 0.7, 0.5];
      var samples = new Float32Array(120), scratch = new Float32Array(120), count = 0, last = 0, windowAt = 0, step = 0, on = true;
      return {
        reset: function () { count = 0; last = 0; windowAt = 0; step = 0; },
        // Called once a drawn frame with the time in ms.
        frame: function (now) {
          var dt = now - last;
          last = now;
          if (!on) return;
          if (dt > 0 && dt < 250 && count < samples.length) samples[count++] = dt;
          if (!windowAt) windowAt = now;
          if (now - windowAt < 1000) return;
          if (count >= 20) {
            for (var i = 0; i < count; i++) scratch[i] = samples[i];
            for (var j = count; j < scratch.length; j++) scratch[j] = Infinity;
            scratch.sort();
            var p95 = scratch[Math.min(count - 1, Math.floor(count * 0.95))];
            if (p95 > SLOW && step < STEPS_MAX) step++;
            else if (p95 < FAST && step > 0) step--;
          }
          count = 0; windowAt = now;
        },
        detail: function () { return DETAIL[step]; },
        draw: function () { return DRAW[step]; },
        step: function () { return step; },
        enable: function (value) { on = !!value; if (!on) step = 0; }
      };
    })();

    return {
      ZOOM: ZOOM, UNIT: UNIT, VERTEX_BYTES: VERTEX_BYTES,
      available: function () { return typeof DecompressionStream === 'function' && Object.keys(table).length > 0; },
      decode: decode, plan: plan, covered: covered, takeUpload: takeUpload, uploaded: uploaded, reset: reset,
      ready: ready, centrelines: centrelines, governor: governor, stats: stats,
      failed: function (entry) { entry.state = 'failed'; entry.data = null; entry.retryAt = Infinity; },
      touch: function (entry, now) { entry.used = now; },
      usedBytes: function () { return used; },
      budget: function (bytes) { if (bytes) budget = bytes; return budget; },
      // The layer frees a tile's buffers through `free` and repaints through `wake`.
      bind: function (free, wake) { release = free; changed = wake; },
      boundTo: function (free) { return release === free; },
      // Test aid: replace the download with a function returning a Promise of the unpacked bytes.
      setLoader: function (fn) { loader = fn || fetchTile; },
      setTable: function (tilesTable, tileBounds) { table = tilesTable; bounds = tileBounds; reset(); }
    };
  })();
