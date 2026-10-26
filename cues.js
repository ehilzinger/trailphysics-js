// Turn-by-turn cues: which of a router's turns are worth saying, what to say
// about the way they lead onto, and when to say it while moving.
//
// Three steps, each pure:
//
// 1. parseCues reads a router's cue list (the `cues` of a route API that
//    gives, per junction, the manoeuvre, the turn, the name and the angles
//    of the other ways leaving it).
// 2. planCues turns that list into what is said: it drops what is no
//    decision, merges cues that come too close together to be told apart,
//    names the way ahead from the route's segments ("onto the steps, up")
//    and adds heads-ups where the way itself changes (steps begin, the
//    hiking grade rises, the trail turns faint).
// 3. advanceCueTracker walks that plan on metres along the line and the
//    speed actually moving, and says when each cue's heads-up and its
//    "now" are due. Each fires once.
//
// The rules differ by sport (cueSport). A walker at 1.2 m/s and a road
// rider at 8 m/s need the same seconds of warning, which are very different
// metres; and a forest track forking off a road is the way to take on foot
// and no choice at all on a road bike.
//
// Convention: distances in metres, angles in degrees from straight on,
// negative to the left. `cumulative` is the running distance to each vertex
// of the route's line (index 0 is 0), as geometry.js's cumulativeDistances
// gives it.

export var CUE_MANEUVERS = ['depart', 'continue', 'slight_left', 'left', 'sharp_left', 'slight_right', 'right',
  'sharp_right', 'keep_left', 'keep_right', 'u_turn', 'roundabout', 'waypoint', 'arrive', 'other'];

var SOURCES = ['engine', 'fork', 'route'];

// The seconds of each moment, by sport, and the speed they are reckoned at
// when the plan is made (the merge) or no speed is known yet (the tracker).
// Heads-up and now are seconds at the speed actually moving; the minimums
// keep "now" from shrinking below what a fix wanders when moving slowly.
// rewindM: going back this far along the line re-arms the cues behind.
export var CUE_TIMING = Object.freeze({
  foot: Object.freeze({ headsUpS: 45, nowS: 8, mergeS: 15, nominalMps: 1.2, nowMinM: 10, rewindM: 25 }),
  run: Object.freeze({ headsUpS: 30, nowS: 6, mergeS: 10, nominalMps: 3, nowMinM: 12, rewindM: 30 }),
  bike: Object.freeze({ headsUpS: 30, nowS: 8, mergeS: 8, nominalMps: 5.6, nowMinM: 25, rewindM: 60 }),
  road: Object.freeze({ headsUpS: 25, nowS: 6, mergeS: 6, nominalMps: 8.4, nowMinM: 30, rewindM: 80 })
});

// Slower than this is standing still: no countdown runs, and a photo stop at
// a fork does not use up its heads-up.
export var CUE_STILL_MPS = 0.5;

// A way leaving within this many degrees of the route's own is a fork: the
// one rule the route API also uses for the forks it announces itself.
export var CUE_FORK_DEG = 45;

// At most this many manoeuvres in one merged cue: "left, then right, then
// left" is as much as anyone keeps in their head.
export var CUE_MAX_MERGED = 3;

// The way ahead is "up" or "down" past this grade, over CUE_SLOPE_M.
export var CUE_SLOPE_GRADE = 0.04;
export var CUE_SLOPE_M = 40;

// The way a cue leads onto is the first stretch at least this long: a
// turn onto 12 m of footway and then 757 m of steps is a turn onto the
// steps.
export var CUE_ONTO_MIN_M = 15;

var ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service']);

var WAY_KINDS = { steps: 'steps', path: 'path', bridleway: 'path', footway: 'footway', pedestrian: 'footway',
  track: 'track', cycleway: 'cycleway' };

var VISIBILITY = { excellent: 0, good: 1, intermediate: 2, bad: 3, horrible: 4, no: 5 };

// A route profile → the sport its cues are timed for. Takes the route API's
// profile ids and the short names (`trailrun`, `roadfast`, `bike`).
export function cueSport(profile){
  switch(profile){
    case 'hiking': return 'foot';
    case 'trail_running': case 'trailrun': case 'running': case 'roadrun': return 'run';
    case 'road': case 'road_fast': case 'roadfast': return 'road';
    default: return 'bike';
  }
}

function num(x){ return typeof x === 'number' && isFinite(x) ? x : null; }
function str(x){ return typeof x === 'string' && x !== '' ? x : null; }

