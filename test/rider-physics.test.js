import { describe, expect, it } from 'vitest';

import {
  AIR_DENSITY_SEA_LEVEL, BIKE_TYPE_CDA, CRR_BY_SURFACE, DEFAULT_BIKE_KG, MAX_DESCENT_KMH,
  airDensityAt, defaultCdA, detailedSpeedKmh, estimateSpeedKmh, fatigueFactor,
  fatigueHours, normalizeRider, solveSpeed, speedForGradient
} from '../rider-physics.js';

// A rider whose figures are round enough to reason about: 75 kg all-in
// (65 + 10), 250 W, road position, asphalt. Every expected number below was
// cross-checked against an independent form of the same physics — see the
// VAM assertion in the solver block for the one that anchors the rest.
function rider(extra){
  return Object.assign({
    riderKg: 65,
    bikeKg: 10,
    watts: 250,
    bikeType: 'road',
    surface: 'asphalt'
  }, extra || {});
}

// Solver params in the shape normalizeRider produces. Kept separate so the
// solver can be tested without going through profile normalisation.
function params(extra){
  return Object.assign({
    rho: 1.225, cda: 0.32, crr: 0.004, totalKg: 75, watts: 250
  }, extra || {});
}

describe('solveSpeed', () => {
  it('matches a known flat figure', () => {
    // 250 W at CdA 0.32 / Crr 0.004 on the flat. Drag is ~90% of the load
    // here, so this is essentially a check that the cubic's v³ term is
    // right.
    var kmh = solveSpeed(250, 0, params()) * 3.6;
    expect(kmh).toBeGreaterThan(36);
    expect(kmh).toBeLessThan(38);
  });

  it('matches a known climbing figure, by VAM', () => {
    // The anchor for every other climbing number in this file. At 8% the
    // load is almost entirely gravity, so vertical ascent rate (VAM) is the
    // honest way to check it: a 3.33 W/kg rider is well attested at
    // 1000-1100 m/h, and that band is independent of this module's own
    // assumptions about drag and rolling resistance.
    var v = solveSpeed(250, 0.08, params());
    var vam = v * 0.08 * 3600;
    expect(vam).toBeGreaterThan(1000);
    expect(vam).toBeLessThan(1100);
  });

  it('stays below the pure-gravity ceiling on a climb', () => {
    // Ignoring drag and rolling entirely, P·η = m·g·v·sin θ gives the
    // fastest any rider could go up this slope. The real answer must be
    // strictly under it, and not by a silly margin.
    var totalKg = 75;
    var ceiling = (250 * 0.97) / (totalKg * 9.80665 * 0.08) * 3.6;
    var actual = solveSpeed(250, 0.08, params()) * 3.6;
    expect(actual).toBeLessThan(ceiling);
    expect(actual).toBeGreaterThan(ceiling * 0.85);
  });

  it('is monotonic in power', () => {
    var slow = solveSpeed(150, 0.05, params());
    var fast = solveSpeed(300, 0.05, params());
    expect(fast).toBeGreaterThan(slow);
  });

  it('makes weight matter on a climb and barely matter on the flat', () => {
    // The property that proves gravity and drag are wired to the right
    // terms: mass enters the linear coefficient (so it dominates a climb)
    // and never enters the cubic one (so it is nearly irrelevant on the
    // flat, where only rolling resistance carries it).
    var light = solveSpeed(250, 0.08, params({ totalKg: 70 }));
    var heavy = solveSpeed(250, 0.08, params({ totalKg: 95 }));
    expect(light / heavy).toBeGreaterThan(1.2);

    var lightFlat = solveSpeed(250, 0, params({ totalKg: 70 }));
    var heavyFlat = solveSpeed(250, 0, params({ totalKg: 95 }));
    expect(lightFlat / heavyFlat).toBeLessThan(1.02);
  });

  it('returns a real positive root on a steep descent', () => {
    // The case Newton alone gets wrong: a strongly negative linear
    // coefficient puts a local maximum in the cubic, and an unlucky seed
    // walks off to a negative root that is real and physically nonsense.
    var v = solveSpeed(0, -0.15, params());
    expect(v).toBeGreaterThan(0);
    expect(isFinite(v)).toBe(true);
  });
});

