import { describe, expect, it } from 'vitest';
import { generatePlan, daysBetween, addDays } from './generate.js';
import { computeMetrics } from './metrics.js';
import { TEMPLATES } from './templates.js';
import type { UserState } from './types.js';

const base: UserState = {
  config: {
    assessment: {
      date: '2026-08-01',
      maxBoulderGrade: 6,
      flashGrade: 4,
      fingerStrengthPctBw: 115,
      maxPullupsAdded: 15,
      experienceYears: 4,
      weeklySessionsHistorical: 3,
      injuryHistory: [],
      selfRated: { technique: 3, power: 3, endurance: 2 },
    },
    goal: { type: 'grade', targetGrade: 8 },
    availability: { minutesByWeekday: [90, 0, 90, 0, 60, 120, 0] },
    equipment: { climbingGym: true, hangboard: true, boardWall: false, weights: false, pullupBar: true },
    planStart: '2026-08-03',
  },
  events: [],
};

describe('generatePlan', () => {
  it('is deterministic', () => {
    const a = generatePlan(base, '2026-08-03');
    const b = generatePlan(base, '2026-08-03');
    expect(a).toEqual(b);
  });

  it('only schedules on available days', () => {
    const plan = generatePlan(base, '2026-08-03');
    for (const s of plan.sessions) {
      const wd = (new Date(s.date + 'T00:00:00Z').getUTCDay() + 6) % 7;
      expect(base.config.availability.minutesByWeekday[wd]).toBeGreaterThan(0);
      expect(s.durationMin).toBeLessThanOrEqual(base.config.availability.minutesByWeekday[wd]);
    }
  });

  it('spaces hard finger sessions 48h apart', () => {
    const plan = generatePlan(base, '2026-08-03');
    const hardFinger = plan.sessions.filter((s) => TEMPLATES[s.type].fingerLoad && TEMPLATES[s.type].intensity === 'high');
    for (let i = 1; i < hardFinger.length; i++) {
      expect(daysBetween(hardFinger[i - 1].date, hardFinger[i].date)).toBeGreaterThanOrEqual(2);
    }
  });

  it('deloads every fourth week', () => {
    const plan = generatePlan(base, '2026-08-24');
    const deload = plan.sessions.filter((s) => s.weekPhase === 'deload');
    expect(deload.length).toBeGreaterThan(0);
    for (const s of deload) expect(s.intensity).not.toBe('high');
  });

  it('removes finger-loading sessions after finger pain', () => {
    const hurt: UserState = {
      ...base,
      events: [
        { kind: 'feedback', sessionId: 's-0-0', date: '2026-08-03', completed: true, rpe: 8, pain: { site: 'finger', severity: 2 } },
      ],
    };
    const plan = generatePlan(hurt, '2026-08-04');
    const upcoming = plan.sessions.filter((s) => s.date >= '2026-08-04' && s.date <= '2026-08-11');
    for (const s of upcoming) expect(TEMPLATES[s.type].fingerLoad).toBe(false);
    expect(plan.notices.join(' ')).toMatch(/finger/i);
  });

  it('gates hangboarding on experience', () => {
    const novice: UserState = {
      ...base,
      config: {
        ...base.config,
        assessment: { ...base.config.assessment, experienceYears: 0.5, maxBoulderGrade: 2 },
      },
    };
    const plan = generatePlan(novice, '2026-08-03');
    expect(plan.sessions.some((s) => s.type === 'hangboard-max')).toBe(false);
  });

  it('caps weekly sessions and keeps rest days even with daily availability', () => {
    const everyday: UserState = {
      ...base,
      config: {
        ...base.config,
        availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] },
      },
    };
    const plan = generatePlan(everyday, '2026-08-03');
    const week1 = plan.sessions.filter((s) => s.date >= '2026-08-03' && s.date < '2026-08-10');
    expect(week1.length).toBeLessThanOrEqual(everyday.config.assessment.weeklySessionsHistorical + 1);
    expect(week1.length).toBeLessThan(7);
    const trainedDays = new Set(week1.map((s) => s.date));
    expect(trainedDays.size).toBe(week1.length);
  });

  it('reschedules a missed high-intensity session onto an upcoming easier day', () => {
    const plan0 = generatePlan(base, '2026-08-03');
    const missed = plan0.sessions.find((s) => s.date === '2026-08-03' && s.intensity === 'high')!;
    const state: UserState = {
      ...base,
      events: [{ kind: 'feedback', sessionId: missed.id, date: missed.date, completed: false, rpe: null, pain: null }],
    };
    const plan = generatePlan(state, '2026-08-04');
    const recovered = plan.sessions.find((s) => s.warnings.some((w) => w.includes('Recovered from missed session')));
    expect(recovered).toBeDefined();
    expect(recovered!.type).toBe(missed.type);
    expect(recovered!.date >= '2026-08-04').toBe(true);
    expect(plan.notices.join(' ')).toMatch(/rescheduled/);
  });

  it('widens finger spacing to 72h after finger pain', () => {
    const hurt: UserState = {
      ...base,
      events: [
        { kind: 'feedback', sessionId: 's-0-0', date: '2026-08-03', completed: true, rpe: 7, pain: { site: 'finger', severity: 1 } },
      ],
    };
    const plan = generatePlan(hurt, '2026-08-20');
    const hardFinger = plan.sessions.filter(
      (s) => s.date >= '2026-08-20' && TEMPLATES[s.type].fingerLoad && TEMPLATES[s.type].intensity === 'high',
    );
    for (let i = 1; i < hardFinger.length; i++) {
      expect(daysBetween(hardFinger[i - 1].date, hardFinger[i].date)).toBeGreaterThanOrEqual(3);
    }
  });

  it('adds a weekly session after three weeks of easy full completion', () => {
    const fiveDays: UserState = {
      ...base,
      config: { ...base.config, availability: { minutesByWeekday: [90, 0, 90, 0, 60, 120, 90] } },
    };
    const plan0 = generatePlan(fiveDays, '2026-08-24');
    const past = plan0.sessions.filter((s) => s.date < '2026-08-24');
    const events: UserState['events'] = past.map((s) => ({
      kind: 'feedback',
      sessionId: s.id,
      date: s.date,
      completed: true,
      rpe: 5,
      pain: null,
    }));
    const plan = generatePlan({ ...fiveDays, events }, '2026-08-24');
    expect(plan.notices.join(' ')).toMatch(/increased/);
    const week = plan.sessions.filter((s) => s.date >= '2026-08-31' && s.date < '2026-09-07');
    expect(week.length).toBe(5);
  });

  it('shift-recovers a missed limit session to the next day when availability allows', () => {
    const everyday: UserState = {
      ...base,
      config: { ...base.config, availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] } },
    };
    const plan0 = generatePlan(everyday, '2026-08-03');
    const limit = plan0.sessions.find((s) => s.date === '2026-08-03' && s.type === 'limit-boulder')!;
    const state: UserState = {
      ...everyday,
      events: [{ kind: 'feedback', sessionId: limit.id, date: limit.date, completed: false, rpe: null, pain: null }],
    };
    const plan = generatePlan(state, '2026-08-04');
    const recovered = plan.sessions.find((s) => s.id === `${limit.id}-r`);
    expect(recovered).toBeDefined();
    expect(recovered!.date).toBe('2026-08-04');
    expect(recovered!.type).toBe('limit-boulder');
    const upcoming = plan.sessions.filter((s) => s.date >= '2026-08-04').sort((a, b) => a.date.localeCompare(b.date));
    const dates = new Set<string>();
    for (const s of upcoming) {
      expect(dates.has(s.date)).toBe(false);
      dates.add(s.date);
    }
    for (let i = 1; i < upcoming.length; i++) {
      const a = upcoming[i - 1];
      const b = upcoming[i];
      if (a.intensity === 'high' && b.intensity === 'high') {
        expect(daysBetween(a.date, b.date)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('downgrades today after a heavy readiness report', () => {
    const everyday: UserState = {
      ...base,
      config: { ...base.config, availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] } },
    };
    const state: UserState = { ...everyday, events: [{ kind: 'readiness', date: '2026-08-03', level: 1 }] };
    const plan = generatePlan(state, '2026-08-03');
    for (const s of plan.sessions.filter((s) => s.date === '2026-08-03')) {
      expect(s.intensity).not.toBe('high');
    }
    expect(plan.notices.join(' ')).toMatch(/heavy/i);
  });

  it('adds progression hints when a session type consistently rates easy', () => {
    const plan0 = generatePlan(base, '2026-08-24');
    const limits = plan0.sessions.filter((s) => s.type === 'limit-boulder' && s.date < '2026-08-24').slice(0, 3);
    const events: UserState['events'] = limits.map((s) => ({
      kind: 'feedback',
      sessionId: s.id,
      date: s.date,
      completed: true,
      rpe: 6,
      pain: null,
    }));
    const plan = generatePlan({ ...base, events }, '2026-08-24');
    const upcoming = plan.sessions.find((s) => s.type === 'limit-boulder' && s.date >= '2026-08-24');
    expect(upcoming).toBeDefined();
    expect(upcoming!.hints.join(' ')).toMatch(/Progress the difficulty/);
  });

  it('does not prescribe a hard finger session within 48h of a pre-plan hard session', () => {
    const state: UserState = {
      ...base,
      config: {
        ...base.config,
        assessment: { ...base.config.assessment, lastHardSessionDate: '2026-08-02' },
      },
    };
    const plan = generatePlan(state, '2026-08-03');
    const firstHardFinger = plan.sessions.find((s) => TEMPLATES[s.type].fingerLoad && TEMPLATES[s.type].intensity === 'high');
    expect(firstHardFinger).toBeDefined();
    expect(daysBetween('2026-08-02', firstHardFinger!.date)).toBeGreaterThanOrEqual(2);
  });

  it('reschedules the stimulus when a limit session was substituted with easier climbing', () => {
    const everyday: UserState = {
      ...base,
      config: { ...base.config, availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] } },
    };
    const plan0 = generatePlan(everyday, '2026-08-03');
    const limit = plan0.sessions.find((s) => s.date === '2026-08-03' && s.type === 'limit-boulder')!;
    const state: UserState = {
      ...everyday,
      events: [
        { kind: 'feedback', sessionId: limit.id, date: limit.date, completed: true, rpe: 7, pain: null, actualType: 'flash-boulder' },
      ],
    };
    const plan = generatePlan(state, '2026-08-04');
    const recovered = plan.sessions.find(
      (s) => s.date >= '2026-08-04' && s.type === 'limit-boulder' && s.warnings.some((w) => w.includes('Recovered')),
    );
    expect(recovered).toBeDefined();
    expect(plan.loadStatus.acute7d).toBeGreaterThan(0);
  });

  it('does not compute a load ratio in the first days of a plan', () => {
    const plan0 = generatePlan(base, '2026-08-03');
    const first = plan0.sessions.find((s) => s.date === '2026-08-03')!;
    const state: UserState = {
      ...base,
      events: [{ kind: 'feedback', sessionId: first.id, date: first.date, completed: true, rpe: 9, pain: null }],
    };
    const plan = generatePlan(state, '2026-08-04');
    expect(plan.loadStatus.ratio).toBeNull();
    expect(plan.loadStatus.capped).toBe(false);
    expect(plan.notices.join(' ')).not.toMatch(/load rose quickly/);
  });

  it('shows the session as what it was actually logged as', () => {
    const plan0 = generatePlan(base, '2026-08-03');
    const limit = plan0.sessions.find((s) => s.date === '2026-08-03' && s.type === 'limit-boulder')!;
    const state: UserState = {
      ...base,
      events: [
        { kind: 'feedback', sessionId: limit.id, date: limit.date, completed: true, rpe: 7, pain: null, actualType: 'flash-boulder' },
      ],
    };
    const plan = generatePlan(state, '2026-08-04');
    const shown = plan.sessions.find((s) => s.id === limit.id)!;
    expect(shown.title).toBe('Flash bouldering');
    expect(shown.type).toBe('flash-boulder');
    expect(shown.warnings.join(' ')).toMatch(/Planned: Limit bouldering/);
  });

  it('never builds long training blocks when recoveries stack', () => {
    const everyday: UserState = {
      ...base,
      config: { ...base.config, availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] } },
    };
    const plan0 = generatePlan(everyday, '2026-08-03');
    const highs = plan0.sessions.filter((s) => s.intensity === 'high' && s.date <= '2026-08-07').slice(0, 2);
    const events: UserState['events'] = [
      { kind: 'feedback', sessionId: highs[0].id, date: highs[0].date, completed: true, rpe: 6, pain: null, actualType: 'flash-boulder' },
      ...(highs[1]
        ? [{ kind: 'feedback' as const, sessionId: highs[1].id, date: highs[1].date, completed: false, rpe: null, pain: null }]
        : []),
    ];
    const plan = generatePlan({ ...everyday, events }, '2026-08-08');
    const upcoming = [...new Set(plan.sessions.filter((s) => s.date >= '2026-08-08').map((s) => s.date))].sort();
    let run = 1;
    let maxRun = 1;
    for (let i = 1; i < upcoming.length; i++) {
      run = daysBetween(upcoming[i - 1], upcoming[i]) === 1 ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(3);
    for (const s of plan.sessions) {
      expect(s.warnings.join(' ')).not.toMatch(/Shifted to absorb/);
    }
    const week = plan.sessions.filter((s) => s.date >= '2026-08-08' && s.date < '2026-08-15');
    expect(week.length).toBeLessThanOrEqual(4);
  });

  it('spaces hard finger sessions 72h apart for climbers with finger injury history', () => {
    const injured: UserState = {
      ...base,
      config: {
        ...base.config,
        availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] },
        assessment: { ...base.config.assessment, injuryHistory: ['finger'] },
      },
    };
    const plan = generatePlan(injured, '2026-08-03');
    const hardFinger = plan.sessions.filter((s) => TEMPLATES[s.type].fingerLoad && TEMPLATES[s.type].intensity === 'high');
    for (let i = 1; i < hardFinger.length; i++) {
      expect(daysBetween(hardFinger[i - 1].date, hardFinger[i].date)).toBeGreaterThanOrEqual(3);
    }
    expect(plan.notices.join(' ')).toMatch(/Past finger\/wrist injury/);
  });

  it('honors moves of recovered sessions', () => {
    const everyday: UserState = {
      ...base,
      config: { ...base.config, availability: { minutesByWeekday: [120, 120, 120, 120, 120, 120, 120] } },
    };
    const plan0 = generatePlan(everyday, '2026-08-03');
    const limit = plan0.sessions.find((s) => s.date === '2026-08-03' && s.type === 'limit-boulder')!;
    const missedState: UserState = {
      ...everyday,
      events: [{ kind: 'feedback', sessionId: limit.id, date: limit.date, completed: false, rpe: null, pain: null }],
    };
    const plan1 = generatePlan(missedState, '2026-08-04');
    const recovered = plan1.sessions.find((s) => s.id === `${limit.id}-r`)!;
    const movedState: UserState = {
      ...missedState,
      events: [...missedState.events, { kind: 'move', sessionId: recovered.id, fromDate: recovered.date, toDate: '2026-08-09' }],
    };
    const plan2 = generatePlan(movedState, '2026-08-04');
    expect(plan2.sessions.find((s) => s.id === recovered.id)?.date).toBe('2026-08-09');
  });

  it('honors move events', () => {
    const plan0 = generatePlan(base, '2026-08-03');
    const target = plan0.sessions[0];
    const moved: UserState = {
      ...base,
      events: [{ kind: 'move', sessionId: target.id, fromDate: target.date, toDate: '2026-08-09' }],
    };
    const plan = generatePlan(moved, '2026-08-03');
    expect(plan.sessions.find((s) => s.id === target.id)?.date).toBe('2026-08-09');
  });

  it('caps intensity when acute load spikes', () => {
    const plan0 = generatePlan(base, '2026-08-17');
    const past = plan0.sessions.filter((s) => s.date < '2026-08-17');
    const events: UserState['events'] = past.map((s) => ({
      kind: 'feedback',
      sessionId: s.id,
      date: s.date,
      completed: true,
      rpe: s.date >= '2026-08-10' ? 10 : 3,
      pain: null,
    }));
    const plan = generatePlan({ ...base, events }, '2026-08-17');
    if (plan.loadStatus.capped) {
      const week = plan.sessions.filter((s) => s.date >= '2026-08-17' && s.date < '2026-08-24');
      for (const s of week) expect(s.intensity).not.toBe('high');
    }
    expect(plan.loadStatus.ratio).not.toBeNull();
  });

  it('uses imported watch durations instead of planned durations for load', () => {
    const plan0 = generatePlan(base, '2026-08-17');
    const done = plan0.sessions.find((s) => s.date < '2026-08-17' && s.durationMin > 0)!;
    const feedback: UserState['events'] = [{ kind: 'feedback', sessionId: done.id, date: done.date, completed: true, rpe: 8, pain: null }];
    const withoutImport = generatePlan({ ...base, events: feedback }, addDays(done.date, 2));
    const withImport = generatePlan(
      {
        ...base,
        events: [
          ...feedback,
          {
            kind: 'imported-activity',
            date: done.date,
            externalId: 'coros-1',
            sport: 'rock_climbing',
            durationMin: done.durationMin + 30,
            avgHr: 128,
            maxHr: 171,
          },
        ],
      },
      addDays(done.date, 2),
    );
    expect(withoutImport.loadStatus.acute7d).toBe(8 * done.durationMin);
    expect(withImport.loadStatus.acute7d).toBe(8 * (done.durationMin + 30));
  });

  it('counts imported climb sends toward the PR grade', () => {
    const events: UserState['events'] = [
      {
        kind: 'imported-activity',
        date: '2026-08-05',
        externalId: 'coros-2',
        sport: 'rock_climbing',
        durationMin: 80,
        avgHr: null,
        maxHr: null,
        climbs: [
          { result: 'send', grade: 7 },
          { result: 'attempt', grade: 9 },
          { result: 'send', grade: null },
        ],
      },
    ];
    const metrics = computeMetrics({ ...base, events }, '2026-08-08');
    expect(metrics.prGrade).toBe(7);
    expect(metrics.prDate).toBe('2026-08-05');
  });

  it('materializes an adhoc session on a rest day and counts it toward the weekly cap', () => {
    // 2026-08-04 is a Tuesday with 0 availability. Cap is 4; the adhoc fifth session drops a future filler.
    const plan = generatePlan({ ...base, events: [{ kind: 'adhoc-session', date: '2026-08-04', type: 'volume-boulder' }] }, '2026-08-03');
    const adhoc = plan.sessions.find((s) => s.id.startsWith('adhoc-2026-08-04'));
    expect(adhoc).toBeDefined();
    expect(adhoc!.type).toBe('volume-boulder');
    const week1 = plan.sessions.filter((s) => s.date >= '2026-08-03' && s.date < '2026-08-10');
    expect(week1.length).toBe(4);
    expect(plan.notices.join(' ')).toMatch(/removed to keep the week/);
  });

  it('keeps retro-logged adhoc sessions visible outside the 28-day window', () => {
    const plan = generatePlan({ ...base, events: [{ kind: 'adhoc-session', date: '2026-06-05', type: 'volume-boulder' }] }, '2026-09-20');
    expect(plan.sessions.some((s) => s.id.startsWith('adhoc-2026-06-05'))).toBe(true);
  });

  it('an adhoc hard finger session pushes upcoming hard finger work apart', () => {
    const plan = generatePlan({ ...base, events: [{ kind: 'adhoc-session', date: '2026-08-06', type: 'limit-boulder' }] }, '2026-08-03');
    for (const s of plan.sessions) {
      if (s.id.startsWith('adhoc-')) continue;
      const d = daysBetween('2026-08-06', s.date);
      if (d >= 0 && d < 2) {
        expect(TEMPLATES[s.type].fingerLoad && TEMPLATES[s.type].intensity === 'high').toBe(false);
      }
    }
  });

  it('elbow pain blocks all high-intensity work, and swapped sessions say what they replaced', () => {
    const plan0 = generatePlan(base, '2026-08-03');
    const done = plan0.sessions.find((s) => s.date === '2026-08-03')!;
    const hurt: UserState = {
      ...base,
      events: [{ kind: 'feedback', sessionId: done.id, date: '2026-08-03', completed: true, rpe: 7, pain: { site: 'elbow', severity: 2 } }],
    };
    const plan = generatePlan(hurt, '2026-08-04');
    const upcoming = plan.sessions.filter((s) => s.date >= '2026-08-04' && s.date <= '2026-08-11');
    for (const s of upcoming) expect(TEMPLATES[s.type].intensity).not.toBe('high');
    expect(plan.notices.join(' ')).toContain('until 2026-08-17');
    expect(upcoming.some((s) => s.warnings.some((w) => w.includes('Swapped from')))).toBe(true);
  });

  it('re-logging a session without pain clears the restrictions entirely', () => {
    const plan0 = generatePlan(base, '2026-08-03');
    const done = plan0.sessions.find((s) => s.date === '2026-08-03')!;
    const withPain: UserState['events'][number] = {
      kind: 'feedback',
      sessionId: done.id,
      date: '2026-08-03',
      completed: true,
      rpe: 7,
      pain: { site: 'elbow', severity: 2 },
    };
    const cleared: UserState['events'][number] = { ...withPain, pain: null };
    const plan = generatePlan({ ...base, events: [withPain, cleared] }, '2026-08-04');
    const reference = generatePlan({ ...base, events: [cleared] }, '2026-08-04');
    expect(plan.sessions.map((s) => [s.id, s.type])).toEqual(reference.sessions.map((s) => [s.id, s.type]));
    expect(plan.notices.join(' ')).not.toMatch(/pain/i);
  });

  it('supersedes an imported activity when a reprocessed event shares its externalId', () => {
    const first = {
      kind: 'imported-activity' as const,
      date: '2026-08-05',
      externalId: 'coros-9',
      sport: 'rockClimbing',
      durationMin: 60,
      avgHr: 120,
      maxHr: 150,
    };
    const reprocessed = { ...first, durationMin: 95, climbs: [{ result: 'send' as const, grade: 6 }] };
    const plan0 = generatePlan(base, '2026-08-08');
    const done = plan0.sessions.find((s) => s.date === '2026-08-05')!;
    const events: UserState['events'] = [
      first,
      { kind: 'feedback', sessionId: done.id, date: '2026-08-05', completed: true, rpe: 7, pain: null },
      reprocessed,
    ];
    const plan = generatePlan({ ...base, events }, '2026-08-08');
    expect(plan.loadStatus.acute7d).toBe(7 * 95);
    expect(computeMetrics({ ...base, events }, '2026-08-08').prGrade).toBe(6);
  });

  it('exposes the effective goal and availability, reflecting later events', () => {
    const noEvents = generatePlan(base, '2026-08-03');
    expect(noEvents.goal).toEqual(base.config.goal);
    expect(noEvents.availability).toEqual(base.config.availability);

    const events: UserState['events'] = [
      { kind: 'goal', date: '2026-08-05', goal: { type: 'skill', skill: 'endurance' } },
      { kind: 'availability', date: '2026-08-06', availability: { minutesByWeekday: [0, 60, 0, 60, 0, 60, 0] } },
      { kind: 'goal', date: '2026-08-20', goal: { type: 'grade', targetGrade: 9 } },
    ];
    const plan = generatePlan({ ...base, events }, '2026-08-10');
    expect(plan.goal).toEqual({ type: 'skill', skill: 'endurance' });
    expect(plan.availability).toEqual({ minutesByWeekday: [0, 60, 0, 60, 0, 60, 0] });
  });
});
