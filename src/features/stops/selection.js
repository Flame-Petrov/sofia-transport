  function markSel(mk, on) {
    var el = mk.getElement(), ic = el && el.querySelector('.stop-ic');
    if (ic) ic.classList.toggle('sel', on);
    mk.setZIndexOffset(on ? 4000 : mk._z);   // the enlarged stop sits on top of everything
    raise(mk, on || mk === focusMarker);
    if (view3d.on) view3d.stopsChanged();   // v101
  }