describe('speedForGradient', () => {
  it('caps a steep descent at the braking limit', () => {
    // Unclamped, -15% coasting solves to about 84 km/h. Nobody rides a
    // loaded bike down an unknown descent at that speed, and letting it
    // through would quietly wreck the harmonic mean.
    var kmh = speedForGradient(-0.15, params()) * 3.6;
    expect(kmh).toBeLessThanOrEqual(MAX_DESCENT_KMH);
  });

  it('coasts rather than pedalling down a real descent', () => {
    // Below the coasting threshold the rider is assumed off the pedals, so
    // the answer must match a zero-power solve rather than a 250 W one.
    var coasting = solveSpeed(0, -0.06, params()) * 3.6;
    var actual = speedForGradient(-0.06, params()) * 3.6;
    expect(actual).toBeCloseTo(Math.min(coasting, MAX_DESCENT_KMH), 6);
  });

  it('still pedals on the flat and on a shallow downhill', () => {
    var flat = speedForGradient(0, params());
    expect(flat).toBeCloseTo(solveSpeed(250, 0, params()), 6);

    // -1% is above COASTING_GRADIENT: people do keep turning the cranks.
    var shallow = speedForGradient(-0.01, params());
    expect(shallow).toBeCloseTo(solveSpeed(250, -0.01, params()), 6);
  });
});

describe('defaultCdA', () => {
  it('returns the bike-type baseline for an average build', () => {
    // The DuBois scale is normalised to 175 cm / 75 kg, so a reference
    // rider must come back with exactly the table figure.
    expect(defaultCdA(175, 75, 'road')).toBeCloseTo(BIKE_TYPE_CDA.road, 6);
  });

  it('falls back to the baseline when build is unknown', () => {
    expect(defaultCdA(null, null, 'trekking')).toBe(BIKE_TYPE_CDA.trekking);
    expect(defaultCdA(undefined, undefined, 'mtb')).toBe(BIKE_TYPE_CDA.mtb);
  });

  it('scales with body size, within a clamped band', () => {
    var small = defaultCdA(160, 55, 'road');
    var large = defaultCdA(195, 100, 'road');
    expect(small).toBeLessThan(BIKE_TYPE_CDA.road);
    expect(large).toBeGreaterThan(BIKE_TYPE_CDA.road);
    // DuBois is being pushed past what it was fitted for, so the band is
    // deliberately capped at ±25%.
    expect(small).toBeGreaterThanOrEqual(BIKE_TYPE_CDA.road * 0.75);
    expect(large).toBeLessThanOrEqual(BIKE_TYPE_CDA.road * 1.25);
  });

  it('falls back to the default bike type for an unknown one', () => {
    expect(defaultCdA(null, null, 'penny-farthing')).toBe(BIKE_TYPE_CDA.trekking);
  });
});

describe('normalizeRider', () => {
  it('accepts a complete profile and derives the rest', () => {
    var p = normalizeRider(rider());
    expect(p.totalKg).toBe(75);
    expect(p.crr).toBe(CRR_BY_SURFACE.asphalt);
    expect(p.cda).toBeGreaterThan(0);
    expect(p.fatigue).toBe(false);
  });

  it('starts at sea-level air density, so the result can be solved with directly', () => {
    var p = normalizeRider(rider());
    expect(p.rho).toBe(AIR_DENSITY_SEA_LEVEL);
    expect(speedForGradient(0, p)).toBeGreaterThan(5);
  });

  it('rejects a profile missing the two fields nothing can substitute for', () => {
    // "No rider profile" must stay distinguishable from "a profile made of
    // guesses": the first falls back to the existing speed ladder, the
    // second would show a confident figure built on nothing.
    expect(normalizeRider(null)).toBe(null);
    expect(normalizeRider({ watts: 250 })).toBe(null);
    expect(normalizeRider({ riderKg: 65 })).toBe(null);
  });

  it('rejects out-of-band weight and power rather than clamping', () => {
    // A 5000 W entry is a typo or a unit mix-up. Treating it as 500 would
    // produce a confident, wrong arrival time.
    expect(normalizeRider(rider({ watts: 5000 }))).toBe(null);
    expect(normalizeRider(rider({ watts: 5 }))).toBe(null);
    expect(normalizeRider(rider({ riderKg: 500 }))).toBe(null);
    expect(normalizeRider(rider({ riderKg: 2 }))).toBe(null);
    expect(normalizeRider(rider({ watts: NaN }))).toBe(null);
    expect(normalizeRider(rider({ riderKg: 'sixty' }))).toBe(null);
  });

  it('defaults bike weight and unknown presets instead of failing', () => {
    var p = normalizeRider({ riderKg: 65, watts: 250 });
    expect(p.bikeKg).toBe(DEFAULT_BIKE_KG);
    expect(p.crr).toBe(CRR_BY_SURFACE.asphalt);

    var q = normalizeRider(rider({ surface: 'lava', bikeType: 'unicycle' }));
    expect(q.crr).toBe(CRR_BY_SURFACE.asphalt);
    expect(q.cda).toBe(BIKE_TYPE_CDA.trekking);
  });

  it('honours a measured CdA but ignores an implausible one', () => {
    expect(normalizeRider(rider({ cda: 0.28 })).cda).toBe(0.28);
    // Out of band: fall back to the derived figure rather than trusting it.
    expect(normalizeRider(rider({ cda: 9 })).cda).not.toBe(9);
    expect(normalizeRider(rider({ cda: 0.01 })).cda).not.toBe(0.01);
  });
});

