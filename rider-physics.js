// How fast a given rider covers a given route, from physics rather than a
// flat table.
//
// A flat average speed knows nothing about the rider: a loaded tourer at
// 180 W and a light rider at 260 W get identical times up the same alpine
// pass, which is wrong by hours, and climbs always run late against it.
//
// This module answers the question from the four forces a bicycle
// actually works against. It is deliberately pure: no state, no DOM, no
// map. Everything here is arithmetic over plain numbers and arrays, so
// it can be checked by hand and tested without a map attached.
//
// Two entry points, because a caller usually needs the answer at two very
// different costs:
//
//   estimateSpeedKmh()  — one solve at the route's mean gradient. Cheap
//                         enough for every row of a long list of routes.
//   detailedSpeedKmh()  — one solve per segment of the elevation profile,
//                         summing times. For the one route being looked at.
//
// The detailed figure is always slower than the approximation on rolling
// terrain, and that gap is the whole reason it exists: climbing at 6 km/h
// costs ten minutes a kilometre where descending at 45 km/h gives back only
// eighty seconds. A mean gradient cannot see that asymmetry — it is a
// property of averaging *times*, not slopes.

// ---------- Physical constants ----------

import { earthDistanceM } from './earth.js';

var GRAVITY = 9.80665;

// Air density at sea level, 15 °C. Thinner air higher up is a real effect
// (roughly -10% per 1000 m, worth ~1 km/h on a fast flat) and is applied by
// airDensityAt() below, from the route's own elevation where we have it.
var AIR_DENSITY_SEA_LEVEL = 1.225;

// Chain and bearings. 2-3% is the usual measured range for a clean
// drivetrain; the rider's power is at the pedals, and this is what reaches
// the road.
var DRIVETRAIN_EFFICIENCY = 0.97;

// ---------- Rider-facing presets ----------
//
// CdA is never asked for directly. Nobody outside a wind tunnel knows their
// own drag area, and on a flat route a wrong guess dominates every other
// error in this module — so it is derived from a bike type the rider *can*
// answer, optionally sharpened by their height.
//
// Figures are drag area in m² for a rider of average build in that position,
// and are the widely-published ranges rather than anything measured here.
var BIKE_TYPE_CDA = {
  road: 0.32,     // hands on the hoods, the position most people actually ride
  gravel: 0.36,   // flared bars, a slightly more upright back
  trekking: 0.42, // upright, bar bag; the default (DEFAULT_BIKE_TYPE)
  mtb: 0.46       // wide bars, most upright of the four
};

var DEFAULT_BIKE_TYPE = 'trekking';

// Rolling resistance coefficient by surface. Spans a factor of four, which
// sounds dramatic but is worth less than a km/h at touring speeds on the
// flat — it is included because it is cheap and because it matters on the
// long shallow climbs where a loaded bike spends its day.
var CRR_BY_SURFACE = {
  asphalt: 0.004,
  gravel: 0.010,
  offroad: 0.018
};

var DEFAULT_SURFACE = 'asphalt';

// Luggage is not a separate field. Rider weight and bike-plus-kit weight
// are asked separately because people know them separately, and this is the
// fallback for the second when it hasn't been given: a bike, bags, water and
// tools for a loaded tour.
var DEFAULT_BIKE_KG = 18;

// ---------- Sanity bounds ----------
//
// These bound the *inputs*, not the answer. A profile outside them is
// rejected whole rather than clamped: a 5000 W entry is a typo or a unit
// mix-up, and quietly treating it as 500 would produce a confident, wrong
// arrival time — worse than no rider-specific figure at all.
var MIN_RIDER_KG = 30;
var MAX_RIDER_KG = 200;
var MIN_BIKE_KG = 3;
var MAX_BIKE_KG = 80;
var MIN_WATTS = 40;
var MAX_WATTS = 500;

// The braking cap. A loaded touring bike on an unknown descent does not do
// 90 km/h whatever the physics says, because the rider is on the brakes
// looking for the next hairpin. Without this the harmonic mean is quietly
// wrecked by a handful of steep segments.
var MAX_DESCENT_KMH = 65;