// One cue from a route API's JSON (snake_case), or null when it has no
// usable point. An unknown manoeuvre reads as `other`, a missing source as
// `engine`.
export function parseCue(raw){
  if(!raw || !Number.isInteger(raw.point) || raw.point < 0) return null;
  var ways = Array.isArray(raw.other_ways_deg) ? raw.other_ways_deg.filter((a) => num(a) !== null) : null;
  return {
    point: raw.point,
    distanceM: num(raw.distance_m) ?? 0,
    maneuver: CUE_MANEUVERS.includes(raw.maneuver) ? raw.maneuver : 'other',
    turnDeg: num(raw.turn_deg),
    exit: Number.isInteger(raw.exit) ? raw.exit : null,
    name: str(raw.name),
    ref: str(raw.ref),
    otherWaysDeg: ways,
    source: SOURCES.includes(raw.source) ? raw.source : 'engine'
  };
}

// A route API's cue list → parsed cues in line order; null in, [] out.
export function parseCues(list){
  if(!Array.isArray(list)) return [];
  return list.map(parseCue).filter(Boolean).sort((a, b) => a.point - b.point);
}

// One segment from a route API's JSON → the fields the plan reads.
export function parseCueWay(raw){
  if(!raw || !Number.isInteger(raw.from_point) || !Number.isInteger(raw.to_point)) return null;
  return {
    fromPoint: raw.from_point,
    toPoint: raw.to_point,
    roadClass: str(raw.road_class),
    sacScale: Number.isInteger(raw.sac_scale) ? raw.sac_scale : null,
    trailVisibility: str(raw.trail_visibility)
  };
}

function norm180(d){ return ((d % 360) + 540) % 360 - 180; }

// The segment the route runs on just after `point` (or just before it).
function wayAt(ways, point, before){
  for(var w of ways){
    if(before ? (w.fromPoint < point && point <= w.toPoint) : (w.fromPoint <= point && point < w.toPoint)) return w;
  }
  return null;
}

function wayKind(way){
  if(!way || !way.roadClass) return null;
  return WAY_KINDS[way.roadClass] ?? 'road';
}

// The kind of way the route leads onto from `point`: the first segment from
// there at least CUE_ONTO_MIN_M long, or steps of any length (a flight of
// 13 m is no connector to a hiker), else the one it starts on.
function ontoFrom(ways, point, cumulative){
  var first = wayAt(ways, point, false);
  if(!first) return null;
  for(var i = ways.indexOf(first); i < ways.length; i++){
    var w = ways[i];
    var len = cumulative[Math.min(w.toPoint, cumulative.length - 1)] - cumulative[Math.max(w.fromPoint, point)];
    if(len >= CUE_ONTO_MIN_M || w.roadClass === 'steps') return wayKind(w);
  }
  return wayKind(first);
}

// Up, down or level over the next CUE_SLOPE_M from `point`; null without
// heights, or with under 10 m of line left.
function slopeFrom(point, cumulative, elevations){
  if(!elevations || elevations[point] == null) return null;
  var start = cumulative[point];
  for(var j = point + 1; j < cumulative.length; j++){
    if(cumulative[j] - start >= CUE_SLOPE_M || j === cumulative.length - 1){
      var run = cumulative[j] - start;
      if(run < 10 || elevations[j] == null) return null;
      var grade = (elevations[j] - elevations[point]) / run;
      return grade > CUE_SLOPE_GRADE ? 'up' : grade < -CUE_SLOPE_GRADE ? 'down' : 'level';
    }
  }
  return null;
}

// Whether a cue is a decision worth saying at all, for this sport.
//
// - A fork cue (one the route API adds where the engine was silent) on
//   wheels stands only where the route's road class changes there, or the
//   route is itself off the road network. Measured on five road rides: all
//   35 fork cues sat on a road that went on, nearly all a forest track or
//   path peeling off; the cue cannot tell a track from a road, so on a road
//   that goes on it says nothing. On foot the track is often the way to
//   take, so every fork cue stands.
// - A plain `continue` stands only when another way leaves within
//   CUE_FORK_DEG of the route's line (or the engine did not say which ways
//   leave): straight on past a side way at 60° is no decision.
// - `depart` is not said: the rider is already on the way.
function keeps(cue, sport, ways){
  if(cue.maneuver === 'depart') return false;
  if(cue.source === 'fork' && (sport === 'bike' || sport === 'road')){
    var before = wayAt(ways, cue.point, true), after = wayAt(ways, cue.point, false);
    if(before && after && before.roadClass === after.roadClass && ROADS.has(after.roadClass)) return false;
  }
  if(cue.maneuver === 'continue' && cue.source === 'engine' && cue.otherWaysDeg && cue.turnDeg !== null){
    var turn = cue.turnDeg;
    if(!cue.otherWaysDeg.some((a) => Math.abs(norm180(a - turn)) < CUE_FORK_DEG)) return false;
  }
  return true;
}

