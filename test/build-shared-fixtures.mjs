// Writes test/fixtures/rider-physics.json and test/fixtures/elevation.json:
// shared test vectors for the rider physics and elevation models, pinned
// from this implementation as it stands.
//
//   node test/build-shared-fixtures.mjs
//
// The Swift package reads byte-identical copies of both files, so the two
// ports are held to the same numbers. After writing, copy both files to the
// Swift package's Tests/TrailPhysicsTests/Fixtures/. A change here that
// moves a number is a change to both ports.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const P = await import(join(here, '../rider-physics.js'));
const E = await import(join(here, '../elevation.js'));
const { EARTH_RADIUS_M } = await import(join(here, '../earth.js'));

const M_PER_DEG = EARTH_RADIUS_M * Math.PI / 180;
const round = (x) => (typeof x === 'number' && isFinite(x) ? Number(x.toFixed(9)) : x);

// A line heading north-east from (46, 7), one vertex every `spacingM`.
function line(n, spacingM){
  const out = [];
  const dLat = spacingM / M_PER_DEG / Math.SQRT2;
  for(let i = 0; i < n; i++){
    const lat = 46 + i * dLat;
    out.push([round(lat), round(7 + i * dLat / Math.cos(lat * Math.PI / 180))]);
  }
  return out;
}

// ---------- Routes, shared by both files ----------

const routes = {
  // 6 km at a steady 7%, 50 m spacing.
  steadyClimb: { latlngs: line(121, 50), elevations: Array.from({ length: 121 }, (_, i) => 800 + i * 3.5) },
  // 10 km rolling: a sine of 25 m amplitude with a 2 km period.
  rolling: { latlngs: line(201, 50), elevations: Array.from({ length: 201 }, (_, i) => round(400 + 25 * Math.sin(i * 50 / 2000 * 2 * Math.PI))) },
  // 5 km flat.
  flat: { latlngs: line(101, 50), elevations: Array(101).fill(250) },
  // A wall then flat: 400 m of climbing in the first kilometre of five.
  wall: { latlngs: line(101, 50), elevations: Array.from({ length: 101 }, (_, i) => 500 + Math.min(i, 20) * 20) },
  // The steady climb, thinned to 30 stored samples.
  thinned: { latlngs: line(121, 50), elevations: E.sample(Array.from({ length: 121 }, (_, i) => 800 + i * 3.5), 30) },
  // Sub-threshold jitter: +3/-1 m steps and 4 m bumps. Every rise is broken
  // by a drop before it reaches MIN_CLIMB_M, so none of it is a climb.
  jitter: { latlngs: line(41, 50), elevations: [100, 103, 102, 105, 104, 107, 106, 110, 106, 110, 106, 110, 106, 110, 106,
    109, 108, 111, 110, 113, 112, 115, 114, 117, 116, 119, 118, 121, 120, 123, 122, 125, 124, 127, 126, 129, 128, 131, 130, 133, 132] },
  // Too coarse to hold a climb: 20 samples over 30 km.
  coarse: { latlngs: line(301, 100), elevations: E.sample(Array.from({ length: 301 }, (_, i) => 300 + i * 2), 20) },
  // A steady 4% climb with one height 60 m too high: a bridge deck read as
  // the gorge under it, or the other way round.
  spike: { latlngs: line(41, 50), elevations: Array.from({ length: 41 }, (_, i) => 600 + i * 2 + (i === 20 ? 60 : 0)) },
  // Shorter than one incline window.
  short: { latlngs: line(4, 50), elevations: [100, 105, 110, 115] }
};

// ---------- rider-physics.json ----------

const riders = {
  tourer: { riderKg: 75, bikeKg: 18, watts: 150 },
  racer: { riderKg: 68, bikeKg: 8, watts: 250, heightCm: 178, bikeType: 'road', surface: 'asphalt' },
  gravel: { riderKg: 82, bikeKg: 12, watts: 190, heightCm: 185, bikeType: 'gravel', surface: 'gravel' },
  measured: { riderKg: 70, bikeKg: 9, watts: 220, cda: 0.3 },
  tired: { riderKg: 75, bikeKg: 18, watts: 150, fatigue: true },
  unknownKinds: { riderKg: 75, watts: 150, bikeType: 'unicycle', surface: 'ice' },
  tooHeavy: { riderKg: 400, watts: 150 },
  tooWeak: { riderKg: 75, watts: 5 }
};

