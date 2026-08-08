import { useState } from 'react';
import type { Config, Goal, InjurySite } from '@climb/engine';
import { api, localToday, type AppState } from './api.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SITES: InjurySite[] = ['finger', 'wrist', 'elbow', 'shoulder', 'back', 'knee'];
const SKILLS = ['overhang', 'slab', 'dynamic', 'crimps', 'compression', 'endurance'] as const;

const todayIso = localToday;

const defaults: Config = {
  assessment: {
    date: todayIso(),
    maxBoulderGrade: 4,
    flashGrade: 2,
    fingerStrengthPctBw: null,
    maxPullupsAdded: null,
    experienceYears: 2,
    weeklySessionsHistorical: 2,
    injuryHistory: [],
    lastHardSessionDate: null,
    selfRated: { technique: 3, power: 3, endurance: 3 },
  },
  goal: { type: 'grade', targetGrade: 6 },
  availability: { minutesByWeekday: [0, 90, 0, 90, 0, 120, 0] },
  equipment: { climbingGym: true, hangboard: false, boardWall: false, weights: false, pullupBar: false },
  planStart: todayIso(),
};

export function Setup({ initial, onDone }: { initial?: Config; onDone: (s: AppState) => void }) {
  const [cfg, setCfg] = useState<Config>(initial ?? defaults);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const a = cfg.assessment;
  const setA = (patch: Partial<Config['assessment']>) => setCfg({ ...cfg, assessment: { ...a, ...patch } });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.setup({ ...cfg, planStart: initial?.planStart ?? todayIso(), assessment: { ...a, date: todayIso() } }));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const steps = [
    <section key="about">
      <h2>Assessment</h2>
      <label>
        Max boulder grade (V{a.maxBoulderGrade})
        <input type="range" min={0} max={14} value={a.maxBoulderGrade} onChange={(e) => setA({ maxBoulderGrade: +e.target.value })} />
      </label>
      <label>
        Typical flash grade (V{a.flashGrade})
        <input type="range" min={0} max={14} value={a.flashGrade} onChange={(e) => setA({ flashGrade: +e.target.value })} />
      </label>
      <label>
        Years climbing
        <input type="number" min={0} step={0.5} value={a.experienceYears} onChange={(e) => setA({ experienceYears: +e.target.value })} />
      </label>
      <label>
        Sessions per week recently
        <input
          type="number"
          min={0}
          max={7}
          value={a.weeklySessionsHistorical}
          onChange={(e) => setA({ weeklySessionsHistorical: +e.target.value })}
        />
      </label>
      <label>
        Last hard session (limit climbing, hangboard, heavy pulls)
        <select
          value={
            a.lastHardSessionDate == null
              ? '3+'
              : String(Math.round((Date.parse(todayIso()) - Date.parse(a.lastHardSessionDate)) / 86400000))
          }
          onChange={(e) => {
            const v = e.target.value;
            setA({
              lastHardSessionDate: v === '3+' ? null : new Date(Date.parse(todayIso()) - +v * 86400000).toISOString().slice(0, 10),
            });
          }}
        >
          <option value="0">Today</option>
          <option value="1">Yesterday</option>
          <option value="2">2 days ago</option>
          <option value="3+">3+ days ago</option>
        </select>
      </label>
    </section>,
    <section key="strength">
      <h2>Strength tests</h2>
      <p className="hint">Optional. Skip anything you have not tested; the plan assumes it may be a weakness.</p>
      <label>
        20mm 7s hang, total load as % bodyweight
        <input
          type="number"
          placeholder="e.g. 120"
          value={a.fingerStrengthPctBw ?? ''}
          onChange={(e) => setA({ fingerStrengthPctBw: e.target.value === '' ? null : +e.target.value })}
        />
      </label>
      <label>
        Max weighted pull-up, added kg
        <input
          type="number"
          placeholder="e.g. 20"
          value={a.maxPullupsAdded ?? ''}
          onChange={(e) => setA({ maxPullupsAdded: e.target.value === '' ? null : +e.target.value })}
        />
      </label>
      {(['technique', 'power', 'endurance'] as const).map((q) => (
        <label key={q}>
          Self-rated {q} ({a.selfRated[q]}/5)
          <input
            type="range"
            min={1}
            max={5}
            value={a.selfRated[q]}
            onChange={(e) => setA({ selfRated: { ...a.selfRated, [q]: +e.target.value as 1 | 2 | 3 | 4 | 5 } })}
          />
        </label>
      ))}
      <fieldset>
        <legend>Past injuries</legend>
        {SITES.map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={a.injuryHistory.includes(s)}
              onChange={(e) => setA({ injuryHistory: e.target.checked ? [...a.injuryHistory, s] : a.injuryHistory.filter((x) => x !== s) })}
            />
            {s}
          </label>
        ))}
      </fieldset>
    </section>,
    <section key="goal">
      <h2>Goal</h2>
      <div className="row">
        <button
          className={cfg.goal.type === 'grade' ? 'seg on' : 'seg'}
          onClick={() => setCfg({ ...cfg, goal: { type: 'grade', targetGrade: a.maxBoulderGrade + 2 } })}
        >
          Grade
        </button>
        <button
          className={cfg.goal.type === 'skill' ? 'seg on' : 'seg'}
          onClick={() => setCfg({ ...cfg, goal: { type: 'skill', skill: 'overhang' } })}
        >
          Skill
        </button>
      </div>
      {cfg.goal.type === 'grade' ? (
        <label>
          Target grade (V{cfg.goal.targetGrade})
          <input
            type="range"
            min={0}
            max={14}
            value={cfg.goal.targetGrade}
            onChange={(e) => setCfg({ ...cfg, goal: { type: 'grade', targetGrade: +e.target.value } })}
          />
        </label>
      ) : (
        <label>
          Skill focus
          <select
            value={cfg.goal.skill}
            onChange={(e) =>
              setCfg({
                ...cfg,
                goal: { type: 'skill', skill: e.target.value as Goal & { type: 'skill' } extends { skill: infer S } ? S : never },
              })
            }
          >
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>,
    <section key="schedule">
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
            value={cfg.availability.minutesByWeekday[i]}
            onChange={(e) => {
              const mins = [...cfg.availability.minutesByWeekday] as Config['availability']['minutesByWeekday'];
              mins[i] = +e.target.value;
              setCfg({ ...cfg, availability: { minutesByWeekday: mins } });
            }}
          />
        </label>
      ))}
      <fieldset>
        <legend>Equipment access</legend>
        {(Object.keys(cfg.equipment) as (keyof Config['equipment'])[]).map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={cfg.equipment[k]}
              onChange={(e) => setCfg({ ...cfg, equipment: { ...cfg.equipment, [k]: e.target.checked } })}
            />
            {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
          </label>
        ))}
      </fieldset>
    </section>,
  ];

  return (
    <div className="screen setup">
      <header className="topbar">
        <h1>
          Setup {step + 1}/{steps.length}
        </h1>
      </header>
      {steps[step]}
      {error && <div className="notice">{error}</div>}
      <div className="row nav">
        {step > 0 && (
          <button onClick={() => setStep(step - 1)} disabled={busy}>
            Back
          </button>
        )}
        {step < steps.length - 1 ? (
          <button className="primary" onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button className="primary" onClick={submit} disabled={busy}>
            {busy ? 'Building plan…' : 'Build my plan'}
          </button>
        )}
      </div>
    </div>
  );
}
