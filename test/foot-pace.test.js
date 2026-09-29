import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  FOOT_PACE_DEFAULTS, footRouteSeconds, footRouteTimeline, footSections, footSectionSeconds,
  formatPace, gradeFactor, hikeFactorOf, runPaceOf
} from '../foot-pace.js';

// The shared vectors. The Swift package reads a byte-identical copy.
var FIXTURES = JSON.parse(readFileSync(
  new URL('./fixtures/foot-pace.json', import.meta.url), 'utf8'
));
var TOLERANCE = FIXTURES.tolerance_s;

describe('shared fixtures: sections', () => {
  FIXTURES.sections.forEach(function(v){
    it(v.name, () => {
      var got = footSectionSeconds(v.section, v.profile, v.settings);
      expect(Math.abs(got - v.expected_s)).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});

describe('shared fixtures: routes', () => {
  FIXTURES.routes.forEach(function(v){
    it(v.name, () => {
      var sections = footSections(v.distances_m, v.elevations, v.ways, v.total_m, {
        ascentM: v.ascent_m, descentM: v.descent_m
      });
      expect(sections.length).toBe(v.expected_sections);
      var total = sections.reduce(function(sum, s){
        return sum + footSectionSeconds(s, v.profile, v.settings);
      }, 0);
      expect(Math.abs(total - v.expected_s)).toBeLessThanOrEqual(TOLERANCE);
    });
  });
});

describe('shared fixtures: pace display', () => {
  FIXTURES.pace.forEach(function(v){
    it(v.sec_per_km + ' s/km, ' + v.units + ' -> ' + v.expected, () => {
      expect(formatPace(v.sec_per_km, v.units)).toBe(v.expected);
    });
  });
});

describe('settings', () => {
  it('has the defaults other modules read', () => {
    expect(FOOT_PACE_DEFAULTS).toEqual({
      hikeFactor: 1.0, runPaceSecPerKm: { trailrun: 420, roadrun: 360 }, dayHours: { hike: 6, run: 3 }
    });
  });

  it('takes the run pace as one number or per profile', () => {
    expect(runPaceOf({ runPaceSecPerKm: 330 }, 'roadrun')).toBe(330);
    expect(runPaceOf({ runPaceSecPerKm: 330 }, 'trailrun')).toBe(330);
    expect(runPaceOf({ runPaceSecPerKm: { roadrun: 330 } }, 'roadrun')).toBe(330);
    expect(runPaceOf({ runPaceSecPerKm: { roadrun: 330 } }, 'trailrun')).toBe(420);
    expect(runPaceOf(FOOT_PACE_DEFAULTS, 'roadrun')).toBe(360);
  });

  it('treats missing settings as the defaults', () => {
    [undefined, null, {}, { hikeFactor: NaN, runPaceSecPerKm: '300' }].forEach(function(s){
      expect(hikeFactorOf(s)).toBe(1);
      expect(runPaceOf(s, 'trailrun')).toBe(420);
      expect(runPaceOf(s, 'roadrun')).toBe(360);
    });
    var section = { distanceM: 8000, ascentM: 600, descentM: 200 };
    expect(footSectionSeconds(section, 'hiking')).toBeCloseTo(12240, 6);
    expect(footSectionSeconds(section, 'hiking', null)).toBeCloseTo(12240, 6);
  });
});

describe('footSectionSeconds', () => {
  it('has nothing to say about the riding profiles', () => {
    ['bike', 'gravel', 'road', 'roadfast', undefined].forEach(function(p){
      expect(footSectionSeconds({ distanceM: 1000 }, p)).toBeNull();
    });
  });

  it('reads a missing section as nothing to cover', () => {
    expect(footSectionSeconds(null, 'hiking')).toBe(0);
    expect(footSectionSeconds(undefined, 'roadrun')).toBe(0);
  });

  it('never costs a descent below the floor, and is continuous at the Minetti limits', () => {
    for(var g = -0.44; g < 0; g += 0.01) expect(gradeFactor(g)).toBeGreaterThanOrEqual(0.85);
    expect(gradeFactor(0.45 + 1e-9)).toBeCloseTo(gradeFactor(0.45), 6);
    expect(gradeFactor(-0.45 - 1e-9)).toBeCloseTo(gradeFactor(-0.45), 6);
  });

  it('only gets slower as a climb gets steeper, through the power-hike switch', () => {
    // A slow runner who hikes fast, the pairing where the hike branch wins.
    var settings = { runPaceSecPerKm: 900, hikeFactor: 2.0 };
    var last = 0;
    for(var up = 0; up <= 800; up += 10){
      var t = footSectionSeconds({ distanceM: 1000, ascentM: up, roadClass: 'path' }, 'trailrun', settings);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});

// A route object as footRouteSeconds() takes one: [lat, lng] vertices, a
// profile thinned to fewer samples than vertices, and route.track's placed
// segments.
// Vertices every ~111 m along the equator, so the distances are checkable.
function equatorRoute(n, elevations, track){
  var latlngs = [];
  for(var i = 0; i < n; i++) latlngs.push([0, i * 0.001]);
  return { latlngs: latlngs, elevations: elevations, track: track, ascentM: null, profile: 'hiking' };
}

describe('footRouteSeconds', () => {
  it('walks a flat route at 4 km/h', () => {
    var route = equatorRoute(21, new Array(21).fill(300));
    var km = 20 * 0.111195;
    expect(footRouteSeconds(route, 'hiking')).toBeCloseTo(km / 4 * 3600, 0);
  });

  it('maps a thinned profile back onto the vertices it was sampled from', () => {
    // 21 vertices, 11 samples: sample i sits on vertex 2i.
    var elevations = [];
    for(var i = 0; i <= 10; i++) elevations.push(1000 + i * 22.2390);
    var route = equatorRoute(21, elevations);
    var sections = footSections(
      elevations.map(function(_, k){ return k * 2 * 111.195; }), elevations, [], 20 * 111.195
    );
    var direct = sections.reduce(function(s, x){ return s + footSectionSeconds(x, 'hiking'); }, 0);
    expect(footRouteSeconds(route, 'hiking')).toBeCloseTo(direct, 0);
  });

  it('reads sac_scale off route.track, in either spelling', () => {
    var flat = new Array(21).fill(300);
    var totalM = 20 * 111.195;
    var plain = footRouteSeconds(equatorRoute(21, flat), 'hiking');
    var t4 = [{ fromM: 0, toM: totalM, segment: { metres: totalM, roadClass: 'path', surface: 'rock', sacScale: 4 } }];
    var t4api = [{ fromM: 0, toM: totalM, segment: { distance_m: totalM, road_class: 'path', sac_scale: 4 } }];
    expect(footRouteSeconds(equatorRoute(21, flat, t4), 'hiking')).toBeCloseTo(plain * 1.35, 3);
    expect(footRouteSeconds(equatorRoute(21, flat, t4api), 'hiking')).toBeCloseTo(plain * 1.35, 3);
    // A track without sac_scale (every route routed before the field existed) is plain ground.
    var old = [{ fromM: 0, toM: totalM, segment: { metres: totalM, roadClass: 'path', surface: 'ground' } }];
    expect(footRouteSeconds(equatorRoute(21, flat, old), 'hiking')).toBeCloseTo(plain, 6);
  });

  it('falls back to the route ascent without a profile', () => {
    var route = equatorRoute(21, null);
    route.ascentM = 300;
    var km = 20 * 0.111195;
    // h = km / 4, v = 300/300 + 300/500 = 1.6 h.
    var h = km / 4, v = 1.6;
    expect(footRouteSeconds(route, 'hiking')).toBeCloseTo((Math.max(h, v) + Math.min(h, v) / 2) * 3600, 0);
  });

  it('is null with no line or a riding profile', () => {
    expect(footRouteSeconds(null, 'hiking')).toBeNull();
    expect(footRouteSeconds({ latlngs: [[0, 0]] }, 'hiking')).toBeNull();
    expect(footRouteSeconds(equatorRoute(3, [1, 2, 3]), 'bike')).toBeNull();
  });
});

describe('footRouteTimeline', () => {
  it('starts at zero and ends at the route total', () => {
    var elevations = [];
    for(var i = 0; i < 41; i++) elevations.push(500 + 80 * Math.sin(i / 5));
    var route = equatorRoute(41, elevations);
    ['hiking', 'trailrun', 'roadrun'].forEach(function(profile){
      var line = footRouteTimeline(route, profile);
      expect(line.distancesM[0]).toBe(0);
      expect(line.seconds[0]).toBe(0);
      expect(line.seconds[line.seconds.length - 1]).toBeCloseTo(footRouteSeconds(route, profile), 6);
      expect(line.distancesM[line.distancesM.length - 1]).toBeCloseTo(40 * 111.195, 0);
      for(var k = 1; k < line.seconds.length; k++){
        expect(line.seconds[k]).toBeGreaterThan(line.seconds[k - 1]);
      }
    });
  });
});
