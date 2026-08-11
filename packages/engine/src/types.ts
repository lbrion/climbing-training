export type VGrade = number;

export interface Assessment {
  date: string;
  maxBoulderGrade: VGrade;
  flashGrade: VGrade;
  fingerStrengthPctBw: number | null;
  maxPullupsAdded: number | null;
  experienceYears: number;
  weeklySessionsHistorical: number;
  injuryHistory: InjurySite[];
  lastHardSessionDate?: string | null;
  selfRated: { technique: 1 | 2 | 3 | 4 | 5; power: 1 | 2 | 3 | 4 | 5; endurance: 1 | 2 | 3 | 4 | 5 };
}

export type InjurySite = 'finger' | 'elbow' | 'shoulder' | 'wrist' | 'back' | 'knee';

export type Goal =
  | { type: 'grade'; targetGrade: VGrade }
  | { type: 'skill'; skill: 'overhang' | 'slab' | 'dynamic' | 'crimps' | 'compression' | 'endurance' };

export interface Availability {
  minutesByWeekday: [number, number, number, number, number, number, number];
}

export interface Equipment {
  climbingGym: boolean;
  hangboard: boolean;
  boardWall: boolean;
  weights: boolean;
  pullupBar: boolean;
}

export interface Config {
  assessment: Assessment;
  goal: Goal;
  availability: Availability;
  equipment: Equipment;
  planStart: string;
}

export type SessionType =
  | 'limit-boulder'
  | 'flash-boulder'
  | 'volume-boulder'
  | 'technique'
  | 'board-power'
  | 'hangboard-max'
  | 'hangboard-subhang'
  | 'strength'
  | 'power-endurance'
  | 'aerobic-capacity'
  | 'mobility-prehab'
  | 'rest';

export type Intensity = 'high' | 'medium' | 'low';

export interface Exercise {
  name: string;
  detail: string;
  sets?: string;
  /** Rest guidance between sets/attempts of this exercise, e.g. "3–5 min between attempts". */
  rest?: string;
}

export interface Session {
  id: string;
  date: string;
  type: SessionType;
  title: string;
  intensity: Intensity;
  durationMin: number;
  focus: string;
  exercises: Exercise[];
  weekPhase: Phase;
  warnings: string[];
  hints: string[];
}

export type Phase = 'base' | 'build' | 'peak' | 'deload';

export interface PainReport {
  site: InjurySite;
  severity: 1 | 2 | 3;
}

export type PlanEvent =
  | {
      kind: 'feedback';
      sessionId: string;
      date: string;
      completed: boolean;
      rpe: number | null;
      pain: PainReport | null;
      actualType?: SessionType | null;
      topGrade?: number | null;
      notes?: string;
      /** Indices into the session's exercise list that were checked off during the session. */
      exercisesDone?: number[];
    }
  | { kind: 'readiness'; date: string; level: 1 | 2 | 3 }
  | { kind: 'move'; sessionId: string; fromDate: string; toDate: string }
  | { kind: 'availability'; date: string; availability: Availability }
  | { kind: 'goal'; date: string; goal: Goal }
  | {
      /** A workout imported from a watch/FIT file (e.g. COROS, Garmin). Objective record alongside subjective feedback. */
      kind: 'imported-activity';
      date: string;
      externalId: string;
      sport: string;
      durationMin: number;
      avgHr: number | null;
      maxHr: number | null;
      /** Per-minute average heart rate from the recording, index = minute from start. */
      hrSeries?: number[];
      climbs?: ImportedClimb[];
      calories?: number;
      /** Meters ascended while climbing (session total). */
      ascentM?: number;
      /** Auto-detected climb/rest segments (e.g. COROS bouldering mode), offsets from session start. */
      blocks?: ImportedBlock[];
      climbTimeMin?: number;
      restTimeMin?: number;
      avgHrClimb?: number | null;
      avgHrRest?: number | null;
    };

export interface ImportedClimb {
  result: 'send' | 'attempt';
  grade: VGrade | null;
}

export interface ImportedBlock {
  kind: 'climb' | 'rest';
  startSec: number;
  durationSec: number;
  ascentM?: number;
  /** Decoded from COROS vendor fields; absent when the watch/file doesn't mark outcomes. */
  result?: 'send' | 'attempt';
  avgHr?: number;
  maxHr?: number;
}

export interface UserState {
  config: Config;
  events: PlanEvent[];
}

export interface Plan {
  generatedFor: string;
  phaseByWeek: Phase[];
  sessions: Session[];
  loadStatus: LoadStatus;
  notices: string[];
  /** Goal and availability the plan was built with: config values overridden by the latest goal/availability events. */
  goal: Goal;
  availability: Availability;
}

export interface LoadStatus {
  acute7d: number;
  chronic28d: number;
  ratio: number | null;
  capped: boolean;
}
