import { QUALITY_SESSIONS, rankWeaknesses } from './assessment.js';
import { learnProfile } from './learn.js';
import { TEMPLATES, type Template } from './templates.js';
import type {
  Adherence,
  Availability,
  Config,
  Equipment,
  Intensity,
  LoadStatus,
  Phase,
  Plan,
  PlanEvent,
  RunType,
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

/** Equipment available on a given date: a travel window's equipment overrides home equipment for its range. */
export function equipmentForDate(cfg: Config, date: string): Equipment {
  let eq = cfg.equipment;
  for (const w of cfg.travel ?? []) if (date >= w.from && date <= w.to) eq = w.equipment;
  return eq;
}

/** Availability on a given date: a travel window may override the weekly availability for its range. */
function availabilityForDate(cfg: Config, date: string): Availability {
  let av = cfg.availability;
  for (const w of cfg.travel ?? []) if (date >= w.from && date <= w.to && w.availability) av = w.availability;
  return av;
}

/** Downgrade a session to something doable on the day's equipment, preserving training quality where possible. */
function fitToEquipment(desired: SessionType, dayEquip: Equipment, cfg: Config): SessionType {
  if (templateAllowed(desired, cfg, dayEquip)) return desired;
  const ladder: SessionType[] = TEMPLATES[desired].fingerLoad
    ? ['hangboard-subhang', 'strength', 'mobility-prehab']
    : ['strength', 'volume-boulder', 'technique', 'aerobic-capacity', 'hangboard-subhang', 'mobility-prehab'];
  for (const t of ladder) if (templateAllowed(t, cfg, dayEquip)) return t;
  return 'mobility-prehab'; // needs no equipment — always doable
}

interface RecentPain {
  finger: boolean;
  upperLimb: boolean;
  fingerUntil: string | null;
  upperUntil: string | null;
}

/** Pain restrictions come from the LATEST feedback per session, so re-logging a session without pain clears them. */
function recentPain(events: PlanEvent[], today: string): RecentPain {
  const lastFeedback = new Map<string, Extract<PlanEvent, { kind: 'feedback' }>>();
  for (const e of events) {
    if (e.kind === 'feedback') lastFeedback.set(e.sessionId, e);
  }
  const out: RecentPain = { finger: false, upperLimb: false, fingerUntil: null, upperUntil: null };
  for (const e of lastFeedback.values()) {
    if (!e.pain || e.pain.severity < 2) continue;
    if (daysBetween(e.date, today) > 14) continue;
    const until = addDays(e.date, 14);
    if (e.pain.site === 'finger' || e.pain.site === 'wrist') {
      out.finger = true;
      if (!out.fingerUntil || until > out.fingerUntil) out.fingerUntil = until;
    }
    if (e.pain.site === 'elbow' || e.pain.site === 'shoulder') {
      out.upperLimb = true;
      if (!out.upperUntil || until > out.upperUntil) out.upperUntil = until;
    }
  }
  return out;
}

// --- Run scoring (cross-training) -------------------------------------------------------------------
// A run's load is scored with session-RPE (Foster 2001): load = effort(RPE) × duration, the same scale
// climbing sessions use, so runs fold directly into the acute:chronic load. Effort defaults to the run
// type, but a synced heart rate (%HRmax) or an explicit RPE overrides it. Intensity tier drives the
// concurrent-training interference spacing (Wilson 2012, Coffey & Hawley 2017).

type RunEvent = Extract<PlanEvent, { kind: 'run' }>;

/** CR-10 effort anchors per run type, aligned to the app's expected-RPE bands (low 4.5 / med 6.5 / high 8.5). */
const RUN_DEFAULT_RPE: Record<RunType, number> = { recovery: 3, easy: 4.5, long: 5.5, tempo: 7, intervals: 8.5 };
const RUN_TYPE_TIER: Record<RunType, Intensity> = { recovery: 'low', easy: 'low', long: 'medium', tempo: 'high', intervals: 'high' };
const TIER_RANK: Record<Intensity, number> = { low: 0, medium: 1, high: 2 };
const strongerTier = (a: Intensity, b: Intensity): Intensity => (TIER_RANK[a] >= TIER_RANK[b] ? a : b);
const hasHr = (r: RunEvent): boolean => r.avgHr != null && r.maxHr != null && r.maxHr > r.avgHr;

/** Effective session-RPE for a run: the logged RPE if given, else derived from %HRmax, else the type default. */
export function runEffectiveRpe(r: RunEvent): number {
  if (r.rpe != null) return r.rpe;
  if (hasHr(r)) {
    // Map %HRmax onto the CR-10 scale: ~60%→3, 70%→5, 80%→7, 90%→8. Clamped to 1–10.
    const pct = (r.avgHr! / r.maxHr!) * 100;
    return Math.min(10, Math.max(1, Math.round((pct - 40) / 6)));
  }
  return RUN_DEFAULT_RPE[r.runType];
}

/** Intensity tier of a run from the strongest available signal: run type, %HRmax zone, and explicit RPE. */
export function runTier(r: RunEvent): Intensity {
  let tier = RUN_TYPE_TIER[r.runType];
  if (hasHr(r)) {
    const pct = r.avgHr! / r.maxHr!;
    tier = strongerTier(tier, pct < 0.72 ? 'low' : pct < 0.82 ? 'medium' : 'high');
  }
  if (r.rpe != null) tier = strongerTier(tier, r.rpe <= 5 ? 'low' : r.rpe <= 7 ? 'medium' : 'high');
  return tier;
}

export interface RunView {
  id: string;
  date: string;
  runType: RunType;
  durationMin: number;
  /** Effective session-RPE used for load. */
  rpe: number;
  tier: Intensity;
  distanceKm?: number;
  avgHr?: number | null;
  maxHr?: number | null;
  elevationGainM?: number;
  /** A hard or long run interferes with adjacent hard climbing/strength work. */
  interferes: boolean;
}

/** Materialize logged runs into scored views. Deterministic ids (`run-<date>-<idx>`) match materialization
 * and load so a run is never counted twice. Append-only, like adhoc sessions — each run is its own view. */
export function runViews(events: PlanEvent[]): RunView[] {
  const perDate = new Map<string, number>();
  const out: RunView[] = [];
  for (const e of events) {
    if (e.kind !== 'run') continue;
    const idx = perDate.get(e.date) ?? 0;
    perDate.set(e.date, idx + 1);
    const tier = runTier(e);
    out.push({
      id: `run-${e.date}-${idx}`,
      date: e.date,
      runType: e.runType,
      durationMin: e.durationMin,
      rpe: runEffectiveRpe(e),
      tier,
      distanceKm: e.distanceKm,
      avgHr: e.avgHr,
      maxHr: e.maxHr,
      elevationGainM: e.elevationGainM,
      // Peripheral fatigue from a long steady run interferes as much as a short hard one, so a long run
      // trips the spacing rule even at a moderate tier.
      interferes: tier === 'high' || e.durationMin >= 75,
    });
  }
  return out;
}

/** Current version of each imported activity: reprocessing appends a superseding event, so the last one per externalId wins. */
export function latestImports(events: PlanEvent[]): Extract<PlanEvent, { kind: 'imported-activity' }>[] {
  const byId = new Map<string, Extract<PlanEvent, { kind: 'imported-activity' }>>();
  for (const e of events) {
    if (e.kind === 'imported-activity') byId.set(e.externalId, e);
  }
  return [...byId.values()];
}

/** The current feedback for each session: editing appends a superseding event, so the LAST one per session wins.
 * Anything that aggregates feedback (load, RPE trends) must use this, never the raw event list, to avoid
 * counting a session's edits multiple times. */
export function latestFeedback(events: PlanEvent[]): Map<string, Extract<PlanEvent, { kind: 'feedback' }>> {
  const m = new Map<string, Extract<PlanEvent, { kind: 'feedback' }>>();
  for (const e of events) if (e.kind === 'feedback') m.set(e.sessionId, e);
  return m;
}

/** Dates the user actually trained: any completed session, an adhoc session, a logged run, or an imported activity. */
export function trainedDates(events: PlanEvent[]): Set<string> {
  const last = latestFeedback(events);
  const out = new Set<string>();
  for (const fb of last.values()) if (fb.completed) out.add(fb.date);
  for (const e of events) if (e.kind === 'adhoc-session' || e.kind === 'run') out.add(e.date);
  for (const e of latestImports(events)) out.add(e.date);
  return out;
}

/**
 * Training adherence over the most recent `weeks` fully-elapsed weeks. Instead of counting which planned cards got
 * a checkmark, it compares the number of days you INTENDED to train each week (available days, capped at the weekly
 * target) against the number of days you ACTUALLY trained — where "trained" credits any completed, substituted,
 * moved, adhoc, or imported session. So swapping a session to another day, or changing its type, never reads as a
 * miss; only a genuine weekly shortfall does. The current partial week is not judged yet.
 *
 * Two invariants hold: absence of a log is never a miss (only weeks you engaged with are judged, and a week's
 * shortfall is capped at the number of sessions you EXPLICITLY marked missed — so an unlogged-but-trained day is
 * never charged), and the window is a fixed count of whole weeks so thresholds don't drift with the day of week.
 */
export function weeklyAdherence(
  events: PlanEvent[],
  availability: Availability,
  planStart: string,
  today: string,
  weeklyTargetBase: number,
  weeks: number,
): Adherence {
  const trained = trainedDates(events);
  const lastFeedback = new Map<string, Extract<PlanEvent, { kind: 'feedback' }>>();
  for (const e of events) if (e.kind === 'feedback') lastFeedback.set(e.sessionId, e);
  const feedbackDates = new Set<string>();
  const missDates = new Set<string>();
  for (const fb of lastFeedback.values()) {
    feedbackDates.add(fb.date);
    if (!fb.completed) missDates.add(fb.date);
  }
  const availDaysInWeek = (weekStart: string): number => {
    let n = 0;
    for (let d = 0; d < 7; d++) if (availability.minutesByWeekday[weekdayOf(addDays(weekStart, d))] >= 30) n++;
    return n;
  };
  let plannedDays = 0;
  let completedDays = 0;
  let netMisses = 0;
  const lastElapsed = Math.floor(daysBetween(planStart, today) / 7) - 1;
  for (let w = Math.max(0, lastElapsed - weeks + 1); w <= lastElapsed; w++) {
    const weekStart = addDays(planStart, w * 7);
    const weekDates = Array.from({ length: 7 }, (_, d) => addDays(weekStart, d));
    const engaged = weekDates.some((d) => trained.has(d) || feedbackDates.has(d));
    if (!engaged) continue; // didn't log or train at all that week → not judged (silence ≠ a miss)
    const cap = phaseForWeek(w) === 'deload' ? Math.min(weeklyTargetBase, 4) : weeklyTargetBase;
    const target = Math.min(availDaysInWeek(weekStart), cap);
    const trainedThisWeek = weekDates.filter((d) => trained.has(d)).length;
    const explicitMissCount = weekDates.filter((d) => missDates.has(d)).length;
    plannedDays += target;
    completedDays += Math.min(trainedThisWeek, target);
    // Charge at most one miss per session you actually marked missed, so an unlogged-but-trained day is
    // never swept in just because the week also had an explicit miss.
    netMisses += Math.min(explicitMissCount, Math.max(0, target - trainedThisWeek));
  }
  return { plannedDays, completedDays, netMisses };
}

/** Actual trained minutes per date from watch imports; the longest activity wins when a date has several. */
export function importedMinutesByDate(events: PlanEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of latestImports(events)) {
    out.set(e.date, Math.max(out.get(e.date) ?? 0, e.durationMin));
  }
  return out;
}