// Below this gradient the rider is assumed to stop pedalling and coast.
// -2% is about where a touring pace carries itself; above it people keep
// turning the cranks, below it they mostly don't.
var COASTING_GRADIENT = -0.02;

// Minimum distance a gradient is measured over, in metres.
//
// Not a fresh choice — this is elevation.js's INCLINE_WINDOW_M and the
// same reasoning applies for the same reason: BRouter's elevation model is
// quantised, so a single metre step over a 30 m segment reads as a 3% ramp
// that nobody rode. elevation.js tuned 200 m against Alpe d'Huez (100 m
// reported 18.4% where the published figure is ~13%); here the consequence
// of not smoothing is worse than a wrong headline number, because every
// phantom ramp adds real minutes to the total.
var GRADIENT_WINDOW_M = 200;

// ---------- Deriving the parameters a solve needs ----------

// Air density at a given elevation, via the standard barometric lapse.
// Simplified to the troposphere case, which covers anywhere a bicycle goes.
function airDensityAt(elevationM){
  if(typeof elevationM !== 'number' || !isFinite(elevationM)) return AIR_DENSITY_SEA_LEVEL;
  var h = Math.max(0, elevationM);
  return AIR_DENSITY_SEA_LEVEL * Math.pow(1 - 2.25577e-5 * h, 4.25588);
}

// Drag area for a rider, from the bike type and — when given — their build.
//
// The bike type sets the position, which is most of it. Height and weight
// only scale that baseline by body size, via the DuBois body-surface
// formula normalised to a 175 cm / 75 kg reference, so an average rider
// gets exactly the table figure and a much larger or smaller one gets a
// proportionate adjustment. Clamped hard: DuBois is an approximation being
// pushed well past what it was fitted for, and a ±25% band is enough to
// carry the real signal without letting an odd entry invent a drag area.
function defaultCdA(heightCm, weightKg, bikeType){
  var base = BIKE_TYPE_CDA[bikeType] || BIKE_TYPE_CDA[DEFAULT_BIKE_TYPE];
  var h = typeof heightCm === 'number' && isFinite(heightCm) && heightCm > 0 ? heightCm : null;
  var w = typeof weightKg === 'number' && isFinite(weightKg) && weightKg > 0 ? weightKg : null;
  if(h === null || w === null) return base;

  var bsa = 0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425);
  var reference = 0.007184 * Math.pow(175, 0.725) * Math.pow(75, 0.425);
  var scale = Math.min(1.25, Math.max(0.75, bsa / reference));
  return base * scale;
}

// Normalises whatever a form or storage hands over into the shape every
// function below assumes, or returns null when it isn't usable.
//
// Returning null rather than a defaulted profile is deliberate: "no rider
// profile" has to stay distinguishable from "a rider profile made of
// guesses", because the first means the caller should fall back to its own
// generic speeds and the second means show a confident figure. Only the
// two fields nobody can substitute for — weight and power — are required;
// everything else has a defensible default.
function normalizeRider(rider){
  if(!rider) return null;

  var riderKg = Number(rider.riderKg);
  var watts = Number(rider.watts);
  if(!isFinite(riderKg) || riderKg < MIN_RIDER_KG || riderKg > MAX_RIDER_KG) return null;
  if(!isFinite(watts) || watts < MIN_WATTS || watts > MAX_WATTS) return null;

  var bikeKg = Number(rider.bikeKg);
  if(!isFinite(bikeKg) || bikeKg < MIN_BIKE_KG || bikeKg > MAX_BIKE_KG) bikeKg = DEFAULT_BIKE_KG;

  var bikeType = BIKE_TYPE_CDA[rider.bikeType] ? rider.bikeType : DEFAULT_BIKE_TYPE;
  var surface = CRR_BY_SURFACE[rider.surface] ? rider.surface : DEFAULT_SURFACE;

  // An explicit CdA is honoured when present but never asked for — it
  // exists so a rider who has actually been measured isn't overridden by a
  // table, and so round-tripping a stored profile can't silently change it.
  var cda = Number(rider.cda);
  if(!isFinite(cda) || cda <= 0.1 || cda > 1.2){
    cda = defaultCdA(rider.heightCm, riderKg, bikeType);
  }

  return {
    riderKg: riderKg,
    bikeKg: bikeKg,
    totalKg: riderKg + bikeKg,
    watts: watts,
    cda: cda,
    crr: CRR_BY_SURFACE[surface],
    // Sea level until a caller that knows the altitude says otherwise, so
    // the result can go straight into solveSpeed() or speedForGradient().
    rho: AIR_DENSITY_SEA_LEVEL,
    bikeType: bikeType,
    surface: surface,
    fatigue: rider.fatigue === true
  };
}

