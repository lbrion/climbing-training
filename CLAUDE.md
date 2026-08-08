# Climb Plan — contributor guide

Mobile-first PWA that generates deterministic bouldering training plans. No LLMs, no randomness: the plan is a pure function of the user's config plus an append-only event log. Read this before changing anything — it tells you where each kind of change belongs.

## Commands

```sh
npm install
npm run dev          # server on :3000 (serves built web app if web/dist exists)
npm run dev -w web   # vite dev server on :5173, proxies /api to :3000
npm test             # engine unit tests (vitest)
npm run typecheck    # tsc --noEmit in all three workspaces
npm run lint         # eslint
npm run format       # prettier --write
npm run check        # typecheck + lint + format:check + test (what CI runs)
npm run build        # engine → web → server
```

CI (`.github/workflows/ci.yml`) runs `check` + `build` on every PR and push to `main`. Railway redeploys `main` on push via the `Dockerfile`.

## Architecture in one paragraph

`packages/engine` is pure TypeScript with zero runtime dependencies — all planning logic lives there. `server` is a thin Express + SQLite shell: it stores one user's config and an append-only event log, validates input with zod, and calls the engine on every request (plans are recomputed, never stored). `web` is a Vite React PWA that renders the plan and posts events. State flows one way: UI action → POST event → server appends to log → engine regenerates plan from scratch → full new state returned to the UI.

## Where code lives — "to change X, edit Y"

### Training logic (all in `packages/engine/src/`, and only there)

| To change…                                                                                                                                                       | Edit                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session content: exercises, sets, durations, titles, equipment/grade/experience gates, whether a session loads fingers                                           | `templates.ts` — one `Template` per `SessionType`                                                                                                                                                |
| Add a session type                                                                                                                                               | `types.ts` (`SessionType` union) → `templates.ts` (new entry) → `assessment.ts` (`QUALITY_SESSIONS` if it trains a quality) → server `eventSchema`/`configSchema` enums in `server/src/index.ts` |
| Strength benchmarks, weakness ranking, goal → session mapping                                                                                                    | `assessment.ts`                                                                                                                                                                                  |
| Scheduling: periodization, weekly session selection, safety spacing (48/72h finger rule), deload, missed-session recovery, moves, load capping (ACWR), RPE hints | `generate.ts` — the core; almost every planning rule ends up here                                                                                                                                |
| Adaptation from the event log: finger-gap widening, weekly cap ±1, readiness handling                                                                            | `learn.ts`                                                                                                                                                                                       |
| History/stats shown in the History view (PRs, completion %, weekly load bars)                                                                                    | `metrics.ts`                                                                                                                                                                                     |
| Shared data shapes (`Config`, `Session`, `PlanEvent`, `Plan`…)                                                                                                   | `types.ts` — the single source of truth for types across all three workspaces                                                                                                                    |

**Engine rules (hard constraints):**

- Keep it pure: no I/O, no React/Express/DB imports, no `Date.now()` or `new Date()` without an explicit date argument. "Today" is always passed in as an ISO `YYYY-MM-DD` string. Same inputs must always produce the same plan.
- Every behavior change needs a test in `generate.test.ts`. Tests construct a `UserState` and assert on the generated plan — follow the existing patterns.
- Safety rules (finger spacing, pain substitution, intensity caps) are invariants, not preferences. Never weaken one to make another feature work; the tests encode them.

### API and persistence (`server/src/index.ts` — deliberately a single file)

| To change…                         | Edit                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add/modify an endpoint             | `server/src/index.ts` route handlers                                                                                                                             |
| Accept a new event or config field | zod `eventSchema` / `configSchema` in the same file — **zod at the boundary is mandatory**; the engine trusts its inputs, so validation lives here and only here |
| Storage                            | the `db.exec` schema at the top; two tables: `users` (config JSON) and `events` (append-only payload JSON)                                                       |

**Server rules:**

- Events are append-only. Never UPDATE or DELETE event rows to implement a feature — corrections are new events (e.g. re-submitting feedback for a session supersedes the old one because the engine takes the _last_ feedback per session).
- Every mutating endpoint responds with the full recomputed `AppState` (config + plan + metrics + events) so the UI can replace its state wholesale.
- Keep it one file until it genuinely hurts (~300+ lines); if you split, split into `db.ts` / `schemas.ts` / `routes.ts`.

### UI (`web/src/`)

| To change…                                                      | Edit                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Screen routing, top bar, service-worker registration            | `App.tsx`                                                                                          |
| Plan list / calendar views, session cards, quick-miss           | `Plan.tsx`                                                                                         |
| Session detail sheet: feedback form, RPE, pain, move/reschedule | `SessionSheet.tsx`                                                                                 |
| Assessment/settings wizard                                      | `Setup.tsx`                                                                                        |
| History view: stats, past sessions, retro-logging               | `History.tsx`                                                                                      |
| Server communication and the `AppState` shape                   | `api.ts` — all fetches go through here; components never call `fetch` directly                     |
| All styling                                                     | `styles.css` — plain CSS, class-based, no CSS-in-JS or frameworks; dark theme variables at the top |
| PWA manifest, service-worker caching, dev proxy, `__BUILD_ID__` | `web/vite.config.ts`                                                                               |

**Web rules:**

- No client-side business logic. The UI renders what the engine returned and posts events; if you're tempted to compute planning logic in a component, it belongs in `packages/engine` (the web app imports engine types and `TEMPLATES` for display only).
- State is a single `AppState` at the top of `App.tsx`, replaced wholesale from API responses. No state libraries.
- Mobile-first: everything must work as an installed PWA on a phone; test interactions with touch in mind.
- Dates in the UI use the browser's local timezone (`localToday()` in `api.ts`); the engine treats dates as opaque ISO strings.

### Build and deploy

| To change…                      | Edit                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| Node version                    | `.nvmrc` + both `FROM node:` lines in `Dockerfile`                      |
| Docker build / production image | `Dockerfile` (multi-stage; server serves `web/dist` statically)         |
| Railway settings                | `railway.json` (SQLite lives on a volume at `/data`, `DB_PATH` env var) |
| CI                              | `.github/workflows/ci.yml`                                              |
| Formatting / lint rules         | `.prettierrc.json` / `eslint.config.mjs`                                |

## Cross-cutting recipes

**Adding a new event kind** (the most common non-trivial change) — touch all four layers, in this order:

1. `packages/engine/src/types.ts`: add the variant to `PlanEvent`.
2. `packages/engine/src/generate.ts` (and/or `learn.ts`): make the plan react to it; add a test in `generate.test.ts`.
3. `server/src/index.ts`: add the variant to `eventSchema`.
4. `web/src/`: emit it via `api.event(...)` from the relevant component.

**Adding a config field**: `types.ts` (`Config`) → engine usage + test → `configSchema` in the server → `Setup.tsx` wizard step + `defaults`.

## Conventions

- TypeScript strict everywhere; ESM with explicit `.js` extensions on relative imports (bundler resolution, `type: "module"`).
- Prettier owns formatting (140 cols, single quotes) — run `npm run format`, don't hand-format.
- Dates are ISO `YYYY-MM-DD` strings everywhere; use `addDays`/`daysBetween` from `generate.ts`, don't do Date math inline.
- V-grades are plain numbers (0–17) typed as `VGrade`.
- No new runtime dependencies in `packages/engine`, ever. Be reluctant elsewhere — the whole app currently needs only express, better-sqlite3, zod, react.
