// Writes test/fixtures/foot-pace.json, the foot pace model's shared test
// vectors, from the inputs below.
//
//   node test/build-foot-pace-fixtures.mjs
//
// Vectors with `hand_s` were worked out by hand; the script refuses to write
// if the model disagrees with that arithmetic by more than a millisecond.
// The rest are pinned from the model as it stands. After writing, copy the
// file byte for byte to the Swift package's
// Tests/TrailPhysicsTests/Fixtures/foot-pace.json.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { footSectionSeconds, footSections, formatPace } = await import(join(here, '../foot-pace.js'));

const sec = (distanceM, ascentM, descentM, extra) => Object.assign(
  { distanceM, ascentM, descentM, sacScale: null, surface: null, roadClass: null }, extra || {});

const sections = [
  // ---- Hiking, DIN 33466: t = max(h, v) + min(h, v) / 2 ----
  { name: 'DIN flat: 8 km at 4 km/h is 2 h', profile: 'hiking', section: sec(8000, 0, 0), hand_s: 2 * 3600 },
  { name: 'DIN signpost: 8 km, +600/-200 m. h = 2 h, v = 2 + 0.4 = 2.4 h, t = 2.4 + 1 = 3.4 h', profile: 'hiking',
    section: sec(8000, 600, 200), hand_s: 3.4 * 3600 },
  { name: 'DIN steep: 3 km, +900 m. h = 0.75, v = 3, t = 3 + 0.375 = 3:22:30', profile: 'hiking',
    section: sec(3000, 900, 0), hand_s: 3.375 * 3600 },
  { name: 'DIN descent: 6 km, -1000 m. h = 1.5, v = 2, t = 2 + 0.75 = 2:45', profile: 'hiking',
    section: sec(6000, 0, 1000), hand_s: 2.75 * 3600 },
  { name: 'DIN hut approach: 5.5 km, +750/-50 m. h = 1.375, v = 2.6, t = 2.6 + 0.6875 = 3:17:15', profile: 'hiking',
    section: sec(5500, 750, 50), hand_s: 3.2875 * 3600 },
  { name: 'DIN vertical only: 0 m, +300 m is 1 h', profile: 'hiking', section: sec(0, 300, 0), hand_s: 3600 },
  { name: 'SAC T2 is walking ground: 3.4 h', profile: 'hiking', section: sec(8000, 600, 200, { sacScale: 2 }), hand_s: 3.4 * 3600 },
  { name: 'SAC 0 (untagged) is walking ground', profile: 'hiking', section: sec(8000, 600, 200, { sacScale: 0 }), hand_s: 3.4 * 3600 },
  { name: 'SAC T3 x1.15: 3.4 h -> 3.91 h', profile: 'hiking', section: sec(8000, 600, 200, { sacScale: 3 }), hand_s: 3.4 * 3600 * 1.15 },
  { name: 'SAC T4 x1.35: 3.4 h -> 4.59 h', profile: 'hiking', section: sec(8000, 600, 200, { sacScale: 4 }), hand_s: 3.4 * 3600 * 1.35 },
  { name: 'SAC T5 x1.6: 3.4 h -> 5.44 h', profile: 'hiking', section: sec(8000, 600, 200, { sacScale: 5 }), hand_s: 3.4 * 3600 * 1.6 },
  { name: 'SAC T6 is T5+: x1.6', profile: 'hiking', section: sec(8000, 600, 200, { sacScale: 6 }), hand_s: 3.4 * 3600 * 1.6 },
  { name: 'Hike factor 1.2 is a speed factor: 3.4 h / 1.2 = 2:50 h', profile: 'hiking', settings: { hikeFactor: 1.2 },
    section: sec(8000, 600, 200), hand_s: 3.4 * 3600 / 1.2 },
  { name: 'Hike factor 1.2 turns a 3:00 h signpost (12 km flat) into 2:30 h', profile: 'hiking', settings: { hikeFactor: 1.2 },
    section: sec(12000, 0, 0), hand_s: 2.5 * 3600 },
  { name: 'Hike factor 0.85 (the slower preset) on T4: 3.4 h x 1.35 / 0.85', profile: 'hiking', settings: { hikeFactor: 0.85 },
    section: sec(8000, 600, 200, { sacScale: 4 }), hand_s: 3.4 * 3600 * 1.35 / 0.85 },
  { name: 'Hike factor 0.3 is clamped to 0.5: twice the signpost time', profile: 'hiking', settings: { hikeFactor: 0.3 },
    section: sec(8000, 600, 200), hand_s: 3.4 * 3600 / 0.5 },
  { name: 'Hike factor 2.5 is clamped to 2.0: half the signpost time', profile: 'hiking', settings: { hikeFactor: 2.5 },
    section: sec(8000, 600, 200), hand_s: 3.4 * 3600 / 2 },
  { name: 'Hike factor -1 is not set: 1.0', profile: 'hiking', settings: { hikeFactor: -1 },
    section: sec(8000, 600, 200), hand_s: 3.4 * 3600 },
  { name: 'Unreadable numbers are zero: 4 km, ascent -100, descent null is 1 h flat', profile: 'hiking',
    section: { distanceM: 4000, ascentM: -100, descentM: null, sacScale: null, surface: null, roadClass: null }, hand_s: 3600 },
  { name: 'Road class and surface do not change a hike', profile: 'hiking',
    section: sec(8000, 0, 0, { roadClass: 'path', surface: 'ground' }), hand_s: 7200 },

  // ---- Running: pace x Minetti C(i)/C(0) x surface ----
  { name: 'Road run, flat 10 km at the 6:00 default', profile: 'roadrun', section: sec(10000, 0, 0), hand_s: 3600 },
  { name: 'Trail run, flat 10 km at the 7:00 default', profile: 'trailrun', section: sec(10000, 0, 0), hand_s: 4200 },
  { name: 'Trail run, flat 10 km on a path: x1.08', profile: 'trailrun', section: sec(10000, 0, 0, { roadClass: 'path' }), hand_s: 4536 },
  { name: 'Track counts as trail: x1.08', profile: 'roadrun', section: sec(1000, 0, 0, { roadClass: 'track', surface: 'gravel' }), hand_s: 388.8 },
  { name: 'Natural surface on a road class counts as trail: x1.08', profile: 'roadrun', section: sec(1000, 0, 0, { roadClass: 'unclassified', surface: 'dirt' }), hand_s: 388.8 },
  { name: 'Footway on asphalt is not trail', profile: 'roadrun', section: sec(1000, 0, 0, { roadClass: 'footway', surface: 'asphalt' }), hand_s: 360 },
  { name: 'SAC T2 counts as trail: x1.08', profile: 'trailrun', section: sec(1000, 0, 0, { sacScale: 2, roadClass: 'path' }), hand_s: 453.6 },
  { name: 'SAC T3+ x1.25 (replaces x1.08)', profile: 'trailrun', section: sec(1000, 0, 0, { sacScale: 3, roadClass: 'path' }), hand_s: 525 },
  { name: 'User pace 5:00 applies to trail runs too', profile: 'trailrun', settings: { runPaceSecPerKm: 300 }, section: sec(1000, 0, 0), hand_s: 300 },
  { name: 'Run pace 100 s/km is clamped to 150', profile: 'roadrun', settings: { runPaceSecPerKm: 100 }, section: sec(1000, 0, 0), hand_s: 150 },
  { name: 'Run pace 1200 s/km is clamped to 900', profile: 'roadrun', settings: { runPaceSecPerKm: 1200 }, section: sec(1000, 0, 0), hand_s: 900 },
  { name: 'Minetti +10 %: C = 5.968214, factor 1.657837', profile: 'roadrun', section: sec(1000, 100, 0), hand_s: 360 * 5.968214 / 3.6 },
  { name: 'Minetti +25 %: C = 10.7252, factor 2.97922 (not yet power-hiking)', profile: 'roadrun', section: sec(1000, 250, 0), hand_s: 360 * 10.72519 / 3.6 },
  { name: 'Minetti -1 %: C = 3.409673, factor 0.947131', profile: 'roadrun', section: sec(1000, 0, 10), hand_s: 360 * 3.409673 / 3.6 },
  { name: 'Minetti -5 % would be 0.763: the downhill floor 0.85 holds', profile: 'roadrun', section: sec(1000, 0, 50), hand_s: 306 },
  { name: 'Minetti -20 % would be 0.5: the downhill floor 0.85 holds', profile: 'roadrun', section: sec(1000, 0, 200), hand_s: 306 },
  { name: 'Minetti -45 %: C = 4.032305, factor 1.120085, above the floor', profile: 'roadrun', section: sec(1000, 0, 450), hand_s: 360 * 4.032305 / 3.6 },
  { name: 'Past +45 % the curve continues on its tangent: +60 % factor 7.71471', profile: 'roadrun', section: sec(500, 300, 0) },
  { name: 'Past -45 % the curve continues on its tangent: -60 %', profile: 'roadrun', section: sec(500, 0, 300) },
  { name: 'Mixed section 8 km, +600/-200: 6 km up then 2 km down at 10 %', profile: 'trailrun', section: sec(8000, 600, 200),
    hand_s: 420 * 6 * 5.968214 / 3.6 + 420 * 2 * 0.85 },
  { name: '+30 % on T3: running (1834.5 s) beats the hike (4657.5 s), so it runs', profile: 'trailrun',
    section: sec(1000, 300, 0, { sacScale: 3, roadClass: 'path' }), hand_s: 420 * 3.494244 * 1.25 },
  { name: 'Power-hike: slow runner (15:00/km) with a fast hike factor (1.5) walks +60 %: DIN 2.125 h / 1.5 beats running (7498.7 s)', profile: 'trailrun',
    settings: { runPaceSecPerKm: 900, hikeFactor: 1.5 }, section: sec(1000, 600, 0, { roadClass: 'path' }), hand_s: 2.125 * 3600 / 1.5 },
  { name: 'Power-hike floor: the same runner at +30 % would walk it in 2700 s, but never faster than running at 25 %: 900 x 2.979222 x 1.08', profile: 'trailrun',
    settings: { runPaceSecPerKm: 900, hikeFactor: 1.5 }, section: sec(1000, 300, 0, { roadClass: 'path' }), hand_s: 900 * 2.979222 * 1.08 },
  { name: 'Power-hike only past 25 %: same runner at +20 % still runs', profile: 'trailrun',
    settings: { runPaceSecPerKm: 900, hikeFactor: 1.5 }, section: sec(1000, 200, 0, { roadClass: 'path' }) },
  { name: 'Running with no distance: the vertical is walked (DIN), 300 m up is 1 h', profile: 'trailrun', section: sec(0, 300, 0), hand_s: 3600 },
  { name: 'Running with no distance at the hike factor 1.2: 1 h / 1.2', profile: 'roadrun', settings: { hikeFactor: 1.2 }, section: sec(0, 300, 0), hand_s: 3000 }
];

