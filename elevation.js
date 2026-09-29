// Elevation figures for a route: total ascent filtered against model noise,
// the steepest sustained incline, the gradient at a point, incline bands,
// and a profile thinned for drawing or storing.
//
// Elevations are plain arrays of metres, one per route vertex (or a thinned
// profile of them); routes are arrays of [lat, lng]. No DOM, no globals.

import { earthDistanceM } from './earth.js';

// Minimum sustained rise counted as a climb, in metres.
//
// The elevation model is quantised and noisy at the metre scale, so summing
// every upward step between consecutive vertices accumulates hundreds of
// phantom metres over a long route. A router's own total ascent is
// smoothed, but it only exists per request; a per-day ascent has to be
// derived from the profile, and it has to do the same filtering or a tour's
// four days would visibly sum to far more than the route's total. This
// threshold is the filter: only a rise that accumulates past it before the
// next descent counts.
//
// 5 m, chosen by measuring against BRouter's own filtered ascent on four
// real routes rather than by picking a round number. Each cell is
// ours ÷ BRouter, so 1.00 is agreement:
//
//   threshold      2 m    3 m    4 m    5 m   10 m
//   Munich–Innsbruck (177 km, rolling)
//                 1.75   1.16   0.81   0.66   0.28
//   Innsbruck–Brenner (alpine)
//                 1.17   1.13   1.09   1.05   0.90
//   Freiburg–Feldberg (mid-hills)
//                 1.07   1.06   1.05   1.04   1.02
//   Hamburg–Lüneburg (flat)
//                 2.97   1.94   1.58   1.33   0.58
//
// 5 m has both the lowest mean error and much the best worst case, and is
// within 5% on the two routes with real climbing — which is where the
// figure is worth anything. 10 m (the first guess here) under-reports by a
// factor of three or four on rolling terrain; anything below 3 m lets the
// flat route's noise through at three times its true ascent.
//
// The remaining error is largest where the true ascent is smallest, which
// is the right way round: 36 m versus 48 m on a flat day is a rounding
// difference nobody plans around, where being wrong by a third on an alpine
// day would matter.
var MIN_CLIMB_M = 5;

// Total ascent over a run of elevations, filtered as above.
//
// Walks the profile tracking the current unbroken rise; a rise is banked
// only once it exceeds MIN_CLIMB_M, and any descent resets it. Returns null
// rather than 0 for a profile too short to measure, so a caller can tell
// "no data" from "flat".
function ascentFrom(elevations){
  if(!elevations || elevations.length < 2) return null;
  var total = 0;
  var rising = 0;
  for(var i = 1; i < elevations.length; i++){
    var delta = elevations[i] - elevations[i - 1];
    if(delta > 0){
      rising += delta;
    } else if(delta < 0){
      // The rise has ended. Bank it if it amounted to a real climb; discard
      // it if it was jitter.
      if(rising >= MIN_CLIMB_M) total += rising;
      rising = 0;
    }
  }
  if(rising >= MIN_CLIMB_M) total += rising;
  return total;
}

// Ascent over the stretch of route between two 0..1 fractions — one riding
// day of a multi-day trip.
//
// The elevation array is indexed against the route's own vertices, so the
// fractions are converted by *index* here rather than by distance. That is
// a real approximation on a route whose vertices bunch through bends, and
// it's accepted deliberately: the figure is a rough "how much climbing is
// in this day", shown beside an equally rough arrival time, and the day's
// distance beside it already comes from the distance-accurate slice.
//
// Returns null when there's no profile to measure, which is what keeps the
// ascent out of the day header entirely for a GPX upload.
function ascentBetween(elevations, fromFraction, toFraction){
  if(!elevations || elevations.length < 2) return null;
  var n = elevations.length;
  var from = Math.max(0, Math.min(1, fromFraction || 0));
  var to = Math.max(0, Math.min(1, typeof toFraction === 'number' ? toFraction : 1));
  if(!(to > from)) return null;
  var start = Math.floor(from * (n - 1));
  var end = Math.ceil(to * (n - 1));
  return ascentFrom(elevations.slice(start, end + 1));
}

