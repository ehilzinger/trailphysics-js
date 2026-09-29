// How long a route takes on foot: hiking by DIN 33466, running by a
// grade-adjusted pace. The numbers it promises are pinned by the shared test
// vectors in test/fixtures/foot-pace.json, written by
// test/build-foot-pace-fixtures.mjs and read by the Swift port
// (trailphysics-swift) too. Change the model, the fixtures and the port
// together.
//
// rider-physics.js answers this question for a bicycle and knows nothing
// about feet: a hike costed with a rider profile comes out at cycling
// speed. This module is the foot half, and like rider-physics.js it is
// deliberately pure: no state, no DOM, no map, nothing but arithmetic
// over plain numbers, so it runs anywhere and every figure can be
// checked by hand against a signpost.
//
// Three entry points, from small to large:
//
//   footSectionSeconds()  one stretch of uniform character: distance, ascent,
//                         descent and what is underfoot.
//   footSections()        a profile (distance and height per sample) and the
//                         router's placed ways, cut into those stretches.
//   footRouteSeconds()    a whole route object ({ latlngs, elevations, ... }),
//                         end to end.

import { cumulativeDistances } from './geometry.js';

// The figures a user who has set nothing gets. hikeFactor 1.0 is "like the
// signposts" (see hikeFactorOf for the direction). The run paces are the
// easy FLAT pace, before any gradient or surface: 6:00/km on the road,
// 7:00/km for a trail runner, whose easy pace is slower for the same effort.
// dayHours is moving time per day, the figure a caller splits a multi-day
// route by.
var FOOT_PACE_DEFAULTS = {
  hikeFactor: 1.0,
  runPaceSecPerKm: { trailrun: 420, roadrun: 360 },
  dayHours: { hike: 6, run: 3 }
};

var FOOT_PROFILES = ['hiking', 'trailrun', 'roadrun'];

// ---------- Settings ----------
//
// Out-of-band values are clamped, not rejected: unlike a 5000 W typo in
// rider-physics.js, a factor of 2.4 is still clearly "much faster than the
// signs" and the nearest honest figure is the bound. Anything that is not a
// positive number means "not set" and gets the default. The bounds (hike
// factor 0.5-2.0, run pace 150-900 s/km) are deliberately wider than any
// sensible picker offers (0.7-1.5, say, with presets 0.85 / 1.0 / 1.2), so
// a value learned from finished hikes is never cut short by a picker's
// range.
var MIN_HIKE_FACTOR = 0.5;
var MAX_HIKE_FACTOR = 2.0;
var MIN_RUN_PACE_S_PER_KM = 150;
var MAX_RUN_PACE_S_PER_KM = 900;

function clamp(x, lo, hi){ return Math.min(hi, Math.max(lo, x)); }

function positive(x){ return typeof x === 'number' && isFinite(x) && x > 0; }

// The hike factor to use: a SPEED factor against the signposts. Time is the
// signposted time divided by it, so 1.2 is faster (a 3:00 h sign walks in
// 2:30 h) and 0.85 slower. On a slider, put faster on the right.
function hikeFactorOf(settings){
  var f = settings && settings.hikeFactor;
  return positive(f) ? clamp(f, MIN_HIKE_FACTOR, MAX_HIKE_FACTOR) : FOOT_PACE_DEFAULTS.hikeFactor;
}

// The easy flat pace for a running profile, in seconds per km.
// `runPaceSecPerKm` is either one number (the user's own pace, which applies
// to both run profiles) or an object keyed by profile, the shape of
// FOOT_PACE_DEFAULTS.
function runPaceOf(settings, profile){
  var fallback = FOOT_PACE_DEFAULTS.runPaceSecPerKm[profile] || FOOT_PACE_DEFAULTS.runPaceSecPerKm.trailrun;
  var p = settings && settings.runPaceSecPerKm;
  if(p && typeof p === 'object') p = p[profile];
  return positive(p) ? clamp(p, MIN_RUN_PACE_S_PER_KM, MAX_RUN_PACE_S_PER_KM) : fallback;
}

// ---------- Hiking: DIN 33466 ----------

var HIKE_HORIZONTAL_M_PER_H = 4000;
var HIKE_ASCENT_M_PER_H = 300;
var HIKE_DESCENT_M_PER_H = 500;

