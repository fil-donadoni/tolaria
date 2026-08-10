# CLAUDE.md

Guidance for Claude Code in this repository. Norms here are terse by design;
each carries a `#NNN` / ADR ref where the full history lives — read the ref
before relitigating a rule.

## Project Overview

Tolaria is an MTG (Magic: The Gathering) gameplay engine for study and
experimentation. Focus: rules correctness and real-time reactivity between two
clients. Not commercial — an extensible engine with a working subset of cards.

## Tech Stack

| Layer           | Technology                     | Notes                                      |
| --------------- | ------------------------------ | ------------------------------------------ |
| Frontend        | React 19 + TypeScript + Vite 8 | React Compiler enabled                     |
| Backend/DB      | Convex                         | Real-time reactive state, atomic mutations |
| Auth            | @convex-dev/auth (Password)    | Email + password + nickname                |
| Package manager | bun                            |                                            |

TypeScript ~5.9 strict (project refs: `tsconfig.app.json` src, `tsconfig.node.json` config). ESLint 9 flat config (`typescript-eslint`, `react-hooks`, `react-refresh`).

## Commands

- `bun run dev` — dev server with HMR
- `bun run build` — `tsc -b` then Vite build
- `bun run lint` — ESLint
- `bun run preview` — preview production build

## Architecture

```
Client React (P1) ──┐
                    ├── Convex (game state) ── GRE (Game Rules Engine)
Client React (P2) ──┘
```

Gameplay domain is architecturally separated from surrounding features
(matchmaking, profiles, collections).

### Game Rules Engine (GRE)

Runs **server-side** in Convex mutations. The client never validates rules —
it is only a view of the state.

- **Authoritative**: every move validated server-side before applying
- **Deterministic**: same event log ⇒ same state
- **Isolated**: rules logic independent of transport

### Authentication

`@convex-dev/auth` Password provider (email + password + nickname). Every
query/mutation touching user-owned data uses `getCurrentUser(ctx)` /
`getCurrentUserId(ctx)` from `convex/auth.ts`. Router root wrapped in
`<AuthGate>` — every route requires login, no anonymous play. Email
verification off in development.

### Player identity in games

`players[].id` is an opaque string handle used by the GRE as
`controllerId`/`ownerId`. 2-player: equals `Id<"users">`; solo:
`${userId}-p1` / `${userId}-p2`. Schema keeps it `v.string()` — do NOT type
it as `Id<"users">`. Game mutations derive id and nickname from `ctx.auth`;
clients cannot spoof identity.

### Data model

- `game_state` — current snapshot (cache, overwritten per action, deleted at game end)
- `game_events` — append-only event log (source of truth for replays, 30-90 days)

User decks in `userDecks` (indexed by `userId`); preset decks in
`convex/deckPresets.ts` (served via `api.decks.list`). State saved **only at
stable points** (waiting for human input).

### Action flow

```
1. Client sends action → Convex mutation
2. GRE validates → applies in memory → generates internal events
3. Trigger scan → triggers go to stack (never auto-resolve)
4. SBAs applied (automatic, no priority)
5. Stable state → save game_state + append game_events → clients react
```

### Stack, priority, turn structure

Stack resolves one item at a time, top-down; after each resolution priority
restarts from the active player; both must pass consecutively to proceed.
Priority timeout 30s via `ctx.scheduler.runAfter` with seq-based cancellation.
Phases: BEGINNING (untap/upkeep/draw) → PRECOMBAT_MAIN → COMBAT (5 substeps) →
POSTCOMBAT_MAIN → ENDING. Untap and cleanup are automatic (no priority).

## Project Structure

```
convex/            # Backend
├── schema.ts      # Tables
├── game.ts        # Public mutations/queries
├── cards/         # Card definitions as data (index.ts registry, types.ts, sets/)
└── gre/           # Engine: engine.ts, phases.ts, stack.ts, triggers.ts, sba.ts, actions/
src/               # Frontend (React + Vite)
├── components/    # Battlefield, Hand, Stack, Card
└── hooks/         # useGameState.ts (wrapper on Convex useQuery)
```

