import { latestImports, type PlanEvent, type Session, type TrendSeries } from '@climb/engine';
import type { AppState } from './api.js';
import { TrendChart } from './TrendChart.js';

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

type Feedback = Extract<PlanEvent, { kind: 'feedback' }>;
type Imported = Extract<PlanEvent, { kind: 'imported-activity' }>;

const TREND_FORMATTERS: Partial<Record<TrendSeries['id'], (v: number) => string>> = {
  maxGrade: (v) => `V${v}`,
  avgRpe: (v) => v.toFixed(1),
  readiness: (v) => v.toFixed(1),
  load: (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v))),
  volumeMin: (v) => (v >= 60 ? `${Math.round(v / 6) / 10}h` : String(Math.round(v))),
};

export function HistoryView({ state, onOpen }: { state: AppState; onOpen: (s: Session) => void }) {
  const plan = state.plan!;
  const metrics = state.metrics;
  const today = plan.generatedFor;

  const lastFeedback = new Map<string, Feedback>();
  for (const e of state.events ?? []) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, e);
  }
  const importedByDate = new Map<string, Imported>();
  for (const e of latestImports(state.events ?? [])) importedByDate.set(e.date, e);
  const past = plan.sessions.filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date));

  const maxLoad = Math.max(1, ...(metrics?.weeklyLoads.map((w) => w.load) ?? [1]));
  const trendSeries = metrics?.trends.series.filter((s) => s.values.some((v) => v !== null)) ?? [];

  return (
    <>
      {metrics && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">PR send</span>
            <span className="stat-value">{metrics.prGrade !== null ? `V${metrics.prGrade}` : '—'}</span>
            {metrics.prDate && <span className="stat-sub">{fmtDay(metrics.prDate)}</span>}
          </div>
          <div className="stat">
            <span className="stat-label">Completion 4wk</span>
            <span className="stat-value">{metrics.completionPct !== null ? `${metrics.completionPct}%` : '—'}</span>
            <span className="stat-sub">
              {metrics.completed28d}/{metrics.planned28d} training days
            </span>
          </div>
          <div className="stat wide">
            <span className="stat-label">Weekly load</span>
            <div className="bars">
              {metrics.weeklyLoads.map((w) => (
                <div key={w.weekStart} className="bar-col">
                  <div className="bar" style={{ height: `${Math.max(4, (w.load / maxLoad) * 48)}px` }} />
                  <span className="bar-label">
                    {new Date(w.weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {metrics.typeCounts.length > 0 && (
            <div className="stat wide">
              <span className="stat-label">Sessions by type</span>
              <div className="type-counts">
                {metrics.typeCounts.map((t) => (
                  <span key={t.type} className="type-count">
                    {t.title} <strong>{t.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {metrics && (
        <section className="trends">
          <h3>Trends</h3>
          <p className="hint">Rolling 12 weeks from what you have logged — scrub a chart to inspect a week.</p>
          {trendSeries.length === 0 ? (
            <p className="hint">No trend data yet. Complete a few sessions with RPE, grades, or readiness to populate these.</p>
          ) : (
            <div className="trend-grid">
              {trendSeries.map((s) => (
                <TrendChart
                  key={s.id}
                  label={s.label}
                  unit={s.unit}
                  weekStarts={metrics.trends.weekStarts}
                  values={s.values}
                  formatValue={TREND_FORMATTERS[s.id]}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <h3>Past sessions</h3>
      {past.length === 0 && <p className="hint">Nothing logged yet. Your completed sessions will show up here.</p>}
      {past.map((s) => {
        const fb = lastFeedback.get(s.id);
        const im = importedByDate.get(s.date);
        return (
          <div
            key={s.id}
            className={`card history loggable ${fb?.completed ? '' : fb ? 'was-missed' : 'unlogged'}`}
            onClick={() => onOpen(s)}
          >
            <div className="card-top">
              <span className="title">{s.title}</span>
              <span className="phase">{fmtDay(s.date)}</span>
            </div>
            <div className="card-sub">
              {fb?.completed && <span className="mono done">✓ DONE</span>}
              {fb && !fb.completed && <span className="mono missed">MISSED</span>}
              {!fb && <span className="mono">TAP TO LOG</span>}
              {fb?.rpe != null && <span className="mono">RPE {fb.rpe}</span>}
              {fb?.exercisesDone && fb.exercisesDone.length > 0 && (
                <span className="mono">
                  {fb.exercisesDone.length}/{s.exercises.length} DRILLS
                </span>
              )}
              {fb?.topGrade != null && <span className="mono done">V{fb.topGrade}</span>}
              {fb?.pain && (
                <span className="mono missed">
                  {fb.pain.site.toUpperCase()} PAIN {fb.pain.severity}
                </span>
              )}
              {im && (
                <span className="mono watch">
                  ⌚ {im.durationMin} MIN{im.avgHr ? ` · ${im.avgHr} BPM` : ''}
                </span>
              )}
            </div>
            {fb?.notes && <p className="note">{fb.notes}</p>}
          </div>
        );
      })}
    </>
  );
}
