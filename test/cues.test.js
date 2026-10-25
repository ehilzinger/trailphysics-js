import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CUE_TIMING, advanceCueTracker, cueSport, cueTrackerStart, parseCue, parseCues, parseCueWay, planCues
} from '../cues.js';

// The vectors both ports read, written by test/build-cue-fixtures.mjs; the
// Swift package holds a byte-identical copy.
var CUES = JSON.parse(readFileSync(new URL('./fixtures/cues.json', import.meta.url), 'utf8'));

var line = (n, step) => Array.from({ length: n }, (_, i) => i * step);
var cue = (point, maneuver, extra = {}) => Object.assign({ point, maneuver, source: 'engine' }, extra);
var way = (from_point, to_point, road_class, sac_scale = 0) => parseCueWay({ from_point, to_point, road_class, sac_scale });

describe('cues: parsing', () => {
  it('reads the route API shape, and what it does not know as other', () => {
    var c = parseCue({ point: 6, distance_m: 310, maneuver: 'keep_left', turn_deg: 2, exit: null, name: '', ref: 'B 37',
      other_ways_deg: [33, 'x'], source: 'fork' });
    expect(c).toEqual({ point: 6, distanceM: 310, maneuver: 'keep_left', turnDeg: 2, exit: null, name: null, ref: 'B 37',
      otherWaysDeg: [33], source: 'fork' });
    expect(parseCue({ point: 1, maneuver: 'jump' }).maneuver).toBe('other');
    expect(parseCue({ point: 1, maneuver: 'left' }).source).toBe('engine');
    expect(parseCue({ point: -1, maneuver: 'left' })).toBe(null);
    expect(parseCues(null)).toEqual([]);
    expect(parseCues([{ point: 9, maneuver: 'arrive' }, { point: 2, maneuver: 'left' }]).map((x) => x.point)).toEqual([2, 9]);
  });

  it('times each profile for its sport', () => {
    expect(['hiking', 'trail_running', 'running', 'roadrun', 'road', 'road_fast', 'trekking', 'gravel', 'bike'].map(cueSport))
      .toEqual(['foot', 'run', 'run', 'run', 'road', 'road', 'bike', 'bike', 'bike']);
  });
});

describe('cues: the plan', () => {
  it('drops a fork cue on a road that goes on when riding, never on foot', () => {
    var ways = [way(0, 10, 'secondary'), way(10, 20, 'track')];
    var cues = parseCues([{ point: 4, maneuver: 'keep_left', turn_deg: 0, other_ways_deg: [30], source: 'fork' },
      { point: 10, maneuver: 'keep_right', turn_deg: 3, other_ways_deg: [-30], source: 'fork' }]);
    expect(planCues(cues, ways, line(21, 10), null, 'road').map((p) => p.point)).toEqual([10]);
    expect(planCues(cues, ways, line(21, 10), null, 'foot').map((p) => p.point)).toEqual([4, 10]);
  });

  it('merges inside the sport\'s window, three at most, and names the way ahead', () => {
    var cues = parseCues([cue(10, 'left'), cue(11, 'right'), cue(12, 'left'), cue(13, 'right'), cue(30, 'arrive')]);
    var plan = planCues(cues, [way(0, 12, 'path'), way(12, 30, 'steps')], line(31, 10), null, 'foot');
    expect(plan.map((p) => [p.point, p.then.map((t) => t.maneuver)])).toEqual([[10, ['right', 'left']], [13, []], [30, []]]);
    expect(plan[0].then[1].onto).toBe('steps');
    expect(CUE_TIMING.foot.mergeS * CUE_TIMING.foot.nominalMps).toBeCloseTo(18);
  });

  it('says up or down from the heights', () => {
    var plan = planCues(parseCues([cue(2, 'left'), cue(10, 'right')]), [way(0, 20, 'path')], line(21, 10),
      Array.from({ length: 21 }, (_, i) => (i <= 10 ? 100 + i * 2 : 120 - (i - 10) * 2)), 'foot');
    expect(plan.map((p) => p.slope)).toEqual(['up', 'down']);
  });
});

describe('cues: the tracker', () => {
  var plan = planCues(parseCues([cue(10, 'left'), cue(20, 'right')]), [way(0, 30, 'path')], line(31, 10), null, 'foot');
  var run = (fixes) => {
    var state = cueTrackerStart(), events = [];
    for(var [along, speed] of fixes){
      var r = advanceCueTracker(state, along, speed, plan, 'foot');
      state = r.state;
      events.push(r.event && r.event.type + r.event.index);
    }
    return events;
  };

  it('heads-up at 45 s, now at 8 s, each once', () => {
    expect(run([[0, 1.2], [46, 1.2], [50, 1.2], [91, 1.2], [95, 1.2]])).toEqual([null, 'heads_up0', null, 'now0', null]);
  });

  it('nothing while standing still or off the line', () => {
    expect(run([[60, 0.1], [95, 0], [null, 1.2], [95, 1.2]])).toEqual([null, null, null, 'now0']);
  });

  it('inside "now" at once is "now" alone', () => {
    expect(run([[95, 1.2], [150, 1.2]])).toEqual(['now0', 'heads_up1']);
  });
});

describe('shared vectors: cues', () => {
  var tol = CUES.tolerance;

  function same(got, want){
    if(typeof want === 'number') expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
    else if(Array.isArray(want)){ expect(got.length).toBe(want.length); want.forEach((w, i) => same(got[i], w)); }
    else if(want && typeof want === 'object'){ expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort()); for(var k in want) same(got[k], want[k]); }
    else expect(got).toBe(want);
  }

  CUES.cases.forEach((c) => it('plan: ' + c.name, () => {
    same(planCues(parseCues(c.cues), c.segments.map(parseCueWay), c.cumulative, c.elevations, c.sport), c.plan);
  }));

  CUES.traces.forEach((t) => it('trace: ' + t.name, () => {
    var c = CUES.cases.find((x) => x.name === t.case);
    var state = cueTrackerStart(), events = [];
    t.fixes.forEach(([along, speed], i) => {
      var r = advanceCueTracker(state, along, speed, c.plan, c.sport);
      state = r.state;
      if(r.event) events.push([i, r.event.type, r.event.index]);
    });
    expect(events).toEqual(t.events);
    same(state, t.final);
  }));
});