// SAC scale slow-down, on the section's time. T1 and T2 are what DIN's rates
// already describe; 0 means "no sac_scale tag" on the way and null means
// the router could not say, and both are read as walking ground.
function sacHikeFactor(sacScale){
  if(typeof sacScale !== 'number' || !isFinite(sacScale)) return 1;
  if(sacScale >= 5) return 1.6;
  if(sacScale >= 4) return 1.35;
  if(sacScale >= 3) return 1.15;
  return 1;
}

// Hours for one section by the signpost formula, before any factor:
// the larger of the horizontal and vertical times plus half the smaller.
function dinHours(distanceM, ascentM, descentM){
  var h = distanceM / HIKE_HORIZONTAL_M_PER_H;
  var v = ascentM / HIKE_ASCENT_M_PER_H + descentM / HIKE_DESCENT_M_PER_H;
  return Math.max(h, v) + Math.min(h, v) / 2;
}

// `factor` is the hike factor, a speed factor: the time divides by it.
function hikeSeconds(distanceM, ascentM, descentM, sacScale, factor){
  return dinHours(distanceM, ascentM, descentM) * 3600 * sacHikeFactor(sacScale) / factor;
}

// ---------- Running: Minetti's cost of running ----------
//
// Minetti et al. (2002), J Appl Physiol 93:1039, energy cost of running in
// J/kg/m against gradient i (rise over run, as a fraction), measured from
// -45 % to +45 %. At constant metabolic power, time per metre is
// proportional to cost, so the pace factor for a grade is C(i) / C(0).
var MINETTI_LIMIT = 0.45;

function minettiCost(i){
  return ((((155.4 * i - 30.4) * i - 43.3) * i + 46.3) * i + 19.5) * i + 3.6;
}

function minettiSlope(i){
  return (((5 * 155.4 * i - 4 * 30.4) * i - 3 * 43.3) * i + 2 * 46.3) * i + 19.5;
}

var MINETTI_FLAT = minettiCost(0);

// On a descent Minetti's treadmill runners were limited by energy, and the
// curve halves the time at -20 %. On real ground the limit is braking and
// footing, so a descent is never costed at less than this share of the flat
// pace. 0.85 is where the curve sits at about -3 %.
var DOWNHILL_FLOOR = 0.85;

// Past this uphill grade a runner walks. See runSeconds for what that means.
var POWER_HIKE_GRADE = 0.25;

// The pace factor for a grade. Outside the measured +/-45 % the polynomial
// is continued along its tangent rather than clamped: clamping would cost a
// 60 % wall like a 45 % one and let the runner go up it faster the steeper
// it gets.
function gradeFactor(i){
  var cost;
  if(i > MINETTI_LIMIT){
    cost = minettiCost(MINETTI_LIMIT) + minettiSlope(MINETTI_LIMIT) * (i - MINETTI_LIMIT);
  }else if(i < -MINETTI_LIMIT){
    cost = minettiCost(-MINETTI_LIMIT) + minettiSlope(-MINETTI_LIMIT) * (i + MINETTI_LIMIT);
  }else{
    cost = minettiCost(i);
  }
  return Math.max(DOWNHILL_FLOOR, cost / MINETTI_FLAT);
}

// What is underfoot, for running. Road classes are OSM highway= values
// (with _link folded into the base class); surfaces are OSM surface= values.
var TRAIL_ROAD_CLASSES = { path: true, track: true, bridleway: true, steps: true };
// The surfaces that are natural, unpaved ground.
var TRAIL_SURFACES = {
  ground: true, dirt: true, earth: true, grass: true, grass_paver: true, mud: true,
  sand: true, unpaved: true, woodchips: true, snow: true, ice: true
};

function runSurfaceFactor(section){
  var sac = section.sacScale;
  if(typeof sac === 'number' && isFinite(sac)){
    if(sac >= 3) return 1.25;
    if(sac >= 1) return 1.08;
  }
  if(TRAIL_ROAD_CLASSES[section.roadClass] === true) return 1.08;
  if(TRAIL_SURFACES[section.surface] === true) return 1.08;
  return 1;
}

