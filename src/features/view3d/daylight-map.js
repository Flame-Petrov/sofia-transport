  // The 3D map's half of the day and night cycle: sky, map light, the basemap's night colours and
  // the sun, moon and stars drawn over the sky. The numbers come from `daylight` (shared/map);
  // the custom building and vehicle layers read the same state in their own shaders.
  var daylightMap = (function () {
    var RAD = Math.PI / 180, TAN_HALF_FOV = 1 / 3;   // MapLibre's default 36.87° vertical field of view
    var PAINT = {
      background: [['background-color', 'area']],
      fill: [['fill-color', 'area'], ['fill-outline-color', 'area']],
      line: [['line-color', 'area']],
      circle: [['circle-color', 'area'], ['circle-stroke-color', 'area']],
      symbol: [['text-color', 'text'], ['text-halo-color', 'halo'], ['icon-color', 'text'], ['icon-halo-color', 'halo']]
    };
    var map = null, jobs = [], overlay = null, ctx = null, unsubscribe = null, queue = [], frame = 0;
    var appliedKey = '', appliedSky = '', appliedLight = '', stars = [];
    (function () {   // a fixed scatter of stars, by azimuth and altitude
      var seed = 7;
      function next() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      for (var i = 0; i < 90; i++) stars.push({ az: next() * 360, alt: 3 + Math.acos(1 - next() * 0.97) * 90 / Math.PI * 0.98, a: 0.35 + next() * 0.65, r: next() < 0.12 ? 1.4 : 0.8 });
    })();

    // ---- colours ----
    function parseColor(text) {
      var m;
      if ((m = /^#([0-9a-f]{3,8})$/i.exec(text))) {
        var h = m[1];
        if (h.length === 3 || h.length === 4) h = h.replace(/./g, '$&$&');
        if (h.length !== 6 && h.length !== 8) return null;
        return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
      if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text))) return [m[1] / 255, m[2] / 255, m[3] / 255, m[4] === undefined ? 1 : +m[4]];
      if ((m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text))) {
        var hue = (m[1] % 360) / 360, s = m[2] / 100, l = m[3] / 100, q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        var channel = function (t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
        return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3), m[4] === undefined ? 1 : +m[4]];
      }
      return null;
    }
    function shift(c, kind, grade, night) {
      var out;
      if (kind === 'text') out = [0, 1, 2].map(function (i) { return c[i] * grade[i] + ([0.88, 0.9, 0.95][i] - c[i] * grade[i]) * night * 0.9; });
      else if (kind === 'halo') out = [0, 1, 2].map(function (i) { return c[i] * grade[i] + ([0.06, 0.08, 0.14][i] - c[i] * grade[i]) * night; });
      else out = [0, 1, 2].map(function (i) { return c[i] * grade[i] + 0.02 * night; });
      return 'rgba(' + out.map(function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 255); }).join(',') + ',' + c[3] + ')';
    }
    // Colours may sit inside zoom or data expressions; every literal colour in the value moves.
    function recolor(value, kind, grade, night) {
      if (typeof value === 'string') { var c = parseColor(value); return c ? shift(c, kind, grade, night) : value; }
      if (Array.isArray(value)) return value.map(function (v) { return recolor(v, kind, grade, night); });
      return value;
    }

    // ---- the basemap's colours, a few layers a frame ----
    function capture() {
      jobs = [];
      map.getStyle().layers.forEach(function (layer) {
        if (/^v3-/.test(layer.id) || !PAINT[layer.type]) return;
        PAINT[layer.type].forEach(function (pair) {
          var original = map.getPaintProperty(layer.id, pair[0]);
          if (original !== undefined && original !== null) jobs.push({ id: layer.id, prop: pair[0], kind: pair[1], original: original });
        });
      });
    }
    function pump() {
      frame = 0;
      if (!map) return;
      for (var n = 0; n < 14 && queue.length; n++) {
        var job = queue.shift();
        try { map.setPaintProperty(job.id, job.prop, job.value); } catch (e) {}
      }
      if (queue.length) frame = requestAnimationFrame(pump);
      else map.triggerRepaint();
    }
    function basemap(state) {
      var plain = state.night === 0 && state.grade.every(function (v) { return v >= 0.995; });
      var key = plain ? 'plain' : state.grade.map(function (v) { return Math.round(v * 20); }).join(',') + '/' + Math.round(state.night * 10);
      if (key === appliedKey) return;
      appliedKey = key;
      queue = jobs.map(function (job) {
        return { id: job.id, prop: job.prop, value: plain ? job.original : recolor(job.original, job.kind, state.grade, state.night) };
      });
      if (!frame) frame = requestAnimationFrame(pump);
    }

    // ---- sun, moon and stars over the sky ----
    function resize() {
      if (!overlay || !map) return;
      var box = map.getContainer(), ratio = Math.min(2, window.devicePixelRatio || 1);
      overlay.width = Math.round(box.clientWidth * ratio); overlay.height = Math.round(box.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }
    function project(basis, altitude, azimuth, width, height) {
      var a = altitude * RAD, z = azimuth * RAD, d = [Math.sin(z) * Math.cos(a), Math.cos(z) * Math.cos(a), Math.sin(a)];
      var dot = function (v) { return d[0] * v[0] + d[1] * v[1] + d[2] * v[2]; };
      var depth = dot(basis.forward);
      if (depth < 0.05) return null;
      return { x: width / 2 + dot(basis.right) / depth / TAN_HALF_FOV * (height / 2), y: height / 2 - dot(basis.up) / depth / TAN_HALF_FOV * (height / 2), d: d, sx: dot(basis.right), sy: dot(basis.up) };
    }
    function draw() {
      if (!overlay || !map) return;
      var box = map.getContainer(), w = box.clientWidth, h = box.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!daylight.enabled()) return;
      var s = daylight.state(), pitch = map.getPitch() * RAD, bearing = map.getBearing() * RAD;
      var basis = {
        forward: [Math.sin(bearing) * Math.sin(pitch), Math.cos(bearing) * Math.sin(pitch), -Math.cos(pitch)],
        right: [Math.cos(bearing), -Math.sin(bearing), 0],
        up: [Math.sin(bearing) * Math.cos(pitch), Math.cos(bearing) * Math.cos(pitch), Math.sin(pitch)]
      };
      if (pitch < 8 * RAD) return;   // looking down at the map: no sky in view
      var dark = s.night * s.night, i, p;
      if (dark > 0.02) {
        var turn = (daylight.now() / 86164091) * 360;   // the sky turns once a sidereal day
        ctx.fillStyle = '#fff';
        for (i = 0; i < stars.length; i++) {
          p = project(basis, stars[i].alt, stars[i].az + turn, w, h);
          if (!p || p.y < -2 || p.y > h || p.x < -2 || p.x > w) continue;
          ctx.globalAlpha = dark * stars[i].a;
          ctx.beginPath(); ctx.arc(p.x, p.y, stars[i].r, 0, 6.2832); ctx.fill();
        }
      }
      var sun = s.sunAlt > -3 && project(basis, s.sunAlt, s.sunAz, w, h);
      if (sun && sun.y > -60 && sun.y < h + 60) {
        var warm = 1 - Math.min(1, Math.max(0, s.sunAlt / 25)), fade = Math.min(1, (s.sunAlt + 3) / 3);
        var glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 90);
        glow.addColorStop(0, 'rgba(255,' + Math.round(235 - 90 * warm) + ',' + Math.round(190 - 120 * warm) + ',' + (0.6 * fade) + ')');
        glow.addColorStop(1, 'rgba(255,200,140,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = glow; ctx.fillRect(sun.x - 90, sun.y - 90, 180, 180);
        ctx.globalAlpha = fade; ctx.fillStyle = 'rgb(255,' + Math.round(246 - 70 * warm) + ',' + Math.round(220 - 110 * warm) + ')';
        ctx.beginPath(); ctx.arc(sun.x, sun.y, 13, 0, 6.2832); ctx.fill();
      }
      var moon = s.moonAlt > -1 && project(basis, s.moonAlt, s.moonAz, w, h);
      if (moon && moon.y > -40 && moon.y < h + 40) {
        var sd = [Math.sin(s.sunAz * RAD) * Math.cos(s.sunAlt * RAD), Math.cos(s.sunAz * RAD) * Math.cos(s.sunAlt * RAD), Math.sin(s.sunAlt * RAD)];
        var towardX = sd[0] * basis.right[0] + sd[1] * basis.right[1] - moon.sx;
        var towardY = sd[0] * basis.up[0] + sd[1] * basis.up[1] + sd[2] * basis.up[2] - moon.sy;
        var r = 12, k = s.moonFraction, rx = Math.abs(2 * k - 1) * r;
        ctx.save();
        ctx.globalAlpha = Math.min(1, (s.moonAlt + 1) / 3) * (0.3 + 0.7 * s.night);
        ctx.translate(moon.x, moon.y);
        var halo = ctx.createRadialGradient(0, 0, r, 0, 0, r * 4);
        halo.addColorStop(0, 'rgba(210,220,255,' + (0.25 * k) + ')'); halo.addColorStop(1, 'rgba(210,220,255,0)');
        ctx.fillStyle = halo; ctx.fillRect(-r * 4, -r * 4, r * 8, r * 8);
        ctx.rotate(Math.atan2(-towardY, towardX));   // the lit side faces the sun
        ctx.fillStyle = 'rgba(44,54,80,0.9)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#f3f1e6'; ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
        if (k > 0.5) ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
        else ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function apply(state) {
      if (!map) return;
      var sky = JSON.stringify(state.sky), light = JSON.stringify(state.light);
      try {
        if (sky !== appliedSky) { appliedSky = sky; map.setSky(state.sky); }
        if (light !== appliedLight) { appliedLight = light; map.setLight(state.light, { duration: 0 }); }
      } catch (e) { console.warn('3D daylight failed:', e); }
      basemap(state);
      draw();
      map.triggerRepaint();
    }

    return {
      attach: function (owner) {
        this.detach();
        map = owner; appliedKey = appliedSky = appliedLight = '';
        capture();
        overlay = document.createElement('canvas');
        overlay.className = 'v3-sky';
        overlay.setAttribute('aria-hidden', 'true');
        ctx = overlay.getContext('2d');
        map.getContainer().appendChild(overlay);
        map.on('move', draw); map.on('resize', resize);
        unsubscribe = daylight.subscribe(apply);
        resize();
        if (daylight.enabled()) apply(daylight.state());
      },
      detach: function () {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        cancelAnimationFrame(frame); frame = 0; queue = [];
        if (map) { try { map.off('move', draw); map.off('resize', resize); } catch (e) {} }
        if (overlay) overlay.remove();
        overlay = ctx = map = null;
      },
      draw: draw
    };
  })();
