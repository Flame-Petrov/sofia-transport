  // ---------- My places (v75): named flags anywhere on the map; one of them is your destination ----------
  // A library of places (Home, Work, …) saved on the device (localStorage 'sofia_places'). Add one with
  // "New place" in the panel (name it, then tap the map) or by long-pressing the map (right-click on PC).
  // Drag a flag to move it, or Move + tap the map. Picking a place in the list makes it your destination
  // (pink flag, 'sofia_dest'); with your location on, a dotted line and the distance lead there.
  var savedPlaces = (function () {
    var PLACES_MAX = 50;
    map.createPane('pinPane').style.zIndex = 615;   // over vehicles and stops, under your location dot
    var places = [], destId = store('sofia_dest') || '', pinMarkers = {}, destLine = null, placing = null, plHtml = '';
    try {
      places = (JSON.parse(store('sofia_places') || '[]') || []).filter(function (p) {
        return p && p.id && p.name && isFinite(p.lat) && isFinite(p.lon);
      });
    } catch (e) { places = []; }
    if (destId && !placeById(destId)) destId = '';
    function savePlaces() { store('sofia_places', JSON.stringify(places)); store('sofia_dest', destId); }
    function placeById(id) { for (var i = 0; i < places.length; i++) if (places[i].id === id) return places[i]; return null; }
    function distFromMe(p) {
      return loc && loc.fix && loc.state === 'on' ? distM([loc.fix.ll.lat, loc.fix.ll.lng], [p.lat, p.lon]) : null;
    }
    function pinIcon(p) {
      return L.divIcon({ className: 'pin-mk' + (p.id === destId ? ' dest' : ''), iconSize: null,
        html: '<div class="pin-ic">' + FLAG_SVG + '</div><div class="pin-lbl">' + esc(p.name) + '</div>' });
    }
    function pinPopupHtml(p) {
      var d = distFromMe(p), isDest = p.id === destId;
      return '<div class="pp" data-pin="' + esc(p.id) + '"><div class="pp-name">' + esc(p.name) + '</div>' +
        '<div class="pp-sub">' + (d !== null ? fmtM(d) + ' from you' : isDest ? 'Your destination' : 'Saved place') + '</div>' +
        '<div class="pp-btns"><button type="button" class="pp-route" data-pin-act="route">' + ROUTE_SVG + 'Start route</button>' +
        '<button type="button" class="pp-dest' + (isDest ? ' on' : '') + '" data-pin-act="dest">' +
          (isDest ? 'Clear destination' : 'Set as destination') + '</button>' +
        '<button type="button" data-pin-act="move">Move</button><button type="button" data-pin-act="rename">Rename</button>' +
        '<button type="button" class="pp-del" data-pin-act="del">Delete</button></div></div>';
    }
    // markers follow the library
    function redrawPins() {
      var seen = {};
      places.forEach(function (p) {
        var id = p.id, key = p.name + '|' + (id === destId), mk = pinMarkers[id];
        seen[id] = true;
        if (!mk) {
          mk = pinMarkers[id] = L.marker([p.lat, p.lon], { icon: pinIcon(p), pane: 'pinPane', draggable: true, autoPan: true, keyboard: false });
          mk._key = key;
          mk.bindPopup(function () { var q = placeById(id); return q ? pinPopupHtml(q) : ''; }, { className: 'pin-pop', offset: [0, -28], maxWidth: 260 });
          mk.on('dragstart', function () { mk.closePopup(); });
          mk.on('dragend', function () {
            var q = placeById(id), ll = mk.getLatLng();
            if (!q) return;
            q.lat = +ll.lat.toFixed(6); q.lon = +ll.lng.toFixed(6);
            savePlaces(); drawDestLine();
            if (route && route.placeId === id) { route.fitted = false; route.ways = []; routeSearch(); }   // v93
          });
          mk.addTo(map);
        } else {
          if (mk._key !== key) { mk.setIcon(pinIcon(p)); mk._key = key; }
          if (!mk.getLatLng().equals([p.lat, p.lon])) mk.setLatLng([p.lat, p.lon]);
        }
        mk.setZIndexOffset(id === destId ? 1000 : 0);
      });
      Object.keys(pinMarkers).forEach(function (id) {
        if (!seen[id]) { map.removeLayer(pinMarkers[id]); delete pinMarkers[id]; }
      });
      updateDestLabel();
    }
    // the destination's label also shows how far it is
    function updateDestLabel() {
      if (view3d.on) view3d.placesChanged();   // v100: the flags on the 3D map follow the library too
      var p = placeById(destId), mk = p && pinMarkers[p.id], el = mk && mk.getElement(), lbl = el && el.querySelector('.pin-lbl');
      if (!lbl) return;
      var d = distFromMe(p), html = esc(p.name) + (d !== null ? ' <small>· ' + fmtM(d) + '</small>' : '');
      if (lbl._h !== html) { lbl.innerHTML = html; lbl._h = html; }
    }
    // dotted line from you to your destination (needs your location)
    function drawDestLine() {
      var p = placeById(destId);
      if (!p || !loc.fix || loc.state !== 'on' || (route && route.ways && route.ways.length)) {   // v93: a route shows the real way
        if (destLine) { map.removeLayer(destLine); destLine = null; }
      } else {
        var pts = [loc.fix.ll, L.latLng(p.lat, p.lon)];
        if (!destLine) {
          destLine = L.polyline(pts, { renderer: meSvg, pane: 'meAccPane', interactive: false, color: '#D6336C',
            weight: 3, opacity: 0.85, dashArray: '1 8', lineCap: 'round' }).addTo(map);
        } else destLine.setLatLngs(pts);
      }
      updateDestLabel();
      renderPlaces();
    }
    function setDest(id) {
      destId = id || '';
      savePlaces(); redrawPins(); drawDestLine();
    }
    function addPlace(name, ll) {
      if (places.length >= PLACES_MAX) { toast('You have ' + PLACES_MAX + ' places — delete one to add another.'); return; }
      var p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name,
                lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) };
      places.push(p);
      setDest(p.id);   // a new flag is where you want to go
      toast('“' + name + '” saved. It’s your destination now.', 3000);
    }
    function deletePlace(p) {
      places = places.filter(function (q) { return q !== p; });
      if (destId === p.id) destId = '';
      if (route && route.placeId === p.id) endRoute();   // v93
      map.closePopup();
      savePlaces(); redrawPins(); drawDestLine();
    }
    // Show a place: becomes your destination; with your location on, both you and it come into view
    function goToPlace(p) {
      if (destId !== p.id) setDest(p.id);
      var mk = pinMarkers[p.id];
      if (!mk) return;
      setLocFollow(false);
      var me = loc.fix && loc.state === 'on' ? loc.fix.ll : null;
      if (me && distM([me.lat, me.lng], [p.lat, p.lon]) < 30000) {
        var size = map.getSize();
        map.flyToBounds(L.latLngBounds([me, mk.getLatLng()]), {
          paddingTopLeft: [50, freeTop() + 60], paddingBottomRight: [70, size.y - freeBottom() + 40], maxZoom: 17, duration: 0.8 });
      } else {
        mk.openPopup();
        focusOn(mk.getLatLng(), mk.getPopup());
      }
    }

    // ---- the list in the panel ----
    function renderPlaces() {
      document.getElementById('plCount').textContent = places.length ? String(places.length) : '';
      var html = places.map(function (p) {
        var d = distFromMe(p), n = esc(p.name), isDest = p.id === destId;
        return '<div class="pl-item' + (isDest ? ' dest' : '') + '" role="listitem" data-pin="' + esc(p.id) + '">' +
          '<button type="button" class="pl-go" data-pin-act="go" title="Show on the map and go there">' + FLAG_SVG +
            '<span class="pl-n">' + n + '</span>' +
            (d !== null ? '<span class="pl-d">' + fmtM(d) + '</span>' : isDest ? '<span class="pl-d">destination</span>' : '') + '</button>' +
          '<button type="button" class="pl-act pl-route" data-pin-act="route" title="Start route" aria-label="Start route to ' + n + '">' + ROUTE_SVG + '</button>' +
          '<button type="button" class="pl-act" data-pin-act="move" title="Move (tap the map)" aria-label="Move ' + n + '">' + MOVE_SVG + '</button>' +
          '<button type="button" class="pl-act" data-pin-act="rename" title="Rename" aria-label="Rename ' + n + '">' + EDIT_SVG + '</button>' +
          '<button type="button" class="pl-act" data-pin-act="del" title="Delete" aria-label="Delete ' + n + '">' + DEL_SVG + '</button></div>';
      }).join('');
      if (html !== plHtml) { plHtml = html; document.getElementById('plList').innerHTML = html; }
    }
    function setPlacesOpen(on) {
      reveal(document.getElementById('plBody'), on);
      document.getElementById('plBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
      store('sofia_places_open', on ? '1' : '0');
    }
    document.getElementById('plBtn').onclick = function () { setPlacesOpen(!isRevealed(document.getElementById('plBody'))); };
    document.getElementById('plAdd').onclick = function () {
      openPinDlg('New place', '', function (name) { startPlacing({ name: name }); });
    };
    // buttons in the list and in a flag's popup (capture: Leaflet stops clicks inside popups from bubbling)
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('[data-pin-act]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var box = b.closest('[data-pin]'), p = box && placeById(box.getAttribute('data-pin')), act = b.getAttribute('data-pin-act');
      if (!p) return;
      if (act === 'go') goToPlace(p);
      else if (act === 'route') startRoute(p);   // v93
      else if (act === 'dest') {
        setDest(destId === p.id ? '' : p.id);
        var mk = pinMarkers[p.id];
        if (mk && mk.isPopupOpen()) mk.getPopup().setContent(pinPopupHtml(p));
      }
      else if (act === 'move') startPlacing({ p: p });
      else if (act === 'rename') openPinDlg('Rename place', p.name, function (name) { p.name = name; savePlaces(); redrawPins(); renderPlaces(); });
      else if (act === 'del') {
        if (!b.classList.contains('confirm')) {   // first tap asks, a second one within 3 s deletes
          var was = b.innerHTML;
          b.classList.add('confirm');
          b.textContent = box.classList.contains('pl-item') ? 'Delete?' : 'Tap again to delete';
          setTimeout(function () { if (b.isConnected) { b.classList.remove('confirm'); b.innerHTML = was; } }, 3000);
          return;
        }
        deletePlace(p);
      }
    }, true);

    // ---- putting a flag down: tap the map ----
    function startPlacing(job) {
      // v100: flags are put down and moved on the flat map (tapping a spot on a tilted map is imprecise)
      if (view3d.on) { view3d.close('placing a flag'); toast('Placing a flag works in 2D.', 3000); }
      placing = job;
      map.closePopup();
      if (sheetStop || sheetVeh) closeSheet();
      document.getElementById('map').classList.add('placing');
      document.getElementById('placeTxt').innerHTML = 'Tap the map to place <b>' + esc(job.p ? job.p.name : job.name) + '</b>';
      document.getElementById('placeBar').hidden = false;
      if (isPhone()) setFolded(true);   // more map to tap on
    }
    function endPlacing() {
      placing = null;
      document.getElementById('map').classList.remove('placing');
      document.getElementById('placeBar').hidden = true;
    }
    document.getElementById('placeCancel').onclick = endPlacing;
    map.on('click', function (e) {
      if (!placing) return;
      var job = placing;
      endPlacing();
      if (job.p) {
        job.p.lat = +e.latlng.lat.toFixed(6); job.p.lon = +e.latlng.lng.toFixed(6);
        savePlaces(); redrawPins(); drawDestLine();
        if (route && route.placeId === job.p.id) { route.fitted = false; route.ways = []; routeSearch(); }   // v93
      } else addPlace(job.name, e.latlng);
    });
    // long-press on a phone / right-click on PC: a new place right there
    map.on('contextmenu', function (e) {
      if (placing || !e.latlng) return;
      openPinDlg('New place here', '', function (name) { addPlace(name, e.latlng); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!pinDlg.hidden) closePinDlg(); else if (placing) endPlacing();
    });

    redrawPins();
    renderPlaces();
    if (store('sofia_places_open') === '1') setPlacesOpen(true);

    return {
      find: placeById,
      forEach: function (visit) { places.forEach(visit); },
      get destinationId() { return destId; },
      get destinationLine() { return destLine; },
      get isPlacing() { return !!placing; },
      cancelPlacement: endPlacing,
      setDestination: setDest,
      refreshDestination: drawDestLine,
      distanceFromMe: distFromMe,
      popupHtml: pinPopupHtml,
      add: addPlace
    };
  })();
