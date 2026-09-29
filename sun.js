// ---------- When the sun rises and sets ----------
//
// NOAA's general solar position equations (the NOAA Global Monitoring
// Laboratory's "General Solar Position Calculations"): the fractional year,
// the equation of time and the solar declination from a short Fourier
// series, then the hour angle at which the sun's centre is 0.833° below the
// horizon — refraction plus the sun's own radius, the definition every
// almanac's sunrise and sunset uses.
//
// Good to a minute or two between the polar circles, which is far finer
// than the question it answers here: "does this hike finish in the dark,
// and when should you turn round so it does not". Pure, no dependencies.
//
// All times are real instants (Dates); the caller formats them in whatever
// zone it shows times in.

var RAD = Math.PI / 180;
var DEG = 180 / Math.PI;
var ZENITH_DEG = 90.833;

function isLeapYear(y){
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// The UTC calendar day on which local solar noon falls for `date` at
// longitude `lng` — so a hike on a Saturday afternoon in Sydney is asked
// about Saturday's sun, not Friday's (UTC's date there is a day behind at
// breakfast). Returns [year, month0, day].
function solarDay(date, lng){
  var shifted = new Date(date.getTime() + (lng / 15) * 3600000);
  return [shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()];
}

// Sunrise and sunset for the day of `date` at [lat, lng], as
// { sunrise, sunset } Dates. Either is null when the sun does not cross the
// horizon that day — midnight sun (both null, `polar: 'day'`) or polar night
// (both null, `polar: 'night'`). Null for an unusable input.
function sunTimes(date, lat, lng){
  if(!(date instanceof Date) || isNaN(date.getTime())) return null;
  if(typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;
  if(lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  var ymd = solarDay(date, lng);
  var startOfYear = Date.UTC(ymd[0], 0, 1);
  var midnight = Date.UTC(ymd[0], ymd[1], ymd[2]);
  var dayOfYear = Math.round((midnight - startOfYear) / 86400000) + 1;
  var daysInYear = isLeapYear(ymd[0]) ? 366 : 365;

  // Fractional year at local solar noon (12:00 less the longitude's hours,
  // in UTC), in radians.
  var noonUtcHours = 12 - lng / 15;
  var gamma = 2 * Math.PI / daysInYear * (dayOfYear - 1 + (noonUtcHours - 12) / 24);
  var eqTimeMin = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  var decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  var latR = lat * RAD;
  var cosHa = Math.cos(ZENITH_DEG * RAD) / (Math.cos(latR) * Math.cos(decl)) - Math.tan(latR) * Math.tan(decl);
  if(cosHa > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if(cosHa < -1) return { sunrise: null, sunset: null, polar: 'day' };
  var haDeg = Math.acos(cosHa) * DEG;

  var riseMin = 720 - 4 * (lng + haDeg) - eqTimeMin;
  var setMin = 720 - 4 * (lng - haDeg) - eqTimeMin;
  return {
    sunrise: new Date(midnight + riseMin * 60000),
    sunset: new Date(midnight + setMin * 60000),
    polar: null
  };
}

// Where the sun is at `date` seen from [lat, lng]: { azimuth, altitude } in
// degrees, azimuth clockwise from north, altitude above the horizon
// (negative below it), from the same equations as sunTimes at the instant's
// own fractional year and true solar time. No refraction: a sketch of the
// day's arc wants the geometry, not the last half degree at the horizon.
// Null for an unusable input.
function sunPosition(date, lat, lng){
  if(!(date instanceof Date) || isNaN(date.getTime())) return null;
  if(typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;
  var y = date.getUTCFullYear();
  var dayOfYear = Math.floor((date.getTime() - Date.UTC(y, 0, 1)) / 86400000) + 1;
  var hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  var gamma = 2 * Math.PI / (isLeapYear(y) ? 366 : 365) * (dayOfYear - 1 + (hours - 12) / 24);
  var eqTimeMin = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  var decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  var trueSolarMin = hours * 60 + eqTimeMin + 4 * lng;
  var ha = (trueSolarMin / 4 - 180) * RAD;
  var latR = lat * RAD;
  var sinAlt = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  var altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  var azimuth = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)) * DEG + 180 + 360) % 360;
  return { azimuth: azimuth, altitude: altitude };
}

export { sunTimes, sunPosition };
