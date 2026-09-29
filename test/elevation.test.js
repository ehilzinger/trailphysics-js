import { describe, expect, it } from 'vitest';
import {
  MIN_CLIMB_M, ascentBetween, ascentFrom, despiked, elevationAt, gradeAt, inclineBandIndex, inclineBandThresholds,
  maxInclinePct, profileForStorage, sample
} from '../elevation.js';

var M_PER_DEG = 6371000 * Math.PI / 180;
// n points spaced `spacingM` apart along a meridian's worth of longitude at
// the equator, where a degree of longitude is a degree of arc.
function line(n, spacingM){
  var out = [];
  for(var i = 0; i < n; i++) out.push([0, (i * spacingM) / M_PER_DEG]);
  return out;
}

// Per-day ascent has to be derived from the profile, because a router's own
// filtered figure only exists for the route as a whole. The filtering is the
// whole point: an unfiltered sum accumulates the elevation model's
// metre-scale jitter into hundreds of phantom metres, which is why BRouter's
// unfiltered "plain-ascend" is not a usable figure either.
describe('ascentFrom', () => {
  it('sums real climbs', () => {
    expect(ascentFrom([0, 50, 40, 90])).toBe(100); // +50 then +50
  });

  it('ignores descent', () => {
    expect(ascentFrom([100, 50, 0])).toBe(0);
  });

  it('discards jitter below the climb threshold', () => {
    // A sawtooth of ±2 m: a naive sum would report 20 m of climbing over
    // ground that is flat.
    var noisy = [];
    for(var i = 0; i < 20; i++) noisy.push(i % 2 ? 2 : 0);
    expect(ascentFrom(noisy)).toBe(0);
  });

  it('still counts a climb built from small steps', () => {
    // Twenty 1 m steps in the same direction is a real 20 m climb, not
    // noise — only a rise interrupted by descent is discarded.
    var steady = [];
    for(var i = 0; i <= 20; i++) steady.push(i);
    expect(ascentFrom(steady)).toBe(20);
  });

  it('banks a climb that runs to the end of the profile', () => {
    expect(ascentFrom([0, MIN_CLIMB_M + 5])).toBe(MIN_CLIMB_M + 5);
  });

  // The threshold is calibrated against BRouter's own filtered figure on
  // real routes (see the table on MIN_CLIMB_M). These pin the two failure
  // modes that calibration sits between, so a future tweak has to stay
  // between them rather than drifting back to either extreme.
  it('is tight enough to reject the elevation model’s jitter', () => {
    // ±4 m sawtooth over flat ground: 25 oscillations, which an unfiltered
    // sum would report as 100 m of climbing.
    var noisy = [];
    for(var i = 0; i < 50; i++) noisy.push(i % 2 ? 4 : 0);
    expect(ascentFrom(noisy)).toBe(0);
  });

  it('is loose enough to keep the rolling climbs a naive filter would lose', () => {
    // Six real 8 m rollers — small, but genuinely ridden. A 10 m threshold
    // (the first guess here) discarded all of them, under-reporting rolling
    // terrain by a factor of three or four.
    var rollers = [];
    for(var i = 0; i < 6; i++) rollers.push(0, 8);
    expect(ascentFrom(rollers)).toBe(48);
  });

  it('returns null for a profile too short to measure', () => {
    // null rather than 0, so a caller can tell "no data" from "flat".
    expect(ascentFrom([])).toBeNull();
    expect(ascentFrom([100])).toBeNull();
    expect(ascentFrom(null)).toBeNull();
  });
});

describe('ascentBetween', () => {
  // First half climbs 100 m, second half descends it again.
  var profile = [0, 25, 50, 75, 100, 75, 50, 25, 0];

  it('measures only the requested stretch', () => {
    expect(ascentBetween(profile, 0, 0.5)).toBe(100);
    expect(ascentBetween(profile, 0.5, 1)).toBe(0);
  });

  it('measures the whole profile across the full range', () => {
    expect(ascentBetween(profile, 0, 1)).toBe(100);
  });

  it('clamps fractions outside 0..1', () => {
    expect(ascentBetween(profile, -1, 2)).toBe(100);
  });

  it('returns null for an empty or inverted range', () => {
    expect(ascentBetween(profile, 0.5, 0.5)).toBeNull();
    expect(ascentBetween(profile, 0.8, 0.2)).toBeNull();
  });

  it('returns null when there is no profile', () => {
    expect(ascentBetween(null, 0, 1)).toBeNull();
    expect(ascentBetween([100], 0, 1)).toBeNull();
  });

  // The property that keeps the day headers honest against the total shown
  // above them: the days must not sum to wildly more than the whole route.
  it('has days that sum to about the whole route', () => {
    var days = ascentBetween(profile, 0, 0.25) + ascentBetween(profile, 0.25, 0.5) +
      ascentBetween(profile, 0.5, 0.75) + ascentBetween(profile, 0.75, 1);
    expect(days).toBeCloseTo(ascentBetween(profile, 0, 1), 5);
  });
});

