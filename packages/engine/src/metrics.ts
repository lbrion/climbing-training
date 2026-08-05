import { addDays, daysBetween, generatePlan } from './generate.js';
import { TEMPLATES } from './templates.js';
import type { PlanEvent, UserState } from './types.js';

export interface PlanMetrics {
  planned28d: number;
  completed28d: number;
  missed28d: number;
  completionPct: number | null;
  prGrade: number | null;
  prDate: string | null;
  weeklyLoads: { weekStart: string; load: number }[];
  typeCounts: { type: string; title: string; count: number }[];
}

type Feedback = Extract<PlanEvent, { kind: 'feedback' }>;

export function computeMetrics(state: UserState, today: string): PlanMetrics {
  const plan = generatePlan(state, today);
  const byId = new Map(plan.sessions.map((s) => [s.id, s]));

  const lastFeedback = new Map<string, Feedback>();
  for (const e of state.events) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, e);
  }

  const past = plan.sessions.filter((s) => s.date < today && daysBetween(s.date, today) <= 28);
  let completed = 0;
  let missed = 0;
  for (const s of past) {
    const fb = lastFeedback.get(s.id);
    if (fb?.completed) completed++;
    else if (fb) missed++;
  }

  let prGrade: number | null = null;
  let prDate: string | null = null;
  for (const fb of lastFeedback.values()) {
    if (fb.completed && fb.topGrade != null && (prGrade === null || fb.topGrade > prGrade)) {
      prGrade = fb.topGrade;
      prDate = fb.date;
    }
  }

  const weeklyLoads: { weekStart: string; load: number }[] = [];
  for (let i = 3; i >= 0; i--) {
    const weekStart = addDays(today, -7 * (i + 1) + 1);
    let load = 0;
    for (const fb of lastFeedback.values()) {
      if (!fb.completed || fb.rpe === null) continue;
      const offset = daysBetween(weekStart, fb.date);
      if (offset < 0 || offset > 6) continue;
      const s = byId.get(fb.sessionId);
      load += fb.rpe * (s ? s.durationMin : 60);
    }
    weeklyLoads.push({ weekStart, load });
  }

  const counts = new Map<string, number>();
  for (const fb of lastFeedback.values()) {
    if (!fb.completed) continue;
    const s = byId.get(fb.sessionId);
    const type = fb.actualType ?? s?.type;
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const typeCounts = [...counts.entries()]
    .map(([type, count]) => ({ type, title: titleOf(type), count }))
    .sort((a, b) => b.count - a.count);

  return {
    planned28d: past.length,
    completed28d: completed,
    missed28d: missed,
    completionPct: past.length ? Math.round((completed / past.length) * 100) : null,
    prGrade,
    prDate,
    weeklyLoads,
    typeCounts,
  };
}

function titleOf(type: string): string {
  return (TEMPLATES as Record<string, { title: string }>)[type]?.title ?? type;
}
