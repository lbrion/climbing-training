import { addDays, daysBetween, generatePlan, importedMinutesByDate, latestImports, runViews } from './generate.js';
import { TEMPLATES } from './templates.js';
import type { PlanEvent, UserState } from './types.js';

/** Number of rolling weeks shown in History trend charts (oldest → newest). */
export const TREND_WEEKS = 12;

export interface TrendSeries {
  id: 'load' | 'avgRpe' | 'maxGrade' | 'sessions' | 'volumeMin' | 'painDays' | 'readiness';
  label: string;
  /** Short unit label for the chart, e.g. "RPE", "V", "min". */
  unit: string;
  /** One value per weekStart; null when that week has no observations. */
  values: (number | null)[];
}

export interface PlanMetrics {
  planned28d: number;
  completed28d: number;
  missed28d: number;
  completionPct: number | null;
  prGrade: number | null;
  prDate: string | null;
  weeklyLoads: { weekStart: string; load: number }[];
  typeCounts: { type: string; title: string; count: number }[];
  /** Rolling weekly trendlines for History (same week windows as weeklyLoads, extended). */
  trends: {
    weekStarts: string[];
    series: TrendSeries[];
  };
}

type Feedback = Extract<PlanEvent, { kind: 'feedback' }>;

export function computeMetrics(state: UserState, today: string): PlanMetrics {
  const plan = generatePlan(state, today);
  const byId = new Map(plan.sessions.map((s) => [s.id, s]));

  const lastFeedback = new Map<string, Feedback>();
  for (const e of state.events) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, e);
  }

  // Adherence over completed weeks: intended vs actually-trained days, crediting swaps/substitutions/adhoc.
  const { plannedDays, completedDays, netMisses } = plan.adherence;

  let prGrade: number | null = null;
  let prDate: string | null = null;
  for (const fb of lastFeedback.values()) {
    if (fb.completed && fb.topGrade != null && (prGrade === null || fb.topGrade > prGrade)) {
      prGrade = fb.topGrade;
      prDate = fb.date;
    }
  }
  for (const e of latestImports(state.events)) {
    for (const c of e.climbs ?? []) {
      if (c.result === 'send' && c.grade != null && (prGrade === null || c.grade > prGrade)) {
        prGrade = c.grade;
        prDate = e.date;
      }
    }
  }

  const imported = importedMinutesByDate(state.events);
  const runs = runViews(state.events);
  const imports = latestImports(state.events);

  const weekStarts: string[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    weekStarts.push(addDays(today, -7 * (i + 1) + 1));
  }

  const loadValues: (number | null)[] = [];
  const avgRpeValues: (number | null)[] = [];
  const maxGradeValues: (number | null)[] = [];
  const sessionsValues: (number | null)[] = [];
  const volumeValues: (number | null)[] = [];
  const painValues: (number | null)[] = [];
  const readinessValues: (number | null)[] = [];

  for (const weekStart of weekStarts) {
    let load = 0;
    let rpeSum = 0;
    let rpeN = 0;
    let maxGrade: number | null = null;
    let completedSessions = 0;
    let volumeMin = 0;
    let painDays = 0;
    const painDateSet = new Set<string>();

    for (const fb of lastFeedback.values()) {
      const offset = daysBetween(weekStart, fb.date);
      if (offset < 0 || offset > 6) continue;
      if (!fb.completed) continue;

      completedSessions += 1;
      const s = byId.get(fb.sessionId);
      const mins = imported.get(fb.date) ?? (s ? s.durationMin : 60);
      volumeMin += mins;

      if (fb.rpe !== null) {
        load += fb.rpe * mins;
        rpeSum += fb.rpe;
        rpeN += 1;
      }
      if (fb.topGrade != null && (maxGrade === null || fb.topGrade > maxGrade)) maxGrade = fb.topGrade;
      if (fb.pain) painDateSet.add(fb.date);
    }

    for (const r of runs) {
      const offset = daysBetween(weekStart, r.date);
      if (offset < 0 || offset > 6) continue;
      const rfb = lastFeedback.get(r.id);
      if (rfb && rfb.completed && rfb.rpe !== null) continue;
      // Count run volume/load when it has no completed RPE feedback of its own.
      if (!rfb || !rfb.completed) {
        load += r.rpe * r.durationMin;
        volumeMin += r.durationMin;
        if (!rfb) completedSessions += 1;
      }
    }

    for (const e of imports) {
      const offset = daysBetween(weekStart, e.date);
      if (offset < 0 || offset > 6) continue;
      for (const c of e.climbs ?? []) {
        if (c.result === 'send' && c.grade != null && (maxGrade === null || c.grade > maxGrade)) maxGrade = c.grade;
      }
    }

    let readySum = 0;
    let readyN = 0;
    for (const e of state.events) {
      if (e.kind !== 'readiness') continue;
      const offset = daysBetween(weekStart, e.date);
      if (offset < 0 || offset > 6) continue;
      readySum += e.level;
      readyN += 1;
    }

    painDays = painDateSet.size;
    loadValues.push(load > 0 ? Math.round(load) : completedSessions > 0 || volumeMin > 0 ? 0 : null);
    avgRpeValues.push(rpeN > 0 ? Math.round((rpeSum / rpeN) * 10) / 10 : null);
    maxGradeValues.push(maxGrade);
    sessionsValues.push(completedSessions > 0 ? completedSessions : null);
    volumeValues.push(volumeMin > 0 ? volumeMin : null);
    painValues.push(painDays > 0 ? painDays : completedSessions > 0 ? 0 : null);
    readinessValues.push(readyN > 0 ? Math.round((readySum / readyN) * 10) / 10 : null);
  }

  // Keep the existing 4-week load bars as the trailing window of the longer trend.
  const weeklyLoads = weekStarts.slice(-4).map((weekStart, i) => {
    const idx = weekStarts.length - 4 + i;
    return { weekStart, load: loadValues[idx] ?? 0 };
  });

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

  const series: TrendSeries[] = [
    { id: 'load', label: 'Weekly load', unit: 'AU', values: loadValues },
    { id: 'avgRpe', label: 'Avg RPE', unit: 'RPE', values: avgRpeValues },
    { id: 'maxGrade', label: 'Best send', unit: 'V', values: maxGradeValues },
    { id: 'sessions', label: 'Sessions done', unit: '', values: sessionsValues },
    { id: 'volumeMin', label: 'Training minutes', unit: 'min', values: volumeValues },
    { id: 'painDays', label: 'Pain days', unit: '', values: painValues },
    { id: 'readiness', label: 'Avg readiness', unit: '', values: readinessValues },
  ];

  return {
    planned28d: plannedDays,
    completed28d: completedDays,
    missed28d: netMisses,
    completionPct: plannedDays ? Math.round((completedDays / plannedDays) * 100) : null,
    prGrade,
    prDate,
    weeklyLoads,
    typeCounts,
    trends: { weekStarts, series },
  };
}

function titleOf(type: string): string {
  return (TEMPLATES as Record<string, { title: string }>)[type]?.title ?? type;
}
