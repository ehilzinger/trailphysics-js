import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_M, bearing, bearingDelta, cumulativeDistances, distanceM, fractionAlong,
  interpolate, lengthKm, pointAtFraction, pointAtMetres
} from '../geometry.js';
import { earthDistanceM } from '../earth.js';

var M_PER_DEG = EARTH_RADIUS_M * Math.PI / 180;

// n points `spacingM` apart, due east along the equator.
function eastward(n, spacingM){
  var out = [];
  for(var i = 0; i < n; i++) out.push([0, (i * spacingM) / M_PER_DEG]);
  return out;
}

describe('distanceM', () => {
  it('is the spherical distance on a 6371 km earth', () => {
    // Munich to Berlin, the figure the Swift package's test checks too.
    var km = distanceM([48.1374, 11.5755], [52.5200, 13.4050]) / 1000;
    expect(km).toBeCloseTo(504.29, 1);
  });

  it('agrees with earthDistanceM, which also takes { lat, lng }', () => {
    var a = [46.0, 7.0], b = [46.3, 7.4];
    expect(distanceM(a, b)).toBeCloseTo(earthDistanceM(a, b), 6);
    expect(earthDistanceM({ lat: 46, lng: 7 }, { lat: 46.3, lng: 7.4 })).toBeCloseTo(distanceM(a, b), 6);
  });

  it('answers NaN for a missing point rather than throwing', () => {
    expect(distanceM(null, [0, 0])).toBeNaN();
  });
});

describe('cumulativeDistances and lengthKm', () => {
  it('runs from 0 and grows by each step', () => {
    var cum = cumulativeDistances(eastward(4, 100));
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(100, 6);
    expect(cum[3]).toBeCloseTo(300, 6);
    expect(lengthKm(eastward(11, 100))).toBeCloseTo(1, 6);
  });

  it('is [0] for a line too short to measure', () => {
    expect(cumulativeDistances([])).toEqual([0]);
    expect(cumulativeDistances([[1, 2]])).toEqual([0]);
    expect(lengthKm(null)).toBe(0);
  });
});

describe('interpolate', () => {
  it('keeps both ends and clamps the fraction', () => {
    var a = [46, 7], b = [47, 8];
    expect(interpolate(a, b, 0)[0]).toBeCloseTo(46, 9);
    expect(interpolate(a, b, 1)[1]).toBeCloseTo(8, 9);
    expect(interpolate(a, b, 2)[0]).toBeCloseTo(47, 9);
  });

  it('follows the great circle, not a straight blend of coordinates', () => {
    // Along a parallel at 60°N the great-circle midpoint bulges poleward.
    var mid = interpolate([60, 0], [60, 90], 0.5);
    expect(mid[0]).toBeGreaterThan(60);
    expect(distanceM([60, 0], mid)).toBeCloseTo(distanceM(mid, [60, 90]), 3);
  });
});

describe('bearing and bearingDelta', () => {
  it('reads 0 north, 90 east, and never goes negative', () => {
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(90, 6);
    expect(bearing([0, 0], [0, -1])).toBeCloseTo(270, 6);
  });

  it('measures the smaller angle across the 0/360 seam', () => {
    expect(bearingDelta(350, 10)).toBeCloseTo(20, 9);
    expect(bearingDelta(10, 350)).toBeCloseTo(20, 9);
    expect(bearingDelta(0, 180)).toBe(180);
  });
});

describe('pointAtMetres and pointAtFraction', () => {
  it('walks by distance, not by vertex index', () => {
    // Vertices bunched at the start: the index midpoint is nowhere near the
    // distance midpoint.
    var line = [[0, 0], [0, 10 / M_PER_DEG], [0, 20 / M_PER_DEG], [0, 1000 / M_PER_DEG]];
    var half = pointAtFraction(line, 0.5);
    expect(half[1] * M_PER_DEG).toBeCloseTo(500, 3);
    expect(pointAtMetres(line, null, 5000)).toEqual(line[3]);
    expect(pointAtMetres(line, null, -5)).toEqual(line[0]);
  });
});

describe('fractionAlong', () => {
  it('projects onto the nearest segment, not the nearest vertex', () => {
    var line = eastward(2, 1000);
    var beside = [50 / M_PER_DEG, 250 / M_PER_DEG];
    expect(fractionAlong(beside, line)).toBeCloseTo(0.25, 3);
  });

  it('is 0 for a line it cannot measure against', () => {
    expect(fractionAlong([0, 0], [[0, 0]])).toBe(0);
  });
});
