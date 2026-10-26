/** A manoeuvre as a route API names it; anything else reads as `other`. */
export type CueManeuver = 'depart' | 'continue' | 'slight_left' | 'left' | 'sharp_left' | 'slight_right' | 'right'
  | 'sharp_right' | 'keep_left' | 'keep_right' | 'u_turn' | 'roundabout' | 'waypoint' | 'arrive' | 'other';
/** engine: a junction the router announced; fork: one the route API added; route: depart, waypoint, arrive. */
export type CueSource = 'engine' | 'fork' | 'route';
export type CueSport = 'foot' | 'run' | 'bike' | 'road';
export type CueWayKind = 'steps' | 'path' | 'footway' | 'track' | 'cycleway' | 'road';
export type CueSlope = 'up' | 'down' | 'level';
export type CueNotice = 'steps' | 'harder_grade' | 'faint_trail';

export interface RouteCue {
  /** Index into the route's coordinates. */
  point: number;
  distanceM: number;
  maneuver: CueManeuver;
  /** −180..180 from straight on, negative to the left; null where it has none. */
  turnDeg: number | null;
  exit: number | null;
  name: string | null;
  ref: string | null;
  /** The other ways leaving the junction, as turnDeg; null when the router cannot tell. */
  otherWaysDeg: number[] | null;
  source: CueSource;
}

export interface CueWay {
  fromPoint: number;
  toPoint: number;
  roadClass: string | null;
  sacScale: number | null;
  trailVisibility: string | null;
}

export interface CueStep {
  maneuver: CueManeuver;
  turnDeg: number | null;
  /** The other ways leaving the junction, as turnDeg; null when the router cannot tell. */
  otherWaysDeg: number[] | null;
  exit: number | null;
  name: string | null;
  ref: string | null;
  onto: CueWayKind | null;
  slope: CueSlope | null;
  /** On a merged step: metres from the step before. */
  gapM?: number;
}

export interface PlannedCue {
  kind: 'turn' | 'waypoint' | 'arrive' | 'heads_up';
  alongM: number;
  point: number;
  maneuver: CueManeuver | null;
  turnDeg: number | null;
  otherWaysDeg: number[] | null;
  exit: number | null;
  name: string | null;
  ref: string | null;
  onto: CueWayKind | null;
  slope: CueSlope | null;
  then: CueStep[];
  notice: CueNotice | null;
  sacScale: number | null;
}

export interface CueTiming {
  headsUpS: number;
  nowS: number;
  mergeS: number;
  nominalMps: number;
  nowMinM: number;
  rewindM: number;
}

export interface CueTrackerState {
  next: number;
  /** 0 not yet said, 1 heads-up, 2 now. */
  announced: number;
  highM: number;
  lastM: number | null;
}

export interface CueEvent {
  type: 'heads_up' | 'now';
  index: number;
}

export const CUE_MANEUVERS: CueManeuver[];
export const CUE_TIMING: Readonly<Record<CueSport, Readonly<CueTiming>>>;
export const CUE_STILL_MPS: number;
export const CUE_FORK_DEG: number;
export const CUE_MAX_MERGED: number;
export const CUE_SLOPE_GRADE: number;
export const CUE_SLOPE_M: number;
export const CUE_ONTO_MIN_M: number;

/** A route profile id (`hiking`, `trail_running`, `road_fast`, …) → the sport its cues are timed for. */
export function cueSport(profile: string): CueSport;
/** One cue from a route API's JSON; null without a usable point. */
export function parseCue(raw: unknown): RouteCue | null;
/** A route API's cue list → cues in line order. */
export function parseCues(list: unknown): RouteCue[];
/** One route API segment → the fields the plan reads; null when malformed. */
export function parseCueWay(raw: unknown): CueWay | null;
/** The cues to say, in order along the line: filtered by sport, merged, with the way ahead and heads-ups. */
export function planCues(cues: RouteCue[], ways: (CueWay | null)[] | null, cumulative: number[],
  elevations: (number | null)[] | null, sport: CueSport): PlannedCue[];
export function cueTrackerStart(): CueTrackerState;
/** One fix: metres along the line (null pauses) and speed (null: the sport's nominal). */
export function advanceCueTracker(state: CueTrackerState, alongM: number | null, speedMps: number | null,
  plan: PlannedCue[], sport: CueSport): { state: CueTrackerState; event: CueEvent | null };