const physics = {
  about: 'Shared test vectors for the rider physics model, pinned from the JavaScript package ' +
    '(trailphysics on npm) and read by the Swift package (trailphysics-swift) from a byte-identical copy. ' +
    'Master: test/fixtures/rider-physics.json in the JavaScript package, written by ' +
    'test/build-shared-fixtures.mjs. Speeds are km/h; a null expectation means the model declines to answer.',
  version: 1,
  tolerance: 1e-6,
  riders,
  routes,
  air_density: [-100, 0, 500, 1500, 2500, 4000, null].map((m) => ({ elevation_m: m, expected: round(P.airDensityAt(m)) })),
  default_cda: [
    [null, null, 'trekking'], [178, 70, 'trekking'], [192, 95, 'road'], [160, 55, 'mtb'], [185, 82, 'gravel'], [170, 70, 'nonsense']
  ].map(([h, w, t]) => ({ height_cm: h, weight_kg: w, bike_type: t, expected: round(P.defaultCdA(h, w, t)) })),
  fatigue_factor: [null, 0.5, 1, 2, 4, 8, 12, 30].map((h) => ({ hours: h, expected: round(P.fatigueFactor(h)) })),
  fatigue_hours: [[10, null], [10, 6], [4, 6], [10, 0]].map(([t, d]) => ({ total_hours: t, day_hours: d, expected: round(P.fatigueHours(t, d)) })),
  speed_for_gradient: ['tourer', 'racer', 'gravel', 'measured'].flatMap((r) =>
    [-0.08, -0.03, -0.01, 0, 0.02, 0.05, 0.1, 0.15].map((g) => ({
      rider: r, gradient: g, expected_kmh: round(P.speedForGradient(g, P.normalizeRider(riders[r])) * 3.6)
    }))),
  estimate: Object.keys(riders).flatMap((r) => [
    { distance_km: 60, ascent_m: 800, day_hours: null },
    { distance_km: 120, ascent_m: 0, day_hours: 6 },
    { distance_km: 20, ascent_m: 1500, day_hours: null },
    { distance_km: 0, ascent_m: 100, day_hours: null }
  ].map((c) => ({ rider: r, ...c, expected_kmh: round(P.estimateSpeedKmh(riders[r], c.distance_km, c.ascent_m, c.day_hours)) }))),
  detailed: ['tourer', 'racer', 'gravel', 'tired', 'tooHeavy'].flatMap((r) =>
    ['steadyClimb', 'rolling', 'flat', 'wall', 'thinned', 'short'].map((route) => ({
      rider: r, route, expected_kmh: round(P.detailedSpeedKmh(riders[r], routes[route].latlngs, routes[route].elevations))
    })))
};

// ---------- elevation.json ----------

const elevation = {
  about: 'Shared test vectors for the elevation model (filtered ascent, max incline over a window, incline ' +
    'bands, profile sampling), pinned from the JavaScript package (trailphysics on npm) and read by the Swift ' +
    'package (trailphysics-swift) from a byte-identical copy. Master: test/fixtures/elevation.json in the ' +
    'JavaScript package, written by test/build-shared-fixtures.mjs. Percentages are uphill only; a null ' +
    'expectation means there was nothing to measure.',
  version: 1,
  tolerance: 1e-6,
  constants: {
    min_climb_m: E.MIN_CLIMB_M,
    incline_window_m: E.INCLINE_WINDOW_M,
    max_incline_spacing_m: E.MAX_INCLINE_SPACING_M,
    max_profile_points: E.MAX_PROFILE_POINTS,
    incline_band_thresholds: E.INCLINE_BAND_THRESHOLDS,
    foot_incline_band_thresholds: E.FOOT_INCLINE_BAND_THRESHOLDS
  },
  routes,
  ascent: [
    ...Object.keys(routes).map((route) => ({ route, expected: round(E.ascentFrom(routes[route].elevations)) })),
    { elevations: [100], expected: E.ascentFrom([100]) },
    { elevations: [100, 104, 100, 104, 100], expected: E.ascentFrom([100, 104, 100, 104, 100]) },
    { elevations: [100, 105, 100], expected: E.ascentFrom([100, 105, 100]) }
  ],
  max_incline: Object.keys(routes).map((route) => ({
    route, expected: round(E.maxInclinePct(routes[route].latlngs, routes[route].elevations))
  })),
  incline_band: [-5, 0, 3.9, 4, 7.99, 8, 11.9, 12, 14.9, 15, 25, 39.9, 40, 80].flatMap((pct) =>
    ['ride', 'hike'].map((sport) => ({ pct, sport, expected: E.inclineBandIndex(pct, sport) }))),
  sample: [
    { length: 10, max: 20 }, { length: 100, max: 10 }, { length: 1000, max: 240 }, { length: 241, max: 240 }
  ].map((c) => {
    const values = Array.from({ length: c.length }, (_, i) => i);
    return { ...c, expected: E.sample(values, c.max) };
  })
};

const write = (name, obj) => writeFileSync(join(here, 'fixtures', name), JSON.stringify(obj, null, 2) + '\n');
write('rider-physics.json', physics);
write('elevation.json', elevation);
console.log('ok',
  physics.speed_for_gradient.length + physics.estimate.length + physics.detailed.length, 'physics vectors,',
  elevation.ascent.length + elevation.max_incline.length + elevation.incline_band.length, 'elevation vectors');