// Seconds to run one section.
//
// A section that both climbs and descends is read as a climb followed by a
// descent at the same steepness, (ascent + descent) / distance, with the
// distance shared out in proportion to the metres climbed and descended.
// The router's profile windows are nearly always one or the other; this is
// what keeps a peak inside a window from being costed as flat.
//
// Past POWER_HIKE_GRADE the climbing part is power-hiked: the hike formula
// at the user's hike factor (SAC slow-down included), capped at the running
// time. So a runner is never costed slower on a wall than they would be
// running it; the hike time only wins for a slow runner with a fast hike
// factor, where the signposts say they would walk it quicker.
//
// And floored at what the same distance takes running at exactly
// POWER_HIKE_GRADE. Without the floor, that slow runner would get FASTER as
// the climb steepened past the switch (running at 25 %, then a quicker walk
// at 26 %), and a time that drops when the climbing grows is wrong however
// it is explained. With it the time is continuous and never falls as the
// grade rises; for any ordinary pairing of pace and factor the running time
// is the smaller and neither the cap nor the floor changes anything.
function runSeconds(section, distanceM, ascentM, descentM, pace, factor){
  var surface = runSurfaceFactor(section);
  var vertical = ascentM + descentM;
  if(distanceM <= 0){
    // All vertical and no distance: there is no grade to run. Walk it.
    return hikeSeconds(0, ascentM, descentM, section.sacScale, factor);
  }
  if(vertical <= 0) return pace * distanceM / 1000 * surface;

  var grade = vertical / distanceM;
  var upM = distanceM * ascentM / vertical;
  var downM = distanceM - upM;

  var up = 0;
  if(upM > 0){
    up = pace * upM / 1000 * gradeFactor(grade) * surface;
    if(grade > POWER_HIKE_GRADE){
      var walked = hikeSeconds(upM, ascentM, 0, section.sacScale, factor);
      var atSwitch = pace * upM / 1000 * gradeFactor(POWER_HIKE_GRADE) * surface;
      up = Math.max(atSwitch, Math.min(up, walked));
    }
  }
  var down = downM > 0 ? pace * downM / 1000 * gradeFactor(-grade) * surface : 0;
  return up + down;
}

// ---------- One section ----------

function nonNegative(x){ return typeof x === 'number' && isFinite(x) && x > 0 ? x : 0; }

// Seconds for one section of uniform character, or null for a profile this
// model does not cover (the riding profiles are rider-physics.js's).
//
// `section` is { distanceM, ascentM, descentM, sacScale, surface, roadClass };
// anything missing or unreadable is zero (numbers) or unknown (the rest).
// `settings` is { hikeFactor, runPaceSecPerKm }, either optional.
function footSectionSeconds(section, profile, settings){
  if(FOOT_PROFILES.indexOf(profile) < 0) return null;
  var s = section || {};
  var d = nonNegative(s.distanceM);
  var a = nonNegative(s.ascentM);
  var de = nonNegative(s.descentM);
  var factor = hikeFactorOf(settings);
  if(profile === 'hiking') return hikeSeconds(d, a, de, s.sacScale, factor);
  return runSeconds(s, d, a, de, runPaceOf(settings, profile), factor);
}

// ---------- Cutting a route into sections ----------

// Elevation noise below this is ignored: the profile is passed through a
// dead band ("play" operator) this wide, so a DEM wobbling by a few metres on
// the flat reads as flat, and every real climb loses at most this much. The
// same 5 m elevation.js's MIN_CLIMB_M settled on for the ascent figure.
var ELEVATION_DEAD_BAND_M = 5;

// Sections are at least this long, measured between profile samples:
// rider-physics.js's GRADIENT_WINDOW_M, for the same reason. Shorter, and
// the elevation model's quantisation reads as ramps nobody walked.
var SECTION_WINDOW_M = 200;

// The dead band itself. Follows the raw height only once it moves more than
// half the band away, so the output's total ascent is the input's ascent
// with every swing under the band removed.
function deadBand(elevations){
  var half = ELEVATION_DEAD_BAND_M / 2;
  var out = [elevations[0]];
  var y = elevations[0];
  for(var i = 1; i < elevations.length; i++){
    y = Math.min(Math.max(y, elevations[i] - half), elevations[i] + half);
    out.push(y);
  }
  return out;
}

// The samples that can be used: a finite height at a finite distance that
// moves forward. A sample with no height is dropped, which interpolates
// across the hole rather than reading it as a cliff to sea level.
function cleanProfile(distancesM, elevations){
  var d = [], e = [];
  if(!Array.isArray(distancesM) || !Array.isArray(elevations)) return { d: d, e: e };
  var n = Math.min(distancesM.length, elevations.length);
  for(var i = 0; i < n; i++){
    var x = distancesM[i], y = elevations[i];
    if(typeof x !== 'number' || !isFinite(x)) continue;
    if(typeof y !== 'number' || !isFinite(y)) continue;
    if(d.length && x <= d[d.length - 1]) continue;
    d.push(x); e.push(y);
  }
  return { d: d, e: e };
}