// Where the way itself changes, on foot: steps begin, the hiking grade rises
// to T2 or above, or the trail turns faint (bad or worse). Each at the first
// point of the segment it begins, and not again within `quietM` of the last
// of its kind: a stair in flights with a landing between is one stair.
function notices(ways, cumulative, quietM){
  var out = [], last = {};
  var at = (p) => cumulative[Math.min(p, cumulative.length - 1)];
  for(var i = 0; i < ways.length; i++){
    var p = ways[i - 1], s = ways[i], notice = null;
    if(p && s.roadClass === 'steps' && p.roadClass !== 'steps') notice = 'steps';
    else if(p && s.sacScale !== null && p.sacScale !== null && s.sacScale > p.sacScale && s.sacScale >= 2) notice = 'harder_grade';
    else if(p && (VISIBILITY[s.trailVisibility] ?? 0) >= 3 && (VISIBILITY[p.trailVisibility] ?? 0) < 3) notice = 'faint_trail';
    var here = at(s.fromPoint);
    // Steps are quiet after the end of the last flight, the others after
    // the last notice of their kind.
    var quiet = notice ? last[notice] : undefined;
    if(s.roadClass === 'steps') last.steps = at(s.toPoint);
    if(notice && notice !== 'steps') last[notice] = here;
    if(!notice || (quiet !== undefined && here - quiet < quietM)) continue;
    out.push({ point: s.fromPoint, notice: notice, sacScale: s.sacScale });
  }
  return out;
}

function step(cue, ways, cumulative, elevations){
  return {
    maneuver: cue.maneuver,
    turnDeg: cue.turnDeg,
    otherWaysDeg: cue.otherWaysDeg,
    exit: cue.exit,
    name: cue.name,
    ref: cue.ref,
    onto: ontoFrom(ways, cue.point, cumulative),
    slope: slopeFrom(cue.point, cumulative, elevations)
  };
}

// The cues to say, in order along the line.
//
// Each planned cue is one moment: `kind` is `turn`, `waypoint`, `arrive`
// or `heads_up`; `alongM` where it is, `point` its vertex; the manoeuvre
// and its words (`maneuver`, `turnDeg`, `exit`, `name`, `ref`) with the
// other ways leaving the junction (`otherWaysDeg`, to draw it); `onto`,
// the kind of way it leads onto (steps, path, footway, track, cycleway,
// road), and `slope` (up, down, level), for the cue that has no name, which
// on foot is most of them; `then`, the manoeuvres merged into it, each with
// `gapM` from the one before; `notice` (steps, harder_grade, faint_trail)
// and `sacScale` where the way changes there.
//
// Merging: a cue within the sport's merge window (seconds at its nominal
// speed) of the one before joins it as a `then`, up to CUE_MAX_MERGED in
// all. Measured on foot, 16–36% of a router's cues come within 25 m of the
// one before, and five within 70 m at a summit is not five things to say.
//
// A waypoint always stands alone; an arrival just after a turn is that
// turn's last `then` ("left, then you are there").
//
// A heads-up within the merge window of a turn goes onto that turn as its
// `notice` rather than standing alone.
//
//   cues        parseCues's output
//   ways        the route's segments (parseCueWay), in order
//   cumulative  metres along the line at each vertex
//   elevations  height at each vertex, null where unknown; optional
export function planCues(cues, ways, cumulative, elevations, sport){
  var timing = CUE_TIMING[sport] ?? CUE_TIMING.bike;
  var mergeM = timing.mergeS * timing.nominalMps;
  ways = (ways ?? []).filter(Boolean);
  var last = cumulative.length - 1;
  var at = (p) => cumulative[Math.min(Math.max(0, p), last)];

  var kept = (cues ?? []).filter((c) => c.point <= last && keeps(c, sport, ways));
  var out = [];
  var prevAlong = null;
  for(var c of kept){
    var along = at(c.point);
    var s = step(c, ways, cumulative, elevations);
    var lead = out[out.length - 1];
    var mergeable = lead && lead.kind === 'turn' && c.maneuver !== 'waypoint';
    if(mergeable && prevAlong !== null && along - prevAlong <= mergeM && 1 + lead.then.length < CUE_MAX_MERGED){
      s.gapM = along - prevAlong;
      lead.then.push(s);
    }else{
      var kind = c.maneuver === 'arrive' ? 'arrive' : c.maneuver === 'waypoint' ? 'waypoint' : 'turn';
      out.push(Object.assign({ kind: kind, alongM: along, point: c.point }, s, { then: [], notice: null, sacScale: null }));
    }
    prevAlong = along;
  }

  if(sport === 'foot' || sport === 'run'){
    for(var n of notices(ways, cumulative, timing.headsUpS * timing.nominalMps)){
      var nAlong = at(n.point);
      var near = out.find((p) => p.kind === 'turn' && Math.abs(p.alongM - nAlong) <= mergeM && p.notice === null);
      if(near){
        near.notice = n.notice;
        near.sacScale = n.notice === 'harder_grade' ? n.sacScale : null;
        continue;
      }
      out.push({
        kind: 'heads_up', alongM: nAlong, point: n.point, maneuver: null, turnDeg: null, otherWaysDeg: null, exit: null, name: null, ref: null,
        onto: ontoFrom(ways, n.point, cumulative), slope: slopeFrom(n.point, cumulative, elevations),
        then: [], notice: n.notice, sacScale: n.notice === 'harder_grade' ? n.sacScale : null
      });
    }
    out.sort((a, b) => a.alongM - b.alongM || (a.kind === 'heads_up') - (b.kind === 'heads_up'));
  }
  return out;
}

