  // ---------- Hover info (mouse): rest on any vehicle for 1 s, at any zoom ----------
  var HOVER_MS = 1000, hoverTimer = 0, hoverV = null;
  var hoverTip = L.tooltip({ direction: 'top', offset: [0, -8], className: 'hover-tip', opacity: 1 });
  function hideHover() {
    clearTimeout(hoverTimer); hoverTimer = 0;
    if (hoverV) { map.closeTooltip(hoverTip); hoverV = null; }
  }
  // Dots are drawn on the canvas (no CSS transitions there): under the mouse they grow smoothly over
  // 0.2 s, like the labels and stops, and get drawn on top; they shrink back the same way.
  var mouseHover = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  function tweenRadius(dot, to) {
    var from = dot.getRadius(), t0 = performance.now();
    cancelAnimationFrame(dot._tween);
    (function step(now) {
      var k = Math.min(1, Math.max(0, (now - t0) / 200));
      k = 1 - (1 - k) * (1 - k);   // ease out
      dot.setRadius(from + (to - from) * k);
      dot._tween = k < 1 ? requestAnimationFrame(step) : 0;
    })(t0);
  }
  function hookHover(v, marker) {
    if (mouseHover && marker.setRadius) {
      marker.on('mouseover', function () {
        marker._hovered = true;
        tweenRadius(marker, v === selected ? 12 : 9);
        marker.setStyle({ weight: 2.5 });
        marker.bringToFront();
      });
      marker.on('mouseout', function () {
        marker._hovered = false;
        tweenRadius(marker, v === selected ? 9 : 5);   // back to the normal sizes (markVehicle)
        marker.setStyle({ weight: v === selected ? 3 : 1.5 });
      });
    }
    marker.on('mouseover', function () {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        if (marker.isPopupOpen()) return;
        hoverV = v;
        hoverTip.setLatLng(marker.getLatLng()).setContent(vehHoverHtml(v));
        map.openTooltip(hoverTip);
        fillFresh(hoverTip.getElement(), v);
      }, HOVER_MS);
    });
    marker.on('mouseout click', hideHover);
  }