// The router's placed ways, in the shape this module reads:
// { fromM, toM, sacScale, surface, roadClass }. Also accepts
// { fromM, toM, segment } entries, with the way's tags on `segment`, and
// snake_case keys (sac_scale, road_class) as well as camelCase.
function wayOf(entry){
  if(!entry || typeof entry !== 'object') return null;
  var seg = entry.segment && typeof entry.segment === 'object' ? entry.segment : entry;
  var from = entry.fromM, to = entry.toM;
  if(typeof from !== 'number' || typeof to !== 'number' || !isFinite(from) || !isFinite(to) || !(to > from)) return null;
  var sac = seg.sacScale !== undefined ? seg.sacScale : seg.sac_scale;
  return {
    fromM: from, toM: to,
    sacScale: typeof sac === 'number' && isFinite(sac) ? sac : null,
    surface: typeof seg.surface === 'string' ? seg.surface : null,
    roadClass: typeof seg.roadClass === 'string' ? seg.roadClass
      : (typeof seg.road_class === 'string' ? seg.road_class : null)
  };
}

// One window, split where the ways under it change. Ascent and descent are
// shared out by distance, which is exact on a window of uniform gradient and
// the best that can be said of any other. A stretch no way covers gets
// unknown ground; where two ways overlap, the first one listed wins.
function splitWindow(fromM, toM, ascentM, descentM, ways, out){
  var cuts = [fromM, toM];
  for(var i = 0; i < ways.length; i++){
    var w = ways[i];
    if(w.toM <= fromM || w.fromM >= toM) continue;
    if(w.fromM > fromM) cuts.push(w.fromM);
    if(w.toM < toM) cuts.push(w.toM);
  }
  cuts.sort(function(x, y){ return x - y; });
  var span = toM - fromM;
  for(var k = 0; k < cuts.length - 1; k++){
    var lo = cuts[k], hi = cuts[k + 1];
    if(!(hi > lo)) continue;
    var mid = (lo + hi) / 2;
    var way = null;
    for(var j = 0; j < ways.length; j++){
      if(ways[j].fromM <= mid && ways[j].toM > mid){ way = ways[j]; break; }
    }
    var share = span > 0 ? (hi - lo) / span : 0;
    out.push({
      distanceM: hi - lo,
      ascentM: ascentM * share,
      descentM: descentM * share,
      sacScale: way ? way.sacScale : null,
      surface: way ? way.surface : null,
      roadClass: way ? way.roadClass : null
    });
  }
}

// A profile and its ways cut into sections for footSectionSeconds().
//
// `distancesM[i]` is how far along the route sample i sits and
// `elevations[i]` its height; `ways` as in wayOf(); `totalM` the route's
// length (defaults to the last sample). `fallback` is { ascentM, descentM }
// for a route with no usable profile: then the whole route is one window
// with those figures, descent defaulting to the ascent (a round trip, the
// shape a route without a profile most often has), or flat when there is no
// ascent figure either.
//
// Where the profile starts after 0 or stops before totalM (the ends had no
// height), the uncovered ends are flat.
function footSections(distancesM, elevations, ways, totalM, fallback){
  var placed = [];
  if(Array.isArray(ways)){
    for(var i = 0; i < ways.length; i++){
      var w = wayOf(ways[i]);
      if(w) placed.push(w);
    }
  }
  var p = cleanProfile(distancesM, elevations);
  var total = positive(totalM) ? totalM : (p.d.length ? p.d[p.d.length - 1] : 0);
  var out = [];
  if(!(total > 0)) return out;

  if(p.d.length < 2){
    var f = fallback || {};
    var asc = nonNegative(f.ascentM);
    var desc = typeof f.descentM === 'number' && isFinite(f.descentM) ? nonNegative(f.descentM) : asc;
    splitWindow(0, total, asc, desc, placed, out);
    return out;
  }

  var y = deadBand(p.e);
  var n = p.d.length;
  if(p.d[0] > 0) splitWindow(0, Math.min(p.d[0], total), 0, 0, placed, out);
  var start = 0;
  while(start < n - 1){
    var end = start + 1;
    while(end < n - 1 && p.d[end] - p.d[start] < SECTION_WINDOW_M) end++;
    var up = 0, down = 0;
    for(var k = start + 1; k <= end; k++){
      var delta = y[k] - y[k - 1];
      if(delta > 0) up += delta; else down -= delta;
    }
    var lo = Math.min(p.d[start], total), hi = Math.min(p.d[end], total);
    if(hi > lo) splitWindow(lo, hi, up, down, placed, out);
    start = end;
  }
  if(p.d[n - 1] < total) splitWindow(p.d[n - 1], total, 0, 0, placed, out);
  return out;
}