**Key boundary — authority, not imports** (ADR 0074): the frontend MAY import
pure engine modules from `convex/gre/` and `convex/limited/` (client-side
Brain, Draft Lab do so routinely — sharing the module prevents drift). What
the frontend never has is **authority**: no client-side engine run produces
persisted or trusted state; every real move goes through a public mutation in
`convex/game.ts` and is re-validated server-side.

## Card Definition System

Cards are **data**, not imperative code. Three levels:

1. **Pure data** — vanilla creatures, basic lands
2. **Declarative behavior** — triggered/activated/static abilities as
   structured templates; one-shot effects as an **Effect Script**
   (`effects: EffectOp[]`, ADR 0045) — the mandatory DSL-first default
3. **Imperative `resolve()`** — escape hatch for protocol-like cards only
   (Word of Command, Camouflage), never the default

Continuous static effects are data: `staticEffects[]` computed by the layer
system (`convex/gre/layers.ts`, CR 611/613). Replacement effects shipped
(`gre/replacements.ts`).

**Effect Script DSL** (ADR 0045/0046): ordered `EffectOp[]` (`dealDamage`,
`draw`, `destroy`, `choice`, …) + four frozen structural constructs (`bind`,
`ref`, `if`, `forEach`), interpreted by `convex/gre/effects/interpreter.ts` at
every effect site. The **Mechanics Registry**
(`convex/cards/mechanicsRegistry.ts`) is the single authority on keyword and
Op names (CI-enforced) — an uncensused mechanic is stop-and-open-an-issue,
never an invented name. Testing is per-Op, not per-card: a DSL card reusing
exercised Ops needs no hand-written test (static sweep + generated smoke test
cover it); a card introducing a new Op earns that Op its permanent test.
`resolve()` needs an explicit justification
(`.claude/rules/gre-development.md` § DSL-first authoring).

Key types: `convex/cards/types.ts` (`CardDefinition`, `ActivatedAbility`,
`ManaCost`, `SpellContext`, `TargetRequirement`, `EffectOp`). Mana abilities
have `useStack: false`. SBAs are global rules in `sba.ts`; cards declare only
`sbaMods` exceptions.

## Code Organization

- **One component per file.** No inline/helper components beside the parent.
- **Extract, don't inline.** Growing logic moves to named functions/files.
- **Types are centralized.** `convex/` is the source of truth
  (`cards/types.ts`, `gre/types.ts`, `gre/state.ts`); `src/types/` re-exports.
  No local type definitions in components.
- **Constants/helpers are shared.** `LAND_SUBTYPE_MANA`, `PERMANENT_TYPES`,
  `isCreature`, `isLand`, … live in `convex/gre/constants.ts` — no local copies.

## Collaboration Mode

Claude operates **autonomously**: implements, tests, validates end-to-end.
The user defines features and strategy. Ask only on significant architecture
decisions or genuine CR ambiguity affecting behavior.

### Subagent model routing (cost)

**Enforced by `.claude/hooks/spawn-guard.sh`** (prose alone measured 12% of
spawns leaking to the inherited tier over 30 days):

- Every `Agent` spawn MUST pass an explicit `model` (except `fork`).
  **`model: sonnet` for all read-only/mechanical delegation** (locate, map,
  survey, research); the session tier only for genuinely hard implementation
  or reasoning.
- Every `description` MUST be role-prefixed — `implement` / `review` /
  `fixup` / `investigate` / `research` / `verify` / `migrate` / `audit` —
  it is what attributes tokens to a role in the scorecard.
