import type { Exercise, Intensity, Phase, SessionType } from './types.js';

export interface Template {
  type: SessionType;
  title: string;
  intensity: Intensity;
  baseDurationMin: number;
  focus: string;
  needs: { gym?: boolean; hangboard?: boolean; board?: boolean; weights?: boolean; pullupBar?: boolean };
  minGrade: number;
  minExperienceYears: number;
  fingerLoad: boolean;
  exercises: (phase: Phase, grade: number) => Exercise[];
}

const g = (grade: number, offset: number) => `V${Math.max(0, grade + offset)}`;

export const TEMPLATES: Record<SessionType, Template> = {
  'limit-boulder': {
    type: 'limit-boulder',
    title: 'Limit bouldering',
    intensity: 'high',
    baseDurationMin: 90,
    focus: 'Maximal strength and recruitment on hard boulders',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up pyramid', detail: `15 min easy climbing up to ${g(grade, -2)}`, sets: '10–15 problems' },
      { name: 'Limit attempts', detail: `Projects at ${g(grade, 0)}–${g(grade, 1)}, full rest (3–5 min) between attempts`, sets: '4–6 problems, 3–5 tries each' },
      { name: 'Cool-down', detail: 'Easy mileage and shoulder care', sets: '10 min' },
    ],
  },
  'flash-boulder': {
    type: 'flash-boulder',
    title: 'Flash bouldering',
    intensity: 'medium',
    baseDurationMin: 75,
    focus: 'Onsight reading and first-try execution near your flash grade',
    needs: { gym: true },
    minGrade: 1,
    minExperienceYears: 0,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Progressive problems, rehearse reading sequences from the ground', sets: '15 min' },
      { name: 'Flash attempts', detail: `Fresh problems at ${g(grade, -2)}–${g(grade, -1)}, one genuine attempt each, full rest`, sets: '8–12 problems' },
      { name: 'Review', detail: 'Repeat two failed flashes to extract the lesson', sets: '2 problems' },
    ],
  },
  'volume-boulder': {
    type: 'volume-boulder',
    title: 'Volume bouldering',
    intensity: 'medium',
    baseDurationMin: 75,
    focus: 'Movement mileage and base capacity',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Mobility and easy traversing', sets: '10 min' },
      { name: 'Flash-level circuit', detail: `20–30 problems at ${g(grade, -3)}–${g(grade, -2)}, focus on clean footwork`, sets: '60 min' },
    ],
  },
  technique: {
    type: 'technique',
    title: 'Technique session',
    intensity: 'low',
    baseDurationMin: 60,
    focus: 'Deliberate movement practice',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase, grade) => [
      { name: 'Silent feet', detail: `Easy problems (${g(grade, -4)}–${g(grade, -3)}) with zero foot noise`, sets: '15 min' },
      { name: 'Repeat perfection', detail: 'Climb each problem 3x, improving efficiency each lap', sets: '6 problems' },
      { name: 'Style drills', detail: 'Hover hands, one-touch feet, straight-arm rests', sets: '20 min' },
    ],
  },
  'board-power': {
    type: 'board-power',
    title: 'Board power',
    intensity: 'high',
    baseDurationMin: 75,
    focus: 'Contact strength and power on steep board',
    needs: { board: true },
    minGrade: 3,
    minExperienceYears: 1,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Progressive board problems', sets: '15 min' },
      { name: 'Power problems', detail: 'Short, hard board problems with big moves, full rest', sets: '8–10 problems' },
      { name: 'Optional campus touches', detail: 'Only if fully warm and pain-free', sets: '3 sets' },
    ],
  },
  'hangboard-max': {
    type: 'hangboard-max',
    title: 'Max hangs',
    intensity: 'high',
    baseDurationMin: 40,
    focus: 'Maximal finger strength (20mm half crimp)',
    needs: { hangboard: true },
    minGrade: 3,
    minExperienceYears: 1.5,
    fingerLoad: true,
    exercises: () => [
      { name: 'Warm-up hangs', detail: 'Progressive loading over 15 min, large edge to 20mm', sets: '6–8 hangs' },
      { name: 'Max hangs', detail: '7s hang at ~85–90% max load, 20mm edge, half crimp, 3 min rest', sets: '5–6 sets' },
      { name: 'Antagonist work', detail: 'Wrist extensions, push-ups', sets: '2×15' },
    ],
  },
  'hangboard-subhang': {
    type: 'hangboard-subhang',
    title: 'Sub-max hangs',
    intensity: 'medium',
    baseDurationMin: 30,
    focus: 'Tendon conditioning with low-intensity long hangs',
    needs: { hangboard: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: true,
    exercises: () => [
      { name: 'Density hangs', detail: '20–30s hangs at ~50–60% effort, comfortable edge, 2 min rest', sets: '6 sets' },
      { name: 'Wrist and forearm care', detail: 'Extensions, pronation/supination', sets: '2×15' },
    ],
  },
  strength: {
    type: 'strength',
    title: 'Strength training',
    intensity: 'high',
    baseDurationMin: 60,
    focus: 'Pulling strength and posterior chain',
    needs: { pullupBar: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase) => [
      { name: 'Weighted pull-ups', detail: phase === 'peak' ? 'Heavy triples, 3 min rest' : '5 reps, hard but 1–2 in reserve', sets: '4–5 sets' },
      { name: 'Rows or ring work', detail: 'Horizontal pulling for shoulder balance', sets: '3×8' },
      { name: 'Core', detail: 'Front lever progressions or hanging leg raises', sets: '3 sets' },
      { name: 'Push', detail: 'Overhead press or push-ups', sets: '3×8' },
    ],
  },
  'power-endurance': {
    type: 'power-endurance',
    title: 'Power endurance',
    intensity: 'high',
    baseDurationMin: 60,
    focus: 'Sustained hard climbing, lactate tolerance',
    needs: { gym: true },
    minGrade: 2,
    minExperienceYears: 0.5,
    fingerLoad: true,
    exercises: (phase, grade) => [
      { name: 'Warm-up', detail: 'Progressive problems', sets: '15 min' },
      { name: '4x4s', detail: `4 problems at ${g(grade, -2)} back to back, 4 rounds, 4 min rest between rounds`, sets: '4 rounds' },
    ],
  },
  'aerobic-capacity': {
    type: 'aerobic-capacity',
    title: 'Aerobic capacity',
    intensity: 'low',
    baseDurationMin: 45,
    focus: 'Easy continuous climbing, forearm recovery and capillarity',
    needs: { gym: true },
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: (phase, grade) => [
      { name: 'Continuous easy climbing', detail: `Traverse or up-down-climb at ${g(grade, -4)} or easier, never pumped`, sets: '3×10 min' },
    ],
  },
  'mobility-prehab': {
    type: 'mobility-prehab',
    title: 'Mobility & prehab',
    intensity: 'low',
    baseDurationMin: 30,
    focus: 'Injury resilience: shoulders, fingers, hips',
    needs: {},
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: () => [
      { name: 'Shoulder circuit', detail: 'Band external rotations, YTWs, scap pull-ups', sets: '2 rounds' },
      { name: 'Finger care', detail: 'Finger extensions with band, gentle stretching', sets: '2×15' },
      { name: 'Hip mobility', detail: 'Deep squat holds, hip flexor and hamstring work', sets: '10 min' },
    ],
  },
  rest: {
    type: 'rest',
    title: 'Rest day',
    intensity: 'low',
    baseDurationMin: 0,
    focus: 'Recovery',
    needs: {},
    minGrade: 0,
    minExperienceYears: 0,
    fingerLoad: false,
    exercises: () => [{ name: 'Rest', detail: 'Optional walk or light stretching' }],
  },
};
