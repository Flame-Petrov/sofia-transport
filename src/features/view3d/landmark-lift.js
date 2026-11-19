  // Landmarks lift off (release 110). When the 3D map is zoomed out so far that only the landmark and monument
  // models stand (MapLibre zoom 12 up to where the buildings stand), a model under the mouse rises off the ground and
  // spins, and lands again facing the way it is mapped when the mouse leaves. On a touch screen a tap does the same,
  // and a second tap (on it, another model or the empty map) lands it. A small card above the model names it and
  // says a sentence or two about it (landmark-info.js). The fixed-model layer in bulgarian-houses.js draws each moving
  // model with its own turn and rise (poses()); landmarks.js reports the layer's projection, used here for picking.
  // See docs/3d-landmark-lift.md.
  var landmarkLift = (function () {
    var RISE_PX = 44;            // how high a model's foot rises on screen, at least
    var PICK_PAD_PX = 8;         // the pointer may be this far outside a model's outline on screen
    var GROW_PX = 110, GROW_MIN = 1.4, GROW_MAX = 7;   // while up a model grows to about this size on screen, within these factors
    var TURN_S = 3.2;            // seconds a turn while up
    var RISE_RATE = 6;           // spring rate of the rise, 1/s (critically damped: up in about a second)
    var SPIN_RATE = 2.4;         // how fast the spin gathers speed, 1/s
    var LAND_MIN = 0.8, LAND_MAX = 2.2;   // seconds a landing takes, by how far the model must still turn
    var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    var map = null, cont = null, card = null, blocked = null, raf = 0, last = 0;
    var states = new Map();      // site index -> { level, vel, angle, spin, riseM, grow, land }
    var hoverI = -1, tapI = -1, shownI = -1, mouseAt = null, pointer = 'mouse', recheck = false;

    function gateOpen() {
      if (!map) return false;
      var z = map.getZoom();
      return z >= landmarks.minZoom && z < VIEW3D_BUILDING_ZOOM - 1 && landmarks.awake();
    }

    // ---- picking: each drawn model's box (a cylinder up to its lifted top while it moves) on screen ----
    function project(M, x, y, z, w, h) {
      var cw = M[3] * x + M[7] * y + M[11] * z + M[15];
      if (cw <= 1e-9) return null;
      return [((M[0] * x + M[4] * y + M[8] * z + M[12]) / cw + 1) / 2 * w, (1 - (M[1] * x + M[5] * y + M[9] * z + M[13]) / cw) / 2 * h, cw];
    }
    // A point of the site in metres along its axis (u), to its left (v) and up (z), in Mercator units.
    function world(site, u, v, z) {
      var at = site._merc || (site._merc = maplibregl.MercatorCoordinate.fromLngLat(site.at)), unit = at.meterInMercatorCoordinateUnits();
      var b = site.b * Math.PI / 180, s = Math.sin(b), c = Math.cos(b);
      var ground = map && map.getTerrain() ? map.queryTerrainElevation(site.at) || 0 : 0;
      return [at.x + (u * s - v * c) * unit, at.y - (u * c + v * s) * unit, (z + ground) * unit];
    }
    function hull(points) {
      points.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
      var lower = [], upper = [];
      points.forEach(function (p) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); });
      for (var i = points.length - 1; i >= 0; i--) { var p = points[i]; while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
      return lower.slice(0, -1).concat(upper.slice(0, -1));
    }
    // A hull grown outwards by `pad` pixels, so a model only a dozen pixels across is still easy to point at.
    function padded(poly, pad) {
      if (poly.length < 3) return poly;
      var cx = 0, cy = 0;
      poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
      cx /= poly.length; cy /= poly.length;
      return poly.map(function (p) {
        var dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1;
        return [p[0] + dx / d * pad, p[1] + dy / d * pad, p[2]];
      });
    }
    function insideHull(poly, p) {
      if (poly.length < 3) return false;
      for (var i = 0; i < poly.length; i++) {
        var a = poly[i], b = poly[(i + 1) % poly.length];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
      }
      return true;
    }
    function outlineOnScreen(i, M, w, h) {
      var site = landmarks.sites[i];
      if (!site.box) landmarks.mesh(site);
      var box = site.box, st = states.get(i), pts = [], points3 = [];
      if (st) {   // moving: the whole circle it sweeps, from the ground to its lifted top
        var grown = scaleOf(st), r = grown * Math.max(Math.hypot(box[0], box[2]), Math.hypot(box[0], box[3]), Math.hypot(box[1], box[2]), Math.hypot(box[1], box[3]), 4);
        for (var k = 0; k < 12; k++) {
          var g = k * Math.PI / 6;
          points3.push([r * Math.cos(g), r * Math.sin(g), 0], [r * Math.cos(g), r * Math.sin(g), box[4] * grown + st.riseM * st.level]);
        }
      } else {
        [box[0], box[1]].forEach(function (u) { [box[2], box[3]].forEach(function (v) { points3.push([u, v, 0], [u, v, Math.max(box[4], 1)]); }); });
      }
      for (var j = 0; j < points3.length; j++) {
        var q = world(site, points3[j][0], points3[j][1], points3[j][2]), s = project(M, q[0], q[1], q[2], w, h);
        if (!s) return null;
        pts.push(s);
      }
      return { poly: padded(hull(pts), PICK_PAD_PX), depth: pts.reduce(function (d, p) { return Math.min(d, p[2]); }, Infinity) };
    }
    // The drawn site under a screen point, or -1. A site already moving wins over one behind it.
    function pick(p) {
      var f = landmarks.lastFrame();
      if (!gateOpen() || !f || f.map !== map) return -1;
      var c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight, best = -1, bestDepth = Infinity, keep = -1;
      landmarks.shown().forEach(function (i) {
        var o = outlineOnScreen(i, f.matrix, w, h);
        if (!o || !insideHull(o.poly, [p.x, p.y])) return;
        if (i === hoverI || i === tapI) keep = i;
        if (o.depth < bestDepth) { bestDepth = o.depth; best = i; }
      });
      return keep >= 0 ? keep : best;
    }

    // ---- motion ----
    // Pixels on screen per metre straight up at the site, from the layer's projection (horizontal as a floor, for a
    // camera looking straight down, where height barely shows).
    function scaleOf(st) { return 1 + (st.grow - 1) * Math.max(0, Math.min(1, st.level)); }
    // How high a site rises (metres) and how much it grows, from how big it looks now.
    function riseFor(i) {
      var site = landmarks.sites[i], f = landmarks.lastFrame(), box = site.box || [0, 0, 0, 0, 10], top = box[4];
      if (!f) return { rise: Math.max(30, top * 0.35), grow: 1 };
      var c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
      var a = world(site, 0, 0, 0), b = world(site, 0, 0, 10), e = world(site, 10, 0, 0);
      var pa = project(f.matrix, a[0], a[1], a[2], w, h), pb = project(f.matrix, b[0], b[1], b[2], w, h), pe = project(f.matrix, e[0], e[1], e[2], w, h);
      if (!pa || !pb || !pe) return { rise: Math.max(30, top * 0.35), grow: 1 };
      var up = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / 10, across = Math.hypot(pe[0] - pa[0], pe[1] - pa[1]) / 10;
      var looks = across * Math.max(box[1] - box[0], box[3] - box[2], top);
      return { rise: Math.max(RISE_PX / Math.max(up, across * 0.35, 1e-6), top * 0.35),
        grow: reduce ? 1 : Math.max(GROW_MIN, Math.min(GROW_MAX, GROW_PX / Math.max(looks, 1))) };
    }
    function liftOff(i) {
      if (i < 0) return;
      var st = states.get(i);
      if (!st) { var size = riseFor(i); st = { level: 0, vel: 0, angle: 0, spin: 0, riseM: size.rise, grow: size.grow, land: null }; states.set(i, st); }
      else if (st.land) {   // caught on its way down: carry on from where it is, at the speed it has
        var now = landing(st, 1 / 1e6);
        st.vel = now.levelVel; st.spin = now.spin; st.land = null;
      }
      landmarks.raise(map);   // its layer back on top of the style, over everything drawn since
      run();
    }
    function setDown(i) {
      var st = states.get(i);
      if (!st || st.land) return;
      var w = st.spin, turn = 2 * Math.PI, at = ((st.angle % turn) + turn) % turn;
      var ahead = turn - at;
      if (ahead < 1e-4) ahead = 0;
      if (ahead < w * LAND_MIN / 3 - 1e-6) ahead += turn;   // never slow so hard that it runs back
      var d = ahead;
      if (w < 0.5 && at > 1e-4 && at < ahead) d = -at;     // barely turning: go back the short way
      var T = Math.min(LAND_MAX, Math.max(LAND_MIN, w > 0.1 ? 2 * Math.abs(d) / w : LAND_MIN + Math.abs(d) / Math.PI));
      st.land = { t: 0, T: T, from: st.angle, d: d, w0: w, l0: st.level, v0: st.vel };
      run();
    }
    // Where a landing is after `dt` more seconds: Hermite curves from the current angle, speed, height and climb to
    // the next whole turn and the ground, both at rest. With d = w0 T / 2 the spin slows down evenly.
    function landing(st, dt) {
      var L = st.land, t = Math.min(L.T, L.t + dt), s = t / L.T, T = L.T;
      var h1 = s - 2 * s * s + s * s * s, h2 = 3 * s * s - 2 * s * s * s, h0 = 1 - h2;
      var d1 = (1 - 4 * s + 3 * s * s) / T, d2 = (6 * s - 6 * s * s) / T;
      return { t: t, done: s >= 1, angle: L.from + L.w0 * T * h1 + L.d * h2, spin: L.w0 * T * d1 + L.d * d2,
        level: Math.max(0, L.l0 * h0 + L.v0 * T * h1), levelVel: -L.l0 * d2 + L.v0 * T * d1 };
    }
    function step(dt) {
      var target = reduce ? 0 : 2 * Math.PI / TURN_S;
      states.forEach(function (st, i) {
        if (st.land) {
          var now = landing(st, dt);
          st.land.t = now.t; st.angle = now.angle; st.spin = now.spin; st.level = now.level; st.vel = now.levelVel;
          if (now.done) states.delete(i);
          return;
        }
        for (var left = dt; left > 1e-6; left -= 1 / 120) {
          var h = Math.min(left, 1 / 120);
          st.vel += (RISE_RATE * RISE_RATE * (1 - st.level) - 2 * RISE_RATE * st.vel) * h;
          st.level += st.vel * h;
          st.spin += (target - st.spin) * (1 - Math.exp(-SPIN_RATE * h));
          st.angle += st.spin * h;
        }
      });
    }

    // ---- the card ----
    function info(site) {
      var row = (typeof landmarkInfo !== 'undefined' && (landmarkInfo[site.key] || landmarkInfo[site.n])) || null, k = LANG === 'bg' ? 1 : 0;
      var kinds = { stadium: 'Stadium', university: 'University', mall: 'Shopping centre', monument: 'Monument' };
      return { name: row && row.name ? row.name[k] : feedText(site.n),
        kind: row && row.kind ? row.kind[k] : t(kinds[site.k] || 'Landmark'),
        text: row && row.text ? row.text[k] : '' };
    }
    function showCard(i) {
      if (!card) return;
      if (i !== shownI) {
        shownI = i;
        if (i >= 0) {
          var about = info(landmarks.sites[i]);
          card.querySelector('.lm-name').textContent = about.name;
          card.querySelector('.lm-kind').textContent = about.kind;
          var text = card.querySelector('.lm-text');
          text.textContent = about.text; text.hidden = !about.text;
          card.hidden = false;
          void card.offsetWidth;   // start the fade from the hidden state
        }
        card.classList.toggle('on', i >= 0);
      }
      if (i >= 0) placeCard(i);
    }
    // Above the model's lifted top, kept inside the map; under its foot when there is no room above.
    function placeCard(i) {
      var f = landmarks.lastFrame(), st = states.get(i), site = landmarks.sites[i];
      if (!f || !site.box) return;
      var c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight, rise = st ? st.riseM * st.level : 0;
      var top = world(site, 0, 0, site.box[4] * (st ? scaleOf(st) : 1) + rise), foot = world(site, 0, 0, 0);
      var a = project(f.matrix, top[0], top[1], top[2], w, h), b = project(f.matrix, foot[0], foot[1], foot[2], w, h);
      if (!a || !b) return;
      var cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, y = a[1] - gap - ch;
      if (y < 8) y = Math.min(h - ch - 8, b[1] + gap);
      var x = Math.max(8, Math.min(w - cw - 8, a[0] - cw / 2));
      card.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }

    // ---- the frame loop: runs while anything moves or the card is up ----
    function run() { if (!raf && map) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    function frame(now) {
      raf = 0;
      if (!map) return;
      var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (!gateOpen()) { hoverI = tapI = -1; states.forEach(function (_, i) { setDown(i); }); }
      if (recheck && mouseAt) { recheck = false; hoverTo(mouseAt); }
      var focus = hoverI >= 0 ? hoverI : tapI;
      if (focus >= 0 && landmarks.shown().indexOf(focus) < 0) { if (hoverI === focus) hoverI = -1; if (tapI === focus) tapI = -1; setDown(focus); focus = -1; }
      step(dt);
      showCard(focus);
      coverMarkers();
      if (states.size) map.triggerRepaint();
      if (states.size || focus >= 0) raf = requestAnimationFrame(frame);
    }

    // HTML markers (metro stations, saved places, the tracked vehicle) sit above the map's canvas: those under a
    // model in the air fade out, so the model covers them like everything else on the map.
    function coverMarkers() {
      if (!cont) return;
      var f = landmarks.lastFrame(), hulls = [];
      if (f) states.forEach(function (st, i) {
        if (st.level < 0.05) return;
        var site = landmarks.sites[i], box = site.box, c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight, pts = [];
        var grown = scaleOf(st), r = grown * Math.max(Math.hypot(box[0], box[2]), Math.hypot(box[0], box[3]), Math.hypot(box[1], box[2]), Math.hypot(box[1], box[3]), 4);
        var low = st.riseM * st.level, high = low + box[4] * grown;
        for (var k = 0; k < 12; k++) {
          var g = k * Math.PI / 6;
          [low, high].forEach(function (z) {
            var q = world(site, r * Math.cos(g), r * Math.sin(g), z), s = project(f.matrix, q[0], q[1], q[2], w, h);
            if (s) pts.push(s);
          });
        }
        if (pts.length > 2) hulls.push(hull(pts));
      });
      var marks = cont.querySelectorAll('.maplibregl-marker'), at = cont.getBoundingClientRect();
      for (var m = 0; m < marks.length; m++) {
        var el = marks[m], under = false;
        if (hulls.length) {
          var b = el.getBoundingClientRect(), p = [b.left + b.width / 2 - at.left, b.top + b.height / 2 - at.top];
          under = hulls.some(function (poly) { return insideHull(poly, p); });
        }
        if (el.classList.contains('lm-under') !== under) el.classList.toggle('lm-under', under);
      }
    }

    // ---- input ----
    // A vehicle dot or stop right under the pointer wins over a model that is still on the ground; a model already up
    // stays up while the pointer is on it, even when a vehicle glides under it.
    function hoverTo(p) {
      var i = p ? pick(p) : -1;
      if (i >= 0 && i !== hoverI && blocked && blocked(p)) i = -1;
      if (i === hoverI) return;
      if (hoverI >= 0 && hoverI !== tapI) setDown(hoverI);
      hoverI = i;
      if (cont) cont.style.cursor = i >= 0 ? 'pointer' : '';
      if (i >= 0) liftOff(i);
      run();
    }
    function onMouseMove(e) {
      if (pointer !== 'mouse' || (e.originalEvent && e.originalEvent.buttons)) return;
      mouseAt = e.point; recheck = true; run();
    }
    function onMouseOut() { mouseAt = null; recheck = false; hoverTo(null); }
    function onMove() { if (mouseAt) { recheck = true; run(); } else if (tapI >= 0) run(); }
    function onPointerDown(e) { pointer = e.pointerType || 'mouse'; if (pointer !== 'mouse' && hoverI >= 0) hoverTo(null); }
    // A tap on the 3D map, after vehicles and stops had their turn. True when it was the lift's.
    function tap(p) {
      if (!map) return false;
      var i = pick(p);
      if (pointer === 'mouse') return i >= 0;   // the hover already shows it; a click on it does nothing else
      if (i >= 0 && i === tapI) { setDown(i); tapI = -1; run(); return true; }
      if (i >= 0) { if (tapI >= 0) setDown(tapI); tapI = i; liftOff(i); return true; }
      if (tapI >= 0) { setDown(tapI); tapI = -1; run(); return true; }   // a tap beside it only sets it down
      return false;
    }

    function attach(m3, opts) {
      detach();
      map = m3; cont = m3.getCanvasContainer(); blocked = opts && opts.blocked;
      card = document.createElement('div');
      card.className = 'lm-card'; card.hidden = true;
      card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
      card.innerHTML = '<b class="lm-name"></b><span class="lm-kind"></span><p class="lm-text"></p>';
      card.addEventListener('transitionend', function () { if (!card.classList.contains('on')) card.hidden = true; });
      m3.getContainer().appendChild(card);
      m3.on('mousemove', onMouseMove);
      m3.on('mouseout', onMouseOut);
      m3.on('move', onMove);
      cont.addEventListener('pointerdown', onPointerDown, true);
    }
    function detach() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (map) {
        try { map.off('mousemove', onMouseMove); map.off('mouseout', onMouseOut); map.off('move', onMove); } catch (e) {}
        if (cont) {
          cont.removeEventListener('pointerdown', onPointerDown, true); cont.style.cursor = '';
          Array.prototype.forEach.call(cont.querySelectorAll('.lm-under'), function (el) { el.classList.remove('lm-under'); });
        }
      }
      if (card) card.remove();
      map = cont = card = blocked = null;
      states.clear(); hoverI = tapI = shownI = -1; mouseAt = null;
    }
    // For the layer: site index -> { angle (radians), rise (metres), scale } of every moving model, or null.
    function poses() {
      if (!states.size) return null;
      var out = new Map();
      states.forEach(function (st, i) { out.set(i, { angle: st.angle, rise: st.riseM * st.level, scale: scaleOf(st) }); });
      return out;
    }
    return { attach: attach, detach: detach, tap: tap, poses: poses, pick: pick,
      state: function () { return { hover: hoverI, tap: tapI, card: shownI, moving: Array.from(states.keys()), gate: gateOpen() }; },
      _landing: landing, _setDown: setDown, _states: states };
  })();