// ---- Routes: profile samples + placed ways -> sections -> seconds ----
function range(from, to, step){ const out = []; for(let x = from; x <= to + 1e-9; x += step) out.push(x); return out; }

const routes = [];
{
  const d = range(0, 2000, 100);
  routes.push({ name: 'Noise under the 5 m dead band is flat: 2 km wobbling 2 m is 30 min', profile: 'hiking',
    distances_m: d, elevations: d.map((_, i) => i % 2 ? 502 : 500), ways: [], total_m: 2000, hand_s: 1800 });
}
{
  const d = range(0, 3000, 100);
  routes.push({ name: 'Uniform 10 % climb over 3 km: the dead band costs its first 2.5 m, +297.5 m. h = 0.75, v = 0.991667, t = 1.366667 h', profile: 'hiking',
    distances_m: d, elevations: d.map(x => 1000 + x / 10), ways: [], total_m: 3000, hand_s: (297.5 / 300 + 0.375) * 3600 });
}
{
  const d = range(0, 4000, 100);
  const e = d.map(x => x <= 2000 ? 1000 + x / 10 : 1200 - (x - 2000) / 10);
  routes.push({ name: 'Up and over: 2 km at +10 %, 2 km at -10 %, cut into 200 m windows (signpost for the whole 4 km would be 5640 s)', profile: 'hiking',
    distances_m: d, elevations: e, ways: [], total_m: 4000,
    // Up: nine windows of +20 (0.05 h, 0.0667 h -> 0.091667 h) and the first at +17.5 (0.083333 h).
    // Down: the first window -15 (0.065 h), then nine of -20 (0.07 h).
    hand_s: (9 * (20 / 300 + 0.025) + (17.5 / 300 + 0.025) + (0.05 + 0.015) + 9 * (0.05 + 0.02)) * 3600 });
  routes.push({ name: 'The same up and over, trail run at the default pace', profile: 'trailrun',
    distances_m: d, elevations: e, ways: [], total_m: 4000 });
}
{
  const d = range(0, 2000, 250);
  const ways = [
    { fromM: 0, toM: 1000, sacScale: 4, surface: 'rock', roadClass: 'path' },
    { fromM: 1000, toM: 2000, sacScale: 0, surface: 'asphalt', roadClass: 'unclassified' }
  ];
  routes.push({ name: 'Flat 2 km, half on T4: 900 x 1.35 + 900', profile: 'hiking',
    distances_m: d, elevations: d.map(() => 700), ways, total_m: 2000, hand_s: 1215 + 900 });
  routes.push({ name: 'Flat 2 km, half on T4, trail run: 420 x 1.25 + 420', profile: 'trailrun',
    distances_m: d, elevations: d.map(() => 700), ways, total_m: 2000, hand_s: 525 + 420 });
}
{
  const d = range(0, 1200, 300);
  const ways = [
    { fromM: 0, toM: 450, sacScale: 3, surface: null, roadClass: 'path' },
    { fromM: 450, toM: 1200, sacScale: null, surface: null, roadClass: 'track' }
  ];
  routes.push({ name: 'A way change inside a window shares its climb by distance', profile: 'hiking',
    distances_m: d, elevations: d.map(x => 500 + x / 10), ways, total_m: 1200,
    // Windows of 300 m: +27.5 on T3 (534.75 s), then +30 split 150/150 at 450 m (284.625 s on T3, 247.5 s),
    // then two of +30 (495 s each).
    hand_s: 534.75 + 284.625 + 247.5 + 495 + 495 });
  routes.push({ name: 'Gaps between ways are unknown ground', profile: 'trailrun',
    distances_m: d, elevations: d.map(() => 500), total_m: 1200,
    ways: [{ fromM: 0, toM: 300, sacScale: 3, surface: null, roadClass: 'path' }],
    hand_s: 0.3 * 420 * 1.25 + 0.9 * 420 });
}
routes.push({ name: 'No profile: one window with the route ascent, descent defaulting to it. 10 km +500/-500: h = 2.5, v = 2.666667, t = 3.916667 h', profile: 'hiking',
  distances_m: null, elevations: null, ways: [], total_m: 10000, ascent_m: 500, descent_m: null, hand_s: (500 / 300 + 1 + 1.25) * 3600 });
