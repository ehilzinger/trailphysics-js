import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  airDensityAt, defaultCdA, detailedSpeedKmh, estimateSpeedKmh, fatigueFactor, fatigueHours,
  normalizeRider, speedForGradient
} from '../rider-physics.js';
import {
  FOOT_INCLINE_BAND_THRESHOLDS, INCLINE_BAND_THRESHOLDS, INCLINE_WINDOW_M, MAX_INCLINE_SPACING_M,
  MAX_PROFILE_POINTS, MIN_CLIMB_M, ascentFrom, inclineBandIndex, maxInclinePct, sample
} from '../elevation.js';

// The vectors both ports read. Written by test/build-shared-fixtures.mjs; the
// Swift package holds byte-identical copies. These tests fail when this
// implementation moves away from the numbers the Swift port is held to.
var read = (name) => JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
var PHYSICS = read('rider-physics.json');
var ELEVATION = read('elevation.json');

function close(got, want, tolerance){
  if(want === null) expect(got).toBe(null);
  else expect(Math.abs(got - want)).toBeLessThanOrEqual(tolerance);
}

describe('shared vectors: rider physics', () => {
  var tol = PHYSICS.tolerance;
  var riders = PHYSICS.riders;
  var routes = PHYSICS.routes;

  it('air density', () => {
    PHYSICS.air_density.forEach((v) => close(airDensityAt(v.elevation_m), v.expected, tol));
  });

  it('default drag area', () => {
    PHYSICS.default_cda.forEach((v) => close(defaultCdA(v.height_cm, v.weight_kg, v.bike_type), v.expected, tol));
  });

  it('fatigue', () => {
    PHYSICS.fatigue_factor.forEach((v) => close(fatigueFactor(v.hours), v.expected, tol));
    PHYSICS.fatigue_hours.forEach((v) => close(fatigueHours(v.total_hours, v.day_hours), v.expected, tol));
  });

  it('speed on a gradient', () => {
    PHYSICS.speed_for_gradient.forEach((v) =>
      close(speedForGradient(v.gradient, normalizeRider(riders[v.rider])) * 3.6, v.expected_kmh, tol));
  });

  it('the quick estimate', () => {
    PHYSICS.estimate.forEach((v) =>
      close(estimateSpeedKmh(riders[v.rider], v.distance_km, v.ascent_m, v.day_hours), v.expected_kmh, tol));
  });

  it('the detailed solve', () => {
    PHYSICS.detailed.forEach((v) =>
      close(detailedSpeedKmh(riders[v.rider], routes[v.route].latlngs, routes[v.route].elevations), v.expected_kmh, tol));
  });
});

describe('shared vectors: elevation', () => {
  var tol = ELEVATION.tolerance;
  var routes = ELEVATION.routes;

  it('the constants', () => {
    var c = ELEVATION.constants;
    expect(c.min_climb_m).toBe(MIN_CLIMB_M);
    expect(c.incline_window_m).toBe(INCLINE_WINDOW_M);
    expect(c.max_incline_spacing_m).toBe(MAX_INCLINE_SPACING_M);
    expect(c.max_profile_points).toBe(MAX_PROFILE_POINTS);
    expect(c.incline_band_thresholds).toEqual(INCLINE_BAND_THRESHOLDS);
    expect(c.foot_incline_band_thresholds).toEqual(FOOT_INCLINE_BAND_THRESHOLDS);
  });

  it('filtered ascent', () => {
    ELEVATION.ascent.forEach((v) => close(ascentFrom(v.route ? routes[v.route].elevations : v.elevations), v.expected, tol));
  });

  it('max incline', () => {
    ELEVATION.max_incline.forEach((v) => close(maxInclinePct(routes[v.route].latlngs, routes[v.route].elevations), v.expected, tol));
  });

  it('incline bands', () => {
    ELEVATION.incline_band.forEach((v) => expect(inclineBandIndex(v.pct, v.sport)).toBe(v.expected));
  });

  it('sampling', () => {
    ELEVATION.sample.forEach((v) => {
      var values = Array.from({ length: v.length }, (_, i) => i);
      expect(sample(values, v.max)).toEqual(v.expected);
    });
  });
});
