import { useState } from 'react';
import type { InjurySite, Session } from '@climb/engine';
import { api, type AppState } from './api.js';

const SITES: InjurySite[] = ['finger', 'wrist', 'elbow', 'shoulder', 'back', 'knee'];

export function SessionSheet({
  session,
  state,
  onClose,
  onUpdate,
}: {
  session: Session;
  state: AppState;
  onClose: () => void;
  onUpdate: (s: AppState) => void;
}) {
  const [completed, setCompleted] = useState(true);
  const [rpe, setRpe] = useState(6);
  const [painSite, setPainSite] = useState<InjurySite | ''>('');
  const [painSeverity, setPainSeverity] = useState<1 | 2 | 3>(1);
  const [moveTo, setMoveTo] = useState(session.date);
  const [busy, setBusy] = useState(false);

  const submitFeedback = async () => {
    setBusy(true);
    const next = await api.event({
      kind: 'feedback',
      sessionId: session.id,
      date: session.date,
      completed,
      rpe: completed ? rpe : null,
      pain: painSite ? { site: painSite, severity: painSeverity } : null,
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
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
            Effort (RPE {rpe})
            <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} />
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
