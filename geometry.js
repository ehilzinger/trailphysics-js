// Spherical geometry on routes and points: great-circle distance,
// interpolation along a great circle, bearings, cumulative distance along a
// line, the point a given distance or fraction along it, and where a point
// projects onto it.
//
// Pure and synchronous: no DOM, no map, no fetch, so anything built on it
// can be tested with a square drawn at lat 52 and no route attached. The
// radius is earth.js's, so distances here agree with the rest of the
// package.
//
// Convention throughout: a point is [lat, lng].

import { EARTH_RADIUS_M } from './earth.js';

var TO_RAD = Math.PI / 180;
var TO_DEG = 180 / Math.PI;

// Great-circle distance in metres. Haversine, on the same radius as
// earth.js's earthDistanceM, so a distance measured here and one measured
// there agree.
function distanceM(a, b){
  if(!a || !b) return NaN;
  var lat1 = a[0] * TO_RAD, lat2 = b[0] * TO_RAD;
  var dLat = (b[0] - a[0]) * TO_RAD;
  var dLng = (b[1] - a[1]) * TO_RAD;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The point a fraction of the way from `a` to `b` along the great circle
// between them.
//
// Spherical rather than a linear blend of the two coordinates, because it
// is meant for pairs hundreds of kilometres apart — splitting a long leg
// into shorter ones before routing each, say — where the linear midpoint
// sits tens of kilometres off the shortest path and would add a detour
// nobody asked for.
// Falls back to the linear blend for a pair too close together for the
// spherical form to be stable, where the two answers agree to well under a
// metre anyway.
function interpolate(a, b, fraction){
  if(!a || !b) return null;
  var f = isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  var lat1 = a[0] * TO_RAD, lng1 = a[1] * TO_RAD;
  var lat2 = b[0] * TO_RAD, lng2 = b[1] * TO_RAD;
  var angle = distanceM(a, b) / EARTH_RADIUS_M;
  if(!(angle > 1e-9)){
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  var sinAngle = Math.sin(angle);
  var from = Math.sin((1 - f) * angle) / sinAngle;
  var to = Math.sin(f * angle) / sinAngle;
  var x = from * Math.cos(lat1) * Math.cos(lng1) + to * Math.cos(lat2) * Math.cos(lng2);
  var y = from * Math.cos(lat1) * Math.sin(lng1) + to * Math.cos(lat2) * Math.sin(lng2);
  var z = from * Math.sin(lat1) + to * Math.sin(lat2);
  return [
    Math.atan2(z, Math.sqrt(x * x + y * y)) * TO_DEG,
    Math.atan2(y, x) * TO_DEG
  ];
}

// Initial bearing from `a` to `b`, in 0..360 clockwise from north.
//
// Normalised here rather than at each call site: a caller that buckets
// bearings into sectors or quarters would otherwise put a −170 that should
// have been 190 two sectors away from where it belongs.
function bearing(a, b){
  if(!a || !b) return NaN;
  var lat1 = a[0] * TO_RAD, lat2 = b[0] * TO_RAD;
  var dLng = (b[1] - a[1]) * TO_RAD;
  var y = Math.sin(dLng) * Math.cos(lat2);
  var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  var deg = Math.atan2(y, x) * TO_DEG;
  if(!isFinite(deg)) return NaN;
  var wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// The smaller angle between two bearings, 0..180: "how far apart do these
// two points sit, seen from the start".
function bearingDelta(from, to){
  if(!isFinite(from) || !isFinite(to)) return NaN;
  var raw = Math.abs(from - to) % 360;
  return raw > 180 ? 360 - raw : raw;
}

// Running distance to each vertex, in metres. Index 0 is 0.
function cumulativeDistances(latlngs){
  var out = [0];
  if(!latlngs || latlngs.length < 2) return out;
  var total = 0;
  for(var i = 1; i < latlngs.length; i++){
    var step = distanceM(latlngs[i - 1], latlngs[i]);
    total += isFinite(step) ? step : 0;
    out.push(total);
  }
  return out;
}

function lengthKm(latlngs){
  var cum = cumulativeDistances(latlngs);
  return (cum[cum.length - 1] || 0) / 1000;
}

// The point `metres` along the line, interpolated within the segment it
// falls in.
//
// By DISTANCE, never by vertex index. BRouter's vertices cluster in bends,
// so "the vertex halfway through the array" can be a third of the way along
// a route that runs straight for ten kilometres and then hairpins — and
// anything that samples the line at even steps (to test whether it doubles
// back on itself, say) would then compare parts of it that are nowhere near
// each other.
function pointAtMetres(latlngs, cum, metres){
  if(!latlngs || latlngs.length === 0) return null;
  if(latlngs.length === 1) return latlngs[0];
  cum = cum || cumulativeDistances(latlngs);
  var total = cum[cum.length - 1] || 0;
  if(!(total > 0)) return latlngs[0];
  var target = Math.min(total, Math.max(0, metres));
  // Binary search for the segment holding `target`.
  var lo = 0, hi = cum.length - 1;
  while(lo < hi - 1){
    var mid = (lo + hi) >> 1;
    if(cum[mid] <= target) lo = mid; else hi = mid;
  }
  var span = cum[hi] - cum[lo];
  var f = span > 0 ? (target - cum[lo]) / span : 0;
  var a = latlngs[lo], b = latlngs[hi];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function pointAtFraction(latlngs, fraction, cum){
  cum = cum || cumulativeDistances(latlngs);
  var total = cum[cum.length - 1] || 0;
  return pointAtMetres(latlngs, cum, total * fraction);
}

// Where `point` sits along `line`, as 0..1.
//
// Projected onto the nearest SEGMENT rather than snapped to the nearest
// vertex: on a long straight the nearest-vertex answer can be kilometres
// out, and a figure like this usually decides both when a point beside the
// route is reached and which stretch of the route it belongs to.
function fractionAlong(point, line, cum){
  if(!point || !line || line.length < 2) return 0;
  cum = cum || cumulativeDistances(line);
  var total = cum[cum.length - 1] || 0;
  if(!(total > 0)) return 0;
  // Flat local metres about the point. Over a route tens of kilometres
  // across, the error of that is centimetres.
  var mPerLat = 111320;
  var mPerLng = 111320 * Math.cos(point[0] * TO_RAD);
  var px = point[1] * mPerLng, py = point[0] * mPerLat;
  var best = Infinity, bestMetres = 0;
  for(var i = 1; i < line.length; i++){
    var ax = line[i - 1][1] * mPerLng, ay = line[i - 1][0] * mPerLat;
    var bx = line[i][1] * mPerLng, by = line[i][0] * mPerLat;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var f = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    f = Math.min(1, Math.max(0, f));
    var cx = ax + dx * f, cy = ay + dy * f;
    var d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if(d2 < best){
      best = d2;
      bestMetres = cum[i - 1] + (cum[i] - cum[i - 1]) * f;
    }
  }
  return Math.min(1, Math.max(0, bestMetres / total));
}

export {
  EARTH_RADIUS_M,
  bearing, bearingDelta, cumulativeDistances, distanceM, fractionAlong,
  interpolate, lengthKm, pointAtFraction, pointAtMetres
};
