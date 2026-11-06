  // ---------- Performance overlay ----------
  // Live zoom, which zoom-dependent features are on, FPS (+ worst frame) and what's drawn in view.
  // Its own frame loop runs only while the overlay is on (also during zooms, when the app's animation
  // pauses); the text is refreshed at most 4× a second and only changed values touch the page.
  var buildingMinZoom = null;   // minzoom of the vector style's 3D building layer (style zoom units)
  var labelsBySearch = false;   // a search leaves few enough vehicles for labels at any zoom
  var perfOn = false, perfRaf = 0, perfFrames = [], perfLastText = 0, perfSpark = [], perfLowSince = 0, perfLogged = false;
  var perfEl = document.getElementById('perf');
  var pf = {};
  ['pfZoom', 'pfLab', 'pfStop', 'pfBld', 'pfFps', 'pfCnt'].forEach(function (id) { pf[id] = document.getElementById(id); });

  function perfSet(el, text, cls) {
    if (el._t !== text) { el._t = text; el.textContent = text; }
    if (cls !== undefined && el._c !== cls) { el._c = cls; el.className = cls; }
  }
  function countInView(layer, minLat, maxLat, minLng, maxLng) {
    var n = 0;
    layer.eachLayer(function (l) {
      if (l.getLatLng) {
        var ll = l.getLatLng();
        if (ll.lat >= minLat && ll.lat <= maxLat && ll.lng >= minLng && ll.lng <= maxLng) n++;
      }
    });
    return n;
  }
  function perfFrame(now) {
    if (!perfOn) { perfRaf = 0; return; }
    perfRaf = requestAnimationFrame(perfFrame);
    perfFrames.push(now);
    while (perfFrames.length && now - perfFrames[0] > 1000) perfFrames.shift();
    if (now - perfLastText >= 250) { perfLastText = now; perfText(now); }
  }
  function perfText(now) {
    var z = viewZoom(), phone = isPhone(), cam3 = view3d.on && view3d.camText ? ' ' + view3d.camText() : '';   // v100
    // frames in the last second, and the longest gap between two of them
    var fps = perfFrames.length > 1 ? Math.round((perfFrames.length - 1) * 1000 / (perfFrames[perfFrames.length - 1] - perfFrames[0])) : 0;
    var worst = 0;
    for (var i = 1; i < perfFrames.length; i++) worst = Math.max(worst, perfFrames[i] - perfFrames[i - 1]);
    worst = Math.round(worst);

    var stopZ = searchStops !== null ? 11 : STOP_ZOOM;
    var vector = /^vector/.test(mapMode), image = /^image/.test(mapMode);
    // the vector map is drawn one zoom level below Leaflet's (512 px tiles), so style zoom N shows at Leaflet zoom N + 1
    var bldZ = vector && buildingMinZoom !== null ? buildingMinZoom + 1 : null;
    if (view3d.on) bldZ = VIEW3D_BUILDING_ZOOM;   // v100: the 3D map's own buildings
    perfSet(pf.pfZoom, (phone ? 'z ' : 'zoom ') + z.toFixed(2) + cam3);
    perfSet(pf.pfLab, (phone ? 'lab' : 'labels ') + (labelsBySearch ? 'search' : '≥' + LABEL_ZOOM), z >= LABEL_ZOOM || labelsBySearch ? 'on' : 'off');
    perfSet(pf.pfStop, (phone ? 'stop' : 'stops ') + '≥' + stopZ, z >= stopZ ? 'on' : 'off');
    perfSet(pf.pfBld, (view3d.on ? '3D≥' + bldZ : (phone ? '3D' : '3D bldg ') + (image ? ' n/a' : bldZ !== null ? '≥' + bldZ : ' …')), bldZ !== null && z >= bldZ ? 'on' : 'off');
    perfSet(pf.pfFps, fps + ' fps · ' + (phone ? '' : 'worst ') + worst + ' ms', fps < 30 ? 'bad' : '');

    var veh, lab, stp;
    if (view3d.on) {
      var c3 = view3d.counts();
      veh = c3.dots; lab = c3.labels; stp = c3.stops;
    } else {
      var b = map.getBounds();
      var minLat = b.getSouth(), maxLat = b.getNorth(), minLon = b.getWest(), maxLon = b.getEast();
      veh = countInView(dotLayer, minLat, maxLat, minLon, maxLon); lab = countInView(pillLayer, minLat, maxLat, minLon, maxLon);
      stp = countInView(stopLayer, minLat, maxLat, minLon, maxLon) + countInView(routeStopLayer, minLat, maxLat, minLon, maxLon) + countInView(focusLayer, minLat, maxLat, minLon, maxLon);
    }
    perfSet(pf.pfCnt, phone ? 'v' + veh + ' l' + lab + ' s' + stp : 'drawn: ' + veh + ' dots · ' + lab + ' labels · ' + stp + ' stops');

    // FPS sparkline: the last 10 s
    perfSpark.push(fps);
    if (perfSpark.length > 40) perfSpark.shift();
    if (!phone) drawSpark();

    // a stutter that lasts: below 30 fps for more than half a second
    if (fps < 30 && perfFrames.length > 1) {
      if (!perfLowSince) perfLowSince = now;
      if (!perfLogged && now - perfLowSince > 500) {
        perfLogged = true;
        console.log('[perf] FPS ' + fps + ' (worst frame ' + worst + ' ms) at zoom ' + z.toFixed(2) +
          ' · drawn: ' + veh + ' dots, ' + lab + ' labels, ' + stp + ' stops · ' + (mapMode || 'map starting'));
      }
    } else { perfLowSince = 0; perfLogged = false; }
  }
  function drawSpark() {
    var c = document.getElementById('pfSpark'), g = c.getContext('2d'), w = c.width, h = c.height;
    var top = Math.max(60, Math.max.apply(null, perfSpark));
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.25)';   // 30 fps line
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h - h * 30 / top); g.lineTo(w, h - h * 30 / top); g.stroke();
    g.strokeStyle = '#7EE0A5';
    g.lineWidth = 2;
    g.beginPath();
    perfSpark.forEach(function (v, i) {
      var x = w - (perfSpark.length - 1 - i) * (w / 39), y = h - 1 - (h - 2) * Math.min(v, top) / top;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
  }
  function setPerf(on) {
    perfOn = on;
    perfEl.hidden = !on;
    document.getElementById('perfToggle').checked = on;
    store('sofia_perf_overlay', on ? '1' : '0');
    if (on && !perfRaf) {
      perfFrames = []; perfSpark = []; perfLastText = 0; perfLowSince = 0; perfLogged = false;
      perfRaf = requestAnimationFrame(perfFrame);
    }
    if (!on && perfRaf) { cancelAnimationFrame(perfRaf); perfRaf = 0; }   // off: no loop at all
  }
  document.getElementById('perfToggle').onchange = function () { setPerf(this.checked); };
  if (store('sofia_perf_overlay') === '1') setPerf(true);

