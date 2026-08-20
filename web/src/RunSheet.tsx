import { useState } from 'react';
import type { PlanEvent, RunType } from '@climb/engine';
import { api, type AppState } from './api.js';

const RUN_TYPES: { value: RunType; label: string; hint: string }[] = [
  { value: 'recovery', label: 'Recovery', hint: 'Very easy, fully conversational' },
  { value: 'easy', label: 'Easy', hint: 'Comfortable aerobic pace' },
  { value: 'long', label: 'Long', hint: 'Extended steady effort' },
  { value: 'tempo', label: 'Tempo', hint: 'Comfortably hard / threshold' },
  { value: 'intervals', label: 'Intervals', hint: 'Hard reps, VO₂ work' },
];

const num = (v: string): number | '' => (v === '' ? '' : Number(v));

/** Log a run as cross-training. Effort is scored server-side (session-RPE, refined by heart rate); this form
 * only collects inputs — no planning logic lives here. Hard/long runs get spaced from hard climbing. */
export function RunSheet({ date, onClose, onLogged }: { date: string; onClose: () => void; onLogged: (s: AppState) => void }) {
  const [runType, setRunType] = useState<RunType>('easy');
  const [durationMin, setDurationMin] = useState(40);
  const [useRpe, setUseRpe] = useState(false);
  const [rpe, setRpe] = useState(5);
  const [distanceKm, setDistanceKm] = useState<number | ''>('');
  const [avgHr, setAvgHr] = useState<number | ''>('');
  const [maxHr, setMaxHr] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmtDay = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  const save = async () => {
    if (!durationMin || durationMin < 5) {
      setError('Enter a duration of at least 5 minutes.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const event: PlanEvent = {
        kind: 'run',
        date,
        runType,
        durationMin,
        rpe: useRpe ? rpe : null,
        distanceKm: distanceKm === '' ? undefined : distanceKm,
        avgHr: avgHr === '' ? null : avgHr,
        maxHr: maxHr === '' ? null : maxHr,
      };
      onLogged(await api.event(event));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <h2>Log a run · {fmtDay}</h2>
        <p className="hint">
          Runs count toward your training load. Hard or long runs near hard climbing get spaced (concurrent-training interference); easy
          runs are low-cost. Running never loads your fingers.
        </p>
        {error && <div className="notice">{error}</div>}

        <label>
          Type
          <select value={runType} onChange={(e) => setRunType(e.target.value as RunType)}>
            {RUN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </option>
            ))}
          </select>
        </label>

        <label>
          Duration (minutes)
          <input
            type="number"
            inputMode="numeric"
            min={5}
            max={600}
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          />
        </label>

        <label className="check">
          <input type="checkbox" checked={useRpe} onChange={(e) => setUseRpe(e.target.checked)} />
          Rate the effort myself (RPE)
        </label>
        {useRpe ? (
          <label>
            Effort (RPE {rpe})
            <input type="range" min={1} max={10} value={rpe} onChange={(e) => setRpe(Number(e.target.value))} />
          </label>
        ) : (
          <p className="hint">Left off, effort is estimated from the run type — or from heart rate if you add it below.</p>
        )}

        <label>
          Distance (km, optional)
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            max={300}
            value={distanceKm}
            onChange={(e) => setDistanceKm(num(e.target.value))}
          />
        </label>

        <div className="row">
          <label>
            Avg HR (optional)
            <input type="number" inputMode="numeric" min={20} max={250} value={avgHr} onChange={(e) => setAvgHr(num(e.target.value))} />
          </label>
          <label>
            Max HR (optional)
            <input type="number" inputMode="numeric" min={20} max={250} value={maxHr} onChange={(e) => setMaxHr(num(e.target.value))} />
          </label>
        </div>
        <p className="hint">Add both HR fields and intensity is read from your %HRmax instead of the label.</p>

        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Log run'}
        </button>
        <button className="ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
