/** Sunrise and sunset on the local solar day of `date` at `lng`, or which polar case applies. */
export function sunTimes(date: Date, lat: number, lng: number):
  | { sunrise: Date; sunset: Date; polar: null }
  | { sunrise: null; sunset: null; polar: 'day' | 'night' }
  | null;
/** The sun's azimuth (degrees clockwise from north) and altitude (degrees above the horizon). */
export function sunPosition(date: Date, lat: number, lng: number): { azimuth: number; altitude: number } | null;
