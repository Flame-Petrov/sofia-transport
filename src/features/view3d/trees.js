  // Trees in the 3D view: every mapped tree and tree row, and parks and woods filled by tools/tree_data.py.
  // Eight species shapes are built here in metres for a tree one metre tall; each tree is one instance row
  // (position, height, turn and a seed) and every shape is drawn in one instanced call. Deciduous crowns
  // follow Sofia's season: fresh in spring, deep green in summer, yellow, orange and red in autumn, bare
  // branches in winter. The tile format is described in tools/tree_data.py and docs/3d-trees.md.
  var trees = (function () {
    var KINDS = ['broad', 'conifer', 'pine', 'poplar', 'thuja', 'birch', 'willow', 'small'];
    var EVERGREEN = { conifer: 1, pine: 1, thuja: 1 };
    var MIN_ZOOM = 15;   // MapLibre zoom (16 on the flat map)
    var ROW = 6;         // instance floats: x, y, z (metres from the origin), height, turn, seed
    var table = typeof sofiaTreeTiles === 'object' && sofiaTreeTiles ? sofiaTreeTiles : {};
    var shown = true, seasonOverride = null;
    var param = typeof location === 'object' && /[?&]season=(spring|summer|late|autumn|winter)/.exec(location.search || '');
    if (param) seasonOverride = param[1];

    // ---- the tile store ----
    var tiles = new Map(), loading = 0, changed = null, failures = 0;
    function gunzip(bytes) {
      if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Promise.resolve(bytes.buffer);   // the server already unpacked it
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    function fetchTile(packed) {
      if (packed.indexOf('tiles/') === 0) {
        return fetch(packed).then(function (r) {
          if (!r.ok) throw new Error('Tree tile HTTP ' + r.status);
          return r.arrayBuffer();
        }).then(function (data) { return gunzip(new Uint8Array(data)); });
      }
      var text = atob(packed), bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      return gunzip(bytes);
    }
    // A tile's 16 cells, each with its trees as Mercator x and y, kind and height.
    function decode(buffer, tx, ty) {
      var head = new Uint32Array(buffer.slice(0, 64)), n = 0, k;
      for (k = 0; k < 16; k++) n += head[k];
      if (buffer.byteLength !== 64 + n * 5) throw new Error('Bad tree tile');
      var xs = new Uint16Array(buffer.slice(64, 64 + 2 * n)), ys = new Uint16Array(buffer.slice(64 + 2 * n, 64 + 4 * n));
      var bytes = new Uint8Array(buffer, 64 + 4 * n, n), scale = 1 / 16384, cells = [], at = 0;
      for (k = 0; k < 16; k++) {
        var count = head[k], cell = { x: new Float64Array(count), y: new Float64Array(count), kind: new Uint8Array(count), height: new Float32Array(count),
          x0: (tx + (k % 4) / 4) * scale, y0: (ty + Math.floor(k / 4) / 4) * scale, size: scale / 4 };
        for (var i = 0; i < count; i++, at++) {
          cell.x[i] = (tx + xs[at] / 65536) * scale; cell.y[i] = (ty + ys[at] / 65536) * scale;
          cell.kind[i] = bytes[at] >> 4; cell.height[i] = 3 + 1.6 * (bytes[at] & 15);
        }
        cells.push(cell);
      }
      return cells;
    }
    function tile(key) {
      var entry = tiles.get(key);
      if (entry) return entry;
      entry = { cells: null, failed: false };
      tiles.set(key, entry);
      var packed = table[key];
      if (!packed || typeof DecompressionStream !== 'function') { entry.cells = []; return entry; }
      loading++;
      var p = key.split('/');
      fetchTile(packed).then(function (buffer) { entry.cells = decode(buffer, +p[0], +p[1]); })
        .catch(function (e) { entry.failed = true; failures++; console.warn('Tree tile failed:', key, e); setTimeout(function () { tiles.delete(key); }, 30000); })
        .finally(function () { loading--; if (changed) changed(); });
      return entry;
    }

    // The cells near the camera, nearest first, until the budget is spent: Mercator bounds and centre.
    function pick(west, north, east, south, cx, cy, budget) {
      var n = 16384, found = [];
      for (var tx = Math.floor(west * n); tx <= Math.floor(east * n); tx++) for (var ty = Math.floor(north * n); ty <= Math.floor(south * n); ty++) {
        var key = tx + '/' + ty;
        if (!(key in table)) continue;
        var t = tile(key);
        if (!t.cells) continue;
        t.cells.forEach(function (cell, i) {
          if (!cell.x.length || cell.x0 > east || cell.x0 + cell.size < west || cell.y0 > south || cell.y0 + cell.size < north) return;
          var dx = Math.max(0, Math.abs(cx - cell.x0 - cell.size / 2) - cell.size / 2), dy = Math.max(0, Math.abs(cy - cell.y0 - cell.size / 2) - cell.size / 2);
          found.push({ key: key + '#' + i, cell: cell, d: Math.hypot(dx, dy) });
        });
      }
      found.sort(function (a, b) { return a.d - b.d; });
      var out = [], used = 0;
      for (var i = 0; i < found.length && used < budget; i++) { out.push(found[i]); used += found[i].cell.x.length; }
      return out;
    }

    // ---- the season ----
    // Sofia's day of the year picks the crown colours; deciduous kinds lose their leaves from December to March.
    function season(now) {
      if (seasonOverride) return seasonOverride;
      var parts = {};
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', month: 'numeric', day: 'numeric' }).formatToParts(now || new Date())
          .forEach(function (p) { parts[p.type] = +p.value; });
      } catch (e) { var d = now || new Date(); parts = { month: d.getMonth() + 1, day: d.getDate() }; }
      var md = parts.month * 100 + parts.day;
      if (md >= 1201 || md < 321) return 'winter';
      if (md < 501) return 'spring';
      if (md < 901) return 'summer';
      if (md < 1001) return 'late';
      return 'autumn';
    }
    // Three crown colours a kind mixes by seed, per season. Evergreens keep theirs all year.
    var LEAVES = {
      spring: [[0.42, 0.62, 0.24], [0.52, 0.70, 0.30], [0.36, 0.56, 0.20]],
      summer: [[0.22, 0.40, 0.15], [0.30, 0.49, 0.19], [0.19, 0.34, 0.14]],
      late: [[0.28, 0.44, 0.16], [0.44, 0.50, 0.19], [0.24, 0.39, 0.15]],
      autumn: [[0.78, 0.62, 0.19], [0.74, 0.42, 0.14], [0.40, 0.45, 0.18]],
      winter: [[0.36, 0.30, 0.24], [0.36, 0.30, 0.24], [0.36, 0.30, 0.24]]
    };
    var FIXED = { conifer: [[0.12, 0.27, 0.17], [0.14, 0.30, 0.19], [0.10, 0.24, 0.15]],
      pine: [[0.17, 0.31, 0.16], [0.20, 0.34, 0.18], [0.15, 0.28, 0.15]],
      thuja: [[0.19, 0.35, 0.17], [0.23, 0.40, 0.19], [0.17, 0.31, 0.15]] };
    function palette(kind, now) {
      if (FIXED[kind]) return FIXED[kind];
      var s = season(now);
      if (kind === 'small' && s === 'spring') return [[0.96, 0.82, 0.88], [0.97, 0.94, 0.92], [0.52, 0.70, 0.30]];   // blossom
      if (kind === 'small' && s === 'autumn') return [[0.66, 0.19, 0.12], [0.84, 0.48, 0.13], [0.75, 0.30, 0.12]];
      if (kind === 'birch' && s === 'autumn') return [[0.88, 0.72, 0.20], [0.84, 0.64, 0.17], [0.60, 0.56, 0.18]];
      if (kind === 'poplar' && s === 'autumn') return [[0.84, 0.70, 0.20], [0.70, 0.62, 0.18], [0.46, 0.48, 0.17]];
      return LEAVES[s];
    }
    function bare(kind, now) { return !EVERGREEN[kind] && season(now) === 'winter'; }

    // ---- the shapes ----
    // A vertex is position, normal and part: 0 bark, 1 foliage, 2 white bark (birch).
    function shapes() {
      function builder() {
        var v = [];
        function vert(p, n, part) { v.push(p[0], p[1], p[2], n[0], n[1], n[2], part); }
        var b = {
          // A tapering shaft from z0 to z1 with `sides` faces, leaning toward (lx, ly) at the top.
          trunk: function (r0, r1, z0, z1, sides, part, lx, ly) {
            lx = lx || 0; ly = ly || 0;
            for (var i = 0; i < sides; i++) {
              var a0 = 2 * Math.PI * i / sides, a1 = 2 * Math.PI * (i + 1) / sides;
              var n0 = [Math.cos(a0), Math.sin(a0), 0.15], n1 = [Math.cos(a1), Math.sin(a1), 0.15];
              var p00 = [r0 * n0[0], r0 * n0[1], z0], p10 = [r0 * n1[0], r0 * n1[1], z0];
              var p01 = [lx + r1 * n0[0], ly + r1 * n0[1], z1], p11 = [lx + r1 * n1[0], ly + r1 * n1[1], z1];
              vert(p00, n0, part); vert(p10, n1, part); vert(p11, n1, part);
              vert(p00, n0, part); vert(p11, n1, part); vert(p01, n0, part);
            }
          },
          // A branch from a to c as a thin four-sided shaft.
          branch: function (a, c, r0, r1) {
            var d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]);
            d = d.map(function (x) { return x / l; });
            var e = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            var s = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]], sl = Math.hypot(s[0], s[1], s[2]);
            s = s.map(function (x) { return x / sl; });
            var t = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
            for (var i = 0; i < 4; i++) {
              var a0 = Math.PI / 2 * i, a1 = Math.PI / 2 * (i + 1);
              var n0 = [0, 1, 2].map(function (k) { return Math.cos(a0) * s[k] + Math.sin(a0) * t[k]; });
              var n1 = [0, 1, 2].map(function (k) { return Math.cos(a1) * s[k] + Math.sin(a1) * t[k]; });
              var p = function (o, n, r) { return [o[0] + n[0] * r, o[1] + n[1] * r, o[2] + n[2] * r]; };
              vert(p(a, n0, r0), n0, 0); vert(p(a, n1, r0), n1, 0); vert(p(c, n1, r1), n1, 0);
              vert(p(a, n0, r0), n0, 0); vert(p(c, n1, r1), n1, 0); vert(p(c, n0, r1), n0, 0);
            }
          },
          // An ellipsoid of foliage with smooth normals; `droop` pulls the lower half wider.
          blob: function (cx, cy, cz, rx, ry, rz, sides, rings, droop) {
            droop = droop || 0;
            function at(i, j) {
              var a = 2 * Math.PI * i / sides + (j % 2) * Math.PI / sides, t = Math.PI * j / rings;
              var w = Math.sin(t) * (1 + droop * Math.max(0, Math.cos(t + 0.0) * -1)), z = Math.cos(t);
              var p = [cx + rx * w * Math.cos(a), cy + ry * w * Math.sin(a), cz + rz * z];
              var n = [w * Math.cos(a) / rx, w * Math.sin(a) / ry, z / rz], l = Math.hypot(n[0], n[1], n[2]) || 1;
              return { p: p, n: [n[0] / l, n[1] / l, n[2] / l] };
            }
            for (var j = 0; j < rings; j++) for (var i = 0; i < sides; i++) {
              var a = at(i, j), b2 = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
              if (j > 0) { vert(a.p, a.n, 1); vert(b2.p, b2.n, 1); vert(c.p, c.n, 1); }
              if (j < rings - 1) { vert(a.p, a.n, 1); vert(c.p, c.n, 1); vert(d.p, d.n, 1); }
              else { vert(a.p, a.n, 1); vert(b2.p, b2.n, 1); vert(d.p, d.n, 1); }
            }
          },
          // A cone of foliage (a spruce tier): its side and its underside.
          cone: function (r, z0, z1, sides) {
            for (var i = 0; i < sides; i++) {
              var a0 = 2 * Math.PI * i / sides, a1 = 2 * Math.PI * (i + 1) / sides, slope = r / (z1 - z0);
              var n0 = [Math.cos(a0), Math.sin(a0), slope], n1 = [Math.cos(a1), Math.sin(a1), slope];
              var l = Math.hypot(1, slope); n0 = n0.map(function (x) { return x / l; }); n1 = n1.map(function (x) { return x / l; });
              var am = (a0 + a1) / 2, nm = [Math.cos(am) / l, Math.sin(am) / l, slope / l];
              vert([r * Math.cos(a0), r * Math.sin(a0), z0], n0, 1); vert([r * Math.cos(a1), r * Math.sin(a1), z0], n1, 1); vert([0, 0, z1], nm, 1);
              vert([r * Math.cos(a1), r * Math.sin(a1), z0], [0, 0, -1], 1); vert([r * Math.cos(a0), r * Math.sin(a0), z0], [0, 0, -1], 1); vert([0, 0, z0 + 0.02], [0, 0, -1], 1);
            }
          },
          // An open hanging curtain (a willow's drooping shoots) from radius r0 at z0 to r1 at z1.
          curtain: function (r0, r1, z0, z1, sides) {
            for (var i = 0; i < sides; i++) {
              var a0 = 2 * Math.PI * i / sides, a1 = 2 * Math.PI * (i + 1) / sides;
              var n0 = [Math.cos(a0), Math.sin(a0), 0.2], n1 = [Math.cos(a1), Math.sin(a1), 0.2];
              var p = function (a, r, z) { return [r * Math.cos(a), r * Math.sin(a), z]; };
              vert(p(a0, r0, z0), n0, 1); vert(p(a1, r0, z0), n1, 1); vert(p(a1, r1, z1), n1, 1);
              vert(p(a0, r0, z0), n0, 1); vert(p(a1, r1, z1), n1, 1); vert(p(a0, r1, z1), n0, 1);
            }
          },
          done: function () { return new Float32Array(v); }
        };
        return b;
      }
      function make(fn) { var b = builder(); fn(b); return b.done(); }
      // Bare winter branches: a trunk and two tiers of limbs out to the crown's width.
      function branches(b, z0, z1, width, limbs, part) {
        b.trunk(0.03, 0.012, 0, z1 * 0.92, 5, part || 0);
        for (var i = 0; i < limbs; i++) {
          var a = 2 * Math.PI * (i + 0.37 * (i % 2)) / limbs, z = z0 + (z1 - z0) * (0.1 + 0.35 * (i % 3) / 2);
          var tip = [Math.cos(a) * width, Math.sin(a) * width, Math.min(z1, z + (z1 - z0) * 0.55)];
          b.branch([0, 0, z], tip, 0.014, 0.004);
          b.branch([tip[0] * 0.55, tip[1] * 0.55, z + (tip[2] - z) * 0.55], [tip[0] * 0.75 + Math.cos(a + 0.9) * width * 0.3, tip[1] * 0.75 + Math.sin(a + 0.9) * width * 0.3, z1 * 0.97], 0.007, 0.003);
        }
      }
      var leafy = {
        broad: make(function (b) { b.trunk(0.035, 0.022, 0, 0.5, 6, 0); b.blob(0, 0, 0.64, 0.34, 0.33, 0.3, 7, 4); b.blob(0.13, 0.09, 0.78, 0.2, 0.2, 0.18, 5, 3); b.blob(-0.15, -0.07, 0.56, 0.22, 0.22, 0.18, 5, 3); }),
        conifer: make(function (b) { b.trunk(0.03, 0.018, 0, 0.25, 5, 0); b.cone(0.29, 0.1, 0.55, 8); b.cone(0.22, 0.36, 0.8, 8); b.cone(0.14, 0.62, 1.0, 7); }),
        pine: make(function (b) { b.trunk(0.032, 0.02, 0, 0.78, 6, 0, 0.05, 0.02); b.blob(0.04, 0.02, 0.8, 0.3, 0.27, 0.13, 7, 3); b.blob(0.15, 0.08, 0.9, 0.17, 0.16, 0.09, 5, 3); b.blob(-0.12, -0.05, 0.74, 0.16, 0.15, 0.08, 5, 3); }),
        poplar: make(function (b) { b.trunk(0.03, 0.02, 0, 0.25, 5, 0); b.blob(0, 0, 0.58, 0.13, 0.13, 0.42, 7, 5); }),
        thuja: make(function (b) { b.blob(0, 0, 0.42, 0.19, 0.19, 0.42, 7, 4); b.cone(0.13, 0.7, 1.0, 7); }),
        birch: make(function (b) { b.trunk(0.025, 0.012, 0, 0.62, 5, 2); b.blob(0, 0, 0.66, 0.22, 0.21, 0.32, 7, 4); b.blob(0.09, -0.05, 0.84, 0.13, 0.13, 0.15, 5, 3); }),
        willow: make(function (b) { b.trunk(0.045, 0.03, 0, 0.42, 6, 0); b.blob(0, 0, 0.66, 0.42, 0.4, 0.28, 8, 4); b.curtain(0.42, 0.46, 0.66, 0.14, 10); }),
        small: make(function (b) { b.trunk(0.04, 0.025, 0, 0.42, 5, 0); b.blob(0, 0, 0.68, 0.36, 0.35, 0.3, 7, 4); b.blob(0.12, 0.1, 0.82, 0.18, 0.18, 0.14, 5, 3); })
      };
      var winter = {
        broad: make(function (b) { branches(b, 0.45, 0.95, 0.33, 6); }),
        poplar: make(function (b) { branches(b, 0.2, 1.0, 0.11, 5); }),
        birch: make(function (b) { branches(b, 0.4, 0.97, 0.2, 5, 2); }),
        willow: make(function (b) { branches(b, 0.4, 0.9, 0.4, 6); }),
        small: make(function (b) { branches(b, 0.4, 0.95, 0.34, 5); })
      };
      return { leafy: leafy, winter: winter };
    }
    var meshes = null;
    function mesh(kind, now) {
      meshes = meshes || shapes();
      return bare(kind, now) ? meshes.winter[kind] : meshes.leafy[kind];
    }

    // ---- instance rows ----
    // The rows for the picked cells, grouped by kind, in metres from `origin` (a MercatorCoordinate with .unit).
    function seed(x, y) { var h = Math.sin(x * 9.1e7 + y * 3.3e7) * 43758.5453; return h - Math.floor(h); }
    function rows(cells, origin, lift) {
      var counts = new Array(KINDS.length).fill(0);
      cells.forEach(function (c) { for (var i = 0; i < c.cell.kind.length; i++) counts[c.cell.kind[i]]++; });
      var offsets = [], total = 0;
      counts.forEach(function (n, k) { offsets[k] = total; total += n; });
      var data = new Float32Array(total * ROW), fill = offsets.slice();
      cells.forEach(function (c) {
        var cell = c.cell;
        for (var i = 0; i < cell.kind.length; i++) {
          var o = fill[cell.kind[i]]++ * ROW, s = seed(cell.x[i], cell.y[i]);
          data[o] = (cell.x[i] - origin.x) / origin.unit; data[o + 1] = (cell.y[i] - origin.y) / origin.unit;
          data[o + 2] = lift ? lift(cell.x[i], cell.y[i]) : 0;
          data[o + 3] = cell.height[i] * (0.92 + 0.16 * s); data[o + 4] = s * 2 * Math.PI; data[o + 5] = s;
        }
      });
      return { data: data, groups: counts.map(function (n, k) { return { kind: KINDS[k], first: offsets[k], count: n }; }) };
    }

    // ---- the layer ----
    function layer(options) {
      var map, program, meshBuffers = {}, rowBuffer, loc = {}, instanced, origin = null, groups = [], key = '', lastBuild = 0, built = '', dirty = true;
      var budget = (options && options.budget) || 12000;
      function poke() { dirty = true; if (map) map.triggerRepaint(); }
      return {
        id: (options && options.id) || 'v3-trees', type: 'custom', renderingMode: '3d',
        onAdd: function (owner, gl) {
          map = owner; changed = poke;
          var ext = gl.drawArraysInstanced ? null : gl.getExtension('ANGLE_instanced_arrays');
          if (!gl.drawArraysInstanced && !ext) throw Error('Instanced drawing is unavailable');
          instanced = ext ? { divisor: function (a, n) { ext.vertexAttribDivisorANGLE(a, n); }, draw: function (count, n) { ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, count, n); } }
            : { divisor: function (a, n) { gl.vertexAttribDivisor(a, n); }, draw: function (count, n) { gl.drawArraysInstanced(gl.TRIANGLES, 0, count, n); } };
          program = gl.createProgram();
          function shader(type, code) {
            var s = gl.createShader(type);
            gl.shaderSource(s, code); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
            gl.attachShader(program, s); gl.deleteShader(s);
          }
          shader(gl.VERTEX_SHADER, [
            'attribute vec3 pos, nrm; attribute float part; attribute vec4 place; attribute vec2 turnSeed;',
            'uniform vec4 anchor; uniform mat4 offsets; uniform vec3 sunDir, sunColor, ambient, leafA, leafB, leafC; uniform float shadow; uniform vec2 reach;',
            'varying vec3 tint; varying float onGround;',
            'void main(){',
            '  float s = turnSeed.y, c = cos(turnSeed.x), n = sin(turnSeed.x), wide = 0.86 + 0.28 * fract(s * 7.13);',
            '  vec3 p = vec3(pos.xy * wide, pos.z) * place.w;',
            '  vec3 world = vec3(place.x + p.x * c - p.y * n, place.y + p.x * n + p.y * c, place.z + p.z);',
            '  onGround = shadow; if (shadow > 0.5) { world.xy -= reach * (world.z - place.z); world.z = place.z; }',
            '  gl_Position = anchor + offsets * vec4(world, 0.0);',
            '  vec3 facing = vec3(nrm.x * c - nrm.y * n, nrm.x * n + nrm.y * c, nrm.z);',
            '  float pick = fract(s * 3.71), d = dot(facing, sunDir);',
            '  vec3 leaf = pick < 0.45 ? leafA : pick < 0.8 ? leafB : leafC;',
            '  vec3 bark = part > 1.5 ? vec3(0.86, 0.85, 0.80) : vec3(0.32, 0.25, 0.19);',
            '  float foliage = step(0.5, part) * step(part, 1.5);',
            // Foliage wraps the light round the crown and darkens toward its underside; bark takes plain light.
            '  float lightAmount = foliage > 0.5 ? clamp(d * 0.55 + 0.45, 0.0, 1.0) : max(d, 0.0);',
            '  float inner = foliage > 0.5 ? 0.72 + 0.36 * clamp(nrm.z * 0.5 + 0.5, 0.0, 1.0) : 1.0;',
            '  tint = mix(bark, leaf * (0.92 + 0.16 * fract(s * 13.7)), foliage) * (ambient + sunColor * lightAmount) * inner; }'
          ].join('\n'));
          shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform float strength; varying vec3 tint; varying float onGround; void main(){ gl_FragColor = onGround > 0.5 ? vec4(0.0, 0.0, 0.0, strength) : vec4(tint, 1.0); }');
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
          ['anchor', 'offsets', 'sunDir', 'sunColor', 'ambient', 'leafA', 'leafB', 'leafC', 'shadow', 'reach', 'strength'].forEach(function (k) { loc[k] = gl.getUniformLocation(program, k); });
          ['pos', 'nrm', 'part', 'place', 'turnSeed'].forEach(function (k) { loc[k] = gl.getAttribLocation(program, k); });
          rowBuffer = gl.createBuffer();
          map.on('terrain', poke);
        },
        render: function (gl, matrix) {
          if (!shown || map.getZoom() < MIN_ZOOM) return;
          var now = performance.now(), center = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
          if (!origin || Math.hypot(center.x - origin.x, center.y - origin.y) > 0.0004) {
            origin = center; origin.unit = origin.meterInMercatorCoordinateUnits(); built = ''; dirty = true;
          }
          var b = map.getBounds(), nw = maplibregl.MercatorCoordinate.fromLngLat(b.getNorthWest()), se = maplibregl.MercatorCoordinate.fromLngLat(b.getSouthEast());
          var picked = pick(nw.x, nw.y, se.x, se.y, center.x, center.y, budget);
          key = picked.map(function (c) { return c.key; }).join(',') + '|' + season() + '|' + !!map.getTerrain();
          if (key !== built && (now - lastBuild > 200 || dirty)) {
            var terrain = map.getTerrain();
            var lift = terrain ? function (x, y) { return map.queryTerrainElevation(new maplibregl.MercatorCoordinate(x, y).toLngLat()) || 0; } : null;
            var made = rows(picked, origin, lift);
            groups = made.groups;
            gl.bindBuffer(gl.ARRAY_BUFFER, rowBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, made.data, gl.DYNAMIC_DRAW);
            built = key; lastBuild = now; dirty = false;
          } else if (key !== built) map.triggerRepaint();
          if (!groups.some(function (g) { return g.count; })) return;
          gl.useProgram(program); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
          var anchor = [0, 1, 2, 3].map(function (i) { return matrix[i] * origin.x + matrix[i + 4] * origin.y + matrix[i + 12]; });
          gl.uniform4fv(loc.anchor, anchor);
          gl.uniformMatrix4fv(loc.offsets, false, Float32Array.from(matrix, function (v) { return v * origin.unit; }));
          var light = daylight.lighting(), cast = shadows.strength(map);
          gl.uniform3fv(loc.sunDir, light.dir); gl.uniform3fv(loc.sunColor, light.color); gl.uniform3fv(loc.ambient, light.ambient);
          gl.uniform2fv(loc.reach, shadows.reach()); gl.uniform1f(loc.strength, cast);
          [loc.pos, loc.nrm, loc.part, loc.place, loc.turnSeed].forEach(function (a) { gl.enableVertexAttribArray(a); });
          instanced.divisor(loc.place, 1); instanced.divisor(loc.turnSeed, 1);
          var date = new Date();
          groups.forEach(function (g) {
            if (!g.count) return;
            var shape = mesh(g.kind, date), buffer = meshBuffers[g.kind + (bare(g.kind, date) ? '-bare' : '')];
            if (!buffer) {
              buffer = meshBuffers[g.kind + (bare(g.kind, date) ? '-bare' : '')] = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, shape, gl.STATIC_DRAW);
            }
            var colors = palette(g.kind, date);
            gl.uniform3fv(loc.leafA, colors[0]); gl.uniform3fv(loc.leafB, colors[1]); gl.uniform3fv(loc.leafC, colors[2]);
            gl.bindBuffer(gl.ARRAY_BUFFER, rowBuffer);
            gl.vertexAttribPointer(loc.place, 4, gl.FLOAT, false, ROW * 4, g.first * ROW * 4);
            gl.vertexAttribPointer(loc.turnSeed, 2, gl.FLOAT, false, ROW * 4, g.first * ROW * 4 + 16);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(loc.nrm, 3, gl.FLOAT, false, 28, 12);
            gl.vertexAttribPointer(loc.part, 1, gl.FLOAT, false, 28, 24);
            var count = shape.length / 7;
            if (cast) {
              gl.uniform1f(loc.shadow, 1);
              shadows.begin(gl); instanced.draw(count, g.count); shadows.end(gl);
            }
            gl.uniform1f(loc.shadow, 0);
            instanced.draw(count, g.count);
          });
          // Other layers share these attribute slots, so none may stay per-instance.
          instanced.divisor(loc.place, 0); instanced.divisor(loc.turnSeed, 0);
          [loc.pos, loc.nrm, loc.part, loc.place, loc.turnSeed].forEach(function (a) { gl.disableVertexAttribArray(a); });
        },
        onRemove: function (owner, gl) {
          owner.off('terrain', poke);
          if (changed === poke) changed = null;
          Object.keys(meshBuffers).forEach(function (k) { gl.deleteBuffer(meshBuffers[k]); });
          gl.deleteBuffer(rowBuffer); gl.deleteProgram(program);
        }
      };
    }

    return {
      kinds: KINDS, minZoom: MIN_ZOOM, layer: layer, decode: decode, pick: pick, rows: rows, mesh: mesh, season: season, palette: palette,
      setShown: function (value) { shown = !!value; }, shown: function () { return shown; },
      stats: function () { return { tiles: tiles.size, loading: loading, failures: failures }; }
    };
  })();
