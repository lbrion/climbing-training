import { QUALITY_SESSIONS, rankWeaknesses } from './assessment.js';
import { TEMPLATES } from './templates.js';
import type {
  Config,
  Equipment,
  LoadStatus,
  Phase,
  Plan,
  PlanEvent,
  Session,
  SessionType,
  UserState,
} from './types.js';

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

function computeLoad(events: PlanEvent[], sessions: Map<string, Session>, today: string): LoadStatus {
  let acute = 0;
  let chronic = 0;
  for (const e of events) {
    if (e.kind !== 'feedback' || !e.completed || e.rpe === null) continue;
    const s = sessions.get(e.sessionId);
    const load = e.rpe * (s ? s.durationMin : 60);
    const age = daysBetween(e.date, today);
    if (age >= 0 && age < 7) acute += load;
    if (age >= 0 && age < 28) chronic += load;
  }
  const chronicWeekly = chronic / 4;
  const ratio = chronicWeekly > 0 ? acute / chronicWeekly : null;
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

  const start = config.planStart;
  const endDay = daysBetween(start, today) + HORIZON_DAYS;
  const sessions: Session[] = [];
  const lastHardFingerByDate: string[] = [];

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
    const weeklyCap = Math.max(2, Math.min(6, cfg.assessment.weeklySessionsHistorical + 1));
    const slots = Math.min(days.length, phase === 'deload' ? Math.min(weeklyCap, 4) : weeklyCap);
    const scheduledDays = Array.from({ length: slots }, (_, i) => days[Math.floor((i * days.length) / slots)]);
    const types = orderForSpacing(weeklySessionTypes(cfg, slots, phase, painActive, w === Math.floor(daysBetween(start, today) / 7) ? notices : []));

    types.forEach((type, slot) => {
      const date = scheduledDays[slot];
      if (!date) return;
      const tmpl = TEMPLATES[type];
      const warnings: string[] = [];
      let effectiveType = type;
      if (tmpl.fingerLoad && tmpl.intensity === 'high') {
        const last = lastHardFingerByDate[lastHardFingerByDate.length - 1];
        if (last && daysBetween(last, date) < 2) {
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
      });
    });
  }

  const byId = new Map(sessions.map((s) => [s.id, s]));

  for (const e of state.events) {
    if (e.kind !== 'move') continue;
    const s = byId.get(e.sessionId);
    if (!s) continue;
    s.date = e.toDate;
    const conflict = sessions.some(
      (o) =>
        o.id !== s.id &&
        TEMPLATES[o.type].fingerLoad &&
        TEMPLATES[o.type].intensity === 'high' &&
        TEMPLATES[s.type].fingerLoad &&
        TEMPLATES[s.type].intensity === 'high' &&
        Math.abs(daysBetween(o.date, s.date)) < 2,
    );
    if (conflict) s.warnings.push('Moved within 48h of another hard finger session — treat one as sub-maximal.');
  }

  const lastFeedback = new Map<string, { completed: boolean; date: string }>();
  for (const e of state.events) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, { completed: e.completed, date: e.date });
  }
  const consumed = new Set<string>();
  for (const [sessionId, fb] of lastFeedback) {
    if (fb.completed || daysBetween(fb.date, today) > 5) continue;
    const missedSession = byId.get(sessionId);
    if (!missedSession || TEMPLATES[missedSession.type].intensity !== 'high') continue;
    const missedTmpl = TEMPLATES[missedSession.type];
    const candidate = sessions.find(
      (o) =>
        !consumed.has(o.id) &&
        daysBetween(today, o.date) >= 0 &&
        daysBetween(today, o.date) < 5 &&
        o.intensity !== 'high' &&
        o.type !== missedSession.type &&
        o.weekPhase !== 'deload' &&
        !lastFeedback.has(o.id) &&
        (!missedTmpl.fingerLoad ||
          !sessions.some(
            (h) =>
              h.id !== o.id &&
              TEMPLATES[h.type].fingerLoad &&
              TEMPLATES[h.type].intensity === 'high' &&
              Math.abs(daysBetween(h.date, o.date)) < 2,
          )),
    );
    if (!candidate) continue;
    consumed.add(candidate.id);
    const replacedTitle = candidate.title;
    candidate.type = missedSession.type;
    candidate.title = missedTmpl.title;
    candidate.intensity = missedTmpl.intensity;
    candidate.focus = missedTmpl.focus;
    candidate.durationMin = Math.min(
      availability.minutesByWeekday[weekdayOf(candidate.date)],
      missedTmpl.baseDurationMin,
    );
    candidate.exercises = missedTmpl.exercises(candidate.weekPhase, cfg.assessment.maxBoulderGrade);
    candidate.warnings.push(`Recovered from missed session (replaced ${replacedTitle}).`);
    notices.push(`Missed ${missedTmpl.title} was rescheduled to ${candidate.date}.`);
  }

  const load = computeLoad(state.events, byId, today);
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

  const missed = state.events.filter(
    (e) => e.kind === 'feedback' && !e.completed && daysBetween(e.date, today) <= 7,
  ).length;
  if (missed >= 2) {
    notices.push('Multiple sessions missed recently — this week is unchanged, but consider updating your availability so the plan matches real life.');
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
  };
}
