  // Parametric models of Sofia's monuments, statues, busts and memorials. Each site of kind `monument`
  // in landmark-data.js carries a spec `s` (see docs/3d-landmarks.md#monuments): a form, a pose, a
  // pedestal, heights and materials, researched from photos and sources or read from OpenStreetMap tags
  // by tools/landmark_data.py. The front of every model faces +u, which the generator turns toward the
  // monument's facing or the nearest street or path.
  (function () {
    var C = landmarks.colors;
    var MATERIAL = {
      bronze: [0.36, 0.33, 0.25], dark_bronze: [0.22, 0.21, 0.18], green_bronze: [0.35, 0.50, 0.43], gilded: [0.86, 0.68, 0.22],
      white_stone: [0.90, 0.88, 0.82], limestone: [0.84, 0.79, 0.68], granite: [0.60, 0.60, 0.58], dark_granite: [0.27, 0.26, 0.26],
      marble: [0.94, 0.93, 0.90], concrete: [0.72, 0.71, 0.68], steel: [0.70, 0.72, 0.74], painted: [0.75, 0.30, 0.22]
    };
    function paint(name, fallback, hex) {
      if (hex && /^#[0-9a-f]{6}$/i.test(hex)) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
      return MATERIAL[name] || MATERIAL[fallback] || MATERIAL.bronze;
    }
    function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }
    function hash(n) { var h = Math.sin(n * 12.9898) * 43758.5453; return h - Math.floor(h); }

    // ---- figures, built standing at the origin facing +x (forward), y to the left, z up ----
    // A human figure `h` metres tall. Poses: stand, stride, arm, robe, soldier, book, sword, child, dancer, sport, rider, seated.
    function figure(k, h, pose, color) {
      var dark = shade(color, 0.85), seated = pose === 'seated', rider = pose === 'rider';
      var hip = seated || rider ? 0.3 * h : 0.5 * h, lift = seated ? -0.2 * h : rider ? -0.2 * h : 0;
      var shoulder = 0.81 * h + lift, side = 0.12 * h;
      // Legs, or a robe that reaches the ground.
      if (pose === 'robe') {
        k.tube(0, 0, 0.16 * h, 0.105 * h, 0, 0.55 * h, 8, color, { cap: true });
      } else if (seated) {
        [-1, 1].forEach(function (s) {
          k.rod([0, s * 0.06 * h, hip], [0.24 * h, s * 0.07 * h, hip + 0.02 * h], 0.055 * h, 0.045 * h, 6, color);
          k.rod([0.24 * h, s * 0.07 * h, hip + 0.02 * h], [0.27 * h, s * 0.07 * h, 0.02 * h], 0.045 * h, 0.035 * h, 6, color);
        });
      } else if (rider) {
        [-1, 1].forEach(function (s) {
          k.rod([0, s * 0.08 * h, hip], [0.12 * h, s * 0.2 * h, hip - 0.12 * h], 0.05 * h, 0.042 * h, 6, color);
          k.rod([0.12 * h, s * 0.2 * h, hip - 0.12 * h], [0.08 * h, s * 0.2 * h, hip - 0.32 * h], 0.042 * h, 0.034 * h, 6, color);
        });
      } else {
        var stride = pose === 'stride' || pose === 'soldier' || pose === 'sport' ? 0.09 * h : pose === 'dancer' ? 0.14 * h : 0.02 * h;
        [-1, 1].forEach(function (s) {
          var foot = [s * stride, s * 0.065 * h, 0.03 * h];
          k.rod([0, s * 0.055 * h, hip], foot, 0.055 * h, 0.035 * h, 6, color);
          k.box(foot[0] - 0.03 * h, foot[0] + 0.09 * h, foot[1] - 0.03 * h, foot[1] + 0.03 * h, 0, 0.045 * h, dark);
        });
        if (pose === 'stand' || pose === 'book' || pose === 'arm' || pose === 'sword') {
          // a coat down to the knees
          k.tube(0, 0, 0.13 * h, 0.11 * h, 0.3 * h, 0.52 * h, 8, color);
        }
      }
      // Body, shoulders, neck and head.
      k.rod([0, 0, hip - 0.02 * h], [0, 0, shoulder], 0.1 * h, 0.12 * h, 8, color, true);
      k.rod([0, -side, shoulder - 0.01 * h], [0, side, shoulder - 0.01 * h], 0.05 * h, 0.05 * h, 6, color, true);
      k.rod([0, 0, shoulder], [0, 0, shoulder + 0.06 * h], 0.035 * h, 0.035 * h, 6, color);
      k.ball([0.005 * h, 0, shoulder + 0.12 * h], 0.065 * h, color, 0.075 * h, 8, 4);
      // Arms: shoulder, elbow, hand.
      function arm(s, elbow, hand) {
        k.rod([0, s * side, shoulder - 0.01 * h], elbow, 0.042 * h, 0.036 * h, 6, color);
        k.rod(elbow, hand, 0.036 * h, 0.03 * h, 6, color);
        k.ball(hand, 0.032 * h, color, 0.032 * h, 5, 3);
      }
      var downL = [[0.01 * h, 0.15 * h, shoulder - 0.19 * h], [0.04 * h, 0.15 * h, shoulder - 0.37 * h]];
      var downR = [[0.01 * h, -0.15 * h, shoulder - 0.19 * h], [0.04 * h, -0.15 * h, shoulder - 0.37 * h]];
      if (pose === 'arm' || pose === 'dancer') {
        arm(-1, [0.04 * h, -0.19 * h, shoulder + 0.14 * h], [0.08 * h, -0.22 * h, shoulder + 0.3 * h]);
        arm(1, pose === 'dancer' ? [0.02 * h, 0.22 * h, shoulder + 0.02 * h] : downL[0], pose === 'dancer' ? [0.04 * h, 0.36 * h, shoulder + 0.1 * h] : downL[1]);
      } else if (pose === 'book' || seated) {
        arm(1, [0.06 * h, 0.15 * h, shoulder - 0.2 * h], [0.2 * h, 0.08 * h, shoulder - 0.24 * h]);
        arm(-1, downR[0], seated ? [0.2 * h, -0.08 * h, shoulder - 0.27 * h] : downR[1]);
        if (pose === 'book') k.box(0.17 * h, 0.27 * h, 0.02 * h, 0.13 * h, shoulder - 0.27 * h, shoulder - 0.23 * h, [0.30, 0.27, 0.22]);
      } else if (pose === 'sword') {
        arm(-1, [0.08 * h, -0.17 * h, shoulder - 0.17 * h], [0.18 * h, -0.17 * h, shoulder - 0.25 * h]);
        k.rod([0.18 * h, -0.17 * h, shoulder - 0.25 * h], [0.34 * h, -0.17 * h, 0.05 * h], 0.012 * h, 0.006 * h, 4, dark);
        arm(1, downL[0], downL[1]);
      } else if (pose === 'soldier') {
        arm(-1, [0.05 * h, -0.16 * h, shoulder - 0.15 * h], [0.1 * h, -0.17 * h, shoulder - 0.05 * h]);
        k.rod([0.1 * h, -0.19 * h, 0.05 * h], [0.11 * h, -0.19 * h, shoulder + 0.25 * h], 0.015 * h, 0.012 * h, 4, dark);
        arm(1, downL[0], downL[1]);
      } else if (rider) {
        arm(-1, [0.12 * h, -0.13 * h, shoulder - 0.17 * h], [0.26 * h, -0.08 * h, shoulder - 0.25 * h]);
        arm(1, [0.12 * h, 0.13 * h, shoulder - 0.17 * h], [0.26 * h, 0.08 * h, shoulder - 0.25 * h]);
      } else {
        arm(-1, downR[0], downR[1]); arm(1, downL[0], downL[1]);
      }
    }
    // A bust `h` metres tall: chest and shoulders, neck and head.
    function bust(k, h, color) {
      k.box(-0.13 * h, 0.13 * h, -0.3 * h, 0.3 * h, 0, 0.32 * h, color);
      k.rod([0, -0.3 * h, 0.36 * h], [0, 0.3 * h, 0.36 * h], 0.08 * h, 0.08 * h, 6, color, true);
      k.box(-0.12 * h, 0.12 * h, -0.22 * h, 0.22 * h, 0.32 * h, 0.44 * h, color);
      k.rod([0, 0, 0.42 * h], [0, 0, 0.56 * h], 0.08 * h, 0.08 * h, 6, color);
      k.ball([0.01 * h, 0, 0.72 * h], 0.15 * h, color, 0.18 * h, 8, 5);
    }
    // A horse `h` metres to the withers' top, nose toward +x; one forehoof raised when `rearing`.
    function horse(k, h, color, rearing) {
      var s = h / 1.6, dark = shade(color, 0.8);
      k.rod([-0.75 * s, 0, 1.3 * s], [0.65 * s, 0, 1.4 * s], 0.34 * s, 0.32 * s, 8, color, true);
      k.ball([0.65 * s, 0, 1.38 * s], 0.33 * s, color, 0.34 * s, 8, 4);
      k.ball([-0.75 * s, 0, 1.3 * s], 0.34 * s, color, 0.34 * s, 8, 4);
      k.rod([0.7 * s, 0, 1.5 * s], [1.0 * s, 0, 2.0 * s], 0.2 * s, 0.15 * s, 6, color);
      k.rod([1.0 * s, 0, 2.02 * s], [1.36 * s, 0, 1.78 * s], 0.13 * s, 0.08 * s, 6, color, true);
      [-1, 1].forEach(function (y) {
        k.rod([0.98 * s, y * 0.06 * s, 2.1 * s], [0.96 * s, y * 0.07 * s, 2.28 * s], 0.035 * s, 0.01 * s, 4, color);
        k.rod([-0.6 * s, y * 0.18 * s, 1.1 * s], [-0.68 * s, y * 0.19 * s, 0.0], 0.1 * s, 0.06 * s, 6, color);
        if (rearing && y > 0) {
          k.rod([0.55 * s, y * 0.18 * s, 1.15 * s], [0.85 * s, y * 0.2 * s, 0.85 * s], 0.09 * s, 0.07 * s, 6, color);
          k.rod([0.85 * s, y * 0.2 * s, 0.85 * s], [0.82 * s, y * 0.2 * s, 0.55 * s], 0.07 * s, 0.06 * s, 6, color);
        } else k.rod([0.55 * s, y * 0.18 * s, 1.15 * s], [0.6 * s, y * 0.19 * s, 0.0], 0.09 * s, 0.06 * s, 6, color);
      });
      k.rod([-1.02 * s, 0, 1.4 * s], [-1.22 * s, 0, 0.75 * s], 0.08 * s, 0.04 * s, 5, dark);
      k.rod([0.75 * s, 0, 1.9 * s], [0.55 * s, 0, 1.55 * s], 0.06 * s, 0.03 * s, 4, dark);   // mane
      return 1.62 * s;   // the saddle's height
    }
    // Animals by kind, about `h` metres tall (or long, lying), nose toward +x.
    var BEASTS = {
      lion: { body: [1.5, 0.36], legs: 0.55, neck: 0.3, head: 0.24, mane: 0.42 }, bear: { body: [1.4, 0.45], legs: 0.4, neck: 0.15, head: 0.26 },
      deer: { body: [1.1, 0.24], legs: 0.8, neck: 0.5, head: 0.14, antlers: true }, dog: { body: [0.9, 0.2], legs: 0.45, neck: 0.25, head: 0.15 },
      horse: { body: [1.4, 0.32], legs: 1.0, neck: 0.55, head: 0.16 }, bull: { body: [1.6, 0.42], legs: 0.6, neck: 0.15, head: 0.24, horns: true },
      cat: { body: [0.6, 0.13], legs: 0.25, neck: 0.12, head: 0.1 }, otter: { body: [0.8, 0.12], legs: 0.1, neck: 0.1, head: 0.09 },
      squirrel: { body: [0.4, 0.12], legs: 0.12, neck: 0.1, head: 0.08, tail: true }, other: { body: [1.0, 0.25], legs: 0.45, neck: 0.25, head: 0.15 }
    };
    function animal(k, kind, h, color, lying) {
      if (kind === 'penguin') {
        k.ball([0, 0, h * 0.45], h * 0.24, color, h * 0.45, 8, 5); k.ball([0.02 * h, 0, h * 0.94], h * 0.12, shade(color, 0.6), h * 0.1, 6, 3);
        k.rod([0.12 * h, 0, h * 0.92], [0.24 * h, 0, h * 0.9], h * 0.03, 0.002, 4, [0.85, 0.6, 0.2]);
        return;
      }
      if (kind === 'fish') {
        k.ball([0, 0, h * 0.5], h * 0.5, color, h * 0.22, 8, 4);
        k.rod([-h * 0.45, 0, h * 0.5], [-h * 0.8, 0, h * 0.62], h * 0.04, h * 0.18, 4, color);
        return;
      }
      var b = BEASTS[kind] || BEASTS.other, scale = h / (b.legs + b.body[1] * 2 + b.neck * 0.6 + b.head);
      var L = b.body[0] * scale, R = b.body[1] * scale, legs = (lying ? 0.02 : b.legs) * scale, z = legs + R;
      k.rod([-L / 2, 0, z], [L / 2, 0, z + 0.05 * L], R, R * 0.95, 8, color, true);
      k.ball([L / 2, 0, z + 0.05 * L], R, color, R, 8, 4); k.ball([-L / 2, 0, z], R, color, R, 8, 4);
      var neckTop = [L / 2 + b.neck * scale * 0.5, 0, z + R + b.neck * scale * 0.7], head = b.head * scale;
      k.rod([L / 2, 0, z + R * 0.3], neckTop, R * 0.55, R * 0.4, 6, color);
      k.ball([neckTop[0] + head * 0.4, 0, neckTop[2]], head, color, head * 0.85, 7, 4);
      if (b.mane) k.ball([neckTop[0] - head * 0.1, 0, neckTop[2] - head * 0.2], b.mane * scale, shade(color, 0.85), b.mane * scale * 1.05, 8, 4);
      if (b.antlers) [-1, 1].forEach(function (y) {
        k.rod([neckTop[0], y * head * 0.4, neckTop[2] + head * 0.6], [neckTop[0] - head, y * head * 2, neckTop[2] + head * 3], head * 0.12, head * 0.05, 4, color);
      });
      if (b.horns) [-1, 1].forEach(function (y) {
        k.rod([neckTop[0] + head * 0.2, y * head * 0.6, neckTop[2] + head * 0.5], [neckTop[0] + head * 0.6, y * head * 1.5, neckTop[2] + head * 1.2], head * 0.12, head * 0.03, 4, MATERIAL.white_stone);
      });
      if (b.tail) k.ball([-L / 2 - R * 0.9, 0, z + R * 1.3], R * 0.75, color, R * 1.4, 6, 4);
      else k.rod([-L / 2 - R * 0.6, 0, z + R * 0.3], [-L / 2 - R * 1.6, 0, Math.max(0.05, z - R * 1.2)], R * 0.12, R * 0.06, 4, color);
      if (lying) [-1, 1].forEach(function (y) { k.rod([L / 2 - R * 0.2, y * R * 0.6, R * 0.26], [L / 2 + R * 1.6, y * R * 0.6, R * 0.23], R * 0.25, R * 0.22, 5, color, true); });
      else [[L / 2 - R * 0.3, 1], [L / 2 - R * 0.3, -1], [-L / 2 + R * 0.3, 1], [-L / 2 + R * 0.3, -1]].forEach(function (p) {
        k.rod([p[0], p[1] * R * 0.55, z], [p[0] + 0.02, p[1] * R * 0.6, 0], R * 0.28, R * 0.18, 5, color);
      });
    }
    function bird(k, h, color, wings) {
      k.ball([0, 0, h * 0.45], h * 0.3, color, h * 0.22, 8, 4);
      k.ball([h * 0.3, 0, h * 0.65], h * 0.13, color, h * 0.13, 6, 3);
      k.rod([h * 0.4, 0, h * 0.64], [h * 0.55, 0, h * 0.6], h * 0.04, 0.002, 4, shade(color, 0.7));
      if (wings) [-1, 1].forEach(function (y) {
        k.tri([h * 0.1, y * h * 0.15, h * 0.5], [-h * 0.2, y * h * 0.15, h * 0.5], [-h * 0.1, y * h * 0.9, h * 0.95], color, [0, 0, 0]);
      });
      k.tri([-h * 0.25, 0.05 * h, h * 0.45], [-h * 0.25, -0.05 * h, h * 0.45], [-h * 0.6, 0, h * 0.35], color, [0, 0, h]);
    }

    // ---- pedestals: return the height they reach ----
    function pedestal(k, type, h, w, d, color, seed) {
      var trim = shade(color, 1.08);
      if (!type || type === 'none' || h <= 0) return 0;
      if (type === 'low') { k.box(-w / 2, w / 2, -d / 2, d / 2, 0, h, color); return h; }
      if (type === 'rock') { k.rock(0, 0, w * 1.15, d * 1.15, h, color, seed); return h * 0.85; }
      if (type === 'herm') {
        var a = Math.min(w, d) * 0.5;
        k.box(-a * 0.75, a * 0.75, -a * 0.75, a * 0.75, 0, 0.18, color);
        k.box(-a / 2, a / 2, -a / 2, a / 2, 0.18, h - 0.12, color);
        k.box(-a * 0.62, a * 0.62, -a * 0.62, a * 0.62, h - 0.12, h, trim);
        return h;
      }
      if (type === 'stepped') {
        var steps = 3, rise = Math.min(0.25, h * 0.15);
        for (var i = 0; i < steps; i++) k.box(-w / 2 - (steps - i) * 0.45, w / 2 + (steps - i) * 0.45, -d / 2 - (steps - i) * 0.45, d / 2 + (steps - i) * 0.45, i * rise, (i + 1) * rise, color);
        k.box(-w / 2, w / 2, -d / 2, d / 2, steps * rise, h - 0.2, color);
        k.box(-w / 2 - 0.1, w / 2 + 0.1, -d / 2 - 0.1, d / 2 + 0.1, h - 0.2, h, trim);
        return h;
      }
      // block and tall: a base course, the die and a cornice
      var base = Math.min(0.35, h * 0.15);
      k.box(-w / 2 - 0.15, w / 2 + 0.15, -d / 2 - 0.15, d / 2 + 0.15, 0, base, color);
      k.box(-w / 2, w / 2, -d / 2, d / 2, base, h - 0.18, color);
      k.box(-w / 2 - 0.1, w / 2 + 0.1, -d / 2 - 0.1, d / 2 + 0.1, h - 0.18, h, trim);
      if (type === 'tall') k.box(w / 2 + 0.01, w / 2 + 0.02, -d * 0.3, d * 0.3, h * 0.45, h * 0.7, shade(color, 0.55));   // an inscription plate
      return h;
    }

    // A small figure or object standing on top of a column, pylon or obelisk.
    function topper(k, kind, z, size, color) {
      if (kind === 'figure') k.placed(0, 0, z, 0, size, function (q) { figure(q, 1, 'arm', color); });
      else if (kind === 'lion') k.placed(-size * 0.3, 0, z, 0, size, function (q) { animal(q, 'lion', 0.7, color, true); });
      else if (kind === 'eagle') k.placed(0, 0, z, 0, size, function (q) { bird(q, 0.8, color, true); });
      else if (kind === 'star') { k.rod([0, -size * 0.35, z + size * 0.4], [0, size * 0.35, z + size * 0.4], size * 0.08, size * 0.08, 4, [0.75, 0.15, 0.12]); k.rod([0, 0, z], [0, 0, z + size * 0.8], size * 0.08, size * 0.08, 4, [0.75, 0.15, 0.12]); }
      else if (kind === 'cross') k.cross(0, 0, z, size, color);
    }

    // ---- the monument builder ----
    landmarks.define('monument', function (k, ring, site) {
      var s = site.s || {}, seed = hash(site.at[0] * 1e4 + site.at[1] * 1e5);
      var mat = paint(s.material, 'bronze', s.color), pmat = paint(s.pedestal_material, 'granite');
      var form = s.form || 'statue', pose = s.pose || 'stand';
      var fh = +s.figure_h || 0, ph = s.pedestal_h !== undefined ? +s.pedestal_h : -1, total = +s.total_h || 0;
      var w = +s.width || 0, d = +s.depth || 0;
      function heights(defFigure, defPedestal) {
        if (!fh) fh = total && ph >= 0 ? Math.max(0.5, total - ph) : total ? total * (defFigure / (defFigure + defPedestal)) : defFigure;
        if (ph < 0) ph = total ? Math.max(0, total - fh) : defPedestal;
      }
      var top;
      function has(f) { return (s.features || []).indexOf(f) >= 0; }
      // For shafts (obelisk, column, pylon) a pedestal_h above 1.5 m is the shaft itself; the base stays low.
      var base = ph >= 0 && ph <= 1.5 ? ph : -1;
      // A lying lion and an eternal flame in front of a wall, stele or obelisk.
      function forecourt(at) {
        if (has('lion')) k.placed(at + 1.4, 0, 0, Math.PI / 2, 1, function (q) { animal(q, 'lion', 1.1, MATERIAL.dark_bronze, true); });
        if (has('flame')) k.placed(at + (has('lion') ? 3.4 : 1.6), 0, 0, 0, 1, function (q) {
          q.tube(0, 0, 0.9, 0.9, 0, 0.25, 12, MATERIAL.dark_granite, { cap: true });
          q.tube(0, 0, 0.6, 0.7, 0.25, 0.45, 12, MATERIAL.dark_bronze);
          [[0, 0, 0.7], [0.2, 0.12, 0.45], [-0.18, -0.1, 0.5]].forEach(function (f) { q.tube(f[0], f[1], 0.2, 0, 0.4, 0.4 + f[2], 6, [0.98, 0.55, 0.12]); });
        });
      }
      switch (form) {
        case 'statue': case 'seated': case 'equestrian': case 'group': {
          heights(form === 'equestrian' ? 4 : form === 'seated' ? 1.8 : 2.6, form === 'equestrian' ? 3.5 : 2);
          var figures = form === 'group' ? Math.max(2, Math.min(8, +s.figures || 3)) : 1;
          // pw runs across the front (v), pd front to back (u); a horse stands along u.
          var naturalW = form === 'equestrian' ? Math.max(0.8, fh * 0.42) : form === 'group' ? Math.max(1.6, fh * 0.45 * figures) : Math.max(1, fh * 0.42);
          var naturalD = form === 'equestrian' ? Math.max(1.2, fh * 1.0) : Math.max(1, fh * 0.42);
          var pw = w || naturalW, pd = d || naturalD, lift = 0;
          if (w && w > naturalW * 1.8 && form !== 'group') {
            // The mapped or researched footprint is a plaza or stepped platform: draw it low, with a pedestal of the usual size on it.
            k.box(-(d || w) / 2, (d || w) / 2, -w / 2, w / 2, 0, 0.35, pmat);
            pw = naturalW; pd = naturalD; lift = 0.35;
          }
          if (form === 'equestrian' && !w) pd = Math.max(pd, naturalD);
          k.placed(0, 0, lift, 0, 1, function (q) { top = lift + pedestal(q, s.pedestal || (ph > fh ? 'tall' : 'block'), Math.max(0, ph - lift), pd, pw, pmat, seed); });
          if (form === 'equestrian') {
            k.placed(0, 0, top, 0, 1, function (q) {
              var horseH = fh * 0.55, saddle = horse(q, horseH, mat, (s.features || []).indexOf('rearing') >= 0 || seed > 0.5);
              q.placed(-0.05 * fh, 0, saddle - fh * 0.12, 0, 1, function (r) { figure(r, fh * 0.5, 'rider', mat); });
            });
          } else if (form === 'seated') {
            k.box(-0.18 * fh / 0.7, 0.08 * fh / 0.7, -0.17 * fh / 0.7, 0.17 * fh / 0.7, top, top + 0.27 * fh / 0.7, shade(mat, 0.9));
            k.placed(0, 0, top, 0, 1, function (q) { figure(q, fh / 0.7, 'seated', mat); });
          } else if (form === 'group') {
            for (var i = 0; i < figures; i++) {
              var across = (i - (figures - 1) / 2) * Math.min(0.75, pw / figures) * 1.0, h = fh * (0.88 + 0.12 * hash(i + seed * 10));
              var poses = ['stand', 'stride', 'arm', 'soldier', 'robe'];
              var ps = i === Math.floor(figures / 2) ? (s.pose || 'arm') : poses[Math.floor(hash(i * 3 + seed * 7) * poses.length)];
              k.placed((i % 2) * -0.3, across, top, (hash(i + seed) - 0.5) * 0.5, 1, function (q) { figure(q, h, ps, mat); });
            }
          } else {
            k.placed(0, 0, top, 0, 1, function (q) { figure(q, fh, pose, mat); });
          }
          if ((s.features || []).indexOf('lion') >= 0) k.placed(pw * 0.2, 0, 0, 0, 1, function (q) { animal(q, 'lion', 1.1, mat, true); });
          break;
        }
        case 'bust': case 'head': {
          heights(form === 'head' ? 0.6 : 0.85, 1.6);
          var pwb = Math.max(0.55, fh * 0.75), slab = w > pwb * 2.5 ? 0.3 : 0;
          if (slab) k.box(-(d || w) / 2, (d || w) / 2, -w / 2, w / 2, 0, slab, pmat);
          else if (w) pwb = w;
          k.placed(0, 0, slab, 0, 1, function (q) { top = slab + pedestal(q, s.pedestal || 'herm', Math.max(0, ph - slab), pwb, slab ? pwb : (d || pwb), pmat, seed); });
          if (form === 'head') k.ball([0, 0, top + fh * 0.5], fh * 0.38, mat, fh * 0.5, 8, 5);
          else k.placed(0, 0, top, 0, 1, function (q) { bust(q, fh, mat); });
          break;
        }
        case 'obelisk': {
          // `width` and `depth` here are the whole monument's footprint: a low platform when it is wider than the shaft.
          var oh = total || 6, ob = Math.max(0.8, Math.min(oh * 0.12, w ? w / 2 : 99)), plaza = w > ob * 3;
          if (plaza) k.box(-(d || w) / 2, (d || w) / 2, -w / 2, w / 2, 0, 0.5, pmat);
          top = (plaza ? 0.5 : 0) + pedestal(k, s.pedestal || 'stepped', base >= 0 ? base : Math.min(1.2, oh * 0.12), ob * 1.7, ob * 1.7, pmat, seed);
          var shaft = oh - top - ob * 0.6;
          var stone = fh && fh < oh / 3 ? pmat : mat;
          k.tube(0, 0, ob * 0.7, ob * 0.5, top, top + shaft, 4, stone, { turn: Math.PI / 4 });
          k.tube(0, 0, ob * 0.5, 0, top + shaft, oh, 4, stone, { turn: Math.PI / 4 });
          k.windowsU(ob * 0.5 + 0.02, -ob * 0.25, ob * 0.25, top + shaft * 0.1, top + shaft * 0.25, 1, 1, 1, shade(stone, 0.5));
          if (has('star')) k.rod([ob * 0.62, 0, top + shaft * 0.72], [ob * 0.66, 0, top + shaft * 0.72], ob * 0.3, ob * 0.3, 5, [0.70, 0.16, 0.13], true);
          // A figure group at the foot (Bratska Mogila's partisans) and low walls to both sides.
          if (fh && fh < oh / 3) {
            var foot = ob * 1.4;
            k.box(foot - 0.6, foot + 2.2, -2.2, 2.2, 0, 1.2, pmat);
            [-0.7, 0.7].forEach(function (y, i) { k.placed(foot + 0.8, y, 1.2, 0, 1, function (q) { figure(q, fh * (i ? 0.94 : 1), i ? 'robe' : 'arm', mat); }); });
          }
          if (plaza && has('relief')) [-1, 1].forEach(function (y) { k.box(ob * 0.5, ob * 0.5 + 1.2, y > 0 ? ob * 1.3 : -ob * 1.3 - 10, y > 0 ? ob * 1.3 + 10 : -ob * 1.3, 0.5, 3, pmat); });
          forecourt(ob);
          break;
        }
        case 'stele': {
          var sh = total || fh || 2.2, sw = w || Math.max(0.9, sh * 0.5), sd = d || Math.max(0.2, sh * 0.1);
          top = pedestal(k, s.pedestal || 'low', ph >= 0 ? ph : 0.3, sw + 0.4, sd + 0.4, pmat, seed);
          k.box(-sd / 2, sd / 2, -sw / 2, sw / 2, top, sh - 0.1, mat);
          k.box(-sd / 2 - 0.04, sd / 2 + 0.04, -sw / 2 - 0.04, sw / 2 + 0.04, sh - 0.1, sh, shade(mat, 1.06));
          k.box(sd / 2, sd / 2 + 0.015, -sw * 0.32, sw * 0.32, top + (sh - top) * 0.35, top + (sh - top) * 0.8, shade(mat, 0.6));
          if ((s.features || []).indexOf('relief') >= 0) k.rod([sd / 2, 0, top + (sh - top) * 0.62], [sd / 2 + 0.06, 0, top + (sh - top) * 0.62], sw * 0.22, sw * 0.22, 10, MATERIAL.bronze, true);   // a bronze medallion
          break;
        }
        case 'column': {
          var ch = total || 8, cr = Math.max(0.35, ch * 0.045);
          top = pedestal(k, s.pedestal || 'stepped', base >= 0 ? base : Math.max(0.8, ch * 0.15), cr * 3.4, cr * 3.4, pmat, seed);
          var size = fh || Math.max(1.2, ch * 0.2), shaftTop = ch - (s.top && s.top !== 'none' ? size : 0);
          k.tube(0, 0, cr, cr * 0.85, top, shaftTop - 0.4, 12, mat);
          k.box(-cr * 1.3, cr * 1.3, -cr * 1.3, cr * 1.3, shaftTop - 0.4, shaftTop, shade(mat, 1.05));
          topper(k, s.top, shaftTop, size, paint(s.top_material, 'bronze'));
          break;
        }
        case 'pylon': {
          // A wide footprint (a plaza or stepped base) keeps the shaft to about a fifth of the height across.
          var yh = total || 8, yw = +s.shaft_w || Math.min(w || 99, Math.max(1.4, yh * 0.22)), yd = +s.shaft_w ? yw * (d && w ? d / w : 0.8) : Math.min(d || 99, Math.max(0.8, yw * 0.6)), wide = w > yw * 1.8;
          if (wide) k.box(-(d || w) / 2, (d || w) / 2, -w / 2, w / 2, 0, 0.4, pmat);
          top = (wide ? 0.4 : 0) + pedestal(k, 'stepped', base >= 0 ? base : 0.6, yw * 1.3, yd * 1.4, pmat, seed);
          var sizeP = (s.top && s.top !== 'none') ? (fh || Math.max(1, yh * 0.12)) : 0, peak = yh - sizeP;
          var p0 = [[-yd / 2, -yw / 2], [yd / 2, -yw / 2], [yd / 2, yw / 2], [-yd / 2, yw / 2]];
          k.prism(p0.map(function (p) { return [p[0], p[1]]; }), top, top + (peak - top) * 0.04, shade(mat, 1.05));
          var low = p0.map(function (p) { return [p[0], p[1], top]; }), high = p0.map(function (p) { return [p[0] * 0.6, p[1] * 0.6, peak]; });
          // With a figure group on its face (and nothing on top) the shaft is the pedestal's stone.
          var body = fh && has('relief') && (!s.top || s.top === 'none') ? pmat : mat;
          for (var e = 0; e < 4; e++) k.quad(low[e], low[(e + 1) % 4], high[(e + 1) % 4], high[e], body, [0, 0, (top + peak) / 2]);
          k.quad(high[0], high[1], high[2], high[3], body, [0, 0, top]);
          k.box(yd * 0.3 + 0.01, yd * 0.3 + 0.03, -yw * 0.25, yw * 0.25, top + (peak - top) * 0.15, top + (peak - top) * 0.45, shade(mat, 0.6));
          topper(k, s.top, peak, sizeP, s.top === 'figure' ? mat : paint(s.top_material, s.material === 'bronze' ? 'bronze' : 'white_stone'));
          if (has('relief') && (!s.top || s.top === 'none') && fh) k.placed(yd * 0.4, 0, top + (peak - top) * 0.25, 0, 1, function (q) { figure(q, Math.min(fh, (peak - top) * 0.3), 'seated', MATERIAL.dark_bronze); });
          forecourt(yd / 2);
          break;
        }
        case 'bells': {
          // Kambanite: four concrete slab pylons leaning together to a ring of bells at the top, inside a circle of
          // low walls hung with the donated bells.
          var bh = total || 37, ringR = (+s.ring_d || 60) / 2, cone = Math.max(3, (w || 7) / 2);
          for (var leg = 0; leg < 4; leg++) {
            var g = Math.PI / 4 + leg * Math.PI / 2, gx = Math.cos(g), gy = Math.sin(g);
            k.turned([gx * cone, gy * cone], [-gy, gx], 1.4, 0.35, 0, bh * 0.82, mat);
            k.turned([gx * cone * 0.55, gy * cone * 0.55], [-gy, gx], 1.1, 0.3, bh * 0.82, bh * 0.95, mat);
          }
          k.tube(0, 0, cone * 0.8, cone * 0.8, bh * 0.86, bh * 0.9, 16, mat);
          for (var bell = 0; bell < 8; bell++) {
            var a = 2 * Math.PI * bell / 8;
            k.tube(Math.cos(a) * cone * 0.55, Math.sin(a) * cone * 0.55, 0.45, 0.15, bh * 0.8, bh * 0.86, 8, MATERIAL.bronze, { cap: true });
          }
          k.tube(0, 0, 0.6, 0, bh * 0.95, bh, 8, mat);
          for (var seg = 0; seg < 28; seg++) {
            var a0 = 2 * Math.PI * seg / 28, a1 = 2 * Math.PI * (seg + 0.8) / 28;
            var p0 = [Math.cos(a0) * ringR, Math.sin(a0) * ringR], p1 = [Math.cos(a1) * ringR, Math.sin(a1) * ringR];
            var mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            k.turned(mid, [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len], len / 2, 0.3, 0, 2.2, mat);
            k.tube(mid[0] * 0.98, mid[1] * 0.98, 0.35, 0.12, 1.2, 1.9, 6, MATERIAL.bronze, { cap: true });
          }
          break;
        }
        case 'cross': {
          var xh = total || 3;
          top = pedestal(k, s.pedestal || 'stepped', ph >= 0 ? ph : 0.5, 1.2, 1.2, pmat, seed);
          k.cross(0, 0, top, xh - top, mat);
          break;
        }
        case 'stone': {
          var rh = total || fh || 1.4;
          k.rock(0, 0, w || rh * 1.1, d || rh * 0.8, rh, s.material ? mat : MATERIAL.granite, seed);
          k.box(rh * 0.25, rh * 0.27, -rh * 0.2, rh * 0.2, rh * 0.35, rh * 0.6, MATERIAL.bronze);
          break;
        }
        case 'wall': {
          // `depth` beyond 1.5 m is a forecourt in front of the wall, not the wall's thickness.
          var wh = total || 2.5, ww = w || 8, wd = Math.min(d || 0.6, 1.5);
          if (d > 1.5) k.box(wd / 2, wd / 2 + d, -ww / 2, ww / 2, 0, 0.12, pmat);
          k.box(-wd / 2, wd / 2, -ww / 2, ww / 2, 0, wh, mat);
          k.box(-wd / 2 - 0.06, wd / 2 + 0.06, -ww / 2 - 0.06, ww / 2 + 0.06, wh, wh + 0.12, shade(mat, 1.06));
          for (var panel = 0; panel < Math.max(1, Math.round(ww / 2.5)); panel++) {
            var v0 = -ww / 2 + 0.3 + panel * (ww - 0.6) / Math.max(1, Math.round(ww / 2.5)), v1 = v0 + (ww - 0.6) / Math.max(1, Math.round(ww / 2.5)) - 0.3;
            k.box(wd / 2, wd / 2 + 0.05, v0, v1, wh * 0.25, wh * 0.85, shade(mat, panel % 2 ? 0.75 : 0.85));
          }
          if (has('cross_on_top')) k.cross(wd / 2 + 2.5, 0, 0, 1.8, MATERIAL.limestone);
          forecourt(wd / 2);
          break;
        }
        case 'arch': {
          var ah = total || 5, aw = w || 4, ad = d || 1;
          k.box(-ad / 2, ad / 2, -aw / 2, -aw / 2 + aw * 0.22, 0, ah * 0.78, mat);
          k.box(-ad / 2, ad / 2, aw / 2 - aw * 0.22, aw / 2, 0, ah * 0.78, mat);
          k.box(-ad / 2 - 0.1, ad / 2 + 0.1, -aw / 2 - 0.1, aw / 2 + 0.1, ah * 0.78, ah, shade(mat, 1.05));
          break;
        }
        case 'animal': case 'bird': {
          heights(form === 'bird' ? 0.8 : 1.2, 0.5);
          var aw2 = w || Math.max(0.8, fh * 1.3);
          top = pedestal(k, s.pedestal || (ph > 0.6 ? 'block' : 'low'), ph, aw2 * 0.6, aw2, pmat, seed);
          k.placed(0, 0, top, Math.PI / 2, 1, function (q) {
            if (form === 'bird') bird(q, fh, mat, (s.features || []).indexOf('wings') >= 0 || seed > 0.5);
            else animal(q, s.animal || 'other', fh, mat, !!s.lying);
          });
          break;
        }
        case 'flame': {
          k.tube(0, 0, 0.5, 0.35, 0, 0.6, 10, pmat, { cap: true });
          k.tube(0, 0, 0.35, 0.75, 0.6, 1.0, 10, mat === MATERIAL.bronze ? MATERIAL.dark_bronze : mat);
          var fire = [0.98, 0.55, 0.12];
          [[0, 0, 0.9], [0.18, 0.1, 0.6], [-0.15, -0.12, 0.7]].forEach(function (f) {
            k.tube(f[0], f[1], 0.22, 0, 0.95, 0.95 + f[2], 6, fire);
          });
          break;
        }
        case 'aircraft': {
          var ah2 = ph >= 0 ? ph : 3;
          k.tube(0, 0, 0.35, 0.3, 0, ah2, 8, pmat);
          k.placed(0, 0, ah2 + 0.6, 0, 1, function (q) {
            q.rod([-4.5, 0, 0], [4, 0, 0.1], 0.55, 0.35, 8, MATERIAL.steel, true);
            q.rod([4, 0, 0.1], [5.2, 0, 0.1], 0.35, 0.02, 8, MATERIAL.steel);
            q.tri([0.8, 0, 0], [-1.6, -3.6, -0.1], [-1.6, 3.6, -0.1], MATERIAL.steel, [0, 0, 2]);
            q.tri([0.8, 0, 0], [-1.6, 3.6, -0.1], [-1.6, -3.6, -0.1], MATERIAL.steel, [0, 0, -2]);
            q.tri([-3.4, 0, 0.3], [-4.6, 0, 0.3], [-4.6, 0, 2.2], MATERIAL.steel, [0, 2, 0]);
            q.tri([-3.4, 0, 0.3], [-4.6, -1.6, 0.2], [-4.6, 1.6, 0.2], MATERIAL.steel, [0, 0, 2]);
            q.ball([2.6, 0, 0.45], 0.4, C.GLASS, 0.3, 6, 3);
          });
          break;
        }
        case 'fountain': {
          var fr = (w || 3) / 2;
          k.tube(0, 0, fr, fr, 0, 0.5, 16, pmat, { cap: true });
          k.tube(0, 0, fr * 0.9, fr * 0.9, 0.5, 0.52, 16, [0.45, 0.62, 0.70], { cap: true });
          k.tube(0, 0, 0.25, 0.2, 0.5, 1.6, 8, pmat, { cap: true });
          k.tube(0, 0, 0.6, 0.6, 1.6, 1.7, 10, pmat, { cap: true });
          // St George on his rearing horse on top of the column.
          if (has('horse')) k.placed(0, 0, 1.7, 0, 1, function (q) {
            var rider = fh || 1.3, saddle = horse(q, rider * 0.55, mat, true);
            q.placed(-0.05 * rider, 0, saddle - rider * 0.12, 0, 1, function (r) { figure(r, rider * 0.5, 'rider', mat); });
          });
          break;
        }
        default: {   // abstract: stacked turned blocks, a ring or a twisted ribbon, from the site's seed
          var bh = total || fh || 2.5, bw = w || Math.max(0.8, bh * 0.45);
          top = pedestal(k, s.pedestal || 'low', ph >= 0 ? ph : 0.3, bw * 1.1, bw * 1.1, pmat, seed);
          var style = Math.floor(seed * 3);
          if (has('wings')) {
            [-1, 1].forEach(function (y) {
              for (var piece = 0; piece < 4; piece++) {
                var z0 = top + (bh - top) * piece / 4, z1 = top + (bh - top) * (piece + 1) / 4, lean = y * (0.12 + piece * 0.12) * bw * 0.25;
                k.turned([0, y * bw * 0.18 + lean], [1, 0], bw * (0.22 - piece * 0.035), bw * 0.07, z0, z1, mat);
              }
            });
          } else if (style === 0) {
            for (var b = 0; b < 4; b++) {
              var z0 = top + (bh - top) * b / 4, g = seed * 6 + b * 0.7, sz = bw * (0.5 - b * 0.07);
              k.turned([0, 0], [Math.cos(g), Math.sin(g)], sz, sz * 0.45, z0, z0 + (bh - top) / 4, b % 2 ? shade(mat, 0.85) : mat);
            }
          } else if (style === 1) {
            var rr = (bh - top) / 2.32, segs = 12;   // the ring's own thickness (0.16 rr) stays above the base
            for (var j = 0; j < segs; j++) {
              var g0 = 2 * Math.PI * j / segs, g1 = 2 * Math.PI * (j + 1) / segs;
              k.rod([0, rr * Math.cos(g0) * 0.8, top + rr * 1.16 + rr * Math.sin(g0)], [0, rr * Math.cos(g1) * 0.8, top + rr * 1.16 + rr * Math.sin(g1)], rr * 0.16, rr * 0.16, 6, mat);
            }
          } else {
            for (var q2 = 0; q2 < 6; q2++) {
              var za = top + (bh - top) * q2 / 6, ga = q2 * 0.5 + seed * 3;
              k.turned([Math.cos(ga) * bw * 0.1, Math.sin(ga) * bw * 0.1], [Math.cos(ga), Math.sin(ga)], bw * 0.35, bw * 0.08, za, za + (bh - top) / 6, mat);
            }
          }
        }
      }
    });
  })();
