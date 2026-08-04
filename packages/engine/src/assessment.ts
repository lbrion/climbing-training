import type { Assessment, Goal, SessionType } from './types.js';

export type Quality = 'fingers' | 'pull' | 'power' | 'endurance' | 'technique';

const FINGER_BENCHMARK_PCT: [number, number][] = [
  [3, 100],
  [5, 110],
  [7, 125],
  [9, 140],
  [11, 155],
  [13, 170],
];

const PULL_BENCHMARK_ADDED: [number, number][] = [
  [3, 0],
  [5, 10],
  [7, 20],
  [9, 33],
  [11, 45],
  [13, 55],
];

function benchmark(table: [number, number][], grade: number): number {
  let value = table[0][1];
  for (const [gr, v] of table) if (grade >= gr) value = v;
  return value;
}

export function rankWeaknesses(a: Assessment, goal: Goal): Quality[] {
  const target = goal.type === 'grade' ? goal.targetGrade : a.maxBoulderGrade + 1;
  const deficits: Record<Quality, number> = { fingers: 0, pull: 0, power: 0, endurance: 0, technique: 0 };

  if (a.fingerStrengthPctBw !== null) {
    deficits.fingers = Math.max(0, benchmark(FINGER_BENCHMARK_PCT, target) - a.fingerStrengthPctBw) / 10;
  } else {
    deficits.fingers = 1.5;
  }
  if (a.maxPullupsAdded !== null) {
    deficits.pull = Math.max(0, benchmark(PULL_BENCHMARK_ADDED, target) - a.maxPullupsAdded) / 8;
  } else {
    deficits.pull = 1;
  }
  deficits.power = 5 - a.selfRated.power;
  deficits.endurance = (5 - a.selfRated.endurance) * 0.8;
  const flashGap = a.maxBoulderGrade - a.flashGrade;
  deficits.technique = (5 - a.selfRated.technique) + (flashGap >= 3 ? 1 : 0);

  if (goal.type === 'skill') {
    if (goal.skill === 'endurance') deficits.endurance += 3;
    if (goal.skill === 'crimps') deficits.fingers += 3;
    if (goal.skill === 'dynamic') deficits.power += 3;
    if (goal.skill === 'overhang' || goal.skill === 'compression') deficits.pull += 2;
    if (goal.skill === 'slab') deficits.technique += 3;
  }

  return (Object.entries(deficits) as [Quality, number][])
    .sort((x, y) => y[1] - x[1])
    .map(([q]) => q);
}

export const QUALITY_SESSIONS: Record<Quality, SessionType[]> = {
  fingers: ['hangboard-max', 'board-power', 'hangboard-subhang', 'limit-boulder'],
  pull: ['strength', 'board-power', 'limit-boulder'],
  power: ['board-power', 'limit-boulder', 'strength'],
  endurance: ['power-endurance', 'aerobic-capacity', 'volume-boulder'],
  technique: ['technique', 'volume-boulder'],
};
