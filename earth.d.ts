/** A point as [lat, lng] in degrees. */
export type LatLng = [number, number];
/** A point as [lat, lng] or { lat, lng }. */
export type LatLngLike = LatLng | { lat: number; lng: number };

/** The sphere every distance in this package is measured on, in metres. */
export const EARTH_RADIUS_M: number;
/** Haversine distance in metres between two points. */
export function earthDistanceM(a: LatLngLike, b: LatLngLike): number;
