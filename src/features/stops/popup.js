  // ---------- Stop details: one card per line + destination, upcoming times as chips ----------
  var MAX_CARDS = 6, MAX_CHIPS = 5;
  var expandedStop = null, openStopMk = null;   // "Show N more lines" pressed for this stop; open desktop stop popup
  var KIND_WORD = { live: 'live', est: 'estimated', sched: 'timetable' };
  var SIGNAL_SVG = '<svg class="sig" viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M1.8 4.6a6 6 0 0 1 8.4 0M3.7 6.7a3.3 3.3 0 0 1 4.6 0"/><circle cx="6" cy="9.2" r="1.3" fill="currentColor"/></svg>';
  var CLOSE_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path fill="none" stroke="#555" stroke-width="1.8" stroke-linecap="round" d="M3 3l8 8M11 3l-8 8"/></svg>';

  // Feed names are ALL CAPS: "БЛ. 325, Ж.К. МЛАДОСТ 3" → "Бл. 325, ж.к. Младост 3".
  // Latin line / vehicle codes (X9, A1210) are left as they are.
  function titleCaseBg(s) {
    return String(s || '').split(/(\s+)/).map(function (w) {
      if (/^[A-Z0-9]*[0-9][A-Z0-9]*$/.test(w) && /[A-Z]/.test(w)) return w;
      return w.toLocaleLowerCase('bg').replace(/(^|[\-\/(."])(\p{L})/gu, function (m, p, c) { return p + c.toLocaleUpperCase('bg'); });
    }).join('')
      .replace(/(\d)(\p{L})(?!\p{L})/gu, function (m, d, c) { return d + c.toLocaleUpperCase('bg'); })   // "1А" in "Младост 1А"
      .replace(/(^|[\s(])Ж\.К\./g, '$1ж.к.')
      .replace(/(\s)Бл\./g, '$1бл.');   // "Бл." only at the start
  }

  // Line colour → badge text colour, tracked-card tint (~8 % on white) and a darker shade for "Tracking",
  // each keeping ≥ 4.5:1 contrast
  var toneCache = {};
  function rgbOf(c) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return [85, 85, 85];
    var h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
  }
  function hexOf(rgb) { return '#' + rgb.map(function (x) { return ('0' + Math.round(x).toString(16)).slice(-2); }).join(''); }
  function mixRgb(a, b, k) { return a.map(function (x, i) { return x + (b[i] - x) * k; }); }
  function luminance(rgb) {
    var c = rgb.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function lineTones(color) {
    if (toneCache[color]) return toneCache[color];
    var rgb = rgbOf(color), white = [255, 255, 255], black = [0, 0, 0];
    var tint = mixRgb(white, rgb, 0.08), dark = mixRgb(rgb, black, 0.3);
    while (contrast(dark, tint) < 4.5) dark = mixRgb(dark, black, 0.15);
    return (toneCache[color] = {
      ink: contrast(rgb, white) >= 4.5 ? '#fff' : '#1A1A1A',   // e.g. tram orange gets dark text
      tint: hexOf(tint), dark: hexOf(dark)
    });
  }

  // Chip text: the first chip of a card carries the unit; ≥ 60 min shows the (24-hour) clock time
  function chipClock(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function chipTime(a, first) {
    if (!a.t) return 'on the way';
    var min = Math.round((a.t - Date.now()) / 60000), pre = a.kind === 'est' ? '~' : '';
    if (min <= 0) return 'now';
    if (min >= 60) return pre + chipClock(a.t);
    return pre + min + (first ? ' min' : '');
  }
  function timeWords(a) {
    if (!a.t) return 'on the way';
    var min = Math.round((a.t - Date.now()) / 60000);
    return (min <= 0 ? 'now' : min + ' min') + ', ' + chipClock(a.t);
  }

  function stopPopupHtml(st) {
    var list = arrivalsAt(st.id), trackKey = selected ? selected.d.key : null;
    // the tracked vehicle's own time here (this used to be the banner at the top)
    if (selected) {
      var tw = twinsOf(st.id);   // the tracked vehicle may stop at a twin of this stop (v77)
      var mine = routeStops.filter(function (r) { return tw.indexOf(r.stop.id) >= 0; })[0];
      var own = list.filter(function (a) { return a.key === trackKey; })[0];
      var sInfo = trips[selected.d.tripRef];
      if (mine && own && !own.t) own.t = mine.eta;
      if (mine && !own && (!searchRoutes || (sInfo && searchRoutes[sInfo.route_id]))) {
        list.push({ tripId: selected.d.tripRef, key: trackKey, t: mine.eta, sid: mine.stop.id });
      }
    }
    // one group per line + destination
    var groups = {}, order = [];
    list.forEach(function (a) {
      var v = a.key && vehicles[a.key], info = trips[a.tripId] || {}, r = routes[info.route_id];
      a.kind = !v ? 'sched' : a.guess ? 'est' : 'live';
      if (a.kind === 'sched' && !a.t) return;   // no vehicle and no time: nothing to show
      var line = (a.kind === 'live' ? (v.d.line || v.d.label) : ((r && r.short) || (v && v.d.line))) || '?';
      var dest = (a.kind === 'live' && v.d.headsign) || info.headsign || '';
      var gk = (info.route_id || line) + '|' + dest, g = groups[gk];
      if (!g) {
        g = groups[gk] = {
          line: line, dest: dest, items: [], tracked: false,
          type: r ? r.type : (v ? v.d.type : null),
          color: r ? routeColor(info.route_id) : (v ? v.d.color : typeInfo(null).color)
        };
        order.push(g);
      }
      g.items.push(a);
      if (trackKey && a.key === trackKey) g.tracked = true;
    });
    function byTime(x, y) { return (x.t || Infinity) - (y.t || Infinity); }
    order.forEach(function (g) {
      g.items.sort(byTime);
      var keep = g.items.slice(0, MAX_CHIPS);
      if (g.tracked && !keep.some(function (a) { return a.key === trackKey; })) {
        keep[keep.length - 1] = g.items.filter(function (a) { return a.key === trackKey; })[0];
        keep.sort(byTime);
      }
      g.items = keep;
    });
    order.sort(function (x, y) { return (y.tracked - x.tracked) || byTime(x.items[0], y.items[0]); });

    var html = '<div class="sp-head"><div class="sp-title"><div class="sp-name">' + esc(titleCaseBg(st.name) || 'Stop') + '</div>' +
      (st.code ? '<div class="sp-code">Stop ' + esc(st.code) + '</div>' : '') + '</div>' +
      '<button type="button" class="sp-x" data-sp-close aria-label="Close" title="Close">' + CLOSE_SVG + '</button></div>';
    if (!order.length) return html + '<div class="sp-body"><div class="sp-none">No departures in the next hour</div></div>';
    var shown = expandedStop === st.id ? order : order.slice(0, MAX_CARDS), used = {};
    var more = order.length - shown.length;
    return html + '<div class="sp-body">' +
      shown.map(function (g) { return cardHtml(g, st, used); }).join('') +
      (more > 0 ? '<button type="button" class="sp-more" data-sp-more="' + esc(st.id) + '">Show ' + more + ' more line' + (more > 1 ? 's' : '') + '</button>' : '') +
      legendHtml(used) + '</div>';
  }

  function cardHtml(g, st, used) {
    var tone = lineTones(g.color), dest = titleCaseBg(g.dest);
    var label = typeInfo(g.type).name + ' ' + g.line + (dest ? ' to ' + dest : '');
    var chips = g.items.map(function (a, i) {
      used[a.kind] = true;
      var txt = esc(chipTime(a, i === 0)), full = esc(label + ', ' + KIND_WORD[a.kind] + ', ' + timeWords(a));
      if (a.kind === 'sched') return '<span class="sp-sched" title="' + full + '" aria-label="' + full + '">' + txt + '</span>';
      var attrs = ' data-veh="' + esc(a.key) + '" data-stop="' + esc(a.sid || st.id) + '"';   // its own twin (v77)
      var ret = a.kind === 'est' && !a.guess.sameWay;   // comes after turning round at the end of its current run
      if (a.kind === 'est') {
        attrs += ' data-eta="' + (a.t || '') + '" data-same="' + (a.guess.sameWay ? 1 : 0) + '" data-onnew="' + (a.guess.stopOnNew || 0) + '"' +
          ' data-trip="' + esc(a.tripId || '') + '"';
      }
      if (ret) { used.ret = true; full = esc(label + ', estimated, return trip: after its current run ends, ' + timeWords(a)); }
      return '<button type="button" class="sp-chip ' + (a.kind === 'est' ? 'est guess' : 'live') + '" title="' + full + '" aria-label="' + full + '"' +
        attrs + '>' + (a.kind === 'live' ? SIGNAL_SVG : '') + (ret ? '<span class="ret" aria-hidden="true">&#8617;</span>' : '') + txt + '</button>';
    }).join('');
    return '<section class="sp-card' + (g.tracked ? ' tracked' : '') + '" aria-label="' + esc(label) + '"' +
      (g.tracked ? ' style="border-color:' + g.color + ';background:' + tone.tint + '"' : '') + '>' +
      '<div class="sp-row"><span class="sp-badge" style="background:' + g.color + ';color:' + tone.ink + '">' + esc(g.line) + '</span>' +
      '<span class="sp-dest">' + esc(dest) + '</span>' +
      (g.tracked ? '<span class="sp-track" style="color:' + tone.dark + '">Tracking</span>' : '') + '</div>' +
      '<div class="sp-chips">' + chips + '</div></section>';
  }

  // Only the kinds that appear; none at all when every chip is live
  function legendHtml(used) {
    if (!used.est && !used.sched) return '';
    var parts = [];
    if (used.live) parts.push('<span><i class="lg-live"></i>Live</span>');
    if (used.est) parts.push('<span><i class="lg-est"></i>Estimated</span>');
    if (used.ret) parts.push('<span><b class="lg-ret" aria-hidden="true">&#8617;</b>Return trip (after its current run)</span>');
    if (used.sched) parts.push('<span>Plain = timetable</span>');
    return '<div class="sp-legend">' + parts.join('') + '</div>';
  }

  // Tapping a vehicle in a stop's list: track it, zoom out so its route to that stop is in view,
  // and open its popup once the camera has arrived (without the usual zoom-in on the vehicle).
  // Phones: tracking only, no card: the sheet would cover half of that view (tap the vehicle for it).
