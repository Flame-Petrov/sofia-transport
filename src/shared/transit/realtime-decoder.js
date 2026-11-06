  // ---------- GTFS-Realtime decoder (minimal schema) ----------
  var PROTO = [
    'syntax = "proto2"; package transit_realtime;',
    'message FeedMessage { optional FeedHeader header = 1; repeated FeedEntity entity = 2; }',
    'message FeedHeader { optional string gtfs_realtime_version = 1; optional uint64 timestamp = 3; }',
    'message FeedEntity { optional string id = 1; optional bool is_deleted = 2; optional TripUpdate trip_update = 3; optional VehiclePosition vehicle = 4; }',
    'message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2;',
    '  optional VehicleDescriptor vehicle = 3; optional uint64 timestamp = 4; optional int32 delay = 5; }',
    'message StopTimeUpdate { optional uint32 stop_sequence = 1; optional StopTimeEvent arrival = 2;',
    '  optional StopTimeEvent departure = 3; optional string stop_id = 4; optional int32 schedule_relationship = 5; }',
    'message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; optional int32 uncertainty = 3; }',
    'message VehiclePosition { optional TripDescriptor trip = 1; optional Position position = 2;',
    '  optional uint32 current_stop_sequence = 3; optional uint64 timestamp = 5; optional string stop_id = 7;',
    '  optional VehicleDescriptor vehicle = 8; }',
    'message TripDescriptor { optional string trip_id = 1; optional string start_time = 2; optional string start_date = 3;',
    '  optional string route_id = 5; optional uint32 direction_id = 6; }',
    'message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }',
    'message Position { optional float latitude = 1; optional float longitude = 2; optional float bearing = 3;',
    '  optional double odometer = 4; optional float speed = 5; }'
  ].join('\n');
  var FeedMessage = protobuf.parse(PROTO, { keepCase: true }).root.lookupType('transit_realtime.FeedMessage');
  function decode(buf) { return FeedMessage.toObject(FeedMessage.decode(new Uint8Array(buf)), { longs: Number }); }

