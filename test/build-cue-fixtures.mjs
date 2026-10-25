// Writes test/fixtures/cues.json: shared test vectors for the cue model
// (cues.js), pinned from this implementation as it stands.
//
//   node test/build-cue-fixtures.mjs
//
// Two real routes (test/cue-routes.json) and a handful of drawn ones, each
// planned for a sport, and tracker traces over those plans. The Swift
// package reads a byte-identical copy: after writing, copy the file to the
// Swift package's Tests/TrailPhysicsTests/Fixtures/. A change here that
// moves a cue is a change to both ports.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const C = await import(join(here, '../cues.js'));
const G = await import(join(here, '../geometry.js'));

const mm = (x) => Number(x.toFixed(3));
const real = JSON.parse(readFileSync(join(here, 'cue-routes.json'), 'utf8')).routes;

// ---------- Plan cases ----------

function fromRoute(r){
  return {
    cumulative: G.cumulativeDistances(r.coordinates.map((c) => [c[1], c[0]])).map(mm),
    elevations: r.coordinates.map((c) => c[2]),
    segments: r.segments,
    cues: r.cues
  };
}

// A straight drawn line: `n` vertices `step` metres apart, heights from `ele`.
function drawn(n, step, ele){
  return {
    cumulative: Array.from({ length: n }, (_, i) => i * step),
    elevations: Array.from({ length: n }, (_, i) => (ele ? ele(i) : null))
  };
}
const seg = (from_point, to_point, road_class, sac_scale = 0, trail_visibility = null) => ({ from_point, to_point, road_class, sac_scale, trail_visibility });
const cue = (point, maneuver, extra = {}) => Object.assign({ point, distance_m: 0, maneuver, turn_deg: null, exit: null, name: null, ref: null, other_ways_deg: null, source: 'engine' }, extra);

// A road that goes on with a track forking off at point 5, and a fork at
// point 12 where the route leaves the road for a track.
const forks = Object.assign(drawn(21, 10), {
  segments: [seg(0, 12, 'tertiary'), seg(12, 20, 'track')],
  cues: [cue(0, 'depart', { source: 'route' }), cue(5, 'keep_left', { turn_deg: -4, other_ways_deg: [30], source: 'fork' }),
    cue(12, 'keep_right', { turn_deg: 6, other_ways_deg: [-25], source: 'fork' }), cue(20, 'arrive', { source: 'route' })]
});

// Five turns 10 m apart, a waypoint, and two more: merged in threes, the
// waypoint alone. On foot the merge window is 18 m.
const bunch = Object.assign(drawn(41, 10), {
  segments: [seg(0, 40, 'path')],
  cues: [cue(0, 'depart', { source: 'route' }), cue(10, 'left', { turn_deg: -80 }), cue(11, 'right', { turn_deg: 75 }),
    cue(12, 'left', { turn_deg: -60 }), cue(13, 'slight_right', { turn_deg: 20 }), cue(14, 'right', { turn_deg: 90 }),
    cue(15, 'waypoint', { source: 'route' }), cue(16, 'left', { turn_deg: -90 }), cue(30, 'sharp_left', { turn_deg: -140, name: 'Weg' }),
    cue(40, 'arrive', { source: 'route' })]
});

// A plain continue (nothing forks near the line: dropped), a continue past a
// way at 20° (kept), one with no angles (kept), an unknown manoeuvre (other).
const continues = Object.assign(drawn(31, 10), {
  segments: [seg(0, 30, 'footway')],
  cues: [cue(5, 'continue', { turn_deg: -5, other_ways_deg: [64] }), cue(10, 'continue', { turn_deg: 2, other_ways_deg: [-18, 90] }),
    cue(15, 'continue'), cue(20, 'fly', { turn_deg: 10 }), cue(30, 'arrive', { source: 'route' })]
});

// The way itself changes: steps in two flights with a landing, a harder
// grade, a faint trail; one notice right at a turn. Climbing 10% to point
// 20, then flat.
const notices = Object.assign(drawn(61, 10, (i) => 300 + Math.min(i, 20)), {
  segments: [seg(0, 10, 'path', 1), seg(10, 12, 'steps', 1), seg(12, 13, 'path', 1), seg(13, 16, 'steps', 1),
    seg(16, 30, 'path', 1), seg(30, 40, 'path', 3), seg(40, 50, 'path', 3, 'bad'), seg(50, 60, 'track', 3, 'good')],
  cues: [cue(29, 'right', { turn_deg: 85 }), cue(50, 'left', { turn_deg: -70 }), cue(60, 'arrive', { source: 'route' })]
});

