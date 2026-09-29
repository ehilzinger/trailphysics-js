import type { LatLng } from './earth.js';
export type { LatLng } from './earth.js';
export { EARTH_RADIUS_M } from './earth.js';

/** Great-circle distance in metres; NaN for a missing point. */
export function distanceM(a: LatLng, b: LatLng): number;
/** The point `fraction` (clamped to 0..1) of the way from `a` to `b` along the great circle. */
export function interpolate(a: LatLng, b: LatLng, fraction: number): LatLng | null;
/** Initial bearing from `a` to `b`, 0..360 clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number;
/** The smaller angle between two bearings, 0..180. */
export function bearingDelta(from: number, to: number): number;
/** Running distance to each vertex, in metres; index 0 is 0. */
export function cumulativeDistances(latlngs: LatLng[] | null | undefined): number[];
export function lengthKm(latlngs: LatLng[] | null | undefined): number;
/** The point `metres` along the line, by distance rather than vertex index. */
export function pointAtMetres(latlngs: LatLng[], cum: number[] | null | undefined, metres: number): LatLng | null;
export function pointAtFraction(latlngs: LatLng[], fraction: number, cum?: number[] | null): LatLng | null;
/** Where `point` sits along `line`, 0..1, projected onto the nearest segment. */
export function fractionAlong(point: LatLng, line: LatLng[], cum?: number[] | null): number;
