  // Day and night cycle for the 3D view: where the sun and moon are over Sofia right now, and the
  // light, sky and lamp levels that follow from it. Pure calculation plus a one-minute clock; the
  // 3D view and its custom WebGL layers read `lighting()` and `state()`. With the cycle switched
  // off every reader gets a fixed afternoon sun from the south-west, the look before this feature.
  var daylight = (function () {
    var RAD = Math.PI / 180, LAT = 42.6977, LNG = 23.3219;   // Sofia
    var DAY_MS = 864e5, J1970 = 2440588, J2000 = 2451545, OBLIQUITY = RAD * 23.4397;
    var enabled = false, offsetMs = 0, previewAt = null, current = null, currentKey = '', timer = 0, listeners = [];

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
    function mixv(a, b, t) { return a.map(function (v, i) { return v + (b[i] - v) * t; }); }
    // Piecewise linear lookup: keys[i] is the sun altitude (degrees), table[i] the value there.
    function ramp(keys, table, x) {
      if (x <= keys[0]) return table[0];
      for (var i = 1; i < keys.length; i++) if (x <= keys[i]) return mixv(table[i - 1], table[i], (x - keys[i - 1]) / (keys[i] - keys[i - 1]));
      return table[table.length - 1];
    }

    // ---- sun and moon (the standard low-precision series; about a degree for the moon) ----
    function days(ms) { return ms / DAY_MS - 0.5 + J1970 - J2000; }
    function rightAscension(l, b) { return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l)); }
    function declination(l, b) { return Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l)); }
    function sunCoords(d) {
      var M = RAD * (357.5291 + 0.98560028 * d);
      var C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
      var L = M + C + RAD * 102.9372 + Math.PI;
      return { dec: declination(L, 0), ra: rightAscension(L, 0) };
    }
    function moonCoords(d) {
      var L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
      var l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F);
      return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
    }
    // Altitude and azimuth in degrees, azimuth clockwise from north.
    function horizontal(d, c) {
      var H = RAD * (280.16 + 360.9856235 * d) - RAD * -LNG - c.ra, phi = RAD * LAT;
      var alt = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
      var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)) + Math.PI;
      alt += (alt > -0.0087 ? 0.0002967 / Math.tan(alt + 0.00312536 / (alt + 0.08901179)) : 0);   // refraction near the horizon
      return { alt: alt / RAD, az: ((az / RAD) % 360 + 360) % 360 };
    }
    function moonFraction(d) {
      var s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
      var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
      var inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
      return (1 + Math.cos(inc)) / 2;
    }

    // ---- Sofia clock ----
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    function sofiaParts(ms) {
      var o = {};
      parts.formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') o[p.type] = +p.value; });
      return o;
    }
    // The instant when Sofia's wall clock shows hh:mm on the date of `ms`.
    function sofiaTimeOnDay(ms, minutes) {
      var p = sofiaParts(ms), guess = Date.UTC(p.year, p.month - 1, p.day, 0, 0) + minutes * 6e4;
      for (var i = 0; i < 2; i++) {
        var q = sofiaParts(guess);
        guess += (Date.UTC(p.year, p.month - 1, p.day, 0, 0) + minutes * 6e4) - Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute);
      }
      return guess;
    }
    function now() { return previewAt !== null ? previewAt : Date.now() + offsetMs; }

    // ---- light, sky and lamps for a sun altitude ----
    var SKY_KEYS = [-18, -12, -6, 0, 5, 20];
    var SKY = [[.02, .03, .08], [.05, .07, .15], [.2, .24, .42], [.45, .52, .75], [.62, .74, .9], [.86, .91, .96]];
    var HORIZON = [[.05, .07, .15], [.12, .14, .26], [.55, .38, .42], [.98, .62, .4], [.98, .82, .64], [.96, .95, .93]];
    var LIGHT_KEYS = [-18, -12, -6, -2, 2, 8, 20];
    var AMBIENT = [[.17, .2, .34], [.2, .24, .4], [.34, .38, .56], [.5, .5, .62], [.62, .6, .64], [.72, .72, .76], [.78, .8, .84]];
    var SUN_LIGHT = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [.3, .18, .08], [.38, .28, .17], [.3, .28, .24]];
    var DAY_AMBIENT = [.78, .8, .84];
    var DUSK_AMBIENT = .16, DUSK_SUN = .3;   // how much dusk takes off the ambient and the direct light
    // Share of windows that are lit, by Sofia hour (only while it is dark enough for lamps).
    var LIT_HOURS = [0, 4, 6, 8, 16, 18, 21, 23, 24], LIT_SHARE = [.15, .12, .4, .3, .3, .6, .6, .35, .15];
    function litShare(hour) {
      for (var i = 1; i < LIT_HOURS.length; i++) if (hour <= LIT_HOURS[i]) return LIT_SHARE[i - 1] + (LIT_SHARE[i] - LIT_SHARE[i - 1]) * (hour - LIT_HOURS[i - 1]) / (LIT_HOURS[i] - LIT_HOURS[i - 1]);
      return LIT_SHARE[LIT_SHARE.length - 1];
    }
    function direction(altitude, azimuth) {   // east, south, up: the axes of Mercator coordinates
      var a = altitude * RAD, z = azimuth * RAD;
      return [Math.sin(z) * Math.cos(a), -Math.cos(z) * Math.cos(a), Math.sin(a)];
    }
    function css(c) { return 'rgb(' + c.map(function (v) { return Math.round(clamp(v, 0, 1) * 255); }).join(',') + ')'; }

    function build(ms) {
      var d = days(ms), sun = horizontal(d, sunCoords(d)), moon = horizontal(d, moonCoords(d)), fraction = moonFraction(d);
      var p = sofiaParts(ms), hour = p.hour + p.minute / 60;
      return fromBodies(sun, moon, fraction, hour);
    }
    function fromBodies(sun, moon, fraction, hour) {
      var a = sun.alt;
      var ambient = ramp(LIGHT_KEYS, AMBIENT, a), sunLight = ramp(LIGHT_KEYS, SUN_LIGHT, a);
      // Dusk (and dawn): the sun is low or just down. Full between about +3° and -4°, gone by +12° and -10°,
      // where day and night take over. It dims the whole scene a little.
      var dusk = smooth(12, 3, a) * (1 - smooth(-4, -10, a));
      ambient = ambient.map(function (v) { return v * (1 - DUSK_AMBIENT * dusk); });
      sunLight = sunLight.map(function (v) { return v * (1 - DUSK_SUN * dusk); });
      var moonLevel = clamp(moon.alt / 10, 0, 1) * fraction * (1 - smooth(-8, 0, a));
      var moonLight = [.12 * moonLevel, .14 * moonLevel, .2 * moonLevel];
      var sunWeight = sunLight[0] + sunLight[1] + sunLight[2], moonWeight = moonLight[0] + moonLight[1] + moonLight[2];
      var sd = direction(sun.alt, sun.az), md = direction(moon.alt, moon.az), w = sunWeight + moonWeight || 1;
      var dir = [0, 1, 2].map(function (i) { return (sd[i] * sunWeight + md[i] * moonWeight) / w; });
      if (!sunWeight && !moonWeight) dir = sd;
      var len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      dir = dir.map(function (v) { return v / len; });
      var lamp = 1 - smooth(-8, 3, a);
      var grade = [0, 1, 2].map(function (i) { return clamp(ambient[i] / DAY_AMBIENT[i] + sunLight[i] * [.6, .5, .3][i], 0, 1); });
      // Where MapLibre's own light comes from: the sun, or the moon once the sun is well down.
      var lit = sunWeight >= moonWeight ? sun : moon;
      var polar = clamp(90 - (lit.alt > 0 ? lit.alt : 4), 12, 80);
      var sky = ramp(SKY_KEYS, SKY, a), horizon = ramp(SKY_KEYS, HORIZON, a);
      return {
        sunAlt: sun.alt, sunAz: sun.az, moonAlt: moon.alt, moonAz: moon.az, moonFraction: fraction, hour: hour,
        lighting: { dir: dir, color: [0, 1, 2].map(function (i) { return sunLight[i] + moonLight[i]; }), ambient: ambient, lamp: lamp, lit: lamp * litShare(hour) },
        grade: grade, night: 1 - smooth(-8, 2, a), dusk: dusk,
        sky: { 'sky-color': css(sky), 'horizon-color': css(horizon), 'fog-color': css(horizon),
               'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 },
        light: { anchor: 'map', position: [1.5, lit.az, polar], color: css(grade), intensity: a > -2 ? 0.35 : 0.25 }
      };
    }
    var STATIC = fromBodies({ alt: 55, az: 225 }, { alt: -30, az: 45 }, 0, 12);
    STATIC.lighting.ambient = [.74, .75, .78]; STATIC.lighting.color = [.26, .24, .2];
    STATIC.lighting.lamp = 0; STATIC.lighting.lit = 0; STATIC.night = 0;

    function state() {
      if (!enabled) return STATIC;
      var ms = now(), key = previewAt !== null ? 'p' + ms : 't' + Math.floor(ms / 15000);
      if (key !== currentKey) { current = build(ms); currentKey = key; }
      return current;
    }
    function notify() { var s = state(); listeners.slice().forEach(function (fn) { fn(s); }); }
    function tick() { currentKey = ''; notify(); }
    function schedule() {
      clearInterval(timer); timer = 0;
      if (enabled && previewAt === null) timer = setInterval(tick, 20000);
    }

    return {
      enabled: function () { return enabled; },
      setEnabled: function (on) { on = !!on; if (on === enabled) return; enabled = on; currentKey = ''; schedule(); notify(); },
      state: state,
      refresh: function () { if (enabled) tick(); },
      lighting: function () { return state().lighting; },
      subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
      now: now,
      at: build,
      // The feed's own clock replaces a device clock that is more than two minutes out.
      clockOffset: function (feedMs) { var off = feedMs - Date.now(); offsetMs = Math.abs(off) > 12e4 ? off : 0; },
      // Show Sofia at a fixed time of day (minutes after midnight) on today's date; null returns to live time.
      preview: function (minutes) {
        previewAt = minutes === null || minutes === undefined ? null : sofiaTimeOnDay(Date.now() + offsetMs, minutes);
        currentKey = ''; schedule(); notify();
      },
      previewing: function () { return previewAt !== null; },
      sofiaTimeOnDay: sofiaTimeOnDay,
      clock: function () { var p = sofiaParts(now()); return ('0' + p.hour).slice(-2) + ':' + ('0' + p.minute).slice(-2); }
    };
  })();
