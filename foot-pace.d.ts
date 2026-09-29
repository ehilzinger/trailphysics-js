import type { LatLng } from './earth.js';

export type FootProfile = 'hiking' | 'trailrun' | 'roadrun';

export interface FootPaceSettings {
  /** A speed factor on signpost time: 1.2 is 20% faster. Clamped to MIN/MAX_HIKE_FACTOR. */
  hikeFactor?: number | null;
  /** Flat running pace in s/km, one for both run profiles or one per profile. */
  runPaceSecPerKm?: number | { trailrun?: number; roadrun?: number } | null;
}

export interface FootSection {
  distanceM: number;
  ascentM: number;
  descentM: number;
  /** OpenStreetMap sac_scale as 1..6 (T1..T6); 0 or null when untagged. */
  sacScale?: number | null;
  surface?: string | null;
  roadClass?: string | null;
}

/** A stretch of the route with its OpenStreetMap tags, by distance along it. */
export interface FootWay {
  fromM: number;
  toM: number;
  sacScale?: number | null;
  sac_scale?: number | null;
  surface?: string | null;
  roadClass?: string | null;
  road_class?: string | null;
  segment?: Omit<FootWay, 'fromM' | 'toM' | 'segment'>;
}

export interface FootRoute {
  latlngs: LatLng[];
  elevations?: number[] | null;
  /** Used when there is no elevation profile. */
  ascentM?: number | null;
  descentM?: number | null;
  track?: FootWay[] | null;
}

export const DOWNHILL_FLOOR: number;
export const ELEVATION_DEAD_BAND_M: number;
export const FOOT_PACE_DEFAULTS: {
  hikeFactor: number;
  runPaceSecPerKm: { trailrun: number; roadrun: number };
  dayHours: { hike: number; run: number };
};
export const FOOT_PROFILES: FootProfile[];
export const MAX_HIKE_FACTOR: number;
export const MAX_RUN_PACE_S_PER_KM: number;
export const MIN_HIKE_FACTOR: number;
export const MIN_RUN_PACE_S_PER_KM: number;
export const POWER_HIKE_GRADE: number;
export const SECTION_WINDOW_M: number;

export function hikeFactorOf(settings?: FootPaceSettings | null): number;
export function runPaceOf(settings: FootPaceSettings | null | undefined, profile: FootProfile): number;
/** Hiking slowdown for a SAC grade: 1 on walking ground, up to 1.6 for T5 and above. */
export function sacHikeFactor(sacScale: number | null | undefined): number;
/** Minetti's cost of running on grade `i` (rise over run), relative to flat. */
export function gradeFactor(i: number): number;
export function runSurfaceFactor(section: FootSection): number;
/** Moving time in seconds for one section; 0 for a profile this model does not cover. */
export function footSectionSeconds(section: FootSection, profile: FootProfile | string, settings?: FootPaceSettings | null): number;
/** Splits a profile into sections of at least SECTION_WINDOW_M, cut at every way boundary. */
export function footSections(
  distancesM: number[] | null | undefined,
  elevations: (number | null)[] | null | undefined,
  ways: FootWay[] | null | undefined,
  totalM: number,
  fallback?: { ascentM?: number | null; descentM?: number | null }
): FootSection[];
/** Moving time for a whole route in seconds; null for a riding profile or no line. */
export function footRouteSeconds(route: FootRoute, profile: FootProfile | string, settings?: FootPaceSettings | null): number | null;
/** Cumulative time against distance, one entry per section end. */
export function footRouteTimeline(route: FootRoute, profile: FootProfile | string, settings?: FootPaceSettings | null): { distancesM: number[]; seconds: number[] } | null;
/** "6:00 /km", or "9:39 /mi" for imperial; null for a pace that is not positive. */
export function formatPace(secondsPerKm: number, units?: 'metric' | 'imperial'): string | null;