// Minimum distance a gradient is measured over. BRouter's elevation model
// is quantised, so over a short span a single step reads as a wall nobody
// actually rode; measuring over a window long enough to swamp that gives
// the steepest *sustained* pitch, which is both the honest number and the
// one a rider recognises.
//
// 200 m rather than 100: checked against Alpe d'Huez, whose steepest ramps
// are documented at about 13%. A 100 m window reports 18.4% there — still
// reading the model's own noise — where 200 m gives 13.3%, matching the
// published figure. Wider windows keep smoothing (500 m puts it under 12%)
// but start averaging away real ramps, so this is the point where the
// number stops being noise without yet being flattened.
var INCLINE_WINDOW_M = 200;

// How far apart the samples may sit before a gradient measured across them
// stops describing a climb.
//
// A stored profile is MAX_PROFILE_POINTS however long the route is, so the
// spacing grows with the distance: 200 m on a 50 km ride, but 2.5 km on a
// 600 km tour. A gradient read across samples 2.5 km apart is the AVERAGE
// slope of two and a half kilometres, and the steepest thing a rider meets
// on a long tour is a climb of one or two — averaged in with the valley
// either side of it, an alpine pass reads as a gentle drag. The figure did
// not merely lose precision; it lost the thing it names.
//
// A kilometre is where that stops: below it the climbs a "max incline" is
// about are still resolved, above it they are averaged away. Past this the
// answer is null, the same as for a route with no profile at all, and the
// figure comes back once the route is measured again at full resolution.
var MAX_INCLINE_SPACING_M = 1000;

// Metres between two [lat, lng] points, on the same sphere as everything
// else in this package.
function distanceM(a, b){
  return earthDistanceM(a, b);
}

// Steepest sustained gradient along the route, as a percentage, or null
// when it can't be computed. Uphill only: a max incline is about what has
// to be climbed, and mixing descents in would report whichever direction
// happened to be steeper.
//
// Walks a window forward from each vertex until it spans at least
// INCLINE_WINDOW_M, then takes rise over run for that window, over heights
// with lone outliers taken out first (despiked).
function maxInclinePct(latlngs, elevations){
  if(!latlngs || !elevations) return null;
  if(latlngs.length < 2 || elevations.length < 2) return null;

  // Cumulative distance to each vertex, so any window's run is one
  // subtraction rather than a re-walk — the inner loop below would
  // otherwise make this quadratic on a route with thousands of points.
  var cum = [0];
  for(var i = 1; i < latlngs.length; i++){
    cum.push(cum[i - 1] + distanceM(latlngs[i - 1], latlngs[i]));
  }
  var totalM = cum[cum.length - 1];
  // A route with no window long enough to measure reports nothing rather
  // than zero, which would claim it had been measured and found flat.
  if(totalM < INCLINE_WINDOW_M) return null;
  // Nor does a profile too coarse to hold a climb — see
  // MAX_INCLINE_SPACING_M. Same reasoning as the line above: silence rather
  // than a number that was never measured.
  if(elevations.length > 1 &&
     totalM / (elevations.length - 1) > MAX_INCLINE_SPACING_M) return null;

  // The walk is over the elevation array, not the geometry: a profile
  // restored from a saved route has been thinned to chart resolution (see
  // profileForStorage), so it is shorter than the geometry it describes.
  //
  // Each stored entry is mapped back to the *vertex* it was taken from,
  // inverting sample()'s index stride, and its distance read from there.
  // Deliberately not a proportional split of the total: sample() picks
  // evenly by index, and route vertices are not evenly spaced by distance —
  // BRouter emits them densely through bends and sparsely along straights.
  // Assuming even spacing put samples up to 400 m from where they really
  // were on a 13 km alpine route, which shrank the measured run and
  // inflated the gradient by half again.
  var n = elevations.length;
  var stride = n > 1 ? (latlngs.length - 1) / (n - 1) : 0;
  var dists = [];
  for(var k = 0; k < n; k++){
    dists.push(n === latlngs.length
      ? cum[k]
      : cum[Math.min(latlngs.length - 1, Math.round(k * stride))]);
  }
  return steepestWindowPct(dists, despiked(elevations));
}

