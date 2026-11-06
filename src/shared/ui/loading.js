  // ---------- Loading screen ----------
  var LOAD = {
    map:      { w: 0.4, f: 0, msg: 'Map' },
    vehicles: { w: 0.3, f: 0, msg: 'Vehicles' },
    lines:    { w: 0.3, f: 0, msg: 'Lines & stops' }
  };
  // The bar moves smoothly on its own: it creeps toward 95% while waiting (so it never looks
  // stuck), follows real progress when that's ahead, and runs to 100% once everything is ready.
  var loaderGone = false, realTotal = 0, shown = 0, loadStart = Date.now(), finishing = false, allReadyAt = 0, realChangedAt = Date.now();
  function setProgress(part, f, msg) {
    if (loaderGone) return;
    var p = LOAD[part];
    p.f = Math.max(p.f, Math.min(1, f));
    if (msg) p.msg = msg;
    var before = realTotal;
    realTotal = 0;
    var parts = [], others = true;
    Object.keys(LOAD).forEach(function (k) {
      var x = LOAD[k];
      realTotal += x.w * x.f;
      parts.push(x.f >= 1 ? x.msg + ' ✓' : x.msg);
      if (k !== 'map' && x.f < 1) others = false;
    });
    document.getElementById('lmsg').textContent = parts.join(' · ');
    if (realTotal > before) realChangedAt = Date.now();
    if (realTotal >= 0.999) finishing = true;
    if (others && !allReadyAt) allReadyAt = Date.now();
  }
  function loaderTick() {
    if (loaderGone) return;
    var now = Date.now();
    var simulated = 0.95 * (1 - Math.exp(-(now - loadStart) / 6000));
    // after each real step, keep creeping into the remaining gap so the bar never sits still
    var creeping = realTotal + (0.96 - realTotal) * (1 - Math.exp(-(now - realChangedAt) / 3500));
    var target = finishing ? 1 : Math.max(simulated, creeping);
    shown += (target - shown) * (finishing ? 0.25 : 0.08);
    if (target - shown < 0.002) shown = target;
    var pct = Math.min(100, Math.round(shown * 100));
    document.getElementById('lfill').style.width = pct + '%';
    document.getElementById('lpct').textContent = pct + '%';
    if (finishing && shown >= 0.999) { setTimeout(hideLoader, 150); return; }
    requestAnimationFrame(loaderTick);
  }
  requestAnimationFrame(loaderTick);
  // Work that shouldn't slow down the first view waits until the loading screen is gone
  var afterLoadQueue = [];
  function afterLoad(fn) { if (loaderGone) setTimeout(fn, 300); else afterLoadQueue.push(fn); }
  var timings = {};   // shown in Debug info
  function hideLoader() {
    if (loaderGone) return;
    loaderGone = true;
    afterLoadQueue.splice(0).forEach(function (fn) { setTimeout(fn, 600); });
    var el = document.getElementById('loader');
    el.classList.add('done');
    setTimeout(function () { el.remove(); }, 600);
  }
  setTimeout(function () { finishing = true; }, 20000);   // safety limit on a very bad connection

