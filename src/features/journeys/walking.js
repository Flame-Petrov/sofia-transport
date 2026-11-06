  // ---------- v94: walking along the streets, worked out on the phone ----------
  // The walking parts of a way follow the streets: OpenStreetMap's roads, footways, steps and paths from the map's own
  // vector tiles (OpenFreeMap, layer "transportation", zoom 14: the tiles the map shows and the offline map keeps, so
  // usually nothing is downloaded), with no routing service. Measured against FOSSGIS's walking router on 7 walks in
  // Sofia: within ~5 % (the straight line × 1.3 used before was up to 24 % off).
  // The tiles' lines don't join where streets meet (a street ending on another rarely shares a point with it, and
  // crossings share none): read as they are, one tile fell apart into 742 pieces. So loose ends are joined to the
  // nearest line within ~5 m, and ground-level crossings become junctions (bridges and tunnels only meet their own
  // level): 96–99 % of the area is then one network. Only lines within 300 m of the walk's box are used.
  var WALK_Z = 14, WALK_E = 4096, WALK_MARGIN_M = 300, WALK_SNAP = 12, WALK_MAX_M = 4000;   // WALK_SNAP in tile units (~0.44 m)
  var WALK_NO = { motorway: 1, rail: 1, transit: 1, ferry: 1, aerialway: 1, raceway: 1, busway: 1, bus_guideway: 1 };
  var VT = null, VTL = null, walkTpl = null, walkTiles = {}, walkCache = {}, walkInfo = { n: 0, ms: 0, fail: 0, tiles: 0, last: 0 };
  function vtType() {
    if (!VT) VT = protobuf.parse([
      'syntax = "proto2"; package vector_tile;',
      'message Tile { repeated Layer layers = 3;',
      '  message Value { optional string string_value = 1; optional float float_value = 2; optional double double_value = 3;',
      '    optional int64 int_value = 4; optional uint64 uint_value = 5; optional sint64 sint_value = 6; optional bool bool_value = 7; }',
      '  message Feature { optional uint64 id = 1; repeated uint32 tags = 2 [packed = true]; optional uint32 type = 3; repeated uint32 geometry = 4 [packed = true]; }',
      '  message Layer { required uint32 version = 15; required string name = 1; repeated Feature features = 2; repeated string keys = 3;',
      '    repeated Value values = 4; optional uint32 extent = 5; } }'
    ].join('\n'), { keepCase: true }).root.lookupType('vector_tile.Tile');
    return VT;
  }
  // the map's tile address (the vector style's, else the tile list saved for the month, §5.8)
  function walkTemplate() {
    if (walkTpl) return Promise.resolve(walkTpl);
    var src = vectorSource(builtStyle);
    if (src && src.tiles && src.tiles[0]) return Promise.resolve(walkTpl = 'https://' + src.tiles[0].replace(/^ofm:\/\//, ''));
    return cachedJSON('tilejson:' + OFM_TILEJSON, OFM_TILEJSON, MAP_VERSION_DAYS * 864e5).then(function (tj) {
      return (walkTpl = (tj && tj.tiles && tj.tiles[0]) || null);
    });
  }
  // one tile's walkable lines, in global tile units at zoom 14 (x · 4096 + px): [{ p: Int32Array, lvl }]
  function walkTile(x, y) {
    var k = x + '/' + y;
    if (walkTiles[k]) return walkTiles[k];
    if (Object.keys(walkTiles).length > 48) walkTiles = {};   // a few km² is plenty
    return (walkTiles[k] = walkTemplate().then(function (tpl) {
      if (!tpl) throw new Error('no map tile address');
      return getTile(tpl.replace('{z}', WALK_Z).replace('{x}', x).replace('{y}', y));
    }).then(function (r) {
      walkInfo.tiles++;
      return nextTask().then(function () { return walkLines(transportLayer(new Uint8Array(r.d)), x, y); });
    }).catch(function (e) { delete walkTiles[k]; throw e; }));
  }
  // Only the tile's "transportation" layer is decoded: the whole tile (buildings, labels, land use…) took up to
  // ~300 ms on a phone-speed CPU, in one piece
  function transportLayer(buf) {
    var r = protobuf.Reader.create(buf);
    while (r.pos < r.len) {
      var tag = r.uint32();
      if ((tag >>> 3) !== 3 || (tag & 7) !== 2) { r.skipType(tag & 7); continue; }
      var len = r.uint32(), start = r.pos, end = start + len, part = buf.subarray(start, end), rr = protobuf.Reader.create(part), name = '';
      while (rr.pos < rr.len) {
        var t2 = rr.uint32();
        if ((t2 >>> 3) === 1 && (t2 & 7) === 2) { name = rr.string(); break; }
        rr.skipType(t2 & 7);
      }
      if (name === 'transportation') return (VTL || (VTL = vtType().lookupType('Layer'))).decode(part);
      r.pos = end;
    }
    return null;
  }
  function walkLines(L, x, y) {
    var out = [], i;
    if (!L) return out;
    var f = WALK_E / (L.extent || WALK_E), ox = x * WALK_E, oy = y * WALK_E;
    L.features.forEach(function (ft) {
      if (ft.type !== 2) return;   // lines only
      var tags = {};
      for (var j = 0; j + 1 < ft.tags.length; j += 2) {
        var v = L.values[ft.tags[j + 1]];
        tags[L.keys[ft.tags[j]]] = v.string_value || (v.int_value ? String(v.int_value) : v.sint_value ? String(v.sint_value) : v.uint_value ? String(v.uint_value) : '');
      }
      var c = tags['class'] || '';
      if (WALK_NO[c] || /_construction$/.test(c) || tags.foot === 'no' || (tags.access === 'no' && tags.foot !== 'yes') || (c === 'trunk' && tags.foot !== 'yes')) return;
      var lvl = tags.brunnel === 'bridge' || tags.brunnel === 'tunnel' ? tags.brunnel + (tags.layer || '') : '';
      var g = ft.geometry, cx = 0, cy = 0, n = 0, cur = null;
      while (n < g.length) {
        var cmd = g[n] & 7, cnt = g[n] >> 3;
        n++;
        if (cmd === 7) continue;
        for (var q = 0; q < cnt; q++) {
          cx += (g[n] >> 1) ^ -(g[n] & 1); cy += (g[n + 1] >> 1) ^ -(g[n + 1] & 1); n += 2;
          if (cmd === 1) { if (cur && cur.length > 2) out.push({ p: Int32Array.from(cur), lvl: lvl }); cur = []; }
          cur.push(Math.round(ox + cx * f), Math.round(oy + cy * f));
        }
      }
      if (cur && cur.length > 2) out.push({ p: Int32Array.from(cur), lvl: lvl });
    });
    return out;
  }
  function wgx(lon) { return (lon + 180) / 360 * Math.pow(2, WALK_Z) * WALK_E; }
  function wgy(lat) { var r = toRad(lat); return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, WALK_Z) * WALK_E; }
  function wLL(gx, gy) { var n = Math.pow(2, WALK_Z) * WALK_E; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / n))) * 180 / Math.PI, gx / n * 360 - 180]; }

  // The walking way a → b ([lat, lon]) along the streets: { m, pts } — or null when it can't be worked out (no
  // tiles, no network there); the caller then keeps the straight-line estimate. Work is spread over short tasks.
  function walkRoute(a, b) {
    var key = a[0].toFixed(5) + ',' + a[1].toFixed(5) + '>' + b[0].toFixed(5) + ',' + b[1].toFixed(5);
    if (walkCache[key]) return walkCache[key];
    if (distM(a, b) > WALK_MAX_M) return Promise.resolve(null);
    var t0 = performance.now();
    var mU = WALK_MARGIN_M / (156543.03392 * Math.cos(toRad(a[0])) / Math.pow(2, WALK_Z) * 256 / WALK_E);   // metres → tile units
    var ax = wgx(a[1]), ay = wgy(a[0]), bx = wgx(b[1]), by = wgy(b[0]);
    var box = [Math.min(ax, bx) - mU, Math.min(ay, by) - mU, Math.max(ax, bx) + mU, Math.max(ay, by) + mU], jobs = [];
    for (var x = Math.floor(box[0] / WALK_E); x <= Math.floor(box[2] / WALK_E); x++) {
      for (var y = Math.floor(box[1] / WALK_E); y <= Math.floor(box[3] / WALK_E); y++) jobs.push(walkTile(x, y));
    }
    var p = Promise.all(jobs).then(function (tiles) {
      var g = { pos: new Map(), adj: new Map(), segs: [] };
      function node(px, py) {
        var k = px * 134217728 + py;   // 2^27: one number per point
        if (!g.pos.has(k)) { g.pos.set(k, [px, py]); g.adj.set(k, new Map()); }
        return k;
      }
      function link(u, v) {
        if (u === v) return;
        var pu = g.pos.get(u), pv = g.pos.get(v), d = Math.sqrt((pu[0] - pv[0]) * (pu[0] - pv[0]) + (pu[1] - pv[1]) * (pu[1] - pv[1]));
        g.adj.get(u).set(v, d); g.adj.get(v).set(u, d);
      }
      var lines = [];
      tiles.forEach(function (ls) { for (var i = 0; i < ls.length; i++) lines.push(ls[i]); });
      // 1) the lines (pieces within the box, plus the one point just outside it), each segment once
      return inSlices(lines.length, function (li) {
        var ln = lines[li], P = ln.p, prevK = -1, prevIn = false, ppx = 0, ppy = 0;
        for (var i = 0; i < P.length; i += 2) {
          var px = P[i], py = P[i + 1], inb = px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3];
          if (i > 0 && (inb || prevIn)) {   // a segment with at least one end in the box
            var u = prevK >= 0 ? prevK : node(ppx, ppy), v = node(px, py);
            if (u !== v) { link(u, v); g.segs.push({ a: u, b: v, li: li, lvl: ln.lvl }); }
            prevK = v;
          } else prevK = -1;
          ppx = px; ppy = py; prevIn = inb;
        }
      }).then(function () { return walkJoin(g); }).then(nextTask).then(function () {
        // 4) from you / to the place: onto the nearest line of the main network, then A*
        var comp = walkComponents(g), sa = walkAttach(g, comp, ax, ay), sb = walkAttach(g, comp, bx, by);
        return sa && sb ? nextTask().then(function () { return [sa, sb]; }) : null;
      }).then(function (ab) {
        if (!ab) return null;
        var r = walkAstar(g, ab[0].k, ab[1].k);
        if (!r) return null;
        var pts = r.map(function (k) { var q = g.pos.get(k); return wLL(q[0], q[1]); }), m = distM(a, pts[0]) + distM(pts[pts.length - 1], b);
        for (var i = 1; i < pts.length; i++) m += distM(pts[i - 1], pts[i]);
        walkInfo.n++; walkInfo.last = Math.round(performance.now() - t0); walkInfo.ms += walkInfo.last;
        return { m: m, pts: pts };
      });
    });
    walkCache[key] = p;
    p.catch(function () { delete walkCache[key]; });
    return p;
  }
  // 2) loose ends onto the nearest other segment within WALK_SNAP; 3) ground-level crossings become junctions
  function walkJoin(g) {
    var C = 64, grid = new Map(), splits = new Map();
    g.segs.forEach(function (s, i) {
      var pa = g.pos.get(s.a), pb = g.pos.get(s.b);
      for (var cx = Math.floor(Math.min(pa[0], pb[0]) / C); cx <= Math.floor(Math.max(pa[0], pb[0]) / C); cx++) {
        for (var cy = Math.floor(Math.min(pa[1], pb[1]) / C); cy <= Math.floor(Math.max(pa[1], pb[1]) / C); cy++) {
          var ck = cx * 1048576 + cy;
          (grid.get(ck) || grid.set(ck, []).get(ck)).push(i);
        }
      }
    });
    function addSplit(si, t, k) { (splits.get(si) || splits.set(si, []).get(si)).push({ t: t, k: k }); }
    var ends = [];
    g.adj.forEach(function (nb, k) { if (nb.size === 1) ends.push(k); });
    return inSlices(ends.length, function (ei) {
      var k = ends[ei], p = g.pos.get(k), best = null, bd = WALK_SNAP, gx = Math.floor(p[0] / C), gy = Math.floor(p[1] / C);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var list = grid.get((gx + dx) * 1048576 + gy + dy) || [];
        for (var i = 0; i < list.length; i++) {
          var s = g.segs[list[i]];
          if (s.a === k || s.b === k) continue;
          var A = g.pos.get(s.a), B = g.pos.get(s.b), vx = B[0] - A[0], vy = B[1] - A[1], l2 = vx * vx + vy * vy;
          var t = l2 ? Math.max(0, Math.min(1, ((p[0] - A[0]) * vx + (p[1] - A[1]) * vy) / l2)) : 0;
          var d = Math.sqrt((A[0] + vx * t - p[0]) * (A[0] + vx * t - p[0]) + (A[1] + vy * t - p[1]) * (A[1] + vy * t - p[1]));
          if (d < bd) { bd = d; best = { si: list[i], t: t }; }
        }
      }
      if (best) addSplit(best.si, best.t, k);
    }).then(function () {
      var cells = Array.from(grid.values());
      return inSlices(cells.length, function (ci) {
        var list = cells[ci];
        for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
          var s = g.segs[list[i]], r = g.segs[list[j]];
          if (s.li === r.li || s.lvl !== r.lvl || s.a === r.a || s.a === r.b || s.b === r.a || s.b === r.b) continue;
          var p = g.pos.get(s.a), p2 = g.pos.get(s.b), q = g.pos.get(r.a), q2 = g.pos.get(r.b);
          var d1x = p2[0] - p[0], d1y = p2[1] - p[1], d2x = q2[0] - q[0], d2y = q2[1] - q[1], den = d1x * d2y - d1y * d2x;
          if (!den) continue;
          var t = ((q[0] - p[0]) * d2y - (q[1] - p[1]) * d2x) / den, u = ((q[0] - p[0]) * d1y - (q[1] - p[1]) * d1x) / den;
          if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
          var px = Math.round(p[0] + d1x * t), py = Math.round(p[1] + d1y * t), k = px * 134217728 + py;
          if (!g.pos.has(k)) { g.pos.set(k, [px, py]); g.adj.set(k, new Map()); }
          addSplit(list[i], t, k); addSplit(list[j], u, k);
        }
      });
    }).then(function () {
      // apply the splits: a → k1 → k2 → … → b (crossings found in two cells are the same point: deduplicated)
      splits.forEach(function (list, si) {
        var s = g.segs[si], seen = {}, prev = s.a;
        list.sort(function (x, y) { return x.t - y.t; });
        g.adj.get(s.a).delete(s.b); g.adj.get(s.b).delete(s.a);
        list.forEach(function (sp) { if (sp.k !== prev && !seen[sp.k]) { seen[sp.k] = 1; walkLink(g, prev, sp.k); prev = sp.k; } });
        walkLink(g, prev, s.b);
      });
    });
  }
  function walkLink(g, u, v) {
    if (u === v) return;
    var pu = g.pos.get(u), pv = g.pos.get(v), d = Math.sqrt((pu[0] - pv[0]) * (pu[0] - pv[0]) + (pu[1] - pv[1]) * (pu[1] - pv[1]));
    g.adj.get(u).set(v, d); g.adj.get(v).set(u, d);
  }
  function walkComponents(g) {
    var comp = new Map(), sizes = [];
    g.adj.forEach(function (nb, k) {
      if (comp.has(k) || !nb.size) return;
      var id = sizes.length, st = [k], n = 0;
      comp.set(k, id);
      while (st.length) { var u = st.pop(); n++; g.adj.get(u).forEach(function (w, v) { if (!comp.has(v)) { comp.set(v, id); st.push(v); } }); }
      sizes.push(n);
    });
    var big = 0;
    for (var i = 1; i < sizes.length; i++) if (sizes[i] > sizes[big]) big = i;
    return { comp: comp, big: big };
  }
  // a point onto the nearest segment of the main network: a new node splitting it
  function walkAttach(g, c, px, py) {
    var best = null, bd = Infinity;
    g.adj.forEach(function (nb, a) {
      if (c.comp.get(a) !== c.big) return;
      var A = g.pos.get(a);
      nb.forEach(function (w, b) {
        if (a > b) return;
        var B = g.pos.get(b), vx = B[0] - A[0], vy = B[1] - A[1], l2 = vx * vx + vy * vy;
        var t = l2 ? Math.max(0, Math.min(1, ((px - A[0]) * vx + (py - A[1]) * vy) / l2)) : 0;
        var x = A[0] + vx * t, y = A[1] + vy * t, d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < bd) { bd = d; best = { a: a, b: b, x: x, y: y, t: t, w: w }; }
      });
    });
    if (!best) return null;
    var k = -(g.pos.size + 1);   // a key no tile point uses
    g.pos.set(k, [best.x, best.y]); g.adj.set(k, new Map());
    g.adj.get(k).set(best.a, best.w * best.t); g.adj.get(best.a).set(k, best.w * best.t);
    g.adj.get(k).set(best.b, best.w * (1 - best.t)); g.adj.get(best.b).set(k, best.w * (1 - best.t));
    c.comp.set(k, c.big);
    return { k: k };
  }
  function walkAstar(g, s, t) {
    var T = g.pos.get(t), dist = new Map([[s, 0]]), prev = new Map(), done = new Set(), heap = [[0, s]];
    function push(x) { heap.push(x); var i = heap.length - 1; while (i > 0) { var pa = (i - 1) >> 1; if (heap[pa][0] <= heap[i][0]) break; var tmp = heap[pa]; heap[pa] = heap[i]; heap[i] = tmp; i = pa; } }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (var i = 0; ;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          var tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
        }
      }
      return top;
    }
    while (heap.length) {
      var u = pop()[1];
      if (done.has(u)) continue;
      done.add(u);
      if (u === t) break;
      var du = dist.get(u);
      g.adj.get(u).forEach(function (w, v) {
        var nd = du + w;
        if (nd < (dist.has(v) ? dist.get(v) : Infinity)) {
          dist.set(v, nd); prev.set(v, u);
          var P = g.pos.get(v);
          push([nd + Math.sqrt((P[0] - T[0]) * (P[0] - T[0]) + (P[1] - T[1]) * (P[1] - T[1])), v]);
        }
      });
    }
    if (!dist.has(t)) return null;
    var path = [];
    for (var k = t; k !== undefined; k = prev.get(k)) path.unshift(k);
    return path;
  }
  // the walking parts of the ways shown, along the streets (the main way first); each one re-draws as it arrives
  var streetGen = 0;
  function streetWalks() {
    var me = loc.fix ? loc.fix.ll : null, pl = route && savedPlaces.find(route.placeId), gen = ++streetGen;
    if (!me || !pl) return;
    var jobs = [];
    route.ways.forEach(function (w) { w.legs.forEach(function (lg) { if (lg.kind === 'walk' && !lg.street) jobs.push({ w: w, lg: lg }); }); });
    jobs.reduce(function (pr, j) {
      return pr.then(function () {
        if (gen !== streetGen || !route || route.ways.indexOf(j.w) < 0) return null;
        var a = legLL(j.lg.from, me, pl), b = legLL(j.lg.to, me, pl);
        if (!a || !b) return null;
        return walkRoute(a, b).then(function (r) {
          if (!r || !route) return;
          var old = j.lg.sec;
          j.lg.street = true; j.lg.pts = r.pts; j.lg.m = r.m;
          // a change between two stops keeps Sofia's own walking time (the search planned the change with it);
          // from you and to the place, the time comes from the way along the streets
          if (j.lg.from < 0 || j.lg.to < 0) j.lg.sec = Math.max(0, Math.round(r.m / WALK_MS));
          j.w.walk += j.lg.sec - old;
          if (!j.w.rides) j.w.arr += j.lg.sec - old;   // walking only: arrives with the walk
          if (route.ways[0] === j.w) drawRoute();
          renderRoute();
        }, function (e) { walkInfo.fail++; walkInfo.err = String(e && e.message || e); });
      });
    }, Promise.resolve()).then(function () { renderDiag(); });
  }