routes.push({ name: 'No profile, descent given: 10 km +500/-100', profile: 'hiking',
  distances_m: null, elevations: null, ways: [], total_m: 10000, ascent_m: 500, descent_m: 100,
  hand_s: (2.5 + (500 / 300 + 100 / 500) / 2) * 3600 });
routes.push({ name: 'No profile and no ascent: flat', profile: 'hiking',
  distances_m: null, elevations: null, ways: [], total_m: 10000, ascent_m: null, descent_m: null, hand_s: 9000 });
routes.push({ name: 'One usable sample is no profile: the ascent fallback', profile: 'hiking',
  distances_m: [0, 500, 1000], elevations: [null, 800, null], ways: [], total_m: 4000, ascent_m: 300, descent_m: 0,
  hand_s: (1 + 0.5) * 3600 });
{
  routes.push({ name: 'Missing heights are interpolated across, missing ends are flat', profile: 'hiking',
    distances_m: [0, 200, 400, 600, 800, 1000, 1200],
    elevations: [null, 100, null, null, 160, 160, null], ways: [], total_m: 1200,
    // Flat 0-200 (180 s); 200-800 +57.5 after the dead band (h 0.15, v 0.191667: 960 s); 800-1000 flat (180 s);
    // 1000-1200 flat, no height (180 s).
    hand_s: 180 + 960 + 180 + 180 });
}
routes.push({ name: 'Zero-length route has no sections', profile: 'hiking',
  distances_m: [0, 0], elevations: [100, 120], ways: [], total_m: 0, hand_s: 0, expected_sections: 0 });

