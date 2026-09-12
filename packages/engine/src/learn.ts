import { daysBetween } from './generate.js';
import type { PlanEvent } from './types.js';

export type FingerGapReason = 'recent-pain' | 'high-rpe' | 'heavy-days' | null;
export type CapReason = 'misses' | 'clean-block' | null;

export interface LearnedProfile {
  fingerGapDays: 2 | 3;
  capDelta: -1 | 0 | 1;
  todayReadiness: 1 | 2 | 3 | null;
  baselineRpe: number | null;
  /** Why the finger gap widened; null when the default 48h gap applies. */
  fingerGapReason: FingerGapReason;
  /** Why the weekly cap moved; null when unchanged. */
  capReason: CapReason;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * @param netMisses Real training shortfall over the last 3 weeks (days short of intent, already crediting
 *   moved/substituted/adhoc/imported sessions). Passed in from generatePlan's adherence pass.
 */
export function learnProfile(events: PlanEvent[], today: string, netMisses: number): LearnedProfile {
  const feedback = events.filter(
    (e): e is Extract<PlanEvent, { kind: 'feedback' }> => e.kind === 'feedback' && daysBetween(e.date, today) >= 0,
  );
  const longRpes = feedback.filter((e) => e.completed && e.rpe !== null && daysBetween(e.date, today) <= 60).map((e) => e.rpe!);
  const baselineRpe = longRpes.length >= 10 ? median(longRpes) : null;
  const hiThreshold = baselineRpe !== null ? Math.min(baselineRpe + 1, 8.5) : 8.5;
  const loThreshold = 6.5;

  const recent = feedback.filter((e) => daysBetween(e.date, today) <= 21);
  const rpes = recent.filter((e) => e.completed && e.rpe !== null).map((e) => e.rpe!);
  const meanRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const anyFingerPain = feedback.some(
    (e) => e.pain !== null && (e.pain.site === 'finger' || e.pain.site === 'wrist') && daysBetween(e.date, today) <= 28,
  );

  const readinessByDate = new Map<string, 1 | 2 | 3>();
  for (const e of events) {
    if (e.kind === 'readiness') readinessByDate.set(e.date, e.level);
  }
  const todayReadiness = readinessByDate.get(today) ?? null;
  let heavyCount14 = 0;
  for (const [date, level] of readinessByDate) {
    if (level === 1 && daysBetween(date, today) >= 0 && daysBetween(date, today) <= 14) heavyCount14++;
  }

  let fingerGapDays: 2 | 3 = 2;
  let fingerGapReason: FingerGapReason = null;
  if (anyFingerPain) {
    fingerGapDays = 3;
    fingerGapReason = 'recent-pain';
  } else if (meanRpe !== null && meanRpe >= hiThreshold) {
    fingerGapDays = 3;
    fingerGapReason = 'high-rpe';
  } else if (heavyCount14 >= 3) {
    fingerGapDays = 3;
    fingerGapReason = 'heavy-days';
  }

  let capDelta: -1 | 0 | 1 = 0;
  let capReason: CapReason = null;
  if (netMisses >= 3) {
    capDelta = -1;
    capReason = 'misses';
  } else if (rpes.length >= 6 && netMisses === 0 && meanRpe !== null && meanRpe <= loThreshold && !anyFingerPain && heavyCount14 === 0) {
    capDelta = 1;
    capReason = 'clean-block';
  }

  return { fingerGapDays, capDelta, todayReadiness, baselineRpe, fingerGapReason, capReason };
}