// The elevation series with lone outliers taken out: every interior sample
// replaced by the median of itself and its two neighbours, both ends left as
// measured.
//
// A real gradient is monotonic across three consecutive samples, so a median
// of three leaves every climb and every descent exactly where it was. A
// single height the model got wrong is not monotonic — a bridge deck read as
// the gorge under it, a tunnel read as the mountain over it, a node the DEM
// simply missed — and the median puts it back between its neighbours.
//
// Why maxInclinePct() needs this: the window keeps vertex spacing from
// dominating, but it does nothing about one wrong number, and a 50 m outlier
// landing on a window's endpoint IS a 25% gradient as far as the arithmetic
// can tell.
function despiked(elevations){
  if(!elevations || elevations.length <= 2) return elevations ? elevations.slice() : elevations;
  var out = elevations.slice();
  for(var i = 1; i < elevations.length - 1; i++){
    // Read from the original throughout: a filter fed its own output walks a
    // spike along the line instead of removing it.
    var low = elevations[i - 1], mid = elevations[i], high = elevations[i + 1];
    out[i] = Math.max(Math.min(low, mid), Math.min(Math.max(low, mid), high));
  }
  return out;
}

// The window walk itself, over samples already placed along the route:
// `dists[i]` is how far along sample `elevations[i]` sits, in metres.
//
// Split out of maxInclinePct() so a part of a route (one climb, say) is
// measured with exactly this arithmetic and cannot disagree with the whole
// route's max incline. Returns 0 when no window is long enough; the caller
// decides beforehand whether the stretch was measurable at all.
function steepestWindowPct(dists, elevations){
  var n = Math.min(dists.length, elevations.length);
  var best = 0;
  var j = 0;
  for(var start = 0; start < n - 1; start++){
    // j only ever moves forward: each start's window ends at or after the
    // previous one's, so the two pointers together stay linear.
    if(j < start + 1) j = start + 1;
    while(j < n - 1 && dists[j] - dists[start] < INCLINE_WINDOW_M) j++;
    var run = dists[j] - dists[start];
    // The tail of a route shorter than one window: nothing left to measure
    // over, and a partial window would reintroduce exactly the noise the
    // window exists to remove.
    if(run < INCLINE_WINDOW_M) break;
    var rise = elevations[j] - elevations[start];
    if(rise > 0){
      var pct = (rise / run) * 100;
      if(pct > best) best = pct;
    }
  }
  return best;
}

// Elevation at a 0..1 fraction, interpolated between the two sampled points
// either side rather than snapped to the nearer one. Snapping makes a
// readout visibly step as a pointer moves along a steep section, which
// reads as imprecision in the data rather than in the sampling.
function elevationAt(points, fraction){
  var f = Math.min(1, Math.max(0, fraction));
  var pos = f * (points.length - 1);
  var i = Math.floor(pos);
  var j = Math.min(points.length - 1, i + 1);
  var frac = pos - i;
  return points[i] + (points[j] - points[i]) * frac;
}

// Gradient at a fraction, as a percentage, measured over a window rather
// than between adjacent samples.
//
// Same reasoning as INCLINE_WINDOW_M above: BRouter's elevation model is
// quantised, so a single step between two samples reports the model's noise
// as a wall. This measures across a span of the route centred on the
// fraction, which is the gradient a rider would recognise.
//
// The window is expressed as a fraction of the route rather than in metres
// because this has no geometry to measure against — only the profile array
// and the total distance, which is enough.
function gradeAt(points, fraction, totalKm){
  if(!(totalKm > 0)) return null;
  var span = points.length > 1 ? INCLINE_WINDOW_M / (totalKm * 1000) : 0;
  if(!(span > 0)) return null;
  var a = Math.max(0, fraction - span / 2);
  var b = Math.min(1, fraction + span / 2);
  var runM = (b - a) * totalKm * 1000;
  if(runM <= 0) return null;
  var rise = elevationAt(points, b) - elevationAt(points, a);
  return (rise / runM) * 100;
}

