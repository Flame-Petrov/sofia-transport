  // ---------- Start ----------
  loadStatic();
  update(true);
  setInterval(function () { update(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) update(false); });
