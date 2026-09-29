// Metres between two points on the sphere every figure in this package is
// measured on.
//
// The haversine on a sphere of R = 6371 km. elevation.js's distances and
// rider-physics.js's solve both come from here, and geometry.js shares the
// radius, so the length of a stretch and the time or gradient computed over
// it cannot disagree about how long it is. A caller that measures distances
// for display can take the same function and stay consistent with them.
//
// Points are [lat, lng] or { lat, lng }. No imports and no globals.

var EARTH_RADIUS_M = 6371000;

function coords(p){
  if(Array.isArray(p)) return p;
  return [p.lat, p.lng];
}

function earthDistanceM(a, b){
  var p = coords(a), q = coords(b);
  var rad = Math.PI / 180;
  var lat1 = p[0] * rad;
  var lat2 = q[0] * rad;
  var sinDLat = Math.sin((q[0] - p[0]) * rad / 2);
  var sinDLon = Math.sin((q[1] - p[1]) * rad / 2);
  var h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export { EARTH_RADIUS_M, earthDistanceM };
