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
  selfRated: { technique: 1 | 2 | 3 | 4 | 5; power: 1 | 2 | 3 | 4 | 5; endurance: 1 | 2 | 3 | 4 | 5 };
}

export type InjurySite = 'finger' | 'elbow' | 'shoulder' | 'wrist' | 'back' | 'knee';

export type Goal =
  | { type: 'grade'; targetGrade: VGrade; deadlineWeeks?: number }
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
}

export type Phase = 'base' | 'build' | 'peak' | 'deload';

export interface PainReport {
  site: InjurySite;
  severity: 1 | 2 | 3;
}

export type PlanEvent =
  | { kind: 'feedback'; sessionId: string; date: string; completed: boolean; rpe: number | null; pain: PainReport | null; notes?: string }
  | { kind: 'move'; sessionId: string; fromDate: string; toDate: string }
  | { kind: 'availability'; date: string; availability: Availability }
  | { kind: 'goal'; date: string; goal: Goal };

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
}

export interface LoadStatus {
  acute7d: number;
  chronic28d: number;
  ratio: number | null;
  capped: boolean;
}
