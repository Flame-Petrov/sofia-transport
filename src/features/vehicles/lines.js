  // ---------- Resolving a vehicle's line ----------
  var tuByVehicle = {}, tuCount = 0;

  function guessType(label) {
    var s = String(label || '').toUpperCase();
    if (/^TB/.test(s)) return 11;
    if (/^TM|^T\d/.test(s)) return 0;
    if (/^M/.test(s)) return 1;
    if (/^[AB]/.test(s)) return 3;
    return null;
  }
  function resolveRoute(trip) {
    if (!trip) return null;
    var tripInfo = trips[trip.trip_id] || null;
    var routeId = trip.route_id || (tripInfo && tripInfo.route_id) || '';
    return routeId ? { routeId: routeId, headsign: tripInfo ? tripInfo.headsign : '', tripId: trip.trip_id || '' } : null;
  }

  function describe(ent) {
    var vp = ent.vehicle, vd = vp.vehicle || {};
    var trip = vp.trip || {};
    var res = resolveRoute(vp.trip), via = res ? 'position' : '';
    if (!res) {
      var tu = tuByVehicle[vd.id] || tuByVehicle[vd.label];
      if (tu) { res = resolveRoute(tu); via = res ? 'trip-update' : ''; if (!vp.trip) trip = tu; }
    }
    var r = res ? routes[res.routeId] : null;
    var label = vd.label || vd.id || '';
    var type = r ? r.type : guessType(label);
    var line = r ? r.short : (res ? res.routeId : '');
    return {
      key: vd.id || ent.id,
      lat: vp.position.latitude, lon: vp.position.longitude,
      bearing: vp.position.bearing, speed: vp.position.speed,
      line: line, shown: line || label || '?', hasLine: !!line,
      type: type,
      color: (TYPES[type] ? null : (r && r.color)) || typeInfo(type).color,
      headsign: res ? res.headsign : '',
      label: label, plate: vd.license_plate || '',
      tripId: trip.trip_id || '', routeId: trip.route_id || '', via: via, inRoutes: !!r,
      tripRef: res ? res.tripId : '',
      curSeq: vp.current_stop_sequence || 0,
      ts: vp.timestamp || 0
    };
  }

