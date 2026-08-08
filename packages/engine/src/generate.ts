import { QUALITY_SESSIONS, rankWeaknesses } from './assessment.js';
import { learnProfile } from './learn.js';
import { TEMPLATES, type Template } from './templates.js';
import type { Config, Equipment, LoadStatus, Phase, Plan, PlanEvent, Session, SessionType, UserState } from './types.js';

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 28;

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
}

function weekdayOf(iso: string): number {
  return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export function phaseForWeek(week: number): Phase {
  const cycle: Phase[] = ['base', 'build', 'peak', 'deload'];
  return cycle[week % 4];
}

function templateAllowed(type: SessionType, cfg: Config, eq: Equipment): boolean {
  const t = TEMPLATES[type];
  if (t.needs.gym && !eq.climbingGym) return false;
  if (t.needs.hangboard && !eq.hangboard) return false;
  if (t.needs.board && !eq.boardWall) return false;
  if (t.needs.weights && !eq.weights) return false;
  if (t.needs.pullupBar && !eq.pullupBar && !eq.climbingGym) return false;
  if (cfg.assessment.maxBoulderGrade < t.minGrade) return false;
  if (cfg.assessment.experienceYears < t.minExperienceYears) return false;
  return true;
}

interface RecentPain {
  finger: boolean;
  upperLimb: boolean;
}

function recentPain(events: PlanEvent[], today: string): RecentPain {
  const out: RecentPain = { finger: false, upperLimb: false };
  for (const e of events) {
    if (e.kind !== 'feedback' || !e.pain || e.pain.severity < 2) continue;
    if (daysBetween(e.date, today) > 14) continue;
    if (e.pain.site === 'finger' || e.pain.site === 'wrist') out.finger = true;
    if (e.pain.site === 'elbow' || e.pain.site === 'shoulder') out.upperLimb = true;
  }
  return out;
}

/** Actual trained minutes per date from watch imports; the longest activity wins when a date has several. */
export function importedMinutesByDate(events: PlanEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'imported-activity') continue;
    out.set(e.date, Math.max(out.get(e.date) ?? 0, e.durationMin));
  }
  return out;
}

function computeLoad(events: PlanEvent[], sessions: Map<string, Session>, today: string, planStart: string): LoadStatus {
  let acute = 0;
  let chronic = 0;
  const imported = importedMinutesByDate(events);
  for (const e of events) {
    if (e.kind !== 'feedback' || !e.completed || e.rpe === null) continue;
    const s = sessions.get(e.sessionId);
    const load = e.rpe * (imported.get(e.date) ?? (s ? s.durationMin : 60));
    const age = daysBetween(e.date, today);
    if (age >= 0 && age < 7) acute += load;
    if (age >= 0 && age < 28) chronic += load;
  }
  const historyDays = daysBetween(planStart, today);
  const observedWeeks = Math.min(28, Math.max(7, historyDays + 1)) / 7;
  const chronicWeekly = chronic / observedWeeks;
  const ratio = historyDays >= 10 && chronicWeekly > 0 ? acute / chronicWeekly : null;
  return { acute7d: acute, chronic28d: chronic, ratio, capped: ratio !== null && ratio > 1.3 };
}

function weeklySessionTypes(cfg: Config, slots: number, phase: Phase, pain: RecentPain, notices: string[]): SessionType[] {
  const weaknesses = rankWeaknesses(cfg.assessment, cfg.goal);
  const picked: SessionType[] = [];
  const count = (t: SessionType) => picked.filter((p) => p === t).length;

  const push = (t: SessionType): boolean => {
    if (!templateAllowed(t, cfg, cfg.equipment)) return false;
    const tmpl = TEMPLATES[t];
    if (pain.finger && tmpl.fingerLoad) return false;
    if (pain.upperLimb && (t === 'strength' || t === 'board-power')) return false;
    if (phase === 'deload' && tmpl.intensity === 'high') return false;
    const highCount = picked.filter((p) => TEMPLATES[p].intensity === 'high').length;
    if (tmpl.intensity === 'high' && highCount >= Math.min(3, Math.ceil(slots / 2))) return false;
    const fingerCount = picked.filter((p) => TEMPLATES[p].fingerLoad && TEMPLATES[p].intensity === 'high').length;
    if (tmpl.fingerLoad && tmpl.intensity === 'high' && fingerCount >= 2) return false;
    if (count(t) >= 2) return false;
    picked.push(t);
    return true;
  };

  if (pain.finger) notices.push('Recent finger/wrist pain reported: finger-intensive sessions replaced with low-load work for 14 days.');
  if (pain.upperLimb) notices.push('Recent elbow/shoulder pain reported: heavy pulling replaced with technique and mobility work.');

  push('limit-boulder');
  for (const q of weaknesses) {
    if (picked.length >= slots) break;
    for (const t of QUALITY_SESSIONS[q]) {
      if (push(t)) break;
    }
  }
  const fillers: SessionType[] = ['volume-boulder', 'technique', 'aerobic-capacity', 'mobility-prehab', 'hangboard-subhang'];
  let i = 0;
  while (picked.length < slots && i < 20) {
    push(fillers[i % fillers.length]);
    i++;
  }
  return picked;
}

