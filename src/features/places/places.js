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
    var markerPaths = {
      Home: 'M2 10l6-5 6 5v7h-4v-5H6v5H2z',
      Work: 'M2 8h12v9H2z M5 8V5h6v3 M2 11h12',
      Star: 'M8 4l2 4 4.5.6-3.2 3.2.8 4.5L8 14.2l-4.1 2.1.8-4.5L1.5 8.6 6 8z'
    };
    function markerName(p) {
      return Object.prototype.hasOwnProperty.call(markerPaths, p.marker) ? p.marker : 'Flag';
    }
    function markerColor(p) {
      return typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '';
    }
    function labelOpen(p) {
      var color = markerColor(p);
      if (!color) return '<div class="pin-lbl">';
      var channels = color.slice(1).match(/../g).map(function (hex) {
        var value = parseInt(hex, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      var luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      return '<div class="pin-lbl custom" style="background:' + color + ';color:' + (luminance > 0.179 ? '#000' : '#fff') + '">';
    }
    function markerSvg(p) {
      var svg = markerShape(p), color = markerColor(p);
      return color ? svg.replace('<svg ', '<svg style="color:' + color + '" ') : svg;
    }
    function markerShape(p) {
      var name = markerName(p);
      if (name === 'Flag') return FLAG_SVG;
      return '<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M5 30C5 24 1 19 1 13a12 12 0 1 1 24 0c0 8-12 12-20 17z" fill="currentColor" stroke="white" stroke-width="1.4"/>' +
        '<path transform="translate(5 1)" d="' + markerPaths[name] + '" fill="none" stroke="white" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    }
    var editor = null, menuId = '';
    function preview(p) {
      return editor && editor.id === p.id ? Object.assign({}, p, editor) : p;
    }
    function pinIcon(p) {
      p = preview(p);
      return L.divIcon({ className: 'pin-mk' + (p.id === destId ? ' dest' : ''), iconSize: null,
        html: '<div class="pin-ic">' + markerSvg(p) + '</div>' + labelOpen(p) + esc(p.name) + '</div>' });
    }
    function markerEditor(p) {
      var choices = ['Flag', 'Home', 'Work', 'Star'].map(function (name) {
        var glyph = name === 'Flag' ? '<path d="M3 18V3m0 1c4-3 7 3 12 0v8c-5 3-8-3-12 0"/>' :
          '<path d="' + markerPaths[name] + '"/>';
        return '<button type="button" data-pin-act="marker" data-marker="' + name + '" aria-label="' + name +
          '" aria-pressed="' + (p.marker === name) + '"><svg viewBox="0 0 18 21">' + glyph + '</svg></button>';
      }).join('');
      return '<header><button type="button" data-pin-act="back" aria-label="Back">←</button><strong>Edit marker</strong></header>' +
        '<div class="ticket-label">Icon</div><div class="ticket-icons" role="group" aria-label="Marker icon">' + choices + '</div>' +
        '<div class="ticket-color"><label>Color <input type="color" data-pin-color value="' +
        (p.color || (p.id === destId ? '#d6336c' : '#495057')) + '"></label><button type="button" data-pin-act="reset-color"' +
        (p.color ? '' : ' disabled') + '>Reset</button></div><button type="button" class="ticket-primary" data-pin-act="save">Save changes</button>';
    }
    function pinPopupHtml(p) {
      var open = menuId === p.id;
      var main = '<header><strong>' + esc(p.name) + '</strong><button type="button" data-pin-act="more" aria-label="More options" aria-expanded="' +
        open + '">•••</button></header><button type="button" class="ticket-primary" data-pin-act="route">' + ROUTE_SVG +
        'Start route</button><button type="button" class="ticket-dest" data-pin-act="dest">' +
        (p.id === destId ? 'Clear destination' : 'Set as destination') + '</button>';
      if (open) main += '<div class="ticket-menu" role="group" aria-label="Place options">' +
        '<button type="button" data-pin-act="edit">' + EDIT_SVG + 'Edit marker</button>' +
        '<button type="button" data-pin-act="rename">' + EDIT_SVG + 'Rename</button>' +
        '<button type="button" data-pin-act="move">' + MOVE_SVG + 'Move pin</button>' +
        '<button type="button" data-pin-act="del">' + DEL_SVG + 'Delete saved place</button></div>';
      return '<div class="place-ticket" data-pin="' + esc(p.id) + '">' +
        (editor && editor.id === p.id ? markerEditor(editor) : main) + '</div>';
    }
    function refreshTicket(p, focusSelector) {
      var mk = pinMarkers[p.id];
      if (mk && mk.isPopupOpen()) mk.getPopup().update();
      if (view3d.on) view3d.placesChanged(true);
      if (focusSelector) {
        var target = document.querySelector('.place-ticket ' + focusSelector);
        if (target) target.focus({ preventScroll: true });
      }
    }
    function closeTicket(id) {
      if (menuId === id) menuId = '';
      if (editor && editor.id === id) {
        editor = null;
        redrawPins();
      }
    }
    // markers follow the library
    function redrawPins() {
      var seen = {};
      places.forEach(function (p) {
        var id = p.id, key = markerColor(preview(p)) + markerName(preview(p)) + '|' + p.name + '|' + (id === destId), mk = pinMarkers[id];
        seen[id] = true;
        if (!mk) {
          mk = pinMarkers[id] = L.marker([p.lat, p.lon], { icon: pinIcon(p), pane: 'pinPane', draggable: true, autoPan: true, keyboard: false });
          mk._key = key;
          mk.bindPopup(function () { var q = placeById(id); return q ? pinPopupHtml(q) : ''; }, { className: 'pin-pop', closeButton: false, offset: [0, -28], maxWidth: 260 });
          mk.on('popupclose', function () { closeTicket(id); });
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
          '<button type="button" class="pl-go" data-pin-act="go" title="Show on the map and go there">' + markerSvg(p) +
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
    document.addEventListener('input', function (event) {
      if (!editor || !event.target.matches('[data-pin-color]')) return;
      editor.color = event.target.value;
      event.target.closest('.ticket-color').querySelector('button').disabled = false;
      redrawPins();
    }, true);
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
        if (mk && mk.isPopupOpen()) mk.getPopup().update();
      }
      else if (act === 'more') {
        menuId = menuId === p.id ? '' : p.id;
        refreshTicket(p, menuId ? '[data-pin-act="edit"]' : '[data-pin-act="more"]');
      }
      else if (act === 'edit') {
        menuId = '';
        editor = { id: p.id, marker: markerName(p), color: markerColor(p) };
        refreshTicket(p, '[aria-pressed="true"]');
      }
      else if (editor && editor.id === p.id && (act === 'reset-color' || act === 'marker')) {
        if (act === 'marker') editor.marker = b.dataset.marker;
        else editor.color = '';
        redrawPins();
        refreshTicket(p, act === 'marker' ? '[aria-pressed="true"]' : '[data-pin-color]');
      }
      else if (editor && editor.id === p.id && (act === 'save' || act === 'back')) {
        if (act === 'save') {
          p.marker = editor.marker;
          if (editor.color) p.color = editor.color; else delete p.color;
          savePlaces();
          renderPlaces();
        }
        editor = null;
        redrawPins();
        refreshTicket(p, '[data-pin-act="more"]');
      }
      else if (act === 'move') startPlacing({ p: p });
      else if (act === 'rename') { menuId = ''; refreshTicket(p); openPinDlg('Rename place', p.name, function (name) { p.name = name; savePlaces(); redrawPins(); renderPlaces(); refreshTicket(p); }); }
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
      if (menuId || editor) {
        var p = placeById(menuId || editor.id);
        if (p) { e.stopPropagation(); closeTicket(p.id); refreshTicket(p, '[data-pin-act="more"]'); return; }
      }
      if (!pinDlg.hidden) closePinDlg(); else if (placing) endPlacing();
    }, true);

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
      markerSvg: markerSvg,
      labelOpen: labelOpen,
      popupHtml: pinPopupHtml,
      preview: preview,
      editing: function (id) { return !!editor && editor.id === id; },
      closeTicket: closeTicket,
      add: addPlace
    };
  })();
