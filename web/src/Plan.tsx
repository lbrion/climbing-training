import { useState } from 'react';
import type { Session } from '@climb/engine';
import { api, type AppState } from './api.js';
import { HistoryView } from './History.js';

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
  return (
    <div className={`card intensity-${s.intensity}`} onClick={() => onOpen(s)}>
      <div className="card-top">
        <span className="title">{s.title}</span>
        <span className="phase">{PHASE_LABEL[s.weekPhase]}</span>
      </div>
      <div className="card-sub">
        <span className={`tag tag-${s.intensity}`}>{s.intensity}</span>
        <span className="mono">{s.durationMin} MIN</span>
        {done === true && <span className="mono done">✓ DONE</span>}
        {done === false && <span className="mono missed">MISSED</span>}
        {s.hints.length > 0 && <span className="mono hint-flag">TIP</span>}
      </div>
      {done === null && (
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

function RestCard() {
  return (
    <div className="card rest">
      <div className="card-top">
        <span className="title">Rest day</span>
      </div>
      <div className="card-sub">Recovery. Optional walk or light stretching.</div>
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
  const today = plan.generatedFor;
  const [view, setView] = useState<View>(() => (localStorage.getItem('planView') as View) ?? 'list');
  const [selected, setSelected] = useState(today);

  const setViewPersist = (v: View) => {
    setView(v);
    localStorage.setItem('planView', v);
  };

  const doneById = new Map(
    (state.events ?? []).filter((e) => e.kind === 'feedback').map((e) => [e.sessionId, e.completed] as const),
  );
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const byDate = new Map<string, Session[]>(days.map((d) => [d, []]));
  for (const s of plan.sessions) byDate.get(s.date)?.push(s);

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
      {!(state.events ?? []).some((e) => e.kind === 'readiness' && e.date === today) &&
        (byDate.get(today)?.length ?? 0) > 0 && (
          <div className="readiness">
            <span>How do you feel today?</span>
            <div className="row">
              <button className="seg" onClick={() => logReadiness(3)}>
                Fresh
              </button>
              <button className="seg" onClick={() => logReadiness(2)}>
                Normal
              </button>
              <button className="seg" onClick={() => logReadiness(1)}>
                Heavy
              </button>
            </div>
          </div>
        )}
      <div className="row viewtoggle">
        <button className={view === 'list' ? 'seg on' : 'seg'} onClick={() => setViewPersist('list')}>
          List
        </button>
        <button className={view === 'calendar' ? 'seg on' : 'seg'} onClick={() => setViewPersist('calendar')}>
          Calendar
        </button>
        <button className={view === 'history' ? 'seg on' : 'seg'} onClick={() => setViewPersist('history')}>
          History
        </button>
      </div>

      {view === 'history' && <HistoryView state={state} onOpen={onOpen} />}

      {view === 'list' && (
        <div className="route">
          {days.map((date) => {
            const daySessions = byDate.get(date)!;
            const top = daySessions.reduce<string | null>(
              (acc, s) => (acc === 'high' ? acc : s.intensity === 'high' ? 'high' : s.intensity === 'medium' ? 'medium' : acc ?? 'low'),
              null,
            );
            return (
              <section key={date} className="day">
                <div className="rail">
                  <span className={top ? `hold hold-${top}${date === today ? ' hold-today' : ''}` : `hold hold-rest${date === today ? ' hold-today' : ''}`} />
                </div>
                <div className="day-body">
                  <h2 className={date === today ? 'today' : ''}>{date === today ? `Today · ${fmtDay(date)}` : fmtDay(date)}</h2>
                  {daySessions.length === 0 ? (
                    <RestCard />
                  ) : (
                    daySessions.map((s) => <SessionCard key={s.id} s={s} done={doneById.get(s.id) ?? null} onOpen={onOpen} onMiss={quickMiss} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === 'calendar' && (
        <>
          <div className="cal">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} className="cal-head">
                {d}
              </div>
            ))}
            {Array.from({ length: weekdayMon0(days[0]) }, (_, i) => (
              <div key={`pad-${i}`} className="cal-cell pad" />
            ))}
            {days.map((date) => {
              const sessions = byDate.get(date)!;
              return (
                <button
                  key={date}
                  className={`cal-cell${date === selected ? ' sel' : ''}${date === today ? ' now' : ''}`}
                  onClick={() => setSelected(date)}
                >
                  <span className="cal-num">{Number(date.slice(8))}</span>
                  <span className="cal-dots">
                    {sessions.length === 0 ? (
                      <span className="cal-rest">rest</span>
                    ) : (
                      sessions.map((s) => <span key={s.id} className={`dot intensity-${s.intensity}`} />)
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <section>
            <h2 className={selected === today ? 'today' : ''}>
              {selected === today ? `Today · ${fmtDay(selected)}` : fmtDay(selected)}
            </h2>
            {byDate.get(selected)!.length === 0 ? (
              <RestCard />
            ) : (
              byDate.get(selected)!.map((s) => <SessionCard key={s.id} s={s} done={doneById.get(s.id) ?? null} onOpen={onOpen} onMiss={quickMiss} />)
            )}
          </section>
        </>
      )}
    </main>
  );
}
