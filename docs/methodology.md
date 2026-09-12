# Climb Plan — planning methodology

This is the knowledge base for **how and why** the engine builds a plan. Implementation lives in `packages/engine`; this doc is the human-readable contract. When planning behavior changes, update this file in the same PR.

The plan is a **pure function** of config + an append-only event log + an explicit `today` date. Same inputs ⇒ same plan. No LLMs, no randomness, no hidden clocks.

## Inputs

| Input        | Role                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Assessment   | Max/flash grade, finger %BW, pull strength, experience, injury history, recent session rate                                |
| Goal         | Grade target or skill focus — weights which qualities get priority                                                         |
| Availability | Minutes by weekday (0 = rest). Travel windows can override gear and/or minutes                                             |
| Equipment    | Gym, hangboard, board, weights, pull-up bar — gates templates                                                              |
| Event log    | Feedback (RPE, pain, completion, actual type), readiness, moves, ad‑hoc sessions, runs, imports, goal/availability changes |

## Periodization

Weeks cycle **base → build → peak → deload** (`phaseForWeek`).

- **Base / build / peak:** normal selection and intensity.
- **Deload:** volume scaled to ~60%, high-intensity templates blocked or downgraded, weekly slot count capped lower.

The weekly session budget starts from historical frequency (+1, clamped 2–6) and is then adapted by learning (below).

## Session selection

For each week the engine:

1. Lists available days (≥30 minutes).
2. Picks session types via `weeklySessionTypes`: prefer limit bouldering, then weakness-driven qualities from `rankWeaknesses` / `QUALITY_SESSIONS`, then fillers (volume, technique, aerobic, mobility, submax hangs).
3. Applies gates: equipment, min grade/experience, pain bans, deload bans, max high-intensity and hard-finger counts per week.
4. Places types onto days with **safety spacing** (next section).
5. Fits each day to that day’s equipment (travel overrides).

Weaknesses compare finger and pull numbers to grade benchmarks, then fold in self-ratings and goal weights (`assessment.ts`).

## Safety invariants (never weaken these)

| Rule                | Behavior                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hard finger spacing | Hard finger-loading sessions ≥ **48h** apart by default; **72h** after recent finger/wrist pain, high recent RPE, repeated “heavy” readiness, or finger/wrist injury history                          |
| Pain substitution   | Pain severity ≥2 lasting 14 days from the report: finger/wrist ⇒ no finger-loading work; elbow/shoulder ⇒ no high-intensity work. Swapped sessions are tagged against the counterfactual no-pain plan |
| Adjacent hard days  | High-intensity sessions are not placed on consecutive days when avoidable                                                                                                                             |
| Load spike (ACWR)   | Session-RPE load (RPE × minutes; watch minutes when present). If acute:chronic **> 1.3**, upcoming high-intensity climbing is capped to moderate                                                      |
| Readiness           | “Heavy” today (level 1) dials today’s high-intensity climbing down                                                                                                                                    |
| Runs                | Scored cross-training; can interfere with nearby hard climbing intensity; **never** count as finger-loading anchors                                                                                   |

## Missed sessions and adherence

- A **miss** is an explicit incomplete feedback (or a hard session logged as an easy type). Silent non-logging is **not** a miss.
- Day swaps, type changes, ad‑hoc sessions, and imports can **credit** adherence so the weekly shortfall stays honest.
- Recent hard misses try to **reschedule** onto the next few days (shift later work or replace an easier slot), preserving finger/intensity spacing.
- Large multi-week shortfall ⇒ weekly cap **−1**; a clean, comfortable block ⇒ cap **+1** (`learn.ts`).

## Adaptation (`learn.ts`)

| Signal                                       | Effect           |
| -------------------------------------------- | ---------------- |
| Finger/wrist pain in last 28 days            | Finger gap → 72h |
| Mean recent RPE well above personal baseline | Finger gap → 72h |
| ≥3 “heavy” readiness days in 14 days         | Finger gap → 72h |
| ≥3 net missed days over 3 weeks              | Weekly cap −1    |
| Hitting target at easy RPE with no shortfall | Weekly cap +1    |

## Notices (user-visible explanations)

Notices are **composed**, not naively appended (`notices.ts`). Overlapping recovery themes — active pain, widened finger spacing, missed-session recovery, reduced weekly volume, “feeling heavy” — collapse into **one recovery narrative** when several apply. Travel, week-trim, load-spike, and clean-block progression notices stay separate.

If you change a planning rule, ask: does the notice text still explain the _actual_ plan change without repeating the same intent?

## Where to edit

| Concern                                 | File            |
| --------------------------------------- | --------------- |
| Session content / gates                 | `templates.ts`  |
| Weakness ranking / goal mapping         | `assessment.ts` |
| Scheduling, spacing, misses, load, runs | `generate.ts`   |
| Cap / finger-gap adaptation             | `learn.ts`      |
| Notice copy / coalescing                | `notices.ts`    |
| History stats                           | `metrics.ts`    |

## Keeping this doc honest

Every PR that changes prescription behavior must update this file (and any examples/tests that encode the old rule). See `AGENTS.md` and `.cursor/rules/knowledge-base.mdc`.