function orderForSpacing(types: SessionType[]): SessionType[] {
  const high = types.filter((t) => TEMPLATES[t].intensity === 'high');
  const rest = types.filter((t) => TEMPLATES[t].intensity !== 'high');
  const out: SessionType[] = [];
  while (high.length || rest.length) {
    if (high.length) out.push(high.shift()!);
    if (rest.length) out.push(rest.shift()!);
  }
  return out;
}

export function generatePlan(state: UserState, today: string): Plan {
  const { config } = state;
  const notices: string[] = [];
  const pain = recentPain(state.events, today);

  let availability = config.availability;
  let goal = config.goal;
  for (const e of state.events) {
    if (e.kind === 'availability' && e.date <= today) availability = e.availability;
    if (e.kind === 'goal' && e.date <= today) goal = e.goal;
  }
  const cfg: Config = { ...config, goal, availability };

  const learned = learnProfile(state.events, today);
  notices.push(...learned.rationale);
  const priorFingerInjury = config.assessment.injuryHistory.includes('finger') || config.assessment.injuryHistory.includes('wrist');
  const fingerGap = priorFingerInjury ? 3 : learned.fingerGapDays;
  if (priorFingerInjury && learned.fingerGapDays < 3) {
    notices.push('Past finger/wrist injury: hard finger sessions are kept 72h apart.');
  }

  const start = config.planStart;
  const endDay = daysBetween(start, today) + HORIZON_DAYS;
  const sessions: Session[] = [];
  const lastHardFingerByDate: string[] = [];
  if (cfg.assessment.lastHardSessionDate) lastHardFingerByDate.push(cfg.assessment.lastHardSessionDate);

  const weeklyCap = Math.max(2, Math.min(6, cfg.assessment.weeklySessionsHistorical + 1 + learned.capDelta));
  const totalWeeks = Math.ceil(endDay / 7) + 1;
  for (let w = 0; w < totalWeeks; w++) {
    const phase = phaseForWeek(w);
    const weekStart = addDays(start, w * 7);
    const days: string[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (availability.minutesByWeekday[weekdayOf(date)] >= 30) days.push(date);
    }
    const painActive = daysBetween(today, weekStart) <= 7 ? pain : { finger: false, upperLimb: false };
    const slots = Math.min(days.length, phase === 'deload' ? Math.min(weeklyCap, 4) : weeklyCap);
    const scheduledDays = Array.from({ length: slots }, (_, i) => days[Math.floor((i * days.length) / slots)]);
    const types = orderForSpacing(
      weeklySessionTypes(cfg, slots, phase, painActive, w === Math.floor(daysBetween(start, today) / 7) ? notices : []),
    );

    types.forEach((type, slot) => {
      const date = scheduledDays[slot];
      if (!date) return;
      const tmpl = TEMPLATES[type];
      const warnings: string[] = [];
      let effectiveType = type;
      if (tmpl.fingerLoad && tmpl.intensity === 'high') {
        const last = lastHardFingerByDate[lastHardFingerByDate.length - 1];
        if (last && daysBetween(last, date) < fingerGap) {
          effectiveType = 'technique';
          warnings.push('Swapped to technique: hard finger sessions need 48h apart.');
        } else {
          lastHardFingerByDate.push(date);
        }
      }
      const t = TEMPLATES[effectiveType];
      const budget = availability.minutesByWeekday[weekdayOf(date)];
      const scale = phase === 'deload' ? 0.6 : 1;
      sessions.push({
        id: `s-${w}-${slot}`,
        date,
        type: effectiveType,
        title: t.title,
        intensity: phase === 'deload' && t.intensity === 'high' ? 'medium' : t.intensity,
        durationMin: Math.min(budget, Math.round(t.baseDurationMin * scale)),
        focus: t.focus,
        exercises: t.exercises(phase, cfg.assessment.maxBoulderGrade),
        weekPhase: phase,
        warnings,
        hints: [],
      });
    });
  }

  const byId = new Map(sessions.map((s) => [s.id, s]));

  const applyMoves = () => {
    for (const e of state.events) {
      if (e.kind !== 'move') continue;
      const s = byId.get(e.sessionId);
      if (!s || s.date === e.toDate) continue;
      s.date = e.toDate;
      const conflict = sessions.some(
        (o) =>
          o.id !== s.id &&
          TEMPLATES[o.type].fingerLoad &&
          TEMPLATES[o.type].intensity === 'high' &&
          TEMPLATES[s.type].fingerLoad &&
          TEMPLATES[s.type].intensity === 'high' &&
          Math.abs(daysBetween(o.date, s.date)) < fingerGap,
      );
      if (conflict) s.warnings.push('Moved within 48h of another hard finger session — treat one as sub-maximal.');
    }
  };
  applyMoves();

  const lastFeedback = new Map<string, { completed: boolean; date: string; actualType?: SessionType | null }>();
  for (const e of state.events) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, { completed: e.completed, date: e.date, actualType: e.actualType });
  }
  const consumed = new Set<string>();

  const scheduleHealthy = (extraDate?: string): boolean => {
    const trainDays = new Set(sessions.filter((o) => daysBetween(today, o.date) >= 0 && !lastFeedback.has(o.id)).map((o) => o.date));
    if (extraDate) trainDays.add(extraDate);
    for (const e of state.events) {
      if (e.kind === 'feedback' && e.completed && daysBetween(e.date, today) >= 0 && daysBetween(e.date, today) <= 6) {
        trainDays.add(e.date);
      }
    }

    const perWeek = new Map<number, number>();
    for (const d of trainDays) {
      const w = Math.floor(daysBetween(start, d) / 7);
      perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
    }
    for (const count of perWeek.values()) if (count > weeklyCap) return false;

    for (const d of trainDays) {
      let run = 1;
      let cur = d;
      while (trainDays.has(addDays(cur, 1))) {
        run++;
        cur = addDays(cur, 1);
      }
      if (run > 3) return false;
    }
    return true;
  };

  const dayFree = (date: string) =>
    availability.minutesByWeekday[weekdayOf(date)] >= 30 && phaseForWeek(Math.floor(daysBetween(start, date) / 7)) !== 'deload';

  const tryShiftRecovery = (missedSession: Session, missedTmpl: Template): boolean => {
    let insertDate: string | null = null;
    for (let off = 0; off < 5; off++) {
      const d = addDays(today, off);
      if (dayFree(d) && !sessions.some((o) => o.date === d && lastFeedback.has(o.id))) {
        insertDate = d;
        break;
      }
    }
    if (!insertDate) return false;

    const movable = sessions
      .filter((o) => daysBetween(today, o.date) >= 0 && !lastFeedback.has(o.id))
      .sort((a, b) => a.date.localeCompare(b.date));
    const savedDates = new Map(movable.map((o) => [o.id, o.date]));

    const inserted: Session = {
      id: `${missedSession.id}-r`,
      date: insertDate,
      type: missedSession.type,
      title: missedTmpl.title,
      intensity: missedTmpl.intensity,
      durationMin: Math.min(availability.minutesByWeekday[weekdayOf(insertDate)], missedTmpl.baseDurationMin),
      focus: missedTmpl.focus,
      exercises: missedTmpl.exercises(phaseForWeek(Math.floor(daysBetween(start, insertDate) / 7)), cfg.assessment.maxBoulderGrade),
      weekPhase: phaseForWeek(Math.floor(daysBetween(start, insertDate) / 7)),
      warnings: ['Recovered from missed session; later sessions shifted to keep recovery spacing.'],
      hints: [],
    };
    const all = [inserted, ...movable];

    const nextFreeAfter = (date: string): string | null => {
      for (let off = 1; off <= 14; off++) {
        const d = addDays(date, off);
        if (daysBetween(today, d) >= 14) return null;
        if (dayFree(d)) return d;
      }
      return null;
    };

    let changed = true;
    let guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date) || (a.id === inserted.id ? -1 : 1));
      for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const collision = sorted.slice(0, i).some((p) => p.date === cur.date);
        const prevHardFinger = sorted
          .slice(0, i)
          .filter((p) => TEMPLATES[p.type].fingerLoad && TEMPLATES[p.type].intensity === 'high')
          .some(
            (p) => TEMPLATES[cur.type].fingerLoad && TEMPLATES[cur.type].intensity === 'high' && daysBetween(p.date, cur.date) < fingerGap,
          );
        const prevHighAdjacent = sorted
          .slice(0, i)
          .filter((p) => TEMPLATES[p.type].intensity === 'high')
          .some((p) => TEMPLATES[cur.type].intensity === 'high' && daysBetween(p.date, cur.date) <= 1);
        if (collision || prevHardFinger || prevHighAdjacent) {
          const next = nextFreeAfter(cur.date);
          if (!next) {
            for (const o of movable) o.date = savedDates.get(o.id)!;
            return false;
          }
          cur.date = next;
          changed = true;
          break;
        }
      }
    }
    if (guard >= 40) {
      for (const o of movable) o.date = savedDates.get(o.id)!;
      return false;
    }
    if (!scheduleHealthy(inserted.date)) {
      for (const o of movable) o.date = savedDates.get(o.id)!;
      return false;
    }

    consumed.add(inserted.id);
    sessions.push(inserted);
    byId.set(inserted.id, inserted);
    const shifted = movable.filter((o) => o.date !== savedDates.get(o.id)).length;
    notices.push(
      shifted > 0
        ? `Missed ${missedTmpl.title} was rescheduled to ${insertDate}; ${shifted} later session${shifted === 1 ? '' : 's'} shifted.`
        : `Missed ${missedTmpl.title} was rescheduled to ${insertDate}.`,
    );
    return true;
  };

  for (const [sessionId, fb] of lastFeedback) {
    if (daysBetween(fb.date, today) > 5) continue;
    const missedSession = byId.get(sessionId);
    if (!missedSession || TEMPLATES[missedSession.type].intensity !== 'high') continue;
    const substituted =
      fb.completed && fb.actualType != null && fb.actualType !== missedSession.type && TEMPLATES[fb.actualType].intensity !== 'high';
    if (fb.completed && !substituted) continue;
    if (substituted) {
      missedSession.warnings.push(
        `Logged as ${TEMPLATES[fb.actualType!].title} — the ${TEMPLATES[missedSession.type].title} stimulus moves ahead.`,
      );
    }
    const missedTmpl = TEMPLATES[missedSession.type];
    if (tryShiftRecovery(missedSession, missedTmpl)) continue;
    for (let off = 0; off < 5; off++) {
      const date = addDays(today, off);
      if (availability.minutesByWeekday[weekdayOf(date)] < 30) continue;
      const week = Math.floor(daysBetween(start, date) / 7);
      if (phaseForWeek(week) === 'deload') continue;
      const onDate = sessions.filter((o) => o.date === date);
      if (onDate.some((o) => o.intensity === 'high' || lastFeedback.has(o.id) || consumed.has(o.id))) continue;
      const spacingOk =
        (!missedTmpl.fingerLoad ||
          !sessions.some(
            (h) =>
              h.date !== date &&
              TEMPLATES[h.type].fingerLoad &&
              TEMPLATES[h.type].intensity === 'high' &&
              !lastFeedback.has(h.id) &&
              Math.abs(daysBetween(h.date, date)) < fingerGap,
          )) &&
        !sessions.some(
          (h) =>
            h.date !== date &&
            TEMPLATES[h.type].intensity === 'high' &&
            !lastFeedback.has(h.id) &&
            Math.abs(daysBetween(h.date, date)) <= 1,
        );
      if (!spacingOk) continue;

      const budget = availability.minutesByWeekday[weekdayOf(date)];
      const target = onDate.find((o) => o.type !== missedSession.type);
      if (target) {
        consumed.add(target.id);
        const replacedTitle = target.title;
        target.type = missedSession.type;
        target.title = missedTmpl.title;
        target.intensity = missedTmpl.intensity;
        target.focus = missedTmpl.focus;
        target.durationMin = Math.min(budget, missedTmpl.baseDurationMin);
        target.exercises = missedTmpl.exercises(target.weekPhase, cfg.assessment.maxBoulderGrade);
        target.warnings.push(`Recovered from missed session (replaced ${replacedTitle}).`);
        notices.push(`Missed ${missedTmpl.title} was rescheduled to ${date}.`);
      } else if (onDate.length === 0 && scheduleHealthy(date)) {
        const inserted = {
          id: `${sessionId}-r`,
          date,
          type: missedSession.type,
          title: missedTmpl.title,
          intensity: missedTmpl.intensity,
          durationMin: Math.min(budget, missedTmpl.baseDurationMin),
          focus: missedTmpl.focus,
          exercises: missedTmpl.exercises(phaseForWeek(week), cfg.assessment.maxBoulderGrade),
          weekPhase: phaseForWeek(week),
          warnings: ['Recovered from missed session (added on a rest day).'],
          hints: [],
        };
        consumed.add(inserted.id);
        sessions.push(inserted);
        byId.set(inserted.id, inserted);
        notices.push(`Missed ${missedTmpl.title} was rescheduled to ${date}.`);
      } else {
        continue;
      }
      break;
    }
  }
  applyMoves();

  for (const [sessionId, fb] of lastFeedback) {
    if (!fb.completed || fb.actualType == null) continue;
    const s = byId.get(sessionId);
    if (!s || s.type === fb.actualType) continue;
    const t = TEMPLATES[fb.actualType];
    s.warnings = s.warnings.filter((w) => !w.includes('stimulus moves ahead'));
    s.warnings.push(`Planned: ${s.title}.`);
    s.type = fb.actualType;
    s.title = t.title;
    s.intensity = t.intensity;
    s.focus = t.focus;
    s.exercises = t.exercises(s.weekPhase, cfg.assessment.maxBoulderGrade);
  }

  const load = computeLoad(state.events, byId, today, start);
  if (load.capped) {
    notices.push('Training load rose quickly (acute:chronic > 1.3). High-intensity sessions this week are capped at moderate effort.');
    for (const s of sessions) {
      const age = daysBetween(today, s.date);
      if (age >= 0 && age < 7 && s.intensity === 'high') {
        s.intensity = 'medium';
        s.warnings.push('Intensity reduced this week to manage load spike.');
      }
    }
  }

  if (learned.todayReadiness === 1) {
    for (const s of sessions) {
      if (s.date === today && s.intensity === 'high') {
        s.intensity = 'medium';
        s.warnings.push('You reported feeling heavy today: keep this session sub-maximal.');
      }
    }
    notices.push("Feeling heavy today: today's intensity is dialed back. Quality over load.");
  }

  const EXPECTED_RPE: Record<string, number> = { high: 8.5, medium: 6.5, low: 4.5 };
  const rpeByType = new Map<string, number[]>();
  for (const e of state.events) {
    if (e.kind !== 'feedback' || !e.completed || e.rpe === null) continue;
    if (daysBetween(e.date, today) > 45 || daysBetween(e.date, today) < 0) continue;
    const s = byId.get(e.sessionId);
    if (!s) continue;
    const doneType = e.actualType ?? s.type;
    const arr = rpeByType.get(doneType) ?? [];
    arr.push(e.rpe);
    rpeByType.set(doneType, arr);
  }
  for (const [type, arr] of rpeByType) {
    if (arr.length < 3) continue;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const expected = EXPECTED_RPE[TEMPLATES[type as SessionType].intensity];
    let hint: string | null = null;
    if (mean <= expected - 1.5) {
      hint = `Your last ${arr.length} ${TEMPLATES[type as SessionType].title} sessions averaged RPE ${mean.toFixed(1)} (target ~${expected}). Progress the difficulty: harder problems, more load, or smaller edges.`;
    } else if (mean >= expected + 1) {
      hint = `Your last ${arr.length} ${TEMPLATES[type as SessionType].title} sessions averaged RPE ${mean.toFixed(1)} (target ~${expected}). Back off slightly so quality stays high.`;
    }
    if (!hint) continue;
    for (const s of sessions) {
      if (s.type === type && daysBetween(today, s.date) >= 0) s.hints.push(hint);
    }
  }

  const missed = state.events.filter((e) => e.kind === 'feedback' && !e.completed && daysBetween(e.date, today) <= 7).length;
  if (missed >= 2) {
    notices.push(
      'Multiple sessions missed recently — this week is unchanged, but consider updating your availability so the plan matches real life.',
    );
  }

  const visible = sessions
    .filter((s) => daysBetween(today, s.date) >= -28 && daysBetween(today, s.date) < HORIZON_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    generatedFor: today,
    phaseByWeek: Array.from({ length: totalWeeks }, (_, w) => phaseForWeek(w)),
    sessions: visible,
    loadStatus: load,
    notices,
    goal: cfg.goal,
    availability: cfg.availability,
  };
}