// ---------- A whole route ----------

// Distance along the route to each elevation sample. A stored route may thin
// its profile to 240 samples (elevation.js's profileForStorage) and keep
// every vertex, so each sample maps back to the vertex it was taken from by
// inverting that stride: the same mapping rider-physics.js uses, and for the
// same reason (vertices bunch through bends, so even spacing is wrong).
function sampleDistances(latlngs, elevations, cum){
  var n = elevations.length;
  if(n === latlngs.length) return cum.slice();
  var stride = n > 1 ? (latlngs.length - 1) / (n - 1) : 0;
  var out = [];
  for(var i = 0; i < n; i++){
    out.push(cum[Math.min(latlngs.length - 1, Math.round(i * stride))]);
  }
  return out;
}

// The route's sections: a route object ({ latlngs, elevations, ascentM,
// descentM, track }, where `track` is the ways as wayOf() reads them)
// through footSections().
function routeSections(route){
  if(!route || !Array.isArray(route.latlngs) || route.latlngs.length < 2) return [];
  var cum = cumulativeDistances(route.latlngs);
  var total = cum[cum.length - 1];
  var elevations = Array.isArray(route.elevations) && route.elevations.length > 1 ? route.elevations : null;
  var distances = elevations ? sampleDistances(route.latlngs, elevations, cum) : null;
  return footSections(distances, elevations, route.track, total, {
    ascentM: route.ascentM, descentM: route.descentM
  });
}

// Moving time for the whole route, in seconds, or null for a profile this
// model does not cover or a route with no line to measure.
function footRouteSeconds(route, profile, settings){
  if(FOOT_PROFILES.indexOf(profile) < 0) return null;
  var sections = routeSections(route);
  if(!sections.length) return null;
  var total = 0;
  for(var i = 0; i < sections.length; i++){
    total += footSectionSeconds(sections[i], profile, settings);
  }
  return total;
}

// Moving time against distance along the route: { distancesM, seconds },
// cumulative from [0, 0], one entry per section end. What a day split by
// time reads (the day ends where `seconds` reaches the day's hours), and
// what places a stop's arrival by the time it takes to get there rather than
// by its share of the distance. Linear within a section. Null as above.
function footRouteTimeline(route, profile, settings){
  if(FOOT_PROFILES.indexOf(profile) < 0) return null;
  var sections = routeSections(route);
  if(!sections.length) return null;
  var distancesM = [0], seconds = [0];
  for(var i = 0; i < sections.length; i++){
    distancesM.push(distancesM[i] + sections[i].distanceM);
    seconds.push(seconds[i] + footSectionSeconds(sections[i], profile, settings));
  }
  return { distancesM: distancesM, seconds: seconds };
}

// ---------- Display ----------

var KM_PER_MILE = 1.609344;

// A pace for display: "6:00 /km", or "9:39 /mi" with units 'imperial'.
// Rounded to the whole second before splitting, so 359.6 s reads 6:00 and
// never 5:60. Null for anything that is not a positive pace.
function formatPace(secondsPerKm, units){
  if(!positive(secondsPerKm)) return null;
  var imperial = units === 'imperial';
  var total = Math.round(imperial ? secondsPerKm * KM_PER_MILE : secondsPerKm);
  var minutes = Math.floor(total / 60);
  var seconds = total % 60;
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds + (imperial ? ' /mi' : ' /km');
}

export {
  DOWNHILL_FLOOR, ELEVATION_DEAD_BAND_M, FOOT_PACE_DEFAULTS, FOOT_PROFILES,
  MAX_HIKE_FACTOR, MAX_RUN_PACE_S_PER_KM, MIN_HIKE_FACTOR, MIN_RUN_PACE_S_PER_KM,
  POWER_HIKE_GRADE, SECTION_WINDOW_M,
  footRouteSeconds, footRouteTimeline, footSections, footSectionSeconds, formatPace,
  gradeFactor, hikeFactorOf, runPaceOf, runSurfaceFactor, sacHikeFactor
};
