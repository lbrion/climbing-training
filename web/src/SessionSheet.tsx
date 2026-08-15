import { useRef, useState } from 'react';
import { TEMPLATES, type InjurySite, type Session, type SessionType } from '@climb/engine';
import { api, type AppState, type FeedbackEvent, type ImportedActivity } from './api.js';
import { HrChart } from './HrChart.js';

const SITES: InjurySite[] = ['finger', 'wrist', 'elbow', 'shoulder', 'back', 'knee'];
const LOGGABLE_TYPES = (Object.keys(TEMPLATES) as SessionType[]).filter((t) => t !== 'rest');

export function SessionSheet({
  session,
  imported,
  feedback,
  onClose,
  onUpdate,
}: {
  session: Session;
  imported?: ImportedActivity;
  feedback?: FeedbackEvent;
  onClose: () => void;
  onUpdate: (s: AppState) => void;
}) {
  // When the session is already logged, open pre-filled with the logged state; saving appends a superseding event.
  const [completed, setCompleted] = useState<boolean | null>(feedback ? feedback.completed : null);
  const [actualType, setActualType] = useState<SessionType | ''>(feedback?.actualType ?? '');
  const [rpe, setRpe] = useState(feedback?.rpe ?? 6);
  const [topGrade, setTopGrade] = useState<number | ''>(feedback?.topGrade ?? '');
  const [notes, setNotes] = useState(feedback?.notes ?? '');
  const [painSite, setPainSite] = useState<InjurySite | ''>(feedback?.pain?.site ?? '');
  const [painSeverity, setPainSeverity] = useState<1 | 2 | 3>(feedback?.pain?.severity ?? 1);
  const [moveTo, setMoveTo] = useState(session.date);
  const [busy, setBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  // Mid-session drill checklist: kept on-device until feedback is saved, then recorded on the event.
  // Unsaved on-device checks win over the logged event (they are the newer edit).
  const doneKey = `exdone-${session.id}`;
  const [exercisesDone, setExercisesDone] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem(doneKey);
      const source: number[] = stored != null ? (JSON.parse(stored) as number[]) : (feedback?.exercisesDone ?? []);
      return source.filter((i) => i >= 0 && i < session.exercises.length);
    } catch {
      return feedback?.exercisesDone ?? [];
    }
  });
  const toggleExercise = (i: number) => {
    const next = exercisesDone.includes(i) ? exercisesDone.filter((x) => x !== i) : [...exercisesDone, i].sort((a, b) => a - b);
    setExercisesDone(next);
    localStorage.setItem(doneKey, JSON.stringify(next));
  };

  // Adhoc sessions were added by the user, not scheduled, so there is no "planned" session to deviate from.
  const isAdhoc = session.id.startsWith('adhoc-');

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = sheetRef.current && sheetRef.current.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    if (dragY > 90) onClose();
    else setDragY(0);
    startY.current = null;
  };

  const submitFeedback = async () => {
    if (completed === null) return;
    setBusy(true);
    const next = await api.event({
      kind: 'feedback',
      sessionId: session.id,
      date: session.date,
      completed,
      rpe: completed ? rpe : null,
      pain: painSite ? { site: painSite, severity: painSeverity } : null,
      actualType: completed && actualType && actualType !== session.type ? actualType : null,
      topGrade: completed && topGrade !== '' ? topGrade : null,
      notes: notes.trim() || undefined,
      exercisesDone: completed && exercisesDone.length > 0 ? exercisesDone : undefined,
    });
    localStorage.removeItem(doneKey);
    onUpdate(next);
  };

  const submitMove = async () => {
    setBusy(true);
    const next = await api.event({ kind: 'move', sessionId: session.id, fromDate: session.date, toDate: moveTo });
    onUpdate(next);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      >
        <div className="sheet-handle" />
        <div className="sheet-title">
          <h2>{session.title}</h2>
          <button className="info-btn" aria-label="About this session" onClick={() => setShowInfo(!showInfo)}>
            i
          </button>
        </div>
        <p className="focus">{session.focus}</p>
        {showInfo && <p className="overview">{TEMPLATES[session.type].overview}</p>}
        {session.warnings.map((w, i) => (
          <div key={i} className="warn">
            {w}
          </div>
        ))}
        {session.hints.map((h, i) => (
          <div key={i} className="hint-line">
            {h}
          </div>
        ))}
        <ul className="exercises">
          {session.exercises.map((ex, i) => (
            <li key={i} className={exercisesDone.includes(i) ? 'done-ex' : ''} onClick={() => toggleExercise(i)}>
              <span className={`checkbox ${exercisesDone.includes(i) ? 'on' : ''}`} aria-hidden />
              <div className="ex-body">
                <strong>{ex.name}</strong>
                {ex.sets ? <span className="sets"> · {ex.sets}</span> : null}
                <div>{ex.detail}</div>
                {ex.rest && <div className="rest-chip">REST {ex.rest.toUpperCase()}</div>}
              </div>
            </li>
          ))}
        </ul>

        {imported && (
          <div className="watch-block" onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
            <h3>Watch data</h3>
            <div className="card-sub">
              <span className="mono watch">⌚ {imported.durationMin} MIN</span>
              {imported.avgHr != null && <span className="mono">AVG {imported.avgHr}</span>}
              {imported.maxHr != null && <span className="mono">MAX {imported.maxHr}</span>}
              {imported.ascentM != null && imported.ascentM > 0 && <span className="mono">↑ {imported.ascentM} M</span>}
              {imported.calories != null && imported.calories > 0 && <span className="mono">{imported.calories} KCAL</span>}
            </div>
            {imported.hrSeries && imported.hrSeries.length > 1 && (
              <HrChart series={imported.hrSeries} avgHr={imported.avgHr} blocks={imported.blocks} />
            )}
            {imported.climbTimeMin != null && imported.restTimeMin != null && imported.climbTimeMin + imported.restTimeMin > 0 && (
              <div className="ratio">
                <div className="ratio-bar">
                  <div className="seg-climb" style={{ flexGrow: imported.climbTimeMin }} />
                  <div className="seg-rest" style={{ flexGrow: imported.restTimeMin }} />
                </div>
                <div className="ratio-labels">
                  <span className="mono">
                    <i className="ldot ldot-climb" />
                    CLIMB {imported.climbTimeMin} MIN{imported.avgHrClimb != null ? ` · ${imported.avgHrClimb} BPM` : ''}
                  </span>
                  <span className="mono">
                    <i className="ldot ldot-rest" />
                    REST {imported.restTimeMin} MIN{imported.avgHrRest != null ? ` · ${imported.avgHrRest} BPM` : ''}
                  </span>
                </div>
                {(() => {
                  const climbs = (imported.blocks ?? []).filter((b) => b.kind === 'climb');
                  if (climbs.length === 0) return null;
                  const sends = climbs.filter((b) => b.result === 'send').length;
                  const attempts = climbs.filter((b) => b.result === 'attempt').length;
                  if (sends + attempts > 0) {
                    return (
                      <div className="ratio-labels outcome-legend">
                        <span className="mono">
                          <i className="ldot ldot-send" />
                          {sends} SENT
                        </span>
                        <span className="mono">
                          <i className="ldot ldot-attempt" />
                          {attempts} ATTEMPTED
                        </span>
                      </div>
                    );
                  }
                  return (
                    <p className="hint">
                      {climbs.length} climb block{climbs.length === 1 ? '' : 's'} detected — shaded on the chart.
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        <h3>{feedback ? 'Your log' : 'Log this session'}</h3>
        {feedback && <p className="hint">Logged {feedback.completed ? 'as completed' : 'as missed'} — edit anything and save to update.</p>}
        <div className="row">
          <button className={completed === true ? 'seg on' : 'seg'} onClick={() => setCompleted(true)}>
            Completed
          </button>
          <button className={completed === false ? 'seg on' : 'seg'} onClick={() => setCompleted(false)}>
            Missed
          </button>
        </div>
        {completed && (
          <label>
            {isAdhoc ? 'Session type' : 'What did you actually do?'}
            <select value={actualType} onChange={(e) => setActualType(e.target.value as SessionType | '')}>
              <option value="">{isAdhoc ? session.title : `As planned — ${session.title}`}</option>
              {LOGGABLE_TYPES.filter((t) => t !== session.type).map((t) => (
                <option key={t} value={t}>
                  {TEMPLATES[t].title}
                </option>
              ))}
            </select>
          </label>
        )}
        {completed && (
          <label>
            Effort (RPE {rpe})
            <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} />
          </label>
        )}
        {completed && (
          <label>
            Hardest send today (optional)
            <select value={topGrade} onChange={(e) => setTopGrade(e.target.value === '' ? '' : +e.target.value)}>
              <option value="">Not tracked</option>
              {Array.from({ length: 18 }, (_, i) => (
                <option key={i} value={i}>
                  V{i}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Any pain?
          <select value={painSite} onChange={(e) => setPainSite(e.target.value as InjurySite | '')}>
            <option value="">No pain</option>
            {SITES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {painSite && (
          <label>
            Severity
            <select value={painSeverity} onChange={(e) => setPainSeverity(Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>1 — mild, went away</option>
              <option value={2}>2 — lingered after session</option>
              <option value={3}>3 — sharp / limits climbing</option>
            </select>
          </label>
        )}
        <label>
          Notes (optional)
          <textarea rows={3} placeholder="Conditions, sends, how it felt…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || completed === null} onClick={submitFeedback}>
          {completed === null ? 'Completed or missed?' : feedback ? 'Update feedback' : 'Save feedback'}
        </button>

        <h3>Move session</h3>
        <div className="row">
          <input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
          <button disabled={busy || moveTo === session.date} onClick={submitMove}>
            Move
          </button>
        </div>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