// The most points a drawn or stored profile keeps. A route can carry
// thousands of vertices, and a chart path with one command each is slow to
// parse and re-render, while at any chart width anything beyond a few
// hundred is sub-pixel detail nobody can see.
var MAX_PROFILE_POINTS = 240;

// Evenly samples `values` down to at most `max` entries, always keeping the
// first and last so the profile still starts and ends at the route's real
// endpoints rather than wherever the stride happened to land.
function sample(values, max){
  if(values.length <= max) return values.slice();
  var out = [];
  var step = (values.length - 1) / (max - 1);
  for(var i = 0; i < max; i++){
    out.push(values[Math.round(i * step)]);
  }
  return out;
}

// Thins an elevation array down to what a chart can draw and rounds to
// whole metres, for storing alongside a saved route. A long route carries
// thousands of vertices — ~30 KB of JSON to reproduce detail that is
// sub-pixel on any chart, where this is a little over 1 KB.
//
// Sub-metre precision goes too: elevation models are quantised to the metre
// anyway, so the decimals were never real. Returns null for anything with no
// profile to store.
function profileForStorage(elevations){
  if(!elevations || elevations.length < 2) return null;
  return sample(elevations, MAX_PROFILE_POINTS).map(function(m){ return Math.round(m); });
}

// ---------- Incline bands ----------
//
// Four bands of steepness, for colouring a profile: a gradient read off a
// colour is a guess, where "that stretch is in the steepest band" is a fact.
// Four is as many as stays distinguishable on a small chart.
//
// For riding, the thresholds are the ones cycling uses conversationally:
// under 4% is a drag you ride through, 4–8% is a real climb, 8–12% is hard,
// and past 12% is where most riders are out of the saddle. They are a
// convention, not derived from anything, and naming them here is the honest
// version of that.
var INCLINE_BAND_THRESHOLDS = [4, 8, 12];

// The same four bands for a hike or a run, at the gradients walking cares
// about. Under 15% is a path anyone walks without noticing much; 15–25% is
// steep, the grade where runners start to hike; 25–40% is hands-on-knees;
// past 40% is scrambling ground and steps. The cycling thresholds would
// paint every alpine path the steepest colour and say nothing.
var FOOT_INCLINE_BAND_THRESHOLDS = [15, 25, 40];

// The thresholds for a sport ('ride' | 'hike' | 'run'). Anything else is a
// ride.
function inclineBandThresholds(sport){
  return sport === 'hike' || sport === 'run' ? FOOT_INCLINE_BAND_THRESHOLDS : INCLINE_BAND_THRESHOLDS;
}

// Which band a gradient falls in, 0 (gentlest) to 3 (steepest).
//
// UPHILL ONLY. A descent takes the gentlest band, matching maxInclinePct()
// and for the same reason: a gradient figure is about what has to be
// climbed. Colouring a 10% descent like a 10% climb would make a route that
// is mostly downhill look punishing, which is the opposite of true.
//
// A non-finite gradient — Infinity from a zero-length step, or NaN from a
// missing sample — is missing data, not an infinitely steep wall, so it
// also takes the gentlest band.
function inclineBandIndex(pct, sport){
  var thresholds = inclineBandThresholds(sport);
  var g = typeof pct === 'number' && isFinite(pct) ? pct : 0;
  if(g <= 0) return 0;
  for(var i = 0; i < thresholds.length; i++){
    if(g < thresholds[i]) return i;
  }
  return thresholds.length;
}

export {
  FOOT_INCLINE_BAND_THRESHOLDS, INCLINE_BAND_THRESHOLDS, INCLINE_WINDOW_M, MAX_INCLINE_SPACING_M,
  MAX_PROFILE_POINTS, MIN_CLIMB_M,
  ascentBetween, ascentFrom, despiked, elevationAt, gradeAt, inclineBandIndex, inclineBandThresholds,
  maxInclinePct, profileForStorage, sample, steepestWindowPct
};