describe('airDensityAt', () => {
  it('is sea-level density at sea level and thinner high up', () => {
    expect(airDensityAt(0)).toBeCloseTo(1.225, 3);
    // Roughly -10% per 1000 m.
    expect(airDensityAt(1000)).toBeLessThan(1.225);
    expect(airDensityAt(1000)).toBeGreaterThan(1.08);
    expect(airDensityAt(2000)).toBeLessThan(airDensityAt(1000));
  });

  it('falls back to sea level for an unusable input', () => {
    expect(airDensityAt(null)).toBe(1.225);
    expect(airDensityAt(NaN)).toBe(1.225);
  });
});

describe('fatigueFactor', () => {
  it('is neutral for a short ride', () => {
    expect(fatigueFactor(0.5)).toBe(1);
    expect(fatigueFactor(1)).toBe(1);
  });

  it('decays with duration but never collapses', () => {
    var six = fatigueFactor(6);
    var twelve = fatigueFactor(12);
    expect(six).toBeLessThan(1);
    expect(twelve).toBeLessThan(six);
    // Floored, so a very long day can't decay toward zero and put the
    // arrival time in the following week.
    expect(fatigueFactor(1000)).toBeGreaterThanOrEqual(0.75);
  });

  it('ignores unusable input', () => {
    expect(fatigueFactor(null)).toBe(1);
    expect(fatigueFactor(NaN)).toBe(1);
  });
});

describe('fatigueHours', () => {
  it('caps a multi-day total at one day', () => {
    // The whole point: a five-day tour is not forty unbroken hours in the
    // saddle. A night's sleep resets the legs, so fatigue is computed over
    // the longest DAY, never the trip.
    expect(fatigueHours(40, 8)).toBe(8);
  });

  it('keeps the total when it is shorter than a day', () => {
    // A split route whose longest day still exceeds the whole ride — e.g. a
    // day plan carried over from a longer route. Never inflate.
    expect(fatigueHours(6, 8)).toBe(6);
  });

  it('falls back to the total for an unsplit route', () => {
    // An unsplit route IS one day, however long, so the total is correct.
    expect(fatigueHours(6, null)).toBe(6);
    expect(fatigueHours(6, undefined)).toBe(6);
    expect(fatigueHours(6, 0)).toBe(6);
    expect(fatigueHours(6, NaN)).toBe(6);
  });
});

