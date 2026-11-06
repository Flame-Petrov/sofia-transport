  // ---------- Follow button ----------
  var following = false;
  function setFollow(on) {
    following = on;
    if (on) setLocFollow(false);   // one camera at a time: following a vehicle ends following you
    map.options.touchZoom = on ? 'center' : true;   // a pinch keeps the middle in place while following
    lookFor = null; lookAt = 0;   // the look-ahead lean starts again from the centre
    followCam.off = null;
    document.getElementById('follow').classList.toggle('on', on);
    refreshVehPopup(selected);   // the popup's Follow button shows the same state
    if (view3d.on && view3d.followChanged) view3d.followChanged(on);   // v102: the 3D camera follows (heading-up)
    if (!on) {
      // the follow camera leaves the map at a fraction of a pixel: settle it on whole pixels
      var pp = map._getMapPanePos(), frac = L.point(pp.x - Math.round(pp.x), pp.y - Math.round(pp.y));
      if (frac.x || frac.y) {
        map._rawPanBy(frac);
        map.fire('move');
        if (glLayer && glLayer._glMap) { try { glLayer._update(); } catch (e) {} }
      }
      map.fire('moveend');   // let the layers settle where the camera stopped
    }
    // Follow switched on for a vehicle picked from a stop (the camera is zoomed out on its way to the
    // stop): first its popup closes (tracking and Follow carry on), then the camera flies in to the
    // vehicle at zoom 15, landing where the follow camera keeps it
    if (on && selected && selected.pos && focusedStop) {
      var v = selected;
      followHold = true;   // the follow camera waits until the popup is gone and the flight has started
      shrinkVehPopup(v, function () {
        followHold = false;
        if (selected !== v || !following) return;
        flyInToFollow(v);
      });
    }
  }
  // The open vehicle popup shrinks back into the vehicle (0.3 s), then closes for real
  function shrinkVehPopup(v, done) {
    if (sheetVeh === v) { closeSheet(); done(); return; }   // phones: the sheet just closes
    if (view3d.on && view3d.popOf && view3d.popOf() === v) { view3d.closePop(); done(); return; }   // v101
    var mk = v.dot.isPopupOpen() ? v.dot : v.pill && v.pill.isPopupOpen() ? v.pill : null;
    if (!mk) { done(); return; }
    mk.closePopup();   // shrinks back into the vehicle (shrinkOnClose)
    setTimeout(done, reduceMotion ? 0 : SHRINK_MS);
  }
  // v90: it lands where the vehicle will be when the flight ends, with the look-ahead lean already applied,
  // so the follow camera carries on without a second move (before: it aimed at where the vehicle was at
  // take-off, without the lean, then glided to the vehicle and eased the lean in over ~1.2 s).
  function flyInToFollow(v) {
    if (view3d.on && view3d.flyFollow) { view3d.flyFollow(v); return; }   // v102: the same flight on the 3D map
    var size = map.getSize(), top = freeTop(), bottom = freeBottom(), z = FOLLOW_STOP_ZOOM, room = vpCardRoom();
    if (room) bottom = vpFreeBottom();   // v100: with its card open, the vehicle goes above the card
    var lean = lookAhead(v, size.x, Math.max(0, bottom - top - room));   // screen px, the same at any zoom
    lookFor = v; lookOff = lean; lookAt = 0;
    var dur = flyDur(v.pos, z);
    var at = posAt(v, Date.now() + dur * 1000) || v.pos;
    var target = L.point(size.x / 2, room ? vpTargetY(bottom) : top + (bottom - top) / 2).subtract(lean);
    var center = map.unproject(map.project(at, z).subtract(target.subtract(size.divideBy(2))), z);
    map.flyTo(center, z, { duration: dur });
  }
  var FOLLOW_STOP_ZOOM = 15, followHold = false;
  document.getElementById('follow').onclick = function () { setFollow(!following); };
  // v90: dragging the map takes over from a following camera (vehicle Follow, your location) once the finger
  // has moved it DRAG_TAKEOVER_PX — a tap that wobbles a few pixels no longer ends Follow. Below that the
  // camera only pauses, and glides back when the finger lifts (no coasting).
  var DRAG_TAKEOVER_PX = 25, dragFrom = null;
  map.on('dragstart', function () { dragFrom = map._getMapPanePos(); });
  map.on('drag', function () {
    if (!dragFrom || map._getMapPanePos().distanceTo(dragFrom) < DRAG_TAKEOVER_PX) return;
    dragFrom = null;
    if (following) setFollow(false);
    setLocFollow(false);
  });
  map.on('dragend', function () {
    if (dragFrom && (following || (loc && loc.follow))) setTimeout(function () { map.stop(); }, 0);
    dragFrom = null;
  });

  // While following, zooming (mouse wheel, double-click, the +/- buttons) happens around the followed
  // vehicle, not around the mouse or the middle of the map: the vehicle stays exactly where it is on
  // screen and only the map scales around it, in Leaflet's normal animated zoom. Before, the zoom went
  // around the mouse, the vehicle was thrown off its spot and the camera then had to glide back.
  function followPoint() {
    return following && selected && selected.pos ? exactLayerPoint(selected.pos).add(map._getMapPanePos()) : null;
  }
  var zoomAround = map.setZoomAround;
  map.setZoomAround = function (at, zoom, options) {
    var fp = followPoint();
    return zoomAround.call(this, fp || at, zoom, options);
  };
  ['zoomIn', 'zoomOut'].forEach(function (name) {
    var orig = map[name];
    map[name] = function (delta, options) {
      if (view3d.on && view3d.zoomBy) { view3d.zoomBy(name === 'zoomIn' ? 1 : -1); return this; }   // v100: the buttons zoom the 3D map
      var fp = followPoint();
      if (!fp || !this._loaded) return orig.call(this, delta, options);
      delta = delta || (this.options.zoomDelta || 1);
      return this.setZoomAround(fp, this.getZoom() + (name === 'zoomIn' ? delta : -delta), options);
    };
  });

