import type { PlanEvent, Session } from '@climb/engine';
import type { AppState } from './api.js';

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

type Feedback = Extract<PlanEvent, { kind: 'feedback' }>;

export function HistoryView({ state, onOpen }: { state: AppState; onOpen: (s: Session) => void }) {
  const plan = state.plan!;
  const metrics = state.metrics;
  const today = plan.generatedFor;

  const lastFeedback = new Map<string, Feedback>();
  for (const e of state.events ?? []) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, e);
  }
  const past = plan.sessions.filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date));

  const maxLoad = Math.max(1, ...(metrics?.weeklyLoads.map((w) => w.load) ?? [1]));

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
              {metrics.completed28d}/{metrics.planned28d} sessions
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

      <h3>Past sessions</h3>
      {past.length === 0 && <p className="hint">Nothing logged yet. Your completed sessions will show up here.</p>}
      {past.map((s) => {
        const fb = lastFeedback.get(s.id);
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
              {fb?.topGrade != null && <span className="mono done">V{fb.topGrade}</span>}
              {fb?.pain && (
                <span className="mono missed">
                  {fb.pain.site.toUpperCase()} PAIN {fb.pain.severity}
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
