  // ---------- Phones: swipe the panel down to open it, up to fold it (v75) ----------
  // A quick vertical swipe (≥ 40 px, mostly vertical, under 0.8 s) anywhere on the panel. Inside the
  // panel's scrolling part a swipe up scrolls first: it folds only when that part is already at its end.
  (function () {
    var panel = document.getElementById('panel'), body = document.getElementById('panelBody'), g = null;
    panel.addEventListener('touchstart', function (e) {
      g = null;
      if (!isPhone() || e.touches.length !== 1) return;
      if (e.target.closest && e.target.closest('textarea')) return;   // the raw log scrolls on its own
      // the list being scrolled
      // v83: inside the bubble its own scroll container; elsewhere the panel's content area
      var t = e.touches[0], sc = (e.target.closest && e.target.closest('#menuScroll')) || (body.contains(e.target) ? body : null);
      g = { x: t.clientX, y: t.clientY, t: e.timeStamp,   // when the finger moved, not when a busy page got to it
            atEnd: !sc || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2 };
    }, { passive: true });
    panel.addEventListener('touchcancel', function () { g = null; }, { passive: true });
    panel.addEventListener('touchend', function (e) {
      if (!g) return;
      var s = g, t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
      g = null;
      if (e.timeStamp - s.t > 800 || Math.abs(dy) < 40 || Math.abs(dy) < 1.5 * Math.abs(dx)) return;
      var folded = panel.classList.contains('folded');
      if (dy > 0 && folded) setFolded(false);
      else if (dy < 0 && !folded && s.atEnd) setFolded(true);
    }, { passive: true });
  })();

