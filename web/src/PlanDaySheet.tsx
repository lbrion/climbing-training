import { useEffect, useState } from 'react';
import { TEMPLATES, type Plan, type Session, type SessionType } from '@climb/engine';
import { api, type AppState } from './api.js';

// Runs aren't planner-recommendable sessions — they're logged via the run sheet.
const LOGGABLE = (Object.keys(TEMPLATES) as SessionType[]).filter((t) => t !== 'rest' && t !== 'run');

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Plain-language diff of how the plan changes from `date` onward, comparing current vs previewed plans. */
function planChanges(current: Plan, preview: Plan, date: string): string[] {
  const byDate = (p: Plan) => {
    const m = new Map<string, Session>();
    for (const s of p.sessions) if (s.date >= date) m.set(s.date, s);
    return m;
  };
  const cur = byDate(current);
  const nxt = byDate(preview);
  const dates = [...new Set([...cur.keys(), ...nxt.keys()])].sort();
  const lines: string[] = [];
  for (const d of dates) {
    const c = cur.get(d);
    const n = nxt.get(d);
    if (!c && n) lines.push(`${fmtDay(d)}: added ${n.title}`);
    else if (c && !n) lines.push(`${fmtDay(d)}: ${c.title} removed`);
    else if (c && n && c.type !== n.type) lines.push(`${fmtDay(d)}: ${c.title} → ${n.title}`);
  }
  return lines;
}

export function PlanDaySheet({
  date,
  currentPlan,
  onClose,
  onKept,
}: {
  date: string;
  currentPlan: Plan;
  onClose: () => void;
  onKept: (s: AppState) => void;
}) {
  const [type, setType] = useState<SessionType | null>(null);
  const [previewFor, setPreviewFor] = useState<{ type: SessionType; state: AppState } | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .recommend(date)
      .then((r) => live && setType(r.type))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [date]);

  useEffect(() => {
    if (!type) return;
    let live = true;
    api
      .preview({ kind: 'adhoc-session', date, type })
      .then((s) => live && setPreviewFor({ type, state: s }))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [type, date]);

  const recomputing = !!type && (!previewFor || previewFor.type !== type);
  const preview = previewFor && previewFor.type === type ? previewFor.state : null;
  const changes = preview?.plan ? planChanges(currentPlan, preview.plan, date) : [];

  const keep = async () => {
    if (!type) return;
    setKeeping(true);
    try {
      onKept(await api.event({ kind: 'adhoc-session', date, type }));
    } catch (e) {
      setError(String(e));
      setKeeping(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Plan {fmtDay(date)}</h2>
        {error && <div className="notice">{error}</div>}
        {!type ? (
          <p className="hint">Finding the best session…</p>
        ) : (
          <>
            <p className="hint">Recommended for this day — preview how it reshapes your plan, then keep it or discard.</p>
            <label>
              Session
              <select value={type} onChange={(e) => setType(e.target.value as SessionType)}>
                {LOGGABLE.map((t) => (
                  <option key={t} value={t}>
                    {TEMPLATES[t].title}
                  </option>
                ))}
              </select>
            </label>
            <div className={`card intensity-${TEMPLATES[type].intensity}`}>
              <div className="card-top">
                <span className="title">{TEMPLATES[type].title}</span>
                <span className={`tag tag-${TEMPLATES[type].intensity}`}>{TEMPLATES[type].intensity}</span>
              </div>
              <p className="focus">{TEMPLATES[type].focus}</p>
            </div>

            <h3>What changes going forward</h3>
            {recomputing ? (
              <p className="hint">Recomputing…</p>
            ) : changes.length === 0 ? (
              <p className="hint">Just adds this session — nothing else in your plan shifts.</p>
            ) : (
              <ul className="change-list">
                {changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}

            <button className="primary" disabled={keeping || recomputing} onClick={keep}>
              Keep this plan
            </button>
            <button className="ghost" onClick={onClose}>
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
