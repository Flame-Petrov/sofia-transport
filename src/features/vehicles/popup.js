  // ---------- Vehicle popup: which line, where to, is the data fresh, when at the next stop / my stop ----------
  // One element per vehicle, rebuilt only when its content changed (no flicker, the All stops list keeps
  // its scroll position). The freshness ("Live · 3 s ago") is filled in separately, once a second.
  var VP_TYPE = { 3: 'Bus', 0: 'Tram', 11: 'Trolleybus', 1: 'Metro' };
  var VP_SIGNAL = '<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M1.8 4.6a6 6 0 0 1 8.4 0M3.7 6.7a3.3 3.3 0 0 1 4.6 0"/><circle cx="6" cy="9.2" r="1.3" fill="currentColor"/></svg>';
  var VP_CLOCK = '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var VP_TARGET = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  // v100: the card's icons — Follow's navigation arrow (filled while following), All stops' list, the plain ×
  var VP_NAV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.5 10.6l7.4 2.5 2.5 7.4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  var VP_NAV_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5 3.5 10.6l7.4 2.5 2.5 7.4z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  var VP_LIST2 = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4.5" cy="6" r="1.7" fill="currentColor"/><circle cx="4.5" cy="12" r="1.7" fill="currentColor"/><circle cx="4.5" cy="18" r="1.7" fill="currentColor"/><path d="M9.5 6H21M9.5 12H21M9.5 18H21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var VP_DOT = '<i class="vp-dot" aria-hidden="true"></i>';
  var VP_LIST = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><path d="M6.5 4H14M6.5 8H14M6.5 12H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var VP_ARROW = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h11M10 5l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var VP_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="#6B6668" stroke-width="1.7" stroke-linecap="round" d="M2.5 2.5l11 11M13.5 2.5l-11 11"/></svg>';
  // v100: the card is 388 px wide (content 349 + 1 that Leaflet adds, 2 × 17 px margin, its edge), narrower only if the screen
  // can't hold that (it is --ui times that on screen). Its pointer's tip is VP_GAP below the vehicle's spot:
  // the round marker's radius + 4 px.
  function vpW() { return Math.max(240, Math.min(349, Math.floor((window.innerWidth - 16) / ui) - 39)); }
  var VP_W = vpW(), VP_GAP = 27;

  // at the end of its run, or waiting at the terminus (the faded, dashed vehicle)
  function vehAtEnd(v) { return !!(v.parked || /end of the line/.test(v.pathNote || '')); }
  function vpAge(sec) { return sec < 60 ? Math.round(sec) + ' s ago' : Math.round(sec / 60) + ' min ago'; }
  function vpFresh(v) {
    var d = v.d, sec = d.ts ? Math.max(0, Date.now() / 1000 - d.ts) : (v.parkedSince ? (Date.now() - v.parkedSince) / 1000 : null);
    // v100: a dot instead of the icons; a live report just says "Live" (its age is in the tooltip)
    if (d.metroPlan) return { cls: 'old', html: VP_CLOCK + 'Timetable estimate' };
    if (vehAtEnd(v)) return { cls: 'delayed', html: VP_DOT + (v.parked ? 'Waiting · last seen ' : 'At terminus · ') + (sec === null ? '—' : vpAge(sec)) };
    if (sec === null) return { cls: 'old', html: VP_DOT + 'Update time unknown' };
    if (sec <= 30) return { cls: 'live', html: VP_DOT + 'Live', tip: 'Last report ' + vpAge(sec) };
    if (sec <= 120) return { cls: 'delayed', html: VP_DOT + 'Delayed · ' + vpAge(sec) };
    return { cls: 'old', html: VP_DOT + 'Last seen ' + vpAge(sec) };
  }
  // the freshness text changes every second: only that little span is touched (not announced to screen readers)
  function fillFresh(root, v) {
    var f = root && root.querySelector('.vp-fresh');
    if (!f) return;
    var x = vpFresh(v), cls = 'vp-fresh ' + x.cls;
    if (f._h !== x.html) { f._h = x.html; f.innerHTML = x.html; }
    if (f.className !== cls) f.className = cls;
    if (f.title !== (x.tip || '')) f.title = x.tip || '';
  }
  function vpLabel(v) {
    var d = v.d;
    return (VP_TYPE[d.type] || 'Vehicle') + ' ' + (d.line || d.label || '') + (d.headsign ? ' to ' + titleCaseBg(d.headsign) : '');
  }
  function vpMins(eta, timetable) {
    var min = Math.round((eta - Date.now()) / 60000);
    return (timetable ? '~' : '') + (min <= 0 ? 'now' : min + ' min');
  }

  function vpHead(v, end, closeBtn) {
    var d = v.d, tone = lineTones(d.color), type = VP_TYPE[d.type] || 'Vehicle';
    var badge = end ? '<span class="vp-badge end" style="border-color:' + d.color + ';color:' + tone.dark + '">'
                    : '<span class="vp-badge" style="background:' + d.color + ';color:' + tone.ink + '">';
    // v100: two lines beside the badge — "To <destination>" (at the end of the line: "At <terminus>"), and the live line under it
    var title = end ? 'At ' + (titleCaseBg(lastStopName(v)) || 'the terminus') : d.headsign ? 'To ' + titleCaseBg(d.headsign) : type + ' ' + (d.line || d.label || '');
    return '<div class="vp-head">' + badge + esc(d.line || d.label || '?') + '</span>' +
      '<div class="vp-tt"><div class="vp-dest">' + esc(title) + '</div>' + vpMeta(v, end) + '</div>' +
      (closeBtn ? '<button type="button" class="vp-x" data-vp-close aria-label="Close" title="Close">' + VP_CLOSE + '</button>' : '') + '</div>';
  }
  function vpMeta(v, end) {
    var d = v.d, parts = ['<span class="vp-fresh"></span>'];
    if (!end && typeof d.speed === 'number') parts.push(d.speed < 2 ? 'stopped' : Math.round(d.speed) + ' km/h');   // feed sends km/h
    if (d.label) parts.push('#' + esc(d.label));
    return '<div class="vp-meta">' + parts.join('<span class="sep" aria-hidden="true">·</span>') + '</div>';
  }
  // v100: minutes for the headline: a big number and a smaller "min" on one baseline ("now" when due)
  function vpEta(eta, timetable) {
    var min = Math.round((eta - Date.now()) / 60000);
    if (min <= 0) return '<span class="now"><span class="vp-u">now</span></span>';
    return '<span><span class="vp-n">' + (timetable ? '~' : '') + min + '</span><span class="vp-u">min</span></span>';
  }
  function vpHero(label, r) {
    return '<div class="vp-hero"><div class="vp-mid"><span class="vp-lbl">' + label + '</span>' +
      '<span class="vp-hname">' + esc(titleCaseBg(r.stop.name) || 'Stop') + '</span></div>' +
      '<div class="vp-eta">' + vpEta(r.eta, !r.realtime) + '</div></div>';
  }
  function vpMine(label, r) {
    return '<div class="vp-mine"><div class="vp-mid"><span class="vp-lbl">' + label + ' · ' + (r.realtime ? '' : '~') + chipClock(r.eta) + '</span>' +
      '<span class="vp-mname">' + esc(titleCaseBg(r.stop.name) || 'Stop') + '</span></div>' +
      '<span class="vp-mmin">' + vpMins(r.eta, !r.realtime) + '</span></div>';
  }
  function vpRow(kind, label, r, color) {
    var mine = kind === 'mine';
    return '<div class="vp-row"><span class="vp-mk' + (mine ? ' mine' : '') + '" style="border-color:' + color + '"></span>' +
      '<span class="vp-mid"><span class="vp-lbl' + (mine ? ' mine' : '') + '">' + label + '</span>' +
      '<span class="vp-name">' + esc(titleCaseBg(r.stop.name) || 'Stop') + '</span></span>' +
      '<span class="vp-when"><span class="vp-min">' + vpMins(r.eta, !r.realtime) + '</span>' +
      (mine ? '<span class="vp-clock">' + chipClock(r.eta) + '</span>' : '') + '</span></div>';
  }
  // collapsed: the next stop, and "your stop" if it's on this run and not passed (only that row if it is the next stop)
  // A bus that reaches your stop only on its way back gets "Your stop · after turning at <terminus>"
  function vpStops(v) {
    if (v !== selected) return '';
    var ret = isReturnGuess(v);
    if (!routeStops.length && !ret) return '';
    var next = routeStops[0], mine = focusedStop && routeStops.filter(function (r) { return r.stop.id === focusedStop.id; })[0];
    if (ret) {
      var t = guessArrival(v, focusedStop, focusGuessEta.g, focusGuessEta.predicted) || focusGuessEta.predicted;
      if (t) mine = { stop: focusedStop, eta: t, realtime: false, ret: true };
    }
    // v100: the next stop is the headline (when it is your stop too, it says so and the tinted row is left out)
    return (next ? vpHero(mine === next ? 'Next stop · your stop' : 'Next stop', next) : '') +
      (mine && mine !== next ? vpMine(mine.ret ? 'Your stop · after turning at ' + esc(titleCaseBg(lastStopName(v))) : 'Your stop', mine) : '');
  }
  // All stops: this run's remaining stops (or the next run's, at the end of the line); tap one to make it "your stop"
  function vpAllStops(v, end) {
    var tid = end ? (v.nextRun && v.nextRun.tripId) : v.d.tripRef, color = v.d.color;
    if (!tid) return '<div class="vp-stops vp-list"><div class="vp-empty">Stops of the next run aren\'t known yet</div></div>';
    if (!tripStopsCache[tid]) {   // timetable not read yet: placeholders, refreshed when it arrives
      loadTripStops(tid).then(function () { refreshVehPopup(v); });
      return '<div class="vp-stops vp-list" aria-busy="true">' + [1, 2, 3].map(function () {
        return '<div class="vp-row"><span class="vp-mk ph"></span><span class="vp-mid"><span class="vp-ph"></span></span></div>';
      }).join('') + '</div>';
    }
    var list = end ? computeRouteStops({ d: { tripRef: tid, curSeq: 0 } }) : routeStops;
    if (!list.length) return '<div class="vp-stops vp-list"><div class="vp-empty">No more stops on this run</div></div>';
    return '<div class="vp-stops vp-list">' + list.map(function (r) {
      var mine = focusedStop && focusedStop.id === r.stop.id;
      return '<button type="button" class="vp-row vp-pick" data-vp-stop="' + esc(r.stop.id) + '" data-vp-eta="' + r.eta + '"' +
        (end ? ' data-vp-run="' + esc(tid) + '"' : '') + ' title="Make this your stop">' +
        '<span class="vp-mk' + (mine ? ' mine' : '') + '" style="border-color:' + color + '"></span>' +
        '<span class="vp-mid"><span class="vp-name">' + esc(titleCaseBg(r.stop.name) || 'Stop') + '</span></span>' +
        '<span class="vp-when"><span class="vp-min">' + vpMins(r.eta, !r.realtime) + '</span>' +
        '<span class="vp-clock">' + (r.realtime ? '' : '~') + chipClock(r.eta) + '</span></span></button>';
    }).join('') + '</div>';
  }
  function vpNextRun(v) {
    var nr = v.nextRun, ni = nr && trips[nr.tripId];
    return '<div class="vp-next">' + VP_ARROW +
      '<span class="vp-mid"><span class="vp-lbl">Next run' + (nr && !nr.linked ? ' · best guess' : '') + '</span>' +
      '<span class="vp-name strong">→ ' + esc(ni ? (titleCaseBg(ni.headsign) || '?') : 'not known yet') + '</span></span>' +
      (nr ? '<span class="vp-min">' + (nr.linked ? '' : '~') + chipClock(nr.t) + '</span>' : '') + '</div>' +
      (v.parked ? '<div class="vp-help">The feed paused while the bus waits. It switches to the new run automatically.</div>' : '');
  }
  function vehPopupHtml(v) {
    var end = vehAtEnd(v), mineFollow = following && v === selected;
    return vpHead(v, end, true) +
      (end ? vpNextRun(v) + (v.allStops ? vpAllStops(v, true) : '') : (v.allStops ? vpAllStops(v, false) : vpStops(v))) +
      '<div class="vp-actions">' +
        '<button type="button" class="vp-btn vp-go" data-vp-follow aria-pressed="' + mineFollow + '">' + (mineFollow ? VP_NAV_ON + 'Following' : VP_NAV + 'Follow') + '</button>' +
        '<button type="button" class="vp-btn vp-all" data-vp-all aria-expanded="' + !!v.allStops + '">' + VP_LIST2 + (v.allStops ? 'Hide stops' : 'All stops') + '</button>' +
      '</div>';
  }
  // the hover popup (PC, untracked vehicle): header and meta line only
  function vehHoverHtml(v) {
    var end = vehAtEnd(v);
    return '<div class="vp vp-hover">' + vpHead(v, end, false) + '</div>';
  }
  function patchVeh(el, v) {
    var html = vehPopupHtml(v), changed = el._html !== html;
    if (changed) {
      var list = el.querySelector('.vp-list'), top = list ? list.scrollTop : 0;
      el.innerHTML = html;
      el._html = html;
      list = el.querySelector('.vp-list');
      if (list && top) list.scrollTop = top;
    }
    var label = vpLabel(v);
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    fillFresh(el, v);
    return changed;
  }
  function vehPopupEl(v) {
    if (!v.popEl) {
      v.popEl = document.createElement('div');
      v.popEl.className = 'vp';
      v.popEl.setAttribute('role', 'dialog');
    }
    return v.popEl;
  }
  // v100: the card hangs below the vehicle on every screen (phones too: before, it opened in the bottom sheet there)
  function bindVehPopup(v, marker) {
    marker.bindPopup(function () {
      var el = vehPopupEl(v), p = marker.getPopup();
      p.options.minWidth = p.options.maxWidth = vpW();   // the width for the current --ui
      patchVeh(el, v);
      return el;
    }, { closeButton: false, className: 'veh-pop vp-below', minWidth: VP_W, maxWidth: VP_W });
    placeBelow(marker.getPopup());
    marker.on('popupclose', function () { v.allStops = false; });
    shrinkOnClose(marker.getPopup());
    marker.on('popupopen', function () { resetShrink(marker.getPopup().getElement()); });
    // v101 (3D view): while the 3D map is open, the card opens there
    var openPopup = marker.openPopup;
    marker.openPopup = function () {
      if (view3d.on && view3d.openVeh) { view3d.openVeh(v, popupNoFocus); return this; }
      return openPopup.apply(this, arguments);
    };
  }
  // Leaflet's popups sit above their spot, placed by their bottom edge. This one is placed by its top edge,
  // VP_GAP below the spot, and "keep it on the screen" checks the card below the spot with the marker above.
  function placeBelow(popup) {
    popup._updatePosition = function () {
      if (!this._map) return;
      // at the exact (fractional) spot, like the tracked vehicle's marker (v90): rounded, the card shook by up to
      // half a pixel against the gliding follow camera
      var pos = this._map.project(this._latlng)._subtract(this._map.getPixelOrigin()), offset = L.point(0, Math.round(VP_GAP * ui)), anchor = this._getAnchor();
      if (this._zoomAnimated) L.DomUtil.setPosition(this._container, pos.add(anchor));
      else offset = offset.add(pos).add(anchor);
      this._containerTop = offset.y;
      this._containerLeft = -Math.round(this._containerWidth / 2) + offset.x;
      var s = this._container.style;
      s.top = offset.y + 'px'; s.bottom = 'auto'; s.left = this._containerLeft + 'px';
    };
    popup._adjustPan = function () {
      if (!this.options.autoPan || !this._map || !this._container) return;
      var map = this._map;
      if (map._panAnim) map._panAnim.stop();
      if (this._autopanning) { this._autopanning = false; return; }
      var at = map.layerPointToContainerPoint(L.DomUtil.getPosition(this._container).add([this._containerLeft, this._containerTop]));
      var w = this._containerWidth, h = this._container.offsetHeight + (parseFloat(L.DomUtil.getStyle(this._container, 'marginTop')) || 0);
      var lift = Math.round(2 * VP_GAP * ui);   // the round marker above the pointer
      var pTL = L.point(this.options.autoPanPaddingTopLeft || this.options.autoPanPadding);
      var pBR = L.point(12, vpBottomPad()), size = map.getSize(), dx = 0, dy = 0;
      if (!isPhone()) {   // PC: beside the panel (on the left) when the card reaches down past its top
        var pr = document.getElementById('panel').getBoundingClientRect();
        if (pr.width && at.y < pr.bottom + 8) pTL = L.point(Math.max(pTL.x, Math.round(pr.right) + 12), pTL.y);
      }
      if (at.x + w + pBR.x > size.x) dx = at.x + w - size.x + pBR.x;
      if (at.x - dx - pTL.x < 0) dx = at.x - pTL.x;
      if (at.y + h + pBR.y > size.y) dy = at.y + h - size.y + pBR.y;
      if (at.y - lift - dy - pTL.y < 0) dy = at.y - lift - pTL.y;   // the vehicle itself stays clear of the panel
      if (dx || dy) { if (this.options.keepInView) this._autopanning = true; map.fire('autopanstart').panBy([dx, dy]); }
    };
  }
  // The open vehicle card and its height on screen, pointer included (kept by a ResizeObserver: the follow
  // camera reads it every frame). body.vp-card while it is open.
  var vpCard = null, vpCardH = 0;
  function vpCardMeasure() {
    var el = vpCard && vpCard.getElement();
    return el ? el.offsetHeight + (parseFloat(getComputedStyle(el).marginTop) || 0) : 0;
  }
  // A card that grows after it opened (a stop row arrives, a long name wraps, All stops) and now runs off the
  // bottom of the screen moves the map once, so its buttons stay reachable. Only on growth: the map is not
  // pulled back while the vehicle drives on or after you drag it away.
  var vpObs = window.ResizeObserver ? new ResizeObserver(function () {
    var was = vpCardH;
    vpCardH = vpCardMeasure();
    if (!vpCard || !was || vpCardH <= was + 2) return;
    var r = vpCard.getElement().getBoundingClientRect();
    if (r.top >= 0 && r.bottom > map.getSize().y - vpBottomPad()) vpKeepInView();
  }) : null;
  map.on('popupopen', function (e) {
    if (!/\bvp-below\b/.test(e.popup.options.className || '')) return;
    vpCard = e.popup; vpCardH = vpCardMeasure();
    if (vpObs) { vpObs.disconnect(); vpObs.observe(e.popup.getElement()); }
    document.body.classList.add('vp-card');
    clearInterval(vpEdgeTimer);
    vpEdgeTimer = setInterval(vpClearEdge, 250);
    vpClearEdge();
  });
  map.on('popupclose', function (e) {
    if (e.popup !== vpCard) return;
    if (vpObs) vpObs.disconnect();
    vpCard = null; vpCardH = 0;
    document.body.classList.remove('vp-card');
    clearInterval(vpEdgeTimer);
    vpClearEdge();
  });
  // The map's own buttons (zoom, location, Follow, the progress bar, the city card) float above everything on the map, the card
  // too. Any the card runs under step aside while it is open, so its own buttons stay visible and tappable.
  var vpEdgeTimer = 0;
  function vpClearEdge() {
    var el = vpCard && vpCard.getElement(), w = el ? el.querySelector('.leaflet-popup-content-wrapper') : view3d.cardEl ? view3d.cardEl() : null, r = w && w.getBoundingClientRect();   // (v101: or the 3D map's card)
    document.querySelectorAll('#follow, #stopProg, #cityCard, .leaflet-control-locate, .leaflet-control-zoom').forEach(function (c) {
      var b = r && r.width ? c.getBoundingClientRect() : null;
      c.classList.toggle('vp-under', !!(b && b.width && b.left < r.right + 6 && b.right > r.left - 6 && b.top < r.bottom + 6 && b.bottom > r.top - 6));
    });
  }
  // screen px under the vehicle's spot that its open card takes (0 when closed)
  function vpCardRoom() { return vpCard ? Math.round(VP_GAP * ui) + (vpCardH || vpCardMeasure()) : 0; }
  // Phones: the card spans the screen, so it keeps above the buttons on the right edge (zoom, location, Follow).
  // Measured at most twice a second (the follow camera asks every frame).
  var vpPad = 12, vpPadAt = 0;
  function vpBottomPad() {
    var now = Date.now();
    if (now - vpPadAt < 500) return vpPad;
    vpPadAt = now;
    if (!isPhone()) return (vpPad = 12);
    var y = map.getSize().y, top = y;
    [document.getElementById('follow'), document.querySelector('.leaflet-control-locate'), document.querySelector('.leaflet-control-zoom')].forEach(function (el) {
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.height && r.top < top) top = r.top;
    });
    return (vpPad = Math.max(12, Math.round(y - top + 10)));
  }
  function vpFreeBottom() { return Math.min(freeBottom(), map.getSize().y - vpBottomPad()); }
  // Where the tracked vehicle goes on screen with its card: marker and card together in the middle of the free
  // map area (below the panel on phones, above the right-edge buttons). room: the card's height, if not open yet.
  function vpTargetY(bottom, room) {
    var top = freeTop(), b = typeof bottom === 'number' ? bottom : vpFreeBottom(), r = typeof room === 'number' ? room : vpCardRoom(), m = 23 * ui;
    return Math.max(top + m + 8, (top + b) / 2 - (r - m) / 2);
  }
  // an opened All stops list makes the card taller downwards: move the map once if it now runs off the screen
  function vpKeepInView() {
    if (!vpCard || following || !vpCard.isOpen()) return;
    var was = vpCard.options.autoPan;
    vpCard.options.autoPan = true; vpCard._adjustPan(); vpCard.options.autoPan = was;
  }
  // However a vehicle popup closes (tap outside, its close button, Stop, Follow from a stop…) it shrinks
  // back into its vehicle in 0.3 s instead of Leaflet's fade-out. Leaflet's onRemove still runs (events,
  // 'popupclose'); only the removal of the element waits for the animation.
  var SHRINK_MS = 300, reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // v90: with the system's "reduce motion" setting, camera moves jump instead of flying or gliding (WCAG 2.3.3;
  // MapLibre does this by itself, Leaflet doesn't). Covers every flight, pan and coast after a drag.
  if (reduceMotion) {
    map.flyTo = function (c, z) { return this.setView(c, z, { animate: false }); };
    map.flyToBounds = function (b, o) { return this.fitBounds(b, L.extend({}, o, { animate: false })); };
    var plainPanBy = map.panBy;
    map.panBy = function (off, o) { return plainPanBy.call(this, off, L.extend({}, o, { animate: false })); };
  }
  // v90: how long a flight takes, from how far it goes: Leaflet's own natural length (0.8 s per "screenful" of
  // its zoom-out-and-in path, van Wijk & Nuij), kept to 0.5–1.0 s. Before, every flight took a fixed 0.6–0.8 s:
  // fine for short hops, a lurch for long ones.
  function flyDur(center, zoom) {
    var z0 = map.getZoom(), size = map.getSize(), w0 = Math.max(size.x, size.y), w1 = w0 * map.getZoomScale(z0, zoom);
    var u1 = map.project(L.latLng(center), z0).distanceTo(map.project(map.getCenter(), z0));
    var rho = 1.42, rho2 = rho * rho, S;
    if (u1 < 1) S = Math.abs(Math.log(w1 / w0)) / rho;
    else {
      var r = function (i) {
        var b = (w1 * w1 - w0 * w0 + (i ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (i ? w1 : w0) * rho2 * u1), sq = Math.sqrt(b * b + 1) - b;
        return sq < 1e-9 ? -18 : Math.log(sq);
      };
      S = (r(1) - r(0)) / rho;
    }
    return isFinite(S) ? Math.max(0.5, Math.min(1.0, 0.8 * S)) : 0.6;
  }
  function shrinkOnClose(popup) {
    var onRemove = popup.onRemove;
    popup.onRemove = function (map) {
      var el = this._container, ll = this._latlng;
      onRemove.call(this, map);
      if (reduceMotion || !map._fadeAnimated || !el || !el.parentNode || !ll) return;   // Leaflet's own removal
      clearTimeout(this._removeTimeout);
      L.DomUtil.setOpacity(el, 1);
      var at = map.latLngToContainerPoint(ll), mr = map.getContainer().getBoundingClientRect();
      ['.leaflet-popup-content-wrapper', '.leaflet-popup-tip-container'].forEach(function (sel) {
        var part = el.querySelector(sel);
        if (!part) return;
        var r = part.getBoundingClientRect();
        part.style.transformOrigin = (mr.left + at.x - r.left) + 'px ' + (mr.top + at.y - r.top) + 'px';
      });
      L.DomUtil.addClass(el, 'vp-into');
      this._removeTimeout = setTimeout(function () { L.DomUtil.remove(el); resetShrink(el); }, SHRINK_MS);
    };
  }
  function resetShrink(el) {
    if (!el || !L.DomUtil.hasClass(el, 'vp-into')) return;
    L.DomUtil.removeClass(el, 'vp-into');
    el.querySelectorAll('.leaflet-popup-content-wrapper, .leaflet-popup-tip-container').forEach(function (part) { part.style.transformOrigin = ''; });
  }
  // refresh an open vehicle popup (on feed updates, route stops, follow changes); rebuilt only if changed
  function refreshVehPopup(v) {
    if (!v || !v.popEl) return;
    if (sheetVeh === v) { patchVeh(v.popEl, v); return; }   // in the bottom sheet: keeps its own scroll
    if (view3d.on && view3d.popOf && view3d.popOf() === v) { patchVeh(v.popEl, v); return; }   // v101: on the 3D map
    var mk = v.dot.isPopupOpen() ? v.dot : (v.pill && v.pill.isPopupOpen() ? v.pill : null);
    if (!mk) return;
    var list = v.popEl.querySelector('.vp-list'), top = list ? list.scrollTop : 0;
    if (patchVeh(v.popEl, v)) {
      mk.getPopup().update();   // new size; Leaflet re-attaches the element, so keep the list where it was
      list = v.popEl.querySelector('.vp-list');
      if (list && top) list.scrollTop = top;
    }
  }
  setInterval(function () {
    if (selected && selected.popEl && selected.popEl.isConnected) fillFresh(selected.popEl, selected);
    if (hoverV) fillFresh(hoverTip.getElement(), hoverV);
  }, 1000);

  // Tapping a stop in All stops makes it "your stop" (green stop, countdown in the tracking bar)
  function vpPickStop(stopId, eta, runTid) {
    var v = selected, st = stops[stopId];
    if (!v || !st) return;
    focusedStop = st;
    focusGuessEta = null;
    if (runTid) {   // a stop of the next run: its time is a best guess until the bus starts that run
      var info = trips[runTid], m = info && info.shape_id && shapes && shapes[info.shape_id] ? metaFor(info.shape_id) : null;
      focusGuessEta = { predicted: eta, g: { sameWay: false, stopOnNew: m ? (stopAlong(m, st, 0) || 0) : 0, tripId: runTid } };
    }
    v.allStops = false;
    drawFocusStop();
    drawRouteStops();
    refreshVehPopup(v);
  }

  function ensurePill(v) {
    if (!v.pill) {
      v.k = iconKey(v.d);
      v.pill = L.marker(v.pos || [v.d.lat, v.d.lon], { icon: iconFor(v.d), keyboard: false });
      // the tracked vehicle's label is placed at its exact position (others on whole pixels), so with the
      // follow camera gliding by fractions of a pixel it stays perfectly still and sharp on screen
      v.pill.update = function () {
        if (this._icon && this._map) {
          this._setPos(v === selected ? exactLayerPoint(this._latlng) : this._map.latLngToLayerPoint(this._latlng));
        }
        return this;
      };
      bindVehPopup(v, v.pill);
      if (isSel(v.d)) v.pill.setZIndexOffset(3000);
      else if (routeVeh[v.d.key]) v.pill.setZIndexOffset(2000);   // v99
      hookSelect(v, v.pill);
      hookHover(v, v.pill);
    }
    return v.pill;
  }

  function upsert(d) {
    var v = vehicles[d.key];
    if (!v) {
      v = vehicles[d.key] = { d: d, dotInMap: false, pillInMap: false };
      v.dot = L.circleMarker([d.lat, d.lon], {
        renderer: canvas, radius: 5, weight: 1.5, color: '#fff', fillColor: d.color, fillOpacity: 1,
        bubblingMouseEvents: false
      });
      bindVehPopup(v, v.dot);
      hookSelect(v, v.dot);
      hookHover(v, v.dot);
      planMotion(v, true);
      return;
    }
    var oldColor = v.d.color;
    var moved = d.metroPlan !== v.d.metroPlan || d.lat !== v.d.lat || d.lon !== v.d.lon || d.ts !== v.d.ts;
    var oldTrip = v.d.tripRef, tripChanged = oldTrip !== d.tripRef;
    // After a long gap — the page sat in the background or the computer slept (staleFeed), or this
    // vehicle was missing from the feed for a while — its last position is old. Animating from there
    // sends it gliding across the map from a strange spot, so it jumps straight to where it is now.
    var stale = staleFeed || (d.ts && v.d.ts && d.ts - v.d.ts > STALE_REPORT_S);
    v.d = d;
    if (tripChanged || stale) { v.along = null; v.lastRep = null; v.mo = null; moved = true; }   // a new run / old position: start fresh
    if (moved) planMotion(v, stale);
    if (tripChanged && v === selected) setTimeout(function () { if (selected === v) onTripChange(v, !!oldTrip); }, 0);
    if (oldColor !== d.color) v.dot.setStyle({ fillColor: d.color });
    if (v.pill) {
      var k = iconKey(d);
      if (k !== v.k) { v.k = k; v.pill.setIcon(iconFor(d)); keepTop(v); }
    }
    refreshVehPopup(v);
    if (hoverV === v) { hoverTip.setContent(vehHoverHtml(v)); fillFresh(hoverTip.getElement(), v); }
  }

