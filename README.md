# Climb Plan

A mobile-first PWA that generates and adapts bouldering training plans deterministically. No LLMs in the loop. The plan is a pure function of your assessment, goal, availability, equipment, and the event log of feedback, moves, and setting changes.

## Architecture

- `packages/engine` holds all planning logic as pure TypeScript. `generatePlan(state, today)` takes the full user state (config + event log) and returns the plan. This package has zero dependencies on React, Express, or the database, so a future native iOS app reuses it unchanged behind the same API.
- `server` is an Express API with SQLite persistence. It stores the config and an append-only event log, validates input with zod at the boundary, and serves the built web app.
- `web` is a Vite React PWA: assessment wizard, 14-day plan view, session detail with feedback and move controls.

## Repository map

```
packages/engine/src/
  types.ts       shared data shapes (Config, Session, PlanEvent, Plan) — source of truth
  templates.ts   session content: exercises, durations, equipment/grade gates
  assessment.ts  strength benchmarks, weakness ranking, goal → session mapping
  generate.ts    the planner: periodization, safety spacing, recovery, load caps
  learn.ts       adaptation from the event log (finger gap, weekly cap, readiness)
  metrics.ts     history stats (PRs, completion %, weekly load)
server/src/
  index.ts       Express routes, zod schemas, SQLite storage — the only impure layer
web/src/
  App.tsx        screen routing and top bar
  Plan.tsx       list/calendar views          SessionSheet.tsx  feedback + move sheet
  Setup.tsx      assessment wizard            History.tsx       stats and past sessions
  api.ts         all server communication     styles.css        all styling
```

See `CLAUDE.md` for the full "to change X, edit Y" guide, the layering rules (pure engine, zod at the boundary, append-only events), and step-by-step recipes for adding event kinds and config fields.

## Training model

- Periodization runs in 4-week mesocycles: base, build, peak, deload. Deload weeks drop volume to 60% and remove high-intensity work.
- Session selection is driven by the assessment: finger and pull strength are compared against per-grade benchmarks, and the weakest qualities get priority in the weekly template.
- Safety rules are hard constraints, not suggestions: hard finger sessions at least 48h apart, max hangboarding gated on 1.5+ years experience and V3+, high-intensity capped per week, sessions only on days with declared availability.
- Load is tracked with session-RPE (RPE × minutes). If the acute:chronic ratio exceeds 1.3, the coming week's intensity is capped.
- Pain reports of severity 2+ remove finger-loading (or heavy pulling, for elbow/shoulder) sessions for 14 days and substitute technique and mobility work.
- Missed sessions and moved sessions are events; the plan regenerates deterministically around them.

## Develop

```sh
npm install
npm test          # engine tests
npm run check     # typecheck + lint + format check + tests (what CI runs)
npm run build
npm run dev       # server on :3000
npm run dev -w web  # vite dev server on :5173, proxies /api to :3000
```

Formatting is Prettier (`npm run format`), linting is ESLint (`npm run lint`); both run in CI on every push and PR alongside typechecking, tests, and the build.

## Deploy on Railway

1. Push this repo to GitHub (private is fine).
2. In Railway: New Project → Deploy from GitHub repo → pick this repo. The Dockerfile is detected via `railway.json`.
3. Add a volume mounted at `/data` (Service → Settings → Volumes) so the SQLite database survives deploys.
4. Generate a domain (Service → Settings → Networking). Open it on your phone and Add to Home Screen.

Every push to `main` redeploys automatically.
