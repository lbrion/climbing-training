# Climb Plan

A mobile-first PWA that generates and adapts bouldering training plans **deterministically** — and a working example of a codebase built end-to-end with agentic workflows.

Two ideas define the project:

1. **No AI at runtime.** The plan is a pure function of an assessment, a goal, weekly availability, equipment, and an append-only event log. Same inputs, same plan, every time — no LLM calls, no randomness, nothing to prompt. Training advice you can trust is advice you can reproduce.
2. **AI all over the build.** The app is developed with Claude Code driving multi-step changes autonomously — designing features, writing tests, verifying them in a real browser, and shipping to production. The repository is deliberately structured so that an agent (or a new human) can make correct changes fast.

## Why the architecture is interesting

**Functional core, imperative shell.** All planning logic lives in `packages/engine`: pure TypeScript, zero runtime dependencies, no I/O, no clock access — "today" is always an explicit argument. The Express + SQLite server is a thin shell that stores one user's config plus an event log and calls the engine on every request. Plans are **recomputed, never stored**: there is no cached plan to migrate or patch when logic changes, and determinism makes every behavior testable with plain input/output assertions.

**Event sourcing, for real.** Every user action — session feedback (RPE, pain, sends), moves, goal changes, watch imports — is an append-only event. Corrections are new events that supersede old ones; nothing is ever updated or deleted. The current plan is a fold over the whole history, which means features like "re-parse old watch files with a better parser" are one superseding event away, with full audit trail for free.

**Safety rules as invariants.** Hard finger sessions are forced ≥48h apart (72h after pain or injury history), max-hangboarding is gated on experience, a rising acute:chronic workload ratio (>1.3) caps the coming week's intensity, and pain reports substitute finger-loading work for 14 days. These are encoded as tests, not comments — the test suite is the contract that adaptive features can't quietly weaken a safety rule.

**Reverse-engineered watch integration.** Sessions recorded on a COROS watch import via FIT file. Beyond the documented fields (HR stream, climb/rest splits), the parser decodes **undocumented vendor fields** — per-climb send/attempt outcomes and per-climb heart rate — mapped empirically by diffing real files against the COROS app's own charts until the positions matched climb-for-climb. Real durations replace planned estimates in the load model; the session view renders the HR trace with outcome-colored climb segments in dependency-free inline SVG.

## Built with agentic workflows

This repo is a live experiment in letting agents do real engineering, with the guardrails that make that safe:

- **`CLAUDE.md` as the agent's map.** A maintained "to change X, edit Y" guide encodes the architecture rules (pure engine, zod at the boundary, append-only events), cross-cutting recipes (adding an event kind touches four layers, in order), and the project's conventions. Sessions start correct instead of rediscovering the design.
- **Verification before every ship.** Agent sessions run the same gate as CI — typecheck, lint, format, unit tests — and additionally drive the built app headlessly (Playwright) to screenshot and assert on real UI behavior before pushing. Every push to `main` deploys to production, so the discipline is not optional.
- **Ground-truth over guesswork.** The COROS field decoding was agent-led: hypothesize field semantics, test against the user's actual session data, accept only exact matches (7 sends at minutes 0/1/4/24/30/36/93 — position-for-position against the vendor app).
- **MCP integrations at the edges.** GitHub and Railway are driven through Model Context Protocol connectors; the event API is shaped so external feeds (e.g. an MCP-based courier pulling cloud workout data) submit through the same validated, append-only boundary as the UI.

The commit history is the artifact: feature-sized commits with design rationale, each verified end-to-end before landing.

## Repository map

```
packages/engine/src/
  types.ts       shared data shapes (Config, Session, PlanEvent, Plan) — source of truth
  templates.ts   session content: exercises, rest guidance, per-type overviews, gates
  assessment.ts  strength benchmarks, weakness ranking, goal → session mapping
  generate.ts    the planner: periodization, safety spacing, recovery, load caps
  learn.ts       adaptation from the event log (finger gap, weekly cap, readiness)
  metrics.ts     history stats (PRs, completion %, weekly load)
server/src/
  index.ts       Express routes, zod schemas, SQLite, FIT decoding — the only impure layer
web/src/
  App.tsx        screen routing and top bar     Plan.tsx     list/calendar + bottom nav
  SessionSheet.tsx session detail: drill checklist, watch data, HR chart, feedback
  Setup.tsx      onboarding wizard              History.tsx  stats and past sessions
  Settings.tsx   goal/availability/equipment, FIT import     HrChart.tsx  plain-SVG HR chart
  api.ts         all server communication       styles.css   all styling, no frameworks
```

`CLAUDE.md` has the full contributor guide: layering rules, "to change X, edit Y" tables, and recipes.

## The training model

- 4-week mesocycles (base → build → peak → deload); deload drops volume to 60% and removes high-intensity work.
- Session selection ranks weaknesses by comparing finger/pull strength against per-grade benchmarks, weighted by the goal.
- Load is tracked with session-RPE (RPE × minutes, watch-recorded minutes when available); ACWR > 1.3 caps intensity.
- Missed and moved sessions are events; the plan regenerates deterministically around them, preserving spacing rules.
- Adaptation is earned: three clean weeks raise the weekly cap, misses lower it, pain widens finger spacing.

## Develop

```sh
npm install
npm test            # engine unit tests (vitest)
npm run check       # typecheck + lint + format check + tests — what CI runs
npm run dev         # server on :3000
npm run dev -w web  # vite dev server on :5173, proxies /api to :3000
```

TypeScript strict throughout; Prettier and ESLint enforced in CI on every push alongside tests and the build.

## Deploy

Railway builds the multi-stage `Dockerfile` on every push to `main` (config in `railway.json`); SQLite lives on a mounted volume. Generate a domain, open it on a phone, Add to Home Screen — the service worker makes it a full offline-capable PWA.