describe('estimateSpeedKmh', () => {
  it('gives a plausible flat-route average', () => {
    var kmh = estimateSpeedKmh(rider(), 100, 0);
    expect(kmh).toBeGreaterThan(30);
    expect(kmh).toBeLessThan(40);
  });

  it('is slower the more the route climbs', () => {
    var flat = estimateSpeedKmh(rider(), 100, 0);
    var rolling = estimateSpeedKmh(rider(), 100, 1000);
    var alpine = estimateSpeedKmh(rider(), 100, 3000);
    expect(rolling).toBeLessThan(flat);
    expect(alpine).toBeLessThan(rolling);
  });

  it('is faster for more power and slower for more weight', () => {
    var base = estimateSpeedKmh(rider(), 100, 1500);
    expect(estimateSpeedKmh(rider({ watts: 320 }), 100, 1500)).toBeGreaterThan(base);
    expect(estimateSpeedKmh(rider({ riderKg: 95 }), 100, 1500)).toBeLessThan(base);
  });

  it('is slower on a rougher surface', () => {
    var road = estimateSpeedKmh(rider({ surface: 'asphalt' }), 100, 500);
    var rough = estimateSpeedKmh(rider({ surface: 'offroad' }), 100, 500);
    expect(rough).toBeLessThan(road);
  });

  it('returns null without a usable profile or distance', () => {
    expect(estimateSpeedKmh(null, 100, 500)).toBe(null);
    expect(estimateSpeedKmh(rider(), 0, 500)).toBe(null);
    expect(estimateSpeedKmh(rider(), -5, 500)).toBe(null);
    expect(estimateSpeedKmh(rider(), NaN, 500)).toBe(null);
  });

  it('treats missing or nonsense ascent as flat rather than failing', () => {
    var flat = estimateSpeedKmh(rider(), 100, 0);
    expect(estimateSpeedKmh(rider(), 100, null)).toBeCloseTo(flat, 6);
    expect(estimateSpeedKmh(rider(), 100, NaN)).toBeCloseTo(flat, 6);
  });

  it('applies fatigue only when asked', () => {
    var off = estimateSpeedKmh(rider(), 250, 2000);
    var on = estimateSpeedKmh(rider({ fatigue: true }), 250, 2000);
    expect(on).toBeLessThan(off);
  });

  it('resets fatigue each day on a multi-day tour', () => {
    // A 500 km trip ridden over five days must NOT be modelled as one
    // unbroken ride. Told a day is ~4 hours, the decay is far gentler than
    // the ~18-hour total would produce.
    var tour = rider({ fatigue: true });
    var wholeTrip = estimateSpeedKmh(tour, 500, 5000);
    var perDay = estimateSpeedKmh(tour, 500, 5000, 4);
    expect(perDay).toBeGreaterThan(wholeTrip);
  });

  it('leaves an unsplit route exactly as it was', () => {
    // Passing no day length must be identical to the old single-argument
    // behaviour — an unsplit route is one day, so there is nothing to cap.
    var solo = rider({ fatigue: true });
    expect(estimateSpeedKmh(solo, 250, 2000, null))
      .toBeCloseTo(estimateSpeedKmh(solo, 250, 2000), 9);
  });

  it('ignores the day length when fatigue is off', () => {
    // Fatigue is the only term that reads it, so it must not perturb
    // anything else in the model.
    expect(estimateSpeedKmh(rider(), 500, 5000, 4))
      .toBeCloseTo(estimateSpeedKmh(rider(), 500, 5000), 9);
  });

  it('is harder on a tour with one long day than one with even days', () => {
    // The longest day is what costs; a rider facing a 10-hour day is more
    // tired on it than one whose days are all four hours.
    var tour = rider({ fatigue: true });
    var even = estimateSpeedKmh(tour, 500, 5000, 4);
    var lopsided = estimateSpeedKmh(tour, 500, 5000, 10);
    expect(lopsided).toBeLessThan(even);
  });
});

// Builds a synthetic route: `points` evenly spaced along a line of latitude
// with the given elevations. Spacing is set so each step is comfortably
// longer than the gradient smoothing window, so the profile is read as
// written rather than averaged into one block.
//
// 0.01 degrees of longitude at the equator is ~1.11 km.
function synthetic(elevations, stepDeg){
  var step = stepDeg || 0.01;
  var latlngs = elevations.map(function(_, i){ return [0, i * step]; });
  return { latlngs: latlngs, elevations: elevations };
}

