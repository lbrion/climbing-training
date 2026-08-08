import { useRef, useState } from 'react';
import type { Config, Goal, Plan } from '@climb/engine';
import { api, localToday, type AppState, type FitImportReport } from './api.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SKILLS = ['overhang', 'slab', 'dynamic', 'crimps', 'compression', 'endurance'] as const;

export function Settings({
  config,
  plan,
  onClose,
  onUpdate,
  onRerunAssessment,
}: {
  config: Config;
  plan: Plan;
  onClose: () => void;
  onUpdate: (s: AppState) => void;
  onRerunAssessment: () => void;
}) {
  // plan.goal / plan.availability are the effective values (config overridden by any later goal/availability events).
  const [goal, setGoal] = useState<Goal>(plan.goal);
  const [minutes, setMinutes] = useState<Config['availability']['minutesByWeekday']>(plan.availability.minutesByWeekday);
  const [equipment, setEquipment] = useState<Config['equipment']>(config.equipment);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<FitImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFit = async (file: File) => {
    setBusy(true);
    setError(null);
    setImported(null);
    try {
      const next = await api.importFit(file);
      setImported(next.import);
      onUpdate(next);
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const goalDirty = JSON.stringify(goal) !== JSON.stringify(plan.goal);
  const minutesDirty = JSON.stringify(minutes) !== JSON.stringify(plan.availability.minutesByWeekday);
  const equipmentDirty = JSON.stringify(equipment) !== JSON.stringify(config.equipment);

  const save = async (section: string, fn: () => Promise<AppState>) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      onUpdate(await fn());
      setSaved(section);
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  return (
    <div className="screen setup settings">
      <header className="topbar">
        <h1>Settings</h1>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <section>
        <h2>Goal</h2>
        <div className="row">
          <button
            className={goal.type === 'grade' ? 'seg on' : 'seg'}
            onClick={() => setGoal({ type: 'grade', targetGrade: config.assessment.maxBoulderGrade + 2 })}
          >
            Grade
          </button>
          <button className={goal.type === 'skill' ? 'seg on' : 'seg'} onClick={() => setGoal({ type: 'skill', skill: 'overhang' })}>
            Skill
          </button>
        </div>
        {goal.type === 'grade' ? (
          <label>
            Target grade (V{goal.targetGrade})
            <input
              type="range"
              min={0}
              max={14}
              value={goal.targetGrade}
              onChange={(e) => setGoal({ type: 'grade', targetGrade: +e.target.value })}
            />
          </label>
        ) : (
          <label>
            Skill focus
            <select value={goal.skill} onChange={(e) => setGoal({ type: 'skill', skill: e.target.value as (typeof SKILLS)[number] })}>
              {SKILLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="primary"
          disabled={busy || !goalDirty}
          onClick={() => save('goal', () => api.event({ kind: 'goal', date: localToday(), goal }))}
        >
          {saved === 'goal' && !goalDirty ? 'Saved ✓' : 'Save goal'}
        </button>
      </section>

      <section>
        <h2>Weekly availability</h2>
        <p className="hint">Minutes you can train each day. 0 means rest day.</p>
        {WEEKDAYS.map((d, i) => (
          <label key={d} className="dayrow">
            {d}
            <input
              type="number"
              min={0}
              max={300}
              step={15}
              value={minutes[i]}
              onChange={(e) => {
                const next = [...minutes] as Config['availability']['minutesByWeekday'];
                next[i] = +e.target.value;
                setMinutes(next);
              }}
            />
          </label>
        ))}
        <button
          className="primary"
          disabled={busy || !minutesDirty}
          onClick={() =>
            save('availability', () => api.event({ kind: 'availability', date: localToday(), availability: { minutesByWeekday: minutes } }))
          }
        >
          {saved === 'availability' && !minutesDirty ? 'Saved ✓' : 'Save availability'}
        </button>
      </section>

      <section>
        <h2>Equipment access</h2>
        <fieldset>
          {(Object.keys(equipment) as (keyof Config['equipment'])[]).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={equipment[k]} onChange={(e) => setEquipment({ ...equipment, [k]: e.target.checked })} />
              {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </label>
          ))}
        </fieldset>
        <button
          className="primary"
          disabled={busy || !equipmentDirty}
          onClick={() => save('equipment', () => api.setup({ ...config, equipment }))}
        >
          {saved === 'equipment' && !equipmentDirty ? 'Saved ✓' : 'Save equipment'}
        </button>
      </section>

      <section>
        <h2>Assessment</h2>
        <p className="hint">
          Max grade V{config.assessment.maxBoulderGrade} · flash V{config.assessment.flashGrade} · {config.assessment.experienceYears} yrs ·
          assessed {config.assessment.date}
        </p>
        <button onClick={onRerunAssessment}>Re-run assessment…</button>
      </section>

      <section>
        <h2>Watch data</h2>
        <p className="hint">
          Import a workout from your watch: in the COROS app open the activity, tap ⋯ → Export Data → FIT, then upload it here. Heart rate
          and the real duration feed your training load.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".fit,application/octet-stream"
          hidden
          onChange={(e) => e.target.files?.[0] && uploadFit(e.target.files[0])}
        />
        <button disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Importing…' : 'Import FIT file…'}
        </button>
        {imported && (
          <p className="hint">
            {imported.skipped
              ? 'Already imported — skipped.'
              : `Imported: ${imported.sport} on ${imported.date}, ${imported.durationMin} min` +
                (imported.avgHr ? `, avg HR ${imported.avgHr}` : '')}
          </p>
        )}
      </section>

      {error && <div className="notice">{error}</div>}
    </div>
  );
}
