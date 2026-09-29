import type { LatLng } from './earth.js';

export type BikeType = 'road' | 'gravel' | 'trekking' | 'mtb';
export type Surface = 'asphalt' | 'gravel' | 'offroad';

/** A rider as stored. riderKg and watts are required; everything else falls back to a default. */
export interface Rider {
  riderKg: number;
  watts: number;
  bikeKg?: number | null;
  heightCm?: number | null;
  bikeType?: BikeType | string | null;
  surface?: Surface | string | null;
  /** Apply fatigue over long days. */
  fatigue?: boolean;
  /** A measured drag area in m²; derived from bike type and height when absent. */
  cda?: number | null;
}

/** What a solve needs, with every fallback applied. */
export interface RiderParams {
  riderKg: number;
  bikeKg: number;
  totalKg: number;
  watts: number;
  cda: number;
  crr: number;
  /** Air density in kg/m³; sea level unless set. */
  rho: number;
  bikeType: string;
  surface: string;
  fatigue: boolean;
}

export const AIR_DENSITY_SEA_LEVEL: number;
export const BIKE_TYPE_CDA: Record<string, number>;
export const COASTING_GRADIENT: number;
export const CRR_BY_SURFACE: Record<string, number>;
export const DEFAULT_BIKE_KG: number;
export const DEFAULT_BIKE_TYPE: string;
export const DEFAULT_SURFACE: string;
export const DRIVETRAIN_EFFICIENCY: number;
export const GRADIENT_WINDOW_M: number;
export const GRAVITY: number;
export const MAX_BIKE_KG: number;
export const MAX_DESCENT_KMH: number;
export const MAX_RIDER_KG: number;
export const MAX_WATTS: number;
export const MIN_BIKE_KG: number;
export const MIN_RIDER_KG: number;
export const MIN_WATTS: number;

export function airDensityAt(elevationM: number | null | undefined): number;
export function defaultCdA(heightCm: number | null | undefined, weightKg: number | null | undefined, bikeType: string): number;
/** null when riderKg or watts is missing or out of range. */
export function normalizeRider(rider: Rider | null | undefined): RiderParams | null;
/** Steady speed in m/s at `watts` on `gradient` (rise over run, e.g. 0.05). */
export function solveSpeed(watts: number, gradient: number, params: RiderParams): number;
/** Speed in m/s on a gradient, coasting below COASTING_GRADIENT and capped at MAX_DESCENT_KMH. */
export function speedForGradient(gradient: number, params: RiderParams): number;
export function fatigueFactor(hours: number | null | undefined): number;
export function fatigueHours(totalHours: number, dayHours?: number | null): number;
/** Average speed in km/h from distance and total ascent alone. */
export function estimateSpeedKmh(rider: Rider | null | undefined, distanceKm: number, ascentM?: number | null, dayHours?: number | null): number | null;
/** Average speed in km/h, solved segment by segment along the elevation profile. */
export function detailedSpeedKmh(rider: Rider | null | undefined, latlngs: LatLng[] | null | undefined, elevations: number[] | null | undefined, dayHours?: number | null): number | null;
