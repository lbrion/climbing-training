import { useRef, useState } from 'react';
import { TEMPLATES, type InjurySite, type Session, type SessionType } from '@climb/engine';
import { api, type AppState } from './api.js';

const SITES: InjurySite[] = ['finger', 'wrist', 'elbow', 'shoulder', 'back', 'knee'];
const LOGGABLE_TYPES = (Object.keys(TEMPLATES) as SessionType[]).filter((t) => t !== 'rest');

export function SessionSheet({ session, onClose, onUpdate }: { session: Session; onClose: () => void; onUpdate: (s: AppState) => void }) {
  const [completed, setCompleted] = useState(true);
  const [actualType, setActualType] = useState<SessionType | ''>('');
  const [rpe, setRpe] = useState(6);
  const [topGrade, setTopGrade] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [painSite, setPainSite] = useState<InjurySite | ''>('');
  const [painSeverity, setPainSeverity] = useState<1 | 2 | 3>(1);
  const [moveTo, setMoveTo] = useState(session.date);
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

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
    });
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
        <h2>{session.title}</h2>
        <p className="focus">{session.focus}</p>
        {session.hints.map((h, i) => (
          <div key={i} className="hint-line">
            {h}
          </div>
        ))}
        <ul className="exercises">
          {session.exercises.map((ex, i) => (
            <li key={i}>
              <strong>{ex.name}</strong>
              {ex.sets ? <span className="sets"> · {ex.sets}</span> : null}
              <div>{ex.detail}</div>
            </li>
          ))}
        </ul>

        <h3>Log this session</h3>
        <div className="row">
          <button className={completed ? 'seg on' : 'seg'} onClick={() => setCompleted(true)}>
            Completed
          </button>
          <button className={!completed ? 'seg on' : 'seg'} onClick={() => setCompleted(false)}>
            Missed
          </button>
        </div>
        {completed && (
          <label>
            What did you actually do?
            <select value={actualType} onChange={(e) => setActualType(e.target.value as SessionType | '')}>
              <option value="">As planned — {session.title}</option>
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
        <button className="primary" disabled={busy} onClick={submitFeedback}>
          Save feedback
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
