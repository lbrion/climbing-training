import type { Session } from '@climb/engine';
import type { AppState } from './api.js';

const PHASE_LABEL: Record<string, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  deload: 'Deload',
};

function fmtDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function PlanView({ state, onOpen }: { state: AppState; onOpen: (s: Session) => void }) {
  const plan = state.plan!;
  const today = plan.generatedFor;
  const feedbackById = new Map(
    (state.events ?? []).filter((e) => e.kind === 'feedback').map((e) => [e.sessionId, e] as const),
  );
  const upcoming = plan.sessions.filter((s) => s.date >= today);
  const days = [...new Set(upcoming.map((s) => s.date))].slice(0, 14);

  return (
    <main className="plan">
      {plan.notices.map((n, i) => (
        <div key={i} className="notice">
          {n}
        </div>
      ))}
      {plan.loadStatus.ratio !== null && (
        <div className="load">
          Weekly load ratio {plan.loadStatus.ratio.toFixed(2)} {plan.loadStatus.capped ? '(capped)' : ''}
        </div>
      )}
      {days.map((date) => (
        <section key={date}>
          <h2 className={date === today ? 'today' : ''}>{date === today ? `Today · ${fmtDay(date)}` : fmtDay(date)}</h2>
          {upcoming
            .filter((s) => s.date === date)
            .map((s) => {
              const fb = feedbackById.get(s.id);
              return (
                <button key={s.id} className={`card intensity-${s.intensity}`} onClick={() => onOpen(s)}>
                  <div className="card-top">
                    <span className="title">{s.title}</span>
                    <span className="phase">{PHASE_LABEL[s.weekPhase]}</span>
                  </div>
                  <div className="card-sub">
                    {s.durationMin} min · {s.intensity} intensity
                    {fb && (fb as { completed: boolean }).completed ? ' · ✓ done' : ''}
                    {fb && !(fb as { completed: boolean }).completed ? ' · missed' : ''}
                  </div>
                  {s.warnings.map((w, i) => (
                    <div key={i} className="warn">
                      {w}
                    </div>
                  ))}
                </button>
              );
            })}
        </section>
      ))}
    </main>
  );
}
