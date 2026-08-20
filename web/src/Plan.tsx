import { useState } from 'react';
import { TEMPLATES, type Session, type SessionType } from '@climb/engine';
import { api, type AppState } from './api.js';
import { HistoryView } from './History.js';
import { PlanDaySheet } from './PlanDaySheet.js';
import { RunSheet } from './RunSheet.js';

const PHASE_LABEL: Record<string, string> = {
  base: 'Base',
  build: 'Build',
  peak: 'Peak',
  deload: 'Deload',
};

const DAY_MS = 86_400_000;

function fmtDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

function weekdayMon0(iso: string): number {
  return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

type View = 'list' | 'calendar' | 'history';

function SessionCard({
  s,
  done,
  onOpen,
  onMiss,
}: {
  s: Session;
  done: boolean | null;
  onOpen: (s: Session) => void;
  onMiss: (s: Session) => void;
}) {
  const isRun = s.type === 'run';
  return (
    <div className={`card intensity-${s.intensity}`} onClick={() => onOpen(s)}>
      <div className="card-top">
        <span className="title">{s.title}</span>
        <span className="phase">{PHASE_LABEL[s.weekPhase]}</span>
      </div>
      <div className="card-sub">
        <span className={`tag tag-${s.intensity}`}>{s.intensity}</span>
        <span className="mono">{s.durationMin} MIN</span>
        {isRun && <span className="mono done">🏃 LOGGED</span>}
        {!isRun && done === true && <span className="mono done">✓ DONE</span>}
        {!isRun && done === false && <span className="mono missed">MISSED</span>}
        {s.hints.length > 0 && <span className="mono hint-flag">TIP</span>}
      </div>
      {!isRun && done === null && (
        <button
          className="quick-miss"
          onClick={(e) => {
            e.stopPropagation();
            onMiss(s);
          }}
        >
          ✕ Didn't do it
        </button>
      )}
      {s.warnings.map((w, i) => (
        <div key={i} className="warn">
          {w}
        </div>
      ))}
    </div>
  );
}

function RestCard({
  date,
  onAdd,
  onPlan,
  onRun,
  past,
}: {
  date: string;
  onAdd: (date: string, type: SessionType) => Promise<void>;
  onPlan: (date: string) => void;
  onRun: (date: string) => void;
  past?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card rest">
      <div className="card-top">
        <span className="title">{past ? 'Nothing logged' : 'Rest day'}</span>
      </div>
      <div className="card-sub">{past ? 'No session was planned or logged this day.' : 'Recovery. Optional walk or light stretching.'}</div>
      {!picking ? (
        <div className="rest-actions">
          {!past && (
            <button className="quick-miss" onClick={() => onPlan(date)}>
              ＋ Plan a session
            </button>
          )}
          <button className="quick-miss" onClick={() => setPicking(true)}>
            {past ? '＋ Add a session you did' : 'Log one I did'}
          </button>
          <button className="quick-miss" onClick={() => onRun(date)}>
            🏃 Log a run
          </button>
        </div>
      ) : (
        <select
          autoFocus
          disabled={busy}
          defaultValue=""
          onChange={async (e) => {
            const type = e.target.value as SessionType;
            if (!type) return;
            setBusy(true);
            await onAdd(date, type);
          }}
        >
          <option value="" disabled>
            What did you do?
          </option>
          {(Object.keys(TEMPLATES) as SessionType[])
            .filter((t) => t !== 'rest' && t !== 'run')
            .map((t) => (
              <option key={t} value={t}>
                {TEMPLATES[t].title}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}

export function PlanView({
  state,
  onOpen,
  onUpdate,
}: {
  state: AppState;
  onOpen: (s: Session) => void;
  onUpdate: (next: AppState) => void;
}) {
  const plan = state.plan!;
  const quickMiss = async (s: Session) => {
    onUpdate(await api.event({ kind: 'feedback', sessionId: s.id, date: s.date, completed: false, rpe: null, pain: null }));
  };
  const logReadiness = async (level: 1 | 2 | 3) => {
    onUpdate(await api.event({ kind: 'readiness', date: plan.generatedFor, level }));
  };
  const addSession = async (date: string, type: SessionType) => {
    const next = await api.event({ kind: 'adhoc-session', date, type });
    onUpdate(next);
    const created = next.plan?.sessions.filter((s) => s.id.startsWith(`adhoc-${date}`)).pop();
    if (created && date <= (next.plan?.generatedFor ?? date)) onOpen(created);
  };
  const today = plan.generatedFor;
  const [view, setView] = useState<View>(() => (localStorage.getItem('planView') as View) ?? 'list');
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [planningDate, setPlanningDate] = useState<string | null>(null);
  const [runningDate, setRunningDate] = useState<string | null>(null);

  const setViewPersist = (v: View) => {
    setView(v);
    localStorage.setItem('planView', v);
  };

  const doneById = new Map((state.events ?? []).filter((e) => e.kind === 'feedback').map((e) => [e.sessionId, e.completed] as const));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const byDate = new Map<string, Session[]>(days.map((d) => [d, []]));
  for (const s of plan.sessions) byDate.get(s.date)?.push(s);
  const sessionsOn = (d: string) => plan.sessions.filter((s) => s.date === d);
  // The engine plans/backfills a ±28-day window around today; outside it, days have no plan data.
  const inPlanWindow = (d: string) => {
    const diff = Math.round((Date.parse(d) - Date.parse(today)) / DAY_MS);
    return diff >= -28 && diff < 28;
  };

  const monthDays = Array.from(
    { length: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
  const monthLabel = new Date(month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <main className="plan">
      {plan.loadStatus.ratio !== null && (
        <div className="load">
          Weekly load ratio {plan.loadStatus.ratio.toFixed(2)} {plan.loadStatus.capped ? '(capped)' : ''}
        </div>
      )}
      {(byDate.get(today)?.length ?? 0) > 0 && (
        <div className="readiness">
          <span>How do you feel today?</span>
          <div className="row">
            {(
              [
                [3, 'Fresh'],
                [2, 'Normal'],
                [1, 'Heavy'],
              ] as const
            ).map(([level, label]) => {
              const current = [...(state.events ?? [])].reverse().find((e) => e.kind === 'readiness' && e.date === today);
              const on = current && current.kind === 'readiness' && current.level === level;
              return (
                <button key={level} className={on ? 'seg on' : 'seg'} onClick={() => logReadiness(level)}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <nav className="bottomnav" aria-label="Views">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setViewPersist('list')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <line x1="8.5" y1="6" x2="20" y2="6" />
            <line x1="8.5" y1="12" x2="20" y2="12" />
            <line x1="8.5" y1="18" x2="20" y2="18" />
            <circle cx="4.5" cy="6" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="18" r="0.9" fill="currentColor" stroke="none" />
          </svg>
          LIST
        </button>
        <button className={view === 'calendar' ? 'on' : ''} onClick={() => setViewPersist('calendar')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
            <line x1="3.5" y1="10" x2="20.5" y2="10" />
            <line x1="8" y1="3" x2="8" y2="6.5" />
            <line x1="16" y1="3" x2="16" y2="6.5" />
          </svg>
          CALENDAR
        </button>
        <button className={view === 'history' ? 'on' : ''} onClick={() => setViewPersist('history')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <polyline points="12 7.5 12 12 15.5 14" />
          </svg>
          HISTORY
        </button>
      </nav>

      {view === 'history' && <HistoryView state={state} onOpen={onOpen} />}

      {view === 'list' && (
        <div className="route">
          {days.map((date) => {
            const daySessions = byDate.get(date)!;
            const top = daySessions.reduce<string | null>(
              (acc, s) => (acc === 'high' ? acc : s.intensity === 'high' ? 'high' : s.intensity === 'medium' ? 'medium' : (acc ?? 'low')),
              null,
            );
            return (
              <section key={date} className="day">
                <div className="rail">
                  <span
                    className={
                      top
                        ? `hold hold-${top}${date === today ? ' hold-today' : ''}`
                        : `hold hold-rest${date === today ? ' hold-today' : ''}`
                    }
                  />
                </div>
                <div className="day-body">
                  <h2 className={date === today ? 'today' : ''}>{date === today ? `Today · ${fmtDay(date)}` : fmtDay(date)}</h2>
                  {daySessions.length === 0 ? (
                    <RestCard date={date} onAdd={addSession} onPlan={setPlanningDate} onRun={setRunningDate} />
                  ) : (
                    <>
                      {daySessions.map((s) => (
                        <SessionCard key={s.id} s={s} done={doneById.get(s.id) ?? null} onOpen={onOpen} onMiss={quickMiss} />
                      ))}
                      {!daySessions.some((s) => s.type === 'run') && (
                        <button className="quick-miss add-run" onClick={() => setRunningDate(date)}>
                          🏃 Log a run
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === 'calendar' && (
        <>
          <div className="cal-nav">
            <button className="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <h2>{monthLabel}</h2>
            <button className="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="cal">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} className="cal-head">
                {d}
              </div>
            ))}
            {Array.from({ length: weekdayMon0(monthDays[0]) }, (_, i) => (
              <div key={`pad-${i}`} className="cal-cell pad" />
            ))}
            {monthDays.map((date) => {
              const sessions = sessionsOn(date);
              const dim = !inPlanWindow(date) && sessions.length === 0;
              return (
                <button
                  key={date}
                  className={`cal-cell${date === selected ? ' sel' : ''}${date === today ? ' now' : ''}${dim ? ' dim' : ''}`}
                  onClick={() => setSelected(date)}
                >
                  <span className="cal-num">{Number(date.slice(8))}</span>
                  <span className="cal-dots">
                    {sessions.length === 0 ? (
                      <span className="cal-rest">{dim ? '' : 'rest'}</span>
                    ) : (
                      sessions.map((s) =>
                        doneById.get(s.id) === false ? (
                          <span key={s.id} className="dot missed" title="Missed" />
                        ) : (
                          <span key={s.id} className={`dot intensity-${s.intensity}`} />
                        ),
                      )
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <section>
            <h2 className={selected === today ? 'today' : ''}>{selected === today ? `Today · ${fmtDay(selected)}` : fmtDay(selected)}</h2>
            {sessionsOn(selected).length === 0 ? (
              <RestCard date={selected} onAdd={addSession} onPlan={setPlanningDate} onRun={setRunningDate} past={selected < today} />
            ) : (
              <>
                {sessionsOn(selected).map((s) => (
                  <SessionCard key={s.id} s={s} done={doneById.get(s.id) ?? null} onOpen={onOpen} onMiss={quickMiss} />
                ))}
                {!sessionsOn(selected).some((s) => s.type === 'run') && (
                  <button className="quick-miss add-run" onClick={() => setRunningDate(selected)}>
                    🏃 Log a run
                  </button>
                )}
              </>
            )}
          </section>
        </>
      )}
      {planningDate && (
        <PlanDaySheet
          date={planningDate}
          currentPlan={plan}
          onClose={() => setPlanningDate(null)}
          onKept={(next) => {
            onUpdate(next);
            setPlanningDate(null);
          }}
        />
      )}
      {runningDate && (
        <RunSheet
          date={runningDate}
          onClose={() => setRunningDate(null)}
          onLogged={(next) => {
            onUpdate(next);
            setRunningDate(null);
          }}
        />
      )}
    </main>
  );
}