const cases = [
  { name: 'himmelsleiter on foot', sport: 'foot', ...fromRoute(real.himmelsleiter) },
  { name: 'himmelsleiter on a run', sport: 'run', ...fromRoute(real.himmelsleiter) },
  { name: 'koenigstuhl on a road bike', sport: 'road', ...fromRoute(real.koenigstuhl_road) },
  { name: 'koenigstuhl on foot', sport: 'foot', ...fromRoute(real.koenigstuhl_road) },
  { name: 'forks on a ride', sport: 'bike', ...forks },
  { name: 'forks on foot', sport: 'foot', ...forks },
  { name: 'bunched on foot', sport: 'foot', ...bunch },
  { name: 'bunched on a road bike', sport: 'road', ...bunch },
  { name: 'continues', sport: 'foot', ...continues },
  { name: 'notices on foot', sport: 'foot', ...notices },
  { name: 'notices on a ride', sport: 'bike', ...notices }
].map((c) => {
  const plan = C.planCues(C.parseCues(c.cues), c.segments.map(C.parseCueWay), c.cumulative, c.elevations, c.sport);
  return { ...c, plan };
});

// ---------- Tracker traces ----------

function trace(name, caseName, fixes){
  const c = cases.find((x) => x.name === caseName);
  let state = C.cueTrackerStart();
  const events = [];
  fixes.forEach(([along, speed], i) => {
    const r = C.advanceCueTracker(state, along, speed, c.plan, c.sport);
    state = r.state;
    if(r.event) events.push([i, r.event.type, r.event.index]);
  });
  return { name, case: caseName, fixes, events, final: state };
}

// Walking the whole Himmelsleiter at 1.2 m/s, a fix every 5 s.
const walk = Array.from({ length: Math.ceil(2142 / 6) + 2 }, (_, i) => [i * 6, 1.2]);
// Riding the Königstuhl road at 7 m/s, a fix every 2 s.
const ride = Array.from({ length: Math.ceil(12000 / 14) }, (_, i) => [i * 14, 7]);
// Up to a fork, a photo stop at it, then on; a gap off the line (null);
// past a turn, back along the line to it and on again.
const stop = [[40, 1.2], [60, 1.2], [80, 1.2], [92, 0], [95, 0.2], [96, 1.1], [100, 1.1], [104, 1.2], [110, 1.2],
  [130, null], [null, 1.3], [null, 1.3], [170, 1.2], [200, 1.2], [230, 1.2], [260, 1.2], [290, 1.2], [310, 1.2],
  [300, 1.2], [280, 1.2], [265, 1.2], [280, 1.2], [295, 1.2], [320, 1.2], [400, 1.2]];
// A jump over two cues at once (a fix lost in a tunnel), then on.
const jump = [[0, 6], [50, 6], [350, 6], [360, 6], [400, 6]];

const traces = [
  trace('walking the himmelsleiter', 'himmelsleiter on foot', walk),
  trace('riding the koenigstuhl road', 'koenigstuhl on a road bike', ride),
  trace('a stop, a gap and a way back', 'bunched on foot', stop),
  trace('a jump over cues', 'forks on foot', jump)
];

const out = {
  about: 'Shared test vectors for the cue model (cues.js / CuePlan and CueTracker), pinned from the JavaScript package ' +
    '(trailphysics on npm) and read by the Swift package (trailphysics-swift) from a byte-identical copy. ' +
    'Master: test/fixtures/cues.json in the JavaScript package, written by test/build-cue-fixtures.mjs from ' +
    'test/cue-routes.json. Each case is a route API cue list and segments, metres along the line and heights per vertex, ' +
    'and the plan for its sport; each trace replays fixes [metres along, m/s] (null: none) over a case\'s plan and lists ' +
    'the events as [fix index, type, cue index], with the tracker\'s state after the last fix.',
  version: 1,
  tolerance: 1e-9,
  cases,
  traces
};
writeFileSync(join(here, 'fixtures/cues.json'), JSON.stringify(out, null, 1) + '\n');
console.log('cues.json:', cases.length, 'cases,', traces.length, 'traces,',
  traces.map((t) => `${t.name}: ${t.events.length} events`).join('; '));
