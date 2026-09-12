# Agent instructions — Climb Plan

Read `CLAUDE.md` for architecture and “to change X, edit Y”. Read `docs/methodology.md` for **why** the plan is prescribed the way it is.

## Knowledge base (required on every PR)

If a change affects how plans are generated, adapted, or explained to the user, **update the knowledge base in the same PR**:

1. `docs/methodology.md` — prescription rules, safety invariants, adaptation, notice coalescing
2. `CLAUDE.md` — only if the “where to edit” map or recipes change
3. Engine tests in `packages/engine/src/generate.test.ts` — behavior changes need assertions

Do **not** ship planning-behavior changes with stale methodology text. If you are unsure whether the doc is affected, update it anyway with a short note under the relevant section.

Cloud / PR automations: treat methodology drift as a review defect; fix the doc before merge when you change `generate.ts`, `learn.ts`, `assessment.ts`, `templates.ts`, or `notices.ts`.

## Pull requests

When opening a pull request for this repo, **create it ready for review — not as a draft**. Draft PRs are easy to miss; open them as reviewable so CI and humans can pick them up immediately. Only use draft if the user explicitly asks for a draft.

## Verification

Before finishing:

```sh
npm run check
npm run build
```
