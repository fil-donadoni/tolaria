# DB-direct debug scenarios — retire the code-array scenario subsystem

**Date:** 2026-07-21
**Status:** approved (brainstorm), ready for tickets
**Related:** issue #1422 (tombstone patch — obsoleted by this work), ADR 0044 (DB-backed debug scenarios), map #1254

## Problem

Debug scenarios that ship with a card/mechanic currently take the **code-array
path**: an agent (`/process-gh-issues`) or human appends a `{ label, spec }`
entry to `NEW_MECHANIC_SCENARIOS` (or the frozen `MIGRATED_PRESET_SCENARIOS`)
in `convex/debugScenarios.ts`; a manual `internalMutation`
(`seedNewMechanicScenarios` / `seedPresetScenarios`) seeds those entries into
`debugScenarios` DB rows after each deploy.

This path is friction (file edit + merge-train append-conflict) and it produced
a class of bug (#1422): a validated-then-panel-deleted scenario resurrects on
the next seed, because the seed is append-only and reconciles against the code
array, not against the "user deleted this" state. #1422 patched that with a
tombstone table — a bandaid on a subsystem we now want gone.

**Goal:** make the **DB the single source of truth** for debug scenarios.
Agents write scenarios straight to the DB via an internal mutation; the
code arrays and their seed mutations (and the #1422 tombstone system) are
removed.

## Decision (confirmed)

1. **DB-direct replaces the file path** for agents. `NEW_MECHANIC_SCENARIOS` /
   `MIGRATED_PRESET_SCENARIOS` are not merely frozen — they are **deleted**
   once their contents are guaranteed present in the DB.
2. **Timing = post-merge.** A new card only exists in the deployment's card
   catalogue after its branch merges + main deploys, and the loadability guard
   validates card names against that catalogue. So an agent emits the scenario
   spec in its receipt; the orchestrator runs the DB write **after the merge +
   deploy**, not at implement-time.
3. **The #1422 tombstone system is removed.** With no re-seeding loop, nothing
   consumes tombstones — `seedScenarioDirect` is a one-shot per merged issue,
   not a per-deploy re-seed, so the resurrection bug cannot recur and the
   tombstone table/write are dead code.

## Design

### Deployment reality

- No deploy CI (`.github/workflows/` = `lint.yml` only). Deploys are manual /
  local `convex dev`/`convex deploy`.
- One `CONVEX_DEPLOYMENT` in `.env.local`. The orchestrator (the
  `/process-gh-issues` session) is the only realistic place to run the
  post-merge DB write; there is no CI hook to attach to.

### Component 1 — `seedScenarioDirect` internal mutation

`convex/debugScenarios.ts`:

- `internalMutation` (no `assertIsAdmin` — internal is not client-reachable;
  callable via `npx convex run` / Convex MCP).
- args: `{ label: string, spec, golden?: boolean, prompt?: string }`.
- **Loadability guard reused, non-negotiable**: `collectUnresolvedCardNames` +
  `tryGetCardByName` — reject unknown card names before write (ADR 0044
  invariant preserved).
- **Upsert-by-label**: if a row with `label` exists, `patch` its `spec` (and
  `prompt`/`golden` if provided); else `insert`. Prevents duplicate rows when
  an agent re-runs.
- **Does NOT consult tombstones** — same principle as manual
  `saveDebugScenario`: an explicit write is not an automatic re-seed.
- `golden` defaults to `true` (agent-authored curated scenario; not pruned by
  `cleanupEphemeralScenarios` before the user loads it).
- returns `{ action: "insert" | "patch", id }`.

### Component 2 — `selectScenarioUpsert` pure helper

`convex/debugScenarioSpec.ts` (mirrors the existing `selectEphemeralIdsToPrune`
/ ex-`selectPresetsToSeed` pattern): given the existing rows + a label, decide
`{ action, id? }`. Extracted because this repo has **no `convex-test`
harness** (confirmed #1422) — the decision logic is unit-tested directly; the
mutation is a thin wrapper.

### Component 3 — migration (no new code)

The two code arrays are **already seeded** into the live DB by past
`seedPresetScenarios` / `seedNewMechanicScenarios` runs. The "migration" is a
**final run of the existing seeds** to guarantee completeness before deletion:

```
npx convex run debugScenarios:seedPresetScenarios
npx convex run debugScenarios:seedNewMechanicScenarios
```

Both already upsert/skip by label; `seedNewMechanicScenarios` already honors
tombstones (#1422) so user-deleted scenarios are **not** resurrected. Verify
the row set, then proceed to deletion. No throwaway migration mutation.

### Component 4 — delete the file subsystem

`convex/debugScenarios.ts` / `convex/debugScenarioSpec.ts` / `convex/schema.ts`:

- delete `MIGRATED_PRESET_SCENARIOS`, `NEW_MECHANIC_SCENARIOS`,
  `seedPresetScenarios`, `seedNewMechanicScenarios`, `selectPresetsToSeed`.
- delete the **#1422 tombstone system**: `debugScenarioTombstones` table
  (`convex/schema.ts`), the tombstone-write in `deleteDebugScenario`, and the
  tombstone/`selectPresetsToSeed` tests.
- `deleteDebugScenario` stays (still the panel delete) — minus the
  tombstone-write.
- remove now-stale array/seed/tombstone tests in
  `convex/__tests__/debugScenarios.test.ts`.

### Component 5 — docs / workflow

- **CLAUDE.md § Development cycle step 7**: rewrite the "Automated / headless
  work — MANDATORY code path" bullet. New rule: the agent emits `{ label, spec }`
  in its receipt; the orchestrator runs `seedScenarioDirect` post-merge against
  the deployment. No more `NEW_MECHANIC_SCENARIOS` append.
- **`.claude/skills/process-gh-issues`** §3 step 4 (preset scenario) and §5
  (verify/release): add the post-merge `seedScenarioDirect` step; drop the
  code-array instruction.
- Note the accepted tradeoff: a DB-direct scenario is **deployment-local**
  (not in git, not reproduced on a fresh clone / CI / other deployment,
  absent from the PR diff). This is the explicit intent.

## Sequencing

1. **PR 1** — Component 1 + 2 (+ tests + docs pointing agents at the new path).
   Merge + deploy.
2. **Manual step** — run the two existing seeds once (Component 3), verify DB
   completeness.
3. **PR 2** — Component 4 (delete file subsystem + tombstone system + stale
   tests) + Component 5 doc rewrite. Merge + deploy.

PR 2 depends on PR 1 (needs `seedScenarioDirect` as the replacement) **and** on
the manual step (arrays must be in DB before the arrays are deleted).

## Testing

- **PR 1**: unit test `selectScenarioUpsert` (insert-when-absent, patch-when-
  present); assert the loadability guard rejects an unknown card name (reuse the
  existing guard test pattern). No `convex-test` — drive the pure helper.
- **PR 2**: the array/seed/tombstone tests are deleted with their subject; the
  remaining suite must stay green (`deleteDebugScenario` test updated to not
  expect a tombstone write).
- Full gate (`check:all` + full `bun run test`) once per PR at the merge-train.

## Risks / edge cases

- **Guard-at-wrong-deployment**: mitigated by post-merge timing — the card is in
  the catalogue by then.
- **Resurrection of a user-deleted scenario during the migration**: the final
  `seedNewMechanicScenarios` run honors tombstones (#1422 still live in PR-1
  window), so deleted scenarios stay deleted. Preset array has no tombstones but
  those are frozen legacy rows the user hasn't been deleting.
- **Empty tombstone table on drop**: #1422 shipped minutes ago and likely never
  deployed → table empty; dropping it in PR 2 orphans nothing.

## Out of scope

- Blade-scenario registry (#1256) — lives only in the code registry, unaffected.
- Any change to `saveDebugScenario` / the Debug-panel interactive path (human
  admins keep it).