describe('detailedSpeedKmh', () => {
  it('agrees with the flat approximation on a flat route', () => {
    var r = synthetic([100, 100, 100, 100, 100, 100]);
    var detailed = detailedSpeedKmh(rider(), r.latlngs, r.elevations);
    // Not identical — the detailed solve accounts for air density at 100 m
    // where the approximation assumes sea level — but the same ride.
    expect(detailed).toBeGreaterThan(30);
    expect(detailed).toBeLessThan(40);
  });

  it('sums times rather than averaging speeds', () => {
    // The property that makes "average speed" mean anything. A route spent
    // half its distance at 10 km/h and half at 30 km/h averages 15 km/h,
    // not 20 — because the slow half takes three times as long.
    //
    // Asserted here through the model rather than by construction: an
    // up-then-down route must come out below the arithmetic mean of its
    // climbing and descending speeds.
    var r = synthetic([0, 200, 400, 200, 0]);
    var kmh = detailedSpeedKmh(rider(), r.latlngs, r.elevations);

    var climbKmh = speedForGradient(200 / 1113, Object.assign(params(), {})) * 3.6;
    var descendKmh = speedForGradient(-200 / 1113, Object.assign(params(), {})) * 3.6;
    var arithmetic = (climbKmh + descendKmh) / 2;
    expect(kmh).toBeLessThan(arithmetic);
  });

  it('is slower than the mean-gradient approximation on rolling terrain', () => {
    // The entire reason the detailed tier exists. Same distance, same total
    // ascent — but concentrated into climbs, which the mean gradient can't
    // see. If this ever inverts, the two tiers have been wired up wrong.
    var r = synthetic([0, 300, 0, 300, 0, 300, 0, 300]);

    var totalKm = 0;
    for(var i = 1; i < r.latlngs.length; i++) totalKm += 1.113;
    var ascentM = 300 * 4;

    var approx = estimateSpeedKmh(rider(), totalKm, ascentM);
    var detailed = detailedSpeedKmh(rider(), r.latlngs, r.elevations);
    expect(detailed).toBeLessThan(approx);
  });

  it('handles a profile thinned shorter than its geometry', () => {
    // A route restored from storage has been thinned by profileForStorage()
    // to at most 240 points, so the elevation array is shorter than the
    // geometry it describes. Index mapping inverts sample()'s stride —
    // assuming even distance spacing instead inflated gradients by half
    // again (see profileForStorage in elevation.js).
    var latlngs = [];
    for(var i = 0; i < 100; i++) latlngs.push([0, i * 0.01]);
    var elevations = [0, 100, 200, 300, 400]; // 5 points for 100 vertices

    var kmh = detailedSpeedKmh(rider(), latlngs, elevations);
    expect(kmh).toBeGreaterThan(0);
    expect(isFinite(kmh)).toBe(true);
  });

  it('never returns an impossible average, even on a route that only descends', () => {
    var r = synthetic([2000, 1500, 1000, 500, 0]);
    var kmh = detailedSpeedKmh(rider(), r.latlngs, r.elevations);
    expect(kmh).toBeLessThanOrEqual(MAX_DESCENT_KMH);
    expect(kmh).toBeGreaterThan(0);
  });

  it('returns null for anything it cannot measure', () => {
    expect(detailedSpeedKmh(null, [[0, 0], [0, 1]], [0, 100])).toBe(null);
    expect(detailedSpeedKmh(rider(), null, null)).toBe(null);
    expect(detailedSpeedKmh(rider(), [[0, 0]], [0])).toBe(null);
    expect(detailedSpeedKmh(rider(), [], [])).toBe(null);
    // Geometry with no length: every vertex in the same place.
    expect(detailedSpeedKmh(rider(), [[0, 0], [0, 0]], [0, 0])).toBe(null);
  });

  it('applies fatigue only when asked', () => {
    var r = synthetic([0, 200, 400, 200, 0]);
    var off = detailedSpeedKmh(rider(), r.latlngs, r.elevations);
    var on = detailedSpeedKmh(rider({ fatigue: true }), r.latlngs, r.elevations);
    expect(on).toBeLessThanOrEqual(off);
  });

  it('resets fatigue each day on a multi-day tour', () => {
    // Same contract as the approximation: the detailed solve walks the whole
    // route, so without a day length it would decay a tour as one long ride.
    var elevations = [];
    for(var i = 0; i < 120; i++) elevations.push(i % 2 ? 400 : 0);
    var r = synthetic(elevations);

    var tour = rider({ fatigue: true });
    var wholeTrip = detailedSpeedKmh(tour, r.latlngs, r.elevations);
    var perDay = detailedSpeedKmh(tour, r.latlngs, r.elevations, 5);
    expect(perDay).toBeGreaterThan(wholeTrip);
  });

  it('leaves an unsplit route exactly as it was', () => {
    var r = synthetic([0, 200, 400, 200, 0]);
    var solo = rider({ fatigue: true });
    expect(detailedSpeedKmh(solo, r.latlngs, r.elevations, null))
      .toBeCloseTo(detailedSpeedKmh(solo, r.latlngs, r.elevations), 9);
  });
});
