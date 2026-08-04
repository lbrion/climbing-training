import { daysBetween } from './generate.js';
import type { PlanEvent } from './types.js';

export interface LearnedProfile {
  fingerGapDays: 2 | 3;
  capDelta: -1 | 0 | 1;
  rationale: string[];
}

export function learnProfile(events: PlanEvent[], today: string): LearnedProfile {
  const recent = events.filter(
    (e): e is Extract<PlanEvent, { kind: 'feedback' }> =>
      e.kind === 'feedback' && daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) <= 21,
  );
  const rationale: string[] = [];

  const rpes = recent.filter((e) => e.completed && e.rpe !== null).map((e) => e.rpe!);
  const meanRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const misses = recent.filter((e) => !e.completed).length;
  const anyFingerPain = events.some(
    (e) =>
      e.kind === 'feedback' &&
      e.pain !== null &&
      (e.pain.site === 'finger' || e.pain.site === 'wrist') &&
      daysBetween(e.date, today) >= 0 &&
      daysBetween(e.date, today) <= 28,
  );

  let fingerGapDays: 2 | 3 = 2;
  if (anyFingerPain || (meanRpe !== null && meanRpe >= 8.5)) {
    fingerGapDays = 3;
    rationale.push(
      anyFingerPain
        ? 'Finger/wrist pain in the last 4 weeks: hard finger sessions spaced 72h apart.'
        : 'Sessions are consistently near-maximal effort: hard finger sessions spaced 72h apart.',
    );
  }

  let capDelta: -1 | 0 | 1 = 0;
  if (misses >= 3) {
    capDelta = -1;
    rationale.push('Several missed sessions in the last 3 weeks: weekly session count reduced by one.');
  } else if (rpes.length >= 6 && misses === 0 && meanRpe !== null && meanRpe <= 6.5 && !anyFingerPain) {
    capDelta = 1;
    rationale.push('Three weeks of full completion at comfortable effort: weekly session count increased by one.');
  }

  return { fingerGapDays, capDelta, rationale };
}
