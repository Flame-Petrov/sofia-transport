  var proxy = store('sofia_proxy') || '';
  function src(u) { return proxy ? proxy + encodeURIComponent(u) : u; }