// ---- Pace display ----
const pace = [
  { sec_per_km: 360, units: 'metric', expected: '6:00 /km' },
  { sec_per_km: 360, units: 'imperial', expected: '9:39 /mi' },
  { sec_per_km: 420, units: 'metric', expected: '7:00 /km' },
  { sec_per_km: 300, units: 'imperial', expected: '8:03 /mi' },
  { sec_per_km: 359.6, units: 'metric', expected: '6:00 /km' },
  { sec_per_km: 599.5, units: 'metric', expected: '10:00 /km' },
  { sec_per_km: 45, units: 'metric', expected: '0:45 /km' },
  { sec_per_km: 3725, units: 'metric', expected: '62:05 /km' },
  { sec_per_km: 0, units: 'metric', expected: null },
  { sec_per_km: -300, units: 'metric', expected: null }
];

const r3 = x => Math.round(x * 1000) / 1000;
let bad = 0;
for(const v of sections){
  const got = footSectionSeconds(v.section, v.profile, v.settings || {});
  if(v.hand_s !== undefined && Math.abs(got - v.hand_s) > 0.001 * Math.max(1, got / 1000)){
    console.error('HAND MISMATCH', v.name, got, v.hand_s); bad++;
  }
  v.expected_s = r3(got);
  v.check = v.hand_s !== undefined ? 'hand' : 'model';
  delete v.hand_s;
  v.settings = v.settings || {};
}
for(const r of routes){
  const secs = footSections(r.distances_m, r.elevations, r.ways, r.total_m, { ascentM: r.ascent_m, descentM: r.descent_m });
  let total = 0;
  for(const s of secs) total += footSectionSeconds(s, r.profile, r.settings || {});
  if(r.hand_s !== undefined && Math.abs(total - r.hand_s) > 0.01){ console.error('HAND MISMATCH', r.name, total, r.hand_s); bad++; }
  r.expected_s = r3(total);
  r.expected_sections = secs.length;
  r.check = r.hand_s !== undefined ? 'hand' : 'model';
  delete r.hand_s;
  r.settings = r.settings || {};
  if(r.ascent_m === undefined) r.ascent_m = null;
  if(r.descent_m === undefined) r.descent_m = null;
}
for(const p of pace){
  const got = formatPace(p.sec_per_km, p.units);
  if(got !== p.expected){ console.error('PACE MISMATCH', p, got); bad++; }
}
if(bad){ console.error(bad + ' mismatches'); process.exit(1); }

const out = {
  about: 'Shared test vectors for the foot pace model. The JavaScript package (trailphysics on npm) ' +
    'and the Swift package (trailphysics-swift) both read every vector, so the two cannot drift apart. ' +
    'Master: test/fixtures/foot-pace.json in the JavaScript package, written by ' +
    'test/build-foot-pace-fixtures.mjs; the Swift package holds a byte-identical copy. ' +
    '"check": "hand" vectors were worked out by hand (DIN signpost arithmetic, Minetti polynomial); ' +
    '"model" vectors pin the implementation where hand arithmetic would be tedious.',
  version: 1,
  tolerance_s: 0.01,
  sections,
  routes,
  pace
};
writeFileSync(join(here, 'fixtures/foot-pace.json'), JSON.stringify(out, null, 2) + '\n');
console.log('ok', sections.length, routes.length, pace.length);