- Cavecrew agents are the caveman **plugin's**: spawn as
  `caveman:cavecrew-investigator` / `-builder` / `-reviewer`, always with
  `model: sonnet` (they pin no model of their own; the duplicate user-level
  copies were removed in #2189).

## Chrome Browser Debug

**On-demand only** — never launch Chrome to verify cards/features by default
(vitest + wire tests + preset scenarios are the standard verification). When
the user explicitly asks: always **solo mode** (one user, two seats, viewer
follows priority). Setup, storage keys, and step-by-step:
`.claude/rules/chrome-debug.md` (auto-loaded).

## Automated Development Workflow

### Skills

Work-intake skills converge on: grill → `/to-prd` → `/to-tickets` → issues
labelled `ready-for-agent`; `/process-gh-issues` is the single implementer
draining that queue. Pick intake by where work comes FROM:

| Skill                | Trigger                         | Does                                                                |
| -------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `/new-card`          | One new card                    | Scryfall oracle → Ops mapping / gap flags → PRD + tickets           |
| `/new-set`           | Whole set rollout               | MTGJSON profile, per-card triage, capability clusters, umbrella PRD |
| `/new-qa-issue`      | Observed bug/enhancement        | Explores, drafts one agent-readable issue, posts after confirmation |
| `/audit-tracker <N>` | Stale roll-up issue             | Re-verifies gaps vs HEAD, slices survivors, retires the tracker     |
| `/process-gh-issues` | Draining the queue              | File-disjoint batch, parallel implement, review, serial merge-train |
| `/mtg-rules-check`   | Before any game mechanic        | CR text + implementation status                                     |
| `/gre-test`          | Adding/modifying GRE logic      | Generates vitest tests per project patterns                         |
| `/new-op`            | Card needs a missing DSL verb   | Walks all seven Op registration sites + the Op's permanent test     |
| `/bot-slice`         | Any play-Bot / draft-Bot change | Maps the AI subsystem, walks seams, enforces verification doctrine  |

**Workflow skills are versioned in this repo** (`.claude/skills/…`), changed
via branch + PR + gate like any source file
(`scripts/__tests__/project-skills.test.ts` guards against drift to the
user-level directory). A rule that CAN be enforced mechanically belongs in a
script the gate runs (`scripts/queue-plan.ts`, `scripts/gate.ts`, hooks) —
prose is the fallback for judgment, not the home of invariants.

### Path-specific rules (auto-loaded)

- `convex/gre/**`, `convex/cards/**` → CR compliance, testing, patterns
- `src/components/**` → one-component-per-file, type sourcing, UI testing

### Development cycle

1. **Discuss** — user describes the feature/rule
2. **Verify rules** — `/mtg-rules-check` for CR text + current status
3. **Plan** — agree scope: implement now vs defer
4. **Implement** — Effect Script by default (ADR 0045); consult the Mechanics
   Registry before writing; `resolve()` only for protocol-like cards with
   recorded justification
5. **Test** — `resolve()` cards and new Ops: tests at ALL layers (GRE unit,
   game.ts integration, frontend utils, wire format — two pieces passing
   individually but failing together is a shipped bug; every feature crossing
   GRE → game.ts → UI needs one full-path integration test). DSL cards on
   exercised Ops: the per-Op regime covers them (static sweep + generated
   smoke test), no hand-written test. **Frontend wiring is not optional**:
   walk the view reducers per `.claude/rules/gre-development.md` § Frontend
   wiring analysis; SURFACE tests must run through the reducer. While
   iterating run only targeted tests (`bunx vitest run <path>`). **Every
   guarding test must be proven to fail** (break the subject, watch red,
   revert, say what you broke — § Proof-of-failure).
6. **Validate** — full gate once before done: `bun run check:all` +
   `bun run test`, both zero-error
7. **Preset scenario** — for any new card/gameplay feature (ADR 0044; DB is
   the single source of truth, #770/#1455). Headless agents do NOT insert it:
   emit one `{ label, spec }` in the PR receipt; the orchestrator registers
   it post-merge via `npx convex run debugScenarios:seedScenarioDirect`
   (upserts by label; row is deployment-local by design). Interactive work:
   Debug panel → Scenarios → "Save scenario" (`saveDebugScenario`). Skip only
   for pure refactors.
8. **UI verify** — only when the user explicitly asks for a browser check

### Quality gates (mandatory, no exceptions)

Full gate mandatory before done/merge — never skipped.

**Cadence:**

- **Iterating** — targeted tests only (`bunx vitest run <path>`). Formatting
  is automatic (husky + lint-staged). No `check:all`/full suite mid-iteration.
- **Pre-PR (light gate)** — `bunx vitest run <paths touched>` +
  **`bun run check:pr`** (= `check:all:inner`: format + lint + type-check +
  `check:index` + `check:stubs`, **plus `check:guards`**; light tier, no
  mutex). Never hand-pick a subset (#omitting `check:index` broke every
  card-shipping PR at the merge-train). **`check:guards`** runs two lanes: the
  bot suite's fast lane (#1912 — `TOLARIA_BOT_FAST=1`, deny-list in
  `vitest.config.ts`, ~60s), where the catalogue-wide bot guards
  (`aiEffectsGuard`, `pickRatings`, `opValuerCoverage`, censuses) live; and the
  **whole node project** (`convex/**` + `scripts/**` + every DOM-free `src`
  test, 692 files, ~30s at the light tier's 2 workers — no dom env init,
  `isolate: false`, so the card registry is imported once per worker). The node
  lane used to be filtered to
  `scripts/__tests__`, which left every backend catalogue guard
  (`effects/validate`'s Op-registry/executor/schema coverage,
  `mechanicsRegistry`, `divergenceMarkers`, `serialize`'s drift check) outside
  the light gate — a branch reached review with `validate.test.ts` red and a
  `check:pr` that exited 0. Scope pinned by
  `scripts/__tests__/check-guards-scope.test.ts`; bot deny-list drift by
  `bot-fast-lane.test.ts`.
  **The dom project is need-classified, not directory-classified**
  (`scripts/test-env-split.ts`, computed at config load): a `src/**/*.test.ts`
  with no DOM global, no testing-library import, no jest-dom matcher and no
  `vi.mock`/spy/fake-timer runs in the **node** project instead — 110 files
  today, and a file that grows a DOM dependency moves back by itself. Partition
  pinned by `scripts/__tests__/src-test-env-split.test.ts` (a file selected by
  NO project runs nowhere and the gate stays green). `bun run test:app` 190s →
  108s at the heavy tier.
  **Still outside the light gate: what genuinely needs a DOM** (252 files;
  issue #2435 swapped the environment to `happy-dom` — measured back-to-back
  on the same tree, `TOLARIA_VITEST_WORKERS=2 bunx vitest run --project dom`,
  2207 passed both ways: happy-dom 119.35s wall / 44.33s `environment` vs
  jsdom 180.05s wall / 113.03s `environment`, ~34% off wall, ~61% off the
  `environment` phase — per-file environment init still dominates, so no
  deny-list helps and `--pool=threads` measured identical). Cover `src/`
  changes with targeted runs. Its one known
  cross-boundary breakage class — a `vi.mock("@convex/cards")` factory going
  stale when a name becomes barrel-internal (#2339: 102 tests, 12 files, seen
  first at the merge-train) — is caught statically instead, by
  `scripts/__tests__/convex-cards-barrel-mock.test.ts` in the node lane.
- **Before done/merge** — full gate once: `bun run check:all` (zero errors) +
  `bun run test` (zero failures).

**Hooks:** `.husky/pre-commit` (lint-staged/prettier on staged files —
convenience, skipped by merge/rebase/cherry-pick) + `.husky/pre-push`
(diff-scoped `prettier --check` on pushed commits; a push updating the
**default branch** also runs the full gate, #2203 — skipped only when the SHA
is already in `.claude/telemetry/green-sha`, or explicitly via
`TOLARIA_SKIP_PUSH_GATE=1` which prints a red banner). Both tracked in git,
guarded by `scripts/__tests__/worktree-bootstrap.test.ts` (a missing husky
hook is silent — it vanished for six weeks once).

**`check:all` VERIFIES formatting** (`format:check`), it does not repair it —
on drift, run `bun run format` and re-run (#1807: a gate that repairs what it
checks can never fail).

**Three suites, one gate command:** `bun run test` = `test:app` (everything not
`*.bot.test.ts`, ~580 files) then `test:bot` (ISMCTS/eval/driver/self-play,
`*.bot.test.ts` — separate invocation so heavy episodes get an uncontended
run) then `test:blade` (must tier, own config, ~42s). **Name any new bot/AI
test `*.bot.test.ts`** — `scripts/__tests__/bot-suite-boundary.test.ts`
enforces the boundary. Blade's stretch tier stays report-only and manual
(`bun run test:blade:stretch`).

**There is no CI.** The three GitHub Actions workflows (`lint`, `test`,
`blade`) were deleted 2026-08-08: the plan's Actions minutes ran out, and with
no branch protection on this repo (`/branches/main/protection` → 403, needs
Pro) they gated nothing — every job duplicated a command the local gate
already runs. Consequence: **the local gate is the only gate**, so nothing may
be left to CI, and the merge-train always takes Lane B (local full gate on the
rebased tree). Re-adding a workflow only makes sense together with branch
protection — otherwise it is a report nobody blocks on.

**CPU admission control** (`scripts/gate.ts`) — several sessions share this
machine:

| Tier      | Commands                                                           | Behaviour                                                             |
| --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **heavy** | `bun run test`, `test:app`, `test:bot`, `check:all`                | machine-wide mutex (`~/.cache/tolaria/gate.lock`), `ncpu - 1` workers |
| **light** | `bunx vitest run <path>`, `check:pr`, `check:ts`, `lint`, `format` | no lock, vitest capped at 2 workers (`TOLARIA_VITEST_WORKERS`)        |

A queued heavy gate is not a hang. Stale locks auto-pruned. **The full gate is
blocked inside an issue worktree** (`feat/issue-N`/`fix/issue-N` → exit 1):
the merge-train runs it once per landing tree; `TOLARIA_ALLOW_FULL_SUITE=1`
is the orchestrator-only escape hatch.

**Fresh worktrees need `bun run worktree:init`** (copies `node_modules`,
`convex/_generated`, `.env.local`, `.husky/_`). The tell for a missing
bootstrap: **`216 files failed, 0 tests failed`** (import errors, not a red
baseline).

**Zero-red is absolute (green-main invariant).** `main` is always green. "Not
my test" is not an exemption; never branch off red, never merge on red, never
silence a test. Red baseline → fix or surface first.

Browser visual verification is NOT a default gate.

## Rules Implementation Process

Always cross-reference against the official CR. Before writing code, discuss
uncovered details (edge cases, interactions, timing) and decide implement-now
vs defer together.

**The CR is vendored, and it is the only source** (ADR 0098):
`data/cr/comprehensive-rules.txt` + `data/cr/VERSION.json`, sliced by
`bun run cr 605.1a` / `bun run cr grep "<keyword>"` — offline, exact, no
fetch. Third-party mirrors (yawgatog, ancestral.vision — the latter frozen at
2022-10-07) are removed, and an ad-hoc `curl` of a remembered
`MagicCompRules YYYYMMDD.txt` URL is the habit this replaced: twelve distinct
versions, back to 2022, appear in past session transcripts. **Never cite a rule
number you have not printed** — 42 of the 799 distinct ids cited in this repo
resolve to nothing, and 40 of those never existed in any revision
(`bun run cr:lint`). Wizards republishes roughly per set at
<https://magic.wizards.com/en/rules>; `bun run cr:check` says whether a newer
document exists, `bun run cr:sync` takes it. `cr:check` is deliberately outside
`check:all` — the gate is offline by contract.

## Implemented engine capabilities

Once deferred, since **shipped** — do not treat as out of scope:

- **Layer system** (`gre/layers.ts`, CR 611/613): P/T (7a–7e), color (5),
  type add (4), ability grant/removal (6), control (2), text-changing (3).
  Anthems and ability-stripping are `staticEffects[]` with `applies`.
- **Replacement effects** (`gre/replacements.ts`)
- **Complex/choice triggers**, simultaneous-trigger APNAP ordering (CR 603.3b)
- **Effect Script DSL** + Mechanics Registry (ADR 0045/0046) — the mandatory
  authoring default

When a card needs a capability that genuinely isn't built, flag it explicitly
— most mechanics are supported.

## Out of Scope

- **Full card catalog** — controlled growing set, not ~80k cards
- **3+ player multiplayer** — 2-player and solo only
- **Ante & subgames** (ADR 0010)

## Agent skills

- **Issue tracker**: GitHub Issues, `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Findings drawer**: `docs/findings/` = what a subagent noticed but was not
  asked to fix — draft, never an issue (the loop drains the queue, never
  fills it). Read via `bun run findings`; format in `docs/findings/README.md`.
- **Triage labels**: five canonical roles + model-routing labels. See
  `docs/agents/triage-labels.md`.
- **Domain docs**: `CONTEXT.md` + `docs/adr/`. ADRs are not auto-loaded —
  `docs/adr/README.md` is the queryable index; **every new ADR MUST add its
  index row** in the same change.

This project uses [Convex](https://convex.dev). When working on Convex code,
**always read `convex/_generated/ai/guidelines.md` first** — it overrides
training-data knowledge of Convex APIs. Convex agent skills:
`npx convex ai-files install`.