// The tracker's state before the first fix.
export function cueTrackerStart(){
  return { next: 0, announced: 0, highM: 0, lastM: null };
}

// One fix's worth of cue timing.
//
// `next` is the plan's first cue not yet passed, `announced` how far it has
// been said (0 not yet, 1 heads-up, 2 now), `highM` the furthest along the
// line so far and `lastM` the last fix's metres. Returns `{ state, event }`;
// `event` is null or `{ type: 'heads_up' | 'now', index }`, an edge: each
// fires once per cue, so a voice line or a haptic hangs off it with no flag
// of the caller's own.
//
// - alongM null pauses: no line to be on (off route, a free ride). The cue
//   ahead keeps its place, so coming back to the line picks it up again.
// - A cue is passed once the rider is half the sport's "now" minimum past
//   it.
// - Back along the line by more than rewindM (turned round at a missed
//   fork) re-arms every cue ahead of the rider again: the missed fork is
//   the way back. Nothing fires while still going back (more than the pass
//   distance since the last fix): the cue is said once they head for it.
// - Standing still (under CUE_STILL_MPS) fires nothing. speedMps null reads
//   as the sport's nominal speed.
// - "Now" at the sport's seconds, never nearer than its minimum metres;
//   heads-up at its seconds, never nearer than twice "now". A rider who is
//   already inside "now" gets "now" alone.
export function advanceCueTracker(state, alongM, speedMps, plan, sport){
  var timing = CUE_TIMING[sport] ?? CUE_TIMING.bike;
  if(num(alongM) === null) return { state: state, event: null };
  var next = state.next, announced = state.announced, highM = Math.max(state.highM, alongM);
  var passM = timing.nowMinM / 2;
  var goingBack = state.lastM !== null && alongM < state.lastM - passM;

  if(alongM < state.highM - timing.rewindM){
    var back = plan.findIndex((c) => c.alongM > alongM - passM);
    back = back < 0 ? plan.length : back;
    if(back < next){ next = back; announced = 0; }
    highM = alongM;
  }
  while(next < plan.length && alongM > plan[next].alongM + passM){
    next++;
    announced = 0;
  }
  var out = { next: next, announced: announced, highM: highM, lastM: alongM };
  if(next >= plan.length || goingBack) return { state: out, event: null };

  var speed = num(speedMps) ?? timing.nominalMps;
  if(speed < CUE_STILL_MPS) return { state: out, event: null };
  var d = plan[next].alongM - alongM;
  var nowM = Math.max(timing.nowMinM, speed * timing.nowS);
  var headsUpM = Math.max(2 * nowM, speed * timing.headsUpS);
  if(announced < 2 && d <= nowM){
    out.announced = 2;
    return { state: out, event: { type: 'now', index: next } };
  }
  if(announced < 1 && d <= headsUpM){
    out.announced = 1;
    return { state: out, event: { type: 'heads_up', index: next } };
  }
  return { state: out, event: null };
}