// ---------- The solve ----------
//
// Steady-state power balance for a bicycle on a constant slope:
//
//   P·η = v · ( m·g·(sin θ + Crr·cos θ) + ½·ρ·CdA·v² )
//
// which rearranges to a depressed cubic in v:
//
//   ½·ρ·CdA·v³ + m·g·(sin θ + Crr·cos θ)·v − P·η = 0
//
// Acceleration is deliberately absent. Over a 200 m window at touring
// speeds the kinetic-energy term is a rounding error against the other
// three, and including it would require modelling how hard the rider brakes
// into each bend — which is a much bigger guess than the one it fixes.

// The real positive root, in m/s.
//
// Newton from a seed, falling back to bisection. Newton alone is not safe
// here: on a steep descent the linear coefficient goes strongly negative,
// the cubic grows a local maximum, and an unlucky seed walks the iteration
// off to a negative root that is mathematically real and physically
// nonsense. Bisection over a bracket that is guaranteed to contain the
// positive root cannot do that, so it is what decides the answer whenever
// Newton fails to converge cleanly.
function solveSpeed(watts, gradient, params){
  var cdaTerm = 0.5 * params.rho * params.cda;
  var theta = Math.atan(gradient);
  var resistTerm = params.totalKg * GRAVITY *
    (Math.sin(theta) + params.crr * Math.cos(theta));
  var drive = watts * DRIVETRAIN_EFFICIENCY;

  // f(v) = cdaTerm·v³ + resistTerm·v − drive
  //
  // Strictly increasing in v wherever resistTerm >= 0, and with exactly one
  // positive root regardless of resistTerm's sign (Descartes: the
  // coefficient signs change exactly once, since drive > 0).
  function f(v){
    return cdaTerm * v * v * v + resistTerm * v - drive;
  }

  // Bracket the root. f(0) = -drive < 0 always, so we only need an upper
  // bound where f turns positive; doubling from a sane starting guess finds
  // one in a handful of steps even on the steepest descent.
  var hi = 1;
  var guard = 0;
  while(f(hi) < 0 && guard++ < 60) hi *= 2;
  var lo = 0;

  // Newton first, from the midpoint of the bracket — fast when the function
  // is well-behaved, which is the overwhelmingly common case.
  var v = hi / 2;
  for(var i = 0; i < 12; i++){
    var fv = f(v);
    var slope = 3 * cdaTerm * v * v + resistTerm;
    if(!(slope > 1e-9)) break;      // flat or negative: hand over to bisection
    var next = v - fv / slope;
    if(!(next > lo && next < hi)) break;  // left the bracket: same
    if(Math.abs(next - v) < 1e-9){ v = next; return v; }
    v = next;
  }

  // Bisection. Always converges, and 60 halvings of a bracket this size is
  // far past double precision.
  lo = 0;
  for(var j = 0; j < 60; j++){
    var mid = (lo + hi) / 2;
    if(f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Speed on one stretch of constant gradient, in m/s, with the two
// behavioural caps a bare solve doesn't know about.
//
// Below COASTING_GRADIENT the rider is treated as freewheeling: the solve
// runs at zero power, giving terminal velocity for that slope, because
// pedalling 200 W down an 8% descent is not something people do and
// modelling it produces speeds nobody rides. The braking cap then applies
// on top, for the reason given at MAX_DESCENT_KMH.
function speedForGradient(gradient, params){
  var watts = gradient < COASTING_GRADIENT ? 0 : params.watts;
  var v = solveSpeed(watts, gradient, params);
  var capMs = MAX_DESCENT_KMH / 3.6;
  if(v > capMs) v = capMs;
  return v;
}

// ---------- Fatigue ----------

// How much of the entered power is still available after `hours` of riding.
//
// A critical-power style decay: sustainable output falls roughly as a small
// negative power of duration. The exponent here is deliberately gentle —
// the figure a tourer enters is what they can hold for a long day, not a
// 20-minute test, so most of the decay this models is already priced into
// their own number. It exists to stop a twelve-hour day being estimated at
// hour-one pace, not to re-derive a power curve.
//
// Floored so a very long day cannot decay toward zero and produce an
// arrival time in the following week.
//
// `hours` is ONE DAY's riding, never a whole tour — see fatigueHours()
// below, which is what enforces that. A night's sleep is not a rounding
// error in a power curve: day five of a tour starts fresh, and feeding it
// the cumulative forty hours would model somebody who never got off the
// bike.
var FATIGUE_EXPONENT = 0.04;
var MIN_FATIGUE_FACTOR = 0.75;

function fatigueFactor(hours){
  if(typeof hours !== 'number' || !isFinite(hours) || hours <= 1) return 1;
  var f = Math.pow(hours, -FATIGUE_EXPONENT);
  return Math.max(MIN_FATIGUE_FACTOR, f);
}

// The hours fatigue should actually be computed over, given the whole
// route's riding time and (optionally) how long the longest planned day is.
//
// Both estimateSpeedKmh() and detailedSpeedKmh() return a single average for
// the WHOLE route, because one speed is what a caller turns into arrival
// times along it. Fatigue is the one term in the model that isn't
// scale-free, so it has to be told what a day is rather than inferring it
// from a total that may span a week.
//
// `dayHours` is the longest day rather than the mean: it is the day that
// actually costs something, and taking the mean would let one short
// transfer day flatter every other day on the tour. Unsplit routes pass
// nothing and fall back to the total, which is correct — an unsplit route
// IS one day, however long.
function fatigueHours(totalHours, dayHours){
  if(typeof dayHours === 'number' && isFinite(dayHours) && dayHours > 0){
    return Math.min(totalHours, dayHours);
  }
  return totalHours;
}

// ---------- Tier one: the approximation ----------

// Average speed in km/h from distance and total ascent alone, or null when
// there isn't enough to work with.
//
// A stored route usually carries both as plain figures, so this can run for
// every row of a list without touching the elevation array. What it cannot
// see is the *distribution* of that ascent: 1000 m spread evenly and
// 1000 m in one wall give the same answer here, and the second is genuinely
// slower. detailedSpeedKmh() below is the fix, and a caller showing both
// should label them differently for exactly this reason.
//
// The mean gradient is halved on the way in. A route with 1000 m of ascent
// over 100 km does not climb at 1% throughout — it climbs at some steeper
// figure for part of the distance and descends for the rest, and feeding
// the naive ascent/distance ratio in as a *sustained* gradient overstates
// the time badly. Half the ratio is the standard approximation for an
// out-and-back-ish profile and lands within a few percent of the segment
// solve on the reference routes.
// `dayHours` is optional: the longest single day's riding time, when the
// route is split into days. Only fatigue reads it — see fatigueHours().
function estimateSpeedKmh(rider, distanceKm, ascentM, dayHours){
  var params = normalizeRider(rider);
  if(!params) return null;
  if(typeof distanceKm !== 'number' || !isFinite(distanceKm) || distanceKm <= 0) return null;

  var ascent = typeof ascentM === 'number' && isFinite(ascentM) && ascentM > 0 ? ascentM : 0;
  var gradient = (ascent / (distanceKm * 1000)) / 2;

  params.rho = AIR_DENSITY_SEA_LEVEL;
  var ms = speedForGradient(gradient, params);
  if(!(ms > 0)) return null;

  var kmh = ms * 3.6;
  if(params.fatigue){
    // One pass is enough: the correction is a few percent, so re-solving
    // with the decayed power would move the hours it depends on by less
    // than the rounding on the figure shown.
    kmh = kmh * fatigueFactor(fatigueHours(distanceKm / kmh, dayHours));
  }
  return kmh;
}

// ---------- Tier two: the detailed solve ----------

// Metres between two [lat, lng] points: earth.js's spherical measure, so
// distances here agree with the ones elevation.js and a caller measure.
function distanceM(a, b){
  return earthDistanceM(a, b);
}

// Average speed in km/h from the full elevation profile, or null when the
// route can't support one.
//
// Walks the profile in windows of at least GRADIENT_WINDOW_M, solving for
// each and accumulating TIME. Summing times rather than averaging speeds is
// not a detail — the distance-weighted harmonic mean is what "average
// speed" means, and averaging the segment speeds instead would flatter
// every hilly route by exactly the amount the fast descents inflate it.
//
// `dayHours` is optional and means the same as in estimateSpeedKmh above.
function detailedSpeedKmh(rider, latlngs, elevations, dayHours){
  var params = normalizeRider(rider);
  if(!params) return null;
  if(!latlngs || !elevations) return null;
  if(latlngs.length < 2 || elevations.length < 2) return null;

  // Cumulative distance to each vertex, so a window's run is one
  // subtraction rather than a re-walk.
  var cum = [0];
  for(var i = 1; i < latlngs.length; i++){
    cum.push(cum[i - 1] + distanceM(latlngs[i - 1], latlngs[i]));
  }
  var totalM = cum[cum.length - 1];
  if(!(totalM > 0)) return null;

  // The elevation array is walked, not the geometry, and the two are
  // different lengths whenever the profile was thinned for storage:
  // elevation.js's profileForStorage() thins to MAX_PROFILE_POINTS (240).
  // Each elevation index maps to the vertex it was sampled from by
  // inverting elevation.js's sample() index stride.
  //
  // Deliberately NOT a proportional split of the total distance.
  // elevation.js records what that costs: BRouter emits vertices densely
  // through bends and sparsely along straights, so assuming even spacing
  // put samples up to 400 m from their real position on a 13 km alpine
  // route and inflated the gradients by half again. Same array, same trap.
  var n = elevations.length;
  var stride = n > 1 ? (latlngs.length - 1) / (n - 1) : 0;
  function distanceAt(index){
    if(n === latlngs.length) return cum[index];
    return cum[Math.min(latlngs.length - 1, Math.round(index * stride))];
  }

  var seconds = 0;
  var covered = 0;
  var start = 0;
  while(start < n - 1){
    // Extend to at least one smoothing window, for the reason at
    // GRADIENT_WINDOW_M.
    var end = start + 1;
    while(end < n - 1 && distanceAt(end) - distanceAt(start) < GRADIENT_WINDOW_M) end++;

    var run = distanceAt(end) - distanceAt(start);
    if(!(run > 0)){ start = end; continue; }

    var rise = elevations[end] - elevations[start];
    params.rho = airDensityAt((elevations[start] + elevations[end]) / 2);

    var ms = speedForGradient(rise / run, params);
    if(ms > 0){
      seconds += run / ms;
      covered += run;
    }
    start = end;
  }

  if(!(covered > 0) || !(seconds > 0)) return null;

  var kmh = (covered / 1000) / (seconds / 3600);
  if(params.fatigue){
    kmh = kmh * fatigueFactor(fatigueHours(seconds / 3600, dayHours));
  }
  return kmh;
}

export {
  AIR_DENSITY_SEA_LEVEL, BIKE_TYPE_CDA, COASTING_GRADIENT, CRR_BY_SURFACE,
  DEFAULT_BIKE_KG, DEFAULT_BIKE_TYPE, DEFAULT_SURFACE, DRIVETRAIN_EFFICIENCY,
  GRADIENT_WINDOW_M, GRAVITY, MAX_BIKE_KG, MAX_DESCENT_KMH, MAX_RIDER_KG,
  MAX_WATTS, MIN_BIKE_KG, MIN_RIDER_KG, MIN_WATTS,
  airDensityAt, defaultCdA, detailedSpeedKmh, estimateSpeedKmh, fatigueFactor,
  fatigueHours, normalizeRider, solveSpeed, speedForGradient
};