function computeLoad(events: PlanEvent[], sessions: Map<string, Session>, today: string, planStart: string): LoadStatus {
  let acute = 0;
  let chronic = 0;
  const imported = importedMinutesByDate(events);
  const feedback = latestFeedback(events);
  for (const e of feedback.values()) {
    if (!e.completed || e.rpe === null) continue;
    const s = sessions.get(e.sessionId);
    const load = e.rpe * (imported.get(e.date) ?? (s ? s.durationMin : 60));
    const age = daysBetween(e.date, today);
    if (age >= 0 && age < 7) acute += load;
    if (age >= 0 && age < 28) chronic += load;
  }
  // Runs carry their own session-RPE load. Skip a run only when its own feedback ALREADY contributed load
  // above (completed with an RPE) — that lets a subjective RPE override the estimate without double-counting.
  // A missed/incomplete feedback contributes nothing, so the run still happened and keeps its estimated load.
  for (const r of runViews(events)) {
    const fb = feedback.get(r.id);
    if (fb && fb.completed && fb.rpe !== null) continue;
    const load = r.rpe * r.durationMin;
    const age = daysBetween(r.date, today);
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
    // Elbow/shoulder pain rules out ALL high-intensity work — limit bouldering and power endurance
    // are heavy pulling too, not acceptable substitutes for a blocked board or strength session.
    if (pain.upperLimb && tmpl.intensity === 'high') return false;
    if (phase === 'deload' && tmpl.intensity === 'high') return false;
    const highCount = picked.filter((p) => TEMPLATES[p].intensity === 'high').length;
    if (tmpl.intensity === 'high' && highCount >= Math.min(3, Math.ceil(slots / 2))) return false;
    const fingerCount = picked.filter((p) => TEMPLATES[p].fingerLoad && TEMPLATES[p].intensity === 'high').length;
    if (tmpl.fingerLoad && tmpl.intensity === 'high' && fingerCount >= 2) return false;
    if (count(t) >= 2) return false;
    picked.push(t);
    return true;
  };

  if (pain.finger)
    notices.push(`Finger/wrist pain reported: finger-loading sessions replaced with low-load work until ${pain.fingerUntil}.`);
  if (pain.upperLimb)
    notices.push(`Elbow/shoulder pain reported: high-intensity and heavy pulling replaced with lighter work until ${pain.upperUntil}.`);

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

export function generatePlan(state: UserState, today: string, internal?: { skipPainDiff?: boolean }): Plan {
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

  // Adherence-based miss accounting: intended vs actually-trained days per week, so day-swaps and
  // type-changes don't register as misses. Measured against the unpenalized base target.
  const targetBase = Math.max(2, Math.min(6, cfg.assessment.weeklySessionsHistorical + 1));
  const adherence = weeklyAdherence(state.events, availability, config.planStart, today, targetBase, 4);
  const netMisses3wk = weeklyAdherence(state.events, availability, config.planStart, today, targetBase, 3).netMisses;

  const learned = learnProfile(state.events, today, netMisses3wk);
  notices.push(...learned.rationale);
  const priorFingerInjury = config.assessment.injuryHistory.includes('finger') || config.assessment.injuryHistory.includes('wrist');
  const fingerGap = priorFingerInjury ? 3 : learned.fingerGapDays;
  if (priorFingerInjury && learned.fingerGapDays < 3) {
    notices.push('Past finger/wrist injury: hard finger sessions are kept 72h apart.');
  }

  const start = config.planStart;
  const endDay = daysBetween(start, today) + HORIZON_DAYS;
  const horizonEnd = addDays(today, HORIZON_DAYS);
  for (const w of cfg.travel ?? []) {
    if (w.to >= today && w.from <= horizonEnd) {
      const range = w.from === w.to ? w.from : `${w.from}–${w.to}`;
      notices.push(`${w.label ? w.label + ' — ' : 'Traveling '}${range}: sessions on those days use the equipment you selected.`);
    }
  }
  const sessions: Session[] = [];
  const adhocEvents = state.events.filter((e): e is Extract<PlanEvent, { kind: 'adhoc-session' }> => e.kind === 'adhoc-session');
  // Anchors for the hard-finger spacing rule: prior sessions plus any unplanned hard finger work the user logged.
  const hardFingerAnchors: string[] = [];
  if (cfg.assessment.lastHardSessionDate) hardFingerAnchors.push(cfg.assessment.lastHardSessionDate);
  for (const e of adhocEvents) {
    if (TEMPLATES[e.type].fingerLoad && TEMPLATES[e.type].intensity === 'high') hardFingerAnchors.push(e.date);
  }

  const weeklyCap = Math.max(2, Math.min(6, cfg.assessment.weeklySessionsHistorical + 1 + learned.capDelta));
  const totalWeeks = Math.ceil(endDay / 7) + 1;
  for (let w = 0; w < totalWeeks; w++) {
    const phase = phaseForWeek(w);
    const weekStart = addDays(start, w * 7);
    const days: string[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (availabilityForDate(cfg, date).minutesByWeekday[weekdayOf(date)] >= 30) days.push(date);
    }
    const painActive: RecentPain =
      daysBetween(today, weekStart) <= 7 ? pain : { finger: false, upperLimb: false, fingerUntil: null, upperUntil: null };
    const slots = Math.min(days.length, phase === 'deload' ? Math.min(weeklyCap, 4) : weeklyCap);
    const scheduledDays = Array.from({ length: slots }, (_, i) => days[Math.floor((i * days.length) / slots)]);
    // Pick the week's session types against the equipment on a representative training day, so a travel week
    // draws from what you'll actually have rather than home gear it would only swap away.
    const selEquip = equipmentForDate(cfg, scheduledDays[Math.floor(scheduledDays.length / 2)] ?? weekStart);
    const weekCfg: Config = { ...cfg, equipment: selEquip };
    const types = orderForSpacing(
      weeklySessionTypes(weekCfg, slots, phase, painActive, w === Math.floor(daysBetween(start, today) / 7) ? notices : []),
    );

    types.forEach((type, slot) => {
      const date = scheduledDays[slot];
      if (!date) return;
      const tmpl = TEMPLATES[type];
      const warnings: string[] = [];
      let effectiveType = type;
      if (tmpl.fingerLoad && tmpl.intensity === 'high') {
        const tooClose = hardFingerAnchors.some((a) => {
          const d = daysBetween(a, date);
          return d >= 0 && d < fingerGap;
        });
        if (tooClose) {
          effectiveType = 'technique';
          warnings.push('Swapped to technique: hard finger sessions need 48h apart.');
        } else {
          hardFingerAnchors.push(date);
        }
      }
      // Honor the equipment actually available on this date (travel windows override home gear).
      const dayEquip = equipmentForDate(cfg, date);
      const fitted = fitToEquipment(effectiveType, dayEquip, cfg);
      if (fitted !== effectiveType) {
        warnings.push(`Limited equipment on this day — ${TEMPLATES[fitted].title} instead of ${TEMPLATES[effectiveType].title}.`);
        effectiveType = fitted;
      }
      const t = TEMPLATES[effectiveType];
      const budget = availabilityForDate(cfg, date).minutesByWeekday[weekdayOf(date)];
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

  // Materialize unplanned sessions as real plan sessions (feedback, drills, and load attach to them normally).
  const perDate = new Map<string, number>();
  for (const e of adhocEvents) {
    const idx = perDate.get(e.date) ?? 0;
    perDate.set(e.date, idx + 1);
    const week = Math.max(0, Math.floor(daysBetween(start, e.date) / 7));
    const t = TEMPLATES[e.type];
    sessions.push({
      id: `adhoc-${e.date}-${idx}`,
      date: e.date,
      type: e.type,
      title: t.title,
      intensity: t.intensity,
      durationMin: e.durationMin ?? t.baseDurationMin,
      focus: t.focus,
      exercises: t.exercises(phaseForWeek(week), cfg.assessment.maxBoulderGrade),
      weekPhase: phaseForWeek(week),
      warnings: ['Added by you on a rest day.'],
      hints: [],
    });
  }

  // Materialize logged runs as visible cards. They render like any session but are never auto-scheduled and
  // never anchor the finger-spacing rule (running does not load fingers). Their intensity is the scored tier.
  const runLabel: Record<RunType, string> = {
    recovery: 'recovery run',
    easy: 'easy run',
    long: 'long run',
    tempo: 'tempo run',
    intervals: 'interval run',
  };
  for (const r of runViews(state.events)) {
    const week = Math.max(0, Math.floor(daysBetween(start, r.date) / 7));
    const bits = [`${r.durationMin} min`];
    if (r.distanceKm != null) bits.push(`${r.distanceKm} km`);
    if (r.avgHr != null) bits.push(`avg HR ${r.avgHr}`);
    if (r.elevationGainM != null && r.elevationGainM > 0) bits.push(`↑ ${r.elevationGainM} m`);
    const detail = bits.join(' · ');
    const pace = r.distanceKm && r.distanceKm > 0 ? `${(r.durationMin / r.distanceKm).toFixed(1)} min/km` : undefined;
    sessions.push({
      id: r.id,
      date: r.date,
      type: 'run',
      title: `Run — ${runLabel[r.runType]}`,
      intensity: r.tier,
      durationMin: r.durationMin,
      focus: `Aerobic cross-training · ${detail}`,
      exercises: [{ name: 'Run', detail, sets: pace }],
      weekPhase: phaseForWeek(week),
      warnings: [],
      hints: [],
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
  // Recalculate around unplanned sessions: keep neighboring hard days honest and the week within its cap.
  for (const a of sessions.filter((s) => s.id.startsWith('adhoc-'))) {
    if (a.intensity === 'high') {
      for (const s of sessions) {
        if (s.id.startsWith('adhoc-') || lastFeedback.has(s.id)) continue;
        if (daysBetween(today, s.date) < 0 || s.intensity !== 'high') continue;
        if (Math.abs(daysBetween(a.date, s.date)) === 1) {
          s.intensity = 'medium';
          s.warnings.push(`Unplanned hard session on ${a.date} next door — keep this one sub-maximal.`);
        }
      }
    }
    const week = Math.floor(daysBetween(start, a.date) / 7);
    const weekSessions = sessions.filter((s) => Math.floor(daysBetween(start, s.date) / 7) === week);
    if (weekSessions.length > weeklyCap) {
      const drop = weekSessions
        .filter((s) => !s.id.startsWith('adhoc-') && daysBetween(today, s.date) > 0 && !lastFeedback.has(s.id) && s.intensity !== 'high')
        .sort((x, y) => x.date.localeCompare(y.date))
        .pop();
      if (drop) {
        sessions.splice(sessions.indexOf(drop), 1);
        byId.delete(drop.id);
        notices.push(
          `You added a session on ${a.date}: ${drop.title} on ${drop.date} was removed to keep the week at ${weeklyCap} sessions.`,
        );
      }
    }
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
      // Logged runs are historical facts, never reschedulable by the recovery pass.
      .filter((o) => daysBetween(today, o.date) >= 0 && !lastFeedback.has(o.id) && o.type !== 'run')
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
      // Never overwrite a logged run with a recovered climbing session.
      const target = onDate.find((o) => o.type !== missedSession.type && o.type !== 'run');
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

  // Concurrent-training interference: a hard or long run within a day of a hard climbing/strength session
  // degrades both adaptations (AMPK/mTOR signaling conflict). Dial the neighboring upcoming hard session down
  // and flag it. Running never loads fingers, so this only touches intensity spacing, never the finger rule.
  // Runs last so sessions the recovery pass inserted, moved, or re-typed next to a run are dialed too.
  for (const r of sessions.filter((s) => s.type === 'run')) {
    const view = runViews(state.events).find((v) => v.id === r.id);
    if (!view?.interferes) continue;
    let dialed = false;
    for (const s of sessions) {
      if (s.type === 'run' || lastFeedback.has(s.id)) continue;
      if (s.intensity !== 'high' || daysBetween(today, s.date) < 0) continue;
      if (Math.abs(daysBetween(r.date, s.date)) <= 1) {
        s.intensity = 'medium';
        s.warnings.push(
          `Hard/long run on ${r.date} within a day — concurrent-training interference; keep this sub-maximal or move it a day.`,
        );
        dialed = true;
      }
    }
    if (dialed) r.hints.push('Nearby hard climbing was kept sub-maximal to limit interference with this run.');
  }

  const load = computeLoad(state.events, byId, today, start);
  if (load.capped) {
    notices.push('Training load rose quickly (acute:chronic > 1.3). High-intensity sessions this week are capped at moderate effort.');
    for (const s of sessions) {
      const age = daysBetween(today, s.date);
      if (s.type !== 'run' && age >= 0 && age < 7 && s.intensity === 'high') {
        s.intensity = 'medium';
        s.warnings.push('Intensity reduced this week to manage load spike.');
      }
    }
  }

  if (learned.todayReadiness === 1) {
    for (const s of sessions) {
      if (s.type !== 'run' && s.date === today && s.intensity === 'high') {
        s.intensity = 'medium';
        s.warnings.push('You reported feeling heavy today: keep this session sub-maximal.');
      }
    }
    notices.push("Feeling heavy today: today's intensity is dialed back. Quality over load.");
  }

  const EXPECTED_RPE: Record<string, number> = { high: 8.5, medium: 6.5, low: 4.5 };
  const rpeByType = new Map<string, number[]>();
  // Latest feedback per session, so an edited/re-logged session counts once — never inflates the average.
  for (const e of latestFeedback(state.events).values()) {
    if (!e.completed || e.rpe === null) continue;
    if (daysBetween(e.date, today) > 45 || daysBetween(e.date, today) < 0) continue;
    const s = byId.get(e.sessionId);
    if (!s) continue;
    const doneType = e.actualType ?? s.type;
    if (doneType === 'run') continue; // runs are scored on their own scale — no climbing-style progression hints
    const arr = rpeByType.get(doneType) ?? [];
    arr.push(e.rpe);
    rpeByType.set(doneType, arr);
  }
  for (const [type, arr] of rpeByType) {
    if (arr.length < 3) continue;
    const intensity = TEMPLATES[type as SessionType].intensity;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const expected = EXPECTED_RPE[intensity];
    let hint: string | null = null;
    // Low-intensity sessions (aerobic, mobility, technique) are meant to stay easy — never tell the user to
    // push those harder; only warn if they are running them too hot.
    if (mean <= expected - 1.5 && intensity !== 'low') {
      hint = `Your last ${arr.length} ${TEMPLATES[type as SessionType].title} sessions averaged RPE ${mean.toFixed(1)} (target ~${expected}). Progress the difficulty: harder problems, more load, or smaller edges.`;
    } else if (mean >= expected + 1) {
      hint = `Your last ${arr.length} ${TEMPLATES[type as SessionType].title} sessions averaged RPE ${mean.toFixed(1)} (target ~${expected}). Back off slightly so quality stays high.`;
    }
    if (!hint) continue;
    for (const s of sessions) {
      if (s.type === type && daysBetween(today, s.date) >= 0) s.hints.push(hint);
    }
  }

  // Only flag a real training shortfall (days short of intent, crediting swaps/substitutions/adhoc), not raw misses.
  const recentShortfall = weeklyAdherence(state.events, availability, config.planStart, today, targetBase, 2).netMisses;
  if (recentShortfall >= 2) {
    notices.push(
      'You trained fewer days than planned over the last couple of weeks — moving or swapping sessions is fine, but if this is the new normal, update your availability so the plan matches real life.',
    );
  }

  // Transparency: the plan is deterministic, so we can compute the counterfactual no-pain plan and
  // tag exactly which upcoming sessions the pain restrictions changed.
  if ((pain.finger || pain.upperLimb) && !internal?.skipPainDiff) {
    const strippedEvents = state.events.map((e) => (e.kind === 'feedback' && e.pain ? { ...e, pain: null } : e));
    const baseline = new Map(
      generatePlan({ ...state, events: strippedEvents }, today, { skipPainDiff: true }).sessions.map((s) => [s.id, s]),
    );
    const until = [pain.fingerUntil, pain.upperUntil].filter(Boolean).sort().pop();
    for (const s of sessions) {
      if (daysBetween(today, s.date) < 0) continue;
      const b = baseline.get(s.id);
      if (b && b.type !== s.type) {
        s.warnings.push(`Swapped from ${TEMPLATES[b.type].title} — pain restrictions until ${until}.`);
      }
    }
  }

  // Adhoc sessions and logged runs are always visible regardless of the window — retro-logged activity may be months back.
  const visible = sessions
    .filter(
      (s) =>
        (daysBetween(today, s.date) >= -28 && daysBetween(today, s.date) < HORIZON_DAYS) ||
        s.id.startsWith('adhoc-') ||
        s.id.startsWith('run-'),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    generatedFor: today,
    phaseByWeek: Array.from({ length: totalWeeks }, (_, w) => phaseForWeek(w)),
    sessions: visible,
    loadStatus: load,
    notices,
    goal: cfg.goal,
    availability: cfg.availability,
    adherence,
  };
}

/**
 * Recommends the highest-value session to slot onto an otherwise-empty day, using the planner's own weakness
 * ranking and safety rules (equipment/grade gates, pain restrictions, 48/72h finger spacing, no adjacent hard
 * days). Prefers a priority session the week is short on; falls back to a safe low-intensity option. Never throws
 * — mobility/prehab always fits — so the "plan a session" flow always has something to propose.
 */
export function recommendSessionFor(state: UserState, today: string, date: string): SessionType {
  const plan = generatePlan(state, today);
  // A logged run on the date is not a planned climbing session — don't echo it back as the recommendation.
  const existing = plan.sessions.find((s) => s.date === date && !s.id.startsWith('adhoc-') && s.type !== 'run');
  if (existing) return existing.type;

  const { config } = state;
  let availability = config.availability;
  let goal = config.goal;
  for (const e of state.events) {
    if (e.kind === 'availability' && e.date <= today) availability = e.availability;
    if (e.kind === 'goal' && e.date <= today) goal = e.goal;
  }
  const cfg: Config = { ...config, goal, availability };
  const targetBase = Math.max(2, Math.min(6, cfg.assessment.weeklySessionsHistorical + 1));
  const learned = learnProfile(
    state.events,
    today,
    weeklyAdherence(state.events, availability, config.planStart, today, targetBase, 3).netMisses,
  );
  const weeklyCap = Math.max(2, Math.min(6, cfg.assessment.weeklySessionsHistorical + 1 + learned.capDelta));
  const week = Math.max(0, Math.floor(daysBetween(config.planStart, date) / 7));
  const phase = phaseForWeek(week);
  const priorFingerInjury = config.assessment.injuryHistory.includes('finger') || config.assessment.injuryHistory.includes('wrist');
  const fingerGap = priorFingerInjury ? 3 : learned.fingerGapDays;
  const pain = recentPain(state.events, today);
  const painActive = daysBetween(today, date) <= 7 ? pain : { finger: false, upperLimb: false, fingerUntil: null, upperUntil: null };

  // Recommend against the equipment actually available that day (travel windows override home gear).
  const dayEquip = equipmentForDate(cfg, date);
  const ideal = weeklySessionTypes({ ...cfg, equipment: dayEquip }, weeklyCap, phase, painActive, []);

  // Types already covered this week by a completed or still-planned session (missed ones stay eligible).
  const lastCompleted = new Map<string, boolean>();
  for (const e of state.events) if (e.kind === 'feedback') lastCompleted.set(e.sessionId, e.completed);
  const weekStart = addDays(config.planStart, week * 7);
  const covered = new Set<SessionType>();
  for (const s of plan.sessions) {
    if (s.date < weekStart || daysBetween(weekStart, s.date) >= 7 || s.date === date) continue;
    if (lastCompleted.get(s.id) === false) continue; // missed → still worth recommending
    covered.add(s.type);
  }

  const fits = (t: SessionType): boolean => {
    const tmpl = TEMPLATES[t];
    if (!templateAllowed(t, cfg, dayEquip)) return false;
    if (painActive.finger && tmpl.fingerLoad) return false;
    if (painActive.upperLimb && tmpl.intensity === 'high') return false;
    if (phase === 'deload' && tmpl.intensity === 'high') return false;
    if (
      tmpl.fingerLoad &&
      tmpl.intensity === 'high' &&
      plan.sessions.some(
        (o) =>
          o.date !== date &&
          TEMPLATES[o.type].fingerLoad &&
          TEMPLATES[o.type].intensity === 'high' &&
          Math.abs(daysBetween(o.date, date)) < fingerGap,
      )
    )
      return false;
    if (
      tmpl.intensity === 'high' &&
      plan.sessions.some((o) => o.date !== date && TEMPLATES[o.type].intensity === 'high' && Math.abs(daysBetween(o.date, date)) <= 1)
    )
      return false;
    return true;
  };

  for (const t of ideal) if (!covered.has(t) && fits(t)) return t;
  for (const t of ideal) if (fits(t)) return t;
  for (const t of ['technique', 'aerobic-capacity', 'mobility-prehab'] as SessionType[]) if (fits(t)) return t;
  return 'mobility-prehab';
}
