  // Hand-built models of Sofia's landmark buildings and monuments, and footprint-based models of its
  // malls. Each site in landmark-data.js has a centre, the bearing of its long axis and its mapped
  // outline in that frame: u runs along the axis, v to its left, z up, all in metres. A model is a
  // list of flat-shaded triangles in the house layer's vertex format (position, colour, normal and
  // a window-light draw), so it takes the same daylight, lit windows and ground shadows. The bundled
  // building features under a model are filtered out of the extrusion layer.
  var landmarks = (function () {
    var GLASS = [0.20, 0.30, 0.36], GOLD = [0.86, 0.68, 0.22], COPPER = [0.42, 0.60, 0.52], LEAD = [0.46, 0.49, 0.52];
    var STONE = [0.90, 0.87, 0.78], GRANITE = [0.62, 0.62, 0.60], DARK = [0.27, 0.26, 0.26], BRONZE = [0.33, 0.36, 0.28];
    // Which models are drawn: the landmark buildings and monuments, and the malls (which follow the Buildings switch).
    var shown = { landmarks: true, malls: true };
    function drawn(site) { return site.k === 'mall' ? shown.malls : shown.landmarks; }
    function setShown(landmarksOn, mallsOn) { shown.landmarks = !!landmarksOn; shown.malls = !!mallsOn; }
    landmarkSites.forEach(function (site) {
      site.reach = 0;
      for (var i = 0; i < site.p.length; i += 2) site.reach = Math.max(site.reach, Math.hypot(site.p[i], site.p[i + 1]));
    });

    // The extrusion layer's filter with the replaced buildings taken out, in the filter's own syntax.
    // Legacy filters name a property as a plain string after ==, in, has and the like; anything else is an expression.
    function isExpression(f) {
      if (!Array.isArray(f)) return false;
      var op = f[0], nested = f.slice(1).some(Array.isArray);
      if (op === 'all' || op === 'any') return f.slice(1).some(isExpression);
      if (op === 'none' || op === '!in' || op === '!has') return false;
      if (op === 'has') return nested;
      if (op === 'in') return typeof f[1] !== 'string' || (f.length === 3 && Array.isArray(f[2]));
      if (['==', '!=', '<', '>', '<=', '>='].indexOf(op) >= 0) return nested;
      return true;
    }
    // Only the buildings under a drawn model are taken out, so a model that is switched off leaves its plain building.
    function filter(existing) {
      var hidden = [];
      landmarkSites.forEach(function (site) { if (drawn(site)) site.ids.forEach(function (id) { hidden.push(id); }); });
      if (!hidden.length) return existing;
      var expression = isExpression(existing);
      var mine = expression ? ['!', ['in', ['id'], ['literal', hidden]]] : ['!in', '$id'].concat(hidden);
      return existing ? ['all', existing, mine] : mine;
    }

    function outline(site) {
      var ring = [], area = 0;
      for (var i = 0; i < site.p.length; i += 2) ring.push([site.p[i], site.p[i + 1]]);
      ring.forEach(function (p, i) { var q = ring[(i + 1) % ring.length]; area += p[0] * q[1] - q[0] * p[1]; });
      return area < 0 ? ring.reverse() : ring;   // counter-clockwise: the outside is to the right of each edge
    }
    function inside(ring, u, v) {
      var hit = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var a = ring[i], b = ring[j];
        if ((a[1] > v) !== (b[1] > v) && u < (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
      }
      return hit;
    }
    function scaled(ring, k) { return ring.map(function (p) { return [p[0] * k, p[1] * k]; }); }
    function triangulate(ring) {
      var left = ring.map(function (_, i) { return i; }), out = [], guard = ring.length * ring.length;
      function turn(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
      while (left.length > 3 && guard-- > 0) {
        var cut = false;
        for (var i = 0; i < left.length && !cut; i++) {
          var a = ring[left[(i + left.length - 1) % left.length]], b = ring[left[i]], c = ring[left[(i + 1) % left.length]];
          if (turn(a, b, c) <= 0) continue;
          var clear = left.every(function (k) {
            var p = ring[k];
            return p === a || p === b || p === c || turn(a, b, p) < 0 || turn(b, c, p) < 0 || turn(c, a, p) < 0;
          });
          if (clear) { out.push([a, b, c]); left.splice(i, 1); cut = true; }
        }
        if (!cut) left.splice(0, 1);   // a degenerate outline: drop a corner and go on
      }
      if (left.length === 3) out.push([ring[left[0]], ring[left[1]], ring[left[2]]]);
      return out;
    }

    // The drawing kit. Every shape appends triangles to `out` in the site's own frame.
    function kit(out) {
      var k = {};
      function push(a, b, c, color, n, emit) {
        [a, b, c].forEach(function (p) { out.push(p[0], p[1], p[2], color[0], color[1], color[2], n[0], n[1], n[2], emit); });
      }
      function draw(a) { var h = Math.sin(a[0] * 12.9898 + a[1] * 78.233 + a[2] * 37.719) * 43758.5453; return 0.02 + 0.96 * (h - Math.floor(h)); }
      // A triangle whose normal points away from `from`.
      k.tri = function (a, b, c, color, from, emit) {
        var p = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], q = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        var n = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], m = Math.hypot(n[0], n[1], n[2]);
        if (m < 1e-9) return;
        var s = ((a[0] + b[0] + c[0]) / 3 - from[0]) * n[0] + ((a[1] + b[1] + c[1]) / 3 - from[1]) * n[1] + ((a[2] + b[2] + c[2]) / 3 - from[2]) * n[2] < 0 ? -1 / m : 1 / m;
        push(a, b, c, color, [n[0] * s, n[1] * s, n[2] * s], emit || 0);
      };
      k.quad = function (a, b, c, d, color, from, glass) {
        var emit = glass ? draw(a) : 0;
        k.tri(a, b, c, color, from, emit); k.tri(a, c, d, color, from, emit);
      };
      k.box = function (u0, u1, v0, v1, z0, z1, color, glass) {
        var c = [(u0 + u1) / 2, (v0 + v1) / 2, (z0 + z1) / 2];
        var low = [[u0, v0, z0], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0]], top = low.map(function (p) { return [p[0], p[1], z1]; });
        for (var i = 0; i < 4; i++) k.quad(low[i], low[(i + 1) % 4], top[(i + 1) % 4], top[i], color, c, glass);
        k.quad(top[0], top[1], top[2], top[3], color, c);
        if (z0 > 0) k.quad(low[0], low[1], low[2], low[3], color, c);
      };
      // A box turned to any direction: `along` is a unit vector, w and d the half sizes along and across it.
      k.turned = function (centre, along, w, d, z0, z1, color, glass) {
        var across = [-along[1], along[0]], c = [centre[0], centre[1], (z0 + z1) / 2];
        var low = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) {
          return [centre[0] + s[0] * w * along[0] + s[1] * d * across[0], centre[1] + s[0] * w * along[1] + s[1] * d * across[1], z0];
        });
        var top = low.map(function (p) { return [p[0], p[1], z1]; });
        for (var i = 0; i < 4; i++) k.quad(low[i], low[(i + 1) % 4], top[(i + 1) % 4], top[i], color, c, glass);
        k.quad(top[0], top[1], top[2], top[3], color, c);
        if (z0 > 0) k.quad(low[0], low[1], low[2], low[3], color, c);
      };
      // Walls along an outline, with an optional roof. Glass walls are cut into panes that light up separately.
      k.prism = function (ring, z0, z1, color, roof, glass) {
        ring.forEach(function (a, i) {
          var b = ring[(i + 1) % ring.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (length < 0.05) return;
          var n = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length, 0], panes = glass ? Math.max(1, Math.round(length / 6)) : 1;
          for (var pane = 0; pane < panes; pane++) {
            var s = pane / panes, e = (pane + 1) / panes;
            var p = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s], q = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
            var emit = glass ? draw([p[0], p[1], z0]) : 0;
            push([p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], color, n, emit);
            push([p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], color, n, emit);
          }
        });
        if (roof) triangulate(ring).forEach(function (t) {
          push([t[0][0], t[0][1], z1], [t[1][0], t[1][1], z1], [t[2][0], t[2][1], z1], roof, [0, 0, 1], 0);
        });
      };
      // Floors of solid spandrel and glazing up an outline.
      k.floors = function (ring, z0, z1, step, solid, glazing, roof) {
        for (var z = z0; z < z1 - 0.01; z += step) {
          var sill = Math.min(z1, z + step * 0.32), head = Math.min(z1, z + step);
          k.prism(ring, z, sill, solid);
          if (head > sill) k.prism(ring, sill, head, glazing, head >= z1 - 0.01 ? roof : null, true);
        }
      };
      // Courses of two stones up an outline, as on Sofia's striped churches.
      k.stripes = function (ring, z0, z1, main, course, roof) {
        for (var z = z0; z < z1 - 0.01; z += 1.5) {
          k.prism(ring, z, Math.min(z1, z + 1.1), main);
          if (z + 1.1 < z1) k.prism(ring, z + 1.1, Math.min(z1, z + 1.5), course);
        }
        if (roof) k.prism(ring, z1, z1 + 0.01, main, roof);
      };
      // A round or tapering shaft with n sides. Options: cap, windows (glass in every second side), turn (radians).
      k.tube = function (cu, cv, r0, r1, z0, z1, n, color, options) {
        options = options || {};
        var from = [cu, cv, (z0 + z1) / 2], turn = options.turn || 0;
        function at(i, r, z) { var a = turn + 2 * Math.PI * i / n; return [cu + r * Math.cos(a), cv + r * Math.sin(a), z]; }
        for (var i = 0; i < n; i++) {
          k.quad(at(i, r0, z0), at(i + 1, r0, z0), at(i + 1, r1, z1), at(i, r1, z1), color, from);
          if (options.windows && i % 2 === 0) {
            var low = z0 + (z1 - z0) * 0.22, high = z0 + (z1 - z0) * 0.82, grow = 1.012;
            k.quad(at(i + 0.25, r0 * grow, low), at(i + 0.75, r0 * grow, low), at(i + 0.75, r1 * grow, high), at(i + 0.25, r1 * grow, high), GLASS, from, true);
          }
        }
        if (options.cap && r1 > 0) for (i = 1; i < n - 1; i++) k.tri(at(0, r1, z1), at(i, r1, z1), at(i + 1, r1, z1), color, [cu, cv, z1 - 1]);
      };
      var ROUND = [[1, 0], [0.95, 0.31], [0.81, 0.59], [0.59, 0.81], [0.31, 0.95], [0, 1]];
      var ONION = [[0.8, 0], [1.18, 0.2], [1.2, 0.38], [0.86, 0.6], [0.36, 0.8], [0.1, 0.92], [0, 1]];
      k.dome = function (cu, cv, r, z0, height, n, color, onion) {
        var rings = onion ? ONION : ROUND;
        for (var i = 1; i < rings.length; i++) {
          k.tube(cu, cv, r * rings[i - 1][0], r * rings[i][0], z0 + height * rings[i - 1][1], z0 + height * rings[i][1], n, color);
        }
      };
      k.cross = function (cu, cv, z, size, color) {
        k.box(cu - size * 0.06, cu + size * 0.06, cv - size * 0.06, cv + size * 0.06, z, z + size, color);
        k.box(cu - size * 0.06, cu + size * 0.06, cv - size * 0.3, cv + size * 0.3, z + size * 0.6, z + size * 0.72, color);
      };
      // A pitched roof over a rectangle, the ridge along u or along v. The gable ends take `wall`.
      k.gable = function (u0, u1, v0, v1, z0, rise, alongU, color, wall) {
        var from = [(u0 + u1) / 2, (v0 + v1) / 2, z0 - 4], a, b;
        if (alongU) { a = [u0, (v0 + v1) / 2, z0 + rise]; b = [u1, (v0 + v1) / 2, z0 + rise]; }
        else { a = [(u0 + u1) / 2, v0, z0 + rise]; b = [(u0 + u1) / 2, v1, z0 + rise]; }
        var c = [[u0, v0, z0], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0]];
        if (alongU) {
          k.quad(c[0], c[1], b, a, color, from); k.quad(c[3], c[2], b, a, color, from);
          k.tri(c[0], c[3], a, wall || color, from); k.tri(c[1], c[2], b, wall || color, from);
        } else {
          k.quad(c[0], c[3], b, a, color, from); k.quad(c[1], c[2], b, a, color, from);
          k.tri(c[0], c[1], a, wall || color, from); k.tri(c[3], c[2], b, wall || color, from);
        }
      };
      k.pyramid = function (u0, u1, v0, v1, z0, rise, color) {
        var top = [(u0 + u1) / 2, (v0 + v1) / 2, z0 + rise], from = [top[0], top[1], z0 - 4];
        var c = [[u0, v0, z0], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0]];
        for (var i = 0; i < 4; i++) k.tri(c[i], c[(i + 1) % 4], top, color, from);
      };
      // A grid of windows on a wall that runs along u (at v, facing `side`) or along v (at u).
      k.windowsU = function (v, u0, u1, z0, z1, columns, rows, side, color) {
        for (var column = 0; column < columns; column++) for (var row = 0; row < rows; row++) {
          var a = u0 + (u1 - u0) * (column + 0.22) / columns, b = u0 + (u1 - u0) * (column + 0.78) / columns;
          var low = z0 + (z1 - z0) * (row + 0.2) / rows, high = z0 + (z1 - z0) * (row + 0.85) / rows;
          k.quad([a, v, low], [b, v, low], [b, v, high], [a, v, high], color || GLASS, [a, v - side, low], !color);
        }
      };
      k.windowsV = function (u, v0, v1, z0, z1, columns, rows, side, color) {
        for (var column = 0; column < columns; column++) for (var row = 0; row < rows; row++) {
          var a = v0 + (v1 - v0) * (column + 0.22) / columns, b = v0 + (v1 - v0) * (column + 0.78) / columns;
          var low = z0 + (z1 - z0) * (row + 0.2) / rows, high = z0 + (z1 - z0) * (row + 0.85) / rows;
          k.quad([u, a, low], [u, b, low], [u, b, high], [u, a, high], color || GLASS, [u - side, a, low], !color);
        }
      };
      // A shaft between two points in any direction, with n sides and optional end caps.
      k.rod = function (a, b, r0, r1, n, color, caps) {
        var d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]);
        if (l < 1e-6) return;
        d = [d[0] / l, d[1] / l, d[2] / l];
        var e = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        var s = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]], sl = Math.hypot(s[0], s[1], s[2]);
        s = [s[0] / sl, s[1] / sl, s[2] / sl];
        var t = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]];
        function at(o, i, r) { var g = 2 * Math.PI * i / n, c = Math.cos(g), q = Math.sin(g); return [o[0] + r * (c * s[0] + q * t[0]), o[1] + r * (c * s[1] + q * t[1]), o[2] + r * (c * s[2] + q * t[2])]; }
        var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        for (var i = 0; i < n; i++) k.quad(at(a, i, r0), at(a, i + 1, r0), at(b, i + 1, r1), at(b, i, r1), color, mid);
        if (caps) for (i = 1; i < n - 1; i++) {
          if (r0 > 0) k.tri(at(a, 0, r0), at(a, i, r0), at(a, i + 1, r0), color, b);
          if (r1 > 0) k.tri(at(b, 0, r1), at(b, i, r1), at(b, i + 1, r1), color, a);
        }
      };
      // A ball (an ellipsoid with radii r, r and rz) of `sides` faces round and `rings` bands.
      k.ball = function (c, r, color, rz, sides, rings) {
        rz = rz || r; sides = sides || 8; rings = rings || 4;
        function at(i, j) { var g = 2 * Math.PI * i / sides, t = Math.PI * j / rings; return [c[0] + r * Math.sin(t) * Math.cos(g), c[1] + r * Math.sin(t) * Math.sin(g), c[2] + rz * Math.cos(t)]; }
        for (var j = 0; j < rings; j++) for (var i = 0; i < sides; i++) {
          if (j > 0) k.tri(at(i, j), at(i + 1, j), at(i + 1, j + 1), color, c);
          if (j < rings - 1) k.tri(at(i, j), at(i + 1, j + 1), at(i, j + 1), color, c);
        }
      };
      // A rough boulder: an irregular prism that narrows to a ridge, from a seed.
      k.rock = function (cu, cv, w, d, h, color, seed) {
        var n = 7, low = [], mid = [], top = [];
        for (var i = 0; i < n; i++) {
          var g = 2 * Math.PI * i / n, j = 0.78 + 0.3 * Math.abs(Math.sin(seed * 12.7 + i * 3.1));
          low.push([cu + w / 2 * j * Math.cos(g), cv + d / 2 * j * Math.sin(g), 0]);
          mid.push([cu + w / 2 * j * 0.92 * Math.cos(g), cv + d / 2 * j * 0.86 * Math.sin(g), h * (0.55 + 0.2 * Math.abs(Math.cos(seed * 5.3 + i)))]);
          top.push([cu + w / 2 * j * 0.45 * Math.cos(g), cv + d / 2 * j * 0.4 * Math.sin(g), h * (0.85 + 0.15 * Math.abs(Math.sin(seed * 2.9 + i * 1.7)))]);
        }
        var c = [cu, cv, h * 0.4];
        for (i = 0; i < n; i++) {
          var q = (i + 1) % n;
          k.quad(low[i], low[q], mid[q], mid[i], color, c); k.quad(mid[i], mid[q], top[q], top[i], color, c);
        }
        for (i = 1; i < n - 1; i++) k.tri(top[0], top[i], top[i + 1], color, c);
      };
      // Build with `fn(sub)` in a frame of its own (x forward, y left, z up), then turn it by `turn`
      // radians and move it to (cu, cv, z0) in this frame, scaled by `scale`.
      k.placed = function (cu, cv, z0, turn, scale, fn) {
        var local = [];
        fn(kit(local));
        var c = Math.cos(turn), s = Math.sin(turn);
        for (var i = 0; i < local.length; i += 10) {
          var x = local[i] * scale, y = local[i + 1] * scale, nx = local[i + 6], ny = local[i + 7];
          out.push(cu + x * c - y * s, cv + x * s + y * c, z0 + local[i + 2] * scale, local[i + 3], local[i + 4], local[i + 5], nx * c - ny * s, nx * s + ny * c, local[i + 8], local[i + 9]);
        }
      };
      k.GLASS = GLASS;
      return k;
    }

    var builders = {
      // The bell tower stands over the west door (−u); the apse closes the east end.
      nevsky: function (k, ring) {
        var door = [0.25, 0.17, 0.12];
        k.prism(ring, 0, 15, STONE, COPPER);
        k.box(-28, 24, -12, 12, 15, 21, STONE); k.gable(-28, 24, -12, 12, 21, 3, true, COPPER, STONE);
        k.box(-6, 16, -25, 25, 15, 21, STONE); k.gable(-6, 16, -25, 25, 21, 3, false, COPPER, STONE);
        k.windowsU(-25.7, -26, -8, 4, 12, 5, 1, -1); k.windowsU(25.7, -26, -8, 4, 12, 5, 1, 1);
        k.windowsU(-12.15, -27, -7, 16, 20, 5, 1, -1); k.windowsU(12.15, -27, -7, 16, 20, 5, 1, 1);
        k.tube(5, 0, 10, 10, 21, 31, 16, STONE, { windows: true });
        k.dome(5, 0, 10.5, 31, 10, 16, GOLD); k.tube(5, 0, 1.2, 1.2, 41, 43, 8, GOLD, { cap: true }); k.cross(5, 0, 43, 2.6, GOLD);
        [[18, 0], [-8, 0], [5, 13], [5, -13]].forEach(function (c) { k.dome(c[0], c[1], 7, 21, 6, 12, GOLD); });
        [[16, 11], [16, -11], [-6, 11], [-6, -11]].forEach(function (c) {
          k.tube(c[0], c[1], 3.4, 3.4, 15, 23, 8, STONE, { windows: true }); k.dome(c[0], c[1], 3.7, 23, 3.6, 8, COPPER);
        });
        k.box(-36, -27, -8, 8, 15, 37, STONE);
        k.windowsV(-36.15, -6.5, 6.5, 0.4, 8, 3, 1, -1, door);
        k.windowsV(-36.15, -6, 6, 27, 35, 2, 1, -1); k.windowsU(-8.15, -35, -28, 27, 35, 2, 1, -1); k.windowsU(8.15, -35, -28, 27, 35, 2, 1, 1);
        k.tube(-31.5, 0, 5.6, 5.6, 37, 43, 8, STONE, { windows: true });
        k.dome(-31.5, 0, 5.9, 43, 6.5, 12, GOLD); k.cross(-31.5, 0, 49.5, 3, GOLD);
        k.tube(27, 0, 9, 9, 15, 18, 12, STONE); k.dome(27, 0, 9, 18, 5, 12, COPPER);
      },
      // Stepped tiers of bronze glass between white bands; the main entrance looks north (+u) over the park.
      ndk: function (k, ring) {
        var concrete = [0.90, 0.89, 0.85], bronze = [0.26, 0.23, 0.20], roof = [0.55, 0.55, 0.53];
        k.floors(ring, 0, 16, 4, concrete, bronze, roof);
        k.floors(scaled(ring, 0.84), 16, 30, 4.6, concrete, bronze, roof);
        k.floors(scaled(ring, 0.64), 30, 42, 4, concrete, bronze, roof);
        k.prism(scaled(ring, 0.4), 42, 47, bronze, roof, true);
        k.box(71, 78, -24, 24, 5.2, 6.2, concrete);
        [-22, -11, 0, 11, 22].forEach(function (v) { k.tube(77, v, 0.6, 0.6, 0, 5.2, 8, concrete); });
        k.windowsV(71.4, -20, 20, 0.4, 5, 8, 1, 1);
      },
      // The portico with six columns and a pediment faces the City Garden (−u), between two slender towers.
      theatre: function (k, ring) {
        var cream = [0.93, 0.89, 0.78], white = [0.96, 0.95, 0.91], red = [0.62, 0.23, 0.18], roof = [0.44, 0.50, 0.47];
        k.prism(ring, 0, 17, cream, roof);
        k.box(-36, -6, -16.8, 16.8, 17, 20, cream); k.gable(-36, -6, -16.8, 16.8, 20, 4, true, roof, cream);
        k.box(-6, 18, -23.3, 23.3, 17, 29, cream); k.pyramid(-6.6, 18.6, -23.9, 23.9, 29, 4, roof);
        k.windowsU(-16.95, -34, -8, 3, 15, 7, 3, -1); k.windowsU(16.95, -34, -8, 3, 15, 7, 3, 1);
        k.windowsU(-16.95, 20, 44, 3, 15, 6, 3, -1); k.windowsU(16.95, 20, 44, 3, 15, 6, 3, 1);
        k.box(-49.5, -45.6, -9, 9, 0, 1.2, GRANITE);
        k.windowsV(-40.3, -6.6, 6.6, 1.4, 12.8, 1, 1, -1, red);
        k.windowsV(-40.4, -6, 6, 1.5, 7, 3, 1, -1);
        for (var column = 0; column < 6; column++) k.tube(-45, -6.2 + column * 2.48, 0.55, 0.48, 1.2, 13, 10, white);
        k.box(-46.4, -40, -7.6, 7.6, 13, 14.6, white); k.gable(-46.4, -40, -7.6, 7.6, 14.6, 3.6, true, roof, white);
        [-1, 1].forEach(function (s) {
          var v0 = Math.min(s * 7.3, s * 11.2), v1 = Math.max(s * 7.3, s * 11.2), mid = (v0 + v1) / 2;
          k.box(-40.2, -36.3, v0, v1, 17, 27, cream);
          k.windowsV(-40.35, v0, v1, 20, 26, 1, 1, -1);
          k.pyramid(-40.6, -35.9, v0 - 0.4, v1 + 0.4, 27, 3.2, red);
          k.tube(-38.25, mid, 0.5, 0.1, 30.2, 32.6, 6, GOLD);
        });
      },
      // Striped stone, a 31 m central dome, the door and a small belfry at the west end (−u).
      nedelya: function (k, ring) {
        var ochre = [0.84, 0.74, 0.56], brick = [0.66, 0.42, 0.32];
        k.stripes(ring, 0, 13, ochre, brick, LEAD);
        k.windowsU(-12.95, -18, 10, 4, 10.5, 5, 1, -1); k.windowsU(12.95, -18, 10, 4, 10.5, 5, 1, 1);
        k.tube(-2, 0, 7.5, 7.5, 13, 21, 16, ochre, { windows: true });
        k.dome(-2, 0, 7.9, 21, 8, 16, LEAD); k.cross(-2, 0, 29, 2.4, GOLD);
        [[-11, 8.5], [-11, -8.5], [7, 8.5], [7, -8.5]].forEach(function (c) {
          k.tube(c[0], c[1], 2.5, 2.5, 13, 16.5, 8, ochre, { windows: true }); k.dome(c[0], c[1], 2.8, 16.5, 2.8, 8, LEAD);
        });
        k.box(-22.7, -16.5, -4.5, 4.5, 13, 19, ochre); k.dome(-19.6, 0, 3.4, 19, 3.4, 10, LEAD); k.cross(-19.6, 0, 22.4, 1.6, GOLD);
        k.windowsV(-22.85, -3, 3, 0.4, 6, 1, 1, -1, [0.28, 0.19, 0.13]);
        k.dome(15, 0, 7, 13, 4, 12, LEAD);
      },
      // A square hall under one wide dome, a three-domed porch on the entrance side (−u) and the minaret beside it.
      mosque: function (k) {
        var stone = [0.82, 0.74, 0.62], brick = [0.70, 0.45, 0.34], hall = [[-7, -12.2], [14, -12.2], [14, 12.2], [-7, 12.2]];
        k.stripes(hall, 0, 12, stone, brick, LEAD);
        k.windowsU(-12.35, -4, 11, 2.5, 10, 3, 2, -1); k.windowsU(12.35, -4, 11, 2.5, 10, 3, 2, 1); k.windowsV(14.15, -9, 9, 2.5, 10, 3, 2, 1);
        k.tube(3.5, 0, 9.2, 9.2, 12, 14.5, 8, stone); k.dome(3.5, 0, 8.4, 14.5, 7, 16, LEAD); k.tube(3.5, 0, 0.25, 0.05, 21.5, 23.5, 6, GOLD);
        k.box(-13.5, -7, -12.2, 12.2, 5.2, 5.9, stone);
        [-11.6, -3.9, 3.9, 11.6].forEach(function (v) { k.tube(-13, v, 0.38, 0.38, 0, 5.2, 8, stone); });
        [-7.6, 0, 7.6].forEach(function (v) { k.dome(-10.2, v, 2.7, 5.9, 1.9, 10, LEAD); });
        k.windowsV(-7.1, -1.6, 1.6, 0.3, 4.2, 1, 1, -1, [0.28, 0.19, 0.13]);
        k.tube(-11.8, -9.3, 1.5, 1.3, 0, 19, 10, stone); k.tube(-11.8, -9.3, 2.1, 2.1, 19, 20.2, 10, stone, { cap: true });
        k.tube(-11.8, -9.3, 1.05, 1.05, 20.2, 25, 10, stone); k.tube(-11.8, -9.3, 1.25, 0, 25, 31, 10, LEAD);
      },
      // A green tent spire among five gilded onion domes.
      russian: function (k, ring) {
        var wall = [0.93, 0.88, 0.70], tile = [0.25, 0.50, 0.38];
        k.prism(ring, 0, 10, wall, tile);
        k.gable(-12.3, 12.3, -4.2, 4.2, 10, 2.6, true, tile, wall); k.gable(-5.1, 7.4, -9.5, 9.5, 10, 2.6, false, tile, wall);
        k.windowsU(-9.65, -3.5, 5.8, 2.5, 8, 3, 1, -1); k.windowsU(9.65, -3.5, 5.8, 2.5, 8, 3, 1, 1);
        k.tube(1, 0, 3.6, 3.6, 10, 15.5, 8, wall, { windows: true });
        k.tube(1, 0, 3.9, 0.5, 15.5, 29, 8, tile); k.dome(1, 0, 1.15, 29, 2.8, 8, GOLD, true); k.cross(1, 0, 31.8, 1.6, GOLD);
        [[6, 5], [6, -5], [-4, 5], [-4, -5]].forEach(function (c) {
          k.tube(c[0], c[1], 1, 1, 10, 15.5, 8, wall); k.tube(c[0], c[1], 1.25, 0.35, 15.5, 18.5, 8, tile);
          k.dome(c[0], c[1], 0.75, 18.5, 1.9, 8, GOLD, true);
        });
        k.box(-13.6, -12.2, -2.4, 2.4, 0, 5, wall); k.gable(-13.9, -12.2, -2.8, 2.8, 5, 1.8, true, tile, wall);
      },
      // The wedge of the Largo: its narrow west front (−u) carries the colonnade, the stepped tower and the spire.
      party: function (k, ring) {
        var stone = [0.89, 0.86, 0.79], glazing = [0.36, 0.40, 0.42], roof = [0.60, 0.59, 0.56];
        k.prism(ring, 0, 4, stone);
        k.floors(ring, 4, 24, 4, stone, glazing);
        k.prism(ring, 24, 26, stone, roof);
        k.box(-57, -43, -34, -20, 26, 34, stone); k.windowsV(-57.15, -33, -21, 27, 33, 4, 1, -1);
        k.box(-55, -45, -32, -22, 34, 41, stone); k.windowsV(-55.15, -31, -23, 35, 40, 3, 1, -1);
        k.tube(-50, -27, 3, 3, 41, 47, 8, stone, { windows: true });
        k.tube(-50, -27, 3.3, 0.9, 47, 49, 8, stone); k.tube(-50, -27, 0.9, 0.12, 49, 61, 8, stone);
        for (var column = 0; column < 8; column++) {
          var t = (column + 0.5) / 8;
          k.tube(-54.6 - 7.4 * t, -43.6 + 24.2 * t, 0.65, 0.6, 4, 20, 8, stone);
        }
      },
      // The old tower on its podium: a tapering concrete shaft, the glazed platforms and a banded mast.
      tvtower: function (k, ring) {
        var concrete = [0.78, 0.77, 0.74], glazing = [0.28, 0.33, 0.37], red = [0.80, 0.20, 0.16], white = [0.94, 0.94, 0.92];
        k.floors(ring, 0, 11, 5.5, concrete, glazing, [0.5, 0.5, 0.5]);
        k.tube(0, 0, 7, 6, 11, 43, 12, concrete);
        k.tube(0, 0, 6, 9, 43, 45, 16, concrete); k.tube(0, 0, 9, 9, 45, 50, 16, concrete, { windows: true }); k.tube(0, 0, 9, 4.2, 50, 52, 16, concrete);
        k.tube(0, 0, 4.2, 4.2, 52, 59, 12, concrete, { windows: true, cap: true });
        k.tube(0, 0, 1.6, 1.6, 59, 75, 6, red); k.tube(0, 0, 1.2, 1.2, 75, 90, 6, white); k.tube(0, 0, 0.7, 0.3, 90, 106, 6, red);
      },
      // Striped Moorish revival walls, an octagonal drum and dome, and turrets at the corners and the west front (−u).
      synagogue: function (k, ring) {
        var ochre = [0.88, 0.76, 0.54], brick = [0.68, 0.40, 0.30], lead = [0.36, 0.40, 0.42];
        k.stripes(ring, 0, 16, ochre, brick, lead);
        k.windowsU(-14.35, -15, 15, 4, 13, 6, 1, -1); k.windowsU(14.35, -15, 15, 4, 13, 6, 1, 1);
        k.windowsV(-19.75, -3.5, 3.5, 0.4, 7, 1, 1, -1, [0.28, 0.19, 0.13]); k.windowsV(-19.75, -4, 4, 8.5, 14, 3, 1, -1);
        k.tube(0, 0, 9.5, 9.5, 16, 22, 8, ochre, { windows: true }); k.dome(0, 0, 9.9, 22, 8, 16, lead); k.tube(0, 0, 0.3, 0.05, 30, 32, 6, GOLD);
        [[-18.6, 13.2], [-18.6, -13.2], [18.6, 13.2], [18.6, -13.2], [-19.4, 5.2], [-19.4, -5.2]].forEach(function (c) {
          k.tube(c[0], c[1], 1.8, 1.8, 0, 19.5, 8, ochre); k.dome(c[0], c[1], 1.7, 19.5, 3.2, 8, lead, true);
        });
      },
      // The horseman faces the National Assembly (+u) from a dark granite pedestal with a bronze frieze.
      tsar: function (k) {
        k.box(-4.6, 4.6, -3.5, 3.5, 0, 0.8, GRANITE); k.box(-3.6, 3.6, -2.6, 2.6, 0.8, 1.6, GRANITE);
        k.box(-2.6, 2.6, -1.6, 1.6, 1.6, 7.2, DARK); k.box(-2.75, 2.75, -1.75, 1.75, 3, 4.6, BRONZE); k.box(-2.9, 2.9, -1.9, 1.9, 7.2, 7.6, GRANITE);
        [[1.1, 0.35], [1.1, -0.35], [-1.1, 0.35], [-1.1, -0.35]].forEach(function (c) { k.box(c[0] - 0.15, c[0] + 0.15, c[1] - 0.15, c[1] + 0.15, 7.6, 9.3, BRONZE); });
        k.box(-1.5, 1.5, -0.5, 0.5, 9.3, 10.5, BRONZE); k.box(1.2, 1.8, -0.3, 0.3, 10.3, 11.6, BRONZE); k.box(1.6, 2.4, -0.25, 0.25, 11.2, 11.8, BRONZE);
        k.box(-1.9, -1.5, -0.15, 0.15, 9.4, 10.4, BRONZE);
        k.box(-0.3, 0.4, -0.35, 0.35, 10.5, 11.9, BRONZE); k.dome(0.05, 0, 0.3, 11.9, 0.6, 8, BRONZE); k.box(0.3, 1.0, 0.3, 0.5, 11.2, 11.4, BRONZE);
      },
      // A dark column carrying the robed figure with a gilded face, a wreath in one hand and an owl on the other arm.
      sofia: function (k) {
        var robe = [0.17, 0.17, 0.18];
        k.tube(0, 0, 3.2, 3.2, 0, 0.5, 12, GRANITE, { cap: true }); k.tube(0, 0, 2.4, 2.4, 0.5, 1.2, 12, GRANITE, { cap: true });
        k.tube(0, 0, 1.15, 0.95, 1.2, 15.5, 12, DARK); k.tube(0, 0, 1.5, 1.5, 15.5, 16.2, 12, DARK, { cap: true });
        k.tube(0, 0, 1.0, 0.5, 16.2, 21.2, 10, robe, { cap: true }); k.box(-0.35, 0.35, -0.9, 0.9, 20.4, 21.2, robe);
        k.box(-0.2, 0.2, -2.0, -0.9, 20.6, 20.95, robe); k.box(-0.2, 0.2, 0.9, 2.0, 20.6, 20.95, robe);
        k.dome(0, 0, 0.42, 21.3, 0.85, 8, GOLD); k.tube(0, 0, 0.45, 0.52, 22, 22.5, 8, GOLD, { cap: true });
        k.tube(0, -2.0, 0.45, 0.45, 20.25, 20.6, 8, GOLD); k.box(-0.2, 0.2, 1.8, 2.2, 20.95, 21.6, BRONZE);
      },
      // A 13 m granite obelisk on a stepped base.
      levski: function (k) {
        k.box(-4, 4, -4, 4, 0, 0.5, GRANITE); k.box(-3, 3, -3, 3, 0.5, 1, GRANITE);
        k.box(-1.7, 1.7, -1.7, 1.7, 1, 3.6, GRANITE); k.box(-1.9, 1.9, -1.9, 1.9, 3.6, 3.9, GRANITE);
        k.tube(0, 0, 1.6, 1.0, 3.9, 12, 4, GRANITE, { turn: Math.PI / 4 }); k.tube(0, 0, 1.0, 0, 12, 13, 4, GRANITE, { turn: Math.PI / 4 });
        k.windowsV(1.72, -0.7, 0.7, 1.6, 3.1, 1, 1, 1, BRONZE);
      },
      // A football ground from its mapped outline: a striped pitch with markings and goals, a running track where
      // there is one, a bowl of seating tiers in the club's colours that rises to the outline, a lit concourse
      // band on the outer wall, a cantilevered roof over the stands where the ground has one and floodlight masts.
      stadium: function (k, ring, site) {
        var grounds = {
          'Vasil Levski National Stadium': { h: 24, track: true, roof: 0.42, seats: [[0.78, 0.16, 0.16], [0.92, 0.92, 0.90], [0.16, 0.52, 0.30]], masts: false },
          'Bulgarian Army Stadium': { h: 13, seats: [[0.72, 0.10, 0.12], [0.84, 0.84, 0.82]], roof: 0.3, masts: true },
          'Georgi Asparuhov Stadium': { h: 19, seats: [[0.10, 0.28, 0.66], [0.90, 0.90, 0.92]], roof: 0.5, masts: true },
          'Lokomotiv Stadium': { h: 14, track: true, seats: [[0.70, 0.12, 0.12], [0.16, 0.16, 0.17]], masts: true },
          'Slavia Stadium': { h: 12, seats: [[0.92, 0.92, 0.90], [0.20, 0.20, 0.22]], masts: true }
        };
        var g = grounds[site.n] || { h: 14, seats: [[0.6, 0.6, 0.62], [0.8, 0.8, 0.8]], masts: true };
        var concrete = [0.74, 0.73, 0.70], apron = [0.58, 0.58, 0.56], grass = [0.27, 0.55, 0.24], mown = [0.31, 0.62, 0.27];
        var white = [0.95, 0.95, 0.93], track = [0.72, 0.30, 0.22], membrane = [0.90, 0.91, 0.92], H = g.h;
        var us = ring.map(function (p) { return p[0]; }), vs = ring.map(function (p) { return p[1]; });
        var spanU = Math.min(-Math.min.apply(null, us), Math.max.apply(null, us)), spanV = Math.min(-Math.min.apply(null, vs), Math.max.apply(null, vs));
        // The bowl's inner edge sits just outside the pitch (or the track).
        var pu = Math.min(52.5, spanU * 0.5), pv = Math.min(34, spanV * 0.5);
        var need = g.track ? [pu + 12, pv + 12] : [pu + 6, pv + 6];
        var shrink = Math.min(0.8, Math.max(need[0] / spanU, need[1] / spanV, 0.45));
        var inner = scaled(ring, shrink);
        k.prism(ring, 0, 0.15, apron, apron);
        if (g.track) k.prism(scaled(ring, shrink * 0.99), 0.15, 0.25, track, track);
        for (var band = 0; band < 10; band++) {
          var b0 = -pu - 3 + (2 * pu + 6) * band / 10, b1 = -pu - 3 + (2 * pu + 6) * (band + 1) / 10;
          k.box(b0, b1, -pv - 3, pv + 3, 0.25, 0.32, band % 2 ? grass : mown);
        }
        function line(u0, u1, v0, v1) { k.box(u0, u1, v0, v1, 0.32, 0.34, white); }
        line(-pu, pu, -pv, -pv + 0.15); line(-pu, pu, pv - 0.15, pv); line(-pu, -pu + 0.15, -pv, pv); line(pu - 0.15, pu, -pv, pv);
        line(-0.08, 0.08, -pv, pv);
        k.tube(0, 0, 9.15, 9.15, 0.32, 0.34, 24, white); k.tube(0, 0, 9.0, 9.0, 0.32, 0.345, 24, grass, { cap: true });
        [-1, 1].forEach(function (s) {
          var goal = s * pu, box = s * (pu - 16.5), six = s * (pu - 5.5), back = goal + s * 1.6;
          line(Math.min(goal, box), Math.max(goal, box), -20.15, -20); line(Math.min(goal, box), Math.max(goal, box), 20, 20.15);
          line(box - 0.08, box + 0.08, -20.15, 20.15);
          line(Math.min(goal, six), Math.max(goal, six), -9.16, -9.01); line(Math.min(goal, six), Math.max(goal, six), 9.01, 9.16);
          line(six - 0.08, six + 0.08, -9.16, 9.16);
          k.box(Math.min(goal, back), Math.max(goal, back), -3.75, -3.6, 0.32, 2.44, white); k.box(Math.min(goal, back), Math.max(goal, back), 3.6, 3.75, 0.32, 2.44, white);
          k.box(goal - 0.07, goal + 0.07, -3.75, 3.75, 2.3, 2.44, white);
        });
        // Seating tiers between the inner edge and the outline, alternating the club's colours, with a concrete aisle ring.
        var tiers = Math.max(6, Math.round(H / 2.2));
        function at(p, q, s, z) { return [q[0] + (p[0] - q[0]) * s, q[1] + (p[1] - q[1]) * s, z]; }
        ring.forEach(function (a, i) {
          var b = ring[(i + 1) % ring.length], ai = inner[i], bi = inner[(i + 1) % ring.length], from = [a[0] * 3, a[1] * 3, -80];
          for (var t = 0; t < tiers; t++) {
            var s0 = t / tiers, s1 = (t + 1) / tiers, z0 = 1.2 + (H - 1.2) * s0, z1 = 1.2 + (H - 1.2) * s1;
            var color = t === Math.floor(tiers / 2) ? concrete : g.seats[t % g.seats.length];
            k.quad(at(a, ai, s0, z0), at(b, bi, s0, z0), at(b, bi, s1, z1), at(a, ai, s1, z1), color, from);
          }
        });
        k.prism(inner, 0.15, 1.2, concrete);
        k.prism(ring, 0, 1, DARK);
        k.prism(ring, 1, 4.2, GLASS, null, true);
        k.prism(ring, 4.2, H - 0.8, concrete);
        k.prism(ring, H - 0.8, H, g.seats[0]);
        // A cantilevered roof from the outer rim, reaching part of the way over the tiers.
        if (g.roof) {
          var lip = scaled(ring, 1 - (1 - shrink) * g.roof);
          ring.forEach(function (a, i) {
            var b = ring[(i + 1) % ring.length], c = lip[(i + 1) % ring.length], d = lip[i];
            k.quad([a[0], a[1], H + 6], [b[0], b[1], H + 6], [c[0], c[1], H + 4.5], [d[0], d[1], H + 4.5], membrane, [0, 0, -100]);
            k.quad([a[0], a[1], H + 5.6], [b[0], b[1], H + 5.6], [c[0], c[1], H + 4.1], [d[0], d[1], H + 4.1], [0.45, 0.46, 0.48], [0, 0, 200]);
            if (i % 2 === 0) k.tube(a[0], a[1], 0.5, 0.5, H, H + 6, 6, concrete);
          });
          k.prism(lip, H + 4.1, H + 4.5, [0.60, 0.61, 0.62]);
        }
        // Four floodlight masts at the corners of the bowl, their lamp banks facing the pitch.
        if (g.masts) [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (c) {
          var best = ring[0], score = -1e9;
          ring.forEach(function (p) { var d = p[0] * c[0] / spanU + p[1] * c[1] / spanV; if (d > score) { score = d; best = p; } });
          var m = [best[0] * 0.97, best[1] * 0.97], top = H + 26, len = Math.hypot(m[0], m[1]), along = [-m[1] / len, m[0] / len];
          k.tube(m[0], m[1], 0.9, 0.5, 0, top, 8, [0.55, 0.56, 0.58]);
          k.turned([m[0] - m[0] / len * 0.8, m[1] - m[1] / len * 0.8], along, 3, 0.5, top, top + 3.2, GLASS, true);
          k.turned([m[0], m[1]], along, 3.2, 0.4, top - 0.3, top, [0.4, 0.4, 0.42]);
        });
      },
      // A university building from its mapped outline. Sofia University and the Academy of Arts are stone, with a
      // granite plinth, rows of tall windows, a cornice, a columned portico with a pediment on the longest side and
      // the rectorate's copper dome. The newer campuses are banded concrete and glass with roof plant and a glass
      // entrance, and the UACEG slab rises from its podium. Every one flies the flag over its entrance.
      university: function (k, ring, site) {
        var classic = /Sofia University|Academy of Arts/.test(site.n);
        var levels = Math.min(classic ? 4 : 5, site.l || 4), floor = classic ? 5 : 3.7, H = levels * floor + (classic ? 1.5 : 0);
        var stone = /Sofia/.test(site.n) ? [0.90, 0.82, 0.60] : [0.88, 0.85, 0.78], roof = [0.50, 0.52, 0.52], trim = [0.96, 0.95, 0.91];
        var edges = ring.map(function (a, i) {
          var b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return { a: a, l: l, along: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], out: [(b[1] - a[1]) / l, -(b[0] - a[0]) / l] };
        });
        var front = edges.reduce(function (x, y) { return y.l > x.l ? y : x; });
        function point(e, t, d, z) { return [e.a[0] + e.along[0] * t + e.out[0] * d, e.a[1] + e.along[1] * t + e.out[1] * d, z]; }
        var mid = front.l / 2, half = Math.min(classic ? 12 : 8, front.l * 0.25), flag, fz;
        if (classic) {
          k.prism(ring, 0, 1.5, GRANITE);
          k.prism(ring, 1.5, H, stone);
          k.prism(scaled(ring, 1.006), H - 0.9, H, trim);
          k.prism(ring, H, H + 1, stone, roof);
          edges.forEach(function (e) {
            var count = Math.floor(e.l / 4.2);
            for (var w = 0; w < count; w++) for (var f = 0; f < levels; f++) {
              var t0 = (e.l - count * 4.2) / 2 + w * 4.2 + 1.1, z0 = 1.5 + f * floor + 1, z1 = z0 + floor * 0.55;
              k.quad(point(e, t0, 0.06, z0), point(e, t0 + 2, 0.06, z0), point(e, t0 + 2, 0.06, z1), point(e, t0, 0.06, z1), GLASS, point(e, t0 + 1, -1, z0), true);
            }
          });
          // The portico: a granite step, six columns, the entablature and a pediment under a pitched roof.
          var depth = 5, ht = H - 1;
          k.turned(point(front, mid, depth / 2, 0), front.along, half + 1, depth / 2 + 0.6, 0, 1.2, GRANITE);
          for (var c = 0; c < 6; c++) {
            var cp = point(front, mid - half + 2 * half * c / 5, depth - 0.8, 0);
            k.tube(cp[0], cp[1], 0.75, 0.62, 1.2, ht, 10, trim);
          }
          k.turned(point(front, mid, depth / 2, 0), front.along, half + 0.8, depth / 2 + 0.4, ht, ht + 1.6, trim);
          var z0 = ht + 1.6, rise = 4.5, from = point(front, mid, depth / 2, z0 - 3);
          var l0 = point(front, mid - half - 0.8, depth + 0.4, z0), l1 = point(front, mid - half - 0.8, -0.4, z0);
          var r0 = point(front, mid + half + 0.8, depth + 0.4, z0), r1 = point(front, mid + half + 0.8, -0.4, z0);
          var t0 = point(front, mid, depth + 0.4, z0 + rise), t1 = point(front, mid, -0.4, z0 + rise);
          k.tri(l0, r0, t0, trim, from); k.tri(l1, r1, t1, trim, from);
          k.quad(l0, t0, t1, l1, roof, from); k.quad(r0, t0, t1, r1, roof, from);
          k.quad(point(front, mid - 2, 0.07, 1.2), point(front, mid + 2, 0.07, 1.2), point(front, mid + 2, 0.07, 6), point(front, mid - 2, 0.07, 6), [0.28, 0.19, 0.13], point(front, mid, -1, 3));
          if (/Sofia/.test(site.n)) {
            var dc = point(front, mid, -14, 0);
            if (inside(ring, dc[0], dc[1])) {
              k.tube(dc[0], dc[1], 7, 7, H + 1, H + 5, 16, stone, { windows: true });
              k.dome(dc[0], dc[1], 7.3, H + 5, 6, 16, COPPER); k.tube(dc[0], dc[1], 1, 0.8, H + 11, H + 13, 8, stone, { cap: true });
            }
          }
          flag = point(front, mid, depth / 2, 0); fz = z0 + rise;
        } else {
          k.floors(ring, 0, H, floor, [0.86, 0.85, 0.82], [0.30, 0.38, 0.44], roof);
          k.prism(ring, H, H + 1, [0.80, 0.79, 0.76], roof);
          if (site.l > 8) {
            var tu = Math.min(24, front.l * 0.2), tv = 8, tc = point(front, mid, -tv - 10, 0), crown = site.l * 3.4;
            if (inside(ring, tc[0], tc[1])) {
              for (var z = H + 1; z < crown; z += 3.4) {
                k.turned(tc, front.along, tu, tv, z, z + 1.1, [0.86, 0.85, 0.82]);
                k.turned(tc, front.along, tu, tv, z + 1.1, Math.min(crown, z + 3.4), [0.30, 0.38, 0.44], true);
              }
              k.turned(tc, front.along, tu, tv, crown, crown + 1.5, [0.80, 0.79, 0.76]);
            }
          }
          for (var unit = 0; unit < 6; unit++) {
            var p = point(front, front.l * (0.15 + 0.14 * unit), -8 - (unit % 2) * 6, 0);
            if (inside(ring, p[0], p[1])) k.turned(p, front.along, 2.2, 1.5, H + 1, H + 2.8, [0.66, 0.67, 0.68]);
          }
          k.turned(point(front, mid, 3, 0), front.along, half, 3, 3.6, 4.1, [0.80, 0.79, 0.76]);
          k.turned(point(front, mid, 0.5, 0), front.along, half * 0.6, 0.5, 0, 3.6, GLASS, true);
          flag = point(front, mid, 5.5, 0); fz = 0;
        }
        // The Bulgarian flag on a pole over the entrance.
        k.tube(flag[0], flag[1], 0.09, 0.07, fz, fz + 8, 6, [0.85, 0.85, 0.85]);
        [[0.96, 0.96, 0.96], [0.0, 0.59, 0.43], [0.84, 0.15, 0.12]].forEach(function (color, n) {
          var a = [flag[0] + front.along[0] * 1.3, flag[1] + front.along[1] * 1.3];
          k.turned(a, front.along, 1.2, 0.03, fz + 7.6 - (n + 1) * 0.55, fz + 7.6 - n * 0.55, color);
        });
      },
      // A mall from its mapped outline: glazed shopfronts, panelled walls under a colour band, a glass entrance on the
      // longest side, a skylight and roof plant where they fit. Colours vary from site to site.
      mall: function (k, ring, site) {
        var pick = Math.abs(Math.round(site.at[0] * 1e5) * 7 + Math.round(site.at[1] * 1e5) * 13);
        var wall = [[0.90, 0.90, 0.88], [0.80, 0.79, 0.76], [0.88, 0.82, 0.70], [0.78, 0.82, 0.86]][pick % 4];
        var accent = [[0.80, 0.16, 0.16], [0.13, 0.36, 0.70], [0.93, 0.52, 0.10], [0.16, 0.56, 0.36], [0.62, 0.16, 0.50]][pick % 5];
        var glazing = [0.30, 0.42, 0.50], roof = [0.56, 0.56, 0.55], height = Math.max(10, site.h || 14);
        k.prism(ring, 0, 0.6, DARK);
        k.prism(ring, 0.6, 4.6, glazing, null, true);
        if (height > 15) {
          var ribbon = 4.6 + (height - 6) * 0.5;
          k.prism(ring, 4.6, ribbon, wall); k.prism(ring, ribbon, ribbon + 2, glazing, null, true); k.prism(ring, ribbon + 2, height - 1.4, wall);
        } else k.prism(ring, 4.6, height - 1.4, wall);
        k.prism(ring, height - 1.4, height - 0.6, accent);
        k.prism(ring, height - 0.6, height + 0.6, wall, roof);
        var best = 0, length = 0;
        ring.forEach(function (a, i) {
          var b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (l > length) { length = l; best = i; }
        });
        var a = ring[best], b = ring[(best + 1) % ring.length];
        var along = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], out = [along[1], -along[0]], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        var half = Math.min(9, length * 0.2);
        function off(d) { return [mid[0] + out[0] * d, mid[1] + out[1] * d]; }
        k.turned(off(1), along, half, 2.5, 0, height + 2.5, glazing, true);
        k.turned(off(4.6), along, half + 1.5, 1.4, 4.2, 4.7, accent);
        k.turned(off(1), along, half * 0.7, 2.7, height + 2.5, height + 4.5, accent);
        var us = ring.map(function (p) { return p[0]; }), vs = ring.map(function (p) { return p[1]; });
        var u0 = Math.min.apply(null, us), u1 = Math.max.apply(null, us), v0 = Math.min.apply(null, vs), v1 = Math.max.apply(null, vs);
        var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, lu = (u1 - u0) * 0.28, lv = Math.max(3, (v1 - v0) * 0.08), top = height + 0.6;
        function fits(a0, a1, b0, b1) {
          return [[a0, b0], [a1, b0], [a1, b1], [a0, b1], [(a0 + a1) / 2, (b0 + b1) / 2]].every(function (p) { return inside(ring, p[0], p[1]); });
        }
        if (fits(cu - lu, cu + lu, cv - lv, cv + lv)) {
          k.box(cu - lu, cu + lu, cv - lv, cv + lv, top, top + 0.8, wall);
          k.gable(cu - lu, cu + lu, cv - lv, cv + lv, top + 0.8, Math.min(4, lv * 0.7), true, [0.52, 0.68, 0.76], wall);
        }
        for (var unit = 0; unit < 8; unit++) {
          var x = u0 + (u1 - u0) * (0.12 + 0.76 * (((pick >> unit) * 37 + unit * 53) % 100) / 100);
          var y = v0 + (v1 - v0) * (unit % 2 ? 0.22 : 0.78);
          if (fits(x - 3, x + 3, y - 2.2, y + 2.2)) k.box(x - 2.4, x + 2.4, y - 1.6, y + 1.6, top, top + 1.9, [0.66, 0.67, 0.68]);
        }
      }
    };

    // A site's triangles in metres east, south and up of its centre.
    var meshes = new Map();
    function mesh(site) {
      if (meshes.has(site)) return meshes.get(site);
      var local = [];
      builders[site.k](kit(local), outline(site), site);
      var b = site.b * Math.PI / 180, s = Math.sin(b), c = Math.cos(b), data = new Float32Array(local.length);
      for (var i = 0; i < local.length; i += 10) {
        data[i] = local[i] * s - local[i + 1] * c; data[i + 1] = -(local[i] * c + local[i + 1] * s); data[i + 2] = local[i + 2];
        data[i + 3] = local[i + 3]; data[i + 4] = local[i + 4]; data[i + 5] = local[i + 5];
        data[i + 6] = local[i + 6] * s - local[i + 7] * c; data[i + 7] = -(local[i + 6] * c + local[i + 7] * s); data[i + 8] = local[i + 8];
        data[i + 9] = local[i + 9];
      }
      meshes.set(site, data);
      return data;
    }

    // The source the fixed-model layer in bulgarian-houses.js draws: which sites are in view, and their vertices.
    // A site with `z` (small monuments) waits for that MapLibre zoom; the others show from minZoom.
    function visible(bounds, zoom) {
      var seen = new Set(), west = bounds.getWest(), east = bounds.getEast(), south = bounds.getSouth(), north = bounds.getNorth();
      landmarkSites.forEach(function (site, i) {
        if (!drawn(site) || (site.z && zoom !== undefined && zoom < site.z)) return;
        var dLat = (site.reach + 120) / 110574, dLon = dLat / Math.cos(site.at[1] * Math.PI / 180);
        if (site.at[0] + dLon >= west && site.at[0] - dLon <= east && site.at[1] + dLat >= south && site.at[1] - dLat <= north) seen.add(i);
      });
      return seen;
    }
    function vertices(map, origin, seen) {
      var parts = [], size = 0;
      (seen || visible(map.getBounds(), map.getZoom())).forEach(function (i) {
        var site = landmarkSites[i], data = mesh(site), part = new Float32Array(data);
        var at = maplibregl.MercatorCoordinate.fromLngLat(site.at), unit = at.meterInMercatorCoordinateUnits();
        var x = (at.x - origin.x) / origin.unit, y = (at.y - origin.y) / origin.unit, k = unit / origin.unit;
        var lift = map.getTerrain() ? map.queryTerrainElevation(site.at) || 0 : 0;
        for (var j = 0; j < part.length; j += 10) { part[j] = x + part[j] * k; part[j + 1] = y + part[j + 1] * k; part[j + 2] = (part[j + 2] + lift) * k; }
        parts.push(part); size += part.length;
      });
      var all = new Float32Array(size), offset = 0;
      parts.forEach(function (part) { all.set(part, offset); offset += part.length; });
      return all;
    }
    // Builders in other files (monument-models.js) register here; meshes are built on first use.
    function define(kind, builder) { builders[kind] = builder; }
    return { suffix: '-landmarks', minZoom: 12, visible: visible, vertices: vertices, filter: filter, mesh: mesh, sites: landmarkSites, define: define,
      colors: { GLASS: GLASS, GOLD: GOLD, COPPER: COPPER, LEAD: LEAD, STONE: STONE, GRANITE: GRANITE, DARK: DARK, BRONZE: BRONZE },
      setShown: setShown, awake: function () { return shown.landmarks || shown.malls; } };
  })();
