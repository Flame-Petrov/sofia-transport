  // ---------- Markers ----------
  var vehicles = {};  // key -> { d, dot, pill, k }
  var lastFeedTime = 0;

  // v99: while a route is open, the vehicles of its main way: key -> { tag, stopId (where you board it), guess }
  var routeVeh = {};
  // v100: the tracked vehicle's glyph (white on its line's colour; dark on light lines)
  var VEH_GLYPH = {
    3: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18 11H6V6h12v5z"/></svg>',
    11: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.5 6.2 7 1.5M14.5 6.2 17 1.5"/><path fill="currentColor" d="M5 17.2c0 .7.3 1.33.8 1.78V20.6c0 .44.36.8.8.8h.8c.44 0 .8-.36.8-.8v-.8h7.6v.8c0 .44.36.8.8.8h.8c.44 0 .8-.36.8-.8V19c.5-.45.8-1.08.8-1.78V9.4C19 6.6 16.1 6.2 12 6.2S5 6.6 5 9.4v7.8zm2.8.8a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm8.4 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zM17.4 13H6.6V9.2h10.8V13z"/></svg>',
    0: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12 5.2V2.6M8.6 1.8h6.8M8 20.4l-1.8 2.4M16 20.4l1.8 2.4"/><path fill="currentColor" fill-rule="evenodd" d="M8.4 5.2h7.2A3.4 3.4 0 0 1 19 8.6v8.2a3.4 3.4 0 0 1-3.4 3.4H8.4A3.4 3.4 0 0 1 5 16.8V8.6a3.4 3.4 0 0 1 3.4-3.4zM7 8.6v4.6h10V8.6zm1.8 6.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm6.4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/></svg>',
    1: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M8 20.2l-2 2.6M16 20.2l2 2.6"/><path fill="currentColor" fill-rule="evenodd" d="M12 2c4.4 0 7 .9 7 4.2v10.4a3.6 3.6 0 0 1-3.6 3.6H8.6A3.6 3.6 0 0 1 5 16.6V6.2C5 2.9 7.6 2 12 2zM7 6.4v5.4h4.2V6.4zm5.8 0v5.4H17V6.4zM8.6 14.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm6.8 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/></svg>'
  };
  function iconFor(d) {
    if (isSel(d)) {   // v100: round marker (the card below it names the line; the route's arrows show the way)
      var rs = routeVeh[d.key];
      return L.divIcon({
        className: 'veh', iconSize: null,
        html: '<div class="pill sel vsel' + (isParked(d) ? ' parked' : '') + (rs ? ' mine' : '') + '" style="background-color:' + d.color + ';color:' + lineTones(d.color).ink + '">' +
          (VEH_GLYPH[d.type] || VEH_GLYPH[3]) + (rs ? '<span class="vtag">' + esc(rs.tag) + '</span>' : '') + '</div>'
      });
    }
    var arrow = (typeof d.bearing === 'number')
      ? '<span class="dir" style="transform:rotate(' + Math.round(d.bearing - 90) + 'deg)">&#10148;</span>' : '';
    var rv = routeVeh[d.key];
    return L.divIcon({
      className: 'veh', iconSize: null,
      html: '<div class="pill' + (d.hasLine ? '' : ' noline') + (isSel(d) ? ' sel' : '') + (isParked(d) ? ' parked' : '') + (rv ? ' mine' : '') + '" style="background:' + d.color + ';color:' + lineTones(d.color).ink + '">' + esc(d.shown) + arrow +
        (rv ? '<span class="vtag">' + esc(rv.tag) + '</span>' : '') + '</div>'
    });
  }
  function iconKey(d) { return d.shown + '|' + d.color + '|' + (typeof d.bearing === 'number' ? Math.round(d.bearing / 10) : '-') + (isSel(d) ? '|sel' : '') + (isParked(d) ? '|p' : '') + (routeVeh[d.key] ? '|m' + routeVeh[d.key].tag : ''); }
  function isParked(d) { var v = vehicles[d.key]; return !!(v && v.parked); }
  function isSel(d) { return !!(selected && selected.d.key === d.key); }
  // The tracked vehicle is drawn bigger (label 1.6×, dot larger) and on top of the others
  // v90: the tracked vehicle is placed at its exact (fractional) position. Leaflet rounds markers to whole
  // pixels, so while the follow camera held the vehicle's exact point still, its drawn icon crept and then
  // jumped 1 px (3.5 device px on a phone) every few frames. Only this vehicle: rounding keeps the rest crisp.
  function exactProject() { this._point = this._map.project(this._latlng)._subtract(this._map.getPixelOrigin()); this._updateBounds(); }
  function exactUpdate() {
    if (this._icon && this._map) this._setPos(this._map.project(this._latlng)._subtract(this._map.getPixelOrigin()));
    return this;
  }
  function markVehicle(v, on) {
    if (!v) return;
    if (on) { v.dot._project = exactProject; if (v.pill) v.pill.update = exactUpdate; }
    else { delete v.dot._project; if (v.pill) delete v.pill.update; }
    cancelAnimationFrame(v.dot._tween);   // a hover animation must not undo this
    v.dot.setRadius(v.dot._hovered ? (on ? 12 : 9) : (on ? 9 : 5));
    v.dot.setStyle({ weight: on ? 3 : 1.5 });
    if (on && v.dotInMap) v.dot.bringToFront();
    if (v.pill) {
      v.k = iconKey(v.d);
      v.pill.setIcon(iconFor(v.d));
      v.pill.setZIndexOffset(on ? 3000 : routeVeh[v.d.key] ? 2000 : 0);   // v99: your way's vehicles over the others
      raise(v.pill, on);
    }
    render(false);   // tracked vehicle shows as a label even when zoomed out
    if (view3d.on) view3d.selectChanged();   // v101
  }
  function keepTop(v) { if (v && v.pill && v === selected) raise(v.pill, true); }