describe('sample', () => {
  it('leaves a series shorter than the cap untouched', () => {
    expect(sample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('downsamples to the cap', () => {
    var input = Array.from({ length: 1000 }, function(_, i){ return i; });
    expect(sample(input, 240)).toHaveLength(240);
  });

  // Without this the profile would start and end wherever the stride landed,
  // so a route's real endpoints could be missing from its own chart.
  it('always keeps the first and last value', () => {
    var input = Array.from({ length: 1000 }, function(_, i){ return i; });
    var out = sample(input, 240);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(999);
  });
});

describe('maxInclinePct', () => {
  it('returns null without usable inputs', () => {
    expect(maxInclinePct(null, [1, 2])).toBe(null);
    expect(maxInclinePct([[0, 0], [0, 1]], null)).toBe(null);
    expect(maxInclinePct([[0, 0]], [100])).toBe(null);
  });

  // Shorter than one smoothing window (200 m): nothing can be measured, and
  // reporting 0 would claim it had been measured and found flat.
  it('returns null for a route shorter than the smoothing window', () => {
    expect(maxInclinePct(line(5, 10), [100, 101, 102, 103, 104])).toBe(null);   // 40 m
    expect(maxInclinePct(line(11, 15), Array(11).fill(100))).toBe(null);        // 150 m
  });

  // The window is calibrated against a real road climb rather than picked
  // round: Alpe d'Huez's steepest ramps are documented at about 13%, which a
  // 100 m window overstates as 18% by still reading the elevation model's
  // own noise. This pins the constant so a later tweak has to be deliberate.
  it('measures over a 200 m window', () => {
    // 300 m of geometry rising 30 m only in its first 100 m. A 100 m window
    // would find that 10% ramp; a 200 m window reports the 30 m spread over
    // 200 m instead.
    var pts = line(31, 10);
    var elev = pts.map(function(_, i){ return 100 + Math.min(i, 10) * 3; });
    var pct = maxInclinePct(pts, elev);
    expect(pct).toBeCloseTo(15, 0); // 30 m over 200 m, not 10 m over 100 m
    expect(pct).toBeLessThan(30);
  });

  // A stored profile keeps MAX_PROFILE_POINTS however long the route is, so
  // on a tour its samples sit kilometres apart. A gradient measured across
  // them is the average slope of those kilometres, and an alpine pass
  // averaged in with the valley either side of it reads as a gentle drag —
  // the figure does not lose precision, it loses the thing it names.
  it('returns null when the samples are too far apart to hold a climb', () => {
    // 600 km of line, thinned to one sample every 2.5 km.
    var pts = line(241, 2500);
    var elev = pts.map(function(_, i){ return 100 + i * 5; });
    expect(maxInclinePct(pts, elev)).toBe(null);

    // The same thinning on a route short enough for the samples to still
    // land inside a climb keeps its figure.
    var near = line(241, 200);   // 48 km, a sample every 200 m
    var nearElev = near.map(function(_, i){ return 100 + i * 10; });
    expect(maxInclinePct(near, nearElev)).toBeGreaterThan(0);
  });

  it('measures a steady climb', () => {
    // 11 points, 50 m apart = 500 m long, rising 25 m = a steady 5%.
    var pts = line(11, 50);
    var elev = pts.map(function(_, i){ return 100 + i * 2.5; });
    expect(maxInclinePct(pts, elev)).toBeCloseTo(5, 1);
  });

  it('is zero for a flat route, and ignores descents', () => {
    var pts = line(11, 50);
    expect(maxInclinePct(pts, pts.map(function(){ return 100; }))).toBe(0);
    // Downhill only — a max *incline* is about what has to be climbed.
    expect(maxInclinePct(pts, pts.map(function(_, i){ return 200 - i * 5; }))).toBe(0);
  });

  // The whole reason for the window: BRouter's model is quantised to the
  // metre, so a 1 m step between vertices 5 m apart is a phantom 20% wall.
  it('does not report a spike from a single jittery vertex', () => {
    // 205 m long, 5 m spacing: just clear of the 200 m window, which a line
    // of exactly 200 m misses by the last bits of floating point.
    var pts = line(42, 5);
    var elev = pts.map(function(){ return 100; });
    elev[20] = 101; // one metre of model noise
    var pct = maxInclinePct(pts, elev);
    // Raw segment-to-segment would be 20%; over a 100 m window it's ~1%.
    expect(pct).toBeLessThan(2);
  });

  it('finds the steepest pitch, not the average', () => {
    // 600 m: flat for 300 m, then 30 m of climb over the last 300 m (10%).
    var pts = line(13, 50);
    var elev = [100, 100, 100, 100, 100, 100, 100, 105, 110, 115, 120, 125, 130];
    var pct = maxInclinePct(pts, elev);
    expect(pct).toBeGreaterThan(8);
  });

  // A profile restored from a saved route has been thinned to chart
  // resolution, so it is shorter than the geometry it describes. It must
  // still produce a sensible figure rather than bailing on the mismatch.
  it('handles a stored profile thinned below the geometry length', () => {
    var pts = line(201, 10);              // 2 km of geometry
    var elev = [];                        // 21 samples across the same 2 km
    for(var i = 0; i < 21; i++) elev.push(100 + i * 10); // +200 m over 2 km = 10%
    var pct = maxInclinePct(pts, elev);
    expect(pct).toBeCloseTo(10, 0);
  });

  // Regression: profileForStorage samples evenly by *index*, and real route
  // vertices are not evenly spaced by distance — BRouter emits them densely
  // through bends and sparsely along straights. Placing stored samples at a
  // proportional split of the total distance therefore put them hundreds of
  // metres from where they really were, shrinking the run and inflating the
  // gradient by half again on a real alpine route.
  it('locates stored samples by vertex, not by an even distance split', () => {
    // Geometry with deliberately uneven spacing: half the vertices packed
    // into a short dense stretch, half spread over a long sparse one — the
    // shape that broke the old maths. Enough vertices that storage actually
    // thins them (profileForStorage caps at 240).
    var pts = [[0, 0]];
    var d = 0;
    for(var i = 0; i < 400; i++){ d += 2;   pts.push([0, d / M_PER_DEG]); } //  800 m, dense
    for(var k = 0; k < 400; k++){ d += 100; pts.push([0, d / M_PER_DEG]); } // 40 km, sparse
    // All the climbing is in the dense stretch: +80 m over 800 m = 10%.
    // Flat thereafter. The dense half holds half the *indices* but under 2%
    // of the distance, so index position and distance position disagree
    // wildly — which is exactly what the old mapping conflated.
    var full = pts.map(function(_, idx){ return 100 + Math.min(idx, 400) * 0.2; });

    var live = maxInclinePct(pts, full);
    var stored = maxInclinePct(pts, profileForStorage(full));

    expect(live).toBeCloseTo(10, 0);
    // Asserted as a value, not a bound: the proportional mapping's error
    // runs in whichever direction the vertex spacing happens to skew (it
    // understated this route as 0.4% and overstated a real alpine one by
    // half again), so only pinning the correct figure catches both.
    expect(stored).toBeCloseTo(10, 0);
  });
});

describe('profileForStorage', () => {
  it('returns null when there is no profile worth storing', () => {
    expect(profileForStorage(null)).toBe(null);
    expect(profileForStorage([])).toBe(null);
    expect(profileForStorage([100])).toBe(null);
  });

  it('rounds to whole metres — the model has no sub-metre precision anyway', () => {
    expect(profileForStorage([100.4, 120.6, 99.5])).toEqual([100, 121, 100]);
  });

  // The stored array only has to reproduce what the chart draws, so it's
  // capped at the same resolution rather than the full routing geometry.
  it('caps a long profile at chart resolution', () => {
    var long = Array.from({ length: 4000 }, function(_, i){ return i; });
    var stored = profileForStorage(long);
    expect(stored).toHaveLength(240);
    expect(stored[0]).toBe(0);
    expect(stored[stored.length - 1]).toBe(3999); // endpoints preserved
  });
});

describe('elevationAt', () => {
  it('returns the endpoints exactly', () => {
    expect(elevationAt([10, 20, 30], 0)).toBe(10);
    expect(elevationAt([10, 20, 30], 1)).toBe(30);
  });

  it('interpolates between samples rather than snapping to one', () => {
    // Snapping makes the readout visibly step along a steep section, which
    // reads as imprecision in the data rather than in the sampling.
    expect(elevationAt([0, 100], 0.5)).toBe(50);
    expect(elevationAt([0, 100], 0.25)).toBe(25);
  });

  it('clamps outside 0..1 instead of reading off the end', () => {
    expect(elevationAt([10, 20], -1)).toBe(10);
    expect(elevationAt([10, 20], 5)).toBe(20);
  });
});

describe('gradeAt', () => {
  it('reports a climb as positive and a descent as negative', () => {
    var up = [0, 50, 100], down = [100, 50, 0];
    expect(gradeAt(up, 0.5, 1)).toBeGreaterThan(0);
    expect(gradeAt(down, 0.5, 1)).toBeLessThan(0);
  });

  it('reads a steady gradient at its true value', () => {
    // 100 m of climb over 1 km is 10%. Measured over a window, so a steady
    // slope should come back as itself rather than as a smoothed guess.
    var steady = [];
    for(var i = 0; i <= 100; i++) steady.push(i);
    expect(gradeAt(steady, 0.5, 1)).toBeCloseTo(10, 0);
  });

  it('reports flat ground as zero', () => {
    expect(gradeAt([50, 50, 50, 50], 0.5, 2)).toBe(0);
  });

  it('measures over a window rather than between adjacent samples', () => {
    // A single spiked sample is the elevation model's noise, not a wall.
    // Between neighbours it would read as an extreme gradient; over a
    // window it stays plausible.
    var spiky = [];
    for(var i = 0; i <= 100; i++) spiky.push(i === 50 ? 40 : 0);
    expect(Math.abs(gradeAt(spiky, 0.5, 5))).toBeLessThan(100);
  });

  it('reports nothing without a usable distance', () => {
    // No distance means no run to divide by; a number here would be invented.
    expect(gradeAt([0, 100], 0.5, 0)).toBeNull();
    expect(gradeAt([0, 100], 0.5, null)).toBeNull();
  });
});

describe('despiked', () => {
  it('puts a lone outlier back between its neighbours and leaves a real climb alone', () => {
    // Each sample takes the median of itself and its ORIGINAL neighbours:
    // 180 (between 110 and 130) becomes 130, and 130 (between 180 and 140)
    // becomes 140.
    expect(despiked([100, 110, 180, 130, 140])).toEqual([100, 110, 130, 140, 140]);
    var climb = [100, 110, 120, 130, 140];
    expect(despiked(climb)).toEqual(climb);
  });

  it('keeps both ends as measured and copies rather than mutating', () => {
    var input = [300, 100, 100, 100, 300];
    expect(despiked(input)).toEqual([300, 100, 100, 100, 300]);
    expect(despiked([5, 9])).toEqual([5, 9]);
    var before = input.slice();
    despiked(input);
    expect(input).toEqual(before);
  });

  it('keeps a lone bad height from becoming the max incline', () => {
    var pts = line(41, 50);
    var steady = pts.map((_, i) => 600 + i * 2);        // 4%
    var spiked = steady.map((m, i) => i === 20 ? m + 60 : m);
    expect(maxInclinePct(pts, steady)).toBeCloseTo(4, 1);
    // Read raw, the 60 m spike on a window's end is 34%. The median puts it
    // back in line, leaving at most one step of the real climb out of place.
    expect(maxInclinePct(pts, spiked)).toBeLessThan(5.5);
  });
});

describe('inclineBandIndex', () => {
  it('bands a ride at 4, 8 and 12 percent', () => {
    expect(inclineBandThresholds('ride')).toEqual([4, 8, 12]);
    expect(inclineBandIndex(0)).toBe(0);
    expect(inclineBandIndex(3.9)).toBe(0);
    expect(inclineBandIndex(4)).toBe(1);
    expect(inclineBandIndex(7.9)).toBe(1);
    expect(inclineBandIndex(8)).toBe(2);
    expect(inclineBandIndex(12)).toBe(3);
    expect(inclineBandIndex(40)).toBe(3);
  });

  it('bands a hike or a run at 15, 25 and 40 percent', () => {
    expect(inclineBandThresholds('hike')).toEqual([15, 25, 40]);
    expect(inclineBandThresholds('run')).toEqual([15, 25, 40]);
    expect(inclineBandIndex(12, 'hike')).toBe(0);
    expect(inclineBandIndex(15, 'run')).toBe(1);
    expect(inclineBandIndex(30, 'hike')).toBe(2);
    expect(inclineBandIndex(40, 'run')).toBe(3);
  });

  it('treats any other sport as a ride', () => {
    expect(inclineBandThresholds(undefined)).toEqual([4, 8, 12]);
    expect(inclineBandThresholds('swim')).toEqual([4, 8, 12]);
  });

  it('puts a descent and missing data in the gentlest band', () => {
    expect(inclineBandIndex(-15)).toBe(0);
    expect(inclineBandIndex(NaN)).toBe(0);
    expect(inclineBandIndex(Infinity)).toBe(0);
    expect(inclineBandIndex(null)).toBe(0);
    expect(inclineBandIndex('9')).toBe(0);
  });
});
