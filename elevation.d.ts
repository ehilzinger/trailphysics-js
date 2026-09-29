import type { LatLng } from './earth.js';

export type Sport = 'ride' | 'hike' | 'run';

export const MIN_CLIMB_M: number;
export const INCLINE_WINDOW_M: number;
export const MAX_INCLINE_SPACING_M: number;
export const MAX_PROFILE_POINTS: number;
export const INCLINE_BAND_THRESHOLDS: number[];
export const FOOT_INCLINE_BAND_THRESHOLDS: number[];

/** Total ascent in metres, counting only rises of at least MIN_CLIMB_M; null for fewer than two samples. */
export function ascentFrom(elevations: number[] | null | undefined): number | null;
/** Ascent between two 0..1 fractions of the profile. */
export function ascentBetween(elevations: number[] | null | undefined, fromFraction: number, toFraction?: number): number | null;
/**
 * Steepest uphill gradient in percent over at least INCLINE_WINDOW_M, with
 * lone outliers removed; null when nothing could be measured. `elevations`
 * may be a thinned profile of the line's vertices.
 */
export function maxInclinePct(latlngs: LatLng[] | null | undefined, elevations: number[] | null | undefined): number | null;
/** The window walk behind maxInclinePct, over samples placed `dists` metres along. */
export function steepestWindowPct(dists: number[], elevations: number[]): number;
/** Each interior sample replaced by the median of itself and its neighbours. */
export function despiked(elevations: number[]): number[];
/** Elevation at a 0..1 fraction of a sampled profile, interpolated. */
export function elevationAt(points: number[], fraction: number): number;
/** Gradient in percent at a 0..1 fraction, over INCLINE_WINDOW_M. */
export function gradeAt(points: number[], fraction: number, totalKm: number): number | null;
/** Evenly samples `values` down to at most `max` entries, keeping both ends. */
export function sample<T>(values: T[], max: number): T[];
/** The profile thinned to MAX_PROFILE_POINTS and rounded to whole metres, for storage. */
export function profileForStorage(elevations: number[] | null | undefined): number[] | null;
/** The three thresholds between four bands for a sport; anything else is a ride. */
export function inclineBandThresholds(sport?: Sport | string | null): number[];
/** Band 0 (gentlest) to 3 (steepest). Descents and missing data are 0. */
export function inclineBandIndex(pct: number | null | undefined, sport?: Sport | string | null): 0 | 1 | 2 | 3;
