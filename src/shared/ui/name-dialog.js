  // ---- the name dialog ----
  var pinDlgCb = null;
  var pinDlg = document.getElementById('pinDlg'), pinName = document.getElementById('pinName');
  function openPinDlg(title, value, cb, opt) {
    opt = opt || {};
    document.getElementById('pinDlgT').textContent = title;
    var sub = document.getElementById('pinDlgSub');
    sub.textContent = opt.sub || ''; sub.hidden = !opt.sub;   // v85: e.g. the size of an offline area
    pinName.placeholder = opt.placeholder || 'e.g. Home, Work, Grandma';
    pinName.value = value || '';
    pinDlgCb = cb;
    pinDlg.hidden = false;
    setTimeout(function () { pinName.focus(); pinName.select(); }, 30);
  }
  function closePinDlg() { pinDlg.hidden = true; pinDlgCb = null; }
  document.getElementById('pinForm').onsubmit = function (e) {
    e.preventDefault();
    var name = pinName.value.replace(/\s+/g, ' ').trim().slice(0, 40), cb = pinDlgCb;
    if (!name) { pinName.focus(); return; }
    closePinDlg();
    if (cb) cb(name);
  };
  document.getElementById('pinCancel').onclick = closePinDlg;
  pinDlg.addEventListener('click', function (e) { if (e.target === pinDlg) closePinDlg(); });
