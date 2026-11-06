  // ---------- Fold the panel down to the search row ----------
  // v78: folded = only the search pill (and the tracking card / error box) stay; the filter pill and the
  // menu card (My places, Diagnostics) fold away with the "Menu motion" transitions in the style sheet.
  // Folded sections are inert: no focus, no clicks, hidden from screen readers.
  var foldTimer = 0;
  function setFolded(on) {
    var panel = document.getElementById('panel'), btn = document.getElementById('fold');
    if (on) {   // focus inside a section that is going away goes to the toggle instead of being lost
      var a = document.activeElement;
      if (a && a.closest && a.closest('.fold-sec')) btn.focus();
    }
    panel.classList.toggle('folded', on);
    document.querySelectorAll('#panel .fold-sec').forEach(function (s) {
      if (on) s.setAttribute('inert', ''); else s.removeAttribute('inert');
    });
    btn.setAttribute('aria-expanded', on ? 'false' : 'true');
    btn.setAttribute('aria-label', on ? 'Open menu' : 'Close menu');
    btn.title = on ? 'Open menu (filters, My places, Diagnostics)' : 'Close menu';
    store('sofia_menu', on ? '0' : '1');   // open is the default (the filters show, as in the design)
    updatePopupPadding();
    clearTimeout(foldTimer);   // and once the sections have settled
    foldTimer = setTimeout(updatePopupPadding, 320);
  }
  document.getElementById('fold').onclick = function () {
    setFolded(!document.getElementById('panel').classList.contains('folded'));
  };
  (function () {   // the saved state, without motion on first paint
    var panel = document.getElementById('panel'), root = document.documentElement;
    panel.classList.add('fold-instant');
    root.classList.add('boot');   // v79: also the submenus' saved states (set later in this script)
    // v89: phones start folded (only the search row) until the menu is opened; PCs start open as before
    var savedMenu = store('sofia_menu');
    setFolded(savedMenu ? savedMenu === '0' : isPhone());
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      panel.classList.remove('fold-instant'); root.classList.remove('boot');
    }); });
  })();

  // v79: submenus (My places, Diagnostics, Raw log) open and close with the same motion as the menu:
  // the wrapper (.reveal) opens/closes its row, the content fades and slides 8 px. A closed wrapper is
  // inert (no focus, no clicks) and clips what it holds, so hidden content never adds scroll room.
  function reveal(el, open) {
    var w = el.parentNode;
    w.classList.toggle('closed', !open);
    if (open) w.removeAttribute('inert'); else w.setAttribute('inert', '');
  }
  function isRevealed(el) { return !el.parentNode.classList.contains('closed'); }
  // v84: the menu shell never scrolls — only #menuScroll inside it does. (Browsers without overflow: clip
  // keep "hidden", which the browser can still scroll when it brings a focused control into view: on
  // Android that emptied the bubble after tapping the performance-overlay switch.)
  ['menuCard', 'secMenu', 'secTypes'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('scroll', function () { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });
  });

  // v79: the panel's room is measured, not guessed: from its top down to just above the city card (or
  // the bottom of the screen), so it never runs under the card, the margins or the safe areas.
  // v80: only the panel is limited. Its content area (#panelBody) is the one scroll area and every
  // section keeps its natural height; v79 limited the menu card too, and its flex children shrank to fit
  // ("My places" squeezed to a strip when Diagnostics opened).
  function fitPanel() {
    var panel = document.getElementById('panel');
    if (!panel) return;
    var pr = panel.getBoundingClientRect(), limit = window.innerHeight;
    // whatever sits below the panel in its columns stays reachable: the city card, and on phones (full-width
    // panel) the Follow button on top of the right-hand stack (location and zoom buttons are below it)
    ['cityCard', 'follow'].forEach(function (id) {
      var el = document.getElementById(id), r = el && el.getBoundingClientRect();
      if (r && r.height && r.left < pr.right && r.right > pr.left && r.top > pr.top) limit = Math.min(limit, r.top);
    });
    limit -= 12 * ui;
    var ph = Math.max(120, (limit - pr.top) / ui).toFixed(1) + 'px';
    if (panel.style.maxHeight !== ph) panel.style.maxHeight = ph;
    // v83: the bubble (shell) gets exactly the room from its top to that limit, less the content area's
    // bottom padding; its content scrolls inside it. (Its wrapper's top: the shell itself may be sliding.)
    var card = document.getElementById('menuCard'), sec = document.getElementById('secMenu'), body = document.getElementById('panelBody');
    if (card && sec && body) {
      var padB = parseFloat(getComputedStyle(body).paddingBottom) * ui || 0;
      var ch = Math.max(120, (limit - padB - sec.getBoundingClientRect().top) / ui).toFixed(1) + 'px';
      if (card.style.maxHeight !== ch) { card.style.maxHeight = ch; card.style.setProperty('--bubble-h', ch); }
    }
  }

