import { daysBetween } from './generate.js';
import type { PlanEvent } from './types.js';

export interface LearnedProfile {
  fingerGapDays: 2 | 3;
  capDelta: -1 | 0 | 1;
  todayReadiness: 1 | 2 | 3 | null;
  baselineRpe: number | null;
  rationale: string[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function learnProfile(events: PlanEvent[], today: string): LearnedProfile {
  const rationale: string[] = [];

  const feedback = events.filter(
    (e): e is Extract<PlanEvent, { kind: 'feedback' }> =>
      e.kind === 'feedback' && daysBetween(e.date, today) >= 0,
  );
  const longRpes = feedback
    .filter((e) => e.completed && e.rpe !== null && daysBetween(e.date, today) <= 60)
    .map((e) => e.rpe!);
  const baselineRpe = longRpes.length >= 10 ? median(longRpes) : null;
  const hiThreshold = baselineRpe !== null ? Math.min(baselineRpe + 1, 8.5) : 8.5;
  const loThreshold = 6.5;

  const recent = feedback.filter((e) => daysBetween(e.date, today) <= 21);
  const rpes = recent.filter((e) => e.completed && e.rpe !== null).map((e) => e.rpe!);
  const meanRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const misses = recent.filter((e) => !e.completed).length;
  const anyFingerPain = feedback.some(
    (e) =>
      e.pain !== null &&
      (e.pain.site === 'finger' || e.pain.site === 'wrist') &&
      daysBetween(e.date, today) <= 28,
  );

  let todayReadiness: 1 | 2 | 3 | null = null;
  let heavyCount14 = 0;
  for (const e of events) {
    if (e.kind !== 'readiness') continue;
    if (e.date === today) todayReadiness = e.level;
    if (e.level === 1 && daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) <= 14) heavyCount14++;
  }

  let fingerGapDays: 2 | 3 = 2;
  if (anyFingerPain) {
    fingerGapDays = 3;
    rationale.push('Finger/wrist pain in the last 4 weeks: hard finger sessions spaced 72h apart.');
  } else if (meanRpe !== null && meanRpe >= hiThreshold) {
    fingerGapDays = 3;
    rationale.push('Recent sessions rate well above your usual effort: hard finger sessions spaced 72h apart.');
  } else if (heavyCount14 >= 3) {
    fingerGapDays = 3;
    rationale.push('You have felt heavy on several recent days: hard finger sessions spaced 72h apart.');
  }

  let capDelta: -1 | 0 | 1 = 0;
  if (misses >= 3) {
    capDelta = -1;
    rationale.push('Several missed sessions in the last 3 weeks: weekly session count reduced by one.');
  } else if (rpes.length >= 6 && misses === 0 && meanRpe !== null && meanRpe <= loThreshold && !anyFingerPain && heavyCount14 === 0) {
    capDelta = 1;
    rationale.push('Three weeks of full completion at comfortable effort: weekly session count increased by one.');
  }

  return { fingerGapDays, capDelta, todayReadiness, baselineRpe, rationale };
}
