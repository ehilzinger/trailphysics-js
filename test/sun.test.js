import { describe, expect, it } from 'vitest';
import { sunTimes } from '../sun.js';

// Published times (timeanddate.com, to the minute), against which NOAA's
// equations are good to a minute or two.
function near(date, iso, minutes){
  expect(Math.abs(date.getTime() - new Date(iso).getTime())).toBeLessThanOrEqual((minutes || 2) * 60000);
}

describe('sunTimes', () => {
  it('matches the almanac in Munich at both solstices', () => {
    var june = sunTimes(new Date('2026-06-21T10:00:00Z'), 48.137, 11.575);
    near(june.sunrise, '2026-06-21T03:13:00Z');
    near(june.sunset, '2026-06-21T19:17:00Z');
    var december = sunTimes(new Date('2026-12-21T10:00:00Z'), 48.137, 11.575);
    near(december.sunrise, '2026-12-21T07:01:00Z');
    near(december.sunset, '2026-12-21T15:22:00Z');
  });

  it('answers for the local day, west and east of Greenwich', () => {
    // New York, late September: 06:44 and 18:51 EDT.
    var nyc = sunTimes(new Date('2026-09-24T12:00:00Z'), 40.71, -74.0);
    near(nyc.sunrise, '2026-09-24T10:44:00Z');
    near(nyc.sunset, '2026-09-24T22:51:00Z');
    // Sydney, March 20: 06:58 and 19:09 AEDT — the sunrise falls on the 19th
    // in UTC, and an early-morning start there is still asked about the 20th.
    var sydney = sunTimes(new Date('2026-03-19T21:00:00Z'), -33.87, 151.21);
    near(sydney.sunrise, '2026-03-19T19:58:00Z');
    near(sydney.sunset, '2026-03-20T08:09:00Z');
  });

  it('says so when the sun does not cross the horizon', () => {
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 69.65, 18.96)).toEqual({ sunrise: null, sunset: null, polar: 'day' });
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), 69.65, 18.96)).toEqual({ sunrise: null, sunset: null, polar: 'night' });
  });

  it('is null for input it cannot use', () => {
    expect(sunTimes(null, 48, 11)).toBe(null);
    expect(sunTimes(new Date('nope'), 48, 11)).toBe(null);
    expect(sunTimes(new Date(), 91, 11)).toBe(null);
    expect(sunTimes(new Date(), 48, NaN)).toBe(null);
  });
});
